import { ConflictError, InvalidStateTransitionError } from '../shared/errors';
import { Submission } from '../submission/Submission';
import { SubmissionContent } from '../submission/SubmissionContent';
import { AttemptStatus, canTransition, isEditable } from './AttemptStatus';

export interface AttemptFailure {
  readonly reason: string;
  readonly at: Date;
  readonly retryable: boolean;
}

export interface AttemptProps {
  readonly id: string;
  readonly problemId: string;
  readonly learnerId: string;
  readonly attemptNumber: number;
  readonly status: AttemptStatus;
  readonly draft: SubmissionContent;
  readonly submission: Submission | null;
  readonly evaluationId: string | null;
  readonly failure: AttemptFailure | null;
  readonly failureCount: number;
  /** Carried over from the previous attempt's feedback; shown in the workspace. */
  readonly carriedFocus: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type SubmitOutcome = 'accepted' | 'already-submitted';

/**
 * The aggregate root of the practice loop.
 *
 * It owns exactly one thing: **the lifecycle of one try at one problem**.
 * Every state change goes through a guarded method here, so no service, route
 * or repository can put an attempt into an impossible state (evaluating a
 * draft, editing a submitted design, completing something twice).
 *
 * What it deliberately does not own: how a design is judged (evaluators), what
 * "good" means (rubric), or how it is stored (repository).
 */
export class Attempt {
  private constructor(private props: AttemptProps) {}

  static start(params: {
    id: string;
    problemId: string;
    learnerId: string;
    attemptNumber: number;
    draft: SubmissionContent;
    carriedFocus?: string | null;
    now: Date;
  }): Attempt {
    return new Attempt({
      id: params.id,
      problemId: params.problemId,
      learnerId: params.learnerId,
      attemptNumber: params.attemptNumber,
      status: 'DRAFT',
      draft: params.draft,
      submission: null,
      evaluationId: null,
      failure: null,
      failureCount: 0,
      carriedFocus: params.carriedFocus ?? null,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  /** Rehydration from storage. No guards: history is history. */
  static rehydrate(props: AttemptProps): Attempt {
    return new Attempt(props);
  }

  get id(): string {
    return this.props.id;
  }
  get problemId(): string {
    return this.props.problemId;
  }
  get learnerId(): string {
    return this.props.learnerId;
  }
  get attemptNumber(): number {
    return this.props.attemptNumber;
  }
  get status(): AttemptStatus {
    return this.props.status;
  }
  get draft(): SubmissionContent {
    return this.props.draft;
  }
  get submission(): Submission | null {
    return this.props.submission;
  }
  get evaluationId(): string | null {
    return this.props.evaluationId;
  }
  get failure(): AttemptFailure | null {
    return this.props.failure;
  }
  get failureCount(): number {
    return this.props.failureCount;
  }
  get carriedFocus(): string | null {
    return this.props.carriedFocus;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** The content to show in the workspace: frozen submission if there is one. */
  get currentContent(): SubmissionContent {
    return this.props.submission?.content ?? this.props.draft;
  }

  get isEditable(): boolean {
    return isEditable(this.props.status);
  }

  get canRetryEvaluation(): boolean {
    return this.props.status === 'FAILED' && (this.props.failure?.retryable ?? true);
  }

  /** Autosave. Rejected once the design is frozen - by design, not by accident. */
  saveDraft(content: SubmissionContent, now: Date): void {
    if (!this.isEditable) {
      throw new ConflictError(
        `This attempt is ${this.props.status} and its design is frozen. Start a new attempt to keep working.`,
        { attemptId: this.id, status: this.props.status },
      );
    }
    this.props = { ...this.props, draft: content, updatedAt: now };
  }

  /**
   * Hand the design in.
   *
   * Idempotent on purpose: a double-clicked button or a retried request that
   * carries the *same* content returns `already-submitted` instead of creating
   * a second evaluation. Different content while an evaluation is in flight is
   * a genuine conflict and is rejected.
   */
  submit(content: SubmissionContent, now: Date): SubmitOutcome {
    const current = this.props.submission;

    if (this.props.status === 'SUBMITTED' || this.props.status === 'EVALUATING') {
      if (current && current.matches(content)) return 'already-submitted';
      throw new ConflictError(
        'This attempt is already being evaluated. Wait for the result, then start a new attempt to change your design.',
        { attemptId: this.id, status: this.props.status },
      );
    }

    if (this.props.status === 'COMPLETED') {
      // A retried request for the design we already evaluated is the same
      // request, not a new one: answer it the same way instead of erroring.
      if (current && current.matches(content)) return 'already-submitted';
      throw new ConflictError(
        'This attempt has already been evaluated. Use "Try again" to open attempt ' +
          `#${this.props.attemptNumber + 1}.`,
        { attemptId: this.id, status: this.props.status },
      );
    }

    const submission = Submission.of(content, now);
    this.transition('SUBMITTED', 'Only a draft (or a failed evaluation) can be submitted.');
    this.props = {
      ...this.props,
      draft: content,
      submission,
      failure: null,
      updatedAt: now,
    };
    return 'accepted';
  }

  beginEvaluation(now: Date): void {
    if (!this.props.submission) {
      throw new ConflictError('Cannot evaluate an attempt that has no submission.', { attemptId: this.id });
    }
    this.transition('EVALUATING', 'An evaluation only starts from a submitted or failed attempt.');
    this.props = { ...this.props, failure: null, updatedAt: now };
  }

  completeEvaluation(evaluationId: string, now: Date): void {
    this.transition('COMPLETED', 'An evaluation can only complete while it is running.');
    this.props = { ...this.props, evaluationId, failure: null, updatedAt: now };
  }

  /**
   * The evaluator gave up. The submission stays exactly where it is; only the
   * status changes, so nothing the learner wrote is ever lost to an outage.
   */
  failEvaluation(reason: string, now: Date, retryable = true): void {
    this.transition('FAILED', 'Only a running evaluation can fail.');
    this.props = {
      ...this.props,
      failure: { reason, at: now, retryable },
      failureCount: this.props.failureCount + 1,
      updatedAt: now,
    };
  }

  /** Focus line carried into the *next* attempt on this problem. */
  withCarriedFocus(focus: string | null): Attempt {
    this.props = { ...this.props, carriedFocus: focus };
    return this;
  }

  snapshot(): AttemptProps {
    return { ...this.props };
  }

  private transition(to: AttemptStatus, hint: string): void {
    if (!canTransition(this.props.status, to)) {
      throw new InvalidStateTransitionError(this.props.status, to, hint);
    }
    this.props = { ...this.props, status: to };
  }
}
