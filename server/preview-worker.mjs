import { EXISTING_ACCOUNT_AUTH_KEYS, handleWorkerRequest } from './worker.mjs';

const USERNAME = 'harufive';
// Canonical base64url encoding of 32 bytes; the final two padding bits are zero.
// Format alone cannot establish entropy. Generate this secret from random bytes.
const PASSWORD_FORMAT = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const CHALLENGE = 'Basic realm="harufive-preview", charset="UTF-8"';
const encoder = new TextEncoder();
const SECURITY_HEADERS = Object.freeze({
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src 'self' data: blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'",
});

function failure(status, code, challenge = false) {
  return Response.json({ code, message: '운영자 전용 시험 화면이에요.' }, {
    status, headers: challenge ? { 'WWW-Authenticate': CHALLENGE } : {},
  });
}

function seal(response, method) {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  const vary = (headers.get('Vary') || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!vary.some(value => value.toLowerCase() === 'authorization')) vary.push('Authorization');
  headers.set('Vary', vary.join(', '));
  return new Response(method === 'HEAD' ? null : response.body, {
    status: response.status, statusText: response.statusText, headers,
  });
}

function configuredOrigin(raw) {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && raw === url.origin ? raw : null;
  } catch { return null; }
}

function credentials(header) {
  if (typeof header !== 'string' || header.length > 256) return null;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(header);
  if (!match || match[1].length % 4 !== 0) return null;
  try {
    const decoded = atob(match[1]);
    // Reject ignored characters, noncanonical encodings and ambiguous padding.
    return btoa(decoded) === match[1] ? decoded : null;
  } catch { return null; }
}

/** Single-operator preview access, separate from game/account authentication.
 * The generated entry supplies a fixed origin and public-assets adapter. This
 * default wrapper never forwards DB bindings or account keys. The separate
 * connected entry explicitly opts into existing-account login after this gate.
 * Request bodies, headers and environment flags cannot select that mode.
 * @param {Request} request
 * @param {{HARU_AUTH_ORIGIN?: string, HARU_PREVIEW_PASSWORD?: string,
 * ASSETS?: {fetch: (request: Request) => Promise<Response>}, [key: string]: any}} [env]
 * @param {{existingAccountLogin?: boolean}} [options]
 */
export async function handlePreviewWorkerRequest(request, env = {}, { existingAccountLogin = false } = {}) {
  try {
    const origin = configuredOrigin(env.HARU_AUTH_ORIGIN);
    if (!origin) return seal(failure(503, 'PREVIEW_NOT_CONFIGURED'), request.method);
    if (new URL(request.url).origin !== origin) {
      return seal(failure(403, 'ORIGIN_REJECTED'), request.method);
    }
    const password = env.HARU_PREVIEW_PASSWORD;
    if (typeof password !== 'string' || password.length !== 43 || !PASSWORD_FORMAT.test(password)) {
      return seal(failure(503, 'PREVIEW_NOT_CONFIGURED'), request.method);
    }
    // Workers provides this primitive. Do not silently replace it with a JS
    // string/byte comparison when another runtime lacks the implementation.
    const subtle = globalThis.crypto?.subtle;
    if (typeof subtle?.timingSafeEqual !== 'function') {
      return seal(failure(503, 'PREVIEW_UNAVAILABLE'), request.method);
    }
    const provided = credentials(request.headers.get('Authorization'));
    if (provided === null) return seal(failure(401, 'PREVIEW_AUTH_REQUIRED', true), request.method);
    const [actual, expected] = await Promise.all([
      subtle.digest('SHA-256', encoder.encode(provided)),
      subtle.digest('SHA-256', encoder.encode(`${USERNAME}:${password}`)),
    ]);
    if (!subtle.timingSafeEqual(actual, expected)) {
      return seal(failure(401, 'PREVIEW_AUTH_REQUIRED', true), request.method);
    }
    const headers = new Headers(request.headers);
    headers.delete('Authorization');
    headers.delete('Proxy-Authorization');
    const downstream = new Request(request, { headers });
    const workerEnv = { HARU_AUTH_ORIGIN: origin, ASSETS: env.ASSETS };
    if (existingAccountLogin === true) {
      // These reads must remain after the origin/password checks. An anonymous
      // request cannot cause a DB query or access provider configuration.
      workerEnv.DB = env.DB;
      for (const key of EXISTING_ACCOUNT_AUTH_KEYS) {
        if (typeof env[key] === 'string') workerEnv[key] = env[key];
      }
    }
    const response = await handleWorkerRequest(downstream, workerEnv, {
      existingAccountLogin: existingAccountLogin === true,
    });
    return seal(response, request.method);
  } catch { return seal(failure(503, 'PREVIEW_UNAVAILABLE'), request.method); }
}

export default { fetch: handlePreviewWorkerRequest };
