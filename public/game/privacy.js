import { GameApiError, applicationResponseStatus } from './api.js';

export class PrivacyApiError extends GameApiError {
  constructor(message, options = {}) { super(message, options); this.name = 'PrivacyApiError'; }
}
const STATES = new Set(['pending', 'active', 'withdrawn', 'deletion_pending', 'deleted']);
const CONTEXT = /^[a-f0-9]{64}$/;
const IDENTIFIER = /^[^\u0000-\u001f\u007f]{1,200}$/;
const RESPONSE_LIMIT = 256 * 1024;
const EXPORT_LIMIT = 4 * 1024 * 1024;
const invalid = () => new PrivacyApiError('정보 관리 응답을 확인하지 못했어요. 다시 열어 주세요.', { code: 'INVALID_PRIVACY_RESPONSE', retryable: false });
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => Number.isSafeInteger(value) && value >= 0;
const identifier = value => typeof value === 'string' && IDENTIFIER.test(value) && value.trim().length > 0;

function normalizeDeletion(raw) {
  if (raw == null) return null;
  if (!object(raw) || !['pending', 'complete'].includes(raw.status) || !timestamp(raw.requestedAt) ||
    !(raw.completedAt == null || timestamp(raw.completedAt)) ||
    (raw.status === 'complete' && (!timestamp(raw.completedAt) || raw.completedAt < raw.requestedAt))) throw invalid();
  return {
    ...(identifier(raw.requestId) ? { requestId: raw.requestId } : {}),
    status: raw.status, requestedAt: raw.requestedAt, completedAt: raw.completedAt ?? null,
    scope: 'live-database', awaitingPolicy: raw.status === 'pending' && raw.awaitingPolicy !== false,
    backupReplayRequired: raw.status === 'complete' || raw.backupReplayRequired === true,
  };
}

export function normalizePrivacyAccount(raw) {
  if (!object(raw) || !STATES.has(raw.state)) throw invalid();
  const deletion = normalizeDeletion(raw.deletion);
  if ((raw.state === 'deleted' && deletion?.status !== 'complete') ||
    (raw.state === 'deletion_pending' && deletion?.status !== 'pending')) throw invalid();
  return { state: raw.state, deletion };
}

export function normalizePrivacyStatus(raw) {
  if (!object(raw) || typeof raw.accountContext !== 'string' || !CONTEXT.test(raw.accountContext)) throw invalid();
  if (!(raw.playerId === null || identifier(raw.playerId))) throw invalid();
  const account = normalizePrivacyAccount(raw.account);
  const selfRecoveryReady = raw.selfRecoveryReady === true;
  const guardian = {
    guardianReady: raw.guardian?.guardianReady === true,
    providerConfigured: raw.guardian?.providerConfigured === true,
    enrollmentOpen: raw.guardian?.enrollmentOpen === true,
  };
  const active = account.state === 'active';
  return {
    accountContext: raw.accountContext, playerId: raw.playerId, account, guardian, selfRecoveryReady,
    capabilities: {
      selfExport: active && raw.capabilities?.selfExport === true,
      childManagement: active && raw.capabilities?.childManagement === true,
      selfClosure: active && selfRecoveryReady && raw.capabilities?.selfClosure === true,
      guardianEnrollment: active && guardian.guardianReady && guardian.enrollmentOpen && raw.capabilities?.guardianEnrollment === true,
    },
  };
}

export function normalizePrivacyChildren(raw) {
  if (!object(raw) || !Array.isArray(raw.children) || raw.children.length > 100 || typeof raw.hasMore !== 'boolean') throw invalid();
  const seen = new Set();
  const children = raw.children.map(child => {
    if (!object(child) || !identifier(child.childAccountId) || seen.has(child.childAccountId) ||
      typeof child.label !== 'string' || !child.label.trim() || child.label.length > 100 || /[\u0000-\u001f\u007f]/.test(child.label) || child.state === 'deleted') throw invalid();
    seen.add(child.childAccountId);
    return { childAccountId: child.childAccountId, label: child.label, ...normalizePrivacyAccount(child) };
  });
  return { children, hasMore: raw.hasMore };
}

export function normalizeGuardianRequests(raw) {
  if (!object(raw) || !Array.isArray(raw.requests) || raw.requests.length > 5) throw invalid();
  const seen = new Set();
  return { requests: raw.requests.map(row => {
    if (!object(row) || !identifier(row.requestId) || seen.has(row.requestId) || !['pending', 'approved'].includes(row.status) ||
      !timestamp(row.createdAt) || !timestamp(row.expiresAt) || row.expiresAt <= row.createdAt || row.expiresAt - row.createdAt > 432000000 ||
      typeof row.policyVersion !== 'string' || !row.policyVersion.trim() || row.policyVersion.length > 300 || /[\u0000-\u001f\u007f]/.test(row.policyVersion)) throw invalid();
    seen.add(row.requestId);
    return { requestId: row.requestId, status: row.status, createdAt: row.createdAt, expiresAt: row.expiresAt, policyVersion: row.policyVersion };
  }) };
}

function normalizeExport(raw) {
  if (!object(raw) || raw.format !== 'haru-five-rights-export-v1' || typeof raw.exportedAt !== 'string' ||
    raw.exportedAt.length > 40 || !Number.isFinite(Date.parse(raw.exportedAt)) ||
    !(raw.profile === null || object(raw.profile)) || !object(raw.access) ||
    !['results', 'attempts', 'coinLedger', 'weeklyAwards', 'linkedProviders'].every(key => Array.isArray(raw[key]))) throw invalid();
  // The authenticated rights endpoint owns this export schema. Preserve its
  // complete data for a user download, never use it as live game state.
  return raw;
}

async function readJson(response, maxBytes, signal) {
  const responseStatus = applicationResponseStatus(response);
  if (response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw invalid();
  const length = response.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw new PrivacyApiError('자료가 너무 커서 이 화면에서 받지 못했어요.', { code: 'PRIVACY_RESPONSE_TOO_LARGE', status: responseStatus, retryable: false });
  const reader = response.body?.getReader();
  if (!reader) throw invalid();
  const cancel = () => { reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks = []; let size = 0;
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new PrivacyApiError('자료가 너무 커서 이 화면에서 받지 못했어요.', { code: 'PRIVACY_RESPONSE_TOO_LARGE', status: responseStatus, retryable: false });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw invalid(); }
  } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

/** Credentials remain in browser-managed same-origin cookies. Context and the
 * verified child selector live only in memory and are invalidated on refresh.
 * No URLs, account IDs, tokens or confirmation strings are accepted ad hoc.
 */
export function createPrivacyApi({ fetchImpl = (...args) => fetch(...args), timeoutMs = 12000, monotonic = () => performance.now() } = {}) {
  const controllers = new Set(), sequences = new Map();
  let destroyed = false, generation = 0, childrenGeneration = 0, accountContext = null, allowedChildren = new Set(), retryUntil = 0;
  const retryIn = () => Math.max(0, Math.ceil((retryUntil - monotonic()) / 1000));
  const stale = () => new PrivacyApiError('계정 정보가 바뀌었어요. 정보 관리를 다시 열어 주세요.', { code: 'STALE_PRIVACY_RESPONSE', retryable: false });
  const aborted = () => new PrivacyApiError('정보 관리 요청을 취소했어요.', { code: 'PRIVACY_ABORTED', retryable: false });
  function assertCurrent(epoch, sequence, scope) {
    if (destroyed) throw aborted();
    if (generation !== epoch || sequences.get(scope) !== sequence) throw stale();
  }
  async function request(path, { body, context, limit = RESPONSE_LIMIT, normalize = value => value } = {}) {
    if (destroyed) throw aborted();
    if (retryIn()) throw new PrivacyApiError(`${retryIn()}초 뒤에 다시 확인해 주세요.`, { code: 'RATE_LIMITED', status: 429, retryAfter: retryIn() });
    const epoch = generation, sequence = (sequences.get(path) || 0) + 1;
    sequences.set(path, sequence);
    const controller = new AbortController(); controllers.add(controller);
    let timedOut = false, responseStatus = 0, rejectAbort;
    const cancelled = new Promise((_resolve, reject) => { rejectAbort = reject; });
    const onAbort = () => rejectAbort(timedOut
      ? new PrivacyApiError('처리 결과를 확인하지 못했어요. 다시 열어 상태를 확인해 주세요.', { code: 'PRIVACY_TIMEOUT', retryable: true }) : aborted());
    controller.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    try {
      return await Promise.race([(async () => {
        const response = await fetchImpl(path, {
          method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
          headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(context ? { 'X-Haru-Account': context } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
        });
        responseStatus = applicationResponseStatus(response);
        assertCurrent(epoch, sequence, path);
        const rawRetry = Number(response.headers.get('Retry-After'));
        const retryAfter = Number.isFinite(rawRetry) ? Math.min(3600, Math.max(0, Math.ceil(rawRetry))) : 0;
        const payload = await readJson(response, limit, controller.signal);
        assertCurrent(epoch, sequence, path);
        if (!response.ok) {
          if (responseStatus === 429) retryUntil = monotonic() + Math.max(1, retryAfter) * 1000;
          if (responseStatus === 401 || payload?.code === 'ACCOUNT_CHANGED') { accountContext = null; allowedChildren.clear(); generation++; }
          throw new PrivacyApiError(typeof payload?.message === 'string' && payload.message.length <= 240 ? payload.message : '정보 관리 요청을 처리하지 못했어요.', {
            code: typeof payload?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(payload.code) ? payload.code : 'PRIVACY_REQUEST_FAILED',
            status: responseStatus, retryAfter: responseStatus === 429 ? Math.max(1, retryAfter) : retryAfter,
            retryable: responseStatus >= 500 || responseStatus === 408 || responseStatus === 429,
          });
        }
        return normalize(payload);
      })(), cancelled]);
    } catch (error) {
      if (error instanceof GameApiError) { if (!error.status && responseStatus) error.status = responseStatus; throw error; }
      if (controller.signal.aborted || error?.name === 'AbortError') throw timedOut
        ? new PrivacyApiError('처리 결과를 확인하지 못했어요. 상태를 다시 확인해 주세요.', { code: 'PRIVACY_TIMEOUT' }) : aborted();
      throw new PrivacyApiError('연결이 끊어져 처리 결과를 확인하지 못했어요. 다시 열어 상태를 확인해 주세요.', { code: 'PRIVACY_NETWORK_ERROR' });
    } finally {
      clearTimeout(timer); controller.signal.removeEventListener('abort', onAbort); controllers.delete(controller);
    }
  }
  function currentContext() {
    if (destroyed) throw aborted();
    if (!accountContext) throw new PrivacyApiError('계정 정보 화면을 먼저 열어 주세요.', { code: 'PRIVACY_NOT_READY', retryable: false });
    return accountContext;
  }
  function input(options, { childRequired = false } = {}) {
    if (destroyed) throw aborted();
    if (!object(options) || Object.keys(options).some(key => !['accountContext', 'childAccountId'].includes(key)) ||
      typeof options.accountContext !== 'string' || !CONTEXT.test(options.accountContext) || options.accountContext !== accountContext) {
      throw new PrivacyApiError('계정 정보 화면을 다시 열어 주세요.', { code: 'PRIVACY_NOT_READY', retryable: false });
    }
    const child = options.childAccountId;
    if ((childRequired && child === undefined) || (child !== undefined && (!identifier(child) || !allowedChildren.has(child)))) {
      throw new PrivacyApiError('목록에서 관리할 어린이 계정을 다시 선택해 주세요.', { code: 'INVALID_CHILD_SELECTION', retryable: false });
    }
    return { context: options.accountContext, body: child === undefined ? {} : { childAccountId: child } };
  }
  return {
    retryIn,
    status: async () => {
      const epoch = ++generation;
      accountContext = null; allowedChildren.clear();
      const result = await request('/api/privacy/status', { normalize: normalizePrivacyStatus });
      if (destroyed) throw aborted();
      if (generation !== epoch) throw stale();
      accountContext = result.accountContext;
      return result;
    },
    children: async () => {
      const context = currentContext(), epoch = generation, selection = ++childrenGeneration;
      allowedChildren.clear();
      const result = await request('/api/privacy/children', { context, normalize: normalizePrivacyChildren });
      if (destroyed) throw aborted();
      if (generation !== epoch || accountContext !== context || selection !== childrenGeneration) throw stale();
      allowedChildren = new Set(result.children.map(child => child.childAccountId));
      return result;
    },
    exportData: options => request('/api/privacy/export', { ...input(options), limit: EXPORT_LIMIT, normalize: normalizeExport }),
    childStatus: options => request('/api/privacy/status', { ...input(options, { childRequired: true }), normalize: normalizePrivacyAccount }),
    withdraw: options => { const supplied = input(options); return request('/api/privacy/withdraw', { ...supplied, body: { ...supplied.body, confirmation: 'withdraw' }, normalize: normalizePrivacyAccount }); },
    requestDeletion: options => { const supplied = input(options); return request('/api/privacy/delete', { ...supplied, body: { ...supplied.body, confirmation: 'delete' }, normalize: normalizePrivacyAccount }); },
    guardianRequests: async () => {
      const context = currentContext(), epoch = generation;
      const result = await request('/api/guardian/requests', { context, normalize: normalizeGuardianRequests });
      if (destroyed) throw aborted();
      if (generation !== epoch || accountContext !== context) throw stale();
      return result;
    },
    destroy: () => { destroyed = true; generation++; accountContext = null; allowedChildren.clear(); for (const controller of controllers) controller.abort(); controllers.clear(); },
  };
}
