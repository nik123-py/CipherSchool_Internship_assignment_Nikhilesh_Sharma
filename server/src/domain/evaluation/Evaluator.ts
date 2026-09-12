import { Problem } from '../problem/Problem';
import { DesignDocument } from '../submission/DesignDocument';
import { SubmissionFormat } from '../submission/SubmissionContent';
import { CriterionFeedback } from './CriterionFeedback';
import { EvaluatorDescriptor } from './Evaluation';
import { Rubric } from './Rubric';

/** Everything an evaluator is allowed to see. Nothing else is in scope. */
export interface EvaluationRequest {
  readonly problem: Problem;
  readonly document: DesignDocument;
  readonly format: SubmissionFormat;
  readonly rubric: Rubric;
  readonly attemptNumber: number;
  /**
   * What the learner was told to focus on this time, carried over from the
   * previous attempt's feedback. Lets an evaluator comment on whether the
   * learner actually moved. Optional: evaluators must work without it.
   */
  readonly previousFocus?: string;
  /** Aborted when the evaluation budget is exceeded. */
  readonly signal?: AbortSignal;
}

/**
 * What an evaluator returns: per-criterion judgements plus a short narrative.
 * Note what is *absent* - no overall score, no strengths list, no ranking.
 * Those are derived by `Evaluation` from the rubric so that every evaluator,
 * human or machine, is aggregated identically.
 */
export interface EvaluatorVerdict {
  readonly criteria: readonly CriterionFeedback[];
  readonly summary: string;
  readonly nextFocus: string;
}

/**
 * The port the practice flow depends on.
 *
 * `PracticeService` and `EvaluationCoordinator` know only this interface, so
 * adding a rule-based evaluator, a second model, or routing to a human reviewer
 * is a wiring change in the composition root - not a change to the practice
 * loop. See docs/DESIGN.md, "Change Test B".
 *
 * Implementations must:
 *  - return feedback for every criterion in the supplied rubric, and
 *  - throw `EvaluationFailedError` when they cannot, rather than inventing one.
 */
export interface Evaluator {
  readonly descriptor: EvaluatorDescriptor;
  /** Formats this evaluator can read. Checked before dispatch. */
  supports(format: SubmissionFormat): boolean;
  evaluate(request: EvaluationRequest): Promise<EvaluatorVerdict>;
}
