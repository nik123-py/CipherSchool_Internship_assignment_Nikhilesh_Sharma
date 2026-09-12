import { ValidationError } from '../shared/errors';
import { StructuralCheck } from '../submission/StructuralRules';
import { CriterionFeedback } from './CriterionFeedback';
import { Rubric } from './Rubric';
import { Score } from './Score';

export interface EvaluatorDescriptor {
  /** Stable id recorded on every evaluation, e.g. `llm:anthropic:claude-sonnet-5`. */
  readonly id: string;
  readonly kind: 'heuristic' | 'llm' | 'human';
  /** Shown to the learner so they always know what judged them. */
  readonly label: string;
}

export interface EvaluationProps {
  readonly id: string;
  readonly attemptId: string;
  readonly rubric: Rubric;
  readonly evaluator: EvaluatorDescriptor;
  readonly criteria: readonly CriterionFeedback[];
  readonly summary: string;
  readonly nextFocus: string;
  readonly structuralChecks: readonly StructuralCheck[];
  readonly durationMs: number;
  readonly createdAt: Date;
}

/**
 * A completed judgement of one submission.
 *
 * Deliberate split of labour: an evaluator supplies *per-criterion* judgements
 * plus a short narrative; the `Evaluation` derives everything aggregate -
 * overall score, strengths, ranked priorities - from the rubric. That keeps the
 * numbers explainable and identical no matter which evaluator ran, and stops an
 * LLM from being asked to "give this design a score out of 100".
 */
export class Evaluation {
  readonly id: string;
  readonly attemptId: string;
  readonly rubric: Rubric;
  readonly evaluator: EvaluatorDescriptor;
  readonly criteria: readonly CriterionFeedback[];
  readonly summary: string;
  readonly nextFocus: string;
  readonly structuralChecks: readonly StructuralCheck[];
  readonly durationMs: number;
  readonly createdAt: Date;
  readonly overall: Score;

  constructor(props: EvaluationProps) {
    if (props.criteria.length === 0) {
      throw new ValidationError('An evaluation must contain at least one criterion result.');
    }
    const unknown = props.criteria.filter((c) => !props.rubric.has(c.criterionKey));
    if (unknown.length > 0) {
      throw new ValidationError(
        `Evaluation contains criteria that are not in rubric ${props.rubric.version}: ${unknown
          .map((c) => c.criterionKey)
          .join(', ')}.`,
      );
    }
    this.id = props.id;
    this.attemptId = props.attemptId;
    this.rubric = props.rubric;
    this.evaluator = props.evaluator;
    this.criteria = props.criteria;
    this.summary = props.summary;
    this.nextFocus = props.nextFocus;
    this.structuralChecks = props.structuralChecks;
    this.durationMs = props.durationMs;
    this.createdAt = props.createdAt;
    this.overall = props.rubric.aggregate(this.scoreMap());
  }

  get rubricVersion(): string {
    return this.rubric.version;
  }

  scoreMap(): Map<string, Score> {
    return new Map(this.criteria.map((c) => [c.criterionKey, c.score]));
  }

  feedbackFor(criterionKey: string): CriterionFeedback | undefined {
    return this.criteria.find((c) => c.criterionKey === criterionKey);
  }

  /** Criteria the learner clearly handled well, strongest first. */
  strengths(limit = 3): CriterionFeedback[] {
    return [...this.criteria]
      .filter((c) => c.score.value >= 6.5)
      .sort((a, b) => b.score.value - a.score.value)
      .slice(0, limit);
  }

  /**
   * What to fix first: ranked by recoverable overall score
   * (criterion weight x remaining head-room), not by raw low score.
   */
  priorities(limit = 3): CriterionFeedback[] {
    return [...this.criteria]
      .filter((c) => c.score.value < 8.5)
      .sort(
        (a, b) =>
          this.rubric.improvementImpact(b.criterionKey, b.score) -
          this.rubric.improvementImpact(a.criterionKey, a.score),
      )
      .slice(0, limit);
  }

  /** Criteria whose evidence could not be traced back to the submission. */
  ungroundedCriteria(): CriterionFeedback[] {
    return this.criteria.filter((c) => !c.grounded);
  }

  get hasStructuralWarnings(): boolean {
    return this.structuralChecks.some((c) => c.status !== 'pass');
  }
}
