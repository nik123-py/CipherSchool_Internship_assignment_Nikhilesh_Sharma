export type Difficulty = 'Starter' | 'Core' | 'Advanced';

export interface DesignFocus {
  /** Short label, e.g. "Pricing". */
  readonly area: string;
  /** The question a strong answer must resolve. */
  readonly question: string;
}

export interface ProblemDefinition {
  readonly id: string;
  readonly title: string;
  readonly difficulty: Difficulty;
  readonly estimatedMinutes: number;
  readonly tagline: string;
  readonly statement: string;
  readonly functionalRequirements: readonly string[];
  readonly constraints: readonly string[];
  readonly designFocus: readonly DesignFocus[];
  readonly edgeCases: readonly string[];
  /**
   * A requirement that is deliberately withheld from the statement and used to
   * pressure-test extensibility: "if we asked for this next sprint, how much of
   * your design changes?". Shown to the learner in the workspace and given to
   * the evaluator as the extensibility probe.
   */
  readonly extensibilityProbe: string;
}

/**
 * A practice problem. Mostly content, with one piece of behaviour that matters:
 * turning itself into the compact context an evaluator needs. Keeping that here
 * means evaluators never have to know how a problem is shaped.
 */
export class Problem {
  private constructor(private readonly definition: ProblemDefinition) {}

  static from(definition: ProblemDefinition): Problem {
    return new Problem(definition);
  }

  get id(): string {
    return this.definition.id;
  }

  get title(): string {
    return this.definition.title;
  }

  get difficulty(): Difficulty {
    return this.definition.difficulty;
  }

  get extensibilityProbe(): string {
    return this.definition.extensibilityProbe;
  }

  get data(): ProblemDefinition {
    return this.definition;
  }

  /** Compact, deterministic problem context for prompts and heuristics. */
  toEvaluationContext(): string {
    const d = this.definition;
    return [
      `PROBLEM: ${d.title} (${d.difficulty})`,
      d.statement,
      '',
      'FUNCTIONAL REQUIREMENTS:',
      ...d.functionalRequirements.map((r, i) => `${i + 1}. ${r}`),
      '',
      'CONSTRAINTS:',
      ...d.constraints.map((c) => `- ${c}`),
      '',
      'DESIGN DECISIONS A STRONG ANSWER MUST RESOLVE:',
      ...d.designFocus.map((f) => `- ${f.area}: ${f.question}`),
      '',
      'EDGE CASES WORTH COVERING:',
      ...d.edgeCases.map((e) => `- ${e}`),
      '',
      `EXTENSIBILITY PROBE (the change we may ask for next): ${d.extensibilityProbe}`,
    ].join('\n');
  }

  /** Keywords used by deterministic checks to spot requirement coverage. */
  requirementKeywords(): string[] {
    return this.definition.functionalRequirements
      .flatMap((r) => r.toLowerCase().match(/\b[a-z][a-z-]{3,}\b/g) ?? [])
      .filter((word) => !GENERIC_WORDS.has(word));
  }
}

const GENERIC_WORDS = new Set([
  'should', 'must', 'system', 'support', 'allow', 'user', 'users', 'when', 'each',
  'that', 'with', 'from', 'this', 'they', 'their', 'into', 'also', 'able', 'once',
  'given', 'after', 'before', 'while', 'which', 'there', 'have', 'been', 'over',
]);
