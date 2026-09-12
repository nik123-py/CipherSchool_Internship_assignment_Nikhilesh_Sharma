import { listItems, sentences, wordCount } from '../shared/text';

/**
 * A `DesignSection` is one addressable piece of a learner's design:
 * "Main classes", "Trade-offs", ... Evaluators quote from sections, so the
 * title travels with the body (feedback can say *where* evidence came from).
 */
export interface DesignSection {
  readonly key: string;
  readonly title: string;
  readonly kind: 'prose' | 'list';
  readonly body: string;
}

/**
 * The single contract every submission format must be able to produce.
 *
 * This is the seam that makes Change Test A cheap: evaluators, deterministic
 * rules, rubric scoring and the feedback UI all read a `DesignDocument`.
 * A future `ClassDiagramSubmission` only has to flatten its nodes and edges
 * into sections - nothing downstream of this type changes.
 */
export class DesignDocument {
  constructor(readonly sections: readonly DesignSection[]) {}

  section(key: string): DesignSection | undefined {
    return this.sections.find((s) => s.key === key);
  }

  /** Body text for a section, or '' when the learner left it blank. */
  text(key: string): string {
    return this.section(key)?.body ?? '';
  }

  itemsOf(key: string): string[] {
    return listItems(this.text(key));
  }

  sentencesOf(key: string): string[] {
    return sentences(this.text(key));
  }

  /** Everything the learner wrote; used for grounding checks and prompts. */
  fullText(): string {
    return this.sections.map((s) => `## ${s.title}\n${s.body}`).join('\n\n');
  }

  totalWords(): number {
    return this.sections.reduce((acc, s) => acc + wordCount(s.body), 0);
  }

  isEmpty(): boolean {
    return this.totalWords() === 0;
  }
}
