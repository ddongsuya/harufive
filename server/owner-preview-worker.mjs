import { handlePreviewWorkerRequest } from './preview-worker.mjs';

// Build-time operator permission. No request, binding or environment field can
// choose this mode or replace its single explicitly selected Gmail account.
// It permits a private development account, never public/age-verified signup.
export function createOwnerPreviewWorker(enrollment) {
  const pinned = Object.freeze({ email: enrollment?.email, notBefore: enrollment?.notBefore });
  return Object.freeze({
    fetch(request, env = {}) {
      return handlePreviewWorkerRequest(request, env, {
        existingAccountLogin: true, previewOwnerEnrollment: pinned,
      });
    },
  });
}
