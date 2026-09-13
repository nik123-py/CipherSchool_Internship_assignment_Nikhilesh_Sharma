import { resolve } from 'node:path';
// Type-only: the wire detail lives with the client that sends it, while the
// environment parsing that chooses it stays here with every other env read.
import type { AnthropicAuthScheme } from '../../evaluators/llm/LlmClient';

export type EvaluatorMode = 'auto' | 'heuristic' | 'llm';
export type PersistenceMode = 'sqlite' | 'memory';
export type { AnthropicAuthScheme };

export interface AppConfig {
  readonly port: number;
  readonly databasePath: string;
  readonly evaluatorMode: EvaluatorMode;
  readonly anthropicApiKey?: string;
  readonly anthropicModel: string;
  readonly anthropicBaseUrl: string;
  readonly anthropicAuthScheme: AnthropicAuthScheme;
  readonly openaiApiKey?: string;
  readonly openaiModel: string;
  readonly openaiBaseUrl: string;
  readonly llmTimeoutMs: number;
  readonly llmMaxTokens: number;
  readonly demoEvaluationDelayMs: number;
  readonly webOrigin: string;
  readonly persistence: PersistenceMode;
  readonly awaitEvaluations: boolean;
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
    anthropicAuthScheme: readAuthScheme(env.ANTHROPIC_AUTH_SCHEME),
    openaiApiKey: nonEmpty(env.OPENAI_API_KEY),
    openaiModel: env.OPENAI_MODEL ?? 'gpt-4o-mini',
    openaiBaseUrl: env.OPENAI_BASE_URL ?? 'https://api.openai.com',
    llmTimeoutMs: intOr(env.LLM_TIMEOUT_MS, 60_000),
    // Reasoning models spend part of this budget thinking before they write
    // anything, so the verdict needs headroom above its own length or the
    // response comes back with no text at all.
    llmMaxTokens: intOr(env.LLM_MAX_TOKENS, 4000),
    demoEvaluationDelayMs: intOr(env.DEMO_EVALUATION_DELAY_MS, 1200),
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:5173',
    persistence: readPersistence(env.PERSISTENCE),
    // A serverless instance is frozen the moment it answers, so work started
    // after the response never finishes there. On Vercel the HTTP adapter
    // therefore waits for the evaluation instead of backgrounding it; a
    // long-running server keeps the background behaviour it was designed for.
    awaitEvaluations: readBool(env.AWAIT_EVALUATIONS, env.VERCEL !== undefined),
  };
}

function readMode(value: string | undefined): EvaluatorMode {
  const mode = (value ?? 'auto').toLowerCase();
  if (mode === 'heuristic' || mode === 'llm' || mode === 'auto') return mode;
  throw new Error(`EVALUATOR must be one of auto | heuristic | llm, received '${value}'.`);
}

function readAuthScheme(value: string | undefined): AnthropicAuthScheme {
  const scheme = (value ?? 'x-api-key').toLowerCase();
  if (scheme === 'x-api-key' || scheme === 'bearer') return scheme;
  throw new Error(`ANTHROPIC_AUTH_SCHEME must be one of x-api-key | bearer, received '${value}'.`);
}

function readPersistence(value: string | undefined): PersistenceMode {
  const mode = (value ?? 'sqlite').toLowerCase();
  if (mode === 'sqlite' || mode === 'memory') return mode;
  throw new Error(`PERSISTENCE must be one of sqlite | memory, received '${value}'.`);
}

function readBool(value: string | undefined, fallback: boolean): boolean {
  const normalised = value?.trim().toLowerCase();
  if (normalised === undefined || normalised === '') return fallback;
  return normalised === '1' || normalised === 'true' || normalised === 'yes';
}

function intOr(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
