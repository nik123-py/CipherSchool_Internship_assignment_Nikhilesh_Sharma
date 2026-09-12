import { Evaluator } from '../domain/evaluation/Evaluator';
import { ValidationError } from '../domain/shared/errors';
import { SubmissionFormat } from '../domain/submission/SubmissionContent';

/**
 * Picks the evaluator for a submission format.
 *
 * Today it holds one evaluator and the choice is trivial. It exists anyway
 * because it is the single place a second evaluator gets plugged in - a
 * rule-based one, a different model, or a queue that routes to a human -
 * without `PracticeService` or `EvaluationCoordinator` learning a new name.
 * Order is priority order: the first evaluator that supports the format wins.
 */
export class EvaluatorRegistry {
  constructor(private readonly evaluators: readonly Evaluator[]) {
    if (evaluators.length === 0) {
      throw new Error('EvaluatorRegistry needs at least one evaluator.');
    }
  }

  select(format: SubmissionFormat): Evaluator {
    const evaluator = this.evaluators.find((e) => e.supports(format));
    if (!evaluator) {
      throw new ValidationError(`No evaluator can read '${format}' submissions.`, { format });
    }
    return evaluator;
  }

  get all(): readonly Evaluator[] {
    return this.evaluators;
  }
}
