import 'dotenv/config';
import { buildContainer } from '../server/src/composition-root.js';
import { loadConfig } from '../server/src/infrastructure/config/config.js';
import { createApp } from '../server/src/interfaces/http/app.js';

/**
 * Vercel Serverless Function entry-point.
 *
 * Vercel compiles this TypeScript file and routes every /api/* request here.
 * The container is built once per warm instance and reused across invocations,
 * so the SQLite database (stored in /tmp) persists for the lifetime of the
 * function instance — enough for a working prototype.
 */
const config = loadConfig();
const container = buildContainer(config);
container.coordinator.recoverStuckEvaluations();

export default createApp(container);
