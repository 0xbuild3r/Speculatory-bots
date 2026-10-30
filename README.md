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

`bash ../Speculatory-backend/script/up.sh` starts this process next to the API when this repo sits
beside it (`BOTS=0` → the in-process keeper does the three duties instead). By hand:

```bash
BACKEND_DIR=../Speculatory-backend API_URL=http://127.0.0.1:8788 RPC_URL=http://127.0.0.1:8545 \
  node --experimental-strip-types src/index.ts
```

The duty code is the backend's `Keeper` (the same methods the Console's manual buttons call); this
process only decides *when*. Switches and thresholds come from the API (`GET /v1/bots`, set with
`POST /v1/bots/config` — Console › Dev › Automation, or Portal › Bots); outcomes go back to
`POST /v1/bots/report`, which is what the per-fund rule ledger shows. Roles come from the demo
mnemonic (solver, reporter) — impersonated, never an investor key. State that must survive a restart
(the weights last acted on, the price where each watch began, confirm streaks) is one JSON file.

## Tests

- `npm test` — unit: condition evaluation, drift math, expiry predicates.
- `node --experimental-strip-types test/e2e.ts` — one run on a **pristine chain**
  (`BOTS=hold bash ../Speculatory-backend/script/up.sh`: resets, deploys, seeds, and leaves the three
  duties to the bots without starting the process — the test drives the same tick code itself; 23 checks):
  - seed a bear scenario → watcher fires the falsifier (kind 1) once, vault
    `falsifiedAt` set, early settlement runs; a second tick fires nothing;
  - a signal condition is met → the watcher fires it once; the rebalance bot trades through
    the bonded solver (`IntentBook.rebalance`, venue buys/sells visible at `/v1/dex/swaps`) and the
    ledger's REBALANCE line carries that transaction. (`SwapJournal` is the Author's own name
    rotation — a bot never writes to it);
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
src/index.ts            the loop: targets from the API, then falsifier → rebalance → expiry
src/rebalance.ts        weight watcher + solver call (Keeper.rebalance)
src/expiry.ts           term-end close / redeem-window runner (Keeper.termEnd)
src/falsifier.ts        condition watcher + fire (Keeper.fire)
src/logic.ts            the decisions, pure (conditions, streaks, thresholds, switches)
src/ctx.ts              chain/api glue, the Keeper wiring, the state file
test/unit.test.ts       npm test
test/e2e.ts             pristine-chain story, one run per verification
```
