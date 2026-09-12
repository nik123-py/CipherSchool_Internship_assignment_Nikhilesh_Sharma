import { Link } from 'react-router-dom';
import { useConfig } from '../App';
import { api } from '../api/client';
import { Badge, EmptyState, ErrorState, Loading, ScoreChip } from '../components/ui';
import { useAsync } from '../hooks';
import type { Band } from '../api/types';

function bandOf(score: number): Band {
  if (score < 4) return 'weak';
  if (score < 6.5) return 'developing';
  if (score < 8.5) return 'solid';
  return 'strong';
}

export function ProblemLibraryPage() {
  const config = useConfig();
  const { data, error, loading, reload } = useAsync(() => api.problems(), []);

  return (
    <main className="page">
      <div className="page-head">
        <span className="eyebrow">Practice loop</span>
        <h1>Choose a problem, design it, get feedback you can act on</h1>
        <p className="lede">
          Write your design as structured text — requirements, classes, responsibilities, trade-offs. Every attempt
          is scored against the same {config.rubric.criteria.length}-criterion rubric, and every score comes with a
          quote from what you wrote.
        </p>
      </div>

      <div className="stack">
        <div className="callout accent">
          <div>
            <strong>How your design is evaluated</strong>
            <span>
              Deterministic structural checks run first and are free to re-run. Judgement comes from{' '}
              <strong>{config.evaluation.label}</strong>. {config.evaluation.reason}
            </span>
          </div>
        </div>

        {loading && <Loading label="Loading problems…" />}
        {error && !loading && <ErrorState message={error} onRetry={reload} />}
        {data && data.problems.length === 0 && (
          <EmptyState title="No problems seeded">Run `npm run seed` and refresh.</EmptyState>
        )}

        {data && data.problems.length > 0 && (
          <div className="grid problems">
            {data.problems.map((problem) => (
              <Link key={problem.id} to={`/problems/${problem.id}`} className="card problem-card">
                <div className="row between">
                  <h3>{problem.title}</h3>
                  <Badge>{problem.difficulty}</Badge>
                </div>
                <p className="tagline">{problem.tagline}</p>
                <div className="row" style={{ gap: '0.35rem' }}>
                  {problem.focusAreas.slice(0, 3).map((area) => (
                    <span key={area} className="badge">
                      {area}
                    </span>
                  ))}
                </div>
                <footer>
                  <span>~{problem.estimatedMinutes} min</span>
                  <span>{problem.requirementCount} requirements</span>
                  <span className="spacer" />
                  {problem.stats.attempts > 0 ? (
                    <span className="row" style={{ gap: '0.4rem' }}>
                      <span>
                        {problem.stats.attempts} attempt{problem.stats.attempts === 1 ? '' : 's'}
                      </span>
                      {problem.stats.bestOverall !== null && (
                        <ScoreChip score={problem.stats.bestOverall} band={bandOf(problem.stats.bestOverall)} />
                      )}
                    </span>
                  ) : (
                    <span>Not attempted</span>
                  )}
                </footer>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
