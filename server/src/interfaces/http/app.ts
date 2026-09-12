import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { Container } from '../../composition-root';
import { DomainError, NotFoundError, ValidationError } from '../../domain/shared/errors';
import {
  attemptDto,
  evaluationDto,
  historyEntryDto,
  problemDetailDto,
  problemSummaryDto,
  rubricDto,
  structuralReportDto,
  submissionSchemaDto,
} from './dto';

/**
 * HTTP is a delivery detail: every route here reads input, calls one
 * application method and maps the result. There is no domain logic in this
 * file - if a rule needs to change, it changes in the domain and every caller
 * (including a future CLI or a queue worker) gets it.
 *
 * Identity: there is no auth in this MVP. A learner is whoever the
 * `x-learner-id` header says they are, defaulting to a shared demo learner.
 * That is enough to make history and progress real without building an account
 * system the assignment explicitly does not ask for.
 */
export function createApp(container: Container) {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json({ limit: '256kb' }));

  const learnerOf = (req: Request): string => {
    const header = req.header('x-learner-id')?.trim();
    return header && header.length <= 64 ? header : 'demo-learner';
  };

  const body = (req: Request): Record<string, unknown> => {
    const value = req.body;
    if (value === undefined || value === null) return {};
    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new ValidationError('Request body must be a JSON object.');
    }
    return value as Record<string, unknown>;
  };

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', pendingEvaluations: container.coordinator.pendingCount });
  });

  /** Everything the client needs to render itself: mode, rubric, form schema. */
  app.get('/api/config', (_req, res) => {
    res.json({
      evaluation: container.evaluationMode,
      rubric: rubricDto(container.rubric),
      submissionSchema: submissionSchemaDto(),
      supportedFormats: container.content.supportedFormats,
    });
  });

  app.get('/api/problems', (req, res) => {
    const stats = container.history.problemStats(learnerOf(req));
    res.json({
      problems: container.practice.listProblems().map((p) => problemSummaryDto(p, stats.get(p.id))),
    });
  });

  app.get('/api/problems/:id', (req, res) => {
    const problem = container.practice.getProblem(req.params.id);
    const history = container.history.history(learnerOf(req), problem.id);
    res.json({
      problem: problemDetailDto(problem),
      attempts: history.map(historyEntryDto),
    });
  });

  app.post('/api/attempts', (req, res) => {
    const payload = body(req);
    const problemId = String(payload.problemId ?? '');
    if (!problemId) throw new ValidationError('`problemId` is required.');
    const { attempt, resumed } = container.practice.startAttempt({
      learnerId: learnerOf(req),
      problemId,
    });
    res.status(resumed ? 200 : 201).json({ attempt: attemptDto(attempt), resumed });
  });

  app.get('/api/attempts', (req, res) => {
    const problemId = typeof req.query.problemId === 'string' ? req.query.problemId : undefined;
    const entries = container.history.history(learnerOf(req), problemId);
    res.json({ attempts: entries.map(historyEntryDto) });
  });

  app.get('/api/attempts/:id', (req, res) => {
    const entry = container.history.entry(req.params.id);
    if (!entry) throw new NotFoundError('Attempt', req.params.id);
    res.json({
      ...historyEntryDto(entry),
      evaluationDetail: entry.evaluation ? evaluationDto(entry.evaluation) : null,
    });
  });

  /** Draft autosave. */
  app.patch('/api/attempts/:id/draft', (req, res) => {
    const attempt = container.practice.saveDraft(req.params.id, body(req));
    res.json({ attempt: attemptDto(attempt), savedAt: attempt.updatedAt.toISOString() });
  });

  /** Deterministic pre-flight check; free, repeatable, no evaluator involved. */
  app.post('/api/attempts/:id/structural-check', (req, res) => {
    const report = container.practice.checkStructure(req.params.id, body(req));
    res.json(structuralReportDto(report));
  });

  /**
   * Submit. Returns 202: the submission is durable, the evaluation is not done.
   * The client polls `GET /api/attempts/:id` for the status transition.
   */
  app.post('/api/attempts/:id/submission', (req, res) => {
    const { attempt, outcome, report } = container.practice.submit(req.params.id, body(req));
    res.status(outcome === 'accepted' ? 202 : 200).json({
      attempt: attemptDto(attempt),
      outcome,
      structural: structuralReportDto(report),
    });
  });

  app.get('/api/attempts/:id/evaluation', (req, res) => {
    const attempt = container.practice.getAttempt(req.params.id);
    if (!attempt.evaluationId) {
      return res.status(404).json({
        error: { code: 'EVALUATION_PENDING', message: `Attempt is ${attempt.status}.`, status: attempt.status },
      });
    }
    const entry = container.history.entry(attempt.id);
    if (!entry?.evaluation) throw new NotFoundError('Evaluation', attempt.evaluationId);
    return res.json({ evaluation: evaluationDto(entry.evaluation), comparison: entry.comparison });
  });

  app.post('/api/attempts/:id/evaluation/retry', (req, res) => {
    const attempt = container.practice.retryEvaluation(req.params.id);
    res.status(202).json({ attempt: attemptDto(attempt) });
  });

  app.use((_req, res) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such endpoint.' } });
  });

  // Domain errors already carry a status and a learner-readable message, so the
  // mapping is one line rather than a switch that has to be kept in sync.
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) return next(error);
    if (error instanceof DomainError) {
      return res.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details },
      });
    }
    if (error instanceof SyntaxError && 'body' in error) {
      return res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body was not valid JSON.' } });
    }
    console.error('[http] unhandled error:', error);
    return res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server.' },
    });
  });

  return app;
}
