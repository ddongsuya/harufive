/**
 * 하루다섯 — deterministic, browser-independent prototype game rules.
 * The question bank and tier rewards are curated prototype content, not a
 * calibrated intelligence test or a production economy. All dates use KST.
 */

import { generateQuestion } from './question-variants.js';

const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const POINTS = Object.freeze([100, 150, 200, 250, 300]);

export const FIELDS = Object.freeze([
  { id: 'logic', label: '논리', color: '#8170df', description: '주어진 조건을 연결해 답을 찾아요.' },
  { id: 'math', label: '수리', color: '#d99438', description: '수와 양 사이의 관계를 살펴봐요.' },
  { id: 'spatial', label: '공간', color: '#5b94d8', description: '위치와 방향의 변화를 떠올려요.' },
  { id: 'language', label: '언어', color: '#dc7d9a', description: '낱말과 문장의 뜻을 정확히 읽어요.' },
  { id: 'memory', label: '기억', color: '#55a78f', description: '잠깐 본 정보와 위치를 기억해요.' },
  { id: 'observation', label: '관찰', color: '#ab81c8', description: '작은 차이와 반복을 찾아내요.' },
].map(Object.freeze));

// ceiling is the inclusive upper bound of rank / participants * 100.
// Rewards are illustrative coins, never a promise of cash or exchange value.
export const TIERS = Object.freeze([
  { id: 'amber', name: '앰버', color: '#d7973f', ceiling: 100, reward: 100 },
  { id: 'jade', name: '제이드', color: '#50a587', ceiling: 60, reward: 140 },
  { id: 'sapphire', name: '사파이어', color: '#538cda', ceiling: 30, reward: 200 },
  { id: 'ruby', name: '루비', color: '#d9688d', ceiling: 10, reward: 280 },
  { id: 'diamond', name: '다이아', color: '#8a87dc', ceiling: 3, reward: 400 },
  { id: 'aurora', name: '오로라', color: '#5db5b4', ceiling: 1, reward: 600 },
].map(Object.freeze));

function question(id, field, level, prompt, options, answer, explanation, visual) {
  const result = {
    id, field, level, points: POINTS[level - 1], prompt,
    options: Object.freeze(options), answer, explanation,
  };
  if (visual) result.visual = Object.freeze({ ...visual, cells: Object.freeze(visual.cells) });
  return Object.freeze(result);
}

function memory(cells, columns, seconds) {
  return { type: 'memory', cells, columns, seconds };
}

/** Exactly two original questions per field and proposed difficulty level. */
export const QUESTION_BANK = Object.freeze([
  question('logic-1-a', 'logic', 1,
    '네 친구가 한 줄로 섰어요. 민수는 지수보다 앞, 지수는 하늘보다 앞, 하늘은 보라보다 앞에 있어요. 맨 앞은 누구일까요?',
    ['민수', '지수', '하늘', '보라'], 0,
    '조건을 연결하면 민수 → 지수 → 하늘 → 보라 순서예요.'),
  question('logic-1-b', 'logic', 1,
    '이 상자 안의 공은 모두 파란색이에요. 상자에서 공 하나를 꺼냈다면 반드시 맞는 설명은?',
    ['공은 파란색이다.', '공은 가장 큰 공이다.', '공은 줄무늬가 있다.', '공은 새 공이다.'], 0,
    '상자 안의 모든 공이 파란색이라는 조건만 주어졌어요. 크기나 무늬, 사용 여부는 알 수 없어요.'),
  question('logic-2-a', 'logic', 2,
    '빨강·파랑·노랑·초록 카드를 한 줄로 놓아요. 빨강은 맨 앞, 초록은 맨 뒤, 파랑은 노랑의 바로 앞이에요. 두 번째 카드는?',
    ['빨강', '파랑', '노랑', '초록'], 1,
    '양 끝을 정하면 가운데 두 자리는 파랑 → 노랑 순서가 돼요.'),
  question('logic-2-b', 'logic', 2,
    '두 자리 비밀번호예요. 십의 자리는 짝수이고, 일의 자리는 십의 자리보다 1 커요. 두 숫자의 합은 9예요. 비밀번호는?',
    ['23', '45', '67', '89'], 1,
    '연속한 두 숫자의 합이 9인 경우는 4와 5예요. 십의 자리 4는 짝수이므로 45예요.'),
  question('logic-3-a', 'logic', 3,
    'A·B·C·D가 한 줄로 서요. A는 B보다 앞, C는 B의 바로 뒤, D는 A보다 앞이에요. 세 번째 사람은?',
    ['A', 'B', 'C', 'D'], 1,
    'D → A → B → C 순서만 모든 조건을 만족해요. 세 번째는 B예요.'),
  question('logic-3-b', 'logic', 3,
    '행사 규칙은 “빨간 카드를 고르면 반드시 별 스티커를 받는다”예요. 별 스티커를 받지 않은 사람이 확실히 고르지 않은 카드는?',
    ['빨간 카드', '파란 카드', '초록 카드', '노란 카드'], 0,
    '빨간 카드를 골랐다면 별을 받았어야 해요. 별을 받지 않았으므로 빨간 카드를 고르지 않았어요.'),
  question('logic-4-a', 'logic', 4,
    '숫자 1·2·3·4를 A·B·C·D에 하나씩, 중복 없이 넣어요. A+B=5, B+C=6, A<D일 때 C는?',
    ['1', '2', '3', '4'], 1,
    'B가 2이면 A=3, C=4, D=1이라 A<D에 어긋나요. B=4일 때 A=1, C=2, D=3으로 모든 조건이 맞아요.'),
  question('logic-4-b', 'logic', 4,
    '다섯 사람의 순서를 정해요. 가는 나보다 앞, 다는 라의 바로 뒤, 마는 맨 앞이 아니고, 나는 맨 뒤예요. 가능한 순서는?',
    ['가 → 라 → 다 → 마 → 나', '마 → 가 → 라 → 다 → 나', '가 → 다 → 라 → 마 → 나', '가 → 라 → 다 → 나 → 마'], 0,
    '가 → 라 → 다 → 마 → 나 순서가 모든 조건을 만족해요. 다른 순서는 마의 위치, 라·다의 순서, 나의 위치 중 하나가 어긋나요.'),
  question('logic-5-a', 'logic', 5,
    '보물은 A·B·C·D 중 한 상자에 있어요. 다음 네 문장 중 정확히 하나만 참이에요.\n① A 또는 B에 있다.\n② B 또는 C에 있다.\n③ C 또는 D에 있다.\n④ A에는 없다.\n보물은 어디에 있을까요?',
    ['A 상자', 'B 상자', 'C 상자', 'D 상자'], 0,
    'A에 있으면 ①만 참이에요. B와 C에 있으면 각각 세 문장, D에 있으면 두 문장이 참이 되어 조건에 어긋나요.'),
  question('logic-5-b', 'logic', 5,
    'A·B·C·D 스위치 중 정확히 두 개가 켜져 있어요. A가 켜지면 B도 켜지고, B가 켜지면 C도 켜져요. D가 켜지면 A도 켜져요. 켜진 두 개는?',
    ['A와 B', 'A와 C', 'B와 C', 'C와 D'], 2,
    'A를 켜면 A·B·C 세 개가, D를 켜면 네 개가 켜져야 해요. 정확히 두 개이려면 B와 C만 켜져 있어야 해요.'),

  question('math-1-a', 'math', 1,
    '7 + 8의 값은 얼마일까요?', ['13', '14', '15', '16'], 2,
    '7에 3을 더해 10을 만들고, 남은 5를 더하면 15예요.'),
  question('math-1-b', 'math', 1,
    '상자 4개에 사과가 각각 3개씩 있어요. 사과는 모두 몇 개일까요?', ['7개', '10개', '12개', '14개'], 2,
    '3개씩 4묶음이므로 3×4=12개예요.'),
  question('math-2-a', 'math', 2,
    '구슬 24개를 6명에게 똑같이 나눠 주면 한 사람은 몇 개를 받을까요?', ['3개', '4개', '5개', '6개'], 1,
    '24÷6=4이므로 한 사람에게 4개씩 줄 수 있어요.'),
  question('math-2-b', 'math', 2,
    '물병에 물이 800mL 있었어요. 오전에 250mL, 오후에 150mL를 마셨어요. 남은 물은?', ['350mL', '400mL', '450mL', '500mL'], 1,
    '마신 물은 250+150=400mL예요. 800−400=400mL가 남아요.'),
  question('math-3-a', 'math', 3,
    '연필 3자루와 지우개 1개의 가격이 1,100원이에요. 연필 한 자루가 200원이라면 지우개는 얼마일까요?',
    ['300원', '400원', '500원', '600원'], 2,
    '연필 세 자루는 600원이에요. 1,100−600=500원이 지우개 가격이에요.'),
  question('math-3-b', 'math', 3,
    '어떤 수에 3을 곱하고 4를 더했더니 25가 되었어요. 어떤 수는?', ['5', '6', '7', '8'], 2,
    '25에서 4를 빼면 21, 21을 3으로 나누면 7이에요.'),
  question('math-4-a', 'math', 4,
    '정가 20,000원인 가방을 20% 할인하고, 할인된 가격에서 다시 10% 할인해요. 최종 가격은?',
    ['14,000원', '14,400원', '15,000원', '16,000원'], 1,
    '첫 할인 후 16,000원이에요. 여기서 10%인 1,600원을 더 빼면 14,400원이에요.'),
  question('math-4-b', 'math', 4,
    'A 알람은 8분마다, B 알람은 12분마다 울려요. 지금 함께 울렸다면 다음에 함께 울리는 것은 몇 분 뒤일까요?',
    ['16분', '20분', '24분', '96분'], 2,
    '8의 배수 8·16·24와 12의 배수 12·24가 처음 만나는 수는 24예요.'),
  question('math-5-a', 'math', 5,
    '빈 물통을 A 수도꼭지는 12분, B 수도꼭지는 18분에 채워요. 물의 속도가 일정하고 빠져나가는 물이 없을 때, 두 개를 함께 틀면 걸리는 시간은?',
    ['6분', '7분 12초', '7분 30초', '8분'], 1,
    '1분에 물통의 1/12+1/18=5/36을 채워요. 36/5분은 7.2분, 즉 7분 12초예요.'),
  question('math-5-b', 'math', 5,
    '1부터 60까지의 정수 중 3의 배수이거나 5의 배수인 수는 몇 개일까요? 둘 다인 수는 한 번만 세어요.',
    ['24개', '28개', '30개', '32개'], 1,
    '3의 배수 20개와 5의 배수 12개를 더하고, 두 번 센 15의 배수 4개를 빼면 28개예요.'),

  question('spatial-1-a', 'spatial', 1,
    '북쪽을 바라보고 있어요. 제자리에서 오른쪽으로 90도 돌면 어느 방향을 바라볼까요?', ['북쪽', '동쪽', '남쪽', '서쪽'], 1,
    '북쪽에서 오른쪽으로 한 번, 90도 돌면 동쪽이에요.'),
  question('spatial-1-b', 'spatial', 1,
    '정사각형 카드의 왼쪽 위 모서리에 점이 있어요. 카드를 시계 방향으로 90도 돌리면 점은 어디에 있을까요?',
    ['왼쪽 위', '오른쪽 위', '오른쪽 아래', '왼쪽 아래'], 1,
    '시계 방향으로 한 번 돌리면 왼쪽 위 모서리가 오른쪽 위로 이동해요.'),
  question('spatial-2-a', 'spatial', 2,
    '동쪽을 바라보다가 왼쪽으로 90도, 이어서 오른쪽으로 180도 돌았어요. 마지막 방향은?', ['북쪽', '동쪽', '남쪽', '서쪽'], 2,
    '동쪽에서 왼쪽 90도는 북쪽이에요. 북쪽에서 반 바퀴 돌면 남쪽이에요.'),
  question('spatial-2-b', 'spatial', 2,
    '3×3 격자에서 행은 위부터, 열은 왼쪽부터 세어요. 1행 1열에서 오른쪽으로 두 칸, 아래로 한 칸 이동하면 어디일까요?',
    ['1행 3열', '2행 3열', '3행 2열', '2행 2열'], 1,
    '오른쪽 두 칸은 1행 3열, 그곳에서 아래 한 칸은 2행 3열이에요.'),
  question('spatial-3-a', 'spatial', 3,
    '가로로 3칸, 세로로 2칸인 직사각형 격자를 시계 방향으로 90도 돌려요. 돌린 뒤 가로와 세로의 칸 수는?',
    ['가로 2칸 · 세로 3칸', '가로 3칸 · 세로 2칸', '가로 2칸 · 세로 2칸', '가로 3칸 · 세로 3칸'], 0,
    '90도 돌리면 가로와 세로가 바뀌어요. 가로 2칸, 세로 3칸이 돼요.'),
  question('spatial-3-b', 'spatial', 3,
    '화살표 ↑ → ↓ 각각을 시계 방향으로 90도 돌린 뒤, 나열 순서를 거꾸로 바꿔요. 결과는?',
    ['← ↓ →', '→ ↓ ←', '← ↑ →', '↓ ← ↑'], 0,
    '각각 돌리면 → ↓ ←이고, 이 순서를 거꾸로 읽으면 ← ↓ →예요.'),
  question('spatial-4-a', 'spatial', 4,
    '3×3 격자의 1행 2열을 칠했어요. 격자 전체를 시계 방향으로 90도 돌린 뒤, 좌우를 거울처럼 뒤집어요. 칠한 칸은? 행은 위부터, 열은 왼쪽부터 세어요.',
    ['1행 2열', '2행 1열', '2행 3열', '3행 2열'], 1,
    '위쪽 가운데는 90도 회전 후 오른쪽 가운데가 돼요. 좌우 반전하면 왼쪽 가운데인 2행 1열이에요.'),
  question('spatial-4-b', 'spatial', 4,
    '정육면체의 윗면은 A, 아랫면은 B, 왼쪽 면은 C, 오른쪽 면은 D예요. 바닥에서 오른쪽으로 연속 두 번 굴리면 윗면의 글자는? 한 번에 90도씩 굴려요.',
    ['A', 'B', 'C', 'D'], 1,
    '한 번 굴리면 왼쪽 면 C가 위로 와요. 두 번 굴리면 처음 아랫면이던 B가 위로 와요.'),
  question('spatial-5-a', 'spatial', 5,
    '정사각형 종이의 왼쪽 절반을 오른쪽에 겹치고, 위쪽 절반을 아래쪽에 겹쳐요. 겹친 종이의 정중앙을 한 번 뚫었어요. 접힌 선과 가장자리는 뚫지 않았어요. 완전히 펴면 구멍은 몇 개일까요?',
    ['1개', '2개', '4개', '8개'], 2,
    '두 번 접으면 종이가 네 겹이에요. 접힌 선 밖에서 네 겹을 모두 뚫었으므로 펴면 구멍이 4개예요.'),
  question('spatial-5-b', 'spatial', 5,
    '작은 정육면체 27개를 3×3×3으로 쌓고, 큰 정육면체의 겉면 전체를 칠했어요. 다시 분리하면 정확히 두 면만 칠해진 작은 정육면체는 몇 개일까요?',
    ['8개', '12개', '18개', '24개'], 1,
    '두 면만 칠해진 조각은 각 모서리의 가운데 조각이에요. 큰 정육면체의 모서리는 12개이므로 12개예요.'),

  question('language-1-a', 'language', 1,
    '“높다”와 반대되는 뜻의 낱말은?', ['낮다', '길다', '크다', '빠르다'], 0,
    '높이의 반대 관계를 나타내는 낱말은 높다와 낮다예요.'),
  question('language-1-b', 'language', 1,
    '“빨갛다, 파랗다, 노랗다”처럼 색을 나타내는 낱말은?', ['검다', '달다', '느리다', '단단하다'], 0,
    '검다는 검은색을 뜻해요. 나머지는 맛, 속도, 단단함을 나타내요.'),
  question('language-2-a', 'language', 2,
    '“손 : 장갑”과 같은 관계로 “발 : ○○”을 완성하면? 신체 부위와 그곳에 착용하는 물건의 관계예요.',
    ['양말', '모자', '안경', '목도리'], 0,
    '장갑은 손에 끼고 양말은 발에 신어요.'),
  question('language-2-b', 'language', 2,
    '앞 낱말의 마지막 글자로 다음 낱말을 시작해요. “나무 → 무지개 → 개미” 다음에 이어질 수 있는 낱말은?',
    ['미로', '다리', '바다', '구름'], 0,
    '개미의 마지막 글자인 미로 시작해야 하므로 미로가 이어져요.'),
  question('language-3-a', 'language', 3,
    '“민지는 유나보다 늦게 도착했다.”와 뜻이 같은 문장은?',
    ['유나는 민지보다 먼저 도착했다.', '민지와 유나는 함께 도착했다.', '민지는 유나보다 먼저 도착했다.', '유나는 도착하지 않았다.'], 0,
    '민지가 더 늦었다는 것은 유나가 민지보다 먼저 도착했다는 뜻이에요.'),
  question('language-3-b', 'language', 3,
    '각 낱말의 첫 글자만 순서대로 이어요. “바다 + 나무”는 “바나”가 돼요. “소나기 + 풍선 + 가방”은?',
    ['소풍가', '소선가', '나풍방', '소풍방'], 0,
    '소나기의 소, 풍선의 풍, 가방의 가를 순서대로 이으면 소풍가예요.'),
  question('language-4-a', 'language', 4,
    '“모든 학생이 책을 빌린 것은 아니다.”와 뜻이 같은 문장은?',
    ['책을 빌리지 않은 학생이 적어도 한 명 있다.', '책을 빌린 학생은 한 명도 없다.', '모든 학생이 책을 빌렸다.', '책을 빌린 학생은 정확히 한 명이다.'], 0,
    '전부가 빌린 것은 아니라는 말은, 빌리지 않은 학생이 한 명 이상 있다는 뜻이에요.'),
  question('language-4-b', 'language', 4,
    '“회의에 참석하지 않은 사람이 한 명도 없다.”와 뜻이 같은 문장은?',
    ['모든 사람이 회의에 참석했다.', '모든 사람이 회의에 불참했다.', '일부 사람만 회의에 참석했다.', '정확히 한 사람이 회의에 참석했다.'], 0,
    '불참한 사람이 없다는 뜻이므로 모든 사람이 참석했어요.'),
  question('language-5-a', 'language', 5,
    '“모든 상자가 비어 있는 것은 아니지만, 빨간 상자는 전부 비어 있다.” 이 문장만으로 반드시 알 수 있는 것은?',
    ['물건이 든 상자가 적어도 하나 있고, 그런 상자는 빨간색이 아니다.', '빨간 상자 중 물건이 든 것이 있다.', '빨간색이 아닌 모든 상자에 물건이 들어 있다.', '모든 상자가 비어 있다.'], 0,
    '전부 비어 있지는 않으므로 물건이 든 상자가 있어요. 빨간 상자는 모두 비어 있으므로 물건이 든 상자는 다른 색이에요.'),
  question('language-5-b', 'language', 5,
    '“학생 중 발표도 하고 질문도 한 사람은 없다.”와 뜻이 같은 문장은?',
    ['발표한 학생 중 질문도 한 학생은 없다.', '발표한 학생은 한 명도 없다.', '질문한 학생은 한 명도 없다.', '모든 학생이 발표와 질문 중 정확히 하나를 했다.'], 0,
    '발표와 질문을 둘 다 한 학생이 없다는 뜻이에요. 한 가지만 하거나 둘 다 하지 않은 학생이 있는지는 알 수 없어요.'),

  question('memory-1-a', 'memory', 1,
    '방금 본 격자의 왼쪽 위 칸에는 어떤 낱말이 있었을까요?', ['사과', '별', '고양이', '잎'], 0,
    '왼쪽 위에는 사과가 있었어요.', memory(['사과', '별', '고양이', '잎'], 2, 4)),
  question('memory-1-b', 'memory', 1,
    '방금 본 격자의 오른쪽 아래 칸에는 어떤 낱말이 있었을까요?', ['달', '꽃', '책', '새'], 3,
    '오른쪽 아래에는 새가 있었어요.', memory(['달', '꽃', '책', '새'], 2, 4)),
  question('memory-2-a', 'memory', 2,
    '방금 본 격자의 첫 번째 행 가운데에는 어떤 낱말이 있었을까요?', ['열쇠', '달', '컵', '사과'], 1,
    '첫 번째 행은 열쇠·달·컵이었어요. 가운데에는 달이 있었어요.', memory(['열쇠', '달', '컵', '꽃', '사과', '종'], 3, 5)),
  question('memory-2-b', 'memory', 2,
    '방금 본 격자에서 “파랑”의 바로 아래에 있던 낱말은?', ['초록', '보라', '주황', '노랑'], 1,
    '파랑은 첫 행 가운데, 보라는 두 번째 행 가운데에 있었어요.', memory(['빨강', '파랑', '노랑', '초록', '보라', '주황'], 3, 5)),
  question('memory-3-a', 'memory', 3,
    '방금 본 3×3 격자의 정가운데에는 어떤 낱말이 있었을까요?', ['달', '컵', '종', '책'], 1,
    '가운데인 2행 2열에는 컵이 있었어요.', memory(['별', '책', '달', '꽃', '컵', '새', '종', '잎', '배'], 3, 5)),
  question('memory-3-b', 'memory', 3,
    '방금 본 숫자 격자의 두 번째 행을 왼쪽부터 나열한 것은?', ['4 · 9 · 1', '4 · 1 · 9', '8 · 2 · 5', '6 · 3 · 7'], 0,
    '두 번째 행에는 왼쪽부터 4·9·1이 있었어요.', memory(['8', '2', '5', '4', '9', '1', '6', '3', '7'], 3, 5)),
  question('memory-4-a', 'memory', 4,
    '방금 본 격자에서 “별”의 바로 위와 바로 아래에 있던 낱말을 순서대로 고르면?', ['컵 · 해', '달 · 새', '종 · 눈', '잎 · 콩'], 0,
    '별은 2행 2열에 있었어요. 같은 열의 위는 컵, 아래는 해였어요.', memory(['달', '컵', '종', '잎', '배', '별', '책', '꽃', '새', '해', '눈', '콩'], 4, 6)),
  question('memory-4-b', 'memory', 4,
    '방금 본 숫자 격자의 3행 2열과 1행 4열에 있던 수를 더하면? 행은 위부터, 열은 왼쪽부터 세어요.', ['12', '13', '14', '15'], 2,
    '3행 2열은 5, 1행 4열은 9였어요. 5+9=14예요.', memory(['12', '7', '4', '9', '3', '11', '8', '2', '6', '5', '10', '1'], 4, 6)),
  question('memory-5-a', 'memory', 5,
    '방금 본 격자의 네 모서리를 왼쪽 위에서 시작해 시계 방향으로 나열하면?',
    ['별 · 꽃 · 강 · 집', '별 · 집 · 강 · 꽃', '달 · 꽃 · 산 · 집', '별 · 잎 · 강 · 배'], 0,
    '왼쪽 위는 별, 오른쪽 위는 꽃, 오른쪽 아래는 강, 왼쪽 아래는 집이었어요.', memory(['별', '달', '해', '꽃', '컵', '책', '종', '잎', '배', '새', '눈', '콩', '집', '불', '산', '강'], 4, 7)),
  question('memory-5-b', 'memory', 5,
    '방금 본 4×4 숫자 격자에서 가운데 네 칸에 있던 수를 모두 더하면?', ['25', '26', '27', '28'], 2,
    '가운데 네 칸은 1·13·8·5였어요. 모두 더하면 27이에요.', memory(['4', '11', '2', '9', '7', '1', '13', '6', '15', '8', '5', '12', '3', '14', '10', '16'], 4, 7)),

  question('observation-1-a', 'observation', 1,
    '다음 줄에서 채워진 동그라미 ●는 몇 개일까요?\n● ○ ● △ ●', ['2개', '3개', '4개', '5개'], 1,
    '채워진 동그라미는 첫 번째, 세 번째, 다섯 번째에 있어 총 3개예요.'),
  question('observation-1-b', 'observation', 1,
    '기준 문자열은 ABBA예요. 글자와 순서가 정확히 같은 것은?', ['ABAB', 'AABB', 'ABBA', 'BAAB'], 2,
    '기준과 똑같이 A·B·B·A 순서로 적힌 것은 ABBA예요.'),
  question('observation-2-a', 'observation', 2,
    '다음 숫자열에서 숫자 1은 몇 번 나타날까요?\n7141717114', ['3번', '4번', '5번', '6번'], 2,
    '왼쪽부터 2·4·6·8·9번째가 1이므로 모두 5번이에요.'),
  question('observation-2-b', 'observation', 2,
    '두 문자열을 같은 위치끼리 비교해요. 글자가 같은 위치는 몇 곳일까요?\nABCD1234\nABDC1234', ['4곳', '5곳', '6곳', '7곳'], 2,
    '세 번째와 네 번째 위치만 달라요. 여덟 곳 중 여섯 곳이 같아요.'),
  question('observation-3-a', 'observation', 3,
    '다음 문자열에 연속한 “AB”는 몇 번 나타날까요?\nABACABADABAC', ['2번', '3번', '4번', '5번'], 1,
    '왼쪽부터 1·5·9번째 글자에서 AB가 시작하므로 3번이에요.'),
  question('observation-3-b', 'observation', 3,
    '다음 숫자열에서 3 바로 다음에 짝수가 오는 경우는 몇 번일까요?\n3827369327', ['1번', '2번', '3번', '4번'], 2,
    '3 다음 숫자는 각각 8·6·2예요. 모두 짝수이므로 3번이에요.'),
  question('observation-4-a', 'observation', 4,
    '다음 문자열에 연속한 “ABA”는 몇 번 나타날까요? 겹쳐도 시작 위치가 다르면 따로 세어요.\nABABAABABA', ['3번', '4번', '5번', '6번'], 1,
    '왼쪽부터 1·3·6·8번째 글자에서 ABA가 시작하므로 4번이에요.'),
  question('observation-4-b', 'observation', 4,
    '두 문자열을 같은 위치끼리 비교해요. 서로 다른 위치는 몇 곳일까요?\nA7B9C2D4E6F8\nA7B8C2D4F6E8', ['2곳', '3곳', '4곳', '5곳'], 1,
    '4번째의 9와 8, 9번째의 E와 F, 11번째의 F와 E가 달라요. 총 3곳이에요.'),
  question('observation-5-a', 'observation', 5,
    '다음 숫자열에 연속한 “121”은 몇 번 나타날까요? 겹쳐도 시작 위치가 다르면 따로 세어요.\n12121211212', ['3번', '4번', '5번', '6번'], 1,
    '왼쪽부터 1·3·5·8번째 숫자에서 121이 시작하므로 4번이에요.'),
  question('observation-5-b', 'observation', 5,
    '기준은 K4M8N2P6Q9R3예요. 같은 위치의 숫자는 모두 같고, 알파벳만 정확히 두 곳 다른 문자열은?',
    ['K4M8P2N6Q9R3', 'K4M8P2N7Q9R3', 'K4M8N2P6Q9S3', 'L4M8P2N6Q9R3'], 0,
    'K4M8P2N6Q9R3은 N과 P 자리만 바뀌고 숫자는 모두 같아요. 다른 보기는 숫자도 다르거나 알파벳 차이가 한 곳 또는 세 곳이에요.'),
]);

/**
 * Practice has its own bank. Ads or practice must never reveal unpublished
 * official questions, and practice must never contribute to official records.
 */
export const PRACTICE_BANK = Object.freeze([
  question('practice-logic-a', 'logic', 1,
    '책 세 권을 작은 것부터 쌓아요. 빨간 책은 파란 책보다 작고, 파란 책은 노란 책보다 작아요. 가장 큰 책은?',
    ['빨간 책', '파란 책', '노란 책', '세 권의 크기가 같다'], 2,
    '빨강 < 파랑 < 노랑 순서이므로 노란 책이 가장 커요.'),
  question('practice-logic-b', 'logic', 4,
    '각기 다른 숫자 2·4·6을 세 칸에 넣어요. 첫 칸은 마지막 칸보다 크고, 가운데 칸은 나머지 두 칸의 평균이에요. 왼쪽부터 올바른 순서는?',
    ['2 · 4 · 6', '6 · 4 · 2', '4 · 6 · 2', '6 · 2 · 4'], 1,
    '나머지 두 수의 평균이 되는 수는 4예요. 첫 칸이 더 커야 하므로 6·4·2예요.'),
  question('practice-math-a', 'math', 2,
    '스티커 35장을 한 봉지에 5장씩 넣으면 봉지는 몇 개 필요할까요?', ['5개', '6개', '7개', '8개'], 2,
    '35÷5=7이므로 봉지 7개가 필요해요.'),
  question('practice-math-b', 'math', 5,
    '1부터 40까지의 정수 중 4의 배수이거나 6의 배수인 수는 몇 개일까요? 둘 다인 수는 한 번만 세어요.',
    ['10개', '12개', '13개', '16개'], 2,
    '4의 배수 10개와 6의 배수 6개를 더하고, 겹친 12의 배수 3개를 빼면 13개예요.'),
  question('practice-spatial-a', 'spatial', 2,
    '남쪽을 바라보고 있어요. 오른쪽으로 90도 돈 뒤, 다시 왼쪽으로 180도 돌면 마지막 방향은?',
    ['북쪽', '동쪽', '남쪽', '서쪽'], 1,
    '남쪽에서 오른쪽으로 돌면 서쪽이에요. 거기서 반 바퀴 돌면 동쪽이에요.'),
  question('practice-spatial-b', 'spatial', 4,
    '4×4 격자의 2행 1열을 칠했어요. 격자 전체를 시계 방향으로 90도 돌리면 칠한 칸은? 행은 위부터, 열은 왼쪽부터 세어요.',
    ['1행 3열', '1행 2열', '3행 4열', '4행 2열'], 0,
    '시계 방향 90도 회전은 (행, 열)을 (열, 5−행)으로 옮겨요. (2, 1)은 (1, 3)이 돼요.'),
  question('practice-language-a', 'language', 1,
    '“가깝다”와 반대되는 뜻의 낱말은?', ['멀다', '밝다', '작다', '굵다'], 0,
    '거리의 반대 관계를 나타내는 낱말은 가깝다와 멀다예요.'),
  question('practice-language-b', 'language', 3,
    '“도윤은 하린보다 먼저 출발했다.”와 뜻이 같은 문장은?',
    ['하린은 도윤보다 나중에 출발했다.', '도윤과 하린은 함께 출발했다.', '하린은 도윤보다 먼저 출발했다.', '도윤은 출발하지 않았다.'], 0,
    '도윤이 먼저 출발했으므로 하린은 도윤보다 나중에 출발했어요.'),
  question('practice-memory-a', 'memory', 3,
    '방금 본 연습 격자의 첫 번째 행 오른쪽 끝에는 어떤 낱말이 있었을까요?', ['우산', '기차', '나비', '시계'], 2,
    '첫 행은 우산·기차·나비였어요. 오른쪽 끝에는 나비가 있었어요.', memory(['우산', '기차', '나비', '시계', '모자', '풍선', '토끼', '수박', '연필'], 3, 5)),
  question('practice-memory-b', 'memory', 5,
    '방금 본 연습 격자의 왼쪽 아래와 오른쪽 위에 있던 수를 더하면?', ['18', '19', '20', '21'], 2,
    '왼쪽 아래는 13, 오른쪽 위는 7이었어요. 13+7=20이에요.', memory(['9', '2', '11', '7', '4', '15', '1', '8', '12', '3', '16', '5', '13', '6', '10', '14'], 4, 7)),
  question('practice-observation-a', 'observation', 2,
    '다음 숫자열에서 숫자 6은 몇 번 나타날까요?\n606166206', ['3번', '4번', '5번', '6번'], 2,
    '왼쪽부터 1·3·5·6·9번째가 6이므로 모두 5번이에요.'),
  question('practice-observation-b', 'observation', 4,
    '다음 문자열에 연속한 “XYX”는 몇 번 나타날까요? 겹쳐도 시작 위치가 다르면 따로 세어요.\nXYXYXXYXYX', ['2번', '3번', '4번', '5번'], 2,
    '왼쪽부터 1·3·6·8번째 글자에서 XYX가 시작하므로 4번이에요.'),
]);

function keyToDate(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new RangeError('Expected a YYYY-MM-DD date key.');
  }
  const value = new Date(`${key}T00:00:00.000Z`);
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== key) {
    throw new RangeError('Invalid calendar date.');
  }
  return value;
}

export function dateKey(now = new Date()) {
  const timestamp = now instanceof Date ? now.getTime() : new Date(now).getTime();
  if (!Number.isFinite(timestamp)) throw new RangeError('Invalid date.');
  return new Date(timestamp + KST_OFFSET_MS).toISOString().slice(0, 10);
}

export function addDays(key, days) {
  if (!Number.isSafeInteger(days)) throw new RangeError('Day offset must be an integer.');
  const timestamp = keyToDate(key).getTime() + days * DAY_MS;
  const value = new Date(timestamp);
  if (!Number.isFinite(value.getTime())) throw new RangeError('Date is out of range.');
  return value.toISOString().slice(0, 10);
}

export function weekKey(key) {
  const weekday = keyToDate(key).getUTCDay();
  return addDays(key, -(weekday + 6) % 7);
}

function mod(value, base) { return ((value % base) + base) % base; }

// FNV-1a and a small seeded PRNG are used only for reproducible presentation.
// They are not security boundaries or a source of secret question selection.
function hash(value) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  }
  return result >>> 0;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function instantiate(source, prefix) {
  const random = seededRandom(hash(`${prefix}:${source.id}`));
  const order = [0, 1, 2, 3];
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [order[index], order[other]] = [order[other], order[index]];
  }
  const result = {
    ...source,
    id: `${prefix}:${source.id}`,
    sourceId: source.id,
    options: order.map(index => source.options[index]),
    answer: order.indexOf(source.answer),
  };
  if (source.visual) result.visual = { ...source.visual, cells: [...source.visual.cells] };
  return result;
}

export function makeDailySet(key, playerId) {
  const day = Math.floor(keyToDate(key).getTime() / DAY_MS);
  if (playerId !== undefined && playerId !== null) {
    if (typeof playerId !== 'string' || !playerId.trim()) throw new TypeError('A non-empty player ID is required.');
    return POINTS.map((_, index) => {
      const field = FIELDS[mod(day + index + 1, FIELDS.length)].id;
      return generateQuestion(field, index + 1, `daily:v2:${key}:${playerId}`);
    });
  }
  // Calls without a player ID intentionally retain the original question bank
  // and option order so saved v0.1/v0.2 results keep the correct explanations.
  // Every six days each field is omitted once and occupies each level once.
  return POINTS.map((_, index) => {
    const field = FIELDS[mod(day + index + 1, FIELDS.length)].id;
    const level = index + 1;
    const pool = QUESTION_BANK.filter(item => item.field === field && item.level === level);
    // Alternate variants each six-day cycle, exhausting all 60 official
    // questions before repeating a source. Option order stays date-specific.
    const source = pool[mod(Math.floor(day / FIELDS.length), pool.length)];
    return instantiate(source, `daily:${key}`);
  });
}

export function makePreviewSet(key, playerId, round = 0) {
  const day = Math.floor(keyToDate(key).getTime() / DAY_MS);
  if (typeof playerId !== 'string' || !playerId.trim()) throw new TypeError('A non-empty player ID is required.');
  if (!Number.isSafeInteger(round) || round < 0) throw new RangeError('Preview round must be a non-negative integer.');
  return POINTS.map((_, index) => {
    const field = FIELDS[mod(day + index + 1, FIELDS.length)].id;
    return generateQuestion(field, index + 1, `preview:v2:${key}:${playerId}:${round}`);
  });
}

export function makePracticeSet(key, seedNumber = 0) {
  const day = Math.floor(keyToDate(key).getTime() / DAY_MS);
  if (!Number.isSafeInteger(seedNumber) || seedNumber < 0) {
    throw new RangeError('Practice seed must be a non-negative integer.');
  }
  const prefix = `practice:${key}:${seedNumber}`;
  const selected = [];
  for (let index = 0; index < 5; index += 1) {
    const fieldIndex = mod(day + seedNumber + index + 1, FIELDS.length);
    const field = FIELDS[fieldIndex].id;
    const pool = PRACTICE_BANK.filter(item => item.field === field);
    // The alternating variant guarantees variation for the same field over rounds.
    const variant = mod(Math.floor(seedNumber / FIELDS.length) + day + seedNumber + fieldIndex, pool.length);
    selected.push(instantiate(pool[variant], prefix));
  }
  return selected.sort((a, b) => a.level - b.level);
}

function validTime(value) { return typeof value === 'number' && Number.isFinite(value) && value >= 0; }

/** Accuracy always wins. The entire daily/weekly speed bonus is below 100 points. */
export function calculatePerformance(correct, totalTimeMs) {
  if (!Number.isSafeInteger(correct) || correct < 0 || correct > Math.floor((Number.MAX_SAFE_INTEGER - 9900) / 100000)) {
    throw new RangeError('Correct answers must be a non-negative safe integer.');
  }
  const timingComplete = validTime(totalTimeMs);
  const elapsed = timingComplete ? totalTimeMs : null;
  const bonusCent = timingComplete && correct > 0 ? Math.floor(9900 * 120000 / (120000 + elapsed)) : 0;
  return {
    correct, baseScore: correct * 1000, speedBonus: bonusCent / 100,
    score: (correct * 100000 + bonusCent) / 100,
    totalTimeMs: elapsed, timingComplete,
  };
}

/** Descending score, then ascending measured time; a true tie shares a rank. */
export function comparePerformance(a, b) {
  if (a?.correct === 0 && b?.correct === 0) return 0;
  const leftScore = Number.isFinite(a?.score) ? a.score : 0;
  const rightScore = Number.isFinite(b?.score) ? b.score : 0;
  if (leftScore !== rightScore) return rightScore - leftScore;
  const leftTime = validTime(a?.totalTimeMs) ? a.totalTimeMs : Infinity;
  const rightTime = validTime(b?.totalTimeMs) ? b.totalTimeMs : Infinity;
  return leftTime === rightTime ? 0 : leftTime < rightTime ? -1 : 1;
}

export function scoreAnswers(questions, answers = [], timesMs = []) {
  if (!Array.isArray(questions)) throw new TypeError('Questions must be an array.');
  const submissions = Array.isArray(answers) ? answers : [];
  const times = Array.isArray(timesMs) ? timesMs : [];
  const details = questions.map((item, index) => {
    const value = submissions[index];
    const selected = Number.isInteger(value) && value >= 0 && value < item.options.length ? value : null;
    const correct = selected !== null && selected === item.answer;
    return {
      id: item.id, field: item.field, level: item.level, points: 1000,
      elapsedMs: validTime(times[index]) ? times[index] : null,
      selected, answer: item.answer, correct, explanation: item.explanation,
    };
  });
  const elapsed = details.length === 5 && times.length === 5 && details.every(item => validTime(item.elapsedMs))
    ? details.reduce((sum, item) => sum + item.elapsedMs, 0) : null;
  return {
    ...calculatePerformance(details.filter(item => item.correct).length, elapsed),
    scoringVersion: 2,
    total: details.length,
    details,
  };
}

function officialResults(results) {
  const seen = new Set();
  if (!Array.isArray(results)) return [];
  return results.filter(result => {
    if (!result || result.mode !== 'daily' || seen.has(result.date)) return false;
    try { keyToDate(result.date); } catch { return false; }
    if (!Number.isFinite(result.score) || result.score < 0 || result.score > 5099) return false;
    if (!Array.isArray(result.details) || result.total !== 5 || result.details.length !== 5) return false;
    if (!Number.isInteger(result.correct) || result.correct < 0 || result.correct > 5) return false;
    if (result.details.some(item => !item || typeof item.correct !== 'boolean' || !FIELDS.some(field => field.id === item.field))) return false;
    if (new Set(result.details.map(item => item.field)).size !== 5 || result.details.filter(item => item.correct).length !== result.correct) return false;
    seen.add(result.date);
    return true;
  });
}

export function getFieldStats(dailyResults, today = dateKey()) {
  keyToDate(today);
  const earliest = addDays(today, -27);
  const stats = FIELDS.map(({ id, label }) => ({ field: id, label, correct: 0, total: 0, accuracy: null }));
  const byField = new Map(stats.map(item => [item.field, item]));
  for (const result of officialResults(dailyResults)) {
    if (result.date < earliest || result.date > today) continue;
    const fieldsSeen = new Set();
    for (const detail of result.details) {
      if (!detail || typeof detail.correct !== 'boolean' || fieldsSeen.has(detail.field)) continue;
      const item = byField.get(detail.field);
      if (!item) continue;
      fieldsSeen.add(detail.field);
      item.total += 1;
      item.correct += Number(detail.correct);
    }
  }
  for (const item of stats) {
    item.accuracy = item.total ? Math.round(item.correct / item.total * 100) : null;
  }
  return stats;
}

export function rankTier(rank, total) {
  if (!Number.isInteger(rank) || !Number.isInteger(total) || rank < 1 || total < 1 || rank > total) return null;
  // Integer comparisons keep exact cutoff ties in the same tier.
  for (let index = TIERS.length - 1; index >= 0; index -= 1) {
    const tier = TIERS[index];
    if (rank * 100 <= total * tier.ceiling) return tier;
  }
  return null;
}

export function weeklyPerformance(dailyResults, mondayKey) {
  if (weekKey(mondayKey) !== mondayKey) throw new RangeError('Weekly key must be a Monday.');
  const nextMonday = addDays(mondayKey, 7);
  const results = officialResults(dailyResults).filter(result => result.date >= mondayKey && result.date < nextMonday);
  const correct = results.reduce((sum, result) => sum + result.correct, 0);
  const elapsed = results.length && results.every(result => result.timingComplete === true && validTime(result.totalTimeMs))
    ? results.reduce((sum, result) => sum + result.totalTimeMs, 0) : null;
  return { ...calculatePerformance(correct, elapsed), playedDays: results.length };
}

export function weeklyScore(dailyResults, mondayKey) {
  return weeklyPerformance(dailyResults, mondayKey).score;
}
