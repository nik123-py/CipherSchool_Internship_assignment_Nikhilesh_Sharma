import { Attempt, AttemptProps } from '../../domain/attempt/Attempt';
import { AttemptStatus } from '../../domain/attempt/AttemptStatus';
import { CriterionFeedback } from '../../domain/evaluation/CriterionFeedback';
import { Evaluation } from '../../domain/evaluation/Evaluation';
import { RubricRegistry } from '../../domain/evaluation/RubricRegistry';
import { Confidence, Score } from '../../domain/evaluation/Score';
import { StructuralCheck } from '../../domain/submission/StructuralRules';
import { Submission } from '../../domain/submission/Submission';
import { SubmissionFormat } from '../../domain/submission/SubmissionContent';
import { SubmissionContentFactory } from '../../domain/submission/SubmissionContentFactory';

export interface AttemptRow {
  id: string;
  problem_id: string;
  learner_id: string;
  attempt_number: number;
  status: string;
  format: string;
  draft_json: string;
  submission_json: string | null;
  evaluation_id: string | null;
  failure_json: string | null;
  failure_count: number;
  carried_focus: string | null;
  created_at: string;
  updated_at: string;
}

export interface EvaluationRow {
  id: string;
  attempt_id: string;
  rubric_version: string;
  evaluator_id: string;
  evaluator_kind: string;
  evaluator_label: string;
  overall: number;
  summary: string;
  next_focus: string;
  criteria_json: string;
  structural_json: string;
  duration_ms: number;
  created_at: string;
}

/**
 * Row <-> aggregate translation lives here, not in the entities.
 *
 * Content is stored as JSON under a `format` discriminator and rebuilt through
 * `SubmissionContentFactory`, so a new submission format needs a codec and
 * nothing else - no migration, no new table, no change to these mappers.
 */
export function attemptToRow(attempt: Attempt): AttemptRow {
  const s = attempt.snapshot();
  return {
    id: s.id,
    problem_id: s.problemId,
    learner_id: s.learnerId,
    attempt_number: s.attemptNumber,
    status: s.status,
    format: s.draft.format,
    draft_json: JSON.stringify(s.draft.toJSON()),
    submission_json: s.submission
      ? JSON.stringify({
          format: s.submission.format,
          content: s.submission.content.toJSON(),
          fingerprint: s.submission.fingerprint,
          submittedAt: s.submission.submittedAt.toISOString(),
        })
      : null,
    evaluation_id: s.evaluationId,
    failure_json: s.failure
      ? JSON.stringify({ ...s.failure, at: s.failure.at.toISOString() })
      : null,
    failure_count: s.failureCount,
    carried_focus: s.carriedFocus,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}

export function rowToAttempt(row: AttemptRow, content: SubmissionContentFactory): Attempt {
  const format = row.format as SubmissionFormat;
  const draft = content.fromStored(format, JSON.parse(row.draft_json));

  let submission: Submission | null = null;
  if (row.submission_json) {
    const stored = JSON.parse(row.submission_json) as {
      format: SubmissionFormat;
      content: Record<string, unknown>;
      fingerprint: string;
      submittedAt: string;
    };
    submission = new Submission(
      content.fromStored(stored.format, stored.content),
      stored.fingerprint,
      new Date(stored.submittedAt),
    );
  }

  const failure = row.failure_json
    ? (() => {
        const parsed = JSON.parse(row.failure_json) as { reason: string; at: string; retryable: boolean };
        return { reason: parsed.reason, at: new Date(parsed.at), retryable: parsed.retryable };
      })()
    : null;

  const props: AttemptProps = {
    id: row.id,
    problemId: row.problem_id,
    learnerId: row.learner_id,
    attemptNumber: row.attempt_number,
    status: row.status as AttemptStatus,
    draft,
    submission,
    evaluationId: row.evaluation_id,
    failure,
    failureCount: row.failure_count,
    carriedFocus: row.carried_focus,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
  return Attempt.rehydrate(props);
}

interface StoredCriterion {
  criterionKey: string;
  score: number;
  evidence: string;
  evidenceSection?: string;
  concern: string;
  suggestion: string;
  confidence: Confidence;
  grounded: boolean;
}

export function evaluationToRow(evaluation: Evaluation): EvaluationRow {
  const criteria: StoredCriterion[] = evaluation.criteria.map((c) => ({
    criterionKey: c.criterionKey,
    score: c.score.value,
    evidence: c.evidence,
    evidenceSection: c.evidenceSection,
    concern: c.concern,
    suggestion: c.suggestion,
    confidence: c.confidence,
    grounded: c.grounded,
  }));

  return {
    id: evaluation.id,
    attempt_id: evaluation.attemptId,
    rubric_version: evaluation.rubricVersion,
    evaluator_id: evaluation.evaluator.id,
    evaluator_kind: evaluation.evaluator.kind,
    evaluator_label: evaluation.evaluator.label,
    overall: evaluation.overall.value,
    summary: evaluation.summary,
    next_focus: evaluation.nextFocus,
    criteria_json: JSON.stringify(criteria),
    structural_json: JSON.stringify(evaluation.structuralChecks),
    duration_ms: evaluation.durationMs,
    created_at: evaluation.createdAt.toISOString(),
  };
}

export function rowToEvaluation(row: EvaluationRow, rubrics: RubricRegistry): Evaluation {
  const criteria = (JSON.parse(row.criteria_json) as StoredCriterion[]).map(
    (c) =>
      new CriterionFeedback({
        criterionKey: c.criterionKey,
        score: Score.of(c.score),
        evidence: c.evidence,
        evidenceSection: c.evidenceSection,
        concern: c.concern,
        suggestion: c.suggestion,
        confidence: c.confidence,
        grounded: c.grounded,
      }),
  );

  return new Evaluation({
    id: row.id,
    attemptId: row.attempt_id,
    rubric: rubrics.get(row.rubric_version),
    evaluator: {
      id: row.evaluator_id,
      kind: row.evaluator_kind as 'heuristic' | 'llm' | 'human',
      label: row.evaluator_label,
    },
    criteria,
    summary: row.summary,
    nextFocus: row.next_focus,
    structuralChecks: JSON.parse(row.structural_json) as StructuralCheck[],
    durationMs: row.duration_ms,
    createdAt: new Date(row.created_at),
  });
}
