import { buildContainer } from '../server/src/composition-root.js';
import { loadConfig } from '../server/src/infrastructure/config/config.js';
import { createApp } from '../server/src/interfaces/http/app.js';

/**
 * Vercel Serverless Function entry-point.
 *
 * Vercel compiles this as ESM (root package.json has "type":"module"), which
 * preserves import.meta.url used by Database.ts to load node:sqlite.
 * The container is built once per warm instance so the /tmp SQLite database
 * persists across invocations within the same function instance.
 */
const config = loadConfig();
const container = buildContainer(config);
container.coordinator.recoverStuckEvaluations();

export default createApp(container);
