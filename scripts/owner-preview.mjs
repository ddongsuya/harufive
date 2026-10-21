import { runOwnerPreviewWorker } from './preview-worker.mjs';

process.exitCode = await runOwnerPreviewWorker(process.argv.slice(2));
