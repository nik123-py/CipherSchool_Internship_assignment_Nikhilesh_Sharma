import type { DatabaseSync } from 'node:sqlite';
import { Attempt } from '../../domain/attempt/Attempt';
import { AttemptQuery, AttemptRepository } from '../../domain/attempt/AttemptRepository';
import { AttemptStatus } from '../../domain/attempt/AttemptStatus';
import { Evaluation } from '../../domain/evaluation/Evaluation';
import { EvaluationRepository } from '../../domain/evaluation/EvaluationRepository';
import { RubricRegistry } from '../../domain/evaluation/RubricRegistry';
import { Problem, ProblemDefinition } from '../../domain/problem/Problem';
import { ProblemRepository } from '../../domain/problem/ProblemRepository';
import { SubmissionContentFactory } from '../../domain/submission/SubmissionContentFactory';
import {
  AttemptRow,
  EvaluationRow,
  attemptToRow,
  evaluationToRow,
  rowToAttempt,
  rowToEvaluation,
} from './mappers';

export class SqliteProblemRepository implements ProblemRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Problem[] {
    const rows = this.db
      .prepare('SELECT definition FROM problems ORDER BY sort_order ASC')
      .all() as Array<{ definition: string }>;
    return rows.map((row) => Problem.from(JSON.parse(row.definition) as ProblemDefinition));
  }

  findById(id: string): Problem | null {
    const row = this.db.prepare('SELECT definition FROM problems WHERE id = ?').get(id) as
      | { definition: string }
      | undefined;
    return row ? Problem.from(JSON.parse(row.definition) as ProblemDefinition) : null;
  }

  /** Idempotent upsert used by the seeder, so re-running never duplicates. */
  upsert(definition: ProblemDefinition, sortOrder: number): void {
    this.db
      .prepare(
        `INSERT INTO problems (id, title, difficulty, sort_order, definition)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           difficulty = excluded.difficulty,
           sort_order = excluded.sort_order,
           definition = excluded.definition`,
      )
      .run(definition.id, definition.title, definition.difficulty, sortOrder, JSON.stringify(definition));
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM problems').get() as { n: number };
    return row.n;
  }
}

export class SqliteAttemptRepository implements AttemptRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly content: SubmissionContentFactory,
  ) {}

  save(attempt: Attempt): void {
    const row = attemptToRow(attempt);
    this.db
      .prepare(
        `INSERT INTO attempts (
           id, problem_id, learner_id, attempt_number, status, format, draft_json,
           submission_json, evaluation_id, failure_json, failure_count, carried_focus,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           format = excluded.format,
           draft_json = excluded.draft_json,
           submission_json = excluded.submission_json,
           evaluation_id = excluded.evaluation_id,
           failure_json = excluded.failure_json,
           failure_count = excluded.failure_count,
           carried_focus = excluded.carried_focus,
           updated_at = excluded.updated_at`,
      )
      .run(
        row.id,
        row.problem_id,
        row.learner_id,
        row.attempt_number,
        row.status,
        row.format,
        row.draft_json,
        row.submission_json,
        row.evaluation_id,
        row.failure_json,
        row.failure_count,
        row.carried_focus,
        row.created_at,
        row.updated_at,
      );
  }

  findById(id: string): Attempt | null {
    const row = this.db.prepare('SELECT * FROM attempts WHERE id = ?').get(id) as AttemptRow | undefined;
    return row ? rowToAttempt(row, this.content) : null;
  }

  list(query: AttemptQuery): Attempt[] {
    const clauses = ['learner_id = ?'];
    const params: unknown[] = [query.learnerId];
    if (query.problemId) {
      clauses.push('problem_id = ?');
      params.push(query.problemId);
    }
    let sql = `SELECT * FROM attempts WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, attempt_number DESC`;
    if (query.limit) {
      sql += ' LIMIT ?';
      params.push(query.limit);
    }
    const found = asRows<AttemptRow>(this.db.prepare(sql).all(...(params as never[])));
    return found.map((row) => rowToAttempt(row, this.content));
  }

  listByStatus(status: AttemptStatus): Attempt[] {
    const found = asRows<AttemptRow>(this.db.prepare('SELECT * FROM attempts WHERE status = ?').all(status));
    return found.map((row) => rowToAttempt(row, this.content));
  }

  findOpenDraft(learnerId: string, problemId: string): Attempt | null {
    const row = this.db
      .prepare(
        `SELECT * FROM attempts
         WHERE learner_id = ? AND problem_id = ? AND status = 'DRAFT'
         ORDER BY attempt_number DESC LIMIT 1`,
      )
      .get(learnerId, problemId) as AttemptRow | undefined;
    return row ? rowToAttempt(row, this.content) : null;
  }

  countFor(learnerId: string, problemId: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM attempts WHERE learner_id = ? AND problem_id = ?')
      .get(learnerId, problemId) as { n: number };
    return row.n;
  }

  findLatestCompleted(learnerId: string, problemId: string): Attempt | null {
    const row = this.db
      .prepare(
        `SELECT * FROM attempts
         WHERE learner_id = ? AND problem_id = ? AND status = 'COMPLETED'
         ORDER BY attempt_number DESC LIMIT 1`,
      )
      .get(learnerId, problemId) as AttemptRow | undefined;
    return row ? rowToAttempt(row, this.content) : null;
  }
}

export class SqliteEvaluationRepository implements EvaluationRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly rubrics: RubricRegistry,
  ) {}

  save(evaluation: Evaluation): void {
    const row = evaluationToRow(evaluation);
    this.db
      .prepare(
        `INSERT INTO evaluations (
           id, attempt_id, rubric_version, evaluator_id, evaluator_kind, evaluator_label,
           overall, summary, next_focus, criteria_json, structural_json, duration_ms, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(attempt_id) DO UPDATE SET
           id = excluded.id,
           rubric_version = excluded.rubric_version,
           evaluator_id = excluded.evaluator_id,
           evaluator_kind = excluded.evaluator_kind,
           evaluator_label = excluded.evaluator_label,
           overall = excluded.overall,
           summary = excluded.summary,
           next_focus = excluded.next_focus,
           criteria_json = excluded.criteria_json,
           structural_json = excluded.structural_json,
           duration_ms = excluded.duration_ms,
           created_at = excluded.created_at`,
      )
      .run(
        row.id,
        row.attempt_id,
        row.rubric_version,
        row.evaluator_id,
        row.evaluator_kind,
        row.evaluator_label,
        row.overall,
        row.summary,
        row.next_focus,
        row.criteria_json,
        row.structural_json,
        row.duration_ms,
        row.created_at,
      );
  }

  findById(id: string): Evaluation | null {
    const row = this.db.prepare('SELECT * FROM evaluations WHERE id = ?').get(id) as EvaluationRow | undefined;
    return row ? rowToEvaluation(row, this.rubrics) : null;
  }

  findByAttemptId(attemptId: string): Evaluation | null {
    const row = this.db.prepare('SELECT * FROM evaluations WHERE attempt_id = ?').get(attemptId) as
      | EvaluationRow
      | undefined;
    return row ? rowToEvaluation(row, this.rubrics) : null;
  }

  findByAttemptIds(attemptIds: readonly string[]): Map<string, Evaluation> {
    if (attemptIds.length === 0) return new Map();
    const placeholders = attemptIds.map(() => '?').join(', ');
    const found = asRows<EvaluationRow>(
      this.db.prepare(`SELECT * FROM evaluations WHERE attempt_id IN (${placeholders})`).all(
        ...(attemptIds as unknown as never[]),
      ),
    );
    return new Map(found.map((row) => [row.attempt_id, rowToEvaluation(row, this.rubrics)]));
  }
}

/** `node:sqlite` returns untyped rows; this is the single documented cast. */
function asRows<T>(result: unknown): T[] {
  return result as T[];
}
