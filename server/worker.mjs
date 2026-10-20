import { handleStandaloneRequest } from './standalone-http.mjs';
import { STANDALONE_ASSET_PATHS } from './standalone-assets.mjs';

const PUBLIC_PATHS = new Set(STANDALONE_ASSET_PATHS);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' data: blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
});

function jsonFailure(status, code, headers = {}) {
  return Response.json({ code, message: '서비스 연결을 준비하고 있어요.' }, { status,
    headers: { 'Cache-Control': 'private, no-store', ...headers } });
}

function seal(response, method) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  // This preparation target does not cache authenticated responses or stale UI.
  headers.set('Cache-Control', 'private, no-store');
  return new Response(method === 'HEAD' ? null : response.body, {
    status: response.status, statusText: response.statusText, headers,
  });
}

function pinnedOrigin(url, env) {
  if (!Object.hasOwn(env, 'HARU_AUTH_ORIGIN') || env.HARU_AUTH_ORIGIN === undefined) {
    // A copied preparation configuration must not become an open public site.
    return LOOPBACK_HOSTS.has(url.hostname) && ['http:', 'https:'].includes(url.protocol)
      ? null : jsonFailure(503, 'AUTH_NOT_CONFIGURED');
  }
  try {
    const raw = env.HARU_AUTH_ORIGIN;
    if (typeof raw !== 'string' || raw.length > 512 || raw !== raw.trim()) throw new Error();
    const configured = new URL(raw);
    if (configured.protocol !== 'https:' || configured.pathname !== '/' || configured.search ||
        configured.hash || configured.username || configured.password) throw new Error();
    return configured.origin === url.origin ? null : jsonFailure(403, 'ORIGIN_REJECTED');
  } catch { return jsonFailure(503, 'AUTH_NOT_CONFIGURED'); }
}

/** Preparation-only Worker entry. No Sites identity, secret/env spread, cron,
 * scheduled maintenance, registration or reauthentication enablement here.
 * @param {Request} request
 * @param {{DB?: any, ASSETS?: {fetch: (request: Request) => Promise<Response>}, HARU_AUTH_ORIGIN?: string}} [env]
 */
export async function handleWorkerRequest(request, env = {}) {
  try {
    const url = new URL(request.url);
    const rejected = pinnedOrigin(url, env);
    if (rejected) return seal(rejected, request.method);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      // Only this setting is allowed across the adapter boundary. Provider keys,
      // guardian keys and any caller/platform identity fields are not forwarded.
      const settings = { HARU_REGISTRATION_OPEN: 'false',
        ...(env.HARU_AUTH_ORIGIN === undefined ? {} : { HARU_AUTH_ORIGIN: env.HARU_AUTH_ORIGIN }) };
      return seal(await handleStandaloneRequest(request, { db: env.DB, env: settings }), request.method);
    }
    if (!PUBLIC_PATHS.has(url.pathname)) return seal(jsonFailure(404, 'NOT_FOUND'), request.method);
    if (!['GET', 'HEAD'].includes(request.method)) {
      return seal(jsonFailure(405, 'METHOD_NOT_ALLOWED', { Allow: 'GET, HEAD' }), request.method);
    }
    if (typeof env.ASSETS?.fetch !== 'function') return seal(jsonFailure(503, 'ASSETS_UNAVAILABLE'), request.method);
    const assetUrl = new URL(url);
    if (url.pathname === '/') assetUrl.pathname = '/index.html';
    // Static assets need no bearer cookie, Sites header or authorization header.
    const response = await env.ASSETS.fetch(new Request(assetUrl, { method: request.method }));
    return seal(response, request.method);
  } catch { return seal(jsonFailure(503, 'SERVICE_UNAVAILABLE'), request.method); }
}

export default { fetch: handleWorkerRequest };
