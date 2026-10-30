/**
 * Falsifier watcher: evaluates the conditions a thesis registered, and fires them.
 *
 * What it replaces: the Oracle tab button ("manual today"). The conditions are read from the thesis
 * content itself (`falsifier`, `signals` — the API serves them with their `conditionId`, the hash of
 * the registered text); this bot keeps no list of its own. A condition that carries a machine proxy
 * (`check`: a feed, a direction, a move since the watch began) is evaluated against the feed; one that
 * does not is left for a human, and a feed that is missing is only logged. When a condition holds for
 * `confirmTicks` ticks in a row it is fired once as the admin-set reporter —
 * `FalsifierOracle.fire(vault, kind, conditionId, evidenceHash, uri)` — and never again: the on-chain
 * log is the authority.
 */
import { botOn, confirmed, feedKey, fmtPct, holds, movePct, nextStreak, passDue, type Check } from './logic.ts';
import { say, state, type Ctx, type Target } from './ctx.ts';

async function price(ctx: Ctx, feeds: Record<string, string>, check: Check): Promise<number | null> {
  const addr = feeds[feedKey(check.feed)];
  if (!addr) return null;
  try {
    const [, answer] = await ctx.chain.client.readContract({ address: addr as `0x${string}`, abi: ctx.loadAbi('MockChainlink'), functionName: 'latestRoundData' }) as [bigint, bigint];
    return Number(answer) / 1e18;
  } catch { return null; }
}

export async function tickFalsifier(ctx: Ctx, feeds: Record<string, string>, targets: Target[]) {
  const cfg = await ctx.keeper.config();
  if (!botOn(cfg, 'falsifier')) return;
  const now = Math.floor(Date.now() / 1000);
  for (const t of targets) {
    if (t.falsified) continue;
    for (const w of t.watch) {
      if (t.fired.some((f) => f.conditionId.toLowerCase() === w.conditionId.toLowerCase())) continue;   // already on the log
      const label = `${t.slug ?? t.vault.slice(0, 8)} ${w.id}`;
      if (!w.check) continue;                                   // prose only: a human's call
      const px = await price(ctx, feeds, w.check);
      if (px === null) { say('falsifier', `${label}: no feed for ${w.check.feed} — not evaluated`); continue; }
      // "where the watch began": the first price this bot saw for the feed, remembered across restarts
      const baseKey = `base:${w.check.feed}`;
      let base = state.mem<number>(baseKey);
      if (base === undefined) { base = px; state.setMem(baseKey, base); }
      const streakKey = `streak:${t.vault}:${w.id}`;
      const now1 = holds(w.check, base, px);
      const streak = nextStreak(state.mem<number>(streakKey) ?? 0, now1);
      if (streak !== (state.mem<number>(streakKey) ?? 0)) state.setMem(streakKey, streak);
      const move = movePct(base, px);
      if (now1 && confirmed(streak, cfg.falsifier.confirmTicks)) {
        const out = await ctx.keeper.fire(t.vault, w.kind === 'falsifier' ? 1 : 0, w.text, {
          bot: 'falsifier', rule: w.id, evidence: `${w.check.feed} ${fmtPct(move)} since the watch began (${w.check.op === 'lt' ? '<' : '>'} ${fmtPct(w.check.movePct)})`,
        }).catch(async (e) => {
          const msg = String((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? e).slice(0, 160);
          say('falsifier', `${label}: ${msg}`);
          await ctx.keeper.sink({ bot: 'falsifier', vault: t.vault, rule: w.id, action: 'fire', result: 'error', detail: msg });
          return null;
        });
        if (out?.hash) say('falsifier', `${label}: FIRED (${w.check.feed} ${fmtPct(move)})`);
        if (w.kind === 'falsifier') break;                       // the fund is falsified; nothing else to watch
        continue;
      }
      // an evaluation that came out "not yet" is still an evaluation: the ledger shows it, at most once a minute
      const last = state.mem<number>(`passAt:${t.vault}:${w.id}`);
      if (passDue(last, now, false)) {
        state.setMem(`passAt:${t.vault}:${w.id}`, now);
        await ctx.keeper.sink({
          bot: 'falsifier', vault: t.vault, rule: w.id, action: 'evaluate', result: 'pass',
          detail: `${w.check.feed} ${fmtPct(move)} since the watch began · fires ${w.check.op === 'lt' ? 'below' : 'above'} ${fmtPct(w.check.movePct)}${streak ? ` · ${streak}/${cfg.falsifier.confirmTicks} ticks` : ''}`,
        });
      }
    }
  }
}
