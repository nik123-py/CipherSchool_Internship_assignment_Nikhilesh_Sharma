import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildContainer, Container } from '../../src/composition-root';
import { Evaluator } from '../../src/domain/evaluation/Evaluator';
import { loadConfig } from '../../src/infrastructure/config/config';
import { HeuristicEvaluator } from '../../src/evaluators/heuristic/HeuristicEvaluator';
import { createApp } from '../../src/interfaces/http/app';
import { ExplodingEvaluator, SequentialIds, STRONG_SUBMISSION, WEAK_SUBMISSION } from '../fixtures';

/**
 * End-to-end over the real HTTP surface, the real SQLite mappers (in-memory
 * database) and the real deterministic evaluator. Only the clock ids are fixed.
 */
function buildApi(evaluator: Evaluator = new HeuristicEvaluator()): { app: express.Express; container: Container } {
  const config = { ...loadConfig({ DATABASE_PATH: ':memory:', EVALUATOR: 'heuristic' }), demoEvaluationDelayMs: 0 };
  const container = buildContainer(config, {
    ids: new SequentialIds(),
    evaluators: [evaluator],
    onEvaluationError: () => {},
  });
  return { app: createApp(container), container };
}

const LEARNER = { 'x-learner-id': 'learner-http' };

describe('HTTP API', () => {
  let api: ReturnType<typeof buildApi>;

  beforeEach(() => {
    api = buildApi();
  });

  afterEach(async () => {
    await api.container.coordinator.settled();
    api.container.close();
  });

  it('reports health and the active evaluation mode', async () => {
    await request(api.app).get('/api/health').expect(200).expect({ status: 'ok', pendingEvaluations: 0 });

    const config = await request(api.app).get('/api/config').expect(200);
    expect(config.body.evaluation.kind).toBeDefined();
    expect(config.body.rubric.criteria).toHaveLength(8);
    expect(config.body.submissionSchema.sections).toHaveLength(10);
  });

  it('serves the seeded problem catalogue', async () => {
    const response = await request(api.app).get('/api/problems').set(LEARNER).expect(200);
    expect(response.body.problems).toHaveLength(4);
    expect(response.body.problems.map((p: { id: string }) => p.id)).toContain('elevator');
    expect(response.body.problems[0].stats).toEqual({ attempts: 0, bestOverall: null, lastStatus: null });
  });

  it('serves full problem detail with requirements and design focus', async () => {
    const response = await request(api.app).get('/api/problems/parking-lot').set(LEARNER).expect(200);
    expect(response.body.problem.functionalRequirements.length).toBeGreaterThan(4);
    expect(response.body.problem.designFocus[0]).toHaveProperty('question');
    expect(response.body.attempts).toEqual([]);
  });

  it('404s an unknown problem with a typed error code', async () => {
    const response = await request(api.app).get('/api/problems/nope').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('runs the whole loop: start -> draft -> check -> submit -> feedback', async () => {
    const created = await request(api.app)
      .post('/api/attempts')
      .set(LEARNER)
      .send({ problemId: 'parking-lot' })
      .expect(201);
    const attemptId = created.body.attempt.id;
    expect(created.body.attempt.status).toBe('DRAFT');

    await request(api.app)
      .patch(`/api/attempts/${attemptId}/draft`)
      .set(LEARNER)
      .send({ sections: { requirements: 'partial work' } })
      .expect(200);

    const check = await request(api.app)
      .post(`/api/attempts/${attemptId}/structural-check`)
      .set(LEARNER)
      .send({ sections: STRONG_SUBMISSION })
      .expect(200);
    expect(check.body.isSubmittable).toBe(true);

    const submitted = await request(api.app)
      .post(`/api/attempts/${attemptId}/submission`)
      .set(LEARNER)
      .send({ sections: STRONG_SUBMISSION })
      .expect(202);
    expect(['SUBMITTED', 'EVALUATING', 'COMPLETED']).toContain(submitted.body.attempt.status);

    await api.container.coordinator.settled();

    const evaluation = await request(api.app).get(`/api/attempts/${attemptId}/evaluation`).set(LEARNER).expect(200);
    expect(evaluation.body.evaluation.criteria).toHaveLength(8);
    expect(evaluation.body.evaluation.overall).toBeGreaterThan(0);
    expect(evaluation.body.evaluation.priorities.length).toBeGreaterThan(0);
    expect(evaluation.body.evaluation.criteria[0].evidence.length).toBeGreaterThan(0);
    expect(evaluation.body.evaluation.structuralChecks.length).toBeGreaterThan(0);
  });

  it('reports 404 with a pending code while the evaluation has not finished', async () => {
    const slow = buildApi(new HeuristicEvaluator({ delayMs: 200 }));
    const created = await request(slow.app).post('/api/attempts').set(LEARNER).send({ problemId: 'elevator' });
    const attemptId = created.body.attempt.id;
    await request(slow.app)
      .post(`/api/attempts/${attemptId}/submission`)
      .set(LEARNER)
      .send({ sections: STRONG_SUBMISSION })
      .expect(202);

    const pending = await request(slow.app).get(`/api/attempts/${attemptId}/evaluation`).set(LEARNER).expect(404);
    expect(pending.body.error.code).toBe('EVALUATION_PENDING');

    await slow.container.coordinator.settled();
    slow.container.close();
  });

  it('rejects an unevaluable submission with 422 and says which checks failed', async () => {
    const created = await request(api.app).post('/api/attempts').set(LEARNER).send({ problemId: 'parking-lot' });
    const response = await request(api.app)
      .post(`/api/attempts/${created.body.attempt.id}/submission`)
      .set(LEARNER)
      .send({ sections: { requirements: 'nope' } })
      .expect(422);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details.checks.length).toBeGreaterThan(0);
  });

  it('returns 200 (not a second evaluation) for a duplicate submit', async () => {
    const created = await request(api.app).post('/api/attempts').set(LEARNER).send({ problemId: 'parking-lot' });
    const id = created.body.attempt.id;
    await request(api.app).post(`/api/attempts/${id}/submission`).set(LEARNER).send({ sections: STRONG_SUBMISSION }).expect(202);
    const duplicate = await request(api.app)
      .post(`/api/attempts/${id}/submission`)
      .set(LEARNER)
      .send({ sections: STRONG_SUBMISSION })
      .expect(200);
    expect(duplicate.body.outcome).toBe('already-submitted');
  });

  it('resumes an open draft instead of creating a second attempt', async () => {
    const first = await request(api.app).post('/api/attempts').set(LEARNER).send({ problemId: 'vending-machine' }).expect(201);
    const second = await request(api.app).post('/api/attempts').set(LEARNER).send({ problemId: 'vending-machine' }).expect(200);
    expect(second.body.resumed).toBe(true);
    expect(second.body.attempt.id).toBe(first.body.attempt.id);
  });

  it('surfaces a failed evaluation with a retry that works', async () => {
    const failing = buildApi(new ExplodingEvaluator('provider is down'));
    const created = await request(failing.app).post('/api/attempts').set(LEARNER).send({ problemId: 'parking-lot' });
    const id = created.body.attempt.id;
    await request(failing.app).post(`/api/attempts/${id}/submission`).set(LEARNER).send({ sections: STRONG_SUBMISSION });
    await failing.container.coordinator.settled();

    const failed = await request(failing.app).get(`/api/attempts/${id}`).set(LEARNER).expect(200);
    expect(failed.body.attempt.status).toBe('FAILED');
    expect(failed.body.attempt.failure.reason).toContain('provider is down');
    expect(failed.body.attempt.canRetryEvaluation).toBe(true);

    await request(failing.app).post(`/api/attempts/${id}/evaluation/retry`).set(LEARNER).expect(202);
    await failing.container.coordinator.settled();
    expect((await request(failing.app).get(`/api/attempts/${id}`).set(LEARNER)).body.attempt.failureCount).toBe(2);
    failing.container.close();
  });

  it('builds attempt history with a progress comparison across attempts', async () => {
    const start = async (problemId: string) =>
      (await request(api.app).post('/api/attempts').set(LEARNER).send({ problemId })).body.attempt.id;

    const first = await start('parking-lot');
    await request(api.app).post(`/api/attempts/${first}/submission`).set(LEARNER).send({ sections: WEAK_SUBMISSION });
    await api.container.coordinator.settled();

    const second = await start('parking-lot');
    await request(api.app).post(`/api/attempts/${second}/submission`).set(LEARNER).send({ sections: STRONG_SUBMISSION });
    await api.container.coordinator.settled();

    const history = await request(api.app).get('/api/attempts').set(LEARNER).expect(200);
    expect(history.body.attempts).toHaveLength(2);
    expect(history.body.attempts[0].attempt.attemptNumber).toBe(2);
    expect(history.body.attempts[0].comparison.delta).toBeGreaterThan(0);

    const detail = await request(api.app).get(`/api/attempts/${second}`).set(LEARNER).expect(200);
    expect(detail.body.comparison.previousAttemptNumber).toBe(1);
    expect(detail.body.evaluationDetail.criteria).toHaveLength(8);
  });

  it('keeps one learner out of another learner\'s history', async () => {
    const created = await request(api.app).post('/api/attempts').set(LEARNER).send({ problemId: 'parking-lot' });
    await request(api.app)
      .post(`/api/attempts/${created.body.attempt.id}/submission`)
      .set(LEARNER)
      .send({ sections: STRONG_SUBMISSION });
    await api.container.coordinator.settled();

    const other = await request(api.app).get('/api/attempts').set({ 'x-learner-id': 'someone-else' }).expect(200);
    expect(other.body.attempts).toEqual([]);
  });

  it('rejects a request with no problemId', async () => {
    const response = await request(api.app).post('/api/attempts').set(LEARNER).send({}).expect(422);
    expect(response.body.error.message).toMatch(/problemId/);
  });

  it('rejects malformed JSON bodies with 400', async () => {
    const response = await request(api.app)
      .post('/api/attempts')
      .set({ ...LEARNER, 'content-type': 'application/json' })
      .send('{ not json')
      .expect(400);
    expect(response.body.error.code).toBe('BAD_JSON');
  });

  it('404s unknown endpoints as JSON, not HTML', async () => {
    const response = await request(api.app).get('/api/does-not-exist').expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
