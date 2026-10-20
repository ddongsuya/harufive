// Wall-clock timing survives reloads and time spent away from the question.
// This local play-test module does not make client timestamps trustworthy.

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isTimestamp = value => Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const isIndex = value => Number.isSafeInteger(value) && value >= 0;
const isMemory = question => question?.visual?.type === 'memory';
const isTimed = active => active?.timingVersion === 1;
const memoryUntil = active => active?.memory?.[active.index]?.until;
const hasTiming = active => Array.isArray(active?.timings) && own(active.timings, active.index);

function duration(value) {
  return isTimestamp(value) ? Math.floor(value) : null;
}

function validClock(clock) {
  return !!clock && typeof clock === 'object' && !Array.isArray(clock)
    && isIndex(clock.index) && isTimestamp(clock.startedAt);
}

function invalidateClock(active) {
  const timings = Array.isArray(active.timings) ? [...active.timings] : [];
  // A present null distinguishes a damaged timer from a question not yet shown.
  // It prevents a later render from starting a replacement clock for this item.
  timings[active.index] = null;
  return { ...active, timings, clock: null };
}

/** Start once, immediately before displaying a question. Never mutate active. */
export function ensureQuestionClock(active, question, now = Date.now()) {
  if (!isTimed(active) || !isIndex(active.index) || !question || hasTiming(active)) return active;

  const memory = isMemory(question);
  const until = memoryUntil(active);
  if (active.clock != null) {
    if (!validClock(active.clock)) return invalidateClock(active);
    if (active.clock.index === active.index) {
      if (memory && (!isTimestamp(until) || active.clock.startedAt !== until)) return invalidateClock(active);
      return active;
    }
  }

  // Memory preparation and the fixed exposure period are excluded. Saving the
  // future deadline now also counts time spent away after the array disappears.
  if (memory && !isTimestamp(until)) return active;
  const startedAt = memory ? until : now;
  if (!isTimestamp(startedAt)) return invalidateClock(active);
  return { ...active, clock: { index: active.index, startedAt } };
}

/**
 * ready controls submission; valid says whether elapsedMs can earn time credit.
 * Legacy attempts stay playable but never acquire a measured time retroactively.
 */
export function questionElapsed(active, question, now = Date.now()) {
  if (!active || !isIndex(active.index) || !question) return { elapsedMs: null, ready: false, valid: false };

  const memory = isMemory(question);
  const until = memoryUntil(active);
  const timed = isTimed(active);
  const clock = active.clock;
  const clockMatches = validClock(clock) && clock.index === active.index
    && (!memory || (isTimestamp(until) && clock.startedAt === until));

  if (memory && (!isTimestamp(until) || !isTimestamp(now) || now < until)) {
    return { elapsedMs: timed ? 0 : null, ready: false, valid: timed && clockMatches && isTimestamp(now) };
  }
  if (!timed) return { elapsedMs: null, ready: true, valid: false };

  // A stored current value is used only between recordAnswerTime and index++.
  // A null current value is also the persisted marker for an invalid clock.
  if (hasTiming(active)) {
    const elapsedMs = duration(active.timings[active.index]);
    return { elapsedMs, ready: true, valid: elapsedMs !== null };
  }
  if (!clockMatches || !isTimestamp(now) || now < clock.startedAt) {
    return { elapsedMs: null, ready: true, valid: false };
  }
  return { elapsedMs: duration(now - clock.startedAt), ready: true, valid: true };
}

/** Record this item only; the caller advances index and writes the chosen answer. */
export function recordAnswerTime(active, question, now = Date.now()) {
  const measured = questionElapsed(active, question, now);
  if (!measured.ready) throw new Error('문제가 준비된 뒤 답을 제출해 주세요.');
  const elapsedMs = measured.valid ? duration(measured.elapsedMs) : null;
  const timings = Array.isArray(active.timings) ? [...active.timings] : [];
  timings[active.index] = elapsedMs;
  return { active: { ...active, timings, clock: null }, elapsedMs };
}

/** Previous submitted items plus the current item; an unmeasured item yields null. */
export function totalAttemptTime(active, question, now = Date.now()) {
  if (!isTimed(active) || !isIndex(active.index)) return null;
  let total = 0;
  for (let index = 0; index < active.index; index++) {
    const elapsedMs = duration(active.timings?.[index]);
    if (elapsedMs === null || !Number.isSafeInteger(total + elapsedMs)) return null;
    total += elapsedMs;
  }
  const current = questionElapsed(active, question, now);
  if (!current.valid || current.elapsedMs === null || !Number.isSafeInteger(total + current.elapsedMs)) return null;
  return total + current.elapsedMs;
}
