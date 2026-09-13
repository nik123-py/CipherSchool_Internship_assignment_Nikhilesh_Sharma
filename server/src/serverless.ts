import { buildContainer } from './composition-root';
import { loadConfig } from './infrastructure/config/config';
import { createApp } from './interfaces/http/app';

/**
 * The application, assembled for a serverless host.
 *
 * This lives in `server/src` rather than in `api/` because it is bundled from
 * here: Vercel compiles `api/index.ts` on its own but does not follow TypeScript
 * imports out of that directory, so a function importing `../server/src/...`
 * deploys with those files missing and fails at runtime. The build bundles this
 * entry into `api/_app.js` instead, which ships as one self-contained file.
 */
export function createServerlessApp() {
  const container = buildContainer(loadConfig());
  // Anything a previous, now-recycled instance left mid-evaluation is failed
  // with a retry offer rather than left spinning in the UI.
  container.coordinator.recoverStuckEvaluations();
  return createApp(container);
}
