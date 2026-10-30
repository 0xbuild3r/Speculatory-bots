/**
 * The bots process: one loop, three duties, one set of switches (the API's, set from the Console or the
 * Portal). Default ON. A stopped bot delays a duty and never changes what is allowed — every action
 * here is a contract call a person can make with a button.
 *
 *   BACKEND_DIR   where Speculatory-backend lives (its Keeper code and ABIs are used as-is)
 *   API_URL       the backend API (switches and thresholds in, outcomes out)
 *   RPC_URL       the chain
 *   BOTS_TICK_MS  loop period (default 6000)
 *   PIDFILE       written on start, removed on exit
 */
import { writeFileSync, rmSync } from 'node:fs';
import { api, load, say, type Target } from './ctx.ts';
import { tickRebalance } from './rebalance.ts';
import { tickExpiry } from './expiry.ts';
import { tickFalsifier } from './falsifier.ts';

export async function tickOnce(ctx: Awaited<ReturnType<typeof load>>) {
  const { feeds, targets } = await api<{ feeds: Record<string, string>; targets: Target[] }>('/v1/bots/targets');
  await tickFalsifier(ctx, feeds, targets);   // a fired falsifier first: it changes what the others should do
  await tickRebalance(ctx, targets);
  await tickExpiry(ctx, targets);
}

async function main() {
  const ctx = await load();
  const ms = Number(process.env.BOTS_TICK_MS ?? 6000);
  if (process.env.PIDFILE) writeFileSync(process.env.PIDFILE, String(process.pid));
  const bye = () => { if (process.env.PIDFILE) rmSync(process.env.PIDFILE, { force: true }); process.exit(0); };
  process.on('SIGTERM', bye); process.on('SIGINT', bye);
  say('bots', `up · api ${process.env.API_URL ?? 'http://127.0.0.1:8788'} · every ${ms} ms`);
  let busy = false;
  const loop = async () => {
    if (busy) return;                       // at-least-once timers, idempotent bodies — and never two ticks at once
    busy = true;
    try { await tickOnce(ctx); } catch (e) { say('bots', `tick failed: ${String((e as Error).message ?? e).slice(0, 160)}`); }
    finally { busy = false; }
  };
  await loop();
  setInterval(loop, ms);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
