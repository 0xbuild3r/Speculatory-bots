/**
 * Glue: the chain, the API and the Keeper's duty code.
 *
 * The bots do not carry their own copy of the contract calls. The duties (rebalance, term end, fire)
 * are the backend Keeper's methods — the same ones the Console's manual buttons call — and this process
 * hands that class three things it needs from outside the API: where thresholds come from (the API),
 * where outcomes go (the API's ledger) and where the duty's small memory lives (a file, so a restart
 * neither forgets what it saw nor repeats what it did).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import type { BotConfig } from './logic.ts';

export const API = (process.env.API_URL ?? 'http://127.0.0.1:8788').replace(/\/$/, '');
export const BACKEND = resolve(process.env.BACKEND_DIR ?? join(import.meta.dirname, '..', '..', 'Speculatory-backend'));
export const STATE_FILE = process.env.BOTS_STATE ?? join(process.env.TMPDIR ?? tmpdir(), 'speculatory-bots-state.json');

export type Action = {
  bot: string; vault: string; rule: string; action: string;
  result: 'pass' | 'fired' | 'done' | 'skip' | 'error'; detail?: string; tx?: string; at?: number; chainAt?: number;
};
export type Watch = { id: string; text: string; kind: 'falsifier' | 'signal'; check?: { feed: string; op: 'lt' | 'gt'; movePct: number }; conditionId: string };
export type Target = { vault: string; slug: string | null; title: string | null; falsified: boolean; fired: { kind: number; conditionId: string }[]; watch: Watch[] };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(API + path, { ...init, headers: { 'content-type': 'application/json', 'ngrok-skip-browser-warning': '1', ...(init?.headers ?? {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path}: ${(j as { error?: string }).error ?? r.status}`);
  return j as T;
}

/** One small JSON file: { kv: the Keeper's memory, mem: the bots' own }. Written on every change. */
class State {
  data: { kv: Record<string, unknown>; mem: Record<string, unknown> } = { kv: {}, mem: {} };
  readonly file: string;
  constructor(file: string) {
    this.file = file;
    try { if (existsSync(file)) this.data = { kv: {}, mem: {}, ...JSON.parse(readFileSync(file, 'utf8')) }; } catch { /* start clean */ }
  }
  save() { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(this.file, JSON.stringify(this.data)); }
  mem<T>(k: string): T | undefined { return this.data.mem[k] as T | undefined; }
  setMem(k: string, v: unknown) { this.data.mem[k] = v; this.save(); }
}
export const state = new State(STATE_FILE);

export async function load() {
  const imp = (f: string) => import(pathToFileURL(join(BACKEND, 'src', f)).href);
  const { Chain, loadManifest, loadAbi } = await imp('chain.ts');
  const { Keeper } = await imp('keeper.ts');
  const chain = new Chain(loadManifest(process.env.DEPLOY_MANIFEST), process.env.RPC_URL);
  const keeper = new Keeper(chain, null);
  keeper.kv = {
    get: (k: string) => (state.data.kv[k] ?? null),
    set: (k: string, v: unknown) => { state.data.kv[k] = v; state.save(); },
  };
  keeper.config = () => api<{ config: BotConfig }>('/v1/bots').then((r) => r.config);
  keeper.sink = (a: Action) => api('/v1/bots/report', { method: 'POST', body: JSON.stringify(a) }).then(() => undefined)
    .catch((e) => console.error('bots: could not report', a.action, String(e.message).slice(0, 100)));
  return { chain, keeper, loadAbi, manifest: chain.manifest as Record<string, string> };
}
export type Ctx = Awaited<ReturnType<typeof load>>;

export const say = (bot: string, s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${bot}: ${s}`);
