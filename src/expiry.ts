/**
 * Expiry bot: at a fund's term end, close it properly.
 *
 * What it replaces: nobody — today a long thesis just rots past its date. The Keeper's term-end duty
 * winds the fund down, runs the final stake score once with the holders of that moment, puts the book
 * in cash and settles what is waiting. Every step is skipped when it is already true, so a second tick
 * finds nothing to do. `graceSec` only delays the start; it never moves the date.
 */
import { botOn } from './logic.ts';
import { say, type Ctx, type Target } from './ctx.ts';

export async function tickExpiry(ctx: Ctx, targets: Target[]) {
  const cfg = await ctx.keeper.config();
  if (!botOn(cfg, 'expiry')) return;
  for (const t of targets) {
    try {
      const r = await ctx.keeper.termEnd(t.vault, { bot: 'expiry', graceSec: cfg.expiry.graceSec });
      if (r.steps.length) say('expiry', `${t.slug ?? t.vault.slice(0, 8)}: ${r.steps.join(', ')}`);
    } catch (e) {
      const msg = String((e as { shortMessage?: string }).shortMessage ?? (e as Error).message ?? e).slice(0, 160);
      say('expiry', `${t.slug ?? t.vault.slice(0, 8)}: ${msg}`);
      await ctx.keeper.sink({ bot: 'expiry', vault: t.vault, rule: 'TERM', action: 'termEnd', result: 'error', detail: msg });
    }
  }
}
