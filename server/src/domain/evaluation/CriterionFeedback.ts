import { ValidationError } from '../shared/errors';
import { truncate } from '../shared/text';
import { Confidence, Score } from './Score';

export interface CriterionFeedbackProps {
  readonly criterionKey: string;
  readonly score: Score;
  /** A quote or close paraphrase of what the learner actually wrote. */
  readonly evidence: string;
  /** Where the evidence came from, so the UI can link back to the section. */
  readonly evidenceSection?: string;
  readonly concern: string;
  readonly suggestion: string;
  readonly confidence: Confidence;
  /**
   * True when the evidence could be traced back to the submission text.
   * Ungrounded evidence is still shown - flagged, and with confidence lowered -
   * because hiding it would hide the fact that the model drifted.
   */
  readonly grounded: boolean;
}

/**
 * One criterion's worth of feedback: score, the evidence it rests on, the
 * concern, and one concrete next move.
 *
 * The invariant this value object exists to protect: **feedback without
 * evidence is not feedback**. An evaluator that cannot point at the learner's
 * own words cannot produce a `CriterionFeedback`.
 */
export class CriterionFeedback {
  readonly criterionKey: string;
  readonly score: Score;
  readonly evidence: string;
  readonly evidenceSection?: string;
  readonly concern: string;
  readonly suggestion: string;
  readonly confidence: Confidence;
  readonly grounded: boolean;

  constructor(props: CriterionFeedbackProps) {
    if (!props.criterionKey) throw new ValidationError('CriterionFeedback requires a criterion key.');
    if (!props.evidence?.trim()) {
      throw new ValidationError(
        `Criterion '${props.criterionKey}' has no evidence. Feedback must quote the submission.`,
      );
    }
    if (!props.suggestion?.trim()) {
      throw new ValidationError(`Criterion '${props.criterionKey}' has no improvement suggestion.`);
    }
    this.criterionKey = props.criterionKey;
    this.score = props.score;
    this.evidence = truncate(props.evidence, 400);
    this.evidenceSection = props.evidenceSection;
    this.concern = props.concern?.trim() || 'No blocking concern for this criterion.';
    this.suggestion = props.suggestion.trim();
    this.confidence = props.confidence;
    this.grounded = props.grounded;
  }

  /** Lowered confidence + a visible flag when evidence could not be traced. */
  withGroundingResult(grounded: boolean): CriterionFeedback {
    if (grounded === this.grounded) return this;
    return new CriterionFeedback({
      criterionKey: this.criterionKey,
      score: this.score,
      evidence: this.evidence,
      evidenceSection: this.evidenceSection,
      concern: this.concern,
      suggestion: this.suggestion,
      confidence: grounded ? this.confidence : 'low',
      grounded,
    });
  }
}
