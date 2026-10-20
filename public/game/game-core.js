/** Public presentation helpers. Questions, answers, scoring and grants live on the server. */
const DAY_MS=86_400_000;
const KST_OFFSET_MS=9*60*60*1000;
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

