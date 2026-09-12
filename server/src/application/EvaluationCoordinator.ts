import { AttemptRepository } from '../domain/attempt/AttemptRepository';
import { AttemptStatus } from '../domain/attempt/AttemptStatus';
import { Evaluation } from '../domain/evaluation/Evaluation';
import { EvaluationRepository } from '../domain/evaluation/EvaluationRepository';
import { Rubric } from '../domain/evaluation/Rubric';
import { ProblemRepository } from '../domain/problem/ProblemRepository';
import { Clock, IdGenerator } from '../domain/shared/clock';
import { NotFoundError } from '../domain/shared/errors';
import { runStructuralRules, StructuralReport } from '../domain/submission/StructuralRules';
import { EvaluatorRegistry } from './EvaluatorRegistry';

export interface EvaluationCoordinatorDeps {
  readonly attempts: AttemptRepository;
  readonly evaluations: EvaluationRepository;
  readonly problems: ProblemRepository;
  readonly evaluators: EvaluatorRegistry;
  readonly rubric: Rubric;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly timeoutMs: number;
  /** Kept injectable so tests can assert on failures without console noise. */
  readonly onError?: (attemptId: string, error: unknown) => void;
}

/**
 * Runs evaluations off the request path and owns the failure story.
 *
 * Scope note: this is an in-process background runner, not a queue. That is the
 * right size for this prototype - the submission is already durable before the
 * evaluator is called, so the worst case of a crash mid-evaluation is an
 * attempt stuck in EVALUATING, which `recoverStuckEvaluations()` resolves on
 * the next boot. The seam for a real queue is `schedule()`, and only that.
 *
 * Guarantees:
 *  - the submission is persisted before any evaluator runs (PracticeService)
 *  - an attempt is never evaluated twice concurrently (in-flight map)
 *  - a slow evaluator is aborted at `timeoutMs` and reported as FAILED
 *  - any evaluator error becomes FAILED + a retry offer, never a lost attempt
 */
export class EvaluationCoordinator {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(private readonly deps: EvaluationCoordinatorDeps) {}

  /**
   * Queue an evaluation. Returns immediately; the HTTP response does not wait.
   * Calling it twice for the same attempt is a no-op while the first run is
   * still in flight - that is the duplicate-processing guard.
   */
  schedule(attemptId: string, report?: StructuralReport): Promise<void> {
    const existing = this.inFlight.get(attemptId);
    if (existing) return existing;

    const run = this.run(attemptId, report)
      .catch((error) => this.deps.onError?.(attemptId, error))
      .finally(() => this.inFlight.delete(attemptId));

    this.inFlight.set(attemptId, run);
    return run;
  }

  /** Test/shutdown helper: resolves when no evaluation is in flight. */
  async settled(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight.values()]);
    }
  }

  get pendingCount(): number {
    return this.inFlight.size;
  }

  /**
   * Boot-time recovery: anything left EVALUATING when the process died is not
   * coming back on its own, so it is failed with an honest reason and a retry
   * button rather than spinning forever in the UI.
   */
  recoverStuckEvaluations(): number {
    const stuck = this.deps.attempts.listByStatus('EVALUATING');
    const now = this.deps.clock.now();
    for (const attempt of stuck) {
      attempt.failEvaluation('The server restarted while this evaluation was running.', now, true);
      this.deps.attempts.save(attempt);
    }
    return stuck.length;
  }

  private async run(attemptId: string, providedReport?: StructuralReport): Promise<void> {
    const attempt = this.deps.attempts.findById(attemptId);
    if (!attempt) throw new NotFoundError('Attempt', attemptId);

    const submission = attempt.submission;
    if (!submission) return;
    // Nothing to do for an attempt that is already evaluated or still a draft.
    const initialStatus: AttemptStatus = attempt.status;
    if (initialStatus !== 'SUBMITTED' && initialStatus !== 'FAILED') return;

    const problem = this.deps.problems.findById(attempt.problemId);
    if (!problem) throw new NotFoundError('Problem', attempt.problemId);

    attempt.beginEvaluation(this.deps.clock.now());
    this.deps.attempts.save(attempt);

    const document = submission.toDesignDocument();
    const report = providedReport ?? runStructuralRules(document);
    const evaluator = this.deps.evaluators.select(submission.format);
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deps.timeoutMs);

    try {
      const verdict = await withTimeout(
        evaluator.evaluate({
          problem,
          document,
          format: submission.format,
          rubric: this.deps.rubric,
          attemptNumber: attempt.attemptNumber,
          previousFocus: attempt.carriedFocus ?? undefined,
          signal: controller.signal,
        }),
        this.deps.timeoutMs,
        `${evaluator.descriptor.label} did not respond within ${Math.round(this.deps.timeoutMs / 1000)}s.`,
      );

      const evaluation = new Evaluation({
        id: this.deps.ids.next('evl'),
        attemptId: attempt.id,
        rubric: this.deps.rubric,
        evaluator: evaluator.descriptor,
        criteria: verdict.criteria,
        summary: verdict.summary,
        nextFocus: verdict.nextFocus,
        structuralChecks: report.checks,
        durationMs: Date.now() - startedAt,
        createdAt: this.deps.clock.now(),
      });

      // Store the evaluation first: if the attempt update failed after this,
      // the evaluation is still recoverable by attempt id.
      this.deps.evaluations.save(evaluation);
      attempt.completeEvaluation(evaluation.id, this.deps.clock.now());
      this.deps.attempts.save(attempt);
    } catch (error) {
      const reason = describeFailure(error, controller.signal.aborted);
      if (attempt.status === 'EVALUATING') {
        attempt.failEvaluation(reason, this.deps.clock.now(), true);
        this.deps.attempts.save(attempt);
      }
      this.deps.onError?.(attemptId, error);
    } finally {
      clearTimeout(timer);
    }
  }
}

function describeFailure(error: unknown, aborted: boolean): string {
  if (aborted) return 'The evaluator timed out. Your submission was saved - retry when you are ready.';
  if (error instanceof Error && error.message) return error.message;
  return 'The evaluator failed for an unknown reason.';
}

/** Belt and braces: not every evaluator honours an AbortSignal. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
