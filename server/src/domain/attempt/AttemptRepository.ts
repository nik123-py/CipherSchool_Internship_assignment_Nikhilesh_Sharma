import { Attempt } from './Attempt';
import { AttemptStatus } from './AttemptStatus';

export interface AttemptQuery {
  readonly learnerId: string;
  readonly problemId?: string;
  readonly limit?: number;
}

/**
 * Persistence port for the attempt aggregate.
 *
 * The query methods exist because the application asks real questions
 * ("does this learner already have a draft open?", "what was their last
 * completed attempt on this problem?"). Exposing a generic `find(criteria)`
 * would push those decisions into callers and make N+1 access the default.
 */
export interface AttemptRepository {
  save(attempt: Attempt): void;
  findById(id: string): Attempt | null;
  list(query: AttemptQuery): Attempt[];
  /** The learner's still-editable attempt for a problem, if one exists. */
  findOpenDraft(learnerId: string, problemId: string): Attempt | null;
  countFor(learnerId: string, problemId: string): number;
  /** Used at boot to recover attempts abandoned mid-evaluation by a crash. */
  listByStatus(status: AttemptStatus): Attempt[];
  /** Most recent COMPLETED attempt, used for progress comparison. */
  findLatestCompleted(learnerId: string, problemId: string): Attempt | null;
}
