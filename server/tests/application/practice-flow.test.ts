import { describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '../../src/domain/shared/errors';
import { HeuristicEvaluator } from '../../src/evaluators/heuristic/HeuristicEvaluator';
import {
  ExplodingEvaluator,
  HangingEvaluator,
  STRONG_SUBMISSION,
  StubEvaluator,
  WEAK_SUBMISSION,
} from '../fixtures';
import { createHarness } from '../support';

const LEARNER = 'learner-1';
const PROBLEM = 'parking-lot';

describe('Practice flow', () => {
  it('starts an attempt as attempt #1 in DRAFT', () => {
    const h = createHarness();
    const { attempt, resumed } = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    expect(resumed).toBe(false);
    expect(attempt.attemptNumber).toBe(1);
    expect(attempt.status).toBe('DRAFT');
  });

  it('resumes the open draft instead of piling up abandoned attempts', () => {
    const h = createHarness();
    const first = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.saveDraft(first.attempt.id, { sections: { requirements: 'work in progress' } });

    const second = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    expect(second.resumed).toBe(true);
    expect(second.attempt.id).toBe(first.attempt.id);
    expect(h.attempts.countFor(LEARNER, PROBLEM)).toBe(1);
  });

  it('rejects an unknown problem', () => {
    const h = createHarness();
    expect(() => h.practice.startAttempt({ learnerId: LEARNER, problemId: 'no-such-problem' })).toThrow(
      /not found/i,
    );
  });

  it('autosaves drafts without submitting them', () => {
    const h = createHarness();
    const { attempt } = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    const saved = h.practice.saveDraft(attempt.id, { sections: { classes: '- ParkingLot' } });
    expect(saved.status).toBe('DRAFT');
    expect(h.attempts.findById(attempt.id)?.currentContent.toJSON()).toMatchObject({
      sections: { classes: '- ParkingLot' },
    });
  });

  it('runs the structural check without spending an evaluation', async () => {
    const evaluator = new StubEvaluator();
    const h = createHarness(evaluator);
    const { attempt } = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    const report = h.practice.checkStructure(attempt.id, { sections: STRONG_SUBMISSION });
    expect(report.isSubmittable).toBe(true);
    expect(evaluator.calls).toBe(0);
  });

  it('refuses to submit a design that cannot carry evidence', () => {
    const h = createHarness();
    const { attempt } = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    expect(() => h.practice.submit(attempt.id, { sections: { requirements: 'too short' } })).toThrow(
      ValidationError,
    );
    expect(h.attempts.findById(attempt.id)?.status).toBe('DRAFT');
  });

  it('persists the submission before the evaluator is ever called', async () => {
    const h = createHarness(new ExplodingEvaluator());
    const { attempt } = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.submit(attempt.id, { sections: STRONG_SUBMISSION });

    // Even though evaluation is about to blow up, the design is already stored.
    expect(h.attempts.findById(attempt.id)?.submission).not.toBeNull();
    await h.coordinator.settled();
    const failed = h.attempts.findById(attempt.id)!;
    expect(failed.status).toBe('FAILED');
    expect(failed.submission?.toDesignDocument().text('classes')).toContain('ParkingLot');
  });

  it('completes an evaluation and attaches it to the attempt', async () => {
    const h = createHarness();
    const { attempt } = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    const { outcome } = h.practice.submit(attempt.id, { sections: STRONG_SUBMISSION });
    expect(outcome).toBe('accepted');

    await h.coordinator.settled();
    const completed = h.attempts.findById(attempt.id)!;
    expect(completed.status).toBe('COMPLETED');

    const evaluation = h.evaluations.findByAttemptId(attempt.id)!;
    expect(evaluation.criteria).toHaveLength(8);
    expect(evaluation.overall.value).toBeGreaterThan(0);
    expect(evaluation.structuralChecks.length).toBeGreaterThan(0);
  });

  it('does not evaluate the same attempt twice when submit is double-clicked', async () => {
    const evaluator = new StubEvaluator();
    const h = createHarness(evaluator);
    const { attempt } = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });

    const first = h.practice.submit(attempt.id, { sections: STRONG_SUBMISSION });
    const second = h.practice.submit(attempt.id, { sections: STRONG_SUBMISSION });

    expect(first.outcome).toBe('accepted');
    expect(second.outcome).toBe('already-submitted');
    await h.coordinator.settled();
    expect(evaluator.calls).toBe(1);
  });

  it('refuses a new attempt that is byte-identical to the last completed one', async () => {
    const h = createHarness();
    const first = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.submit(first.attempt.id, { sections: STRONG_SUBMISSION });
    await h.coordinator.settled();

    const second = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    expect(() => h.practice.submit(second.attempt.id, { sections: STRONG_SUBMISSION })).toThrow(ConflictError);
    // ...but a changed design goes through.
    expect(() =>
      h.practice.submit(second.attempt.id, {
        sections: { ...STRONG_SUBMISSION, tradeoffs: `${STRONG_SUBMISSION.tradeoffs} I would also extract a TariffRepository.` },
      }),
    ).not.toThrow();
  });

  it('marks the attempt FAILED - not lost - when the evaluator throws, and allows a retry', async () => {
    const exploding = new ExplodingEvaluator('model unavailable');
    const h = createHarness(exploding);
    const { attempt } = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.submit(attempt.id, { sections: STRONG_SUBMISSION });
    await h.coordinator.settled();

    const failed = h.attempts.findById(attempt.id)!;
    expect(failed.status).toBe('FAILED');
    expect(failed.failure?.reason).toContain('model unavailable');
    expect(failed.canRetryEvaluation).toBe(true);
    expect(h.errors).toHaveLength(1);

    h.practice.retryEvaluation(attempt.id);
    await h.coordinator.settled();
    expect(exploding.calls).toBe(2);
    expect(h.attempts.findById(attempt.id)?.failureCount).toBe(2);
  });

  it('fails an evaluation that exceeds its time budget', async () => {
    const h = createHarness(new HangingEvaluator(), { timeoutMs: 40 });
    const { attempt } = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.submit(attempt.id, { sections: STRONG_SUBMISSION });
    await h.coordinator.settled();

    const failed = h.attempts.findById(attempt.id)!;
    expect(failed.status).toBe('FAILED');
    expect(failed.failure?.reason).toMatch(/did not respond|timed out/i);
  });

  it('refuses to retry an attempt that has not failed', async () => {
    const h = createHarness();
    const { attempt } = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    expect(() => h.practice.retryEvaluation(attempt.id)).toThrow(ConflictError);
  });

  it('recovers attempts left EVALUATING by a crash', async () => {
    const h = createHarness(new HangingEvaluator(), { timeoutMs: 10_000 });
    const { attempt } = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.submit(attempt.id, { sections: STRONG_SUBMISSION });
    await Promise.resolve();

    expect(h.attempts.findById(attempt.id)?.status).toBe('EVALUATING');
    const recovered = h.coordinator.recoverStuckEvaluations();
    expect(recovered).toBe(1);
    const recoveredAttempt = h.attempts.findById(attempt.id)!;
    expect(recoveredAttempt.status).toBe('FAILED');
    expect(recoveredAttempt.canRetryEvaluation).toBe(true);
  });
});

describe('Learning loop', () => {
  it('carries the previous "focus next time" into the next attempt', async () => {
    const h = createHarness(new HeuristicEvaluator());
    const first = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.submit(first.attempt.id, { sections: WEAK_SUBMISSION });
    await h.coordinator.settled();

    const second = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    expect(second.attempt.attemptNumber).toBe(2);
    expect(second.attempt.carriedFocus).toBeTruthy();
    expect(second.attempt.carriedFocus).toBe(h.evaluations.findByAttemptId(first.attempt.id)?.nextFocus);
  });

  it('shows history newest-first with per-attempt evaluations', async () => {
    const h = createHarness(new HeuristicEvaluator());
    const first = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.submit(first.attempt.id, { sections: WEAK_SUBMISSION });
    await h.coordinator.settled();

    h.clock.advance(60_000);
    const second = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.submit(second.attempt.id, { sections: STRONG_SUBMISSION });
    await h.coordinator.settled();

    const history = h.history.history(LEARNER);
    expect(history).toHaveLength(2);
    expect(history[0].attempt.attemptNumber).toBe(2);
    expect(history[0].evaluation).not.toBeNull();
  });

  it('computes the improvement between two attempts on the same problem', async () => {
    const h = createHarness(new HeuristicEvaluator());
    const first = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.submit(first.attempt.id, { sections: WEAK_SUBMISSION });
    await h.coordinator.settled();

    h.clock.advance(60_000);
    const second = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.submit(second.attempt.id, { sections: STRONG_SUBMISSION });
    await h.coordinator.settled();

    const entry = h.history.entry(second.attempt.id)!;
    expect(entry.comparison).not.toBeNull();
    expect(entry.comparison!.previousAttemptNumber).toBe(1);
    expect(entry.comparison!.delta).toBeGreaterThan(0);
    expect(entry.comparison!.improved.length).toBeGreaterThan(0);
    expect(entry.comparison!.focusFollowUp?.focus).toBeTruthy();
  });

  it('does not invent a comparison for a first attempt', async () => {
    const h = createHarness(new HeuristicEvaluator());
    const first = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.submit(first.attempt.id, { sections: STRONG_SUBMISSION });
    await h.coordinator.settled();
    expect(h.history.entry(first.attempt.id)!.comparison).toBeNull();
  });

  it('keeps learners separate without an auth system', async () => {
    const h = createHarness();
    const mine = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.submit(mine.attempt.id, { sections: STRONG_SUBMISSION });
    await h.coordinator.settled();

    expect(h.history.history('someone-else')).toHaveLength(0);
    const theirs = h.practice.startAttempt({ learnerId: 'someone-else', problemId: PROBLEM });
    expect(theirs.attempt.attemptNumber).toBe(1);
  });

  it('summarises per-problem stats for the dashboard', async () => {
    const h = createHarness(new StubEvaluator(8));
    const attempt = h.practice.startAttempt({ learnerId: LEARNER, problemId: PROBLEM });
    h.practice.submit(attempt.attempt.id, { sections: STRONG_SUBMISSION });
    await h.coordinator.settled();

    const stats = h.history.problemStats(LEARNER).get(PROBLEM)!;
    expect(stats.attempts).toBe(1);
    expect(stats.bestOverall).toBe(8);
    expect(stats.lastStatus).toBe('COMPLETED');
  });
});
