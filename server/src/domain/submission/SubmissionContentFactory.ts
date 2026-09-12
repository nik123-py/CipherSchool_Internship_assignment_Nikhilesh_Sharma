import { ValidationError } from '../shared/errors';
import { StructuredTextSubmission } from './StructuredTextSubmission';
import { SubmissionContent, SubmissionFormat } from './SubmissionContent';

/**
 * Builds and rebuilds `SubmissionContent` from untyped payloads.
 *
 * One registry serves both directions - HTTP payload in, stored JSON back out -
 * so a new format is added in exactly one place. This is the second half of the
 * Change Test A seam (the first half is `toDesignDocument()`).
 */
export interface SubmissionCodec {
  readonly format: SubmissionFormat;
  /** Untrusted payload (HTTP body) -> content, throwing ValidationError. */
  fromPayload(payload: Record<string, unknown>): SubmissionContent;
  /** Previously stored `content.toJSON()` -> content. */
  fromStored(stored: Record<string, unknown>): SubmissionContent;
  /** The empty document a new attempt starts from. */
  empty(): SubmissionContent;
}

const structuredTextCodec: SubmissionCodec = {
  format: 'structured-text',
  fromPayload: (payload) => StructuredTextSubmission.create(readSections(payload)),
  fromStored: (stored) => StructuredTextSubmission.create(readSections(stored)),
  empty: () => StructuredTextSubmission.empty(),
};

function readSections(payload: Record<string, unknown>): Record<string, unknown> {
  const sections = payload.sections ?? payload;
  if (typeof sections !== 'object' || sections === null || Array.isArray(sections)) {
    throw new ValidationError('Expected a `sections` object of section key -> text.');
  }
  return sections as Record<string, unknown>;
}

export class SubmissionContentFactory {
  private readonly codecs = new Map<SubmissionFormat, SubmissionCodec>();

  constructor(codecs: readonly SubmissionCodec[] = [structuredTextCodec]) {
    for (const codec of codecs) this.codecs.set(codec.format, codec);
  }

  get supportedFormats(): SubmissionFormat[] {
    return [...this.codecs.keys()];
  }

  private codec(format: SubmissionFormat): SubmissionCodec {
    const codec = this.codecs.get(format);
    if (!codec) {
      throw new ValidationError(
        `Submission format '${format}' is not supported yet. Supported: ${this.supportedFormats.join(', ')}.`,
        { format },
      );
    }
    return codec;
  }

  fromPayload(format: SubmissionFormat, payload: Record<string, unknown>): SubmissionContent {
    return this.codec(format).fromPayload(payload);
  }

  fromStored(format: SubmissionFormat, stored: Record<string, unknown>): SubmissionContent {
    return this.codec(format).fromStored(stored);
  }

  empty(format: SubmissionFormat = 'structured-text'): SubmissionContent {
    return this.codec(format).empty();
  }

  /** Merge a partial update over existing content (draft autosave). */
  merge(existing: SubmissionContent, patch: Record<string, unknown>): SubmissionContent {
    if (existing instanceof StructuredTextSubmission) {
      const sections = patch.sections ?? patch;
      if (typeof sections !== 'object' || sections === null || Array.isArray(sections)) {
        throw new ValidationError('Expected a `sections` object of section key -> text.');
      }
      return existing.withValues(sections as Record<string, unknown>);
    }
    return this.fromPayload(existing.format, patch);
  }
}
