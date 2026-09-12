import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import type { AttemptDetail, ProblemDetail } from '../api/types';
import { Badge, Callout, ErrorState, Loading, StatusPill } from '../components/ui';
import { useAsync, usePolling } from '../hooks';
import { FeedbackView } from './FeedbackView';
import { Workspace } from './Workspace';

/**
 * One route for the whole attempt, rendered by its status.
 *
 * The URL does not change between designing, waiting and reading feedback, so
 * a learner can refresh or share the link at any point and land where they
 * were. The screen follows the domain state machine exactly - which is also
 * the easiest way to see that machine working during a demo.
 */
export function AttemptPage() {
  const { attemptId = '' } = useParams();
  const navigate = useNavigate();
  const [startingNext, setStartingNext] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const attemptState = useAsync<AttemptDetail>(() => api.attempt(attemptId), [attemptId]);
  const problemId = attemptState.data?.problem.id;
  const problemState = useAsync<{ problem: ProblemDetail }>(
    () => (problemId ? api.problem(problemId) : Promise.reject(new Error('no problem'))),
    [problemId],
  );

  const status = attemptState.data?.attempt.status;
  const pending = status === 'SUBMITTED' || status === 'EVALUATING';

  // While an evaluation is running the server is the source of truth; poll it.
  usePolling(pending, 1200, attemptState.reload);

  if (attemptState.loading && !attemptState.data) return <Loading label="Loading attempt…" />;
  if (attemptState.error) return <ErrorState message={attemptState.error} onRetry={attemptState.reload} />;
  if (!attemptState.data || !problemState.data) return <Loading label="Loading problem…" />;

  const { attempt, evaluationDetail, comparison } = attemptState.data;
  const { problem } = problemState.data;

  const tryAgain = async () => {
    setStartingNext(true);
    setActionError(null);
    try {
      const { attempt: next } = await api.startAttempt(problem.id);
      navigate(`/attempts/${next.id}`);
      setStartingNext(false);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not start the next attempt.');
      setStartingNext(false);
    }
  };

  const retryEvaluation = async () => {
    setActionError(null);
    try {
      await api.retryEvaluation(attempt.id);
      attemptState.reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not retry the evaluation.');
    }
  };

  return (
    <main className="page wide">
      <div className="page-head">
        <div className="row">
          <Link to={`/problems/${problem.id}`} className="tiny muted">
            ← {problem.title}
          </Link>
        </div>
        <div className="row between">
          <h1>
            {problem.title} · Attempt #{attempt.attemptNumber}
          </h1>
          <div className="row">
            <StatusPill status={attempt.status} />
            <Badge>{attempt.format}</Badge>
          </div>
        </div>
      </div>

      {actionError && (
        <div style={{ marginBottom: '1rem' }}>
          <Callout tone="danger">{actionError}</Callout>
        </div>
      )}

      {attempt.status === 'DRAFT' && (
        <Workspace attempt={attempt} problem={problem} onSubmitted={attemptState.reload} />
      )}

      {pending && (
        <section className="card pad stack" style={{ gap: '0.9rem' }}>
          <div className="row">
            <span className="spinner" aria-hidden />
            <h2>{attempt.status === 'SUBMITTED' ? 'Queued for evaluation' : 'Evaluating your design'}</h2>
          </div>
          <p className="muted">
            Your submission is already saved, so nothing is lost if the evaluator is slow or fails. This page updates
            itself.
          </p>
          <ol className="small muted">
            <li>
              <strong>Submitted</strong> — design frozen and stored
            </li>
            <li>
              <strong>{attempt.status === 'EVALUATING' ? 'Evaluating' : 'Evaluating'}</strong> — rubric criteria being
              judged
            </li>
            <li>Feedback ready</li>
          </ol>
          <div className="stack" style={{ gap: '0.5rem' }}>
            <div className="skeleton" style={{ height: 14, width: '75%' }} />
            <div className="skeleton" style={{ height: 14, width: '60%' }} />
            <div className="skeleton" style={{ height: 14, width: '68%' }} />
          </div>
        </section>
      )}

      {attempt.status === 'FAILED' && (
        <section className="card pad stack" style={{ gap: '0.9rem' }}>
          <h2>The evaluation did not finish</h2>
          <Callout tone="danger" title="What happened">
            {attempt.failure?.reason ?? 'The evaluator failed.'}
          </Callout>
          <p className="muted">
            Your design is safe — it was stored before evaluation started, and nothing about it changed. Attempt{' '}
            #{attempt.attemptNumber} is still yours; you can retry the evaluation as many times as you need.
          </p>
          <div className="row">
            <button className="primary" onClick={retryEvaluation} disabled={!attempt.canRetryEvaluation}>
              Retry evaluation
            </button>
            <Link className="btn" to={`/problems/${problem.id}`}>
              Back to problem
            </Link>
          </div>
          {attempt.failureCount > 1 && (
            <p className="tiny subtle">
              Failed {attempt.failureCount} times. If it keeps failing, switch to the offline evaluator with
              EVALUATOR=heuristic and restart the server.
            </p>
          )}
        </section>
      )}

      {attempt.status === 'COMPLETED' && evaluationDetail && (
        <FeedbackView
          attempt={attempt}
          problem={problem}
          evaluation={evaluationDetail}
          comparison={comparison}
          onTryAgain={tryAgain}
          startingNext={startingNext}
        />
      )}
    </main>
  );
}
