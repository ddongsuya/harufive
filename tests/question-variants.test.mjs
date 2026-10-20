import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQuestion } from '../legacy/v040/question-variants.js';
import { FIELDS, QUESTION_BANK, addDays, makeDailySet, makePreviewSet } from '../legacy/v040/game-core.js';

const directions = ['북쪽', '동쪽', '남쪽', '서쪽'];
const arrows = ['↑', '→', '↓', '←'];
const antonyms = new Map([
  ['높다', '낮다'], ['길다', '짧다'], ['뜨겁다', '차갑다'], ['빠르다', '느리다'],
  ['밝다', '어둡다'], ['무겁다', '가볍다'], ['넓다', '좁다'], ['두껍다', '얇다'],
  ['깊다', '얕다'], ['멀다', '가깝다'], ['많다', '적다'], ['젖다', '마르다'],
].flatMap(([a, b]) => [[a, b], [b, a]]));
const join = values => values.join(' · ');
const coordinate = (row, col) => `${row + 1}행 ${col + 1}열`;
const numberIn = option => Number(option.replaceAll(',', '').replace(/(?:개|원|번|곳)$/, ''));
function permutations(values) {
  if (values.length <= 1) return [values];
  return values.flatMap((value, index) => permutations(values.filter((_, i) => i !== index)).map(rest => [value, ...rest]));
}
function unique(values, label) { assert.equal(values.length, 1, label); return values[0]; }

/** Independent solvers enumerate models, transform grids, or inspect displayed data. */
function independentlySolve(question) {
  const s = question.solution;
  switch (s.kind) {
    case 'line-order': {
      const solutions = permutations(s.names).filter(order => s.constraints.every(([a, b]) => order.indexOf(a) < order.indexOf(b)));
      return unique(solutions, question.id)[s.target];
    }
    case 'fixed-line': {
      const solutions = permutations(s.names).filter(order => order[0] === s.first && order.at(-1) === s.last && order.indexOf(s.adjacent[1]) - order.indexOf(s.adjacent[0]) === 1);
      return `${unique(solutions, question.id)[s.target]} 카드`;
    }
    case 'contrapositive': {
      // All models in which the rule holds and no sticker was received.
      const possible = s.alternatives.filter(chosen => chosen !== s.cause);
      return unique(s.alternatives.filter(option => !possible.includes(option)), question.id);
    }
    case 'number-assignment': {
      const solutions = permutations(s.values).filter(v => v[0] + v[1] === s.sum1 && v[1] + v[2] === s.sum2 && v[0] < v[3]);
      return String(unique(solutions, question.id)[s.target]);
    }
    case 'truth-count': {
      const candidates = s.boxes.filter(box => s.statements.map(statement => statement.includes(box)).filter(Boolean).length === s.trueCount);
      return unique(candidates, question.id);
    }
    case 'sum': return String([...Array(s.a), ...Array(s.b)].length);
    case 'share-remainder': return unique(question.options.filter(option => numberIn(option) * s.people + s.removed === s.initial), question.id);
    case 'inverse-equation': return unique(question.options.filter(option => numberIn(option) * s.multiplier + s.added === s.total), question.id);
    case 'double-discount': return unique(question.options.filter(option => numberIn(option) * 10000 === s.price * (100 - s.first) * (100 - s.second)), question.id);
    case 'multiples-union': {
      const count = Array.from({ length: s.limit }, (_, i) => i + 1).filter(n => s.divisors.some(divisor => n % divisor === 0)).length;
      return `${count}개`;
    }
    case 'direction-turns': {
      const vectors = [[0, -1], [1, 0], [0, 1], [-1, 0]];
      let [x, y] = vectors[s.start];
      for (const turn of s.turns) for (let i = 0; i < Math.abs(turn); i += 1) {
        [x, y] = turn > 0 ? [-y, x] : [y, -x];
      }
      return directions[vectors.findIndex(([a, b]) => a === x && b === y)];
    }
    case 'arrows-rotate-reverse': {
      const rotation = s.turn > 0 ? { '↑': '→', '→': '↓', '↓': '←', '←': '↑' } : { '↑': '←', '←': '↓', '↓': '→', '→': '↑' };
      return join(s.original.map(index => rotation[arrows[index]]).reverse());
    }
    case 'grid-transform': {
      const grid = Array.from({ length: s.size }, (_, row) => Array.from({ length: s.size }, (_, col) => row === s.row && col === s.column));
      const rotated = Array.from({ length: s.size }, (_, row) => Array.from({ length: s.size }, (_, col) => grid[s.size - 1 - col][row]));
      const mirrored = rotated.map(row => row.reverse());
      const row = mirrored.findIndex(values => values.some(Boolean));
      return coordinate(row, mirrored[row].indexOf(true));
    }
    case 'painted-cuboid': {
      const [width, depth, height] = s.dimensions;
      let count = 0;
      for (let x = 0; x < width; x += 1) for (let y = 0; y < depth; y += 1) for (let z = 0; z < height; z += 1) {
        const paint = [x === 0, x === width - 1, y === 0, y === depth - 1, z === 0, z === height - 1].filter(Boolean).length;
        if (paint === s.paintedFaces) count += 1;
      }
      return `${count}개`;
    }
    case 'antonym': return antonyms.get(s.word);
    case 'word-chain': {
      assert.equal(s.given[0].at(-1), s.given[1][0]);
      return unique(question.options.filter(option => option[0] === s.given.at(-1).at(-1)), question.id);
    }
    case 'arrival-order': {
      const times = { [s.a]: s.first ? 1 : 2, [s.b]: s.first ? 2 : 1 };
      return unique(question.options.filter(option => {
        const match = /^(.+?)(?:은|는) (.+?)보다 (먼저|늦게) 도착했다\.$/.exec(option);
        if (!match) return false;
        return match[3] === '먼저' ? times[match[1]] < times[match[2]] : times[match[1]] > times[match[2]];
      }), question.id);
    }
    case 'not-all': {
      const truth = (meaning, n, done) => ({ 'some-not': done < n, none: done === 0, all: done === n, one: done === 1 })[meaning];
      const worlds = Array.from({ length: 5 }, (_, i) => i + 1).flatMap(n => Array.from({ length: n + 1 }, (_, done) => ({ n, done })));
      return unique(question.options.filter(option => worlds.every(({ n, done }) => truth(s.meanings[option], n, done) === (done < n))), question.id);
    }
    case 'container-quantifiers': {
      const worlds = [];
      for (let code = 0; code < 64; code += 1) {
        const boxes = [0, 1, 2].map(i => ({ filled: Boolean((code >> (i * 2)) & 1), color: Boolean((code >> (i * 2 + 1)) & 1) }));
        if (boxes.some(box => box.filled) && boxes.filter(box => box.color).every(box => !box.filled)) worlds.push(boxes);
      }
      const truth = (meaning, boxes) => ({
        'some-filled-noncolor': boxes.some(box => box.filled && !box.color) && boxes.filter(box => box.filled).every(box => !box.color),
        'some-filled-color': boxes.some(box => box.filled && box.color),
        'all-noncolor-filled': boxes.filter(box => !box.color).every(box => box.filled),
        'all-empty': boxes.every(box => !box.filled),
      })[meaning];
      return unique(question.options.filter(option => worlds.every(boxes => truth(s.meanings[option], boxes))), question.id);
    }
    case 'memory-cells': return question.visual.cells[s.indices[0]];
    case 'memory-neighbor': {
      const { cells, columns } = question.visual;
      const grid = Array.from({ length: cells.length / columns }, (_, row) => cells.slice(row * columns, row * columns + columns));
      const row = Math.floor(s.anchor / columns), col = s.anchor % columns;
      return grid[row + (s.direction === 'below' ? 1 : -1)][col];
    }
    case 'memory-row': {
      const { cells, columns } = question.visual;
      return join(cells.filter((_, index) => Math.floor(index / columns) === s.row));
    }
    case 'memory-vertical-pair': {
      const { cells, columns } = question.visual;
      const column = s.anchor % columns, row = Math.floor(s.anchor / columns);
      const sameColumn = cells.filter((_, index) => index % columns === column);
      return join([sameColumn[row - 1], sameColumn[row + 1]]);
    }
    case 'memory-corners': {
      const { cells, columns } = question.visual, rows = cells.length / columns;
      const grid = Array.from({ length: rows }, (_, row) => cells.slice(row * columns, row * columns + columns));
      return join(s.clockwise ? [grid[0][0], grid[0].at(-1), grid.at(-1).at(-1), grid.at(-1)[0]] : [grid[0][0], grid.at(-1)[0], grid.at(-1).at(-1), grid[0].at(-1)]);
    }
    case 'symbol-count': return `${s.cells.filter(value => value === s.target).length}개`;
    case 'exact-match': return s.code;
    case 'cycle-next': {
      const repeated = [...s.pattern, ...s.pattern, ...s.pattern, ...s.pattern];
      assert.equal(new Set(s.pattern).size, 4);
      return join(repeated.slice(s.length, s.length + 2));
    }
    case 'overlap-count': return `${[...s.text.matchAll(new RegExp(`(?=${s.fragment})`, 'g'))].length}번`;
    case 'grid-neighbors': {
      const grid = Array.from({ length: s.size }, (_, row) => s.cells.slice(row * s.size, row * s.size + s.size));
      const matches = grid.flatMap((row, y) => row.map((value, x) => value === s.target && row[x + 1] === s.right && grid[y + 1]?.[x] === s.below));
      return `${matches.filter(Boolean).length}곳`;
    }
    default: throw new Error(`Unverified template kind ${s.kind}`);
  }
}

test('all 30 templates have one independently verified answer across 2400 generated samples', () => {
  const templateIds = new Set(), kinds = new Set();
  for (const field of FIELDS) for (let level = 1; level <= 5; level += 1) for (let sample = 0; sample < 80; sample += 1) {
    const question = generateQuestion(field.id, level, `verification:${sample}`);
    assert.equal(question.field, field.id);
    assert.equal(question.level, level);
    assert.equal(question.questionVersion, 2);
    assert.equal(question.points, 1000);
    assert.equal(question.options.length, 4, question.id);
    assert.equal(new Set(question.options).size, 4, question.id);
    assert.ok(question.options.every(option => typeof option === 'string' && option.trim()), question.id);
    assert.ok(question.answer >= 0 && question.answer < 4, question.id);
    assert.ok(question.prompt.trim() && question.explanation.trim(), question.id);
    assert.equal(question.options[question.answer], independentlySolve(question), question.id);
    if (field.id === 'memory') {
      const visual = question.visual;
      assert.equal(visual.type, 'memory');
      assert.equal(visual.cells.length % visual.columns, 0);
      assert.equal(new Set(visual.cells).size, visual.cells.length);
      assert.ok(visual.seconds >= 4 && visual.seconds <= 7);
    } else assert.equal(question.visual, undefined);
    templateIds.add(question.templateId); kinds.add(question.solution.kind);
  }
  assert.equal(templateIds.size, 30);
  assert.equal(kinds.size, 29); // spatial levels 1 and 2 share a direction solver.
});

test('player-specific official sets change actual problem data and stay stable for a player/date', () => {
  for (let day = 0; day < 12; day += 1) {
    const key = addDays('2026-10-19', day), expectedFields = makeDailySet(key).map(question => question.field);
    const content = new Set();
    for (let player = 0; player < 20; player += 1) {
      const id = `player-${player}`, questions = makeDailySet(key, id);
      assert.deepEqual(questions, makeDailySet(key, id));
      assert.deepEqual(questions.map(question => question.field), expectedFields);
      assert.deepEqual(questions.map(question => question.level), [1, 2, 3, 4, 5]);
      assert.ok(questions.every(question => question.points === 1000 && question.questionVersion === 2));
      assert.deepEqual(questions.map(question => question.templateId), makeDailySet(key, 'player-0').map(question => question.templateId));
      // Intentionally omit IDs and answer-option order: this proves substantive variation.
      content.add(JSON.stringify(questions.map(question => ({ prompt: question.prompt, visual: question.visual || null }))));
    }
    assert.equal(content.size, 20, key);
  }
});

test('each generated template varies its actual wording or arrangement across players', () => {
  for (const field of FIELDS) for (let level = 1; level <= 5; level += 1) {
    const content = new Set(Array.from({ length: 40 }, (_, i) => {
      const question = generateQuestion(field.id, level, `variation-player:${i}`);
      return JSON.stringify({ prompt: question.prompt, visual: question.visual || null });
    }));
    assert.ok(content.size >= 10, `${field.id}/${level}: ${content.size} actual variants`);
  }
});

test('same official date cannot be rerolled, while each preview round has different unranked problem content', () => {
  const player = 'preview-player', key = '2026-10-19';
  const official = makeDailySet(key, player);
  const content = new Set();
  for (let round = 0; round < 30; round += 1) {
    const questions = makePreviewSet(key, player, round);
    assert.deepEqual(questions, makePreviewSet(key, player, round));
    assert.deepEqual(questions.map(question => question.field), official.map(question => question.field));
    assert.ok(questions.every(question => question.id.startsWith('preview:v2:')));
    content.add(JSON.stringify(questions.map(question => ({ prompt: question.prompt, visual: question.visual || null }))));
    assert.notDeepEqual(questions.map(question => question.id), official.map(question => question.id));
  }
  assert.equal(content.size, 30);
  assert.deepEqual(makeDailySet(key, player), official);
  assert.throws(() => makePreviewSet(key, player, -1), RangeError);
  assert.throws(() => makePreviewSet(key, player, 0.5), RangeError);
});

test('no-ID calls preserve legacy bank identities and answer order, with independent generated objects', () => {
  const key = '2026-10-19';
  assert.deepEqual(makeDailySet(key), makeDailySet(key, undefined));
  assert.deepEqual(makeDailySet(key), makeDailySet(key, null));
  for (const question of makeDailySet(key)) {
    const source = QUESTION_BANK.find(item => item.id === question.sourceId);
    assert.ok(source);
    assert.equal(question.options[question.answer], source.options[source.answer]);
    assert.equal(question.questionVersion, undefined);
  }
  const questions = makeDailySet(key, 'copy-test');
  questions[0].options[0] = 'changed option';
  questions[0].solution.changed = true;
  const memoryQuestion = questions.find(question => question.visual);
  if (memoryQuestion) memoryQuestion.visual.cells[0] = 'changed memory';
  const again = makeDailySet(key, 'copy-test');
  assert.ok(again.every(question => !question.options.includes('changed option') && !question.solution.changed && !question.visual?.cells.includes('changed memory')));
  assert.throws(() => makeDailySet(key, ''), TypeError);
  assert.throws(() => makeDailySet(key, 123), TypeError);
  assert.throws(() => generateQuestion('unknown', 1, 'seed'), RangeError);
  assert.throws(() => generateQuestion('math', 0, 'seed'), RangeError);
});
