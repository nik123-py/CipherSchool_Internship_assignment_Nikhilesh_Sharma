import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useConfig } from '../App';
import { ApiError, api } from '../api/client';
import { Badge, Delta, EmptyState, ErrorState, Loading, ScoreChip, StatusPill, relativeTime } from '../components/ui';
import { useAsync } from '../hooks';

export function ProblemDetailPage() {
  const { problemId = '' } = useParams();
  const navigate = useNavigate();
  const config = useConfig();
  const { data, error, loading, reload } = useAsync(() => api.problem(problemId), [problemId]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const start = async () => {
    setStarting(true);
    setStartError(null);
    try {
      const { attempt } = await api.startAttempt(problemId);
      navigate(`/attempts/${attempt.id}`);
    } catch (err) {
      setStartError(err instanceof ApiError ? err.message : 'Could not start an attempt.');
      setStarting(false);
    }
  };

  if (loading) return <Loading label="Loading problem…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;
  if (!data) return null;

  const { problem, attempts } = data;
  const openDraft = attempts.find((entry) => entry.attempt.status === 'DRAFT');

  return (
    <main className="page">
      <div className="page-head">
        <div className="row">
          <Link to="/" className="tiny muted">
            ← All problems
          </Link>
        </div>
        <div className="row between">
          <h1>{problem.title}</h1>
          <div className="row">
            <Badge>{problem.difficulty}</Badge>
            <Badge>~{problem.estimatedMinutes} min</Badge>
          </div>
        </div>
        <p className="lede">{problem.tagline}</p>
      </div>

      <div className="stack">
        <section className="card">
          <div className="card-body">
            <p className="prose">{problem.statement}</p>
          </div>
          <div className="card-body">
            <div className="grid two">
              <div className="stack" style={{ gap: '0.5rem' }}>
                <h3>Functional requirements</h3>
                <ul className="small">
                  {problem.functionalRequirements.map((requirement) => (
                    <li key={requirement}>{requirement}</li>
                  ))}
                </ul>
              </div>
              <div className="stack" style={{ gap: '0.5rem' }}>
                <h3>Constraints</h3>
                <ul className="small">
                  {problem.constraints.map((constraint) => (
                    <li key={constraint}>{constraint}</li>
                  ))}
                </ul>
                <h3 style={{ marginTop: '0.5rem' }}>Edge cases worth covering</h3>
                <ul className="small">
                  {problem.edgeCases.map((edge) => (
                    <li key={edge}>{edge}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
          <div className="card-body">
            <h3>Decisions a strong answer resolves</h3>
            <div className="grid two" style={{ marginTop: '0.7rem' }}>
              {problem.designFocus.map((focus) => (
                <div key={focus.area} className="callout">
                  <div>
                    <strong>{focus.area}</strong>
                    <span className="small muted">{focus.question}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card pad">
          <div className="row between">
            <div>
              <h3>{openDraft ? 'You have a draft in progress' : 'Ready to design?'}</h3>
              <p className="small muted">
                {openDraft
                  ? `Attempt #${openDraft.attempt.attemptNumber} was last saved ${relativeTime(openDraft.attempt.updatedAt)}.`
                  : `You will fill in ${config.submissionSchema.sections.length} short sections. Nothing is scored until you submit.`}
              </p>
            </div>
            <button className="primary" onClick={start} disabled={starting}>
              {starting && <span className="spinner" aria-hidden />}
              {openDraft ? 'Resume draft' : `Start attempt #${attempts.length + 1}`}
            </button>
          </div>
          {startError && (
            <div className="callout danger" style={{ marginTop: '0.8rem' }}>
              <div>{startError}</div>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Your attempts</h2>
            <span className="spacer" />
            <span className="tiny subtle">{attempts.length} total</span>
          </div>
          {attempts.length === 0 ? (
            <EmptyState title="No attempts yet">
              Your attempts on this problem will appear here so you can compare them.
            </EmptyState>
          ) : (
            attempts.map((entry) => (
              <Link key={entry.attempt.id} to={`/attempts/${entry.attempt.id}`} className="history-row">
                <span className="n">#{entry.attempt.attemptNumber}</span>
                <span>
                  <div className="row" style={{ gap: '0.5rem' }}>
                    <StatusPill status={entry.attempt.status} />
                    <span className="tiny subtle">{relativeTime(entry.attempt.updatedAt)}</span>
                  </div>
                  {entry.evaluation && (
                    <p className="small muted" style={{ marginTop: '0.3rem' }}>
                      Focus next time: {entry.evaluation.nextFocus}
                    </p>
                  )}
                </span>
                <span className="row" style={{ gap: '0.5rem' }}>
                  {entry.comparison && <Delta value={entry.comparison.delta} />}
                  {entry.evaluation && <ScoreChip score={entry.evaluation.overall} band={entry.evaluation.band} />}
                </span>
              </Link>
            ))
          )}
        </section>
      </div>
    </main>
  );
}
