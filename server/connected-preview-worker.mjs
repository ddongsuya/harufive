import { handlePreviewWorkerRequest } from './preview-worker.mjs';

/** Explicit deployment adapter for already-linked accounts. The outer preview
 * password remains mandatory, independently of the game's opaque session.
 * The generated deployment entry must pin HARU_AUTH_ORIGIN and bind the intended
 * migrated DB. Unknown subjects cannot register and reauthentication stays shut.
 * Default/local/ordinary preview entries do not import this module.
 */
export function handleConnectedPreviewRequest(request, env = {}) {
  return handlePreviewWorkerRequest(request, env, { existingAccountLogin: true });
}

export default { fetch: handleConnectedPreviewRequest };
