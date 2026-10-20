import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureQuestionClock, questionElapsed, recordAnswerTime, totalAttemptTime } from '../legacy/v040/attempt-timer.js';

const regular = { id: 'logic-1', field: 'logic' };
const memory = { id: 'memory-1', field: 'memory', visual: { type: 'memory', seconds: 5 } };
const fresh = () => ({ mode: 'daily', date: '2026-10-19', index: 0, answers: [], memory: {}, timingVersion: 1, timings: [], clock: null });

test('regular timing starts once and survives renders, reloads, and background time', () => {
  const original = fresh();
  const started = ensureQuestionClock(original, regular, 1000);
  assert.equal(original.clock, null);
  assert.deepEqual(started.clock, { index: 0, startedAt: 1000 });
  assert.equal(totalAttemptTime(started, regular, 1000), 0);
  assert.equal(ensureQuestionClock(started, regular, 9000), started);
  const reloaded = JSON.parse(JSON.stringify(started));
  assert.equal(ensureQuestionClock(reloaded, regular, 12000), reloaded);
  assert.deepEqual(questionElapsed(reloaded, regular, 16000), { elapsedMs: 15000, ready: true, valid: true });
});

test('memory preparation and exposure cannot be submitted or counted as thinking time', () => {
  const waiting = fresh();
  assert.equal(ensureQuestionClock(waiting, memory, 1000), waiting);
  assert.deepEqual(questionElapsed(waiting, memory, 3000), { elapsedMs: 0, ready: false, valid: false });
  assert.throws(() => recordAnswerTime(waiting, memory, 3000), /준비/);

  const exposed = ensureQuestionClock({ ...waiting, memory: { 0: { until: 10000 } } }, memory, 5000);
  assert.deepEqual(exposed.clock, { index: 0, startedAt: 10000 });
  assert.deepEqual(questionElapsed(exposed, memory, 7000), { elapsedMs: 0, ready: false, valid: true });
  assert.throws(() => recordAnswerTime(exposed, memory, 9999), /준비/);
  assert.equal(ensureQuestionClock(exposed, memory, 12000), exposed);
  assert.deepEqual(questionElapsed(exposed, memory, 10000), { elapsedMs: 0, ready: true, valid: true });
  assert.equal(recordAnswerTime(exposed, memory, 16000).elapsedMs, 6000);
});

test('returning after a memory deadline includes all time since the saved deadline', () => {
  const saved = { ...fresh(), memory: { 0: { until: 6000 } } };
  const resumed = ensureQuestionClock(JSON.parse(JSON.stringify(saved)), memory, 20000);
  assert.equal(resumed.clock.startedAt, 6000);
  assert.equal(questionElapsed(resumed, memory, 21000).elapsedMs, 15000);
  assert.equal(recordAnswerTime(resumed, memory, 21000).elapsedMs, 15000);
});

test('recording is immutable, rounds to whole milliseconds, and never advances answers or index', () => {
  const answers = Object.freeze([]);
  const active = Object.freeze({ ...fresh(), answers, timings: Object.freeze([]), clock: Object.freeze({ index: 0, startedAt: 1000.2 }) });
  const recorded = recordAnswerTime(active, regular, 2000.9);
  assert.equal(recorded.elapsedMs, 1000);
  assert.deepEqual(recorded.active.timings, [1000]);
  assert.equal(recorded.active.clock, null);
  assert.equal(recorded.active.index, 0);
  assert.equal(recorded.active.answers, answers);
  assert.deepEqual(active.timings, []);
  assert.deepEqual(active.clock, { index: 0, startedAt: 1000.2 });
});

test('legacy attempts remain playable without creating a retrospective timing bonus', () => {
  const legacy = { mode: 'daily', date: '2026-10-19', index: 0, answers: [], memory: {} };
  assert.equal(ensureQuestionClock(legacy, regular, 1000), legacy);
  assert.deepEqual(questionElapsed(legacy, regular, 2000), { elapsedMs: null, ready: true, valid: false });
  const recorded = recordAnswerTime(legacy, regular, 2000);
  assert.equal(recorded.elapsedMs, null);
  assert.deepEqual(recorded.active.timings, [null]);
  assert.equal(recorded.active.timingVersion, undefined);
  assert.equal(totalAttemptTime(recorded.active, regular, 2000), null);

  const exposed = { ...legacy, memory: { 0: { until: 5000 } } };
  assert.deepEqual(questionElapsed(exposed, memory, 4000), { elapsedMs: null, ready: false, valid: false });
  assert.deepEqual(questionElapsed(exposed, memory, 6000), { elapsedMs: null, ready: true, valid: false });
});

test('a backwards or invalid regular clock cannot earn a timing bonus', () => {
  const active = ensureQuestionClock(fresh(), regular, 10000);
  assert.equal(ensureQuestionClock(active, regular, 9000), active);
  assert.deepEqual(questionElapsed(active, regular, 9000), { elapsedMs: null, ready: true, valid: false });
  assert.equal(recordAnswerTime(active, regular, 9000).elapsedMs, null);
  for (const now of [NaN, Infinity, -1, '12000']) {
    assert.equal(questionElapsed(active, regular, now).valid, false);
    assert.equal(recordAnswerTime(active, regular, now).elapsedMs, null);
  }
});

test('malformed or inconsistent saved clocks are invalidated permanently for the current item', () => {
  for (const clock of [{ index: 0, startedAt: -1 }, { index: 0, startedAt: '1000' }, { index: 0 }, [], 1234]) {
    const original = { ...fresh(), clock };
    const normalized = ensureQuestionClock(original, regular, 2000);
    assert.equal(normalized.clock, null);
    assert.deepEqual(normalized.timings, [null]);
    assert.equal(ensureQuestionClock(normalized, regular, 3000), normalized);
    assert.equal(recordAnswerTime(normalized, regular, 4000).elapsedMs, null);
  }
  const wrongMemoryClock = { ...fresh(), memory: { 0: { until: 5000 } }, clock: { index: 0, startedAt: 1000 } };
  assert.equal(recordAnswerTime(ensureQuestionClock(wrongMemoryClock, memory, 6000), memory, 7000).elapsedMs, null);
});

test('total duration accumulates submitted items and the current item without double counting', () => {
  let active = ensureQuestionClock(fresh(), regular, 1000);
  active = recordAnswerTime(active, regular, 2500).active;
  assert.equal(totalAttemptTime(active, regular, 9000), 1500);
  active = { ...active, index: 1, answers: [0] };
  active = ensureQuestionClock(active, regular, 5000);
  assert.equal(totalAttemptTime(active, regular, 7000), 3500);
  active = recordAnswerTime(active, regular, 7500).active;
  assert.deepEqual(active.timings, [1500, 2500]);
  assert.equal(totalAttemptTime(active, regular, 99000), 4000);

  const third = ensureQuestionClock({ ...active, index: 2, answers: [0, 0], memory: { 2: { until: 11000 } } }, memory, 8000);
  assert.equal(totalAttemptTime(third, memory, 9000), 4000);
  assert.equal(totalAttemptTime(third, memory, 13000), 6000);
});

test('missing, invalid, or unmeasured prior durations keep total time unmeasured', () => {
  const current = { ...fresh(), index: 1, answers: [0], clock: { index: 1, startedAt: 5000 } };
  for (const timings of [[], [null], [undefined], [-1], [NaN], ['1000']]) {
    assert.equal(totalAttemptTime({ ...current, timings }, regular, 6000), null);
  }
  assert.equal(totalAttemptTime({ ...current, timings: [Number.MAX_SAFE_INTEGER] }, regular, 6000), null);
});
