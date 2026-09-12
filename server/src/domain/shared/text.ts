/**
 * Small text utilities shared by deterministic rules and the heuristic
 * evaluator. Kept in the domain because "what counts as a sentence / a listed
 * item" is part of how we read a design document, not an infrastructure detail.
 */

const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;

export function sentences(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Bullet / numbered / newline separated items, normalised. */
export function listItems(text: string): string[] {
  return text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0);
}

export function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Words that carry meaning, used for evidence-grounding checks. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'are', 'for', 'that',
  'this', 'it', 'with', 'as', 'be', 'by', 'on', 'we', 'i', 'will', 'can', 'has',
  'have', 'from', 'not', 'but', 'so', 'if', 'when', 'each', 'its', 'their',
]);

export function significantTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

/** Cheap PascalCase / camelCase identifier detection, e.g. `ParkingLot`. */
export function identifiers(text: string): string[] {
  const matches = text.match(/\b[A-Z][a-zA-Z0-9]*(?:[A-Z][a-zA-Z0-9]*)+\b|\b[A-Z][a-z]{2,}\b/g) ?? [];
  return unique(matches);
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function truncate(text: string, max = 240): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function containsAny(text: string, needles: string[]): boolean {
  const haystack = text.toLowerCase();
  return needles.some((n) => haystack.includes(n.toLowerCase()));
}

/** Sentence from `text` that best matches the given keywords, if any. */
export function bestMatchingSentence(text: string, keywords: string[]): string | undefined {
  const candidates = sentences(text);
  let best: { sentence: string; hits: number } | undefined;
  for (const sentence of candidates) {
    const lower = sentence.toLowerCase();
    const hits = keywords.reduce((acc, k) => (lower.includes(k.toLowerCase()) ? acc + 1 : acc), 0);
    if (hits > 0 && (!best || hits > best.hits)) best = { sentence, hits };
  }
  return best?.sentence;
}
