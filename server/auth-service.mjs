import { createLocalJWKSet, jwtVerify } from 'jose';

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
  SIGN_IN_REQUIRED: '먼저 로그인한 뒤 계정을 연결해 주세요.',
  RATE_LIMITED: '로그인 요청이 잠시 몰렸어요. 잠시 후 다시 시도해 주세요.',
  SERVICE_UNAVAILABLE: '로그인 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.',
});
const CALLBACK_CODES = new Set([
  'invalid_request', 'state_invalid', 'provider_disabled', 'provider_denied',
  'provider_unavailable', 'verification_failed', 'signup_closed', 'account_conflict',
  'account_changed', 'account_unavailable', 'too_many_requests', 'service_unavailable',
]);
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const textEncoder = new TextEncoder();
const jwksCaches = new WeakMap();

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

function credential(env, key) {
  const value = env?.[key];
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 2048 && !/[\r\n\u0000]/.test(value) ? value : null;
}

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
  return AUTH_PROVIDER_IDS.filter(id => found.has(id));
}

async function resolveInternal(request, { db, env, sitesUserId, sitesEmail, now }) {
  const current = readCookie(request, AUTH_COOKIES.session);
  // Browsers remove expired cookies. Absence is unauthenticated too: it must not
  // silently switch a returning social player to the Sites access-gate account.
  if (!current.present) return null;
  if (current.value !== 'sites') {
    if (!TOKEN.test(current.value || '')) return null;
    const tokenHash = await digest(current.value);
    const row = await db.prepare(`SELECT s.account_id, s.provider FROM auth_sessions s
      JOIN auth_accounts a ON a.id = s.account_id
      WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND a.disabled_at IS NULL`)
      .bind(tokenHash, timestamp(now)).first();
    if (!row) return null;
    return { userId: row.account_id, provider: row.provider, linkedProviders: await linkedProviders(db, row.account_id), sessionHash: tokenHash };
  }
  const userId = sitesIdentity(sitesUserId);
  if (!userId) return null;
  const account = await db.prepare('SELECT disabled_at FROM auth_accounts WHERE id = ?').bind(userId).first();
  if (account && account.disabled_at !== null) return null;
  const testerEmail = credential(env, 'HARU_SITES_TESTER_EMAIL');
  const privateTester = testerEmail && typeof sitesEmail === 'string' && sitesEmail.trim().toLowerCase() === testerEmail.trim().toLowerCase();
  if (!account && !privateTester && env?.HARU_REGISTRATION_OPEN !== 'true' &&
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
    // Only the verified provider/issuer/client/subject tuple survives this call.
    // Email (even email_verified), display name and age claims are not identities.
    return { provider: provider.id, issuer: provider.issuer, audience: provider.clientId, subject: payload.sub };
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
  const body = await readJson(request, ['intent']);
  if (body.intent !== 'login' && body.intent !== 'link') throw new AuthError(400, 'INVALID_REQUEST', 'invalid_request');
  const { db, now, sitesUserId } = options;
  const account = await resolveInternal(request, options);
  if (body.intent === 'link' && !account) throw new AuthError(401, 'SIGN_IN_REQUIRED', 'account_changed');
  await rateLimit(db, 'start', provider.id, now);
  const at = timestamp(now);
  await cleanup(db, at);
  if (body.intent === 'link') {
    await db.prepare('INSERT INTO auth_accounts (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING').bind(account.userId, at).run();
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
      // Preserve the session actually presented by this browser. Revoke an
      // already-issued but still-undelivered older callback session instead.
      db.prepare(`UPDATE auth_sessions SET revoked_at = ? WHERE binding_hash = ? AND revoked_at IS NULL
        AND token_hash != ?`).bind(at, oldHash, account?.sessionHash || ''),
    ]);
  }
  const inserted = await db.prepare(`INSERT INTO auth_oauth_transactions
    (state_hash, binding_hash, provider, audience, intent, account_id, context_hash, nonce_hash, code_verifier, created_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM auth_oauth_transactions) < ?
    RETURNING state_hash`).bind(
      await digest(state), await digest(binding), provider.id, provider.clientId, body.intent,
      body.intent === 'link' ? account.userId : null, await contextHash(request, sitesUserId),
      await digest(nonce), verifier, at, at + AUTH_LIMITS.flowMs, AUTH_LIMITS.liveFlows,
    ).first();
  if (!inserted) throw new AuthError(429, 'RATE_LIMITED', 'too_many_requests', 60);
  const url = new URL(provider.authorize);
  for (const [key, value] of Object.entries({
    response_type: 'code', client_id: provider.clientId, redirect_uri: provider.redirectUri,
    scope: provider.scope, state, nonce, code_challenge: await challenge(verifier), code_challenge_method: 'S256',
  })) url.searchParams.set(key, value);
  if (provider.id === 'google') url.searchParams.set('prompt', 'select_account');
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
    WHERE EXISTS (SELECT 1 FROM auth_accounts a WHERE a.id = ? AND a.disabled_at IS NULL)
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

async function createSession(identity, flow, options) {
  const { db, env, now } = options;
  const tuple = identityParameters(identity);
  const existing = await db.prepare(`SELECT account_id FROM auth_identities WHERE ${IDENTITY_WHERE}`).bind(...tuple).first();
  const registrationOpen = env?.HARU_REGISTRATION_OPEN === 'true';
  if (!existing && !registrationOpen) throw new AuthError(403, 'INVALID_REQUEST', 'signup_closed');
  const at = timestamp(now);
  const proof = [flow.state_hash, flow.claim_token, at];
  const liveFlow = 'EXISTS (SELECT 1 FROM auth_oauth_transactions WHERE state_hash = ? AND claim_token = ? AND expires_at > ?)';
  const candidate = `social:${crypto.randomUUID()}`;
  const rawToken = randomToken();
  const tokenHash = await digest(rawToken);
  const statements = [];
  if (registrationOpen) {
    statements.push(db.prepare(`INSERT INTO auth_accounts (id, created_at)
      SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM auth_identities WHERE ${IDENTITY_WHERE}) AND ${liveFlow}`).bind(candidate, at, ...tuple, ...proof));
    statements.push(db.prepare(`INSERT INTO auth_identities (id, account_id, provider, issuer, audience, subject, linked_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM auth_accounts WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM auth_identities WHERE ${IDENTITY_WHERE}) AND ${liveFlow}`)
      .bind(crypto.randomUUID(), candidate, ...tuple, at, candidate, ...tuple, ...proof));
  }
  // Resolve the winning identity inside the same transaction. Concurrent first
  // logins for one provider subject cannot create two accounts or move ownership.
  statements.push(db.prepare(`DELETE FROM auth_sessions WHERE token_hash IN (
    SELECT s.token_hash FROM auth_sessions s JOIN auth_identities i ON i.account_id = s.account_id
    WHERE i.provider = ? AND i.issuer = ? AND i.audience = ? AND i.subject = ?
    ORDER BY s.created_at DESC, s.token_hash DESC LIMIT -1 OFFSET ?) AND ${liveFlow}`)
    .bind(...tuple, AUTH_LIMITS.sessionsPerAccount - 1, ...proof));
  statements.push(db.prepare(`INSERT INTO auth_sessions (token_hash, binding_hash, account_id, provider, created_at, expires_at)
    SELECT ?, ?, i.account_id, ?, ?, ? FROM auth_identities i JOIN auth_accounts a ON a.id = i.account_id
    WHERE i.provider = ? AND i.issuer = ? AND i.audience = ? AND i.subject = ? AND a.disabled_at IS NULL AND ${liveFlow}`)
    .bind(tokenHash, flow.binding_hash, identity.provider, at, at + AUTH_LIMITS.sessionMs, ...tuple, ...proof));
  statements.push(db.prepare(`DELETE FROM auth_oauth_transactions WHERE state_hash = ? AND claim_token = ? AND expires_at > ? RETURNING state_hash`).bind(...proof));
  const committed = await db.batch(statements);
  if (!committed.at(-1).results.length) throw new AuthError(401, 'SIGN_IN_REQUIRED', 'account_changed');
  const session = await db.prepare('SELECT account_id FROM auth_sessions WHERE token_hash = ?').bind(tokenHash).first();
  if (!session) throw new AuthError(403, 'SIGN_IN_REQUIRED', 'account_unavailable');
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
 * @param {{action?: string, provider?: string, db?: import('@cloudflare/workers-types').D1Database, env?: any, sitesUserId?: string, sitesEmail?: string, now?: () => number, fetch?: typeof globalThis.fetch, timeoutMs?: number, sitesEnabled?: boolean}} [options]
 * @returns {Promise<Response>}
 */
export async function handleAuthRequest(request, {
  action, provider: providerId, db, env = {}, sitesUserId, sitesEmail, now = Date.now,
  fetch: fetcher = globalThis.fetch, timeoutMs = AUTH_LIMITS.upstreamTimeoutMs, sitesEnabled = true,
} = {}) {
  const definition = { status: 'GET', start: 'POST', callback: 'GET', logout: 'POST', 'sites-start': 'POST' };
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
    const options = { db: database, env, sitesUserId, sitesEmail, now, fetch: fetcher, timeoutMs };
    if (action === 'status') {
      const resolved = await resolveInternal(request, options);
      return json({
        authenticated: !!resolved,
        sites: { enabled: sitesEnabled },
        account: resolved ? { provider: resolved.provider, linkedProviders: resolved.linkedProviders } : null,
        providers: AUTH_PROVIDER_IDS.map(id => {
          const config = providerConfig(id, env);
          return { id, name: config.name, enabled: config.enabled, reason: config.reason };
        }),
        registration: {
          open: env.HARU_REGISTRATION_OPEN === 'true', ageTarget: '전체이용가 목표', minimumSignupAge: null, guardianReady: false,
        },
      });
    }
    if (action === 'start') return await start(request, providerConfig(providerId, env), options);
    if (action === 'callback') return await callback(request, providerConfig(providerId, env), options);
    return await endSession(request, options, action === 'sites-start');
  } catch (error) {
    const known = error instanceof AuthError;
    return json({ code: known ? error.code : 'SERVICE_UNAVAILABLE', message: known ? error.message : MESSAGES.SERVICE_UNAVAILABLE },
      known ? error.status : 503, [], known && error.retryAfter ? { 'Retry-After': error.retryAfter } : {});
  }
}
