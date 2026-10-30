# Speculatory — bots (demo automation)

Small independent processes that do what the Author and the Dev had to do by hand
in the demo. Every bot runs **by default**; the console always offers the manual
version of the same action next to it (the escape hatch — see console issue #1).

Nothing here is a privileged path. A bot acts through the same contract calls a
human would:

| Bot | What it does | The human action it replaces | On-chain path |
|---|---|---|---|
| **rebalance** | watches each book's weights against the Author's target; rebalances when a signal fired or the drift passes threshold | Author presses *Rebalance* in the console | bonded solver → `IntentBook.rebalance` → `MockDex` |
| **expiry** | at `spec.termEnd`: closes the book, opens the redeem window, runs the term-end score exactly once, settles pending batches | nobody does this today — long theses just rot | vault close + settle, same as keeper's term-end branch |
| **falsifier watcher** | evaluates each thesis's registered *signal* / *falsifier* conditions against the simulator's feeds and fires them | Oracle tab button ("manual today") | `FalsifierOracle.fire(vault, kind, conditionId, evidenceHash, uri)` as a set reporter |

Conditions are read from the thesis content itself (`falsifier`, `signals`);
the watcher keeps no condition list of its own — `conditionId` is the hash of the
registered text, same as the Oracle tab uses.

## Running

```bash
RPC_URL=http://127.0.0.1:8545 API_URL=http://127.0.0.1:8788 \
  node --experimental-strip-types src/rebalance.ts   # or expiry.ts / falsifier.ts
```

Same environment as the backend (`script/up.sh` must be up). Roles come from the
demo mnemonic (solver, reporter) — impersonated, never an investor key.

## Tests

- `npm test` — unit: condition evaluation, drift math, expiry predicates.
- `node test/e2e.ts` — one run on a **pristine chain** (`../Speculatory-backend/script/up.sh`,
  which resets, deploys and seeds):
  - seed a bear scenario → watcher fires the falsifier (kind 1) once, vault
    `falsifiedAt` set, early settlement runs; a second tick fires nothing;
  - fire a signal by hand → rebalance bot trades inside the window and the
    `SwapJournal` entry ties back to it;
  - warp past `termEnd` → book flat, units redeemable, score booked exactly once.

## Invariants (the review bar)

- A bot never signs for an investor. Roles it may use: bonded solver, admin-set
  reporter, keeper/admin.
- Every action lands on-chain where the human version lands. No bot-only side
  tables, no shortcuts the demo page could not take.
- At-least-once timers, idempotent bodies: check before writing, re-firing an
  already-`falsified` vault is a bug, a duplicate tick must not duplicate trades.
- Default ON. Disabling is a switch, not a redeploy; the manual button stays
  live either way.

## Layout

```
src/rebalance.ts        weight watcher + solver call
src/expiry.ts           term-end close / redeem-window runner
src/falsifier.ts        condition watcher + fire
src/lib.ts              chain/api glue, roles, the "already done" guards
test/e2e.ts             pristine-chain story, one run per verification
```
