import { describe, expect, it } from 'vitest';
import { CriterionFeedback } from '../../src/domain/evaluation/CriterionFeedback';
import { Evaluation } from '../../src/domain/evaluation/Evaluation';
import { Rubric } from '../../src/domain/evaluation/Rubric';
import { Score } from '../../src/domain/evaluation/Score';
import { ValidationError } from '../../src/domain/shared/errors';

const rubric = Rubric.default();

function feedback(key: string, score: number, overrides: Partial<{ concern: string; confidence: 'low' | 'medium' | 'high' }> = {}) {
  return new CriterionFeedback({
    criterionKey: key,
    score: Score.of(score),
    evidence: 'ParkingLot composes 1..* ParkingFloor',
    evidenceSection: 'relationships',
    concern: overrides.concern ?? 'A concern.',
    suggestion: 'A suggestion.',
    confidence: overrides.confidence ?? 'medium',
    grounded: true,
  });
}

function evaluationWith(scores: Record<string, number>): Evaluation {
  return new Evaluation({
    id: 'evl_1',
    attemptId: 'att_1',
    rubric,
    evaluator: { id: 'stub', kind: 'heuristic', label: 'Stub' },
    criteria: rubric.criteria.map((c) => feedback(c.key, scores[c.key] ?? 5)),
    summary: 'Summary.',
    nextFocus: 'Focus.',
    structuralChecks: [],
    durationMs: 10,
    createdAt: new Date('2026-01-01T10:00:00.000Z'),
  });
}

describe('Score', () => {
  it('keeps one decimal and rejects out-of-range values', () => {
    expect(Score.of(7.44).value).toBe(7.4);
    expect(() => Score.of(11)).toThrow(ValidationError);
    expect(() => Score.of(-1)).toThrow(ValidationError);
    expect(() => Score.of(Number.NaN)).toThrow(ValidationError);
  });

  it('clamps untrusted evaluator output instead of throwing', () => {
    expect(Score.clamp(99).value).toBe(10);
    expect(Score.clamp(-5).value).toBe(0);
    expect(Score.clamp(Number.NaN).value).toBe(0);
  });

  it('bands scores consistently for the UI', () => {
    expect(Score.of(3).band).toBe('weak');
    expect(Score.of(5).band).toBe('developing');
    expect(Score.of(7).band).toBe('solid');
    expect(Score.of(9).band).toBe('strong');
  });
});

describe('CriterionFeedback', () => {
  it('refuses feedback with no evidence - the core invariant of this product', () => {
    expect(() =>
      new CriterionFeedback({
        criterionKey: 'coupling_cohesion',
        score: Score.of(5),
        evidence: '   ',
        concern: 'x',
        suggestion: 'y',
        confidence: 'low',
        grounded: true,
      }),
    ).toThrow(/must quote the submission/i);
  });

  it('refuses feedback with no improvement suggestion', () => {
    expect(() =>
      new CriterionFeedback({
        criterionKey: 'coupling_cohesion',
        score: Score.of(5),
        evidence: 'something they wrote',
        concern: 'x',
        suggestion: '',
        confidence: 'low',
        grounded: true,
      }),
    ).toThrow(/improvement suggestion/i);
  });

  it('drops confidence to low when the evidence could not be grounded', () => {
    const grounded = feedback('extensibility', 8, { confidence: 'high' });
    const ungrounded = grounded.withGroundingResult(false);
    expect(ungrounded.confidence).toBe('low');
    expect(ungrounded.grounded).toBe(false);
  });
});

describe('Rubric', () => {
  it('aggregates by weight, not by simple average', () => {
    const scores = new Map(rubric.criteria.map((c) => [c.key, Score.of(c.key === 'class_responsibilities' ? 10 : 5)]));
    const weighted = rubric.aggregate(scores);
    const plainAverage = 5 + 5 / rubric.criteria.length;
    expect(weighted.value).toBeGreaterThan(plainAverage);
  });

  it('ranks improvement impact by weight times remaining head-room', () => {
    // Same score, heavier criterion => bigger recoverable impact.
    const heavy = rubric.improvementImpact('class_responsibilities', Score.of(4));
    const light = rubric.improvementImpact('requirement_understanding', Score.of(4));
    expect(heavy).toBeGreaterThan(light);
  });

  it('is versioned so old evaluations stay interpretable', () => {
    expect(rubric.version).toBe('v1');
  });
});

describe('Evaluation', () => {
  it('derives the overall score itself rather than trusting the evaluator', () => {
    const evaluation = evaluationWith({});
    expect(evaluation.overall.value).toBe(5);
  });

  it('ranks priorities by recoverable impact, not by lowest raw score', () => {
    const evaluation = evaluationWith({
      // Lower raw score, but the lightest criterion in the rubric...
      requirement_understanding: 3,
      // ...against a slightly higher score on the heaviest criterion.
      class_responsibilities: 3.5,
    });
    expect(evaluation.priorities(1)[0].criterionKey).toBe('class_responsibilities');
  });

  it('reports strengths only above the "developing" line', () => {
    const evaluation = evaluationWith({ extensibility: 9, coupling_cohesion: 4 });
    const strengthKeys = evaluation.strengths().map((s) => s.criterionKey);
    expect(strengthKeys[0]).toBe('extensibility');
    expect(strengthKeys).not.toContain('coupling_cohesion');
  });

  it('rejects criteria that are not part of its rubric', () => {
    expect(() =>
      new Evaluation({
        id: 'evl_2',
        attemptId: 'att_1',
        rubric,
        evaluator: { id: 'stub', kind: 'heuristic', label: 'Stub' },
        criteria: [feedback('not_a_real_criterion', 5)],
        summary: 's',
        nextFocus: 'f',
        structuralChecks: [],
        durationMs: 1,
        createdAt: new Date(),
      }),
    ).toThrow(/not in rubric/);
  });

  it('rejects an empty evaluation', () => {
    expect(() =>
      new Evaluation({
        id: 'evl_3',
        attemptId: 'att_1',
        rubric,
        evaluator: { id: 'stub', kind: 'heuristic', label: 'Stub' },
        criteria: [],
        summary: 's',
        nextFocus: 'f',
        structuralChecks: [],
        durationMs: 1,
        createdAt: new Date(),
      }),
    ).toThrow(ValidationError);
  });
});
