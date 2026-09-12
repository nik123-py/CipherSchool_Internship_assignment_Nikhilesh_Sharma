import { resolve } from 'node:path';

export type EvaluatorMode = 'auto' | 'heuristic' | 'llm';

export interface AppConfig {
  readonly port: number;
  readonly databasePath: string;
  readonly evaluatorMode: EvaluatorMode;
  readonly anthropicApiKey?: string;
  readonly anthropicModel: string;
  readonly anthropicBaseUrl: string;
  readonly openaiApiKey?: string;
  readonly openaiModel: string;
  readonly openaiBaseUrl: string;
  readonly llmTimeoutMs: number;
  readonly demoEvaluationDelayMs: number;
  readonly webOrigin: string;
}

/**
 * All environment reading happens here, once. Everything downstream receives a
 * typed `AppConfig`, which is also why tests can build the whole application
 * without touching `process.env`.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const repoRoot = resolve(process.cwd(), process.cwd().endsWith('server') ? '..' : '.');
  return {
    port: intOr(env.PORT, 4000),
    databasePath:
      env.DATABASE_PATH === ':memory:'
        ? ':memory:'
        : resolve(repoRoot, env.DATABASE_PATH ?? 'data/lld-practice.db'),
    evaluatorMode: readMode(env.EVALUATOR),
    anthropicApiKey: nonEmpty(env.ANTHROPIC_API_KEY),
    anthropicModel: env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
    anthropicBaseUrl: env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com',
    openaiApiKey: nonEmpty(env.OPENAI_API_KEY),
    openaiModel: env.OPENAI_MODEL ?? 'gpt-4o-mini',
    openaiBaseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com',
    llmTimeoutMs: intOr(env.LLM_TIMEOUT_MS, 60_000),
    demoEvaluationDelayMs: intOr(env.DEMO_EVALUATION_DELAY_MS, 1200),
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:5173',
  };
}

function readMode(value: string | undefined): EvaluatorMode {
  const mode = (value ?? 'auto').toLowerCase();
  if (mode === 'heuristic' || mode === 'llm' || mode === 'auto') return mode;
  throw new Error(`EVALUATOR must be one of auto | heuristic | llm, received '${value}'.`);
}

function intOr(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
