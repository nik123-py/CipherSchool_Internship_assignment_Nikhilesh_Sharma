import { buildContainer } from '../server/src/composition-root';
import { loadConfig } from '../server/src/infrastructure/config/config';
import { createApp } from '../server/src/interfaces/http/app';

/**
 * Vercel Serverless Function entry-point: the whole Express app behind one
 * function, routed here by the `/api/(.*)` rewrite in vercel.json.
 *
 * Two things differ from `server/src/main.ts`, and both are host constraints
 * rather than application changes:
 *
 *  - Persistence. A function has no writable shared disk, so `PERSISTENCE`
 *    should be `memory` here (the composition root also falls back to it if
 *    `node:sqlite` is missing from the runtime). Attempt state therefore lives
 *    as long as the instance does - see README's deployment notes.
 *  - Evaluations. The instance is frozen once it responds, so `AWAIT_EVALUATIONS`
 *    (defaulted on by the presence of `VERCEL`) makes the submit request wait
 *    for the evaluator instead of backgrounding it.
 *
 * Imports are extensionless to match the rest of `server/src`: this file is
 * bundled, never run through plain Node ESM resolution.
 */
const config = loadConfig();
const container = buildContainer(config);

// Anything a previous, now-recycled instance left mid-evaluation is failed with
// a retry offer rather than left spinning in the UI.
container.coordinator.recoverStuckEvaluations();

export default createApp(container);
