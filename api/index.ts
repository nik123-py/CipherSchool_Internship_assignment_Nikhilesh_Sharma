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
 * This file imports `./_app.js`, which the build bundles from
 * `server/src/serverless.ts`, rather than reaching into `server/src` directly.
 * Vercel compiles this entry but does not follow TypeScript imports outside
 * `api/`, so the direct version deployed without the application in it and
 * died with ERR_MODULE_NOT_FOUND on every request. One self-contained bundle
 * beside the entry is the thing that actually ships.
 *
 * The import is inside the handler so that a failure to load - a bad
 * configuration, a missing bundle, an unsupported runtime builtin - is
 * catchable. Left to the platform it becomes FUNCTION_INVOCATION_FAILED: a
 * bare 500, no body, identical for every cause, readable only in a log.
 */
type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let cached: Handler | undefined;
let failure: string | undefined;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!cached && !failure) {
    try {
      const { createServerlessApp } = (await import('./_app.js')) as {
        createServerlessApp: () => Handler;
      };
      cached = createServerlessApp();
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
