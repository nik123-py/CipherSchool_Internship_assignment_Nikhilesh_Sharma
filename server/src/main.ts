import 'dotenv/config';
import { buildContainer } from './composition-root';
import { loadConfig } from './infrastructure/config/config';
import { createApp } from './interfaces/http/app';

const config = loadConfig();
const container = buildContainer(config);

// Anything left mid-evaluation by a previous crash is failed with a retry
// offer rather than left spinning in the UI forever.
const recovered = container.coordinator.recoverStuckEvaluations();
if (recovered > 0) {
  console.log(`[boot] recovered ${recovered} attempt(s) stuck in EVALUATING.`);
}

const app = createApp(container);
const server = app.listen(config.port, () => {
  console.log(`\n  LLD Practice Platform API`);
  console.log(`  http://localhost:${config.port}`);
  console.log(`  database : ${config.databasePath}`);
  console.log(`  evaluator: ${container.evaluationMode.label} (${container.evaluationMode.reason})\n`);
});

const shutdown = (signal: string) => {
  console.log(`\n[${signal}] shutting down...`);
  server.close(() => {
    container.close();
    process.exit(0);
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
