import { CriterionFeedback } from '../../domain/evaluation/CriterionFeedback';
import { EvaluatorDescriptor } from '../../domain/evaluation/Evaluation';
import { EvaluationRequest, Evaluator, EvaluatorVerdict } from '../../domain/evaluation/Evaluator';
import { Score } from '../../domain/evaluation/Score';
import { SubmissionFormat } from '../../domain/submission/SubmissionContent';
import { CriterionProbe, DEFAULT_PROBES } from './probes';

export interface HeuristicEvaluatorOptions {
  /** Artificial latency so the SUBMITTED -> EVALUATING -> COMPLETED transition is visible in a demo. */
  readonly delayMs?: number;
  readonly probes?: readonly CriterionProbe[];
}

/**
 * The offline evaluator: same `Evaluator` interface, no network, no API key,
 * fully deterministic.
 *
 * It exists for three reasons, in order of importance:
 *  1. anyone can clone this repo and see the whole loop work in one command;
 *  2. tests get a real evaluator instead of a stub that proves nothing;
 *  3. it forces the deterministic/judgement split to be real - everything this
 *     evaluator can do is, by construction, something an LLM should not be
 *     asked to do.
 *
 * It is honest about its limits: confidence is never `high`, and the UI labels
 * its output as pattern-based rather than AI reasoning.
 */
export class HeuristicEvaluator implements Evaluator {
  readonly descriptor: EvaluatorDescriptor = {
    id: 'heuristic:v1',
    kind: 'heuristic',
    label: 'Offline heuristic evaluator',
  };

  private readonly probes: readonly CriterionProbe[];
  private readonly delayMs: number;

  constructor(options: HeuristicEvaluatorOptions = {}) {
    this.probes = options.probes ?? DEFAULT_PROBES;
    this.delayMs = options.delayMs ?? 0;
  }

  supports(format: SubmissionFormat): boolean {
    return format === 'structured-text';
  }

  async evaluate(request: EvaluationRequest): Promise<EvaluatorVerdict> {
    if (this.delayMs > 0) await delay(this.delayMs, request.signal);

    const ctx = { doc: request.document, problem: request.problem };
    const criteria: CriterionFeedback[] = [];

    for (const criterion of request.rubric.criteria) {
      const probe = this.probes.find((p) => p.criterionKey === criterion.key);
      if (!probe) continue;
      const result = probe.assess(ctx);
      criteria.push(
        new CriterionFeedback({
          criterionKey: criterion.key,
          score: Score.clamp(result.score),
          evidence: result.evidence,
          evidenceSection: result.evidenceSection,
          concern: result.concern,
          suggestion: result.suggestion,
          confidence: result.confidence,
          // Evidence is lifted verbatim from the document, so it is grounded
          // by construction - unlike an LLM, this evaluator cannot paraphrase.
          grounded: true,
        }),
      );
    }

    const ranked = [...criteria].sort(
      (a, b) =>
        request.rubric.improvementImpact(b.criterionKey, b.score) -
        request.rubric.improvementImpact(a.criterionKey, a.score),
    );
    const weakest = ranked[0];
    const strongest = [...criteria].sort((a, b) => b.score.value - a.score.value)[0];

    return {
      criteria,
      summary: this.buildSummary(request, strongest, weakest),
      nextFocus: weakest
        ? `${request.rubric.criterion(weakest.criterionKey).title}: ${weakest.suggestion}`
        : 'Keep going - add more detail so the next evaluation has more to work with.',
    };
  }

  private buildSummary(
    request: EvaluationRequest,
    strongest: CriterionFeedback | undefined,
    weakest: CriterionFeedback | undefined,
  ): string {
    const parts: string[] = [];
    parts.push(
      `Attempt #${request.attemptNumber} on ${request.problem.title}, read by the offline heuristic evaluator: ` +
        'it checks structure, coverage and well-known smells in what you wrote, and does not attempt to judge intent.',
    );
    if (strongest) {
      parts.push(
        `Clearest area: ${request.rubric.criterion(strongest.criterionKey).title} (${strongest.score.toString()}/10).`,
      );
    }
    if (weakest) {
      parts.push(
        `Most recoverable ground: ${request.rubric.criterion(weakest.criterionKey).title} (${weakest.score.toString()}/10) - ` +
          `it carries weight ${request.rubric.criterion(weakest.criterionKey).weight} and has the largest gap left.`,
      );
    }
    if (request.previousFocus) {
      parts.push(`You were asked to focus on: "${request.previousFocus}"`);
    }
    return parts.join(' ');
  }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Evaluation aborted.'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('Evaluation aborted.'));
      },
      { once: true },
    );
  });
}
