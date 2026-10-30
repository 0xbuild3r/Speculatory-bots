import { test } from 'node:test';
import assert from 'node:assert/strict';
import { botOn, confirmed, feedKey, holds, movePct, nextStreak, passDue, termDue, thresholdFor, type BotConfig } from '../src/logic.ts';

const cfg = (over: Partial<BotConfig> = {}): BotConfig => ({
  global: true, rebalance: { enabled: true, signalBps: 25, driftBps: 300 },
  expiry: { enabled: true, graceSec: 0 }, falsifier: { enabled: true, confirmTicks: 1 }, ...over,
});

test('a condition holds on the move since the watch began, in the registered direction', () => {
  assert.equal(feedKey('NVDA'), 'nvdaFeed');
  assert.ok(Math.abs(movePct(100, 80) + 20) < 1e-9);
  assert.equal(holds({ feed: 'NVDA', op: 'lt', movePct: -15 }, 100, 84), true);    // −16%: past −15%
  assert.equal(holds({ feed: 'NVDA', op: 'lt', movePct: -15 }, 100, 86), false);   // −14%: not yet
  assert.equal(holds({ feed: 'ETH', op: 'gt', movePct: 35 }, 100, 136), true);
  assert.equal(holds({ feed: 'ETH', op: 'gt', movePct: 35 }, 100, 134), false);
});

test('no baseline or no price is never a hit', () => {
  assert.equal(holds({ feed: 'X', op: 'lt', movePct: -1 }, 0, 50), false);
  assert.equal(holds({ feed: 'X', op: 'lt', movePct: -1 }, 100, NaN), false);
});

test('a condition is fired only after confirmTicks in a row, and a miss resets the count', () => {
  let s = 0;
  s = nextStreak(s, true); assert.equal(confirmed(s, 2), false);
  s = nextStreak(s, false); assert.equal(s, 0);
  s = nextStreak(s, true); s = nextStreak(s, true); assert.equal(confirmed(s, 2), true);
});

test('expiry is due at the term end plus grace, or once the fund is wound down', () => {
  assert.equal(termDue(999, 1000, 0), false);
  assert.equal(termDue(1000, 1000, 0), true);
  assert.equal(termDue(1000, 1000, 60), false);
  assert.equal(termDue(1060, 1000, 60), true);
  assert.equal(termDue(10, 1000, 60, 5), true);
});

test('switches: the global one stops everything, a bot switch only that bot; thresholds follow a weight change', () => {
  assert.equal(botOn(cfg(), 'rebalance'), true);
  assert.equal(botOn(cfg({ global: false }), 'expiry'), false);
  assert.equal(botOn(cfg({ falsifier: { enabled: false, confirmTicks: 1 } }), 'falsifier'), false);
  assert.equal(botOn(cfg({ falsifier: { enabled: false, confirmTicks: 1 } }), 'rebalance'), true);
  assert.equal(thresholdFor(true, cfg().rebalance), 25);
  assert.equal(thresholdFor(false, cfg().rebalance), 300);
  assert.equal(passDue(undefined, 100, false), true);
  assert.equal(passDue(100, 130, false), false);
  assert.equal(passDue(100, 161, false), true);
});
