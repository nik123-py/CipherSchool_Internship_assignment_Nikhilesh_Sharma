import { ValidationError } from '../shared/errors';
import { DesignDocument, DesignSection } from './DesignDocument';
import { SubmissionContent, SubmissionFormat } from './SubmissionContent';
import { STRUCTURED_TEXT_SECTIONS, SectionSpec } from './SubmissionSchema';

export type SectionValues = Readonly<Record<string, string>>;

/**
 * The MVP submission format: one text box per design section.
 *
 * It owns only what is specific to *text*: which section keys exist, how they
 * are normalised, and how they map onto a `DesignDocument`. Quality judgement
 * lives in evaluators, structural rules live in `StructuralRules` - neither
 * belongs here.
 */
export class StructuredTextSubmission implements SubmissionContent {
  readonly format: SubmissionFormat = 'structured-text';

  private constructor(
    private readonly values: SectionValues,
    private readonly specs: readonly SectionSpec[],
  ) {}

  /**
   * Accepts a partial map of section key -> text. Unknown keys are rejected
   * (a typo in the client should not silently vanish); missing keys become ''
   * so drafts can be saved at any point.
   */
  static create(
    values: Record<string, unknown>,
    specs: readonly SectionSpec[] = STRUCTURED_TEXT_SECTIONS,
  ): StructuredTextSubmission {
    const allowed = new Set(specs.map((s) => s.key));
    const unknown = Object.keys(values).filter((k) => !allowed.has(k));
    if (unknown.length > 0) {
      throw new ValidationError(`Unknown submission section(s): ${unknown.join(', ')}.`, {
        unknownSections: unknown,
      });
    }

    const normalised: Record<string, string> = {};
    for (const spec of specs) {
      const raw = values[spec.key];
      if (raw !== undefined && typeof raw !== 'string') {
        throw new ValidationError(`Section '${spec.key}' must be a string.`, { section: spec.key });
      }
      normalised[spec.key] = normaliseText((raw as string) ?? '');
    }
    return new StructuredTextSubmission(Object.freeze(normalised), specs);
  }

  static empty(): StructuredTextSubmission {
    return StructuredTextSubmission.create({});
  }

  valueOf(key: string): string {
    return this.values[key] ?? '';
  }

  /** Merge new section text over the existing values (draft autosave). */
  withValues(patch: Record<string, unknown>): StructuredTextSubmission {
    return StructuredTextSubmission.create({ ...this.values, ...patch }, this.specs);
  }

  toDesignDocument(): DesignDocument {
    const sections: DesignSection[] = this.specs.map((spec) => ({
      key: spec.key,
      title: spec.title,
      kind: spec.kind,
      body: this.values[spec.key] ?? '',
    }));
    return new DesignDocument(sections);
  }

  toJSON(): Record<string, unknown> {
    return { sections: { ...this.values } };
  }
}

/** Trim trailing whitespace per line and collapse 3+ blank lines. */
function normaliseText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
