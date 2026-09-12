import type { DatabaseSync } from 'node:sqlite';
import { AttemptHistoryService } from './application/AttemptHistoryService';
import { EvaluationCoordinator } from './application/EvaluationCoordinator';
import { EvaluatorRegistry } from './application/EvaluatorRegistry';
import { PracticeService } from './application/PracticeService';
import { Evaluator } from './domain/evaluation/Evaluator';
import { Rubric } from './domain/evaluation/Rubric';
import { RubricRegistry } from './domain/evaluation/RubricRegistry';
import { Clock, IdGenerator, systemClock, uuidIdGenerator } from './domain/shared/clock';
import { SubmissionContentFactory } from './domain/submission/SubmissionContentFactory';
import { HeuristicEvaluator } from './evaluators/heuristic/HeuristicEvaluator';
import { AnthropicClient, LlmClient, OpenAiClient } from './evaluators/llm/LlmClient';
import { LlmEvaluator } from './evaluators/llm/LlmEvaluator';
import { AppConfig } from './infrastructure/config/config';
import { PROBLEM_DEFINITIONS } from './infrastructure/content/problems';
import { openDatabase } from './infrastructure/persistence/Database';
import {
  SqliteAttemptRepository,
  SqliteEvaluationRepository,
  SqliteProblemRepository,
} from './infrastructure/persistence/SqliteRepositories';

export interface Container {
  readonly config: AppConfig;
  readonly db: DatabaseSync;
  readonly practice: PracticeService;
  readonly history: AttemptHistoryService;
  readonly coordinator: EvaluationCoordinator;
  readonly rubric: Rubric;
  readonly content: SubmissionContentFactory;
  readonly evaluator: Evaluator;
  readonly evaluationMode: { kind: string; label: string; isDemo: boolean; reason: string };
  close(): void;
}

export interface ContainerOverrides {
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly evaluators?: readonly Evaluator[];
  readonly onEvaluationError?: (attemptId: string, error: unknown) => void;
}

/**
 * The composition root: the one place that knows which concrete implementation
 * satisfies each port.
 *
 * This is what "Change Test B" costs in practice - adding a rule-based or human
 * evaluator means adding it to `resolveEvaluators` below. Nothing in
 * `application/` or `domain/` changes, because nothing there names an evaluator.
 */
export function buildContainer(config: AppConfig, overrides: ContainerOverrides = {}): Container {
  const db = openDatabase(config.databasePath);
  const content = new SubmissionContentFactory();
  const rubrics = new RubricRegistry();
  const rubric = rubrics.current;

  const problems = new SqliteProblemRepository(db);
  seedProblems(problems);

  const attempts = new SqliteAttemptRepository(db, content);
  const evaluations = new SqliteEvaluationRepository(db, rubrics);

  const { evaluators, mode } = resolveEvaluators(config, overrides.evaluators);
  const registry = new EvaluatorRegistry(evaluators);

  const clock = overrides.clock ?? systemClock;
  const ids = overrides.ids ?? uuidIdGenerator;

  const coordinator = new EvaluationCoordinator({
    attempts,
    evaluations,
    problems,
    evaluators: registry,
    rubric,
    clock,
    ids,
    timeoutMs: config.llmTimeoutMs,
    onError:
      overrides.onEvaluationError ??
      ((attemptId, error) => {
        console.error(`[evaluation] attempt ${attemptId} failed:`, error instanceof Error ? error.message : error);
      }),
  });

  const practice = new PracticeService({
    problems,
    attempts,
    evaluations,
    content,
    coordinator,
    clock,
    ids,
  });

  const history = new AttemptHistoryService(attempts, evaluations, problems);

  return {
    config,
    db,
    practice,
    history,
    coordinator,
    rubric,
    content,
    evaluator: registry.all[0],
    evaluationMode: mode,
    close: () => db.close(),
  };
}

function seedProblems(repository: SqliteProblemRepository): void {
  PROBLEM_DEFINITIONS.forEach((definition, index) => repository.upsert(definition, index));
}

/**
 * Evaluator selection, with an explicit and inspectable reason.
 *
 * `auto` (the default) uses an LLM when a key is present and the heuristic
 * evaluator otherwise, so a reviewer with no API key still gets the whole loop.
 * `llm` fails fast at start-up rather than silently degrading, because a
 * demo that silently stops using the model is worse than one that will not boot.
 */
function resolveEvaluators(
  config: AppConfig,
  provided?: readonly Evaluator[],
): { evaluators: readonly Evaluator[]; mode: Container['evaluationMode'] } {
  if (provided && provided.length > 0) {
    const first = provided[0];
    return {
      evaluators: provided,
      mode: {
        kind: first.descriptor.kind,
        label: first.descriptor.label,
        isDemo: first.descriptor.kind !== 'llm',
        reason: 'Evaluator supplied by the host application (test or custom wiring).',
      },
    };
  }

  const client = resolveLlmClient(config);

  if (config.evaluatorMode === 'llm' && !client) {
    throw new Error(
      'EVALUATOR=llm was requested but no ANTHROPIC_API_KEY or OPENAI_API_KEY is set. ' +
        'Set a key, or use EVALUATOR=auto / EVALUATOR=heuristic.',
    );
  }

  const useLlm = client !== undefined && config.evaluatorMode !== 'heuristic';
  if (useLlm && client) {
    const evaluator = new LlmEvaluator(client);
    return {
      evaluators: [evaluator],
      mode: {
        kind: 'llm',
        label: evaluator.descriptor.label,
        isDemo: false,
        reason: `Using ${evaluator.descriptor.label} for design judgement; structural checks stay deterministic.`,
      },
    };
  }

  const evaluator = new HeuristicEvaluator({ delayMs: config.demoEvaluationDelayMs });
  return {
    evaluators: [evaluator],
    mode: {
      kind: 'heuristic',
      label: evaluator.descriptor.label,
      isDemo: true,
      reason:
        config.evaluatorMode === 'heuristic'
          ? 'EVALUATOR=heuristic: deterministic offline feedback, no API key used.'
          : 'No LLM API key configured, so feedback comes from the deterministic offline evaluator.',
    },
  };
}

function resolveLlmClient(config: AppConfig): LlmClient | undefined {
  if (config.anthropicApiKey)
    return new AnthropicClient(config.anthropicApiKey, config.anthropicModel, config.anthropicBaseUrl);
  if (config.openaiApiKey)
    return new OpenAiClient(config.openaiApiKey, config.openaiModel, config.openaiBaseUrl);
  return undefined;
}
