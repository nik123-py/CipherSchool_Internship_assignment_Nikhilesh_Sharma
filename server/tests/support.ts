import { AttemptHistoryService } from '../src/application/AttemptHistoryService';
import { EvaluationCoordinator } from '../src/application/EvaluationCoordinator';
import { EvaluatorRegistry } from '../src/application/EvaluatorRegistry';
import { PracticeService } from '../src/application/PracticeService';
import { Evaluator } from '../src/domain/evaluation/Evaluator';
import { Rubric } from '../src/domain/evaluation/Rubric';
import { SubmissionContentFactory } from '../src/domain/submission/SubmissionContentFactory';
import { PROBLEM_DEFINITIONS } from '../src/infrastructure/content/problems';
import {
  InMemoryAttemptRepository,
  InMemoryEvaluationRepository,
  InMemoryProblemRepository,
} from '../src/infrastructure/persistence/InMemoryRepositories';
import { FakeClock, SequentialIds, StubEvaluator } from './fixtures';

export interface TestHarness {
  practice: PracticeService;
  history: AttemptHistoryService;
  coordinator: EvaluationCoordinator;
  attempts: InMemoryAttemptRepository;
  evaluations: InMemoryEvaluationRepository;
  clock: FakeClock;
  errors: Array<{ attemptId: string; error: unknown }>;
}

/**
 * Wires the real application services against in-memory repositories.
 *
 * The point of this helper is that nothing is stubbed except the evaluator and
 * the clock: the state machine, the structural rules, the coordinator and the
 * progress calculation are all the production ones.
 */
export function createHarness(
  evaluator: Evaluator = new StubEvaluator(),
  options: { timeoutMs?: number } = {},
): TestHarness {
  const clock = new FakeClock();
  const ids = new SequentialIds();
  const content = new SubmissionContentFactory();
  const problems = new InMemoryProblemRepository(PROBLEM_DEFINITIONS);
  const attempts = new InMemoryAttemptRepository();
  const evaluations = new InMemoryEvaluationRepository();
  const errors: Array<{ attemptId: string; error: unknown }> = [];

  const coordinator = new EvaluationCoordinator({
    attempts,
    evaluations,
    problems,
    evaluators: new EvaluatorRegistry([evaluator]),
    rubric: Rubric.default(),
    clock,
    ids,
    timeoutMs: options.timeoutMs ?? 5000,
    onError: (attemptId, error) => errors.push({ attemptId, error }),
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

  return {
    practice,
    history: new AttemptHistoryService(attempts, evaluations, problems),
    coordinator,
    attempts,
    evaluations,
    clock,
    errors,
  };
}
