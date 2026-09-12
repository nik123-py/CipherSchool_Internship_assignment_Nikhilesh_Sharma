import 'dotenv/config';
import { loadConfig } from '../config/config';
import { PROBLEM_DEFINITIONS } from '../content/problems';
import { openDatabase } from './Database';
import { SqliteProblemRepository } from './SqliteRepositories';

/**
 * Explicit seed command. The server also seeds on boot (upsert, so it is
 * idempotent) - this exists so a reviewer can verify the database independently
 * of the API.
 */
const config = loadConfig();
const db = openDatabase(config.databasePath);
const problems = new SqliteProblemRepository(db);

PROBLEM_DEFINITIONS.forEach((definition, index) => problems.upsert(definition, index));

console.log(`Seeded ${PROBLEM_DEFINITIONS.length} problems into ${config.databasePath}`);
console.log(problems.list().map((p) => `  - ${p.id}: ${p.title} (${p.difficulty})`).join('\n'));
db.close();
