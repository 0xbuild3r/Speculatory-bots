/**
 * The decisions, with no chain and no network in them, so they can be tested without either.
 */

export type Check = { feed: string; op: 'lt' | 'gt'; movePct: number };
export type BotConfig = {
  global: boolean;
  rebalance: { enabled: boolean; signalBps: number; driftBps: number };
  expiry: { enabled: boolean; graceSec: number };
  falsifier: { enabled: boolean; confirmTicks: number };
};
export type BotName = 'rebalance' | 'expiry' | 'falsifier';

/** A bot runs only when the global switch and its own switch are both on. */
export const botOn = (c: BotConfig, b: BotName) => c.global && c[b].enabled;

/** The manifest key of a feed named by symbol in a thesis: NVDA -> nvdaFeed. */
export const feedKey = (symbol: string) => `${symbol.toLowerCase()}Feed`;

/** Percent move of a price from where the watcher first saw it. */
export function movePct(base: number, px: number): number {
  if (!(base > 0) || !Number.isFinite(px)) return NaN;
  return (px / base - 1) * 100;
}

/** Is the registered proxy condition true at this price? NaN (no baseline, no price) is never true. */
export function holds(check: Check, base: number, px: number): boolean {
  const m = movePct(base, px);
  if (Number.isNaN(m)) return false;
  return check.op === 'lt' ? m < check.movePct : m > check.movePct;
}

/** Consecutive ticks a condition has to hold before it is fired (falsifier.confirmTicks). */
export function nextStreak(prev: number, nowTrue: boolean): number {
  return nowTrue ? prev + 1 : 0;
}
export const confirmed = (streak: number, confirmTicks: number) => streak >= confirmTicks;

/** The term of a fund is over (plus the configured grace), or the fund was already wound down. */
export function termDue(now: number, termEnd: number, graceSec: number, woundDownAt = 0): boolean {
  return woundDownAt > 0 || now >= termEnd + graceSec;
}

/** A weight change is acted on at signalBps; otherwise only drift past driftBps. */
export function thresholdFor(changed: boolean, c: BotConfig['rebalance']): number {
  return changed ? c.signalBps : c.driftBps;
}

/** A ledger line for a rule that passed is rewritten at most this often (the log is for events). */
export const PASS_EVERY_SEC = 60;
export function passDue(lastAt: number | undefined, now: number, changed: boolean): boolean {
  return changed || lastAt === undefined || now - lastAt >= PASS_EVERY_SEC;
}

export const fmtPct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;
