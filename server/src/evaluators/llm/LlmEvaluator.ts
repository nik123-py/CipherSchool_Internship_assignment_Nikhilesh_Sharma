import { EvaluatorDescriptor } from '../../domain/evaluation/Evaluation';
import { EvaluationRequest, Evaluator, EvaluatorVerdict } from '../../domain/evaluation/Evaluator';
import { SubmissionFormat } from '../../domain/submission/SubmissionContent';
import { LlmClient } from './LlmClient';
import { buildSystemPrompt, buildUserPrompt } from './prompt';
import { parseVerdict } from './verdictParser';

/**
 * Judgement-heavy evaluation, delegated to a model.
 *
 * The division of labour is deliberate and visible here:
 *  - the rubric decides what is asked (prompt is generated from it)
 *  - the model supplies per-criterion judgement, evidence and suggestions
 *  - `parseVerdict` decides whether that output is admissible
 *  - `Evaluation` derives every aggregate number
 *
 * The model is never asked "is this a good design, out of 100?".
 */
export class LlmEvaluator implements Evaluator {
  readonly descriptor: EvaluatorDescriptor;

  constructor(
    private readonly client: LlmClient,
    private readonly maxTokens = 4000,
  ) {
    this.descriptor = {
      id: `llm:${client.id}`,
      kind: 'llm',
      label: client.label,
    };
  }

  supports(format: SubmissionFormat): boolean {
    // A diagram submission flattens to a DesignDocument, so this evaluator
    // would work unchanged - but claiming support before that codec exists
    // would be a lie the registry acts on.
    return format === 'structured-text';
  }

  async evaluate(request: EvaluationRequest): Promise<EvaluatorVerdict> {
    const raw = await this.client.complete({
      system: buildSystemPrompt(request.rubric),
      user: buildUserPrompt(request),
      maxTokens: this.maxTokens,
      signal: request.signal,
    });
    return parseVerdict(raw, request.rubric, request.document);
  }
}
