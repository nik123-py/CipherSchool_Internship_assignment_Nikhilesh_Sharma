import type { IncomingMessage, ServerResponse } from 'node:http';

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
 * Why the application is loaded dynamically rather than with static imports:
 * a static import that throws - a dependency missing from the function bundle,
 * a runtime without `node:sqlite`, a configuration the composition root
 * refuses - fails before any code here runs. The platform turns that into
 * FUNCTION_INVOCATION_FAILED: a bare 500, no body, identical for every cause,
 * and invisible unless you can read the runtime log. Importing inside the
 * handler makes every one of those failures catchable, so the reason is
 * served in the response instead of being swallowed by the platform.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let cached: Handler | undefined;
let failure: string | undefined;

async function load(): Promise<Handler> {
  const [{ buildContainer }, { loadConfig }, { createApp }] = await Promise.all([
    import('../server/src/composition-root'),
    import('../server/src/infrastructure/config/config'),
    import('../server/src/interfaces/http/app'),
  ]);

  const container = buildContainer(loadConfig());
  // Anything a previous, now-recycled instance left mid-evaluation is failed
  // with a retry offer rather than left spinning in the UI.
  container.coordinator.recoverStuckEvaluations();
  return createApp(container) as unknown as Handler;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!cached && !failure) {
    try {
      cached = await load();
    } catch (error) {
      failure = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
      console.error('[boot] the application could not start:', failure);
    }
  }

  if (cached) return cached(req, res);

  // Same shape as the application's own errors, so the client renders it as a
  // message rather than as an unexplained failure.
  res.statusCode = 503;
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      status: 'misconfigured',
      error: {
        code: 'BOOT_FAILED',
        message: `The server could not start: ${(failure ?? '').split('\n')[0]}`,
        detail: failure,
      },
    }),
  );
}
