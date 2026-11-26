/**
 * 방문자 수 집계.
 *
 * harufive.kr 은 GitHub Pages 에 올라가는 정적 사이트라 자체 서버가 없다.
 * 그래서 무료 공개 카운터 API(countapi.mileshilliard.com — 회원가입·키 없음,
 * CORS·HTTPS 지원)를 브라우저에서 직접 호출한다.
 *
 * 규칙
 * - 브라우저 한 대는 하루에 한 번만 `hit` 한다. (같은 사람이 새로고침·재방문해도
 *   숫자가 부풀지 않게) 그 밖의 방문은 `get` 으로 읽기만 한다.
 * - 전체 방문자를 먼저 올리고, 그것이 성공했을 때만 오늘 방문자를 올린다.
 *   그래야 (오늘 방문자) 가 (전체 방문자) 보다 커지는 어긋남이 생기지 않는다.
 * - 외부 API 가 느리거나 죽어도 화면은 깨지지 않는다. 마지막으로 확인된 값을
 *   localStorage 에서 꺼내 보여 주고, 그마저 없으면 `--` 로 둔다.
 */

/** countapi.mileshilliard.com — CountAPI 계열의 무료 후속 서비스. 키는 전역 공개다. */
const ENDPOINT = "https://countapi.mileshilliard.com/api/v1";
const KEY_PREFIX = "harufive_kr";
const TOTAL_KEY = `${KEY_PREFIX}_visits`;
/** 하루 방문자는 날짜별 키로 센다. 자정(한국 시간)이 지나면 새 키가 만들어진다. */
const dayCounterKey = (day: string) => `${KEY_PREFIX}_visits_${day}`;

const SNAPSHOT_KEY = "harufive:visitors:snapshot";
const LAST_VISIT_KEY = "harufive:visitors:counted-day";

const REQUEST_TIMEOUT_MS = 10_000;

export type VisitorStats = {
  /** 오늘 방문자 수. 집계에 실패했고 남은 값도 없으면 null */
  today: number | null;
  /** 전체 방문자 수 */
  total: number | null;
  /** 이번 방문이 오늘 집계에 반영됐는지 */
  counted: boolean;
};

type Snapshot = { day: string; today: number; total: number };

/** 한국 시간 기준 날짜 키. 예) 2026-11-26 → "20261126" */
export function dayStamp(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${pick("year")}${pick("month")}${pick("day")}`;
}

function readSnapshot(): Snapshot | null {
  try {
    const raw = window.localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<Snapshot>;
    if (
      typeof parsed.day !== "string" ||
      typeof parsed.today !== "number" ||
      typeof parsed.total !== "number"
    ) {
      return null;
    }

    return { day: parsed.day, today: parsed.today, total: parsed.total };
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: Snapshot): void {
  try {
    window.localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshot));
  } catch {
    /* 저장 공간이 막혀 있어도 화면은 그대로 동작한다. */
  }
}

/** 오늘 이미 집계했는지. 저장소를 못 읽으면 집계하지 않는 쪽으로 기운다. */
function hasCountedOn(day: string): boolean {
  try {
    return window.localStorage.getItem(LAST_VISIT_KEY) === day;
  } catch {
    return true;
  }
}

function markCountedOn(day: string): void {
  try {
    window.localStorage.setItem(LAST_VISIT_KEY, day);
  } catch {
    /* 무시 */
  }
}

async function requestCounter(
  action: "get" | "hit",
  key: string,
): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${ENDPOINT}/${action}/${key}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    // 아직 한 번도 세지 않은 카운터는 404 다. 그건 0 이다.
    if (response.status === 404) return 0;
    if (!response.ok) throw new Error(`counter ${action} ${response.status}`);

    const data = (await response.json()) as { value?: unknown };
    // 이 서비스는 값을 문자열로 돌려준다. ("value": "12")
    const value = typeof data.value === "string" ? Number(data.value) : data.value;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error("counter: unexpected payload");
    }

    return value;
  } finally {
    clearTimeout(timer);
  }
}

/** 실패는 null 로 바꾼다. 화면 쪽에서는 "모른다"와 "0"을 구분해야 한다. */
async function attempt(
  action: "get" | "hit",
  key: string,
): Promise<number | null> {
  try {
    return await requestCounter(action, key);
  } catch {
    return null;
  }
}

/** 읽기는 값을 바꾸지 않으니 한 번 더 시도해도 안전하다. */
async function attemptRead(key: string): Promise<number | null> {
  const first = await attempt("get", key);
  if (first !== null) return first;

  return attempt("get", key);
}

/** 저장된 마지막 값. 화면이 비어 보이지 않도록 요청 전에 먼저 읽는다. */
export function peekVisitorStats(): Pick<VisitorStats, "today" | "total"> | null {
  const snapshot = readSnapshot();
  if (!snapshot) return null;

  return {
    today: snapshot.day === dayStamp() ? snapshot.today : null,
    total: snapshot.total,
  };
}

function fromCache(day: string, cached: Snapshot | null): VisitorStats {
  return {
    today: cached?.day === day ? cached.today : null,
    total: cached?.total ?? null,
    counted: false,
  };
}

let pending: Promise<VisitorStats> | null = null;

/**
 * 방문자 수를 읽고, 오늘 처음 온 브라우저라면 한 번 집계한다.
 * 한 페이지에서 여러 곳에 숫자를 그려도 요청은 한 번만 나간다.
 */
export function loadVisitorStats(): Promise<VisitorStats> {
  pending ??= collectVisitorStats();
  return pending;
}

async function collectVisitorStats(): Promise<VisitorStats> {
  const day = dayStamp();
  const dayKey = dayCounterKey(day);
  const cached = readSnapshot();

  if (!hasCountedOn(day)) {
    // 전체를 먼저 올린다. 여기서 실패하면 오늘은 올리지 않고 마지막 값을 보여 준다.
    const total = await attempt("hit", TOTAL_KEY);
    if (total === null) return fromCache(day, cached);

    const today = await attempt("hit", dayKey);
    if (today === null) return { ...fromCache(day, cached), total };

    markCountedOn(day);
    writeSnapshot({ day, today, total });
    return { today, total, counted: true };
  }

  const [total, today] = await Promise.all([
    attemptRead(TOTAL_KEY),
    attemptRead(dayKey),
  ]);

  if (total === null && today === null) return fromCache(day, cached);

  const merged: VisitorStats = {
    total: total ?? cached?.total ?? null,
    today: today ?? (cached?.day === day ? cached.today : null),
    counted: false,
  };

  if (merged.today !== null && merged.total !== null) {
    writeSnapshot({ day, today: merged.today, total: merged.total });
  }

  return merged;
}
