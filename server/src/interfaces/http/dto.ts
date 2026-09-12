import { AttemptHistoryEntry } from '../../application/AttemptHistoryService';
import { Attempt } from '../../domain/attempt/Attempt';
import { Evaluation } from '../../domain/evaluation/Evaluation';
import { Rubric } from '../../domain/evaluation/Rubric';
import { Problem } from '../../domain/problem/Problem';
import { StructuralReport } from '../../domain/submission/StructuralRules';
import { STRUCTURED_TEXT_SECTIONS } from '../../domain/submission/SubmissionSchema';

/**
 * Domain objects never leave the process. These mappers are the contract the
 * web client codes against, which means the domain stays free to change shape
 * (value objects, computed properties) without breaking the UI.
 */

export function problemSummaryDto(
  problem: Problem,
  stats?: { attempts: number; bestOverall: number | null; lastStatus: string | null },
) {
  const d = problem.data;
  return {
    id: d.id,
    title: d.title,
    difficulty: d.difficulty,
    tagline: d.tagline,
    estimatedMinutes: d.estimatedMinutes,
    requirementCount: d.functionalRequirements.length,
    focusAreas: d.designFocus.map((f) => f.area),
    stats: stats ?? { attempts: 0, bestOverall: null, lastStatus: null },
  };
}

export function problemDetailDto(problem: Problem) {
  const d = problem.data;
  return {
    ...problemSummaryDto(problem),
    statement: d.statement,
    functionalRequirements: d.functionalRequirements,
    constraints: d.constraints,
    designFocus: d.designFocus,
    edgeCases: d.edgeCases,
    extensibilityProbe: d.extensibilityProbe,
  };
}

export function attemptDto(attempt: Attempt) {
  return {
    id: attempt.id,
    problemId: attempt.problemId,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    format: attempt.currentContent.format,
    isEditable: attempt.isEditable,
    canRetryEvaluation: attempt.canRetryEvaluation,
    content: attempt.currentContent.toJSON(),
    submittedAt: attempt.submission?.submittedAt.toISOString() ?? null,
    evaluationId: attempt.evaluationId,
    carriedFocus: attempt.carriedFocus,
    failure: attempt.failure
      ? { reason: attempt.failure.reason, at: attempt.failure.at.toISOString(), retryable: attempt.failure.retryable }
      : null,
    failureCount: attempt.failureCount,
    createdAt: attempt.createdAt.toISOString(),
    updatedAt: attempt.updatedAt.toISOString(),
  };
}

export function structuralReportDto(report: StructuralReport) {
  return {
    isSubmittable: report.isSubmittable,
    passed: report.passed.length,
    total: report.checks.length,
    checks: report.checks,
  };
}

export function evaluationDto(evaluation: Evaluation) {
  const criterion = (key: string) => evaluation.rubric.criterion(key);
  const toCriterionDto = (feedback: ReturnType<Evaluation['feedbackFor']>) => {
    if (!feedback) return null;
    const spec = criterion(feedback.criterionKey);
    return {
      key: feedback.criterionKey,
      title: spec.title,
      question: spec.question,
      weight: spec.weight,
      score: feedback.score.value,
      band: feedback.score.band,
      evidence: feedback.evidence,
      evidenceSection: feedback.evidenceSection ?? null,
      evidenceSectionTitle:
        STRUCTURED_TEXT_SECTIONS.find((s) => s.key === feedback.evidenceSection)?.title ?? null,
      concern: feedback.concern,
      suggestion: feedback.suggestion,
      confidence: feedback.confidence,
      grounded: feedback.grounded,
    };
  };

  return {
    id: evaluation.id,
    attemptId: evaluation.attemptId,
    overall: evaluation.overall.value,
    band: evaluation.overall.band,
    rubricVersion: evaluation.rubricVersion,
    evaluator: evaluation.evaluator,
    summary: evaluation.summary,
    nextFocus: evaluation.nextFocus,
    durationMs: evaluation.durationMs,
    createdAt: evaluation.createdAt.toISOString(),
    criteria: evaluation.criteria.map(toCriterionDto),
    strengths: evaluation.strengths().map(toCriterionDto),
    priorities: evaluation.priorities().map(toCriterionDto),
    ungroundedCount: evaluation.ungroundedCriteria().length,
    structuralChecks: evaluation.structuralChecks,
  };
}

export function historyEntryDto(entry: AttemptHistoryEntry) {
  return {
    attempt: attemptDto(entry.attempt),
    problem: { id: entry.problem.id, title: entry.problem.title, difficulty: entry.problem.difficulty },
    evaluation: entry.evaluation
      ? {
          id: entry.evaluation.id,
          overall: entry.evaluation.overall.value,
          band: entry.evaluation.overall.band,
          summary: entry.evaluation.summary,
          nextFocus: entry.evaluation.nextFocus,
          evaluator: entry.evaluation.evaluator,
          strengths: entry.evaluation.strengths(2).map((f) => ({
            key: f.criterionKey,
            title: entry.evaluation!.rubric.criterion(f.criterionKey).title,
            score: f.score.value,
          })),
          priorities: entry.evaluation.priorities(2).map((f) => ({
            key: f.criterionKey,
            title: entry.evaluation!.rubric.criterion(f.criterionKey).title,
            score: f.score.value,
          })),
        }
      : null,
    comparison: entry.comparison,
  };
}

export function rubricDto(rubric: Rubric) {
  return {
    version: rubric.version,
    criteria: rubric.criteria.map((c) => ({
      key: c.key,
      title: c.title,
      question: c.question,
      weight: c.weight,
      whatGoodLooksLike: c.whatGoodLooksLike,
      evidenceSections: c.evidenceSections,
    })),
  };
}

export function submissionSchemaDto() {
  return {
    format: 'structured-text',
    sections: STRUCTURED_TEXT_SECTIONS.map((s) => ({
      key: s.key,
      title: s.title,
      kind: s.kind,
      required: s.required,
      minWords: s.minWords,
      helper: s.helper,
      placeholder: s.placeholder,
      feeds: s.feeds,
    })),
  };
}
