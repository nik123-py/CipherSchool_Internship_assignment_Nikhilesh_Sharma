import { ValidationError } from '../shared/errors';

export type ScoreBand = 'weak' | 'developing' | 'solid' | 'strong';

/**
 * A criterion score on a fixed 0-10 scale.
 *
 * A value object rather than a bare number because the scale, the rounding and
 * the band language ("developing" vs "strong") are domain decisions that the
 * UI, the evaluators and the progress calculation must all agree on.
 */
export class Score {
  private constructor(readonly value: number) {}

  static readonly MIN = 0;
  static readonly MAX = 10;

  static of(value: number): Score {
    if (!Number.isFinite(value)) {
      throw new ValidationError(`Score must be a number, received ${String(value)}.`);
    }
    const rounded = Math.round(value * 10) / 10;
    if (rounded < Score.MIN || rounded > Score.MAX) {
      throw new ValidationError(`Score must be between ${Score.MIN} and ${Score.MAX}, received ${rounded}.`);
    }
    return new Score(rounded);
  }

  /** For evaluator output we do not control: clamp instead of throwing. */
  static clamp(value: number): Score {
    if (!Number.isFinite(value)) return new Score(0);
    return Score.of(Math.min(Score.MAX, Math.max(Score.MIN, value)));
  }

  get band(): ScoreBand {
    if (this.value < 4) return 'weak';
    if (this.value < 6.5) return 'developing';
    if (this.value < 8.5) return 'solid';
    return 'strong';
  }

  /** Head-room left on this criterion; drives improvement prioritisation. */
  get gap(): number {
    return Score.MAX - this.value;
  }

  toString(): string {
    return this.value.toFixed(1);
  }
}

export type Confidence = 'low' | 'medium' | 'high';

export const CONFIDENCE_VALUES: readonly Confidence[] = ['low', 'medium', 'high'];

export function isConfidence(value: unknown): value is Confidence {
  return typeof value === 'string' && (CONFIDENCE_VALUES as readonly string[]).includes(value);
}
