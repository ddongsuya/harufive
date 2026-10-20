/**
 * Version 2 question templates. A player/date seed changes the operands,
 * conditions, words and arrangements, not just the answer order. The same
 * field/level always uses the same template structure for every player.
 * These finite, reviewed templates are not psychometrically calibrated and
 * cannot guarantee that no two people anywhere ever receive matching content.
 * Solution metadata supports deterministic, independent content verification.
 */

const FIELD_IDS = ['logic', 'math', 'spatial', 'language', 'memory', 'observation'];
const NAMES = ['가람', '나리', '다온', '라온', '마루', '보라', '소미', '아라', '유나', '지수', '하늘', '민수', '서준', '예나', '도윤', '채린'];
const COLORS = ['빨간색', '파란색', '노란색', '초록색', '보라색', '주황색', '분홍색', '하얀색'];
const WORDS = ['사과', '달', '별', '꽃', '나비', '책', '연필', '구름', '나무', '기차', '시계', '모자', '우산', '풍선', '열쇠', '수박', '토끼', '종', '컵', '배', '새', '콩', '산', '강', '집', '불', '눈', '잎', '바다', '딸기', '지도', '상자'];
const SYMBOLS = ['●', '▲', '■', '◆', '★', '○', '△', '□'];
const DIRECTIONS = ['북쪽', '동쪽', '남쪽', '서쪽'];
const ARROWS = ['↑', '→', '↓', '←'];
const ANTONYMS = [
  ['높다', '낮다'], ['길다', '짧다'], ['뜨겁다', '차갑다'], ['빠르다', '느리다'],
  ['밝다', '어둡다'], ['무겁다', '가볍다'], ['넓다', '좁다'], ['두껍다', '얇다'],
  ['깊다', '얕다'], ['멀다', '가깝다'], ['많다', '적다'], ['젖다', '마르다'],
];
const WORD_CHAINS = [
  ['나무', '무지개', '개미'], ['바다', '다리', '리본'], ['우유', '유리', '리본'],
  ['사과', '과자', '자동차'], ['기차', '차표', '표범'], ['하마', '마차', '차표'],
  ['나비', '비누', '누룽지'], ['모자', '자두', '두부'], ['토끼', '끼니', '니트'],
  ['시계', '계단', '단풍'], ['풍선', '선물', '물감'], ['연필', '필통', '통나무'],
  ['호수', '수박', '박수'], ['소금', '금붕어', '어항'], ['구두', '두루미', '미로'],
  ['오이', '이불', '불꽃'], ['코끼리', '리본', '본보기'],
];
const ACTIONS = [
  { past: '책을 빌렸다', done: '책을 빌린', notDone: '책을 빌리지 않은' },
  { past: '꽃을 심었다', done: '꽃을 심은', notDone: '꽃을 심지 않은' },
  { past: '표를 냈다', done: '표를 낸', notDone: '표를 내지 않은' },
  { past: '편지를 썼다', done: '편지를 쓴', notDone: '편지를 쓰지 않은' },
  { past: '사진을 찍었다', done: '사진을 찍은', notDone: '사진을 찍지 않은' },
  { past: '그림을 그렸다', done: '그림을 그린', notDone: '그림을 그리지 않은' },
];

function mod(value, base) { return ((value % base) + base) % base; }
function hash(value) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i += 1) result = Math.imul(result ^ value.charCodeAt(i), 16777619);
  return result >>> 0;
}
function randomFor(seed) {
  let state = hash(seed);
  const random = () => {
    state += 0x6D2B79F5;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    int(min, max) { return min + Math.floor(random() * (max - min + 1)); },
    pick(values) { return values[Math.floor(random() * values.length)]; },
    shuffle(values) {
      const result = [...values];
      for (let i = result.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      return result;
    },
  };
}
function particle(word, withFinal, withoutFinal) {
  const code = word.charCodeAt(word.length - 1) - 0xAC00;
  return word + (code >= 0 && code <= 11171 && code % 28 ? withFinal : withoutFinal);
}
function topic(word) { return particle(word, '은', '는'); }
function subject(word) { return particle(word, '이', '가'); }
function fmt(value) { return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function coord(row, column) { return `${row + 1}행 ${column + 1}열`; }
function sequence(values) { return values.join(' · '); }
function numeric(answer, unit, random, step = 1) {
  const alternatives = [answer + step, answer - step, answer + 2 * step, answer - 2 * step, answer + 3 * step]
    .filter(value => value >= 0 && value !== answer);
  return { correctValue: `${answer}${unit}`, wrong: random.shuffle([...new Set(alternatives)]).slice(0, 3).map(value => `${value}${unit}`) };
}
function turnText(turn) { return `${turn > 0 ? '오른쪽' : '왼쪽'}으로 ${Math.abs(turn) * 90}도`; }

function logic(level, r) {
  if (level === 1) {
    const order = r.shuffle(NAMES).slice(0, 4);
    const links = r.shuffle([0, 1, 2]).map(i => `${topic(order[i])} ${order[i + 1]}보다 앞에 있어요.`);
    return {
      prompt: `네 친구가 한 줄로 섰어요. ${links.join(' ')} 맨 앞은 누구일까요?`,
      correctValue: order[0], wrong: order.slice(1),
      explanation: `세 조건을 연결하면 ${order.join(' → ')} 순서예요. 맨 앞은 ${order[0]}예요.`,
      solution: { kind: 'line-order', names: order, constraints: order.slice(0, 3).map((name, i) => [name, order[i + 1]]), target: 0 },
    };
  }
  if (level === 2) {
    const order = r.shuffle(COLORS).slice(0, 4);
    const statements = r.shuffle([
      `${order[0]} 카드는 맨 앞이에요.`, `${order[3]} 카드는 맨 뒤에 있어요.`,
      `${order[1]} 카드는 ${order[2]} 카드의 바로 앞에 있어요.`,
    ]);
    return {
      prompt: `${r.shuffle(order).join('·')} 카드를 하나씩 한 줄로 놓아요. ${statements.join(' ')} 세 번째 카드는?`,
      correctValue: `${order[2]} 카드`, wrong: [order[0], order[1], order[3]].map(color => `${color} 카드`),
      explanation: `양 끝과 바로 앞 조건을 맞추면 ${order.join(' → ')} 순서예요. 세 번째는 ${order[2]} 카드예요.`,
      solution: { kind: 'fixed-line', names: order, first: order[0], last: order[3], adjacent: [order[1], order[2]], target: 2 },
    };
  }
  if (level === 3) {
    const colors = r.shuffle(COLORS).slice(0, 4);
    const sticker = r.pick(['별', '하트', '꽃', '달', '구름', '나뭇잎', '왕관', '나비']);
    return {
      prompt: `행사 규칙은 “${colors[0]} 카드를 고르면 반드시 ${sticker} 스티커를 받는다”예요. ${sticker} 스티커를 받지 않은 사람이 확실히 고르지 않은 카드는?`,
      correctValue: `${colors[0]} 카드`, wrong: colors.slice(1).map(color => `${color} 카드`),
      explanation: `${colors[0]} 카드를 골랐다면 ${sticker} 스티커를 받았어야 해요. 받지 않았으므로 ${colors[0]} 카드를 고르지 않았어요. 다른 색은 이 규칙만으로 알 수 없어요.`,
      solution: { kind: 'contrapositive', cause: `${colors[0]} 카드`, effect: `${sticker} 스티커`, alternatives: colors.map(color => `${color} 카드`) },
    };
  }
  if (level === 4) {
    const base = r.int(1, 9), step = r.int(1, 4);
    const values = Array.from({ length: 4 }, (_, i) => base + i * step);
    const labels = r.shuffle(['A', 'B', 'C', 'D']);
    const sum1 = 2 * base + 3 * step, sum2 = 2 * base + 4 * step;
    const assignment = [base, base + 3 * step, base + step, base + 2 * step];
    const target = r.int(0, 3), answer = assignment[target];
    return {
      prompt: `숫자 ${values.join('·')}를 ${labels.join('·')}에 하나씩, 중복 없이 넣어요. ${labels[0]}+${labels[1]}=${sum1}, ${labels[1]}+${labels[2]}=${sum2}, ${labels[0]}<${labels[3]}일 때 ${labels[target]}는?`,
      correctValue: String(answer), wrong: values.filter(value => value !== answer).map(String),
      explanation: `${labels.map((label, i) => `${label}=${assignment[i]}`).join(', ')}일 때 모든 조건을 만족해요. ${assignment[0]}+${assignment[1]}=${sum1}, ${assignment[1]}+${assignment[2]}=${sum2}, ${assignment[0]}<${assignment[3]}이므로 ${labels[target]}=${answer}예요.`,
      solution: { kind: 'number-assignment', labels, values, sum1, sum2, target },
    };
  }
  const boxes = r.shuffle(COLORS).slice(0, 4).map(color => `${color} 상자`);
  const statements = [[boxes[0], boxes[1]], [boxes[1], boxes[2]], [boxes[2], boxes[3]], boxes.slice(1)];
  const trueCount = r.pick([1, 2]);
  const answer = trueCount === 1 ? boxes[0] : boxes[3];
  return {
    prompt: `보물은 ${boxes.join('·')} 중 한 곳에 있어요. 다음 네 문장 중 정확히 ${trueCount}개만 참이에요.\n① ${boxes[0]} 또는 ${boxes[1]}에 있다.\n② ${boxes[1]} 또는 ${boxes[2]}에 있다.\n③ ${boxes[2]} 또는 ${boxes[3]}에 있다.\n④ ${boxes[0]}에는 없다.\n보물은 어느 상자에 있을까요?`,
    correctValue: answer, wrong: boxes.filter(box => box !== answer),
    explanation: `보물을 각 상자에 두고 확인하면 참인 문장은 ${boxes.map((box, i) => `${box}일 때 ${[1, 3, 3, 2][i]}개`).join(', ')}예요. 정확히 ${trueCount}개가 참인 곳은 ${answer}뿐이에요.`,
    solution: { kind: 'truth-count', boxes, statements, trueCount },
  };
}

function math(level, r) {
  if (level === 1) {
    const a = r.int(7, 19), b = r.int(6, 18), answer = a + b;
    return { prompt: `${a} + ${b}의 값은 얼마일까요?`, ...numeric(answer, '', r), explanation: `${a}에 ${b}를 더하면 ${answer}예요.`, solution: { kind: 'sum', a, b } };
  }
  if (level === 2) {
    const people = r.int(3, 7), each = r.int(4, 9), removed = r.int(4, 9), initial = people * each + removed;
    return {
      prompt: `구슬 ${initial}개 중 ${removed}개를 따로 보관하고, 남은 구슬을 ${people}명에게 똑같이 나눠 줘요. 한 사람은 몇 개를 받을까요?`,
      ...numeric(each, '개', r),
      explanation: `남은 구슬은 ${initial}−${removed}=${initial - removed}개예요. ${initial - removed}÷${people}=${each}이므로 한 사람에게 ${each}개씩 줄 수 있어요.`,
      solution: { kind: 'share-remainder', initial, removed, people },
    };
  }
  if (level === 3) {
    const multiplier = r.int(3, 7), added = r.int(4, 13), answer = r.int(4, 12), total = multiplier * answer + added;
    return {
      prompt: `어떤 수를 ${multiplier}배 한 뒤 ${added}만큼 더했어요. 결과가 ${total}일 때, 처음 수는?`,
      ...numeric(answer, '', r),
      explanation: `거꾸로 계산해 ${total}에서 ${added}를 빼면 ${total - added}예요. ${total - added}÷${multiplier}=${answer}이므로 어떤 수는 ${answer}예요.`,
      solution: { kind: 'inverse-equation', multiplier, added, total },
    };
  }
  if (level === 4) {
    const price = r.int(1, 6) * 10000, first = r.pick([20, 30, 40]), second = r.pick([10, 20, 30]);
    const afterFirst = price * (100 - first) / 100, answer = afterFirst * (100 - second) / 100;
    const wrong = [price * (100 - first - second) / 100, afterFirst, answer + price / 100, answer - price / 100];
    return {
      prompt: `정가 ${fmt(price)}원인 가방을 ${first}% 할인하고, 할인된 가격에서 다시 ${second}% 할인해요. 최종 가격은?`,
      correctValue: `${fmt(answer)}원`, wrong: wrong.map(value => `${fmt(value)}원`),
      explanation: `첫 할인 후 ${fmt(afterFirst)}원이에요. 여기서 ${second}%인 ${fmt(afterFirst * second / 100)}원을 더 빼면 ${fmt(answer)}원이에요. 두 할인율을 단순히 더하지 않아요.`,
      solution: { kind: 'double-discount', price, first, second },
    };
  }
  const divisors = r.shuffle([3, 4, 5, 7]).slice(0, 2).sort((a, b) => a - b);
  const limit = divisors[0] * divisors[1] * r.int(2, 5);
  const countA = Math.floor(limit / divisors[0]), countB = Math.floor(limit / divisors[1]);
  const overlap = Math.floor(limit / (divisors[0] * divisors[1]));
  const answer = countA + countB - overlap;
  return {
    prompt: `1부터 ${limit}까지의 정수 중 ${divisors[0]}의 배수이거나 ${divisors[1]}의 배수인 수는 몇 개일까요? 둘 다인 수는 한 번만 세어요.`,
    ...numeric(answer, '개', r, 2),
    explanation: `${divisors[0]}의 배수 ${countA}개와 ${divisors[1]}의 배수 ${countB}개를 더해요. 공통 배수는 ${divisors[0] * divisors[1]}의 배수 ${overlap}개이므로, 두 번 센 것을 빼면 ${countA}+${countB}−${overlap}=${answer}개예요.`,
    solution: { kind: 'multiples-union', divisors, limit },
  };
}

function spatial(level, r) {
  if (level <= 2) {
    const start = r.int(0, 3);
    const turns = level === 1 ? [r.pick([-1, 1, 2])] : [r.pick([-1, 1]), r.pick([-2, 2])];
    let current = start;
    const after = turns.map(turn => { current = mod(current + turn, 4); return current; });
    const answer = DIRECTIONS[current];
    return {
      prompt: `${DIRECTIONS[start]}을 바라보고 있어요. 제자리에서 ${turns.map(turnText).join(', 이어서 ')} 돌면 마지막에 어느 방향을 바라볼까요?`,
      correctValue: answer, wrong: DIRECTIONS.filter(direction => direction !== answer),
      explanation: `${DIRECTIONS[start]}에서 ${turns.map((turn, i) => `${turnText(turn)} 돌면 ${DIRECTIONS[after[i]]}`).join(', 다시 ')}이에요. 마지막 방향은 ${answer}이에요.`,
      solution: { kind: 'direction-turns', start, turns },
    };
  }
  if (level === 3) {
    const original = r.shuffle([0, 1, 2, 3]).slice(0, 3), turn = r.pick([-1, 1]);
    const rotate = amount => original.map(value => ARROWS[mod(value + amount, 4)]);
    const turned = rotate(turn), answer = sequence([...turned].reverse());
    return {
      prompt: `화살표 ${sequence(original.map(value => ARROWS[value]))} 각각을 ${turn > 0 ? '시계' : '반시계'} 방향으로 90도 돌린 뒤, 나열 순서를 거꾸로 바꿔요. 결과는?`,
      correctValue: answer, wrong: [sequence(turned), sequence(rotate(-turn).reverse()), sequence(rotate(2).reverse())],
      explanation: `각각 돌리면 ${sequence(turned)}이고, 이 순서를 거꾸로 읽으면 ${answer}예요.`,
      solution: { kind: 'arrows-rotate-reverse', original, turn },
    };
  }
  if (level === 4) {
    const size = 5;
    const positions = Array.from({ length: size * size }, (_, i) => [Math.floor(i / size), i % size]);
    const [row, column] = r.pick(positions.filter(([a, b]) => a !== b && a + b !== size - 1 && a !== Math.floor(size / 2)));
    const rotated = [column, size - 1 - row], final = [column, row];
    const marker = r.pick(['별', '하트', '꽃', '달', '나비', '나뭇잎']);
    return {
      prompt: `5×5 격자의 ${coord(row, column)}에 ${marker} 표시가 있어요. 격자 전체를 시계 방향으로 90도 돌린 뒤, 좌우를 거울처럼 뒤집어요. 표시는 어디에 있을까요? 행은 위부터, 열은 왼쪽부터 세어요.`,
      correctValue: coord(...final), wrong: [coord(...rotated), coord(row, column), ...r.shuffle(positions).map(position => coord(...position))],
      explanation: `90도 회전하면 ${coord(row, column)}은 ${coord(...rotated)}로 가요. 좌우 반전하면 열이 다시 바뀌어 ${coord(...final)}이 돼요.`,
      solution: { kind: 'grid-transform', size, row, column, transforms: ['clockwise', 'mirror-horizontal'] },
    };
  }
  const dimensions = [r.int(3, 8), r.int(3, 8), r.int(3, 8)];
  const [width, depth, height] = dimensions;
  const answer = 4 * dimensions.reduce((sum, value) => sum + value - 2, 0);
  return {
    prompt: `작은 정육면체 ${width * depth * height}개를 가로 ${width}칸·세로 ${depth}칸·높이 ${height}칸의 직육면체로 쌓았어요. 큰 직육면체의 겉면 전체를 칠한 뒤 분리하면, 정확히 두 면만 칠해진 작은 정육면체는 몇 개일까요?`,
    ...numeric(answer, '개', r, 4),
    explanation: `정확히 두 면이 칠해진 조각은 각 모서리에서 꼭짓점을 뺀 조각이에요. 세 방향마다 모서리가 4개이므로 4×(${width}−2)+4×(${depth}−2)+4×(${height}−2)=${answer}개예요.`,
    solution: { kind: 'painted-cuboid', dimensions, paintedFaces: 2 },
  };
}

function language(level, r) {
  if (level === 1) {
    const pair = r.pick(ANTONYMS), direction = r.int(0, 1), word = pair[direction], opposite = pair[1 - direction];
    return {
      prompt: `“${word}”와 반대되는 뜻의 낱말은?`,
      correctValue: opposite, wrong: r.shuffle(ANTONYMS.filter(item => item !== pair).flat()).slice(0, 3),
      explanation: `“${word}”와 “${opposite}”는 서로 반대되는 뜻을 나타내요.`,
      solution: { kind: 'antonym', word },
    };
  }
  if (level === 2) {
    const chain = r.pick(WORD_CHAINS), ending = chain[1].slice(-1);
    const candidates = [...new Set(WORD_CHAINS.flat())].filter(word => !word.startsWith(ending));
    return {
      prompt: `앞 낱말의 마지막 글자로 다음 낱말을 시작해요. “${chain[0]} → ${chain[1]}” 다음에 이어질 수 있는 낱말은?`,
      correctValue: chain[2], wrong: r.shuffle(candidates).slice(0, 3),
      explanation: `“${chain[1]}”의 마지막 글자는 “${ending}”예요. “${chain[2]}”는 “${ending}”로 시작하므로 이어질 수 있어요.`,
      solution: { kind: 'word-chain', given: chain.slice(0, 2) },
    };
  }
  if (level === 3) {
    const [a, b] = r.shuffle(NAMES).slice(0, 2), first = r.pick([true, false]);
    const place = r.pick(['공원', '교실', '도서관', '운동장', '정류장', '박물관']);
    const correctValue = `${topic(b)} ${a}보다 ${first ? '늦게' : '먼저'} 도착했다.`;
    return {
      prompt: `“${topic(a)} ${b}보다 ${first ? '먼저' : '늦게'} ${place}에 도착했다.”와 도착 순서가 같은 문장은?`,
      correctValue,
      wrong: [`${topic(b)} ${a}보다 ${first ? '먼저' : '늦게'} 도착했다.`, `${topic(a)} ${particle(b, '과', '와')} 동시에 도착했다.`, `${topic(a)} 도착하지 않았다.`],
      explanation: `${first ? a : b} → ${first ? b : a} 순서로 도착했어요. 따라서 “${correctValue}”가 같은 순서를 나타내요.`,
      solution: { kind: 'arrival-order', a, b, first },
    };
  }
  if (level === 4) {
    const group = r.pick(['참가자', '손님', '주민', '회원', '친구', '관람객', '지원자', '탐험가']);
    const action = r.pick(ACTIONS);
    const correctValue = `${action.notDone} ${subject(group)} 적어도 한 명 있다.`;
    const wrong = [`${action.done} ${topic(group)} 한 명도 없다.`, `모든 ${subject(group)} ${action.past}.`, `${action.done} ${topic(group)} 정확히 한 명이다.`];
    return {
      prompt: `“모든 ${subject(group)} ${action.done} 것은 아니다.”와 뜻이 같은 문장은?`,
      correctValue, wrong,
      explanation: `전부가 ${action.done} 것은 아니라는 말은, ${action.notDone} ${subject(group)} 적어도 한 명 있다는 뜻이에요. 한 명도 하지 않았거나 정확히 한 명만 했다는 뜻으로 단정할 수는 없어요.`,
      solution: { kind: 'not-all', meanings: { [correctValue]: 'some-not', [wrong[0]]: 'none', [wrong[1]]: 'all', [wrong[2]]: 'one' } },
    };
  }
  const container = r.pick(['상자', '가방', '바구니', '서랍', '주머니', '통', '보관함']);
  const color = r.pick(COLORS), place = r.pick(['창고', '교실', '가게', '도서관', '미술실', '다락방']);
  const correctValue = `물건이 든 ${subject(container)} 적어도 하나 있고, 그런 ${topic(container)} ${color}이 아니다.`;
  const wrong = [`${color} ${container} 중 물건이 든 것이 있다.`, `${color}이 아닌 모든 ${container}에 물건이 들어 있다.`, `모든 ${subject(container)} 비어 있다.`];
  return {
    prompt: `${place}의 물건 보관에 관한 설명이에요. “모든 ${subject(container)} 비어 있는 것은 아니지만, ${color} ${topic(container)} 전부 비어 있다.” 이 문장만으로 반드시 알 수 있는 것은?`,
    correctValue, wrong,
    explanation: `전부 비어 있지는 않으므로 물건이 든 ${subject(container)} 적어도 하나 있어요. ${color} ${topic(container)} 모두 비어 있으므로, 물건이 든 것은 ${color}이 아니에요. 다른 색의 ${container}가 전부 채워져 있는지는 알 수 없어요.`,
    solution: { kind: 'container-quantifiers', meanings: { [correctValue]: 'some-filled-noncolor', [wrong[0]]: 'some-filled-color', [wrong[1]]: 'all-noncolor-filled', [wrong[2]]: 'all-empty' } },
  };
}

function memory(level, r) {
  const columns = [2, 3, 3, 4, 4][level - 1], rows = [2, 2, 3, 3, 4][level - 1];
  const cells = r.shuffle(WORDS).slice(0, columns * rows);
  const visual = { type: 'memory', cells, columns, seconds: [4, 5, 5, 6, 7][level - 1] };
  if (level === 1) {
    const index = r.int(0, 3), row = Math.floor(index / columns), column = index % columns;
    return {
      prompt: `방금 본 2×2 격자의 ${coord(row, column)}에는 어떤 낱말이 있었을까요? 행은 위부터, 열은 왼쪽부터 세어요.`,
      correctValue: cells[index], wrong: cells.filter((_, i) => i !== index), visual,
      explanation: `${coord(row, column)}에는 “${cells[index]}”가 있었어요. 첫 행은 ${sequence(cells.slice(0, 2))}, 둘째 행은 ${sequence(cells.slice(2))}였어요.`,
      solution: { kind: 'memory-cells', indices: [index] },
    };
  }
  if (level === 2) {
    const anchor = r.int(0, cells.length - 1), down = anchor < columns, target = anchor + (down ? columns : -columns);
    return {
      prompt: `방금 본 격자에서 “${cells[anchor]}”의 바로 ${down ? '아래' : '위'}에 있던 낱말은?`,
      correctValue: cells[target], wrong: r.shuffle(cells.filter((_, i) => i !== target)).slice(0, 3), visual,
      explanation: `“${cells[anchor]}”는 ${coord(Math.floor(anchor / columns), anchor % columns)}에 있었어요. 바로 ${down ? '아래' : '위'}인 ${coord(Math.floor(target / columns), target % columns)}의 낱말은 “${cells[target]}”예요.`,
      solution: { kind: 'memory-neighbor', anchor, direction: down ? 'below' : 'above' },
    };
  }
  if (level === 3) {
    const row = r.int(0, 2), indices = [row * columns, row * columns + 1, row * columns + 2];
    const values = indices.map(index => cells[index]);
    return {
      prompt: `방금 본 3×3 격자의 ${row + 1}행을 왼쪽부터 순서대로 나열한 것은? 행은 위부터 세어요.`,
      correctValue: sequence(values), wrong: [sequence([...values].reverse()), sequence([values[1], values[2], values[0]]), sequence(cells.slice(((row + 1) % 3) * 3, ((row + 1) % 3) * 3 + 3))], visual,
      explanation: `${row + 1}행에는 왼쪽부터 ${sequence(values)} 순서로 놓여 있었어요.`,
      solution: { kind: 'memory-row', row },
    };
  }
  if (level === 4) {
    const column = r.int(0, 3), anchor = columns + column, indices = [column, 2 * columns + column];
    const values = indices.map(index => cells[index]);
    return {
      prompt: `방금 본 격자에서 “${cells[anchor]}”의 바로 위와 바로 아래에 있던 낱말을 순서대로 고르면?`,
      correctValue: sequence(values), wrong: [sequence([...values].reverse()), ...[1, 2].map(offset => sequence([cells[(column + offset) % columns], cells[2 * columns + (column + offset) % columns]]))], visual,
      explanation: `“${cells[anchor]}”는 ${coord(1, column)}에 있었어요. 바로 위는 “${values[0]}”, 바로 아래는 “${values[1]}”였어요.`,
      solution: { kind: 'memory-vertical-pair', anchor },
    };
  }
  const clockwise = r.pick([true, false]);
  const indices = clockwise ? [0, 3, 15, 12] : [0, 12, 15, 3];
  const values = indices.map(index => cells[index]);
  return {
    prompt: `방금 본 4×4 격자의 네 모서리를 왼쪽 위에서 시작해 ${clockwise ? '시계' : '반시계'} 방향으로 나열하면?`,
    correctValue: sequence(values), wrong: [sequence([values[0], values[3], values[2], values[1]]), sequence([values[1], values[2], values[3], values[0]]), sequence([cells[5], cells[6], cells[10], cells[9]])], visual,
    explanation: `${clockwise ? '왼쪽 위 → 오른쪽 위 → 오른쪽 아래 → 왼쪽 아래' : '왼쪽 위 → 왼쪽 아래 → 오른쪽 아래 → 오른쪽 위'} 순서로 읽으면 ${sequence(values)}예요.`,
    solution: { kind: 'memory-corners', clockwise },
  };
}

function observation(level, r) {
  if (level === 1) {
    const symbols = r.shuffle(SYMBOLS).slice(0, 4), target = symbols[0], count = r.int(2, 5);
    const cells = r.shuffle([...Array(count).fill(target), ...Array.from({ length: 10 - count }, () => r.pick(symbols.slice(1)))]);
    return {
      prompt: `다음 줄에서 “${target}”는 모두 몇 개일까요?\n${cells.join(' ')}`,
      ...numeric(count, '개', r),
      explanation: `왼쪽부터 세면 ${cells.map((cell, i) => cell === target ? i + 1 : null).filter(Boolean).join('·')}번째에 “${target}”가 있어요. 모두 ${count}개예요.`,
      solution: { kind: 'symbol-count', cells, target },
    };
  }
  if (level === 2) {
    const alphabet = [...'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'];
    const code = r.shuffle(alphabet).slice(0, 5), correctValue = code.join('');
    const swaps = [[0, 1], [1, 2], [3, 4]];
    const wrong = swaps.map(([a, b]) => { const changed = [...code]; [changed[a], changed[b]] = [changed[b], changed[a]]; return changed.join(''); });
    return {
      prompt: `기준 코드 “${correctValue}”와 글자와 순서가 완전히 같은 것을 고르세요.`,
      correctValue, wrong,
      explanation: `기준 코드의 순서는 ${sequence(code)}예요. ${correctValue}만 다섯 글자와 순서가 모두 같아요.`,
      solution: { kind: 'exact-match', code: correctValue },
    };
  }
  if (level === 3) {
    const pattern = r.shuffle(SYMBOLS).slice(0, 4);
    const cells = Array.from({ length: 11 }, (_, i) => pattern[i % pattern.length]);
    const pairs = Array.from({ length: 4 }, (_, offset) => sequence([pattern[(11 + offset) % 4], pattern[(12 + offset) % 4]]));
    return {
      prompt: `같은 네 기호 묶음이 계속 반복돼요.\n${cells.join(' ')}\n바로 다음에 올 두 기호는?`,
      correctValue: pairs[0], wrong: pairs.slice(1),
      explanation: `${sequence(pattern)}가 한 묶음이에요. 지금은 세 번째 묶음의 세 번째 기호까지 있으므로, 다음은 ${pairs[0]}예요.`,
      solution: { kind: 'cycle-next', pattern, length: cells.length },
    };
  }
  if (level === 4) {
    const [a, b] = r.shuffle([...'ABCDEFGHJK']).slice(0, 2), fragment = a + b + a;
    const cells = Array.from({ length: 15 }, () => r.pick([a, b]));
    cells.splice(4, 5, a, b, a, b, a);
    const text = cells.join('');
    const starts = [];
    for (let i = 0; i <= text.length - fragment.length; i += 1) if (text.slice(i, i + fragment.length) === fragment) starts.push(i + 1);
    return {
      prompt: `문자열 “${text}”에서 “${fragment}”는 몇 번 나타날까요? 겹치는 부분도 각각 세어요.`,
      ...numeric(starts.length, '번', r),
      explanation: `왼쪽에서 ${starts.join('·')}번째 글자로 시작하는 부분이 “${fragment}”예요. 겹친 부분까지 포함해 ${starts.length}번이에요.`,
      solution: { kind: 'overlap-count', text, fragment },
    };
  }
  const symbols = r.shuffle(SYMBOLS).slice(0, 3), [target, right, below] = symbols, size = 5;
  const cells = Array.from({ length: size * size }, () => r.pick(symbols));
  const anchorRow = r.int(0, size - 2), anchorColumn = r.int(0, size - 2), anchor = anchorRow * size + anchorColumn;
  cells[anchor] = target; cells[anchor + 1] = right; cells[anchor + size] = below;
  const positions = [];
  for (let row = 0; row < size - 1; row += 1) for (let column = 0; column < size - 1; column += 1) {
    const index = row * size + column;
    if (cells[index] === target && cells[index + 1] === right && cells[index + size] === below) positions.push([row, column]);
  }
  const rows = Array.from({ length: size }, (_, row) => `${row + 1}행: ${cells.slice(row * size, row * size + size).join(' ')}`);
  return {
    prompt: `아래 5×5 배열에서 “${target}”의 바로 오른쪽이 “${right}”이고, 바로 아래가 “${below}”인 기준 칸은 몇 곳일까요? 두 조건이 모두 맞아야 하며, 배열 밖으로 이어지지 않아요.\n${rows.join('\n')}`,
    ...numeric(positions.length, '곳', r),
    explanation: `조건을 모두 만족하는 기준 칸은 ${positions.map(position => coord(...position)).join(', ')}예요. 오른쪽과 아래를 함께 확인하면 모두 ${positions.length}곳이에요.`,
    solution: { kind: 'grid-neighbors', cells, size, target, right, below },
  };
}

const BUILDERS = { logic, math, spatial, language, memory, observation };

export function generateQuestion(field, level, seedKey) {
  if (!FIELD_IDS.includes(field)) throw new RangeError('Unknown question field.');
  if (!Number.isInteger(level) || level < 1 || level > 5) throw new RangeError('Question level must be 1–5.');
  if (typeof seedKey !== 'string' || !seedKey) throw new TypeError('A seed string is required.');
  const templateId = `${field}-${level}-v2`, seededKey = `${seedKey}:${templateId}`;
  const r = randomFor(seededKey), data = BUILDERS[field](level, r);
  const wrong = [...new Set(data.wrong)].filter(value => value !== data.correctValue).slice(0, 3);
  if (wrong.length !== 3) throw new Error(`Template ${templateId} did not produce four unique choices.`);
  const options = r.shuffle([data.correctValue, ...wrong]);
  const result = {
    id: `${seedKey}:${templateId}`, sourceId: `${templateId}:${hash(seededKey).toString(16).padStart(8, '0')}`,
    templateId, questionVersion: 2, field, level, points: 1000,
    prompt: data.prompt, options, answer: options.indexOf(data.correctValue),
    explanation: data.explanation, solution: data.solution,
  };
  if (data.visual) result.visual = data.visual;
  return result;
}
