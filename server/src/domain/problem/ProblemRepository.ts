import { Problem } from './Problem';

/**
 * Problems are authored content, not user data. The port exists so the
 * application layer never cares whether they come from the seeded database,
 * a JSON file or a CMS later.
 */
export interface ProblemRepository {
  list(): Problem[];
  findById(id: string): Problem | null;
}
