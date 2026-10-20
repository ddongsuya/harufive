import { handlePrivacyRequest } from './privacy-http.mjs';
import { handleAuthRequest, resolveGameIdentity } from './auth-service.mjs';
import { handleGameRequest, handleHealthRequest } from './http.mjs';

function failure(status, code, message, headers = {}) {
  return Response.json({ code, message }, { status, headers: {
    'Cache-Control': 'private, no-store', 'Vary': 'Cookie',
    'X-Content-Type-Options': 'nosniff', ...headers,
  } });
}

/** Public-host adapter. No Sites identity, header fallback, or platform routes.
 * Only server-verified opaque sessions select an existing account. Registration
 * stays closed under the 14+ policy until age/admission verification is ready.
 * Legacy account sessions and data rights do not prove an account's age.
 * @param {Request} request
 * @param {{db?: any, env?: any, now?: () => number, fetch?: typeof globalThis.fetch}} options
 */
export async function handleStandaloneRequest(request, { db, env = {}, now = Date.now, fetch = globalThis.fetch } = {}) {
  const url = new URL(request.url);
  const settings = { ...env, HARU_REGISTRATION_OPEN: 'false' };
  if (settings.HARU_AUTH_ORIGIN) {
    let origin;
    try {
      const configured = new URL(settings.HARU_AUTH_ORIGIN);
      if (configured.protocol !== 'https:' || configured.username || configured.password ||
          configured.pathname !== '/' || configured.search || configured.hash ||
          settings.HARU_AUTH_ORIGIN !== settings.HARU_AUTH_ORIGIN.trim()) throw new Error();
      origin = configured.origin;
    } catch { return failure(503, 'AUTH_NOT_CONFIGURED', '서비스 연결을 준비하고 있어요.'); }
    if (url.origin !== origin) return failure(403, 'ORIGIN_REJECTED', '하루다섯 화면을 다시 열어 주세요.');
  }
  if (url.pathname === '/api/health') {
    return request.method === 'GET' ? handleHealthRequest(db)
      : failure(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청 방식이에요.', { Allow: 'GET' });
  }
  const auth = /^\/api\/auth\/(status|logout|(?:kakao|google|naver)\/(?:start|callback))$/.exec(url.pathname);
  if (auth) {
    const [first, second] = auth[1].split('/');
    return handleAuthRequest(request, {
      action: second || first, provider: second ? first : undefined,
      db, env: settings, now, fetch, sitesEnabled: false, loginEnabled: false, reauthEnabled: false,
    });
  }
  const privacy = /^\/api\/(privacy|guardian)\/([a-z]+)$/.exec(url.pathname);
  if (privacy) return handlePrivacyRequest(request, { namespace: privacy[1], action: privacy[2], db, env: settings, now });
  const game = /^\/api\/game\/([a-z]+)$/.exec(url.pathname);
  if (game) {
    return handleGameRequest(request, {
      action: game[1], db, now, signInUrl: '/',
      // Resolve lazily: full answer receipt must precede authentication queries.
      resolveUserId: async () => (await resolveGameIdentity(request, { db, env: settings, now }))?.userId,
    });
  }
  return failure(404, 'NOT_FOUND', '요청한 기능을 찾지 못했어요.');
}
