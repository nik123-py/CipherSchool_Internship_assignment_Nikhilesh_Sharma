import { Attempt } from '../domain/attempt/Attempt';
import { AttemptRepository } from '../domain/attempt/AttemptRepository';
import { Evaluation } from '../domain/evaluation/Evaluation';
import { EvaluationRepository } from '../domain/evaluation/EvaluationRepository';
import { Problem } from '../domain/problem/Problem';
import { ProblemRepository } from '../domain/problem/ProblemRepository';

export interface CriterionDelta {
  readonly criterionKey: string;
  readonly title: string;
  readonly previous: number;
  readonly current: number;
  readonly delta: number;
}

export interface ProgressComparison {
  readonly previousAttemptNumber: number;
  readonly previousOverall: number;
  readonly currentOverall: number;
  readonly delta: number;
  /** Biggest movers in both directions, so regressions are not hidden. */
  readonly improved: readonly CriterionDelta[];
  readonly regressed: readonly CriterionDelta[];
  /** Whether the previous attempt's "focus next time" line was acted on. */
  readonly focusFollowUp?: {
    readonly focus: string;
    readonly criterionKey?: string;
    readonly delta?: number;
  };
}

export interface AttemptHistoryEntry {
  readonly attempt: Attempt;
  readonly problem: Problem;
  readonly evaluation: Evaluation | null;
  readonly comparison: ProgressComparison | null;
}

/**
 * The "am I getting better?" half of the product.
 *
 * Progress is computed here rather than stored, because it is a *view* over
 * attempts: derived, always consistent with the underlying evaluations, and
 * impossible to leave stale. The comparison deliberately stays small - two
 * attempts, per-criterion deltas, both directions - rather than growing into
 * an analytics module.
 */
export class AttemptHistoryService {
  constructor(
    private readonly attempts: AttemptRepository,
    private readonly evaluations: EvaluationRepository,
    private readonly problems: ProblemRepository,
  ) {}

  /** Newest first. Optionally scoped to one problem. */
  history(learnerId: string, problemId?: string, limit?: number): AttemptHistoryEntry[] {
    const attempts = this.attempts.list({ learnerId, problemId, limit });
    const evaluations = this.evaluations.findByAttemptIds(attempts.map((a) => a.id));

    // Oldest-first pass so each attempt can be compared with the previous
    // completed attempt on the same problem.
    const chronological = [...attempts].reverse();
    const lastCompletedByProblem = new Map<string, { attempt: Attempt; evaluation: Evaluation }>();
    const comparisons = new Map<string, ProgressComparison>();

    for (const attempt of chronological) {
      const evaluation = evaluations.get(attempt.id);
      if (!evaluation) continue;
      const previous = lastCompletedByProblem.get(attempt.problemId);
      if (previous) {
        comparisons.set(attempt.id, compare(previous.attempt, previous.evaluation, evaluation));
      }
      lastCompletedByProblem.set(attempt.problemId, { attempt, evaluation });
    }

    return attempts
      .map((attempt) => {
        const problem = this.problems.findById(attempt.problemId);
        if (!problem) return null;
        return {
          attempt,
          problem,
          evaluation: evaluations.get(attempt.id) ?? null,
          comparison: comparisons.get(attempt.id) ?? null,
        } satisfies AttemptHistoryEntry;
      })
      .filter((entry): entry is AttemptHistoryEntry => entry !== null);
  }

  entry(attemptId: string): AttemptHistoryEntry | null {
    const attempt = this.attempts.findById(attemptId);
    if (!attempt) return null;
    const problem = this.problems.findById(attempt.problemId);
    if (!problem) return null;
    const evaluation = attempt.evaluationId ? this.evaluations.findById(attempt.evaluationId) : null;
    let comparison: ProgressComparison | null = null;
    if (evaluation) {
      const previousAttempt = this.previousCompletedBefore(attempt);
      const previousEvaluation = previousAttempt?.evaluationId
        ? this.evaluations.findById(previousAttempt.evaluationId)
        : null;
      if (previousAttempt && previousEvaluation) {
        comparison = compare(previousAttempt, previousEvaluation, evaluation);
      }
    }
    return { attempt, problem, evaluation, comparison };
  }

  /** Per-problem summary used by the dashboard cards. */
  problemStats(learnerId: string): Map<string, { attempts: number; bestOverall: number | null; lastStatus: string | null }> {
    const attempts = this.attempts.list({ learnerId });
    const evaluations = this.evaluations.findByAttemptIds(attempts.map((a) => a.id));
    const stats = new Map<string, { attempts: number; bestOverall: number | null; lastStatus: string | null }>();

    for (const attempt of attempts) {
      const current = stats.get(attempt.problemId) ?? { attempts: 0, bestOverall: null, lastStatus: null };
      const evaluation = evaluations.get(attempt.id);
      const overall = evaluation?.overall.value ?? null;
      stats.set(attempt.problemId, {
        attempts: current.attempts + 1,
        bestOverall:
          overall === null ? current.bestOverall : Math.max(current.bestOverall ?? 0, overall),
        // `list` is newest-first, so the first one we see is the latest.
        lastStatus: current.lastStatus ?? attempt.status,
      });
    }
    return stats;
  }

  private previousCompletedBefore(attempt: Attempt): Attempt | null {
    return (
      this.attempts
        .list({ learnerId: attempt.learnerId, problemId: attempt.problemId })
        .find((a) => a.status === 'COMPLETED' && a.attemptNumber < attempt.attemptNumber) ?? null
    );
  }
}

function compare(
  previousAttempt: Attempt,
  previous: Evaluation,
  current: Evaluation,
): ProgressComparison {
  const deltas: CriterionDelta[] = [];
  for (const criterion of current.rubric.criteria) {
    const before = previous.feedbackFor(criterion.key);
    const after = current.feedbackFor(criterion.key);
    if (!before || !after) continue;
    deltas.push({
      criterionKey: criterion.key,
      title: criterion.title,
      previous: before.score.value,
      current: after.score.value,
      delta: round1(after.score.value - before.score.value),
    });
  }

  const improved = deltas.filter((d) => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
  const regressed = deltas.filter((d) => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 2);

  return {
    previousAttemptNumber: previousAttempt.attemptNumber,
    previousOverall: previous.overall.value,
    currentOverall: current.overall.value,
    delta: round1(current.overall.value - previous.overall.value),
    improved,
    regressed,
    focusFollowUp: buildFocusFollowUp(previous, deltas),
  };
}

/**
 * Did the learner move on the thing we told them to work on? We know which
 * criterion the previous advice came from (the top priority), so this is a
 * lookup rather than text matching.
 */
function buildFocusFollowUp(
  previous: Evaluation,
  deltas: readonly CriterionDelta[],
): ProgressComparison['focusFollowUp'] {
  const priority = previous.priorities(1)[0];
  if (!priority) return undefined;
  const moved = deltas.find((d) => d.criterionKey === priority.criterionKey);
  return {
    focus: previous.nextFocus,
    criterionKey: priority.criterionKey,
    delta: moved?.delta,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
