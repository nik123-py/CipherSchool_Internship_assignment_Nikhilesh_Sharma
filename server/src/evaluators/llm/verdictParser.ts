import { CriterionFeedback } from '../../domain/evaluation/CriterionFeedback';
import { EvaluatorVerdict } from '../../domain/evaluation/Evaluator';
import { Rubric } from '../../domain/evaluation/Rubric';
import { Confidence, Score, isConfidence } from '../../domain/evaluation/Score';
import { EvaluationFailedError } from '../../domain/shared/errors';
import { significantTokens } from '../../domain/shared/text';
import { DesignDocument } from '../../domain/submission/DesignDocument';

/**
 * Turns raw model output into a domain verdict - or refuses.
 *
 * This is the "do not trust the model" boundary. Three layers:
 *  1. shape    - is it JSON with the keys we asked for?
 *  2. contract - does it cover every rubric criterion, with usable fields?
 *  3. grounding- does the quoted evidence actually appear in the submission?
 *
 * Layers 1-2 throw (the attempt fails and the learner can retry). Layer 3 never
 * throws: ungrounded evidence is kept, flagged in the UI and its confidence is
 * forced to `low`, because silently dropping it would hide model drift from
 * exactly the person who needs to know about it.
 */
export function parseVerdict(raw: string, rubric: Rubric, document: DesignDocument): EvaluatorVerdict {
  const payload = extractJson(raw);

  const summary = requireString(payload.summary, 'summary');
  const nextFocus = requireString(payload.next_focus ?? payload.nextFocus, 'next_focus');
  const rawCriteria = payload.criteria;
  if (!Array.isArray(rawCriteria)) {
    throw new EvaluationFailedError('Evaluator response had no `criteria` array.');
  }

  const byKey = new Map<string, CriterionFeedback>();
  for (const entry of rawCriteria) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const key = String(row.criterion ?? row.key ?? '').trim();
    if (!rubric.has(key) || byKey.has(key)) continue;

    const evidence = String(row.evidence ?? '').trim();
    const suggestion = String(row.suggestion ?? '').trim();
    if (!evidence || !suggestion) continue;

    const feedback = new CriterionFeedback({
      criterionKey: key,
      score: Score.clamp(Number(row.score)),
      evidence,
      evidenceSection: typeof row.evidence_section === 'string' ? row.evidence_section : undefined,
      concern: String(row.concern ?? '').trim(),
      suggestion,
      confidence: readConfidence(row.confidence),
      grounded: true,
    });
    byKey.set(key, feedback.withGroundingResult(isGrounded(evidence, document)));
  }

  const missing = rubric.keys.filter((key) => !byKey.has(key));
  if (missing.length > 0) {
    throw new EvaluationFailedError(
      `Evaluator response was missing usable feedback for: ${missing.join(', ')}.`,
      true,
      { missing },
    );
  }

  return {
    criteria: rubric.keys.map((key) => byKey.get(key)!),
    summary,
    nextFocus,
  };
}

/**
 * Is this quote actually in the learner's submission?
 *
 * Exact substring matching is too strict (models normalise whitespace, trim
 * bullets, join clauses), so we compare meaningful tokens: at least 65% of the
 * quote's content words must appear in the document.
 */
export function isGrounded(evidence: string, document: DesignDocument): boolean {
  const haystack = new Set(significantTokens(document.fullText()));
  const tokens = significantTokens(evidence);
  if (tokens.length === 0) return false;
  const hits = tokens.filter((token) => haystack.has(token)).length;
  return hits / tokens.length >= 0.65;
}

function extractJson(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  const candidates = [trimmed];

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // try the next candidate
    }
  }
  throw new EvaluationFailedError('Evaluator response was not valid JSON.', true, {
    preview: trimmed.slice(0, 200),
  });
}

function requireString(value: unknown, field: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new EvaluationFailedError(`Evaluator response was missing \`${field}\`.`);
  return text;
}

function readConfidence(value: unknown): Confidence {
  const normalised = typeof value === 'string' ? value.toLowerCase().trim() : '';
  return isConfidence(normalised) ? normalised : 'low';
}
