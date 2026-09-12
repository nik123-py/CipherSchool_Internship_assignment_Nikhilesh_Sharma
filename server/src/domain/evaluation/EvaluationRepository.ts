import { Evaluation } from './Evaluation';

export interface EvaluationRepository {
  save(evaluation: Evaluation): void;
  findById(id: string): Evaluation | null;
  findByAttemptId(attemptId: string): Evaluation | null;
  /** Batch lookup so the history screen stays a single pass. */
  findByAttemptIds(attemptIds: readonly string[]): Map<string, Evaluation>;
}
