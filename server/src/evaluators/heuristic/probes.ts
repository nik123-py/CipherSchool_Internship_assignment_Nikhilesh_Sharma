import { Problem } from '../../domain/problem/Problem';
import { Confidence } from '../../domain/evaluation/Score';
import { DesignDocument } from '../../domain/submission/DesignDocument';
import { declaredTypeNames } from '../../domain/submission/StructuralRules';
import {
  bestMatchingSentence,
  containsAny,
  identifiers,
  truncate,
  unique,
  wordCount,
} from '../../domain/shared/text';

export interface ProbeContext {
  readonly doc: DesignDocument;
  readonly problem: Problem;
}

export interface ProbeResult {
  readonly score: number;
  readonly evidence: string;
  readonly evidenceSection: string;
  readonly concern: string;
  readonly suggestion: string;
  readonly confidence: Confidence;
}

/**
 * A probe is the deterministic counterpart of one rubric criterion: it reads
 * specific signals out of the design document and turns them into a score plus
 * a quote from the learner's own text.
 *
 * Probes are intentionally conservative. They can see structure, coverage and
 * well-known smells; they cannot see whether an abstraction is *wise*. Where
 * they are guessing, they report low confidence rather than pretending.
 */
export interface CriterionProbe {
  readonly criterionKey: string;
  assess(ctx: ProbeContext): ProbeResult;
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

function quote(doc: DesignDocument, section: string, keywords: string[] = []): string {
  const text = doc.text(section);
  if (text.trim().length === 0) {
    return `(You left "${doc.section(section)?.title ?? section}" empty.)`;
  }
  const matched = keywords.length > 0 ? bestMatchingSentence(text, keywords) : undefined;
  const fallback = doc.itemsOf(section)[0] ?? doc.sentencesOf(section)[0] ?? text;
  return truncate(matched ?? fallback, 260);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10));
}

const COUPLING_SMELLS = ['singleton', 'static ', 'global', 'directly access', 'directly call', 'knows about'];
const INJECTION_WORDS = ['inject', 'depends on', 'passed in', 'constructor', 'interface', 'abstract', 'port'];
const EDGE_CATEGORIES: Array<{ label: string; needles: string[] }> = [
  { label: 'concurrency', needles: ['concurren', 'race', 'lock', 'atomic', 'thread', 'simultane'] },
  { label: 'capacity / empty state', needles: ['full', 'empty', 'no available', 'sold out', 'capacity', 'out of stock'] },
  { label: 'invalid input', needles: ['invalid', 'unknown', 'malformed', 'not found', 'reject'] },
  { label: 'failure and recovery', needles: ['fail', 'timeout', 'retry', 'rollback', 'refund', 'crash', 'restart'] },
  { label: 'time', needles: ['clock', 'timeout', 'expire', 'timezone', 'midnight', 'duration'] },
];

// --------------------------------------------------------------------------
// probes
// --------------------------------------------------------------------------

const requirementUnderstanding: CriterionProbe = {
  criterionKey: 'requirement_understanding',
  assess({ doc, problem }) {
    const requirementText = `${doc.text('requirements')} ${doc.text('assumptions')}`.toLowerCase();
    const keywords = unique(problem.requirementKeywords());
    const covered = keywords.filter((k) => requirementText.includes(k));
    const coverage = keywords.length === 0 ? 0.6 : covered.length / keywords.length;
    const declaresScope = containsAny(requirementText, ['out of scope', 'not in scope', 'excluded', 'we ignore', 'skip']);
    const assumptions = doc.itemsOf('assumptions').length;

    const score = clamp(3 + coverage * 5 + (declaresScope ? 1 : 0) + (assumptions >= 3 ? 1 : 0));
    const missed = keywords.filter((k) => !requirementText.includes(k)).slice(0, 4);

    const concern = !declaresScope
      ? 'Nothing is marked out of scope, so it is unclear where you decided to stop - an interviewer reads that as either total coverage or an unbounded design.'
      : missed.length > 0
        ? `The statement puts weight on ${missed.join(', ')}, and none of those words appear in your requirements or assumptions.`
        : assumptions < 3
          ? 'Only a couple of assumptions are recorded, so most of the open questions in the statement are still open.'
          : 'No blocking concern: scope and assumptions are both stated.';

    return {
      score,
      evidence: quote(doc, 'requirements', covered.slice(0, 3)),
      evidenceSection: 'requirements',
      concern,
      suggestion:
        missed.length > 0
          ? `Add one line per uncovered requirement (${missed.slice(0, 2).join(', ')}) saying whether you are designing for it or deliberately leaving it out.`
          : 'Add an explicit "out of scope" line so the boundary of your design is unambiguous.',
      confidence: keywords.length >= 6 ? 'medium' : 'low',
    };
  },
};

const classResponsibilities: CriterionProbe = {
  criterionKey: 'class_responsibilities',
  assess({ doc }) {
    const declared = declaredTypeNames(doc);
    const responsibilityLines = doc.itemsOf('responsibilities');
    const responsibilityText = doc.text('responsibilities').toLowerCase();
    const orphans = declared.filter((name) => !responsibilityText.includes(name.toLowerCase()));

    const overloaded = responsibilityLines
      .map((line) => ({ line, clauses: countClauses(line) }))
      .sort((a, b) => b.clauses - a.clauses)[0];
    const isOverloaded = (overloaded?.clauses ?? 0) >= 4;

    const score = clamp(
      4 +
        Math.min(declared.length, 6) * 0.4 +
        (orphans.length === 0 ? 1.5 : -0.5 * orphans.length) +
        (isOverloaded ? -1.5 : 1) +
        (responsibilityLines.length >= declared.length * 0.7 ? 0.5 : 0),
    );

    const concern = isOverloaded
      ? `One type is carrying ${overloaded.clauses} distinct duties in a single line, which is the classic point where a class stops being testable in isolation.`
      : orphans.length > 0
        ? `${orphans.join(', ')} ${orphans.length === 1 ? 'is' : 'are'} named as ${orphans.length === 1 ? 'a type' : 'types'} but never given a responsibility, so ${orphans.length === 1 ? 'its' : 'their'} reason to exist is unstated.`
        : 'No blocking concern: every named type has a stated job and none of them is obviously overloaded.';

    return {
      score,
      evidence: isOverloaded
        ? truncate(overloaded.line, 260)
        : quote(doc, 'responsibilities', declared.slice(0, 3)),
      evidenceSection: 'responsibilities',
      concern,
      suggestion: isOverloaded
        ? `Split that line: keep the orchestration on the aggregate and move the calculation or persistence duty onto its own collaborator that can be tested without the rest of the system.`
        : orphans.length > 0
          ? `Give ${orphans[0]} a one-sentence responsibility, or delete it - a type with no job is a data bag.`
          : 'Try writing each responsibility as "decides X" or "owns Y"; anything that resists that phrasing is usually two classes.',
      confidence: declared.length >= 3 ? 'medium' : 'low',
    };
  },
};

const couplingCohesion: CriterionProbe = {
  criterionKey: 'coupling_cohesion',
  assess({ doc }) {
    const relationships = doc.text('relationships');
    const declared = declaredTypeNames(doc);
    const connected = declared.filter((n) => relationships.toLowerCase().includes(n.toLowerCase()));
    const ratio = declared.length === 0 ? 0 : connected.length / declared.length;
    const injection = INJECTION_WORDS.filter((w) => `${relationships} ${doc.text('interfaces')}`.toLowerCase().includes(w));
    const smells = COUPLING_SMELLS.filter((s) => `${relationships} ${doc.text('responsibilities')}`.toLowerCase().includes(s));
    const hasCardinality = /\b1\.\.\*|\b0\.\.\*|\bone-to-many\b|\bmany\b|\b1:n\b|\bcomposes?\b|\baggregat/i.test(relationships);

    const score = clamp(3.5 + ratio * 3 + injection.length * 0.6 + (hasCardinality ? 1 : 0) - smells.length * 1.2);

    const concern = smells.length > 0
      ? `Your write-up leans on "${smells[0].trim()}", which hard-wires the dependency and takes the seam away from whoever has to change it later.`
      : ratio < 0.6
        ? `Only ${connected.length} of ${declared.length} named types appear in Relationships, so the coupling of the rest cannot be assessed - and probably has not been decided.`
        : injection.length === 0
          ? 'Dependencies are described but never said to be injected or expressed as interfaces, so they read as hard references.'
          : 'No blocking concern: dependencies are stated and mostly point at abstractions.';

    return {
      score,
      evidence: quote(doc, 'relationships', [...connected.slice(0, 2), ...smells]),
      evidenceSection: 'relationships',
      concern,
      suggestion: smells.length > 0
        ? `Replace that with a dependency passed into the constructor so the collaborator can be substituted in a test.`
        : ratio < 0.6
          ? `Add a relationship line for the types that are currently floating (${declared.filter((n) => !connected.includes(n)).slice(0, 3).join(', ') || 'the remaining types'}), including direction and cardinality.`
          : 'State the direction of each dependency explicitly ("A depends on the B interface"), so the reader can see which side is protected from change.',
      confidence: declared.length >= 3 ? 'medium' : 'low',
    };
  },
};

const encapsulationInterfaces: CriterionProbe = {
  criterionKey: 'encapsulation_interfaces',
  assess({ doc }) {
    const interfaces = doc.text('interfaces');
    const named = identifiers(interfaces);
    const justified = /\bbecause\b|\bso that\b|\blater\b|\bvary|\bswap|\bchange|\btestab/i.test(interfaces);
    const flows = doc.text('flows');
    const methodCalls = flows.match(/\b\w+\s*\.\s*\w+\s*\(/g) ?? [];
    const leakySignals = /\bpublic (field|attribute|variable)|\bgetter and setter|\bget[A-Z]\w*\(\)\s*(and|,)\s*set/i.test(
      `${doc.text('responsibilities')} ${interfaces}`,
    );

    const score = clamp(
      3.5 + Math.min(named.length, 4) * 0.8 + (justified ? 1.5 : 0) + Math.min(methodCalls.length, 4) * 0.3 - (leakySignals ? 1.5 : 0),
    );

    const concern = named.length === 0
      ? 'No interface or abstract seam is named, so every collaborator in this design is a concrete class talking to another concrete class.'
      : !justified
        ? `${named[0]} is introduced without saying which change it absorbs, and an interface with one implementation and no named variation usually costs more than it saves.`
        : leakySignals
          ? 'State appears to be exposed through raw accessors, which moves the invariant out of the class that owns it.'
          : methodCalls.length === 0
            ? 'The flows never name a method, so it is hard to tell what each type actually exposes.'
            : 'No blocking concern: the seams are named and the flow shows what they expose.';

    return {
      score,
      evidence: quote(doc, named.length > 0 ? 'interfaces' : 'responsibilities', named.slice(0, 2)),
      evidenceSection: named.length > 0 ? 'interfaces' : 'responsibilities',
      concern,
      suggestion: named.length === 0
        ? 'Name one seam where you expect variation (pricing, allocation, payment, notification) and describe it as an interface with a single responsibility.'
        : !justified
          ? `Write one line for ${named[0]}: "today X, tomorrow Y" - if you cannot fill in Y, collapse the interface back into the class.`
          : 'Describe the public methods each interface exposes; an interface defined by its methods is much easier to review than one defined by its name.',
      confidence: 'low',
    };
  },
};

const abstractionPatterns: CriterionProbe = {
  criterionKey: 'abstraction_patterns',
  assess({ doc }) {
    const patterns = doc.text('patterns');
    const mentioned = PATTERN_NAMES.filter((p) => new RegExp(`\\b${p}\\b`, 'i').test(patterns));
    const justified = /\bbecause\b|\bso that\b|\bwhen\b|\bvary|\bchange|\bavoid|\bkeeps?\b|\ballows?\b/i.test(patterns);
    const declinedDeliberately = /\bno pattern|\bnone needed|\bnot needed|\bavoided\b|\bdid not use/i.test(patterns);
    const overPatterned = mentioned.length >= 4 && wordCount(patterns) < mentioned.length * 14;

    const score = clamp(
      declinedDeliberately && mentioned.length <= 1
        ? 7
        : 4 + Math.min(mentioned.length, 3) * 1.1 + (justified ? 1.8 : -0.5) - (overPatterned ? 2 : 0),
    );

    const concern = mentioned.length === 0 && !declinedDeliberately
      ? 'No pattern is claimed and no reason is given for not needing one, so it is unclear whether the simplicity is a decision or an omission.'
      : overPatterned
        ? `${mentioned.length} patterns are listed in very few words, which reads as pattern-spotting rather than design - each one adds an indirection someone has to maintain.`
        : !justified
          ? `"${mentioned[0]}" is named without saying what breaks without it.`
          : 'No blocking concern: the patterns you claim are tied to a reason.';

    return {
      score,
      evidence: quote(doc, 'patterns', mentioned),
      evidenceSection: 'patterns',
      concern,
      suggestion: overPatterned
        ? 'Keep the one or two patterns that absorb a change you can name today, and drop the rest.'
        : mentioned.length === 0
          ? 'Either name the one seam that would benefit from Strategy/State here, or write "no pattern needed because the rule never varies" - both are defensible, silence is not.'
          : `For ${mentioned[0] ?? 'each pattern'}, add the sentence "without this, changing ___ would mean editing ___".`,
      confidence: 'low',
    };
  },
};

const extensibility: CriterionProbe = {
  criterionKey: 'extensibility',
  assess({ doc, problem }) {
    const surface = `${doc.text('tradeoffs')} ${doc.text('interfaces')} ${doc.text('patterns')}`.toLowerCase();
    const probeWords = unique(
      (problem.extensibilityProbe.toLowerCase().match(/\b[a-z][a-z-]{4,}\b/g) ?? []).filter(
        (w) => !['would', 'could', 'should', 'later', 'change', 'their', 'there'].includes(w),
      ),
    );
    const probeHits = probeWords.filter((w) => surface.includes(w));
    const forwardLooking = /\bwithout changing\b|\bnew implementation\b|\badd a new\b|\bplug\b|\bswap\b|\bopen[- ]closed\b|\bextend\b/i.test(
      surface,
    );
    const onlyIfElse = /\bif\/else\b|\bswitch statement\b|\badd an if\b|\benum check\b/i.test(surface);

    const score = clamp(
      3.5 +
        Math.min(probeHits.length, 3) * 1.1 +
        (forwardLooking ? 2 : 0) +
        (wordCount(doc.text('tradeoffs')) >= 60 ? 1 : 0) -
        (onlyIfElse ? 1 : 0),
    );

    const concern = probeHits.length === 0
      ? `The likely next requirement for this problem is: "${truncate(problem.extensibilityProbe, 160)}" - your write-up does not say where that change would land.`
      : !forwardLooking
        ? 'Change is discussed, but not in terms of what could be added without editing existing types, so the design may still be closed for extension.'
        : 'No blocking concern: you name a change and where it would be absorbed.';

    return {
      score,
      evidence: quote(doc, 'tradeoffs', probeHits.length > 0 ? probeHits : ['change', 'later', 'scale']),
      evidenceSection: 'tradeoffs',
      concern,
      suggestion: `Answer this in one paragraph: "${truncate(problem.extensibilityProbe, 140)}" - name the classes you would add and the ones you would not have to touch.`,
      confidence: probeWords.length >= 3 ? 'medium' : 'low',
    };
  },
};

const edgeCasesTestability: CriterionProbe = {
  criterionKey: 'edge_cases_testability',
  assess({ doc }) {
    const edgeText = doc.text('edge_cases').toLowerCase();
    const items = doc.itemsOf('edge_cases');
    const covered = EDGE_CATEGORIES.filter((c) => containsAny(edgeText, c.needles));
    const missing = EDGE_CATEGORIES.filter((c) => !covered.includes(c));
    const statesBehaviour = /\breturns?\b|\bthrows?\b|\brejects?\b|\bfalls back\b|\bretries\b|\bqueues?\b|\bblocks?\b/i.test(
      edgeText,
    );
    const testable = /\binject|\bmock|\bstub|\bclock\b|\bdeterministic|\bunit test|\bfake\b/i.test(
      `${edgeText} ${doc.text('interfaces')} ${doc.text('assumptions')}`.toLowerCase(),
    );

    const score = clamp(2.5 + covered.length * 1.2 + (statesBehaviour ? 1.5 : 0) + (testable ? 1 : 0) + Math.min(items.length, 5) * 0.2);

    const concern = !statesBehaviour
      ? 'The edge cases are named but not resolved - each line says what can go wrong without saying what the system does about it.'
      : missing.length > 0
        ? `Nothing covers ${missing.slice(0, 2).map((m) => m.label).join(' or ')}, which is usually where this kind of design first breaks in production.`
        : !testable
          ? 'Nothing in the design is described as injectable, so the behaviour you describe would be hard to test without the real world attached.'
          : 'No blocking concern: the important boundaries are covered and the behaviour on each is stated.';

    return {
      score,
      evidence: quote(doc, 'edge_cases', covered.flatMap((c) => c.needles).slice(0, 4)),
      evidenceSection: 'edge_cases',
      concern,
      suggestion: !statesBehaviour
        ? 'Rewrite each edge case as "when X, the system does Y" - the verb is where the design decision lives.'
        : missing.length > 0
          ? `Add a line for ${missing[0].label}, including what the caller sees when it happens.`
          : 'Name the seam you would fake in a unit test (clock, gateway, repository) so the edge cases become assertable.',
      confidence: 'medium',
    };
  },
};

const qualityOfExplanation: CriterionProbe = {
  criterionKey: 'quality_of_explanation',
  assess({ doc }) {
    const flows = doc.text('flows');
    const tradeoffs = doc.text('tradeoffs');
    const methodCalls = flows.match(/\b\w+\s*\.\s*\w+\s*\(|\b\w+\(\)/g) ?? [];
    const steps = /→|->|\bthen\b|\bnext\b|\bfinally\b|\d\./i.test(flows);
    const namesTradeoff = /\binstead of\b|\brather than\b|\bgave up\b|\bat the cost of\b|\bdownside\b|\btrade[- ]?off\b|\bwould change\b/i.test(
      tradeoffs,
    );

    const score = clamp(
      3 + Math.min(methodCalls.length, 5) * 0.6 + (steps ? 1.2 : 0) + (namesTradeoff ? 2 : 0) + (wordCount(tradeoffs) >= 50 ? 0.8 : 0),
    );

    const concern = methodCalls.length === 0
      ? 'The flow never names a call, so the reader cannot tell which object makes each decision - that is exactly what the flow section is for.'
      : !namesTradeoff
        ? 'The trade-off section describes the design but never names what you gave up, so it reads as a summary rather than a decision.'
        : 'No blocking concern: the flow is concrete and the trade-off names a cost.';

    return {
      score,
      evidence: quote(doc, methodCalls.length === 0 ? 'flows' : 'tradeoffs', ['because', 'instead', 'trade']),
      evidenceSection: methodCalls.length === 0 ? 'flows' : 'tradeoffs',
      concern,
      suggestion: methodCalls.length === 0
        ? 'Rewrite one flow as a numbered call chain: `A.method(x)` → `B.method(y)` → result, with the state change at each step.'
        : 'Add one sentence in the form "I chose X instead of Y because Z, which costs me W".',
      confidence: 'medium',
    };
  },
};

const PATTERN_NAMES = [
  'strategy', 'factory', 'abstract factory', 'observer', 'builder', 'singleton', 'state',
  'command', 'adapter', 'decorator', 'template method', 'visitor', 'repository', 'facade',
  'chain of responsibility', 'mediator', 'composite', 'proxy', 'null object',
];

function countClauses(line: string): number {
  const body = line.includes(':') ? line.slice(line.indexOf(':') + 1) : line;
  return body
    .split(/,| and | also | as well as |;|\+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 3).length;
}

export const DEFAULT_PROBES: readonly CriterionProbe[] = [
  requirementUnderstanding,
  classResponsibilities,
  couplingCohesion,
  encapsulationInterfaces,
  abstractionPatterns,
  extensibility,
  edgeCasesTestability,
  qualityOfExplanation,
];
