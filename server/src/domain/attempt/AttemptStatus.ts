export const ATTEMPT_STATUSES = ['DRAFT', 'SUBMITTED', 'EVALUATING', 'COMPLETED', 'FAILED'] as const;

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

/**
 * The whole lifecycle, in one table.
 *
 *   DRAFT ──submit──▶ SUBMITTED ──start──▶ EVALUATING ──▶ COMPLETED (terminal)
 *                          ▲                    │
 *                          │                    └──▶ FAILED
 *                          └──── resubmit ──────────────┘
 *                                                  └── retry ──▶ EVALUATING
 *
 * COMPLETED is terminal on purpose: "try again" produces attempt N+1 rather
 * than mutating history, which is what makes the progress view meaningful.
 */
export const ALLOWED_TRANSITIONS: Readonly<Record<AttemptStatus, readonly AttemptStatus[]>> = {
  DRAFT: ['SUBMITTED'],
  SUBMITTED: ['EVALUATING'],
  EVALUATING: ['COMPLETED', 'FAILED'],
  COMPLETED: [],
  FAILED: ['EVALUATING', 'SUBMITTED'],
};

export function canTransition(from: AttemptStatus, to: AttemptStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Statuses in which the learner may still edit the design. */
export function isEditable(status: AttemptStatus): boolean {
  return status === 'DRAFT';
}

/** Statuses where an evaluation is expected to arrive. */
export function isPending(status: AttemptStatus): boolean {
  return status === 'SUBMITTED' || status === 'EVALUATING';
}

export function isTerminal(status: AttemptStatus): boolean {
  return status === 'COMPLETED';
}
