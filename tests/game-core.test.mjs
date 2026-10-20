import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FIELDS, TIERS, QUESTION_BANK, PRACTICE_BANK,
  dateKey, weekKey, addDays, makeDailySet, makePracticeSet,
  scoreAnswers, getFieldStats, rankTier, weeklyScore,
  calculatePerformance, comparePerformance, weeklyPerformance,
} from '../legacy/v040/game-core.js';

function completed(date, mode = 'daily', correct = true) {
  const questions = mode === 'practice' ? makePracticeSet(date) : makeDailySet(date);
  const answers = questions.map(item => correct ? item.answer : (item.answer + 1) % 4);
  return { date, mode, ...scoreAnswers(questions, answers) };
}

test('KST midnight changes both the daily date and Monday weekly boundary', () => {
  const sunday = dateKey(new Date('2026-10-18T14:59:59.999Z'));
  const monday = dateKey(new Date('2026-10-18T15:00:00.000Z'));
  assert.equal(sunday, '2026-10-18');
  assert.equal(monday, '2026-10-19');
  assert.equal(weekKey(sunday), '2026-10-12');
  assert.equal(weekKey(monday), '2026-10-19');
  assert.equal(dateKey(new Date('2026-12-31T15:00:00Z')), '2027-01-01');
  assert.equal(weekKey('2027-01-01'), '2026-12-28');
});

test('date arithmetic handles month, year, leap-day boundaries and rejects invalid keys', () => {
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.throws(() => addDays('2026-02-30', 1), RangeError);
  assert.throws(() => addDays('2026-10-19', 0.5), RangeError);
  assert.throws(() => makeDailySet('2026-2-3'), RangeError);
  assert.throws(() => dateKey(new Date('invalid')), RangeError);
});

test('each six-day rotation includes each field five times, once at every level', () => {
  for (const firstDate of ['2026-10-17', '2026-12-29', '2028-02-27']) {
    const fieldLevels = new Map(FIELDS.map(field => [field.id, []]));
    for (let day = 0; day < 6; day += 1) {
      const questions = makeDailySet(addDays(firstDate, day));
      assert.equal(questions.length, 5);
      assert.equal(new Set(questions.map(item => item.field)).size, 5);
      assert.deepEqual(questions.map(item => item.level), [1, 2, 3, 4, 5]);
      assert.deepEqual(questions.map(item => item.points), [100, 150, 200, 250, 300]);
      for (const item of questions) fieldLevels.get(item.field).push(item.level);
    }
    for (const levels of fieldLevels.values()) assert.deepEqual(levels.sort(), [1, 2, 3, 4, 5]);
  }
});

test('daily selection and option order are deterministic, while returned values are independent copies', () => {
  const first = makeDailySet('2026-10-19');
  assert.deepEqual(first, makeDailySet('2026-10-19'));
  first[0].options[0] = 'accidental UI mutation';
  assert.notEqual(makeDailySet('2026-10-19')[0].options[0], 'accidental UI mutation');
  for (let day = 0; day < 6; day += 1) {
    const questions = makeDailySet(addDays('2026-10-19', day));
    const visual = questions.find(item => item.visual)?.visual;
    if (visual) {
      visual.cells[0] = 'changed';
      assert.ok(!makeDailySet(addDays('2026-10-19', day)).some(item => item.visual?.cells.includes('changed')));
    }
  }
});

test('every 12 consecutive days use all 60 official source questions exactly once', () => {
  for (const firstDate of ['2026-10-17', '2026-10-19', '2026-12-29', '2028-02-27']) {
    const sources = Array.from({ length: 12 }, (_, day) => makeDailySet(addDays(firstDate, day)))
      .flat().map(item => item.sourceId);
    assert.equal(sources.length, 60);
    assert.equal(new Set(sources).size, 60);
    assert.deepEqual([...sources].sort(), QUESTION_BANK.map(item => item.id).sort());
    const first = makeDailySet(firstDate);
    const nextCycle = makeDailySet(addDays(firstDate, 6));
    assert.ok(first.every((item, index) => item.sourceId !== nextCycle[index].sourceId));
  }
});

test('all curated questions have unique ids, four unique choices, valid answers and memory visuals', () => {
  assert.equal(QUESTION_BANK.length, 60);
  assert.equal(PRACTICE_BANK.length, 12);
  const banks = [...QUESTION_BANK, ...PRACTICE_BANK];
  assert.equal(new Set(banks.map(item => item.id)).size, banks.length);
  assert.equal(new Set(banks.map(item => item.prompt)).size, banks.length);
  for (const item of banks) {
    assert.ok(FIELDS.some(field => field.id === item.field), item.id);
    assert.ok(Number.isInteger(item.level) && item.level >= 1 && item.level <= 5, item.id);
    assert.equal(item.points, [100, 150, 200, 250, 300][item.level - 1], item.id);
    assert.equal(item.options.length, 4, item.id);
    assert.ok(item.options.every(option => typeof option === 'string' && option.trim()), item.id);
    assert.equal(new Set(item.options).size, 4, item.id);
    assert.ok(Number.isInteger(item.answer) && item.answer >= 0 && item.answer <= 3, item.id);
    assert.ok(item.prompt.trim() && item.explanation.trim(), item.id);
    if (item.field === 'memory') {
      assert.equal(item.visual?.type, 'memory', item.id);
      assert.equal(item.visual.cells.length % item.visual.columns, 0, item.id);
      assert.ok(item.visual.columns >= 2 && item.visual.columns <= 4, item.id);
      assert.ok(item.visual.seconds >= 4 && item.visual.seconds <= 7, item.id);
      assert.ok(item.visual.cells.every(cell => typeof cell === 'string'), item.id);
    } else assert.equal(item.visual, undefined, item.id);
  }
  for (const field of FIELDS) {
    for (let level = 1; level <= 5; level += 1) {
      assert.equal(QUESTION_BANK.filter(item => item.field === field.id && item.level === level).length, 2);
    }
  }
});

test('curated numerical, observation, rotation and logic answers have independent checks', () => {
  const answer = id => {
    const item = [...QUESTION_BANK, ...PRACTICE_BANK].find(question => question.id === id);
    return item.options[item.answer];
  };
  assert.equal(answer('math-4-a'), `${(20000 * 0.8 * 0.9).toLocaleString('en-US')}원`);
  assert.equal(answer('math-5-b'), `${Array.from({ length: 60 }, (_, i) => i + 1).filter(n => n % 3 === 0 || n % 5 === 0).length}개`);
  assert.equal(answer('practice-math-b'), `${Array.from({ length: 40 }, (_, i) => i + 1).filter(n => n % 4 === 0 || n % 6 === 0).length}개`);
  assert.equal(answer('observation-2-a'), `${[...'7141717114'].filter(char => char === '1').length}번`);
  assert.equal(answer('practice-observation-a'), `${[...'606166206'].filter(char => char === '6').length}번`);
  const overlaps = (value, fragment) => Array.from({ length: value.length }, (_, index) => value.startsWith(fragment, index)).filter(Boolean).length;
  assert.equal(answer('observation-4-a'), `${overlaps('ABABAABABA', 'ABA')}번`);
  assert.equal(answer('observation-5-a'), `${overlaps('12121211212', '121')}번`);
  assert.equal(answer('practice-observation-b'), `${overlaps('XYXYXXYXYX', 'XYX')}번`);
  const solutions = ['A', 'B', 'C', 'D'].filter(box => [
    ['A', 'B'].includes(box), ['B', 'C'].includes(box), ['C', 'D'].includes(box), box !== 'A',
  ].filter(Boolean).length === 1);
  assert.deepEqual(solutions, ['A']);
  assert.equal(answer('logic-5-a'), `${solutions[0]} 상자`);
  const switched = [];
  for (let mask = 0; mask < 16; mask += 1) {
    const [a, b, c, d] = [1, 2, 4, 8].map(bit => Boolean(mask & bit));
    if ([a, b, c, d].filter(Boolean).length === 2 && (!a || b) && (!b || c) && (!d || a)) switched.push([a, b, c, d]);
  }
  assert.deepEqual(switched, [[false, true, true, false]]);
  assert.equal(answer('logic-5-b'), 'B와 C');
});

test('shuffled answers still score correctly and invalid selections earn no credit', () => {
  for (let day = 0; day < 18; day += 1) {
    const questions = makeDailySet(addDays('2026-10-19', day));
    const result = scoreAnswers(questions, questions.map(item => item.answer));
    assert.equal(result.score, 5000);
    assert.equal(result.correct, 5);
    assert.equal(result.total, 5);
    for (const item of questions) {
      const original = QUESTION_BANK.find(source => source.id === item.sourceId);
      assert.equal(item.options[item.answer], original.options[original.answer]);
    }
  }
  const questions = makeDailySet('2026-10-19');
  const partial = scoreAnswers(questions, questions.map((item, index) => index ? item.answer : (item.answer + 1) % 4));
  assert.equal(partial.score, 4000);
  assert.equal(partial.correct, 4);
  const invalid = scoreAnswers(questions, [undefined, -1, 4, '0', NaN]);
  assert.equal(invalid.score, 0);
  assert.equal(invalid.correct, 0);
  assert.ok(invalid.details.every(item => item.selected === null));
  assert.equal(scoreAnswers(questions).score, 0);
});

test('practice uses only its separate bank, including against all future official content', () => {
  const officialIds = new Set(QUESTION_BANK.map(item => item.id));
  const officialPrompts = new Set(QUESTION_BANK.map(item => item.prompt));
  const practiceIds = new Set(PRACTICE_BANK.map(item => item.id));
  for (let seed = 0; seed < 24; seed += 1) {
    const questions = makePracticeSet('2026-10-19', seed);
    assert.equal(questions.length, 5);
    assert.equal(new Set(questions.map(item => item.field)).size, 5);
    assert.deepEqual(questions, makePracticeSet('2026-10-19', seed));
    for (const item of questions) {
      assert.ok(practiceIds.has(item.sourceId));
      assert.ok(!officialIds.has(item.sourceId));
      assert.ok(!officialPrompts.has(item.prompt));
      assert.match(item.id, new RegExp(`^practice:2026-10-19:${seed}:`));
      const source = PRACTICE_BANK.find(question => question.id === item.sourceId);
      assert.equal(item.options[item.answer], source.options[source.answer]);
    }
  }
  const firstIds = new Set(makePracticeSet('2026-10-19', 0).map(item => item.id));
  assert.ok(makePracticeSet('2026-10-19', 1).every(item => !firstIds.has(item.id)));
  assert.throws(() => makePracticeSet('2026-10-19', -1), RangeError);
});

test('weekly score counts the first complete official result per day, excluding practice and other weeks', () => {
  const results = [
    completed('2026-10-18'),
    completed('2026-10-19', 'practice'),
    completed('2026-10-19', 'daily', false),
    completed('2026-10-19', 'daily', true),
    completed('2026-10-20'),
    completed('2026-10-25'),
    completed('2026-10-26'),
  ];
  assert.equal(weeklyScore(results, '2026-10-19'), 10000);
  assert.equal(weeklyScore(results, '2026-10-12'), 5000);
  assert.equal(weeklyScore(results, '2026-10-26'), 5000);
  assert.throws(() => weeklyScore(results, '2026-10-20'), RangeError);
  const malformed = { ...completed('2026-10-21'), total: 4 };
  assert.equal(weeklyScore([malformed, completed('2026-10-21')], '2026-10-19'), 5000);
  assert.equal(weeklyScore([{ ...completed('2026-10-21'), date: '2026-02-30' }], '2026-10-19'), 0);
  assert.equal(weeklyScore(null, '2026-10-19'), 0);
});

function timedResult(date, correctCount = 5, totalTimeMs = 120000) {
  const questions = makeDailySet(date, 'test-player');
  const answers = questions.map((item, i) => i < correctCount ? item.answer : (item.answer + 1) % 4);
  return { date, mode: 'daily', ...scoreAnswers(questions, answers, Array(5).fill(totalTimeMs / 5)) };
}

function legacyResult(date, correctCount = 5) {
  const questions = makeDailySet(date);
  const scored = scoreAnswers(questions, questions.map((item, i) => i < correctCount ? item.answer : (item.answer + 1) % 4));
  return {
    date, mode: 'daily', total: 5, correct: correctCount,
    score: questions.reduce((sum, item, i) => sum + (i < correctCount ? item.points : 0), 0),
    details: scored.details.map(({ elapsedMs, ...detail }, i) => ({ ...detail, points: questions[i].points })),
  };
}

test('new scoring gives 1000 points per correct answer and caps the entire speed bonus at 99', () => {
  assert.deepEqual(calculatePerformance(4, 120000), {
    correct: 4, baseScore: 4000, speedBonus: 49.5, score: 4049.5, totalTimeMs: 120000, timingComplete: true,
  });
  assert.equal(calculatePerformance(4, 0).score, 4099);
  assert.equal(calculatePerformance(5, 0).score, 5099);
  assert.equal(calculatePerformance(4, 60000).speedBonus, 66);
  assert.equal(calculatePerformance(4, 240000).speedBonus, 33);
  for (let correct = 0; correct < 35; correct += 1) {
    assert.ok(calculatePerformance(correct + 1, 1e12).score > calculatePerformance(correct, 0).score);
  }
  assert.equal(calculatePerformance(0, 0).score, 0);
  assert.equal(calculatePerformance(0, 1).speedBonus, 0);
  for (const time of [null, undefined, -1, Infinity, NaN, '1000']) {
    assert.deepEqual(calculatePerformance(4, time), {
      correct: 4, baseScore: 4000, speedBonus: 0, score: 4000, totalTimeMs: null, timingComplete: false,
    });
  }
  for (const count of [-1, 0.5, Infinity, NaN, '4']) assert.throws(() => calculatePerformance(count, 1000), RangeError);
});

test('timing includes all five answers, including incorrect answers, and missing time earns no speed bonus', () => {
  const questions = makeDailySet('2026-10-19', 'timer-player');
  const answers = questions.map((item, i) => i < 4 ? item.answer : (item.answer + 1) % 4);
  const times = [10000, 20000, 30000, 40000, 20000];
  const result = scoreAnswers(questions, answers, times);
  assert.equal(result.scoringVersion, 2);
  assert.equal(result.correct, 4);
  assert.equal(result.score, 4049.5);
  assert.equal(result.totalTimeMs, 120000);
  assert.equal(result.timingComplete, true);
  assert.deepEqual(result.details.map(detail => detail.elapsedMs), times);
  assert.ok(result.details.every(detail => detail.points === 1000));
  for (const incomplete of [[], times.slice(0, 4), [...times, 1], [10000, null, 10000, 10000, 10000], [10000, -1, 10000, 10000, 10000]]) {
    const untimed = scoreAnswers(questions, answers, incomplete);
    assert.equal(untimed.score, 4000);
    assert.equal(untimed.totalTimeMs, null);
    assert.equal(untimed.timingComplete, false);
  }
  const wrong = scoreAnswers(questions, questions.map(item => (item.answer + 1) % 4), times);
  assert.equal(wrong.score, 0);
  assert.equal(wrong.totalTimeMs, 120000);
});

test('weekly performance totals correct answers and time, applying the speed bonus only once', () => {
  const a = timedResult('2026-10-19', 2, 120000), b = timedResult('2026-10-20', 2, 120000);
  const result = weeklyPerformance([a, b], '2026-10-19');
  assert.deepEqual(result, { ...calculatePerformance(4, 240000), playedDays: 2 });
  assert.equal(result.score, 4033);
  assert.notEqual(result.score, a.score + b.score);
  const equal = weeklyPerformance([timedResult('2026-10-19', 4, 240000)], '2026-10-19');
  assert.equal(comparePerformance(result, equal), 0);
  const faster = weeklyPerformance([timedResult('2026-10-19', 4, 120000)], '2026-10-19');
  assert.ok(comparePerformance(faster, result) < 0);
  assert.equal(weeklyScore([a, b], '2026-10-19'), result.score);
  assert.deepEqual(weeklyPerformance([], '2026-10-19'), { ...calculatePerformance(0, null), playedDays: 0 });
  const perfectWeek = Array.from({ length: 7 }, (_, i) => timedResult(addDays('2026-10-19', i), 5, 0));
  assert.equal(weeklyScore(perfectWeek, '2026-10-19'), 35099);
});

test('a legacy untimed result preserves its record and radar, and removes weekly speed bonus until a fully timed week', () => {
  const legacy = legacyResult('2026-10-19', 4);
  const before = JSON.stringify(legacy);
  const modern = timedResult('2026-10-20', 3, 120000);
  const performance = weeklyPerformance([legacy, modern], '2026-10-19');
  assert.equal(performance.correct, 7);
  assert.equal(performance.baseScore, 7000);
  assert.equal(performance.speedBonus, 0);
  assert.equal(performance.totalTimeMs, null);
  assert.equal(performance.playedDays, 2);
  assert.equal(JSON.stringify(legacy), before);
  assert.equal(legacy.score, 700);
  const stats = getFieldStats([legacy, modern], '2026-10-20');
  assert.equal(stats.reduce((sum, item) => sum + item.correct, 0), 7);
  assert.equal(stats.reduce((sum, item) => sum + item.total, 0), 10);
});

test('same displayed score uses exact elapsed time, while exact ties and zero-correct results share rank', () => {
  const faster = calculatePerformance(4, 100001), slower = calculatePerformance(4, 100002);
  assert.equal(faster.score, slower.score);
  assert.ok(comparePerformance(faster, slower) < 0);
  assert.ok(comparePerformance(slower, faster) > 0);
  assert.equal(comparePerformance(faster, { ...faster }), 0);
  assert.equal(comparePerformance(calculatePerformance(0, 1), calculatePerformance(0, 999999)), 0);
  assert.equal(comparePerformance(calculatePerformance(0, null), calculatePerformance(0, 1)), 0);
  assert.equal(comparePerformance(calculatePerformance(4, null), calculatePerformance(4, null)), 0);
  assert.ok(comparePerformance(calculatePerformance(4, 1e15), calculatePerformance(4, null)) < 0);
});

test('official totals ignore malformed scores, duplicate fields and inconsistent correct counts', () => {
  const result = timedResult('2026-10-19');
  const malformed = [
    { ...result, score: 5100 }, { ...result, correct: 4 },
    { ...result, details: result.details.map(detail => ({ ...detail, field: 'logic' })) },
    { ...result, details: [{ ...result.details[0], correct: 'yes' }, ...result.details.slice(1)] },
  ];
  for (const invalid of malformed) {
    assert.equal(weeklyScore([invalid], '2026-10-19'), 0);
    assert.equal(getFieldStats([invalid], '2026-10-19').reduce((sum, item) => sum + item.total, 0), 0);
  }
});

test('profile radar covers exactly the last 28 KST dates and only official first attempts', () => {
  const today = '2026-10-19';
  const last28 = Array.from({ length: 28 }, (_, day) => completed(addDays(today, -day)));
  const excluded = [
    completed(addDays(today, -28)),
    completed(addDays(today, 1)),
    completed(today, 'practice'),
    completed(today, 'daily', false),
  ];
  const stats = getFieldStats([...last28, ...excluded], today);
  assert.equal(stats.reduce((sum, field) => sum + field.total, 0), 140);
  assert.equal(stats.reduce((sum, field) => sum + field.correct, 0), 140);
  assert.ok(stats.every(field => field.accuracy === 100));
  assert.ok(stats.every(field => field.total === 23 || field.total === 24));
  const firstWrong = getFieldStats([completed(today, 'daily', false), completed(today)], today);
  assert.equal(firstWrong.reduce((sum, field) => sum + field.correct, 0), 0);
  assert.equal(firstWrong.reduce((sum, field) => sum + field.total, 0), 5);
  assert.equal(firstWrong.filter(field => field.accuracy === null).length, 1);
  assert.ok(getFieldStats([completed(today, 'practice')], today).every(field => field.total === 0 && field.accuracy === null));
});

test('inclusive rank cutoffs are deterministic for ties and invalid/unranked players return null', () => {
  assert.deepEqual(TIERS.map(tier => tier.id), ['amber', 'jade', 'sapphire', 'ruby', 'diamond', 'aurora']);
  const examples = [
    [1, 'aurora'], [10, 'aurora'], [11, 'diamond'], [30, 'diamond'],
    [31, 'ruby'], [80, 'ruby'], [100, 'ruby'], [101, 'sapphire'],
    [300, 'sapphire'], [301, 'jade'], [600, 'jade'], [601, 'amber'], [1000, 'amber'],
  ];
  for (const [rank, tier] of examples) assert.equal(rankTier(rank, 1000).id, tier);
  assert.equal(rankTier(80, 1000), rankTier(80, 1000));
  assert.equal(rankTier(80, 1000).reward, rankTier(80, 1000).reward);
  assert.equal(rankTier(0, 1000), null);
  assert.equal(rankTier(1, 0), null);
  assert.equal(rankTier(1001, 1000), null);
  assert.equal(rankTier(NaN, 1000), null);
});
