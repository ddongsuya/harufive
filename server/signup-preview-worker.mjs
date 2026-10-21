import { handlePreviewWorkerRequest } from './preview-worker.mjs';
export { PasswordHasher } from './password-hasher.mjs';

// A distinct private trial build enables the two requested login methods.
// It keeps the preview password gate and never reads a public-signup env flag.
export default {
  fetch(request, env) {
    return handlePreviewWorkerRequest(request, env, { existingAccountLogin: true, previewRegistration: true });
  },
};
