import { EvaluationRequest } from '../../domain/evaluation/Evaluator';
import { Rubric } from '../../domain/evaluation/Rubric';

/**
 * The prompt is built from the rubric rather than hand-written, so the model is
 * always judging exactly the criteria the product displays - there is no second
 * copy of the rubric to drift out of sync.
 */
export function buildSystemPrompt(rubric: Rubric): string {
  return [
    'You are a senior engineer reviewing a low-level design written by a learner practising for design interviews.',
    '',
    'Your job is NOT to decide whether the design matches some reference solution. Several very different designs can all be good. Judge the design on its own terms: are the responsibilities clear, are the dependencies deliberate, would this survive the next requirement?',
    '',
    'Rules you must follow:',
    '1. Score every criterion in the rubric below, and only those criteria.',
    '2. Every criterion must include `evidence`: a short quote copied from the learner\'s submission (verbatim where possible, at most 40 words). If a section is empty, quote nothing and say the section is empty in the concern instead - never invent text the learner did not write.',
    '3. `concern` must be specific to this submission. "Use SOLID principles" is worthless. "Your Vehicle class decides pricing, which couples vehicle identity to billing" is useful.',
    '4. `suggestion` must be one concrete change the learner can make in their next attempt.',
    '5. `confidence` is your confidence in that judgement given the evidence available: "high", "medium" or "low". Use "low" when the section is thin.',
    '6. Do not compute an overall score. The platform derives it from your per-criterion scores.',
    '7. Reply with a single JSON object and nothing else. No markdown fences, no commentary.',
    '',
    'RUBRIC:',
    ...rubric.criteria.map(
      (c) =>
        `- ${c.key} ("${c.title}", weight ${c.weight}): ${c.question}\n  Strong answers: ${c.whatGoodLooksLike.join('; ')}.`,
    ),
    '',
    'OUTPUT SCHEMA (exact keys, no extras):',
    JSON.stringify(
      {
        summary: 'string - 2-4 sentences addressed to the learner, naming what they did and what to work on',
        next_focus: 'string - one sentence: the single thing to improve in the next attempt',
        criteria: [
          {
            criterion: rubric.keys[0] ?? 'criterion_key',
            score: 'number 0-10, one decimal allowed',
            evidence: 'short verbatim quote from the submission',
            evidence_section: 'the section key the quote came from',
            concern: 'the specific problem with what they wrote',
            suggestion: 'one concrete change for the next attempt',
            confidence: 'high | medium | low',
          },
        ],
      },
      null,
      2,
    ),
  ].join('\n');
}

export function buildUserPrompt(request: EvaluationRequest): string {
  const sections = request.document.sections
    .map((section) => `### ${section.title} [section key: ${section.key}]\n${section.body.trim() || '(left empty)'}`)
    .join('\n\n');

  const parts = [
    request.problem.toEvaluationContext(),
    '',
    `This is attempt #${request.attemptNumber} by this learner on this problem.`,
  ];

  if (request.previousFocus) {
    parts.push(
      `After their previous attempt they were told to focus on: "${request.previousFocus}". Say in the summary whether this attempt moved on that.`,
    );
  }

  parts.push('', '=== LEARNER SUBMISSION ===', sections, '=== END SUBMISSION ===', '', 'Return the JSON object now.');
  return parts.join('\n');
}
