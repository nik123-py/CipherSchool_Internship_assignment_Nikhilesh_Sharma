/**
 * Domain errors carry an HTTP-ish `status` so the transport layer can map them
 * without a giant switch, but the domain itself never imports Express.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

/** The caller asked for something that does not exist. */
export class NotFoundError extends DomainError {
  readonly code = 'NOT_FOUND';
  readonly status = 404;

  constructor(entity: string, id: string) {
    super(`${entity} '${id}' was not found.`, { entity, id });
  }
}

/** The payload is structurally wrong (missing sections, wrong types, ...). */
export class ValidationError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  readonly status = 422;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/** A state machine guard rejected the requested transition. */
export class InvalidStateTransitionError extends DomainError {
  readonly code = 'INVALID_STATE_TRANSITION';
  readonly status = 409;

  constructor(
    readonly from: string,
    readonly to: string,
    hint: string,
  ) {
    super(`Cannot move from ${from} to ${to}. ${hint}`, { from, to });
  }
}

/** The request conflicts with the current state (duplicate submit, ...). */
export class ConflictError extends DomainError {
  readonly code = 'CONFLICT';
  readonly status = 409;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
  }
}

/**
 * An evaluator could not produce a verdict. This is expected and recoverable:
 * the submission is already stored, the attempt moves to FAILED and the learner
 * is offered a retry.
 */
export class EvaluationFailedError extends DomainError {
  readonly code = 'EVALUATION_FAILED';
  readonly status = 502;

  constructor(
    message: string,
    readonly retryable: boolean = true,
    details: Record<string, unknown> = {},
  ) {
    super(message, details);
  }
}
