import { describe, expect, it } from 'vitest';
import { Attempt } from '../../src/domain/attempt/Attempt';
import { ALLOWED_TRANSITIONS, ATTEMPT_STATUSES, canTransition } from '../../src/domain/attempt/AttemptStatus';
import { ConflictError, InvalidStateTransitionError } from '../../src/domain/shared/errors';
import { StructuredTextSubmission } from '../../src/domain/submission/StructuredTextSubmission';
import { draftAttempt, strongContent, weakContent } from '../fixtures';

const T0 = new Date('2026-01-01T10:00:00.000Z');
const T1 = new Date('2026-01-01T10:05:00.000Z');

describe('Attempt lifecycle', () => {
  it('starts as an editable draft with no submission', () => {
    const attempt = draftAttempt();
    expect(attempt.status).toBe('DRAFT');
    expect(attempt.isEditable).toBe(true);
    expect(attempt.submission).toBeNull();
    expect(attempt.evaluationId).toBeNull();
  });

  it('walks the happy path DRAFT -> SUBMITTED -> EVALUATING -> COMPLETED', () => {
    const attempt = draftAttempt();
    expect(attempt.submit(strongContent(), T0)).toBe('accepted');
    expect(attempt.status).toBe('SUBMITTED');
    attempt.beginEvaluation(T0);
    expect(attempt.status).toBe('EVALUATING');
    attempt.completeEvaluation('evl_1', T1);
    expect(attempt.status).toBe('COMPLETED');
    expect(attempt.evaluationId).toBe('evl_1');
  });

  it('freezes the design once submitted', () => {
    const attempt = draftAttempt();
    attempt.submit(strongContent(), T0);
    expect(() => attempt.saveDraft(weakContent(), T1)).toThrow(ConflictError);
    // The stored submission is untouched by the rejected edit.
    expect(attempt.submission?.matches(strongContent())).toBe(true);
  });

  it('treats an identical re-submit as idempotent rather than a second evaluation', () => {
    const attempt = draftAttempt();
    attempt.submit(strongContent(), T0);
    expect(attempt.submit(strongContent(), T1)).toBe('already-submitted');
    expect(attempt.status).toBe('SUBMITTED');
  });

  it('stays idempotent even after the evaluation has completed', () => {
    const attempt = draftAttempt();
    attempt.submit(strongContent(), T0);
    attempt.beginEvaluation(T0);
    attempt.completeEvaluation('evl_1', T1);
    // A retried request carrying the same design is the same request.
    expect(attempt.submit(strongContent(), T1)).toBe('already-submitted');
    expect(attempt.status).toBe('COMPLETED');
  });

  it('rejects a *different* design while an evaluation is in flight', () => {
    const attempt = draftAttempt();
    attempt.submit(strongContent(), T0);
    attempt.beginEvaluation(T0);
    expect(() => attempt.submit(weakContent(), T1)).toThrow(ConflictError);
  });

  it('refuses to reopen a completed attempt and says what to do instead', () => {
    const attempt = draftAttempt();
    attempt.submit(strongContent(), T0);
    attempt.beginEvaluation(T0);
    attempt.completeEvaluation('evl_1', T1);
    expect(() => attempt.submit(weakContent(), T1)).toThrow(/Try again/i);
  });

  it('cannot evaluate a draft that was never submitted', () => {
    const attempt = draftAttempt();
    expect(() => attempt.beginEvaluation(T0)).toThrow(ConflictError);
  });

  it('cannot complete an evaluation that never started', () => {
    const attempt = draftAttempt();
    attempt.submit(strongContent(), T0);
    expect(() => attempt.completeEvaluation('evl_1', T1)).toThrow(InvalidStateTransitionError);
  });

  it('keeps the submission and offers a retry when evaluation fails', () => {
    const attempt = draftAttempt();
    attempt.submit(strongContent(), T0);
    attempt.beginEvaluation(T0);
    attempt.failEvaluation('model unavailable', T1);

    expect(attempt.status).toBe('FAILED');
    expect(attempt.submission).not.toBeNull();
    expect(attempt.canRetryEvaluation).toBe(true);
    expect(attempt.failureCount).toBe(1);

    // Retry goes straight back into evaluation; nothing is re-typed.
    attempt.beginEvaluation(T1);
    expect(attempt.status).toBe('EVALUATING');
    expect(attempt.failure).toBeNull();
  });

  it('counts repeated failures so the UI can stop promising a retry forever', () => {
    const attempt = draftAttempt();
    attempt.submit(strongContent(), T0);
    for (let i = 0; i < 3; i++) {
      attempt.beginEvaluation(T0);
      attempt.failEvaluation(`failure ${i}`, T1);
    }
    expect(attempt.failureCount).toBe(3);
  });

  it('marks a permanent failure as not retryable', () => {
    const attempt = draftAttempt();
    attempt.submit(strongContent(), T0);
    attempt.beginEvaluation(T0);
    attempt.failEvaluation('submission format no longer supported', T1, false);
    expect(attempt.canRetryEvaluation).toBe(false);
  });

  it('rejects every transition that is not in the table', () => {
    const illegal: Array<[string, string]> = [];
    for (const from of ATTEMPT_STATUSES) {
      for (const to of ATTEMPT_STATUSES) {
        if (!canTransition(from, to)) illegal.push([from, to]);
      }
    }
    // Guards against someone quietly widening the table.
    expect(ALLOWED_TRANSITIONS.COMPLETED).toEqual([]);
    expect(illegal).toContainEqual(['DRAFT', 'COMPLETED']);
    expect(illegal).toContainEqual(['DRAFT', 'EVALUATING']);
    expect(illegal).toContainEqual(['COMPLETED', 'SUBMITTED']);
  });

  it('rehydrates without re-running guards, so history stays readable', () => {
    const original = draftAttempt();
    original.submit(strongContent(), T0);
    original.beginEvaluation(T0);
    original.completeEvaluation('evl_9', T1);

    const restored = Attempt.rehydrate(original.snapshot());
    expect(restored.status).toBe('COMPLETED');
    expect(restored.evaluationId).toBe('evl_9');
    expect(restored.currentContent).toBeInstanceOf(StructuredTextSubmission);
  });
});
