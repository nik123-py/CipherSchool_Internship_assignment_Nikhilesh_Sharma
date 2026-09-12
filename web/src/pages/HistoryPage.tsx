import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Delta, EmptyState, ErrorState, Loading, ScoreChip, StatusPill, relativeTime } from '../components/ui';
import { useAsync } from '../hooks';

export function HistoryPage() {
  const { data, error, loading, reload } = useAsync(() => api.history(), []);

  const entries = data?.attempts ?? [];
  const completed = entries.filter((entry) => entry.evaluation);
  const best = completed.reduce((max, entry) => Math.max(max, entry.evaluation!.overall), 0);
  const problemsPractised = new Set(entries.map((entry) => entry.problem.id)).size;

  return (
    <main className="page">
      <div className="page-head">
        <span className="eyebrow">Learning loop</span>
        <h1>Your attempts</h1>
        <p className="lede">
          Every attempt is kept, including the ones that failed to evaluate. The point is the trend, not any single
          score.
        </p>
      </div>

      {loading && <Loading label="Loading history…" />}
      {error && !loading && <ErrorState message={error} onRetry={reload} />}

      {data && entries.length === 0 && (
        <div className="card">
          <EmptyState title="Nothing here yet">
            <Link to="/">Pick a problem</Link> and submit your first design — this page then shows how each attempt
            compares with the last.
          </EmptyState>
        </div>
      )}

      {entries.length > 0 && (
        <div className="stack">
          <div className="grid two">
            <div className="card pad">
              <span className="eyebrow">Attempts</span>
              <h2>{entries.length}</h2>
              <p className="small muted">across {problemsPractised} problem(s)</p>
            </div>
            <div className="card pad">
              <span className="eyebrow">Best overall</span>
              <h2>{completed.length > 0 ? best.toFixed(1) : '—'}</h2>
              <p className="small muted">{completed.length} evaluated attempt(s)</p>
            </div>
          </div>

          <section className="card">
            <div className="card-head">
              <h2>All attempts</h2>
              <span className="spacer" />
              <span className="tiny subtle">newest first</span>
            </div>
            {entries.map((entry) => (
              <Link key={entry.attempt.id} to={`/attempts/${entry.attempt.id}`} className="history-row">
                <span className="n">#{entry.attempt.attemptNumber}</span>
                <span>
                  <div className="row" style={{ gap: '0.5rem' }}>
                    <strong>{entry.problem.title}</strong>
                    <StatusPill status={entry.attempt.status} />
                    <span className="tiny subtle">{relativeTime(entry.attempt.updatedAt)}</span>
                  </div>
                  {entry.evaluation ? (
                    <p className="small muted" style={{ marginTop: '0.25rem' }}>
                      <strong>Strongest:</strong> {entry.evaluation.strengths[0]?.title ?? 'none yet'} ·{' '}
                      <strong>Weakest:</strong> {entry.evaluation.priorities[0]?.title ?? '—'}
                    </p>
                  ) : (
                    <p className="small subtle" style={{ marginTop: '0.25rem' }}>
                      {entry.attempt.status === 'DRAFT' ? 'Draft in progress' : 'No feedback yet'}
                    </p>
                  )}
                </span>
                <span className="row" style={{ gap: '0.5rem' }}>
                  {entry.comparison && <Delta value={entry.comparison.delta} />}
                  {entry.evaluation && <ScoreChip score={entry.evaluation.overall} band={entry.evaluation.band} />}
                </span>
              </Link>
            ))}
          </section>
        </div>
      )}
    </main>
  );
}
