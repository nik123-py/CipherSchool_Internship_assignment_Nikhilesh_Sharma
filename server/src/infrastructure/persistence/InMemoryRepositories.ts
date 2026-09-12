import { Attempt } from '../../domain/attempt/Attempt';
import { AttemptQuery, AttemptRepository } from '../../domain/attempt/AttemptRepository';
import { AttemptStatus } from '../../domain/attempt/AttemptStatus';
import { Evaluation } from '../../domain/evaluation/Evaluation';
import { EvaluationRepository } from '../../domain/evaluation/EvaluationRepository';
import { Problem, ProblemDefinition } from '../../domain/problem/Problem';
import { ProblemRepository } from '../../domain/problem/ProblemRepository';

/**
 * In-memory implementations of the same ports.
 *
 * These are not a toy: they are what the domain and application tests run
 * against, which keeps those tests fast and keeps the ports honest. If a
 * repository method is hard to implement here, it is usually a sign the port
 * has leaked SQL thinking into the domain.
 */
export class InMemoryProblemRepository implements ProblemRepository {
  private readonly problems: Problem[];

  constructor(definitions: readonly ProblemDefinition[]) {
    this.problems = definitions.map((d) => Problem.from(d));
  }

  list(): Problem[] {
    return [...this.problems];
  }

  findById(id: string): Problem | null {
    return this.problems.find((p) => p.id === id) ?? null;
  }
}

export class InMemoryAttemptRepository implements AttemptRepository {
  private readonly byId = new Map<string, Attempt>();

  save(attempt: Attempt): void {
    this.byId.set(attempt.id, attempt);
  }

  findById(id: string): Attempt | null {
    return this.byId.get(id) ?? null;
  }

  list(query: AttemptQuery): Attempt[] {
    const results = [...this.byId.values()]
      .filter((a) => a.learnerId === query.learnerId)
      .filter((a) => !query.problemId || a.problemId === query.problemId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.attemptNumber - a.attemptNumber);
    return query.limit ? results.slice(0, query.limit) : results;
  }

  listByStatus(status: AttemptStatus): Attempt[] {
    return [...this.byId.values()].filter((a) => a.status === status);
  }

  findOpenDraft(learnerId: string, problemId: string): Attempt | null {
    return (
      this.list({ learnerId, problemId })
        .filter((a) => a.status === 'DRAFT')
        .sort((a, b) => b.attemptNumber - a.attemptNumber)[0] ?? null
    );
  }

  countFor(learnerId: string, problemId: string): number {
    return this.list({ learnerId, problemId }).length;
  }

  findLatestCompleted(learnerId: string, problemId: string): Attempt | null {
    return (
      this.list({ learnerId, problemId })
        .filter((a) => a.status === 'COMPLETED')
        .sort((a, b) => b.attemptNumber - a.attemptNumber)[0] ?? null
    );
  }
}

export class InMemoryEvaluationRepository implements EvaluationRepository {
  private readonly byId = new Map<string, Evaluation>();

  save(evaluation: Evaluation): void {
    this.byId.set(evaluation.id, evaluation);
  }

  findById(id: string): Evaluation | null {
    return this.byId.get(id) ?? null;
  }

  findByAttemptId(attemptId: string): Evaluation | null {
    return [...this.byId.values()].find((e) => e.attemptId === attemptId) ?? null;
  }

  findByAttemptIds(attemptIds: readonly string[]): Map<string, Evaluation> {
    const wanted = new Set(attemptIds);
    const result = new Map<string, Evaluation>();
    for (const evaluation of this.byId.values()) {
      if (wanted.has(evaluation.attemptId)) result.set(evaluation.attemptId, evaluation);
    }
    return result;
  }
}
