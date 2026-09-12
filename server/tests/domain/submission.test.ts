import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/shared/errors';
import { runStructuralRules } from '../../src/domain/submission/StructuralRules';
import { StructuredTextSubmission } from '../../src/domain/submission/StructuredTextSubmission';
import { Submission, fingerprintOf } from '../../src/domain/submission/Submission';
import { SubmissionContentFactory } from '../../src/domain/submission/SubmissionContentFactory';
import { STRUCTURED_TEXT_SECTIONS } from '../../src/domain/submission/SubmissionSchema';
import { STRONG_SUBMISSION, WEAK_SUBMISSION, strongContent, weakContent } from '../fixtures';

describe('StructuredTextSubmission', () => {
  it('exposes every schema section as a design document section', () => {
    const doc = strongContent().toDesignDocument();
    expect(doc.sections.map((s) => s.key)).toEqual(STRUCTURED_TEXT_SECTIONS.map((s) => s.key));
    expect(doc.text('classes')).toContain('ParkingLot');
  });

  it('fills missing sections with empty strings so a partial draft is valid', () => {
    const content = StructuredTextSubmission.create({ requirements: 'Just this one.' });
    expect(content.valueOf('classes')).toBe('');
    expect(content.toDesignDocument().sections).toHaveLength(STRUCTURED_TEXT_SECTIONS.length);
  });

  it('rejects unknown section keys instead of dropping them silently', () => {
    expect(() => StructuredTextSubmission.create({ nonsense: 'x' })).toThrow(ValidationError);
  });

  it('rejects non-string section values', () => {
    expect(() => StructuredTextSubmission.create({ requirements: 42 as unknown as string })).toThrow(ValidationError);
  });

  it('merges a patch over existing values without losing untouched sections', () => {
    const merged = strongContent().withValues({ requirements: 'Rewritten.' });
    expect(merged.valueOf('requirements')).toBe('Rewritten.');
    expect(merged.valueOf('classes')).toContain('ParkingFloor');
  });
});

describe('Submission fingerprinting', () => {
  it('is stable across equal content and different across changed content', () => {
    expect(fingerprintOf(strongContent())).toBe(fingerprintOf(strongContent()));
    expect(fingerprintOf(strongContent())).not.toBe(fingerprintOf(weakContent()));
  });

  it('ignores trailing whitespace differences that the learner cannot see', () => {
    const padded = StructuredTextSubmission.create({
      ...STRONG_SUBMISSION,
      requirements: `${STRONG_SUBMISSION.requirements}   `,
    });
    expect(fingerprintOf(padded)).toBe(fingerprintOf(strongContent()));
  });

  it('matches() recognises a resubmission of the same design', () => {
    const submission = Submission.of(strongContent(), new Date());
    expect(submission.matches(strongContent())).toBe(true);
    expect(submission.matches(weakContent())).toBe(false);
  });
});

describe('SubmissionContentFactory', () => {
  const factory = new SubmissionContentFactory();

  it('round-trips content through its stored JSON form', () => {
    const stored = strongContent().toJSON();
    const restored = factory.fromStored('structured-text', stored);
    expect(fingerprintOf(restored)).toBe(fingerprintOf(strongContent()));
  });

  it('refuses formats that have no codec yet, naming what is supported', () => {
    expect(() => factory.fromPayload('class-diagram', { nodes: [] })).toThrow(/not supported yet/);
    expect(factory.supportedFormats).toEqual(['structured-text']);
  });
});

describe('Structural rules (the deterministic layer)', () => {
  it('passes a complete, cross-referenced design', () => {
    const report = runStructuralRules(strongContent().toDesignDocument());
    expect(report.isSubmittable).toBe(true);
    expect(report.failures).toHaveLength(0);
    expect(report.passed.length).toBeGreaterThanOrEqual(8);
  });

  it('blocks an empty submission before any evaluator is called', () => {
    const report = runStructuralRules(StructuredTextSubmission.empty().toDesignDocument());
    expect(report.isSubmittable).toBe(false);
    expect(report.failures.map((f) => f.id)).toContain('required_sections');
  });

  it('blocks a submission that is present but too thin to carry evidence', () => {
    const thin = StructuredTextSubmission.create(
      Object.fromEntries(STRUCTURED_TEXT_SECTIONS.map((s) => [s.key, 'a b c'])),
    );
    const report = runStructuralRules(thin.toDesignDocument());
    expect(report.isSubmittable).toBe(false);
    expect(report.failures.map((f) => f.id)).toContain('section_depth');
  });

  it('warns - but does not block - a weak design that is complete', () => {
    const report = runStructuralRules(weakContent().toDesignDocument());
    expect(report.isSubmittable).toBe(true);
    const warnIds = report.warnings.map((w) => w.id);
    expect(warnIds).toContain('overloaded_responsibility');
    expect(warnIds).toContain('pattern_justification');
  });

  it('spots a class that is named but never given a responsibility', () => {
    const content = StructuredTextSubmission.create({
      ...WEAK_SUBMISSION,
      classes: '- ParkingLot\n- Vehicle\n- Ticket\n- PricingEngine',
    });
    const check = runStructuralRules(content.toDesignDocument()).checks.find(
      (c) => c.id === 'responsibility_coverage',
    );
    expect(check?.status).toBe('warn');
    expect(check?.detail).toContain('PricingEngine');
  });

  it('quotes the offending line when one class does everything', () => {
    const check = runStructuralRules(weakContent().toDesignDocument()).checks.find(
      (c) => c.id === 'overloaded_responsibility',
    );
    expect(check?.detail).toContain('ParkingLot');
    expect(check?.detail).toMatch(/\d+ separate duties/);
  });
});
