import { buildContainer } from '../../server/src/composition-root.js';
import { loadConfig } from '../../server/src/infrastructure/config/config.js';
import { createApp } from '../../server/src/interfaces/http/app.js';

/**
 * Vercel Serverless Function entry-point (web/api/index.ts).
 *
 * Lives inside web/ so it works when Vercel Root Directory = "web".
 * Imports resolve to ../../server/src/ — Vercel clones the full repo so
 * these files exist regardless of which directory commands run from.
 * web/package.json has "type":"module" so esbuild outputs ESM,
 * which preserves import.meta.url used by Database.ts for node:sqlite.
 */
const config = loadConfig();
const container = buildContainer(config);
container.coordinator.recoverStuckEvaluations();

export default createApp(container);
