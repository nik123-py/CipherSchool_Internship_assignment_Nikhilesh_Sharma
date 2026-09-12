import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Attempt, Comparison, CriterionResult, Evaluation, ProblemDetail } from '../api/types';
import { Badge, Callout, CheckRow, Delta, Meter, ScoreChip } from '../components/ui';

/**
 * Feedback is the point of the product, so this screen is built to be *read*,
 * in this order: what happened, what to fix first, then the evidence for every
 * criterion. Scores are never shown without the quote they rest on.
 */
export function FeedbackView({
  attempt,
  problem,
  evaluation,
  comparison,
  onTryAgain,
  startingNext,
}: {
  attempt: Attempt;
  problem: ProblemDetail;
  evaluation: Evaluation;
  comparison: Comparison | null;
  onTryAgain: () => void;
  startingNext: boolean;
}) {
  const [showDesign, setShowDesign] = useState(false);
  const structuralIssues = evaluation.structuralChecks.filter((c) => c.status !== 'pass');

  return (
    <div className="stack">
      <section className="card">
        <div className="card-body">
          <div className="overall">
            <div className={`score-orb ${evaluation.band}`}>
              {evaluation.overall.toFixed(1)}
              <small>out of 10</small>
            </div>
            <div className="stack" style={{ gap: '0.5rem', flex: 1, minWidth: '260px' }}>
              <div className="row">
                <Badge tone={evaluation.evaluator.kind === 'llm' ? 'accent' : 'warn'}>
                  {evaluation.evaluator.label}
                </Badge>
                <Badge>rubric {evaluation.rubricVersion}</Badge>
                <Badge>{(evaluation.durationMs / 1000).toFixed(1)}s</Badge>
              </div>
              <p className="prose">{evaluation.summary}</p>
              {comparison && (
                <p className="small muted">
                  Attempt #{comparison.previousAttemptNumber} scored {comparison.previousOverall.toFixed(1)} · this
                  attempt <Delta value={comparison.delta} />
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="card-body">
          <div className="grid two">
            <div className="stack" style={{ gap: '0.5rem' }}>
              <span className="eyebrow">What is working</span>
              {evaluation.strengths.length === 0 ? (
                <p className="small muted">
                  Nothing scored above 6.5 yet. That is normal on a first attempt — pick the top priority and go again.
                </p>
              ) : (
                <ul className="small">
                  {evaluation.strengths.map((strength) => (
                    <li key={strength.key}>
                      <strong>{strength.title}</strong> ({strength.score.toFixed(1)}) — {strength.evidence}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="stack" style={{ gap: '0.5rem' }}>
              <span className="eyebrow">Fix these first</span>
              <ul className="small">
                {evaluation.priorities.map((priority) => (
                  <li key={priority.key}>
                    <strong>{priority.title}</strong> ({priority.score.toFixed(1)}) — {priority.suggestion}
                  </li>
                ))}
              </ul>
              <p className="tiny subtle">
                Ranked by how much overall score each one can recover (criterion weight × remaining head-room).
              </p>
            </div>
          </div>
        </div>

        <div className="card-body">
          <Callout tone="accent" title="Focus for your next attempt">
            {evaluation.nextFocus}
          </Callout>
          <div className="row" style={{ marginTop: '0.9rem' }}>
            <button className="primary" onClick={onTryAgain} disabled={startingNext}>
              {startingNext && <span className="spinner" aria-hidden />}
              Try again — attempt #{attempt.attemptNumber + 1}
            </button>
            <Link className="btn" to={`/problems/${problem.id}`}>
              Back to problem
            </Link>
            <button className="ghost small" onClick={() => setShowDesign((v) => !v)}>
              {showDesign ? 'Hide what I submitted' : 'Show what I submitted'}
            </button>
          </div>
        </div>
      </section>

      {comparison && (comparison.improved.length > 0 || comparison.regressed.length > 0) && (
        <section className="card pad stack" style={{ gap: '0.7rem' }}>
          <h2>Since attempt #{comparison.previousAttemptNumber}</h2>
          <div className="grid two">
            <div className="stack" style={{ gap: '0.4rem' }}>
              <span className="eyebrow">Improved</span>
              {comparison.improved.length === 0 ? (
                <p className="small muted">No criterion improved this time.</p>
              ) : (
                comparison.improved.map((delta) => (
                  <div key={delta.criterionKey} className="row between small">
                    <span>{delta.title}</span>
                    <span>
                      {delta.previous.toFixed(1)} → {delta.current.toFixed(1)} <Delta value={delta.delta} />
                    </span>
                  </div>
                ))
              )}
            </div>
            <div className="stack" style={{ gap: '0.4rem' }}>
              <span className="eyebrow">Slipped</span>
              {comparison.regressed.length === 0 ? (
                <p className="small muted">Nothing regressed.</p>
              ) : (
                comparison.regressed.map((delta) => (
                  <div key={delta.criterionKey} className="row between small">
                    <span>{delta.title}</span>
                    <span>
                      {delta.previous.toFixed(1)} → {delta.current.toFixed(1)} <Delta value={delta.delta} />
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
          {comparison.focusFollowUp?.delta !== undefined && (
            <Callout tone={comparison.focusFollowUp.delta > 0 ? 'ok' : 'warn'}>
              You were asked to work on this, and that criterion moved by{' '}
              <Delta value={comparison.focusFollowUp.delta} />.
            </Callout>
          )}
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Criterion by criterion</h2>
          <span className="spacer" />
          {evaluation.ungroundedCount > 0 && (
            <Badge tone="warn">{evaluation.ungroundedCount} unverified quote(s)</Badge>
          )}
        </div>
        {evaluation.criteria.map((criterion) => (
          <CriterionCard key={criterion.key} criterion={criterion} />
        ))}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Structural checks</h2>
          <span className="spacer" />
          <span className="tiny subtle">Deterministic · no AI involved</span>
        </div>
        <div className="card-body">
          <p className="small muted" style={{ marginBottom: '0.7rem' }}>
            {structuralIssues.length === 0
              ? 'Every mechanical check passed, so the judgement above is about the design itself.'
              : `${structuralIssues.length} check(s) flagged something you can fix without any judgement call.`}
          </p>
          <div className="checklist">
            {evaluation.structuralChecks.map((check) => (
              <CheckRow key={check.id} check={check} />
            ))}
          </div>
        </div>
      </section>

      {showDesign && (
        <section className="card">
          <div className="card-head">
            <h2>What you submitted</h2>
          </div>
          {Object.entries(attempt.content.sections ?? {}).map(([key, value]) => (
            <div key={key} className="card-body">
              <span className="eyebrow">{key.replace(/_/g, ' ')}</span>
              <p className="prose small" style={{ marginTop: '0.35rem' }}>
                {value || <span className="subtle">(empty)</span>}
              </p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function CriterionCard({ criterion }: { criterion: CriterionResult }) {
  return (
    <article className="criterion">
      <header>
        <h3>{criterion.title}</h3>
        <span className="tiny subtle">weight {criterion.weight}</span>
        <ScoreChip score={criterion.score} band={criterion.band} />
      </header>
      <Meter score={criterion.score} band={criterion.band} />
      <p className="question">{criterion.question}</p>

      <dl className="stack" style={{ gap: '0.6rem' }}>
        <div className="finding">
          <dt>Evidence</dt>
          <dd>
            <blockquote className={`evidence ${criterion.grounded ? '' : 'ungrounded'}`}>{criterion.evidence}</blockquote>
            <p className="tiny subtle" style={{ marginTop: '0.3rem' }}>
              {criterion.evidenceSectionTitle ? `From: ${criterion.evidenceSectionTitle}` : 'From your submission'}
              {!criterion.grounded && ' · could not be matched to your text, so treat it with caution'}
            </p>
          </dd>
        </div>
        <div className="finding">
          <dt>Concern</dt>
          <dd className="small">{criterion.concern}</dd>
        </div>
        <div className="finding">
          <dt>Do next</dt>
          <dd className="small">{criterion.suggestion}</dd>
        </div>
        <div className="finding">
          <dt>Confidence</dt>
          <dd>
            <Badge tone={criterion.confidence === 'high' ? 'ok' : criterion.confidence === 'medium' ? 'neutral' : 'warn'}>
              {criterion.confidence}
            </Badge>
          </dd>
        </div>
      </dl>
    </article>
  );
}
