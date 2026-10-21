import { accountAllowedSql } from './privacy-contract.mjs';
import { ADMISSION_POLICY } from './admission-policy.mjs';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { CATALOG } from '../legacy/v040/state.js';
import { dateKey } from '../legacy/v040/game-core.js';

// These are application sign-ins inside a Site. None of the Sites platform's
// /signin-with-chatgpt, /signout-with-chatgpt or /callback routes are replaced.
export const AUTH_PROVIDER_IDS = Object.freeze(['kakao', 'google', 'naver']);
export const AUTH_COOKIES = Object.freeze({ session: '__Host-haru_session', flow: '__Host-haru_oauth' });
export const AUTH_LIMITS = Object.freeze({
  flowMs: 10 * 60 * 1000,
  sessionMs: 7 * 24 * 60 * 60 * 1000,
  bodyBytes: 1024,
  upstreamBytes: 64 * 1024,
  upstreamTimeoutMs: 8000,
  startsPerMinute: 100,
  callbacksPerMinute: 100,
  liveFlows: 4000,
  sessionsPerAccount: 5,
});

const PROVIDERS = Object.freeze({
  kakao: Object.freeze({
    id: 'kakao', name: '카카오', prefix: 'HARU_KAKAO',
    authorize: 'https://kauth.kakao.com/oauth/authorize',
    token: 'https://kauth.kakao.com/oauth/token',
    jwks: 'https://kauth.kakao.com/.well-known/jwks.json',
    issuer: 'https://kauth.kakao.com',
    issuers: ['https://kauth.kakao.com'],
    scope: 'openid',
    requiresOIDCFlag: true,
  }),
  google: Object.freeze({
    id: 'google', name: '구글', prefix: 'HARU_GOOGLE',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    jwks: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: 'https://accounts.google.com',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    scope: 'openid email',
    requiresOIDCFlag: false,
    // Google Security Bundle exposes session age, but does not support account
    // reauthentication requests. Do not infer support from max_age/auth_time.
    supportsReauthentication: false,
  }),
  naver: Object.freeze({
    id: 'naver', name: '네이버', prefix: 'HARU_NAVER',
    authorize: 'https://nid.naver.com/oauth2/authorize',
    token: 'https://nid.naver.com/oauth2/token',
    jwks: 'https://nid.naver.com/oauth2/jwks',
    issuer: 'https://nid.naver.com',
    issuers: ['https://nid.naver.com'],
    scope: 'openid',
    requiresOIDCFlag: false,
  }),
});

const MESSAGES = Object.freeze({
  AUTH_NOT_CONFIGURED: '이 로그인 방식은 서비스 연결을 준비하고 있어요.',
  ORIGIN_REJECTED: '하루다섯 화면을 다시 열고 시도해 주세요.',
  METHOD_NOT_ALLOWED: '허용되지 않은 요청 방식이에요.',
  NOT_FOUND: '요청한 로그인 기능을 찾지 못했어요.',
  JSON_REQUIRED: '요청 형식이 올바르지 않아요.',
  INVALID_REQUEST: '로그인 요청을 확인할 수 없어요. 다시 시작해 주세요.',
  BODY_TOO_LARGE: '로그인 요청이 너무 커요. 다시 시작해 주세요.',
  SIGN_IN_REQUIRED: '먼저 로그인한 뒤 다시 시도해 주세요.',
  ACCOUNT_CHANGED: '계정 정보 화면을 다시 열고 시도해 주세요.',
  RATE_LIMITED: '로그인 요청이 잠시 몰렸어요. 잠시 후 다시 시도해 주세요.',
  SERVICE_UNAVAILABLE: '로그인 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
  INVALID_CREDENTIALS: '아이디 또는 비밀번호를 확인해 주세요.',
  USERNAME_TAKEN: '이미 사용 중인 아이디예요. 다른 아이디를 입력해 주세요.',
  AUTH_RESTART_REQUIRED: '로그인 화면을 새로 열고 다시 시도해 주세요.',
});
const CALLBACK_CODES = new Set([
  'invalid_request', 'state_invalid', 'provider_disabled', 'provider_denied',
  'provider_unavailable', 'verification_failed', 'signup_closed', 'account_conflict',
  'account_changed', 'account_unavailable', 'too_many_requests', 'service_unavailable', 'signup_required',
]);
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const textEncoder = new TextEncoder();
const jwksCaches = new WeakMap();
const PREVIEW_POLICY_VERSION = 'preview-2026-10-21';
const LOCAL_HASH = /^scrypt-v1\$65536\$8\$2\$[a-f0-9]{32}\$[a-f0-9]{64}$/;
const DUMMY_HASH = `scrypt-v1$65536$8$2$${'0'.repeat(32)}$${'0'.repeat(64)}`;

function signupAccepted(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'ageConfirmed,policyAccepted,policyVersion' &&
    value.ageConfirmed === true && value.policyAccepted === true && value.policyVersion === PREVIEW_POLICY_VERSION;
}

function localReady(options) {
  return options.previewRegistration === true && options.loginEnabled === true && !!configuredOrigin(options.env) &&
    typeof options.passwordService?.hash === 'function' && typeof options.passwordService?.verify === 'function' &&
    typeof options.clientAddressHash === 'string' && /^[a-f0-9]{64}$/.test(options.clientAddressHash);
}

class AuthError extends Error {
  constructor(status, code, callbackCode = 'service_unavailable', retryAfter = null) {
    super(MESSAGES[code] || MESSAGES.SERVICE_UNAVAILABLE);
    this.status = status;
    this.code = code;
    this.callbackCode = CALLBACK_CODES.has(callbackCode) ? callbackCode : 'service_unavailable';
    this.retryAfter = retryAfter;
  }
}

function timestamp(now) {
  const value = Math.floor(now());
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('clock_unavailable');
  return value;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function digest(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(value)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function challenge(verifier) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', textEncoder.encode(verifier)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function configuredOrigin(env) {
  try {
    const raw = env?.HARU_AUTH_ORIGIN;
    if (typeof raw !== 'string' || raw.length > 512 || raw !== raw.trim()) return null;
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch { return null; }
}

// Classification only: never return a credential, its length, or its contents.
// The protected preview diagnostic uses the same acceptance rules as login.
export function authCredentialState(value) {
  if (value === undefined || value === null) return 'missing';
  if (typeof value !== 'string') return 'not_text';
  if (!value.trim()) return 'empty';
  if (value.length > 2048) return 'too_long';
  if (/[\r\n\u0000]/.test(value)) return 'invalid_characters';
  return 'present';
}

function credential(env, key) {
  const value = env?.[key];
  return authCredentialState(value) === 'present' ? value : null;
}

function canonicalGmailEmail(value) {
  // Gmail is authoritative for this signed claim. Do not fold dots, aliases or
  // other domains into an address, and never use it to merge account identities.
  if (typeof value !== 'string' || value.length > 254 ||
      !/^[a-z0-9](?:[a-z0-9.]*[a-z0-9])?@gmail\.com$/i.test(value)) return null;
  return value.toLowerCase();
}

function previewOwnerPolicy(value, at) {
  // This option comes only from a dedicated trusted server entry. No request or
  // environment flag can open public admission or claim the operator exception.
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).length !== 2 || !Object.hasOwn(value, 'email') || !Object.hasOwn(value, 'notBefore') ||
      !Number.isSafeInteger(value.notBefore) || value.notBefore <= 0 || value.notBefore > at) return null;
  const email = canonicalGmailEmail(value.email);
  return email ? Object.freeze({ email, notBefore: value.notBefore }) : null;
}

const EMPTY_PREVIEW_ACCOUNT_SQL = `NOT EXISTS (SELECT 1 FROM auth_accounts)
  AND NOT EXISTS (SELECT 1 FROM auth_identities) AND NOT EXISTS (SELECT 1 FROM game_players)`;

function providerConfig(id, env) {
  const provider = Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id] : null;
  if (!provider) return null;
  const origin = configuredOrigin(env);
  const clientId = credential(env, `${provider.prefix}_CLIENT_ID`);
  const clientSecret = credential(env, `${provider.prefix}_CLIENT_SECRET`);
  const oidcEnabled = !provider.requiresOIDCFlag || env?.[`${provider.prefix}_OIDC_ENABLED`] === 'true';
  const reason = !origin ? 'origin_not_configured' : !clientId || !clientSecret ? 'not_configured' : !oidcEnabled ? 'oidc_not_enabled' : 'ready';
  return { ...provider, origin, clientId, clientSecret, enabled: reason === 'ready', reason,
    redirectUri: origin ? `${origin}/api/auth/${id}/callback` : null };
}

function usableDb(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    throw new AuthError(503, 'SERVICE_UNAVAILABLE');
  }
  return typeof db.withSession === 'function' ? db.withSession('first-primary') : db;
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie');
  if (!header) return { present: false, value: null };
  // An oversized or ambiguous cookie cannot fall back to a different identity.
  if (header.length > 16384) return { present: true, value: null };
  const values = header.split(';').map(item => item.trim()).filter(item => item.startsWith(`${name}=`));
  return { present: values.length > 0, value: values.length === 1 ? values[0].slice(name.length + 1) : null };
}

function cookie(name, value, maxAge) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.max(0, Math.floor(maxAge))}`;
}

function responseHeaders() {
  return new Headers({
    'Cache-Control': 'private, no-store',
    'Vary': 'Cookie',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
}

function json(payload, status = 200, cookies = [], extra = {}) {
  const headers = responseHeaders();
  headers.set('Content-Type', 'application/json; charset=utf-8');
  for (const value of cookies) headers.append('Set-Cookie', value);
  for (const [name, value] of Object.entries(extra)) headers.set(name, String(value));
  return new Response(JSON.stringify(payload), { status, headers });
}

function redirect(origin, outcome, isError = false, cookies = []) {
  const headers = responseHeaders();
  const url = new URL('/', origin);
  url.searchParams.set(isError ? 'auth_error' : 'auth', isError && !CALLBACK_CODES.has(outcome) ? 'service_unavailable' : outcome);
  if (!isError && outcome === 'reauthenticated') url.hash = 'privacy';
  headers.set('Location', url.href);
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: 303, headers });
}

function rejectWriteOrigin(request, origin) {
  if (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new AuthError(403, 'ORIGIN_REJECTED');
  }
}

function sitesIdentity(value) {
  return typeof value === 'string' && /^[^\s\u0000-\u001f\u007f]{1,200}$/u.test(value) ? value : null;
}

async function contextHash(request, sitesUserId) {
  const current = readCookie(request, AUTH_COOKIES.session);
  return digest(`${current.present ? `session:${current.value ?? 'ambiguous'}` : 'anonymous'}|sites:${sitesIdentity(sitesUserId) ?? 'anonymous'}`);
}

async function linkedProviders(db, userId) {
  const rows = await db.prepare('SELECT provider FROM auth_identities WHERE account_id = ?').bind(userId).all();
  const found = new Set(rows.results.map(row => row.provider));
  if (await db.prepare('SELECT account_id FROM auth_local_credentials WHERE account_id = ?').bind(userId).first()) found.add('local');
  return [...AUTH_PROVIDER_IDS, 'local'].filter(id => found.has(id));
}

async function resolveInternal(request, { db, env, sitesUserId, sitesEmail, now }) {
  const current = readCookie(request, AUTH_COOKIES.session);
  // Browsers remove expired cookies. Absence is unauthenticated too: it must not
  // silently switch a returning social player to the Sites access-gate account.
  if (!current.present) return null;
  if (current.value !== 'sites') {
    if (!TOKEN.test(current.value || '')) return null;
    const tokenHash = await digest(current.value);
    const row = await db.prepare(`SELECT s.account_id, s.provider, s.created_at, s.authenticated_at FROM auth_sessions s
      JOIN auth_accounts a ON a.id = s.account_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.disabled_at IS NULL AND ${accountAllowedSql('a.id')}`)
      .bind(tokenHash, timestamp(now)).first();
    if (!row) return null;
    return { userId: row.account_id, provider: row.provider, linkedProviders: await linkedProviders(db, row.account_id), sessionHash: tokenHash, sessionCreatedAt: row.created_at, authenticatedAt: row.authenticated_at };
  }
  const userId = sitesIdentity(sitesUserId);
  if (!userId) return null;
  const account = await db.prepare('SELECT disabled_at FROM auth_accounts WHERE id = ?').bind(userId).first();
  if (account && account.disabled_at !== null) return null;
  const permitted = await db.prepare(`SELECT ${accountAllowedSql('candidate.id')} AS allowed FROM (SELECT ? AS id) candidate`).bind(userId).first();
  if (!permitted?.allowed) return null;
  const testerEmail = credential(env, 'HARU_SITES_TESTER_EMAIL');
  const privateTester = testerEmail && typeof sitesEmail === 'string' && sitesEmail.trim().toLowerCase() === testerEmail.trim().toLowerCase();
  // Existing Sites accounts and a trusted private developer remain usable.
  // The developer exception is not proof of age or a public admission route.
  if (!account && !privateTester &&
    !await db.prepare('SELECT id FROM game_players WHERE id = ?').bind(userId).first()) return null;
  // A legacy game account needs no record migration and no email-based lookup.
  return { userId, provider: 'chatgpt', linkedProviders: await linkedProviders(db, userId), sessionHash: null };
}

/** Resolve only a verified opaque app session or the trusted Sites server ID.
 * A present but invalid/expired/revoked/signed-out app cookie and an absent app
 * cookie are unauthenticated. Sites identity requires deliberate sites-start
 * intent plus an existing account. Never read sitesUserId from client headers.
 * @param {Request} request
 * @param {{db?: import('@cloudflare/workers-types').D1Database, env?: any, sitesUserId?: string, sitesEmail?: string, now?: () => number}} [options]
 * @returns {Promise<{userId: string, provider: string, linkedProviders: string[]}|null>}
 */
export async function resolveGameIdentity(request, { db, env = {}, sitesUserId, sitesEmail, now = Date.now } = {}) {
  const database = usableDb(db);
  const resolved = await resolveInternal(request, { db: database, env, sitesUserId, sitesEmail, now });
  if (!resolved) return null;
  return { userId: resolved.userId, provider: resolved.provider, linkedProviders: resolved.linkedProviders };
}

async function readJson(request, allowed) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new AuthError(415, 'JSON_REQUIRED', 'invalid_request');
  }
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > AUTH_LIMITS.bodyBytes)) {
    throw new AuthError(413, 'BODY_TOO_LARGE', 'invalid_request');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AuthError(400, 'INVALID_REQUEST', 'invalid_request');
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > AUTH_LIMITS.bodyBytes) {
        void reader.cancel();
        throw new AuthError(413, 'BODY_TOO_LARGE', 'invalid_request');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new AuthError(400, 'INVALID_REQUEST', 'invalid_request'); }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
    throw new AuthError(400, 'INVALID_REQUEST', 'invalid_request');
  }
  return body;
}

async function rateLimit(db, action, provider, now) {
  const at = timestamp(now);
  const limit = action === 'start' ? AUTH_LIMITS.startsPerMinute : AUTH_LIMITS.callbacksPerMinute;
  const window = Math.floor(at / 60000) * 60000;
  const row = await db.prepare(`INSERT INTO auth_rate_limits (bucket, window_start, request_count) VALUES (?, ?, 1)
    ON CONFLICT(bucket) DO UPDATE SET
      request_count = CASE WHEN excluded.window_start > auth_rate_limits.window_start
        THEN 1 ELSE MIN(auth_rate_limits.request_count + 1, ?) END,
      window_start = MAX(auth_rate_limits.window_start, excluded.window_start)
    RETURNING window_start, request_count`).bind(`${action}:${provider}`, window, limit + 1).first();
  if (!row || row.request_count > limit) {
    const retry = Math.max(1, Math.ceil(((row?.window_start ?? window) + 60000 - timestamp(now)) / 1000));
    throw new AuthError(429, 'RATE_LIMITED', 'too_many_requests', retry);
  }
}

async function cleanup(db, at) {
  await db.batch([
    db.prepare(`DELETE FROM auth_oauth_transactions WHERE state_hash IN
      (SELECT state_hash FROM auth_oauth_transactions WHERE expires_at <= ? ORDER BY expires_at LIMIT 2000)`).bind(at),
    db.prepare(`DELETE FROM auth_sessions WHERE token_hash IN
      (SELECT token_hash FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL ORDER BY expires_at LIMIT 1000)`).bind(at),
  ]);
}

async function boundedFetchJson(fetcher, url, init, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new AuthError(503, 'SERVICE_UNAVAILABLE', 'provider_unavailable'));
    }, Math.min(AUTH_LIMITS.upstreamTimeoutMs, Math.max(1, timeoutMs)));
  });
  const operation = (async () => {
    const response = await fetcher(url, { ...init, redirect: 'manual', signal: controller.signal });
    if (!response.ok || response.redirected || (response.url && response.url !== url)) {
      throw new AuthError(503, 'SERVICE_UNAVAILABLE', 'provider_unavailable');
    }
    const declared = response.headers.get('Content-Length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > AUTH_LIMITS.upstreamBytes)) {
      throw new AuthError(503, 'SERVICE_UNAVAILABLE', 'provider_unavailable');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AuthError(503, 'SERVICE_UNAVAILABLE', 'provider_unavailable');
    const chunks = [];
    let total = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > AUTH_LIMITS.upstreamBytes) {
          void reader.cancel();
          throw new AuthError(503, 'SERVICE_UNAVAILABLE', 'provider_unavailable');
        }
        chunks.push(value);
      }
    } finally {
      controller.signal.removeEventListener('abort', cancel);
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_response');
    return parsed;
  })();
  try { return await Promise.race([operation, timeout]); }
  catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(503, 'SERVICE_UNAVAILABLE', 'provider_unavailable');
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function keySet(provider, { fetch: fetcher, now, timeoutMs }, refresh = false) {
  let cache = jwksCaches.get(fetcher);
  if (!cache) { cache = new Map(); jwksCaches.set(fetcher, cache); }
  const at = timestamp(now);
  const previous = cache.get(provider.id);
  if (previous && at < previous.expiresAt && (!refresh || at - previous.fetchedAt < 30000)) return previous;
  const body = await boundedFetchJson(fetcher, provider.jwks, { method: 'GET', headers: { Accept: 'application/json' } }, timeoutMs);
  if (!Array.isArray(body.keys) || body.keys.length < 1 || body.keys.length > 20) {
    throw new AuthError(503, 'SERVICE_UNAVAILABLE', 'provider_unavailable');
  }
  const keys = body.keys.filter(key => key && key.kty === 'RSA' && (!key.alg || key.alg === 'RS256') &&
    (!key.use || key.use === 'sig') && typeof key.n === 'string' && /^[A-Za-z0-9_-]{342,1366}$/.test(key.n) &&
    typeof key.e === 'string' && /^[A-Za-z0-9_-]{1,16}$/.test(key.e) && !Object.hasOwn(key, 'd'));
  if (!keys.length) throw new AuthError(503, 'SERVICE_UNAVAILABLE', 'provider_unavailable');
  const entry = { resolver: createLocalJWKSet({ keys }), fetchedAt: at, expiresAt: at + 5 * 60 * 1000 };
  cache.set(provider.id, entry);
  return entry;
}

async function verifyIdToken(token, provider, flow, options) {
  if (typeof token !== 'string' || token.length > 16384) throw new AuthError(400, 'INVALID_REQUEST', 'verification_failed');
  const verify = async resolver => jwtVerify(token, resolver, {
    algorithms: ['RS256'], issuer: provider.issuers, audience: provider.clientId,
    requiredClaims: ['iss', 'aud', 'sub', 'iat', 'exp', 'nonce'],
    clockTolerance: 30, maxTokenAge: '10 minutes', currentDate: new Date(timestamp(options.now)),
  });
  try {
    let keys = await keySet(provider, options);
    let result;
    try { result = await verify(keys.resolver); }
    catch (error) {
      if (error?.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw error;
      const refreshed = await keySet(provider, options, true);
      if (refreshed === keys) throw error;
      keys = refreshed;
      result = await verify(keys.resolver);
    }
    const { payload } = result;
    if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 255 || /[\u0000-\u001f\u007f]/.test(payload.sub) ||
      typeof payload.nonce !== 'string' || await digest(payload.nonce) !== flow.nonce_hash ||
      (payload.azp !== undefined && payload.azp !== provider.clientId) ||
      (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== provider.clientId)) {
      throw new Error('invalid_claims');
    }
    // iat is token issuance, not evidence of an interactive authentication.
    // Missing auth_time never falls back to iat, session issuance or this clock.
    let authenticatedAt = null;
    if (payload.auth_time !== undefined) {
      const seconds = payload.auth_time;
      if (!Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
          !Number.isSafeInteger(seconds) || seconds < 0 || !Number.isSafeInteger(seconds * 1000) ||
          seconds * 1000 > timestamp(options.now) || seconds > payload.iat + 30) throw new Error('invalid_auth_time');
      authenticatedAt = seconds * 1000;
    }
    if (flow.intent === 'reauth' && (authenticatedAt === null ||
        authenticatedAt < Math.floor(flow.created_at / 1000) * 1000 - 30000)) throw new Error('reauthentication_missing');
    // Email remains transient, signed evidence for one private operator trial.
    // It is never persisted, returned, used as an account identity or proof of
    // age. All subsequent logins still resolve the provider-subject tuple.
    return { provider: provider.id, issuer: provider.issuer, audience: provider.clientId,
      subject: payload.sub, authenticatedAt, tokenExpiresAt: payload.exp * 1000,
      email: provider.id === 'google' ? canonicalGmailEmail(payload.email) : null,
      emailVerified: provider.id === 'google' && payload.email_verified === true };

  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(400, 'INVALID_REQUEST', 'verification_failed');
  }
}

async function exchangeCode(provider, code, state, flow, options) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code', client_id: provider.clientId, client_secret: provider.clientSecret,
    code, redirect_uri: provider.redirectUri, code_verifier: flow.code_verifier,
  });
  if (provider.id === 'naver') body.set('state', state);
  const result = await boundedFetchJson(options.fetch, provider.token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body: body.toString(),
  }, options.timeoutMs);
  if (result.error || typeof result.id_token !== 'string') throw new AuthError(400, 'INVALID_REQUEST', 'verification_failed');
  return verifyIdToken(result.id_token, provider, flow, options);
}

async function start(request, provider, options) {
  if (!provider?.enabled) throw new AuthError(503, 'AUTH_NOT_CONFIGURED', 'provider_disabled');
  const body = await readJson(request, ['intent', 'signup']);
  if (!['login', 'link', 'reauth'].includes(body.intent)) throw new AuthError(400, 'INVALID_REQUEST', 'invalid_request');
  if (body.signup !== undefined && (!options.previewRegistration || provider.id !== 'google' || body.intent !== 'login' || !signupAccepted(body.signup))) {
    throw new AuthError(400, 'INVALID_REQUEST', 'invalid_request');
  }
  if (body.intent === 'reauth' && provider.supportsReauthentication === false) {
    throw new AuthError(503, 'AUTH_NOT_CONFIGURED', 'provider_disabled');
  }
  if (!(body.intent === 'reauth' ? options.reauthEnabled : options.loginEnabled)) {
    throw new AuthError(503, 'AUTH_NOT_CONFIGURED', 'provider_disabled');
  }
  const { db, now, sitesUserId } = options;
  const account = await resolveInternal(request, options);
  if (body.signup !== undefined && account) throw new AuthError(409, 'ACCOUNT_CHANGED', 'account_changed');
  if (body.intent === 'link' && !account) throw new AuthError(401, 'SIGN_IN_REQUIRED', 'account_changed');
  let reauthIdentity = null;
  if (body.intent === 'reauth') {
    if (!account?.sessionHash) throw new AuthError(401, 'SIGN_IN_REQUIRED', 'account_changed');
    if (request.headers.get('X-Haru-Account') !== await digest(`privacy:${account.sessionHash}`)) {
      throw new AuthError(409, 'ACCOUNT_CHANGED', 'account_changed');
    }
    reauthIdentity = await db.prepare(`SELECT id FROM auth_identities
      WHERE account_id = ? AND provider = ? AND issuer = ? AND audience = ?`)
      .bind(account.userId, provider.id, provider.issuer, provider.clientId).first();
    if (!reauthIdentity) throw new AuthError(403, 'INVALID_REQUEST', 'account_conflict');
  }
  await rateLimit(db, 'start', provider.id, now);
  const at = timestamp(now);
  await cleanup(db, at);
  if (body.intent === 'link') {
    await db.prepare(`INSERT INTO auth_accounts (id, created_at)
      SELECT candidate.id, ? FROM (SELECT ? AS id) candidate WHERE ${accountAllowedSql('candidate.id')}
      ON CONFLICT(id) DO NOTHING`).bind(at, account.userId).run();
  }
  const state = randomToken();
  const binding = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const oldBinding = readCookie(request, AUTH_COOKIES.flow).value;
  if (TOKEN.test(oldBinding || '')) {
    const oldHash = await digest(oldBinding);
    await db.batch([
      db.prepare('DELETE FROM auth_oauth_transactions WHERE binding_hash = ?').bind(oldHash),
      ...(options.previewRegistration ? [db.prepare('DELETE FROM auth_local_requests WHERE binding_hash = ?').bind(oldHash)] : []),
      // Preserve the session actually presented by this browser. Revoke an
      // already-issued but still-undelivered older callback session instead.
      db.prepare(`UPDATE auth_sessions SET revoked_at = ? WHERE binding_hash = ? AND revoked_at IS NULL
        AND token_hash != ?`).bind(at, oldHash, account?.sessionHash || ''),
    ]);
  }
  const linkGate = body.intent !== 'login'
    ? `AND EXISTS (SELECT 1 FROM auth_accounts a WHERE a.id = ? AND ${accountAllowedSql('a.id')})
      ${account.sessionHash ? 'AND EXISTS (SELECT 1 FROM auth_sessions s WHERE s.token_hash = ? AND s.account_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?)' : ''}` : '';
  const linkValues = body.intent !== 'login' ? [account.userId,
    ...(account.sessionHash ? [account.sessionHash, account.userId, at] : [])] : [];
  const inserted = await db.prepare(`INSERT INTO auth_oauth_transactions
    (state_hash, binding_hash, provider, audience, intent, account_id, session_hash, identity_id, context_hash, nonce_hash, code_verifier, created_at, expires_at, signup_policy_version, signup_confirmed_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM auth_oauth_transactions) < ? ${linkGate}
      ${reauthIdentity ? `AND EXISTS (SELECT 1 FROM auth_identities WHERE id = ? AND account_id = ? AND provider = ? AND issuer = ? AND audience = ?)
        AND EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash = ? AND account_id = ? AND revoked_at IS NULL
          AND CAST(created_at / 1000 AS INTEGER) <= unixepoch('now') AND CAST(expires_at / 1000 AS INTEGER) > unixepoch('now'))` : ''}
    RETURNING state_hash`).bind(
      await digest(state), await digest(binding), provider.id, provider.clientId, body.intent,
      body.intent !== 'login' ? account.userId : null, reauthIdentity ? account.sessionHash : null, reauthIdentity?.id ?? null,
      await contextHash(request, sitesUserId), await digest(nonce), verifier, at, at + AUTH_LIMITS.flowMs,
      body.signup ? PREVIEW_POLICY_VERSION : null, body.signup ? at : null, AUTH_LIMITS.liveFlows, ...linkValues,
      ...(reauthIdentity ? [reauthIdentity.id, account.userId, provider.id, provider.issuer, provider.clientId, account.sessionHash, account.userId] : []),
    ).first();
  if (!inserted) throw new AuthError(429, 'RATE_LIMITED', 'too_many_requests', 60);
  const url = new URL(provider.authorize);
  for (const [key, value] of Object.entries({
    response_type: 'code', client_id: provider.clientId, redirect_uri: provider.redirectUri,
    scope: provider.scope, state, nonce, code_challenge: await challenge(verifier), code_challenge_method: 'S256',
  })) url.searchParams.set(key, value);
  if (body.intent === 'reauth') {
    // Preparation only: providers must supply signed auth_time. Unsupported
    // parameters or silent SSO cannot be accepted as successful reauthentication.
    url.searchParams.set('max_age', '0');
    if (provider.id === 'kakao') url.searchParams.set('prompt', 'login');
    if (provider.id === 'naver') url.searchParams.set('auth_type', 'reauthenticate');
  } else if (provider.id === 'google') url.searchParams.set('prompt', 'select_account');
  // Authorization state/verifier live for 10 minutes in D1. The opaque browser
  // binding remains for a session lifetime so a late HTTP response cannot undo
  // logout: logout can revoke even an issued session not yet seen by the client.
  return json({ url: url.href }, 200, [cookie(AUTH_COOKIES.flow, binding, (AUTH_LIMITS.sessionMs + AUTH_LIMITS.flowMs) / 1000)]);
}

function identityParameters(identity) {
  return [identity.provider, identity.issuer, identity.audience, identity.subject];
}

const IDENTITY_WHERE = 'provider = ? AND issuer = ? AND audience = ? AND subject = ?';

async function linkIdentity(request, identity, flow, options) {
  const { db, now } = options;
  const account = await resolveInternal(request, options);
  if (!account || account.userId !== flow.account_id || await contextHash(request, options.sitesUserId) !== flow.context_hash) {
    throw new AuthError(401, 'SIGN_IN_REQUIRED', 'account_changed');
  }
  const at = timestamp(now);
  const proof = [flow.state_hash, flow.claim_token, at];
  const conditions = account.sessionHash ? `AND EXISTS (SELECT 1 FROM auth_sessions s
    WHERE s.token_hash = ? AND s.account_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?)` : '';
  const values = [crypto.randomUUID(), account.userId, ...identityParameters(identity), at, account.userId, ...identityParameters(identity), account.userId, identity.provider, ...proof];
  if (account.sessionHash) values.push(account.sessionHash, account.userId, at);
  const committed = await db.batch([db.prepare(`INSERT INTO auth_identities (id, account_id, provider, issuer, audience, subject, linked_at)
    SELECT ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM auth_accounts a WHERE a.id = ? AND a.disabled_at IS NULL AND ${accountAllowedSql('a.id')})
      AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE ${IDENTITY_WHERE})
      AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE account_id = ? AND provider = ?)
      AND EXISTS (SELECT 1 FROM auth_oauth_transactions WHERE state_hash = ? AND claim_token = ? AND expires_at > ?)
      ${conditions}`).bind(...values),
    db.prepare(`DELETE FROM auth_oauth_transactions WHERE state_hash = ? AND claim_token = ? AND expires_at > ? RETURNING state_hash`).bind(...proof),
  ]);
  if (!committed[1].results.length) throw new AuthError(401, 'SIGN_IN_REQUIRED', 'account_changed');
  const owner = await db.prepare(`SELECT account_id FROM auth_identities WHERE ${IDENTITY_WHERE}`).bind(...identityParameters(identity)).first();
  if (!owner || owner.account_id !== account.userId) throw new AuthError(409, 'INVALID_REQUEST', 'account_conflict');
  // A parallel logout/revocation must not turn a completed provider redirect into
  // authority to attach a new login method after that session was withdrawn.
  if (!await resolveInternal(request, options)) throw new AuthError(401, 'SIGN_IN_REQUIRED', 'account_changed');
}

async function createPreviewOwnerSession(identity, flow, options) {
  const { db, now, previewOwnerEnrollment: policy } = options;
  const at = timestamp(now);
  if (!policy || !options.loginEnabled || flow.intent !== 'login' || identity.provider !== 'google' ||
      identity.emailVerified !== true || identity.email !== policy.email ||
      !Number.isSafeInteger(flow.created_at) || flow.created_at < policy.notBefore || flow.created_at > at ||
      !Number.isSafeInteger(identity.tokenExpiresAt) || identity.tokenExpiresAt <= at) {
    throw new AuthError(403, 'INVALID_REQUEST', 'signup_closed');
  }
  const accountId = `preview-owner-${crypto.randomUUID()}`;
  const identityId = crypto.randomUUID();
  const rawToken = randomToken();
  const tokenHash = await digest(rawToken);
  const created = 'EXISTS (SELECT 1 FROM auth_accounts WHERE id = ?)';
  const tuple = identityParameters(identity);
  const result = await db.batch([
    // This first conditional write is the admission point. Recheck the empty
    // database and cancellable flow inside the transaction; an earlier JS read
    // must not authorize a parallel callback, logout or a now-expired flow.
    db.prepare(`INSERT INTO auth_accounts (id, created_at)
      SELECT ?, ? FROM auth_oauth_transactions f
      WHERE f.state_hash = ? AND f.claim_token = ? AND f.intent = 'login'
        AND f.provider = 'google' AND f.audience = ? AND f.binding_hash = ? AND f.context_hash = ?
        AND f.created_at >= ? AND f.created_at <= ? AND f.expires_at > ?
        AND CAST(f.created_at / 1000 AS INTEGER) <= unixepoch('now')
        AND CAST(f.expires_at / 1000 AS INTEGER) > unixepoch('now')
        AND CAST(? / 1000 AS INTEGER) > unixepoch('now')
        AND ${EMPTY_PREVIEW_ACCOUNT_SQL} AND ${accountAllowedSql('?')}
      RETURNING id`).bind(accountId, at, flow.state_hash, flow.claim_token, identity.audience,
        flow.binding_hash, flow.context_hash, policy.notBefore, at, at, identity.tokenExpiresAt, accountId, accountId),
    db.prepare(`INSERT INTO auth_identities (id, account_id, provider, issuer, audience, subject, linked_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${created}`)
      .bind(identityId, accountId, ...tuple, at, accountId),
    db.prepare(`INSERT INTO auth_sessions
      (token_hash, binding_hash, account_id, provider, created_at, expires_at, authenticated_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${created}`)
      .bind(tokenHash, flow.binding_hash, accountId, identity.provider, at,
        at + AUTH_LIMITS.sessionMs, identity.authenticatedAt, accountId),
    db.prepare(`DELETE FROM auth_oauth_transactions WHERE state_hash = ? AND claim_token = ? AND ${created}`)
      .bind(flow.state_hash, flow.claim_token, accountId),
    // Any SQL failure or partial insertion rolls back the account as well as
    // its identity/session. A rejected first insert leaves all three absent.
    db.prepare(`SELECT CASE WHEN (
      NOT ${created} AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash = ?)) OR (
      ${created} AND EXISTS (SELECT 1 FROM auth_identities WHERE id = ? AND account_id = ? AND ${IDENTITY_WHERE})
        AND EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash = ? AND account_id = ? AND revoked_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM auth_oauth_transactions WHERE state_hash = ? AND claim_token = ?)
        AND (SELECT COUNT(*) FROM auth_accounts) = 1 AND (SELECT COUNT(*) FROM auth_identities) = 1
        AND NOT EXISTS (SELECT 1 FROM game_players))
      THEN 1 ELSE json('') END AS complete`).bind(accountId, identityId, tokenHash,
        accountId, identityId, accountId, ...tuple, tokenHash, accountId, flow.state_hash, flow.claim_token),
  ]);
  if (!result[0].results.length) throw new AuthError(403, 'INVALID_REQUEST', 'signup_closed');
  return cookie(AUTH_COOKIES.session, rawToken, AUTH_LIMITS.sessionMs / 1000);
}

function newPlayerStatements(db, accountId, nickname, at, acceptedAt = at) {
  const exists = 'EXISTS (SELECT 1 FROM auth_accounts WHERE id = ?)';
  return [
    db.prepare(`INSERT INTO game_players
      (id,public_id,name,coins,owned,equipped,active_id,revision,mutation_token,created_day,created_at)
      SELECT ?,?,?,180,?,?,NULL,0,NULL,?,? WHERE ${exists}`)
      .bind(accountId, crypto.randomUUID(), nickname, JSON.stringify(CATALOG.filter(item => item.cost === 0).map(item => item.id)),
        JSON.stringify({ character: 'rabbit', outfit: 'mint', hat: 'none', accessory: 'none', background: 'garden' }), dateKey(at), at, accountId),
    db.prepare(`INSERT INTO game_coin_ledger(user_id,reference,reason,amount,created_at)
      SELECT ?,'welcome','welcome',180,? WHERE ${exists}`).bind(accountId, at, accountId),
    db.prepare(`INSERT INTO auth_registration_consents(account_id,policy_version,self_declared_14,accepted_at)
      SELECT ?,?,1,? WHERE ${exists}`).bind(accountId, PREVIEW_POLICY_VERSION, acceptedAt, accountId),
  ];
}

async function createPreviewGoogleSession(identity, flow, options) {
  const { db, now } = options;
  const at = timestamp(now);
  if (identity.provider !== 'google' || flow.intent !== 'login' || !options.loginEnabled ||
      flow.signup_policy_version !== PREVIEW_POLICY_VERSION || flow.signup_confirmed_at !== flow.created_at ||
      !Number.isSafeInteger(identity.tokenExpiresAt) || identity.tokenExpiresAt <= at) {
    throw new AuthError(403, 'INVALID_REQUEST', 'signup_required');
  }
  const accountId = `preview-${crypto.randomUUID()}`;
  const identityId = crypto.randomUUID(), rawToken = randomToken(), tokenHash = await digest(rawToken);
  const exists = 'EXISTS (SELECT 1 FROM auth_accounts WHERE id = ?)';
  const result = await db.batch([
    db.prepare(`INSERT INTO auth_accounts(id,created_at)
      SELECT ?,? FROM auth_oauth_transactions f WHERE f.state_hash=? AND f.claim_token=?
        AND f.provider='google' AND f.intent='login' AND f.audience=? AND f.binding_hash=? AND f.context_hash=?
        AND f.signup_policy_version=? AND f.signup_confirmed_at=f.created_at AND f.created_at<=? AND f.expires_at>?
        AND CAST(f.expires_at / 1000 AS INTEGER)>unixepoch('now')
        AND CAST(? / 1000 AS INTEGER)>unixepoch('now')
        AND NOT EXISTS(SELECT 1 FROM auth_identities WHERE ${IDENTITY_WHERE})
        AND ${accountAllowedSql('?')} RETURNING id`)
      .bind(accountId, at, flow.state_hash, flow.claim_token, identity.audience, flow.binding_hash, flow.context_hash,
        PREVIEW_POLICY_VERSION, at, at, identity.tokenExpiresAt, ...identityParameters(identity), accountId, accountId),
    db.prepare(`INSERT INTO auth_identities(id,account_id,provider,issuer,audience,subject,linked_at)
      SELECT ?,?,?,?,?,?,? WHERE ${exists}`).bind(identityId, accountId, ...identityParameters(identity), at, accountId),
    ...newPlayerStatements(db, accountId, '구름토끼', at, flow.signup_confirmed_at),
    db.prepare(`INSERT INTO auth_sessions(token_hash,binding_hash,account_id,provider,created_at,expires_at,authenticated_at)
      SELECT ?,?,?,'google',?,?,? WHERE ${exists}`)
      .bind(tokenHash, flow.binding_hash, accountId, at, at + AUTH_LIMITS.sessionMs, identity.authenticatedAt, accountId),
    db.prepare(`DELETE FROM auth_oauth_transactions WHERE state_hash=? AND claim_token=? AND ${exists}`)
      .bind(flow.state_hash, flow.claim_token, accountId),
  ]);
  if (!result[0].results.length) throw new AuthError(409, 'ACCOUNT_CHANGED', 'account_changed');
  return cookie(AUTH_COOKIES.session, rawToken, AUTH_LIMITS.sessionMs / 1000);
}

async function localRateLimit(options, username, action) {
  const { db, now } = options, at = timestamp(now), window = Math.floor(at / 60000) * 60000;
  const specs = [[`ip:${options.clientAddressHash}`, 30], [`username:${await digest(username)}`, 10], [`all:${action}`, 60]];
  await db.prepare('DELETE FROM auth_local_rate_limits WHERE expires_at <= ?').bind(at).run();
  for (const [bucket, limit] of specs) {
    const row = await db.prepare(`INSERT INTO auth_local_rate_limits(bucket,window_start,request_count,expires_at) VALUES(?,?,1,?)
      ON CONFLICT(bucket) DO UPDATE SET
        request_count=CASE WHEN excluded.window_start>auth_local_rate_limits.window_start THEN 1 ELSE MIN(auth_local_rate_limits.request_count+1,?) END,
        window_start=MAX(auth_local_rate_limits.window_start,excluded.window_start),expires_at=MAX(auth_local_rate_limits.expires_at,excluded.expires_at)
      RETURNING request_count`).bind(bucket, window, window + 120000, limit + 1).first();
    if (!row || row.request_count > limit) throw new AuthError(429, 'RATE_LIMITED', 'too_many_requests', 60);
  }
}

async function localAuthentication(request, options, register) {
  if (!localReady(options)) throw new AuthError(503, 'AUTH_NOT_CONFIGURED');
  const { db, now } = options;
  const body = await readJson(request, register ? ['username','password','nickname','ageConfirmed','policyAccepted','policyVersion'] : ['username','password']);
  if (typeof body.username !== 'string' || !/^[a-z0-9_]{4,24}$/.test(body.username) ||
      typeof body.password !== 'string' || body.password.length < 8 || body.password.length > (register ? 16 : 128)) {
    throw new AuthError(400, 'INVALID_REQUEST');
  }
  let nickname;
  if (register) {
    nickname = typeof body.nickname === 'string' ? body.nickname.trim().replace(/\s+/g, ' ') : '';
    if (!/^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]{2,12}$/.test(nickname) ||
        !signupAccepted({ ageConfirmed: body.ageConfirmed, policyAccepted: body.policyAccepted, policyVersion: body.policyVersion })) {
      throw new AuthError(400, 'INVALID_REQUEST');
    }
  }
  if (await resolveInternal(request, options)) throw new AuthError(409, 'ACCOUNT_CHANGED');
  const binding = readCookie(request, AUTH_COOKIES.flow).value;
  if (!TOKEN.test(binding || '')) throw new AuthError(409, 'AUTH_RESTART_REQUIRED');
  await localRateLimit(options, body.username, register ? 'register' : 'login');
  const at = timestamp(now), id = crypto.randomUUID(), bindingHash = await digest(binding);
  const context = await contextHash(request, options.sitesUserId);
  await db.batch([
    db.prepare('DELETE FROM auth_local_requests WHERE expires_at<=? OR binding_hash=?').bind(at, bindingHash),
    db.prepare('DELETE FROM auth_oauth_transactions WHERE binding_hash=?').bind(bindingHash),
    db.prepare('UPDATE auth_sessions SET revoked_at=? WHERE binding_hash=? AND revoked_at IS NULL').bind(at, bindingHash),
    db.prepare(`INSERT INTO auth_local_requests(id,binding_hash,context_hash,action,created_at,expires_at) VALUES(?,?,?,?,?,?)`)
      .bind(id, bindingHash, context, register ? 'register' : 'login', at, at + 120000),
  ]);
  try {
    const credential = await db.prepare(`SELECT c.account_id,c.password_hash,a.disabled_at,
      ${accountAllowedSql('a.id')} AS allowed FROM auth_local_credentials c JOIN auth_accounts a ON a.id=c.account_id WHERE c.username=?`)
      .bind(body.username).first();
    let encoded;
    if (register) {
      if (credential) throw new AuthError(409, 'USERNAME_TAKEN');
      encoded = await options.passwordService.hash(body.password);
      if (typeof encoded !== 'string' || !LOCAL_HASH.test(encoded)) throw new AuthError(503, 'SERVICE_UNAVAILABLE');
    } else {
      const good = await options.passwordService.verify(body.password, credential && LOCAL_HASH.test(credential.password_hash) ? credential.password_hash : DUMMY_HASH);
      if (good !== true || !credential || credential.disabled_at !== null || !credential.allowed) throw new AuthError(401, 'INVALID_CREDENTIALS');
    }
    const completedAt = timestamp(now), rawToken = randomToken(), tokenHash = await digest(rawToken);
    const accountId = register ? `preview-${crypto.randomUUID()}` : credential.account_id;
    const proof = [id, bindingHash, context, completedAt];
    const live = `EXISTS(SELECT 1 FROM auth_local_requests WHERE id=? AND binding_hash=? AND context_hash=? AND expires_at>?
      AND CAST(expires_at / 1000 AS INTEGER)>unixepoch('now'))`;
    let statements;
    if (register) {
      const exists = 'EXISTS(SELECT 1 FROM auth_accounts WHERE id=?)';
      statements = [
        db.prepare(`INSERT INTO auth_accounts(id,created_at) SELECT ?,? WHERE ${live}
          AND NOT EXISTS(SELECT 1 FROM auth_local_credentials WHERE username=?) AND ${accountAllowedSql('?')} RETURNING id`)
          .bind(accountId, completedAt, ...proof, body.username, accountId, accountId),
        db.prepare(`INSERT INTO auth_local_credentials(username,account_id,password_hash,created_at) SELECT ?,?,?,? WHERE ${exists}`)
          .bind(body.username, accountId, encoded, completedAt, accountId),
        ...newPlayerStatements(db, accountId, nickname, completedAt, at),
        db.prepare(`INSERT INTO auth_sessions(token_hash,binding_hash,account_id,provider,created_at,expires_at,authenticated_at)
          SELECT ?,?,?,'local',?,?,? WHERE ${exists}`)
          .bind(tokenHash, bindingHash, accountId, completedAt, completedAt + AUTH_LIMITS.sessionMs, completedAt, accountId),
      ];
    } else {
      statements = [db.prepare(`INSERT INTO auth_sessions(token_hash,binding_hash,account_id,provider,created_at,expires_at,authenticated_at)
        SELECT ?,?,a.id,'local',?,?,? FROM auth_accounts a JOIN auth_local_credentials c ON c.account_id=a.id
        WHERE a.id=? AND c.username=? AND c.password_hash=? AND a.disabled_at IS NULL AND ${accountAllowedSql('a.id')} AND ${live} RETURNING token_hash`)
        .bind(tokenHash, bindingHash, completedAt, completedAt + AUTH_LIMITS.sessionMs, completedAt,
          accountId, body.username, credential.password_hash, ...proof),
      db.prepare(`DELETE FROM auth_sessions WHERE token_hash IN(SELECT token_hash FROM auth_sessions
        WHERE account_id=? AND token_hash!=? ORDER BY created_at DESC,token_hash DESC LIMIT -1 OFFSET ?)
        AND EXISTS(SELECT 1 FROM auth_sessions WHERE token_hash=?)`)
        .bind(accountId, tokenHash, AUTH_LIMITS.sessionsPerAccount - 1, tokenHash)];
    }
    statements.push(db.prepare('DELETE FROM auth_local_requests WHERE id=?').bind(id));
    const committed = await db.batch(statements);
    if (!committed[0].results.length) {
      if (register && await db.prepare('SELECT username FROM auth_local_credentials WHERE username=?').bind(body.username).first()) throw new AuthError(409, 'USERNAME_TAKEN');
      throw new AuthError(409, 'AUTH_RESTART_REQUIRED');
    }
    return json({ authenticated: true }, 200, [cookie(AUTH_COOKIES.session, rawToken, AUTH_LIMITS.sessionMs / 1000)]);
  } finally {
    // Any failure, logout or newer login invalidates this one-use claim.
    await db.prepare('DELETE FROM auth_local_requests WHERE id=?').bind(id).run();
  }
}

async function createSession(identity, flow, options) {
  const { db, now } = options;
  const tuple = identityParameters(identity);
  const existing = await db.prepare(`SELECT account_id FROM auth_identities WHERE ${IDENTITY_WHERE}`).bind(...tuple).first();
  // The private operator exception is separate from age-based public admission.
  // With its default null option, new identities remain closed as before.
  if (!existing) return options.previewRegistration ? createPreviewGoogleSession(identity, flow, options) : createPreviewOwnerSession(identity, flow, options);
  const at = timestamp(now);
  const proof = [flow.state_hash, flow.claim_token, at];
  const liveFlow = 'EXISTS (SELECT 1 FROM auth_oauth_transactions WHERE state_hash = ? AND claim_token = ? AND expires_at > ?)';
  const rawToken = randomToken();
  const tokenHash = await digest(rawToken);
  const statements = [];
  // Resolve only the existing identity inside the same transaction. Concurrent
  // sign-ins cannot create accounts or move provider-subject ownership.
  statements.push(db.prepare(`DELETE FROM auth_sessions WHERE token_hash IN (
    SELECT s.token_hash FROM auth_sessions s JOIN auth_identities i ON i.account_id = s.account_id
    WHERE i.provider = ? AND i.issuer = ? AND i.audience = ? AND i.subject = ?
    ORDER BY s.created_at DESC, s.token_hash DESC LIMIT -1 OFFSET ?) AND ${liveFlow}`)
    .bind(...tuple, AUTH_LIMITS.sessionsPerAccount - 1, ...proof));
  statements.push(db.prepare(`INSERT INTO auth_sessions (token_hash, binding_hash, account_id, provider, created_at, expires_at, authenticated_at)
    SELECT ?, ?, i.account_id, ?, ?, ?, ? FROM auth_identities i JOIN auth_accounts a ON a.id = i.account_id
    WHERE i.provider = ? AND i.issuer = ? AND i.audience = ? AND i.subject = ? AND a.disabled_at IS NULL AND ${accountAllowedSql('a.id')} AND ${liveFlow}`)
    .bind(tokenHash, flow.binding_hash, identity.provider, at, at + AUTH_LIMITS.sessionMs, identity.authenticatedAt, ...tuple, ...proof));
  statements.push(db.prepare(`DELETE FROM auth_oauth_transactions WHERE state_hash = ? AND claim_token = ? AND expires_at > ? RETURNING state_hash`).bind(...proof));
  const committed = await db.batch(statements);
  if (!committed.at(-1).results.length) throw new AuthError(401, 'SIGN_IN_REQUIRED', 'account_changed');
  const session = await db.prepare('SELECT account_id FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).first();
  if (!session) throw new AuthError(403, 'SIGN_IN_REQUIRED', 'account_unavailable');
  return cookie(AUTH_COOKIES.session, rawToken, AUTH_LIMITS.sessionMs / 1000);
}

// Rotate only the existing session pinned at start. This path never calls
// createSession/linkIdentity and cannot create accounts, identities or players.
async function reauthenticate(request, identity, flow, options) {
  const { db, now } = options;
  const account = await resolveInternal(request, options);
  if (!account?.sessionHash || account.userId !== flow.account_id || account.sessionHash !== flow.session_hash ||
      await contextHash(request, options.sitesUserId) !== flow.context_hash) {
    throw new AuthError(401, 'SIGN_IN_REQUIRED', 'account_changed');
  }
  const at = timestamp(now);
  const rawToken = randomToken();
  const tokenHash = await digest(rawToken);
  const inserted = `EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash = ? AND account_id = ?)`;
  const result = await db.batch([
    // The first conditional write is the authorization point. Later statements
    // complete that same operation rather than rechecking clocks halfway through.
    db.prepare(`INSERT INTO auth_sessions
      (token_hash, binding_hash, account_id, provider, created_at, expires_at, authenticated_at)
      SELECT ?, f.binding_hash, f.account_id, f.provider, ?, ?, ? FROM auth_oauth_transactions f
      JOIN auth_sessions previous ON previous.token_hash = f.session_hash AND previous.account_id = f.account_id
      JOIN auth_identities i ON i.id = f.identity_id AND i.account_id = f.account_id
      JOIN auth_accounts a ON a.id = f.account_id
      WHERE f.state_hash = ? AND f.claim_token = ? AND f.intent = 'reauth'
        AND f.session_hash = ? AND f.account_id = ? AND f.identity_id = ?
        AND f.provider = ? AND f.audience = ? AND i.provider = ? AND i.issuer = ? AND i.audience = ? AND i.subject = ?
        AND previous.revoked_at IS NULL AND a.disabled_at IS NULL AND ${accountAllowedSql('a.id')}
        AND CAST(previous.created_at / 1000 AS INTEGER) <= unixepoch('now')
        AND CAST(previous.expires_at / 1000 AS INTEGER) > unixepoch('now')
        AND CAST(f.expires_at / 1000 AS INTEGER) > unixepoch('now')
        AND CAST(? / 1000 AS INTEGER) > unixepoch('now')
        AND CAST(? / 1000 AS INTEGER) <= unixepoch('now')
        AND CAST((? + 900000) / 1000 AS INTEGER) > unixepoch('now')
        AND ? >= (CAST(f.created_at / 1000 AS INTEGER) - 30) * 1000
      RETURNING token_hash`).bind(tokenHash, at, at + AUTH_LIMITS.sessionMs, identity.authenticatedAt,
        flow.state_hash, flow.claim_token, flow.session_hash, flow.account_id, flow.identity_id,
        identity.provider, identity.audience, ...identityParameters(identity), identity.tokenExpiresAt,
        identity.authenticatedAt, identity.authenticatedAt, identity.authenticatedAt),
    db.prepare(`UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND account_id = ?
      AND revoked_at IS NULL AND ${inserted}`).bind(at, flow.session_hash, flow.account_id, tokenHash, flow.account_id),
    db.prepare(`DELETE FROM auth_oauth_transactions WHERE state_hash = ? AND claim_token = ?
      AND ${inserted}`).bind(flow.state_hash, flow.claim_token, tokenHash, flow.account_id),
    // Fail the entire transaction if only part of the rotation took effect.
    db.prepare(`SELECT CASE WHEN NOT ${inserted} OR (
      EXISTS (SELECT 1 FROM auth_sessions WHERE token_hash = ? AND account_id = ? AND revoked_at IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM auth_oauth_transactions WHERE state_hash = ? AND claim_token = ?))
      THEN 1 ELSE json('') END AS complete`).bind(tokenHash, flow.account_id, flow.session_hash,
        flow.account_id, flow.state_hash, flow.claim_token),
  ]);
  if (!result[0].results.length) throw new AuthError(401, 'SIGN_IN_REQUIRED', 'account_changed');
  return cookie(AUTH_COOKIES.session, rawToken, AUTH_LIMITS.sessionMs / 1000);
}

async function callback(request, provider, options) {
  const origin = configuredOrigin(options.env);
  let claimedFlow;
  try {
    if (!provider?.enabled) throw new AuthError(503, 'AUTH_NOT_CONFIGURED', 'provider_disabled');
    const url = new URL(request.url);
    if (url.search.length > 8192) throw new AuthError(400, 'INVALID_REQUEST', 'invalid_request');
    const allowed = new Set(['state', 'code', 'error', 'error_description', 'error_uri', 'scope', 'authuser', 'prompt', 'iss']);
    if ([...url.searchParams.keys()].some(key => !allowed.has(key) || url.searchParams.getAll(key).length !== 1)) {
      throw new AuthError(400, 'INVALID_REQUEST', 'invalid_request');
    }
    const state = url.searchParams.get('state');
    const binding = readCookie(request, AUTH_COOKIES.flow).value;
    if (!TOKEN.test(state || '') || !TOKEN.test(binding || '')) throw new AuthError(400, 'INVALID_REQUEST', 'state_invalid');
    const at = timestamp(options.now);
    const flow = await options.db.prepare(`UPDATE auth_oauth_transactions SET claim_token = ?
      WHERE state_hash = ? AND binding_hash = ? AND provider = ? AND audience = ?
        AND context_hash = ? AND expires_at > ? AND claim_token IS NULL RETURNING *`)
      .bind(crypto.randomUUID(), await digest(state), await digest(binding), provider.id, provider.clientId,
        await contextHash(request, options.sitesUserId), at).first();
    if (!flow) throw new AuthError(400, 'INVALID_REQUEST', 'state_invalid');
    claimedFlow = flow;
    // A previously persisted flow must honor the current provider contract
    // before exchanging any authorization code or mutating account sessions.
    if (flow.intent === 'reauth' && provider.supportsReauthentication === false) {
      throw new AuthError(503, 'AUTH_NOT_CONFIGURED', 'provider_disabled');
    }
    if (!(flow.intent === 'reauth' ? options.reauthEnabled : options.loginEnabled)) {
      throw new AuthError(503, 'AUTH_NOT_CONFIGURED', 'provider_disabled');
    }
    if (url.searchParams.has('error')) throw new AuthError(400, 'INVALID_REQUEST', 'provider_denied');
    const authorizationIssuer = url.searchParams.get('iss');
    if (authorizationIssuer && !provider.issuers.includes(authorizationIssuer)) throw new AuthError(400, 'INVALID_REQUEST', 'verification_failed');
    const code = url.searchParams.get('code');
    if (typeof code !== 'string' || code.length < 1 || code.length > 4096 || /[\u0000-\u001f\u007f]/.test(code)) {
      throw new AuthError(400, 'INVALID_REQUEST', 'invalid_request');
    }
    await rateLimit(options.db, 'callback', provider.id, options.now);
    const identity = await exchangeCode(provider, code, state, flow, options);
    if (timestamp(options.now) >= flow.expires_at) throw new AuthError(400, 'INVALID_REQUEST', 'state_invalid');
    // Do not clear a cookie from a callback response: this response could arrive
    // after a newer flow has set its own binding in another tab.
    const cookies = [];
    if (flow.intent === 'link') {
      await linkIdentity(request, identity, flow, options);
      return redirect(origin, 'linked', false, cookies);
    }
    if (flow.intent === 'reauth') {
      cookies.push(await reauthenticate(request, identity, flow, options));
      return redirect(origin, 'reauthenticated', false, cookies);
    }
    cookies.push(await createSession(identity, flow, options));
    return redirect(origin, 'success', false, cookies);
  } catch (error) {
    return redirect(origin, error instanceof AuthError ? error.callbackCode : 'service_unavailable', true);
  } finally {
    if (claimedFlow) {
      // Keep claimed rows cancellable during provider I/O, then discard every
      // failed or completed flow. A cancelled claim cannot recreate itself.
      await options.db.prepare('DELETE FROM auth_oauth_transactions WHERE state_hash = ? AND claim_token = ?')
        .bind(claimedFlow.state_hash, claimedFlow.claim_token).run();
    }
  }
}

async function endSession(request, options, resumeSites) {
  await readJson(request, []);
  const at = timestamp(options.now);
  const current = readCookie(request, AUTH_COOKIES.session).value;
  const flow = readCookie(request, AUTH_COOKIES.flow).value;
  const statements = [];
  if (TOKEN.test(current || '')) statements.push(options.db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').bind(at, await digest(current)));
  if (TOKEN.test(flow || '')) {
    const binding = await digest(flow);
    statements.push(options.db.prepare('DELETE FROM auth_oauth_transactions WHERE binding_hash = ?').bind(binding));
    if (options.previewRegistration) statements.push(options.db.prepare('DELETE FROM auth_local_requests WHERE binding_hash = ?').bind(binding));
    statements.push(options.db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE binding_hash = ? AND revoked_at IS NULL').bind(at, binding));
  }
  if (statements.length) await options.db.batch(statements);
  return json(resumeSites ? { url: '/signin-with-chatgpt?return_to=%2F' } : { authenticated: false }, 200, [
    cookie(AUTH_COOKIES.session, resumeSites ? 'sites' : 'signed-out', 365 * 24 * 60 * 60),
    cookie(AUTH_COOKIES.flow, '', 0),
  ]);
}

/** Route adapter: action=status|start|callback|logout|sites-start; provider is
 * required only for start/callback. fetch/clock/timeout injections are trusted
 * server-side dependencies used by SQL + signed-JWT integration tests.
 * @param {Request} request
 * @param {{action?: string, provider?: string, db?: import('@cloudflare/workers-types').D1Database, env?: any, sitesUserId?: string, sitesEmail?: string, now?: () => number, fetch?: typeof globalThis.fetch, timeoutMs?: number, sitesEnabled?: boolean, loginEnabled?: boolean, reauthEnabled?: boolean, previewOwnerEnrollment?: {email: string, notBefore: number}|null, previewRegistration?: boolean, passwordService?: any, clientAddressHash?: string|null}} [options]
 * @returns {Promise<Response>}
 */
export async function handleAuthRequest(request, {
  action, provider: providerId, db, env = {}, sitesUserId, sitesEmail, now = Date.now,
  fetch: fetcher = globalThis.fetch, timeoutMs = AUTH_LIMITS.upstreamTimeoutMs, sitesEnabled = true, loginEnabled = true, reauthEnabled = false,
  previewOwnerEnrollment = null, previewRegistration = false, passwordService = null, clientAddressHash = null,
} = {}) {
  const definition = { status: 'GET', start: 'POST', callback: 'GET', logout: 'POST', 'sites-start': 'POST', 'local-register': 'POST', 'local-login': 'POST' };
  try {
    if (!sitesEnabled) {
      sitesUserId = undefined;
      sitesEmail = undefined;
      if (action === 'sites-start') throw new AuthError(404, 'NOT_FOUND');
    }
    if (!Object.hasOwn(definition, action) || ((action === 'start' || action === 'callback') && !AUTH_PROVIDER_IDS.includes(providerId))) {
      throw new AuthError(404, 'NOT_FOUND', 'invalid_request');
    }
    if (request.method !== definition[action]) {
      return json({ code: 'METHOD_NOT_ALLOWED', message: MESSAGES.METHOD_NOT_ALLOWED }, 405, [], { Allow: definition[action] });
    }
    const origin = configuredOrigin(env);
    if (origin && new URL(request.url).origin !== origin) throw new AuthError(403, 'ORIGIN_REJECTED', 'invalid_request');
    if (action !== 'status' && !origin) throw new AuthError(503, 'AUTH_NOT_CONFIGURED', 'provider_disabled');
    if (definition[action] === 'POST') rejectWriteOrigin(request, origin);
    if (action === 'status' && (request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
      (request.headers.get('Origin') !== null && request.headers.get('Origin') !== new URL(request.url).origin))) {
      throw new AuthError(403, 'ORIGIN_REJECTED', 'invalid_request');
    }
    const database = usableDb(db);
    const options = { db: database, env, sitesUserId, sitesEmail, now, fetch: fetcher, timeoutMs, loginEnabled, reauthEnabled,
      previewOwnerEnrollment: previewOwnerPolicy(previewOwnerEnrollment, timestamp(now)),
      previewRegistration: previewRegistration === true && loginEnabled === true, passwordService, clientAddressHash };
    if (action === 'status') {
      const resolved = await resolveInternal(request, options);
      const reauthProviders = AUTH_PROVIDER_IDS.map(id => {
        const config = providerConfig(id, env);
        const reason = config.supportsReauthentication === false ? 'unsupported_by_provider'
          : !reauthEnabled ? 'reauthentication_not_ready' : !resolved?.sessionHash ? 'sign_in_required'
          : !resolved.linkedProviders.includes(id) ? 'not_linked' : config.reason;
        return { id, name: config.name, enabled: reason === 'ready', reason };
      });
      let reauthContext = null;
      let playerId = null;
      if (resolved?.sessionHash) {
        const current = await database.prepare(`SELECT p.public_id FROM auth_sessions s
          JOIN auth_accounts a ON a.id = s.account_id LEFT JOIN game_players p ON p.id = s.account_id
          WHERE s.token_hash = ? AND s.account_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?
            AND a.disabled_at IS NULL AND ${accountAllowedSql('a.id')}`)
          .bind(resolved.sessionHash, resolved.userId, timestamp(now)).first();
        if (current) {
          reauthContext = await digest(`privacy:${resolved.sessionHash}`);
          playerId = current.public_id ?? null;
        }
      }
      const ownerEnrollmentReady = !resolved && options.previewOwnerEnrollment !== null && loginEnabled &&
        providerConfig('google', env).enabled &&
        !!(await database.prepare(`SELECT ${EMPTY_PREVIEW_ACCOUNT_SQL} AS empty`).first())?.empty;
      const localEnabled = localReady(options), cookies = [];
      if (localEnabled && !resolved && !TOKEN.test(readCookie(request, AUTH_COOKIES.flow).value || '')) {
        cookies.push(cookie(AUTH_COOKIES.flow, randomToken(), (AUTH_LIMITS.sessionMs + AUTH_LIMITS.flowMs) / 1000));
      }
      return json({
        authenticated: !!resolved,
        sites: { enabled: sitesEnabled },
        account: resolved ? { provider: resolved.provider, linkedProviders: resolved.linkedProviders } : null,
        localAuth: { enabled: localEnabled, registrationOpen: localEnabled && !resolved },
        providers: AUTH_PROVIDER_IDS.map(id => {
          const config = providerConfig(id, env);
          if (options.previewRegistration && id !== 'google') return { id, name: config.name, enabled: false, reason: 'not_configured' };
          return { id, name: config.name, enabled: loginEnabled && config.enabled, reason: loginEnabled ? config.reason : 'admission_not_ready' };
        }),
        reauthentication: {
          enabled: reauthContext !== null && reauthProviders.some(item => item.enabled),
          accountContext: reauthContext, playerId,
          providers: reauthProviders.map(item => ({ ...item, enabled: reauthContext !== null && item.enabled })),
        },
        registration: {
          open: ADMISSION_POLICY.registrationOpen, ageTarget: '전체이용가 목표',
          previewOpen: options.previewRegistration && !resolved,
          minimumSignupAge: ADMISSION_POLICY.minimumSignupAge, guardianReady: false,
          under14EnrollmentOpen: ADMISSION_POLICY.under14EnrollmentOpen, ageVerificationReady: ADMISSION_POLICY.ageVerificationReady,
        },
        previewEnrollment: { enabled: ownerEnrollmentReady, provider: 'google', accountLimit: 1 },
      }, 200, cookies);
    }
    if (!loginEnabled && !reauthEnabled && (action === 'start' || action === 'callback')) {
      throw new AuthError(503, 'AUTH_NOT_CONFIGURED', 'provider_disabled');
    }
    if (options.previewRegistration && (action === 'start' || action === 'callback') && providerId !== 'google') {
      throw new AuthError(503, 'AUTH_NOT_CONFIGURED', 'provider_disabled');
    }
    if (action === 'local-register' || action === 'local-login') return await localAuthentication(request, options, action === 'local-register');
    if (action === 'start') return await start(request, providerConfig(providerId, env), options);
    if (action === 'callback') return await callback(request, providerConfig(providerId, env), options);
    return await endSession(request, options, action === 'sites-start');
  } catch (error) {
    const known = error instanceof AuthError;
    return json({ code: known ? error.code : 'SERVICE_UNAVAILABLE', message: known ? error.message : MESSAGES.SERVICE_UNAVAILABLE },
      known ? error.status : 503, [], known && error.retryAfter ? { 'Retry-After': error.retryAfter } : {});
  }
}


/** Trusted server-only resolver for account rights; no caller-supplied identity. */
export async function resolvePrivacyIdentity(request, { db, env = {}, now = Date.now } = {}) {
  const resolved = await resolveInternal(request, { db: usableDb(db), env, now });
  if (!resolved?.sessionHash) return null;
  return { userId: resolved.userId, sessionHash: resolved.sessionHash,
    authenticatedAt: Number.isSafeInteger(resolved.authenticatedAt) ? resolved.authenticatedAt : null,
    accountContext: await digest(`privacy:${resolved.sessionHash}`) };
}
