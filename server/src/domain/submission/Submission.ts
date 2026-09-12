import { DesignDocument } from './DesignDocument';
import { SubmissionContent, SubmissionFormat } from './SubmissionContent';

/**
 * The frozen thing the learner handed in.
 *
 * Modelled as a **value object owned by the attempt**, not an entity: it has no
 * lifecycle of its own, is never mutated, and is never referenced from outside
 * its attempt. Giving it an identity and a table of its own would buy nothing
 * in this MVP and would invite code that edits a submission after the fact -
 * exactly the thing the state machine exists to prevent.
 */
export class Submission {
  constructor(
    readonly content: SubmissionContent,
    readonly fingerprint: string,
    readonly submittedAt: Date,
  ) {}

  static of(content: SubmissionContent, submittedAt: Date): Submission {
    return new Submission(content, fingerprintOf(content), submittedAt);
  }

  get format(): SubmissionFormat {
    return this.content.format;
  }

  toDesignDocument(): DesignDocument {
    return this.content.toDesignDocument();
  }

  /** True when the learner handed in byte-identical content again. */
  matches(other: SubmissionContent): boolean {
    return this.fingerprint === fingerprintOf(other);
  }
}

/**
 * Stable content hash used for idempotency and duplicate detection.
 *
 * Deliberately a pure function (FNV-1a over canonical JSON) rather than
 * `node:crypto`, so the domain layer stays free of platform imports and the
 * value is reproducible in tests.
 */
export function fingerprintOf(content: SubmissionContent): string {
  const canonical = `${content.format}|${canonicalJson(content.toJSON())}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}${canonical.length.toString(16)}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
