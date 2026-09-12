import { useEffect, useMemo, useRef, useState } from 'react';
import { useConfig } from '../App';
import { ApiError, api } from '../api/client';
import type { Attempt, ProblemDetail, StructuralReport } from '../api/types';
import { Callout, CheckRow } from '../components/ui';
import { DEMO_ANSWERS } from '../demoAnswers';
import { useDebounced } from '../hooks';

function wordCount(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * The design workspace.
 *
 * Three deliberate choices:
 *  - the form is generated from the schema the API serves, so the sections the
 *    learner fills in are exactly the ones the rubric reads;
 *  - drafts autosave, because losing a half-written design is the fastest way
 *    to stop someone practising;
 *  - the structural check is a separate, free action, so the learner can fix
 *    the mechanical problems before spending an evaluation.
 */
export function Workspace({
  attempt,
  problem,
  onSubmitted,
}: {
  attempt: Attempt;
  problem: ProblemDetail;
  onSubmitted: () => void;
}) {
  const config = useConfig();
  const specs = config.submissionSchema.sections;

  const [sections, setSections] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const spec of specs) initial[spec.key] = attempt.content.sections?.[spec.key] ?? '';
    return initial;
  });
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [report, setReport] = useState<StructuralReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showRubric, setShowRubric] = useState(false);

  const debounced = useDebounced(sections, 800);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    let cancelled = false;
    setSaveState('saving');
    api
      .saveDraft(attempt.id, debounced)
      .then(() => !cancelled && setSaveState('saved'))
      .catch(() => !cancelled && setSaveState('error'));
    return () => {
      cancelled = true;
    };
  }, [debounced, attempt.id]);

  const totalWords = useMemo(() => Object.values(sections).reduce((sum, text) => sum + wordCount(text), 0), [sections]);
  const requiredDone = specs.filter((s) => s.required && wordCount(sections[s.key] ?? '') >= s.minWords).length;
  const requiredTotal = specs.filter((s) => s.required).length;
  const examples = DEMO_ANSWERS[problem.id] ?? [];

  const runCheck = async () => {
    setChecking(true);
    setSubmitError(null);
    try {
      setReport(await api.structuralCheck(attempt.id, sections));
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not run the check.');
    } finally {
      setChecking(false);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await api.submit(attempt.id, sections);
      setReport(result.structural);
      onSubmitted();
    } catch (err) {
      if (err instanceof ApiError) {
        setSubmitError(err.message);
        const checks = (err.details.checks as StructuralReport['checks']) ?? null;
        if (checks) setReport({ isSubmittable: false, passed: 0, total: checks.length, checks });
      } else {
        setSubmitError('Could not submit.');
      }
      setSubmitting(false);
    }
  };

  return (
    <div className="workspace">
      <div className="stack">
        {attempt.carriedFocus && (
          <Callout tone="accent" title={`Carried over from attempt #${attempt.attemptNumber - 1}`}>
            {attempt.carriedFocus}
          </Callout>
        )}

        <section className="card">
          <div className="card-head">
            <h2>Your design</h2>
            <span className="spacer" />
            <span className="tiny subtle">
              {saveState === 'saving' && 'Saving…'}
              {saveState === 'saved' && 'Draft saved'}
              {saveState === 'error' && 'Could not save draft'}
              {saveState === 'idle' && 'Autosaves as you type'}
            </span>
          </div>

          {examples.length > 0 && (
            <div className="card-body" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <span className="tiny subtle" style={{ alignSelf: 'center' }}>
                Demo shortcut:
              </span>
              {examples.map((example) => (
                <button
                  key={example.label}
                  className="small"
                  title={example.hint}
                  onClick={() => setSections({ ...sections, ...example.sections })}
                >
                  {example.label}
                </button>
              ))}
            </div>
          )}

          {specs.map((spec) => {
            const value = sections[spec.key] ?? '';
            const words = wordCount(value);
            const short = spec.required && words > 0 && words < spec.minWords;
            return (
              <div key={spec.key} className={`section-field ${short ? 'attention' : ''}`}>
                <label htmlFor={`field-${spec.key}`}>
                  {spec.title}
                  {!spec.required && <span className="subtle small"> · optional</span>}
                </label>
                <p className="helper">{spec.helper}</p>
                <textarea
                  id={`field-${spec.key}`}
                  value={value}
                  placeholder={spec.placeholder}
                  spellCheck={false}
                  onChange={(event) => setSections({ ...sections, [spec.key]: event.target.value })}
                />
                <div className="meta">
                  <span>{spec.feeds.map((key) => criterionTitle(config, key)).join(' · ')}</span>
                  <span>
                    {words} {words === 1 ? 'word' : 'words'}
                    {spec.required && spec.minWords > 0 && ` / ${spec.minWords} min`}
                  </span>
                </div>
              </div>
            );
          })}
        </section>
      </div>

      <aside className="aside">
        <section className="card pad stack" style={{ gap: '0.8rem' }}>
          <div>
            <h3>Ready to submit?</h3>
            <p className="small muted">
              {requiredDone}/{requiredTotal} required sections complete · {totalWords} words
            </p>
          </div>

          <button onClick={runCheck} disabled={checking}>
            {checking && <span className="spinner" aria-hidden />}
            Run structural check
          </button>

          <button className="primary" onClick={submit} disabled={submitting}>
            {submitting && <span className="spinner" aria-hidden />}
            Submit for evaluation
          </button>

          <p className="tiny subtle">
            The structural check is deterministic and free. Submitting sends your design to{' '}
            {config.evaluation.label} for the judgement criteria.
          </p>

          {submitError && (
            <div className="callout danger">
              <div>{submitError}</div>
            </div>
          )}
        </section>

        {report && (
          <section className="card pad stack" style={{ gap: '0.7rem' }}>
            <div className="row between">
              <h3>Structural checks</h3>
              <span className={`badge ${report.isSubmittable ? 'ok' : 'danger'}`}>
                {report.checks.filter((c) => c.status === 'pass').length}/{report.checks.length} pass
              </span>
            </div>
            <div className="checklist">
              {report.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </div>
          </section>
        )}

        <section className="card pad stack" style={{ gap: '0.6rem' }}>
          <button className="ghost small" onClick={() => setShowRubric((v) => !v)} style={{ justifyContent: 'space-between' }}>
            <span>How this will be scored</span>
            <span aria-hidden>{showRubric ? '−' : '+'}</span>
          </button>
          {showRubric && (
            <div className="stack" style={{ gap: '0.6rem' }}>
              {config.rubric.criteria.map((criterion) => (
                <div key={criterion.key}>
                  <div className="row between">
                    <strong className="small">{criterion.title}</strong>
                    <span className="tiny subtle">weight {criterion.weight}</span>
                  </div>
                  <p className="tiny muted">{criterion.question}</p>
                </div>
              ))}
              <p className="tiny subtle">
                Rubric {config.rubric.version}. Overall score is the weighted mean of these criteria, computed by the
                platform — not by the evaluator.
              </p>
            </div>
          )}
        </section>

        <section className="card pad stack" style={{ gap: '0.4rem' }}>
          <h3 className="small">Extensibility probe</h3>
          <p className="tiny muted">{problem.extensibilityProbe}</p>
          <p className="tiny subtle">Your trade-offs section is the natural place to answer this.</p>
        </section>
      </aside>
    </div>
  );
}

function criterionTitle(config: ReturnType<typeof useConfig>, key: string): string {
  return config.rubric.criteria.find((c) => c.key === key)?.title ?? key;
}
