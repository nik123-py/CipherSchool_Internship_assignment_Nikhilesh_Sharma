import { Attempt } from '../domain/attempt/Attempt';
import { AttemptRepository } from '../domain/attempt/AttemptRepository';
import { EvaluationRepository } from '../domain/evaluation/EvaluationRepository';
import { Problem } from '../domain/problem/Problem';
import { ProblemRepository } from '../domain/problem/ProblemRepository';
import { Clock, IdGenerator } from '../domain/shared/clock';
import { ConflictError, NotFoundError, ValidationError } from '../domain/shared/errors';
import { runStructuralRules, StructuralReport } from '../domain/submission/StructuralRules';
import { SubmissionContent, SubmissionFormat } from '../domain/submission/SubmissionContent';
import { SubmissionContentFactory } from '../domain/submission/SubmissionContentFactory';
import { EvaluationCoordinator } from './EvaluationCoordinator';

export interface PracticeServiceDeps {
  readonly problems: ProblemRepository;
  readonly attempts: AttemptRepository;
  readonly evaluations: EvaluationRepository;
  readonly content: SubmissionContentFactory;
  readonly coordinator: EvaluationCoordinator;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * The practice loop, as use cases: start an attempt, keep the draft safe,
 * check its structure, hand it in.
 *
 * It coordinates; it does not decide. Lifecycle rules live in `Attempt`,
 * structural rules in `StructuralRules`, judgement in evaluators. Note that
 * nothing here mentions an LLM, a model name or an HTTP client - which is what
 * makes Change Test B a wiring change.
 */
export class PracticeService {
  constructor(private readonly deps: PracticeServiceDeps) {}

  listProblems(): Problem[] {
    return this.deps.problems.list();
  }

  getProblem(problemId: string): Problem {
    const problem = this.deps.problems.findById(problemId);
    if (!problem) throw new NotFoundError('Problem', problemId);
    return problem;
  }

  getAttempt(attemptId: string): Attempt {
    const attempt = this.deps.attempts.findById(attemptId);
    if (!attempt) throw new NotFoundError('Attempt', attemptId);
    return attempt;
  }

  /**
   * Start practising a problem.
   *
   * Idempotent by design: if the learner already has an open draft for this
   * problem, they get it back instead of accumulating abandoned attempt #4,
   * #5, #6 every time they revisit the page.
   */
  startAttempt(params: {
    learnerId: string;
    problemId: string;
    format?: SubmissionFormat;
  }): { attempt: Attempt; resumed: boolean } {
    const problem = this.getProblem(params.problemId);
    const existingDraft = this.deps.attempts.findOpenDraft(params.learnerId, problem.id);
    if (existingDraft) return { attempt: existingDraft, resumed: true };

    const attemptNumber = this.deps.attempts.countFor(params.learnerId, problem.id) + 1;
    const attempt = Attempt.start({
      id: this.deps.ids.next('att'),
      problemId: problem.id,
      learnerId: params.learnerId,
      attemptNumber,
      draft: this.deps.content.empty(params.format ?? 'structured-text'),
      carriedFocus: this.carriedFocusFor(params.learnerId, problem.id),
      now: this.deps.clock.now(),
    });
    this.deps.attempts.save(attempt);
    return { attempt, resumed: false };
  }

  /** Autosave. Returns the attempt so the client can confirm what was stored. */
  saveDraft(attemptId: string, patch: Record<string, unknown>): Attempt {
    const attempt = this.getAttempt(attemptId);
    const updated = this.deps.content.merge(attempt.draft, patch);
    attempt.saveDraft(updated, this.deps.clock.now());
    this.deps.attempts.save(attempt);
    return attempt;
  }

  /**
   * The deterministic pre-flight check, exposed on its own so the learner can
   * run it as often as they like before spending an evaluation.
   */
  checkStructure(attemptId: string, patch?: Record<string, unknown>): StructuralReport {
    const attempt = this.getAttempt(attemptId);
    const content = patch ? this.deps.content.merge(attempt.currentContent, patch) : attempt.currentContent;
    return runStructuralRules(content.toDesignDocument());
  }

  /**
   * Submit for evaluation.
   *
   * Order matters and is deliberate:
   *   1. deterministic gate  - never spend an evaluation on an unevaluable doc
   *   2. duplicate check     - never re-evaluate an unchanged design
   *   3. persist the frozen submission
   *   4. only then schedule the evaluator
   *
   * Step 3 before step 4 is the reason an evaluator crash can never lose work.
   *
   * `pending` is the scheduled run. Callers are free to ignore it - that is the
   * normal, background behaviour - but a host that is about to be suspended
   * (a serverless function answering a request) can await it instead.
   */
  submit(
    attemptId: string,
    patch?: Record<string, unknown>,
  ): {
    attempt: Attempt;
    outcome: 'accepted' | 'already-submitted';
    report: StructuralReport;
    pending?: Promise<void>;
  } {
    const attempt = this.getAttempt(attemptId);
    const content: SubmissionContent = patch
      ? this.deps.content.merge(attempt.currentContent, patch)
      : attempt.currentContent;

    const report = runStructuralRules(content.toDesignDocument());
    if (!report.isSubmittable) {
      throw new ValidationError(
        'This design is not ready to evaluate yet. Fill in the sections below and try again.',
        { checks: report.failures },
      );
    }

    this.rejectUnchangedResubmission(attempt, content);

    const outcome = attempt.submit(content, this.deps.clock.now());
    this.deps.attempts.save(attempt);

    const pending =
      outcome === 'accepted' ? this.deps.coordinator.schedule(attempt.id, report) : undefined;
    return { attempt, outcome, report, pending };
  }

  /** Re-run a failed evaluation. The submission is untouched. */
  retryEvaluation(attemptId: string): { attempt: Attempt; pending: Promise<void> } {
    const attempt = this.getAttempt(attemptId);
    if (!attempt.canRetryEvaluation) {
      throw new ConflictError(
        `Nothing to retry: this attempt is ${attempt.status}.`,
        { attemptId, status: attempt.status },
      );
    }
    return { attempt, pending: this.deps.coordinator.schedule(attempt.id) };
  }

  /**
   * Guard against burning an evaluation on a design that has not changed since
   * the learner's last completed attempt at the same problem. Retrying with
   * identical text cannot produce new feedback, and saying so is more useful
   * than silently charging them an LLM call for the same answer.
   */
  private rejectUnchangedResubmission(attempt: Attempt, content: SubmissionContent): void {
    if (attempt.status !== 'DRAFT') return;
    const previous = this.deps.attempts.findLatestCompleted(attempt.learnerId, attempt.problemId);
    if (!previous?.submission) return;
    if (previous.submission.matches(content)) {
      throw new ConflictError(
        `This is identical to attempt #${previous.attemptNumber}, so the feedback would be identical too. ` +
          'Change something first - the feedback from that attempt is the fastest place to start.',
        { previousAttemptId: previous.id, previousAttemptNumber: previous.attemptNumber },
      );
    }
  }

  /** The "focus next time" line from the learner's last completed attempt. */
  private carriedFocusFor(learnerId: string, problemId: string): string | null {
    const previous = this.deps.attempts.findLatestCompleted(learnerId, problemId);
    if (!previous?.evaluationId) return null;
    return this.deps.evaluations.findById(previous.evaluationId)?.nextFocus ?? null;
  }
}
