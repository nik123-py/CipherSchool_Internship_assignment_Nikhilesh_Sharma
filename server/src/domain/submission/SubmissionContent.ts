import { DesignDocument } from './DesignDocument';

/**
 * Formats the platform knows about. Only `structured-text` is implemented in
 * the MVP; the others are named so the seam - and its real cost - is explicit
 * rather than hypothetical. See docs/DESIGN.md, "Change Test A".
 */
export type SubmissionFormat = 'structured-text' | 'class-diagram' | 'code';

/**
 * What a learner submitted, in whatever shape that format uses natively.
 *
 * Responsibilities:
 *  - own its raw representation (sections / nodes+edges / files)
 *  - know how to present itself as a `DesignDocument` for evaluation
 *  - know how to serialise itself for storage
 *
 * It deliberately knows nothing about attempts, rubrics, scoring or storage.
 */
export interface SubmissionContent {
  readonly format: SubmissionFormat;
  toDesignDocument(): DesignDocument;
  /** Stable JSON representation; the persistence codec round-trips this. */
  toJSON(): Record<string, unknown>;
}
