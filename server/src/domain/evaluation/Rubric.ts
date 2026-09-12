import { NotFoundError } from '../shared/errors';
import { Score } from './Score';

export interface RubricCriterion {
  readonly key: string;
  readonly title: string;
  /** What this criterion is actually asking, in one sentence. */
  readonly question: string;
  /** Relative weight in the overall score. Weights need not sum to 1. */
  readonly weight: number;
  /** Shown to the learner *before* they submit, and given to the evaluator. */
  readonly whatGoodLooksLike: readonly string[];
  /** Section keys that usually carry the evidence for this criterion. */
  readonly evidenceSections: readonly string[];
}

/**
 * The fixed rubric an evaluation is scored against.
 *
 * Two design points worth defending in review:
 *  1. The rubric is versioned. Evaluations record the version they were scored
 *     under, so changing the rubric later does not silently rewrite history or
 *     make old attempts incomparable.
 *  2. The rubric - not the evaluator - owns aggregation. An LLM is asked for
 *     per-criterion judgements only; turning eight judgements into one number
 *     is deterministic, inspectable arithmetic that lives here.
 */
export class Rubric {
  constructor(
    readonly version: string,
    readonly criteria: readonly RubricCriterion[],
  ) {}

  static default(): Rubric {
    return DEFAULT_RUBRIC;
  }

  criterion(key: string): RubricCriterion {
    const found = this.criteria.find((c) => c.key === key);
    if (!found) throw new NotFoundError('RubricCriterion', key);
    return found;
  }

  has(key: string): boolean {
    return this.criteria.some((c) => c.key === key);
  }

  get keys(): string[] {
    return this.criteria.map((c) => c.key);
  }

  /** Weighted mean of per-criterion scores, on the same 0-10 scale. */
  aggregate(scores: ReadonlyMap<string, Score>): Score {
    let weighted = 0;
    let totalWeight = 0;
    for (const criterion of this.criteria) {
      const score = scores.get(criterion.key);
      if (!score) continue;
      weighted += score.value * criterion.weight;
      totalWeight += criterion.weight;
    }
    if (totalWeight === 0) return Score.of(0);
    return Score.of(weighted / totalWeight);
  }

  /**
   * How much overall score is recoverable by fixing this criterion.
   * Used to rank improvements so the learner is told what to fix *first*.
   */
  improvementImpact(key: string, score: Score): number {
    return this.criterion(key).weight * score.gap;
  }
}

const DEFAULT_RUBRIC = new Rubric('v1', [
  {
    key: 'requirement_understanding',
    title: 'Requirement understanding',
    question: 'Did the learner design for the problem that was actually asked, with scope made explicit?',
    weight: 1.0,
    whatGoodLooksLike: [
      'Restates the requirements rather than copying them',
      'States what is out of scope and why',
      'Assumptions are decisions, not filler',
    ],
    evidenceSections: ['requirements', 'assumptions'],
  },
  {
    key: 'class_responsibilities',
    title: 'Class responsibilities',
    question: 'Does each type own one clear job, and can you tell what it decides?',
    weight: 1.4,
    whatGoodLooksLike: [
      'Every class has a one-sentence responsibility',
      'No class both orchestrates and calculates',
      'Names describe roles, not data bags',
    ],
    evidenceSections: ['classes', 'responsibilities', 'flows'],
  },
  {
    key: 'coupling_cohesion',
    title: 'Coupling and cohesion',
    question: 'Are dependencies deliberate and pointed in a direction that survives change?',
    weight: 1.2,
    whatGoodLooksLike: [
      'Dependencies are stated, and go towards abstractions',
      'Related data and behaviour live together',
      'No class reaches through another to a third',
    ],
    evidenceSections: ['relationships', 'responsibilities'],
  },
  {
    key: 'encapsulation_interfaces',
    title: 'Encapsulation and interfaces',
    question: 'Is state protected behind behaviour, and are the public seams meaningful?',
    weight: 1.1,
    whatGoodLooksLike: [
      'State changes go through intention-revealing methods',
      'Interfaces express a role, not a class shape',
      'Invariants are enforced by the owner of the state',
    ],
    evidenceSections: ['interfaces', 'responsibilities', 'flows'],
  },
  {
    key: 'abstraction_patterns',
    title: 'Abstraction and patterns',
    question: 'Is each abstraction earning its keep against a named variation?',
    weight: 1.0,
    whatGoodLooksLike: [
      'Each pattern is tied to a change it absorbs',
      'No pattern used decoratively',
      '"No pattern needed here" is argued, not assumed',
    ],
    evidenceSections: ['patterns', 'interfaces'],
  },
  {
    key: 'extensibility',
    title: 'Extensibility',
    question: 'If the next requirement lands, how much of this design has to be rewritten?',
    weight: 1.2,
    whatGoodLooksLike: [
      'New behaviour arrives as a new type, not a new if-branch',
      'The likely change is named up front',
      'Extension points are concrete, not aspirational',
    ],
    evidenceSections: ['interfaces', 'tradeoffs', 'patterns'],
  },
  {
    key: 'edge_cases_testability',
    title: 'Edge cases and testability',
    question: 'Are failure and boundary states designed for, and can the design be tested without the world attached?',
    weight: 1.1,
    whatGoodLooksLike: [
      'Full/empty, invalid input and concurrent access are handled',
      'The behaviour on failure is stated, not just the failure',
      'Time, randomness and I/O are injectable',
    ],
    evidenceSections: ['edge_cases', 'assumptions', 'interfaces'],
  },
  {
    key: 'quality_of_explanation',
    title: 'Quality of explanation',
    question: 'Could another engineer implement this from the write-up, and are the trade-offs honest?',
    weight: 1.0,
    whatGoodLooksLike: [
      'Flows are traced through named methods',
      'Trade-offs name what was given up',
      'Reasoning is specific to this problem',
    ],
    evidenceSections: ['flows', 'tradeoffs'],
  },
]);
