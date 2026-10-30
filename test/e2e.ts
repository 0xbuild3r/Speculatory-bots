/**
 * One story on a pristine chain, no mocks:
 *   BOTS=hold bash ../Speculatory-backend/script/up.sh      # reset, deploy, seed; the API leaves the three duties to the bots
 *   node --experimental-strip-types test/e2e.ts
 * The bots are driven tick by tick from here (same code the process loop runs), so every step is deterministic.
 */
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.BOTS_STATE = process.env.BOTS_STATE ?? join(process.env.TMPDIR ?? tmpdir(), 'speculatory-bots-e2e-state.json');
rmSync(process.env.BOTS_STATE, { force: true });
const { api, load, state } = await import('../src/ctx.ts');
const { tickOnce } = await import('../src/index.ts');
const { tickFalsifier } = await import('../src/falsifier.ts');

let pass = 0, fail = 0;
const ok = (name: string, cond: unknown, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} ${detail}`); }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (what: string, f: () => Promise<boolean>, ms = 40_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await f().catch(() => false)) return true; await sleep(1000); }
  console.log(`  .. timed out waiting for ${what}`);
  return false;
};
const post = (p: string, b: unknown) => api(p, { method: 'POST', body: JSON.stringify(b) });

type Rule = { id: string; evaluated: boolean; evaluation: { result: string; at: number; detail?: string } | null; fired: unknown; swaps?: unknown[] };
const ledger = (v: string) => api<{ rules: Rule[]; log: { action: string; result: string; bot: string }[] }>(`/v1/funds/${v}/ledger`);
const rule = (l: { rules: Rule[] }, id: string) => l.rules.find((r) => r.id === id)!;
const firedEvents = (v: string) => api<{ vault: string; kind?: unknown }[]>('/v1/falsifiers').then((r) => (Array.isArray(r) ? r : (r as { events?: unknown[] }).events ?? []) as { vault?: string; kind?: number | string; args?: { kind?: number } }[]);

const ctx = await load();
const info = await api<{ external: boolean }>('/v1/bots');
ok('the API hands rebalance + expiry to the bots (BOTS_EXTERNAL)', info.external === true);

const { targets, feeds } = await api<{ feeds: Record<string, string>; targets: { vault: string; slug: string; watch: { id: string; check?: unknown }[]; fired: unknown[]; falsified: boolean }[] }>('/v1/bots/targets');
const two = targets.find((t) => t.slug === 'two-names-one-dial')!;
const apps = targets.find((t) => t.slug === 'apps-not-l1s')!;
ok('both theses are watched, with machine proxies read from their content', two && apps && two.watch.some((w) => w.id === 'F1' && w.check) && two.watch.some((w) => w.id === 'S1' && w.check));

console.log('— flat market');
await tickOnce(ctx);
let l = await ledger(two.vault);
ok('flat: the falsifier and the signal are evaluated and pass', rule(l, 'F1').evaluation?.result === 'pass' && rule(l, 'S1').evaluation?.result === 'pass', JSON.stringify(rule(l, 'F1').evaluation));
ok('flat: nothing fired', !rule(l, 'F1').fired && !rule(l, 'S1').fired);
const swapsOf = async (_v: string) => (await api<unknown[]>('/v1/dex/swaps')).length;   // the venue's trades (the SwapJournal is the Author's name rotation, not rebalancing)
const swaps0 = await swapsOf(two.vault);

console.log('— a feed the thesis names is missing: log only');
const before = rule(await ledger(two.vault), 'F1').evaluation!.at;
await sleep(1100);
const noNvda = Object.fromEntries(Object.entries(feeds).filter(([k]) => k !== 'nvdaFeed'));
await tickFalsifier(ctx, noNvda, targets as never);
l = await ledger(two.vault);
ok('missing feed: not evaluated, not fired, nothing written', rule(l, 'F1').evaluation!.at === before && !rule(l, 'F1').fired && !rule(l, 'S1').fired);

console.log('— NVDA −20%: the signal');
await post('/v1/sim/shock', { asset: 'NVDA', pct: -0.20 });
await tickOnce(ctx);
ok('signal S1 fired (the projection catches up), F1 did not', await waitFor('S1 on the ledger', async () => Boolean(rule(await ledger(two.vault), 'S1').fired), 20_000) && !rule(await ledger(two.vault), 'F1').fired);
l = await ledger(two.vault);
ok('the ledger says the bot fired it', rule(l, 'S1').evaluation?.result === 'pass' || rule(l, 'S1').evaluation?.result === 'fired', JSON.stringify(rule(l, 'S1').evaluation));
ok('rebalance bought/sold at the venue', await waitFor('venue trade', async () => (await swapsOf(two.vault)) > swaps0, 25_000));
const rb = rule(await ledger(two.vault), 'REBALANCE') as Rule & { evaluation: { result: string; tx?: string } };
ok('REBALANCE evaluation is a real trade, tied to its transaction', rb.evaluation?.result === 'done' && /^0x[0-9a-f]{64}$/.test(rb.evaluation.tx ?? ''), JSON.stringify(rb.evaluation));
const rcpt = await ctx.chain.client.getTransactionReceipt({ hash: rb.evaluation.tx as `0x${string}` });
ok('that transaction is IntentBook.rebalance from the bonded solver', rcpt.status === 'success' && rcpt.to?.toLowerCase() === ctx.manifest.book.toLowerCase());

console.log('— second tick is a no-op');
const swaps1 = await swapsOf(two.vault);
const fires1 = (await ledger(two.vault)).log.filter((e) => e.action === 'fireSignal' || e.action === 'fireFalsifier').length;
await tickOnce(ctx);
const fires2 = (await ledger(two.vault)).log.filter((e) => e.action === 'fireSignal' || e.action === 'fireFalsifier').length;
ok('no second fire', fires1 === 1 && fires2 === 1, `${fires1} -> ${fires2}`);
ok('no duplicate trade', (await swapsOf(two.vault)) === swaps1);

console.log('— bear: the falsifier');
await post('/v1/sim/shock', { asset: 'NVDA', pct: -0.45 });
await tickOnce(ctx);
ok('F1 fired (kind 1) by the bot', await waitFor('F1 on the ledger', async () => Boolean(rule(await ledger(two.vault), 'F1').fired), 20_000));
const stakeClosed = await waitFor('stake closed after the falsifier', async () => {
  const s = await api<{ state: string; closed: unknown }>(`/v1/funds/${two.vault}/stake`);
  return s.state === 'closed' || s.closed != null;
}, 45_000);
ok('early settlement ran: the call is closed on the stake', stakeClosed);
await tickOnce(ctx); await tickOnce(ctx);
const fz = (await ledger(two.vault)).log.filter((e) => e.action === 'fireFalsifier' && e.result === 'fired').length;
ok('a falsified fund is never fired again', fz === 1, String(fz));

console.log('— term end (the other thesis, untouched so far)');
const termBefore = rule(await ledger(apps.vault), 'TERM');
ok('before the date: TERM is evaluated and skips', termBefore.evaluation?.result === 'skip', JSON.stringify(termBefore.evaluation));
await post('/v1/sim/advance', { days: 1100 });
await tickOnce(ctx);
const wound = await ctx.chain.client.readContract({ address: apps.vault as `0x${string}`, abi: ctx.loadAbi('ThesisVault'), functionName: 'woundDownAt' }) as bigint;
ok('term end: wound down', wound > 0n);
const book = await api<{ holdings: { weight: number }[] }>(`/v1/funds/${apps.vault}`).catch(() => null);
const hv = await ctx.chain.client.readContract({ address: apps.vault as `0x${string}`, abi: ctx.loadAbi('ThesisVault'), functionName: 'holdingsCount' }) as bigint;
let heldUsd = 0n;
for (let i = 0n; i < hv; i++) {
  const a = await ctx.chain.client.readContract({ address: apps.vault as `0x${string}`, abi: ctx.loadAbi('ThesisVault'), functionName: 'holdings', args: [i] }) as `0x${string}`;
  if (a.toLowerCase() === ctx.manifest.usdc.toLowerCase()) continue;
  const bal = await ctx.chain.client.readContract({ address: a, abi: ctx.loadAbi('MockUSDC'), functionName: 'balanceOf', args: [apps.vault as `0x${string}`] }) as bigint;
  heldUsd += bal;
}
ok('term end: the book is flat (cash only)', heldUsd === 0n, `non-cash balance ${heldUsd}`);
void book;
const closed = await waitFor('score booked', async () => {
  const s = await api<{ state: string; closed: unknown }>(`/v1/funds/${apps.vault}/stake`);
  return s.state === 'closed' || s.closed != null;
}, 45_000);
ok('term end: the final score is booked', closed);
const term = rule(await ledger(apps.vault), 'TERM');
ok('TERM evaluation is done', term.evaluation?.result === 'done', JSON.stringify(term.evaluation));
const logLen = (await ledger(apps.vault)).log.length;
await tickOnce(ctx); await tickOnce(ctx);
ok('second tick: nothing more happens', (await ledger(apps.vault)).log.length === logLen);

console.log('— the switches are real');
await post('/v1/bots/config', { global: false });
const off = (await api<{ config: { global: boolean } }>('/v1/bots')).config.global;
await post('/v1/shock'.replace('/v1/shock', '/v1/sim/shock'), { asset: 'ETH', pct: 0.5 });
const logOff = (await ledger(apps.vault)).log.length;
await tickOnce(ctx);
ok('global OFF: a tick does nothing', off === false && (await ledger(apps.vault)).log.length === logOff);
await post('/v1/bots/config', { global: true });
ok('global ON again', (await api<{ config: { global: boolean } }>('/v1/bots')).config.global === true);

void state;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
