import express from 'express';
import { buildContainer, Container } from '../server/src/composition-root';
import { loadConfig } from '../server/src/infrastructure/config/config';
import { createApp } from '../server/src/interfaces/http/app';

/**
 * Vercel Serverless Function entry-point: the whole Express app behind one
 * function, routed here by the `/api/(.*)` rewrite in vercel.json.
 *
 * Two things differ from `server/src/main.ts`, and both are host constraints
 * rather than application changes:
 *
 *  - Persistence. A function has no writable shared disk, so the database
 *    lives in /tmp and the composition root falls back to the in-memory
 *    repositories if `node:sqlite` is missing from the runtime.
 *  - Evaluations. The instance is frozen once it responds, so `AWAIT_EVALUATIONS`
 *    (defaulted on by the presence of `VERCEL`) makes the submit request wait
 *    for the evaluator instead of backgrounding it.
 *
 * Imports are extensionless to match the rest of `server/src`: this file is
 * bundled, never run through plain Node ESM resolution.
 */
function boot(): express.Express {
  try {
    const container: Container = buildContainer(loadConfig());
    // Anything a previous, now-recycled instance left mid-evaluation is failed
    // with a retry offer rather than left spinning in the UI.
    container.coordinator.recoverStuckEvaluations();
    return createApp(container);
  } catch (error) {
    return misconfigured(error);
  }
}

/**
 * Startup refuses to boot on a bad configuration - `EVALUATOR=llm` with no key
 * is the usual one - and on a long-running server that is exactly right: the
 * process dies and the reason is the last line in the log.
 *
 * A function has no such log to read. A throw at module scope becomes
 * FUNCTION_INVOCATION_FAILED, which reaches the browser as a bare 500 with no
 * body, on every route, identical for every possible cause. So the failure is
 * caught and served instead: the same refusal, in the response, where whoever
 * is looking at the broken page can act on it.
 */
function misconfigured(error: unknown): express.Express {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[boot] the application could not start:', message);

  const app = express();
  app.get('/api/health', (_req, res) => {
    res.status(503).json({ status: 'misconfigured', reason: message });
  });
  app.use((_req, res) => {
    res.status(503).json({
      error: {
        code: 'MISCONFIGURED',
        message: `The server could not start: ${message}`,
      },
    });
  });
  return app;
}

export default boot();
