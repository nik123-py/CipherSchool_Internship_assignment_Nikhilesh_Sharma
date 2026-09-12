import { NotFoundError } from '../shared/errors';
import { Rubric } from './Rubric';

/**
 * Resolves the rubric an evaluation was scored under.
 *
 * Stored evaluations keep their rubric *version*, not a copy of the rubric, so
 * this registry is what keeps old feedback readable after the rubric changes.
 * When v2 arrives it is added here; v1 evaluations keep rendering against v1.
 */
export class RubricRegistry {
  private readonly byVersion = new Map<string, Rubric>();

  constructor(rubrics: readonly Rubric[] = [Rubric.default()]) {
    for (const rubric of rubrics) this.byVersion.set(rubric.version, rubric);
  }

  get current(): Rubric {
    return Rubric.default();
  }

  get(version: string): Rubric {
    const rubric = this.byVersion.get(version);
    if (!rubric) throw new NotFoundError('Rubric', version);
    return rubric;
  }
}
