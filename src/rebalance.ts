/**
 * Rebalance bot: keeps each book on the Author's target weights.
 *
 * What it replaces: the Author pressing *Rebalance* in the Console. It calls the same Keeper method the
 * button does (bonded solver -> venue buys -> IntentBook.rebalance, whose NAV-impact bound is the
 * contract's). A change of target weights is acted on at `signalBps`; otherwise only drift past
 * `driftBps`. It leaves a book alone once the fund is wound down or past its term — closing the book
 * is the expiry bot's job.
 */
import { botOn } from './logic.ts';
import { say, type Ctx, type Target } from './ctx.ts';

export async function tickRebalance(ctx: Ctx, targets: Target[]) {
  const cfg = await ctx.keeper.config();
  if (!botOn(cfg, 'rebalance')) return;
  const now = Number((await ctx.chain.client.getBlock()).timestamp);
  for (const t of targets) {
    try {
      const spec = await ctx.chain.client.readContract({ address: t.vault, abi: ctx.loadAbi('ThesisVault'), functionName: 'spec' }) as { termEnd: bigint };
      const wound = await ctx.chain.client.readContract({ address: t.vault, abi: ctx.loadAbi('ThesisVault'), functionName: 'woundDownAt' }) as bigint;
      if (wound > 0n || now >= Number(spec.termEnd)) continue;
      const r = await ctx.keeper.rebalance(t.vault, { bot: 'rebalance' });
      if (r.trades) say('rebalance', `${t.slug ?? t.vault.slice(0, 8)}: ${r.trades} trades`);
    } catch (e) {
      const msg = String((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? e).slice(0, 160);
      say('rebalance', `${t.slug ?? t.vault.slice(0, 8)}: ${msg}`);
      await ctx.keeper.sink({ bot: 'rebalance', vault: t.vault, rule: 'REBALANCE', action: 'rebalance', result: 'error', detail: msg });
    }
  }
}
