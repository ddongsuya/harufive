import { validateStandaloneConfig } from './standalone-worker.mjs';

// An accidental-deploy guard, not an authorization/security boundary. A person
// editing source or setting this marker manually can bypass it. No deployment
// command is provided by this preparation runner.
if (!['dry-run', 'dev'].includes(process.env.HARU_STANDALONE_BUILD_MODE)) {
  throw new Error('This is a local-only preparation configuration. Use the standalone dry-run or dev runner; deployment is not configured.');
}
await validateStandaloneConfig();
