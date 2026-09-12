import { identifiers, listItems, truncate, unique, wordCount } from '../shared/text';
import { DesignDocument } from './DesignDocument';
import { STRUCTURED_TEXT_SECTIONS, SectionSpec } from './SubmissionSchema';

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface StructuralCheck {
  readonly id: string;
  readonly title: string;
  readonly status: CheckStatus;
  /** Why the check landed where it did, in the learner's own words where possible. */
  readonly detail: string;
  readonly section?: string;
}

/**
 * A `StructuralRule` is a *deterministic* reading of a design document.
 *
 * These rules answer questions with a right answer - "is the Edge cases
 * section filled in?", "is `FeeCalculator` listed as a class but never given a
 * responsibility?" - and they run before, and independently of, any judgement
 * evaluator. They are cheap, repeatable, explainable and free.
 */
export interface StructuralRule {
  readonly id: string;
  readonly title: string;
  run(doc: DesignDocument, specs: readonly SectionSpec[]): StructuralCheck;
}

/**
 * The result of running every structural rule. `fail` entries block submission:
 * there is no point spending an evaluation on a document that is too thin to
 * carry evidence. `warn` entries travel with the evaluation as extra feedback.
 */
export class StructuralReport {
  constructor(readonly checks: readonly StructuralCheck[]) {}

  get failures(): StructuralCheck[] {
    return this.checks.filter((c) => c.status === 'fail');
  }

  get warnings(): StructuralCheck[] {
    return this.checks.filter((c) => c.status === 'warn');
  }

  get passed(): StructuralCheck[] {
    return this.checks.filter((c) => c.status === 'pass');
  }

  get isSubmittable(): boolean {
    return this.failures.length === 0;
  }

  toJSON(): { checks: StructuralCheck[] } {
    return { checks: [...this.checks] };
  }
}

const requiredSectionsRule: StructuralRule = {
  id: 'required_sections',
  title: 'Every required section is filled in',
  run(doc, specs) {
    const missing = specs
      .filter((spec) => spec.required && doc.text(spec.key).trim().length === 0)
      .map((spec) => spec.title);
    return missing.length === 0
      ? check(this, 'pass', 'All required sections have content.')
      : check(this, 'fail', `Still empty: ${missing.join('; ')}.`);
  },
};

const depthRule: StructuralRule = {
  id: 'section_depth',
  title: 'Required sections carry enough detail to evaluate',
  run(doc, specs) {
    const thin = specs
      .filter((spec) => spec.required && spec.minWords > 0)
      .map((spec) => ({ spec, words: wordCount(doc.text(spec.key)) }))
      .filter(({ spec, words }) => words > 0 && words < spec.minWords);
    if (thin.length === 0) return check(this, 'pass', 'Each required section meets its minimum depth.');
    const detail = thin
      .map(({ spec, words }) => `${spec.title} (${words}/${spec.minWords} words)`)
      .join('; ');
    return check(this, 'fail', `Too thin to give evidence-based feedback: ${detail}.`);
  },
};

const classInventoryRule: StructuralRule = {
  id: 'class_inventory',
  title: 'At least three types are named',
  run(doc) {
    const items = doc.itemsOf('classes');
    return items.length >= 3
      ? check(this, 'pass', `${items.length} types listed.`, 'classes')
      : check(
          this,
          'warn',
          `Only ${items.length} type(s) listed. Most of these problems need at least three collaborating types before responsibilities can be judged.`,
          'classes',
        );
  },
};

const responsibilityCoverageRule: StructuralRule = {
  id: 'responsibility_coverage',
  title: 'Every named class has a stated responsibility',
  run(doc) {
    const declared = declaredTypeNames(doc);
    if (declared.length === 0) {
      return check(this, 'warn', 'No class names could be read from the Main classes section.', 'classes');
    }
    const responsibilities = doc.text('responsibilities').toLowerCase();
    const orphans = declared.filter((name) => !responsibilities.includes(name.toLowerCase()));
    return orphans.length === 0
      ? check(this, 'pass', `All ${declared.length} named types appear in Responsibilities.`, 'responsibilities')
      : check(
          this,
          'warn',
          `Listed as a class but never given a responsibility: ${orphans.join(', ')}.`,
          'responsibilities',
        );
  },
};

const relationshipCoverageRule: StructuralRule = {
  id: 'relationship_coverage',
  title: 'Relationships connect the types you named',
  run(doc) {
    const declared = declaredTypeNames(doc);
    const relationships = doc.text('relationships').toLowerCase();
    if (relationships.trim().length === 0) {
      return check(this, 'warn', 'No relationships described.', 'relationships');
    }
    const connected = declared.filter((name) => relationships.includes(name.toLowerCase()));
    if (declared.length === 0) return check(this, 'warn', 'No class names to cross-check.', 'relationships');
    const ratio = connected.length / declared.length;
    return ratio >= 0.5
      ? check(this, 'pass', `${connected.length} of ${declared.length} types are wired to another type.`, 'relationships')
      : check(
          this,
          'warn',
          `Only ${connected.length} of ${declared.length} named types appear in Relationships, so most of the model is floating.`,
          'relationships',
        );
  },
};

const overloadedResponsibilityRule: StructuralRule = {
  id: 'overloaded_responsibility',
  title: 'No single class is doing everything',
  run(doc) {
    const overloaded = doc
      .itemsOf('responsibilities')
      .map((line) => ({ line, verbs: countResponsibilityClauses(line) }))
      .filter(({ verbs }) => verbs >= 4);
    return overloaded.length === 0
      ? check(this, 'pass', 'No responsibility line bundles four or more duties.', 'responsibilities')
      : check(
          this,
          'warn',
          `This line assigns ${overloaded[0].verbs} separate duties to one type: "${truncate(overloaded[0].line, 160)}"`,
          'responsibilities',
        );
  },
};

const edgeCaseRule: StructuralRule = {
  id: 'edge_case_count',
  title: 'At least three edge cases considered',
  run(doc) {
    const items = doc.itemsOf('edge_cases');
    return items.length >= 3
      ? check(this, 'pass', `${items.length} edge cases listed.`, 'edge_cases')
      : check(
          this,
          'warn',
          `Only ${items.length} edge case(s) listed. Full/empty state, invalid input and concurrent access are worth covering.`,
          'edge_cases',
        );
  },
};

const abstractionRule: StructuralRule = {
  id: 'abstraction_named',
  title: 'At least one abstraction is named with a reason',
  run(doc) {
    const text = doc.text('interfaces');
    const named = identifiers(text).length > 0;
    const justified = /\bbecause\b|\bso that\b|\bso\b|\blater\b|\bchange[sd]?\b|\bvary|\bswap|\btestab/i.test(text);
    if (named && justified) return check(this, 'pass', 'Abstractions are named and motivated.', 'interfaces');
    if (named) {
      return check(
        this,
        'warn',
        'Abstractions are named but no reason is given. An interface without a stated variation is usually premature.',
        'interfaces',
      );
    }
    return check(this, 'warn', 'No named interface or abstract seam found.', 'interfaces');
  },
};

const patternJustificationRule: StructuralRule = {
  id: 'pattern_justification',
  title: 'Named patterns come with a justification',
  run(doc) {
    const text = doc.text('patterns');
    const mentionsPattern =
      /\b(strategy|factory|observer|builder|singleton|state|command|adapter|decorator|template method|visitor|repository)\b/i.test(
        text,
      );
    if (!mentionsPattern) {
      return check(this, 'pass', 'No patterns claimed - that is a valid answer.', 'patterns');
    }
    const justified = /\bbecause\b|\bso that\b|\bso\b|\bwhen\b|\bvary|\bchange|\bavoid|\bkeeps?\b/i.test(text);
    return justified
      ? check(this, 'pass', 'Each pattern is paired with a reason.', 'patterns')
      : check(
          this,
          'warn',
          'Patterns are listed without saying what would break without them. Pattern names alone do not earn credit.',
          'patterns',
        );
  },
};

const flowConcretenessRule: StructuralRule = {
  id: 'flow_concreteness',
  title: 'At least one flow is traced through real methods',
  run(doc) {
    const text = doc.text('flows');
    const hasCall = /\w+\s*\.\s*\w+\s*\(|\w+\(\)|->|→|\bcalls\b|\basks\b|\bdelegates\b/i.test(text);
    return hasCall
      ? check(this, 'pass', 'The flow names concrete calls between objects.', 'flows')
      : check(
          this,
          'warn',
          'The flow reads as narrative rather than as calls between objects. Naming the methods exposes who owns which decision.',
          'flows',
        );
  },
};

export const DEFAULT_STRUCTURAL_RULES: readonly StructuralRule[] = [
  requiredSectionsRule,
  depthRule,
  classInventoryRule,
  responsibilityCoverageRule,
  relationshipCoverageRule,
  overloadedResponsibilityRule,
  edgeCaseRule,
  abstractionRule,
  patternJustificationRule,
  flowConcretenessRule,
];

export function runStructuralRules(
  doc: DesignDocument,
  specs: readonly SectionSpec[] = STRUCTURED_TEXT_SECTIONS,
  rules: readonly StructuralRule[] = DEFAULT_STRUCTURAL_RULES,
): StructuralReport {
  return new StructuralReport(rules.map((rule) => rule.run(doc, specs)));
}

/** Type names the learner declared in the "Main classes" section. */
export function declaredTypeNames(doc: DesignDocument): string[] {
  const names = listItems(doc.text('classes')).flatMap((item) => {
    const head = item.split(/[-:–—(]/)[0] ?? item;
    return identifiers(head);
  });
  return unique(names).slice(0, 24);
}

function countResponsibilityClauses(line: string): number {
  const body = line.includes(':') ? line.slice(line.indexOf(':') + 1) : line;
  const parts = body
    .split(/,| and | also | as well as |;|\+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 3);
  return parts.length;
}

function check(
  rule: { id: string; title: string },
  status: CheckStatus,
  detail: string,
  section?: string,
): StructuralCheck {
  return { id: rule.id, title: rule.title, status, detail, section };
}
