import type { ReactNode } from 'react';
import type { AttemptStatus, Band, CheckStatus, StructuralCheck } from '../api/types';

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  return <span className={`badge ${tone === 'neutral' ? '' : tone}`}>{children}</span>;
}

const STATUS_COPY: Record<AttemptStatus, { label: string; tone: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'accent' },
  EVALUATING: { label: 'Evaluating', tone: 'accent' },
  COMPLETED: { label: 'Feedback ready', tone: 'ok' },
  FAILED: { label: 'Evaluation failed', tone: 'danger' },
};

export function StatusPill({ status }: { status: AttemptStatus }) {
  const { label, tone } = STATUS_COPY[status];
  const pending = status === 'SUBMITTED' || status === 'EVALUATING';
  return (
    <Badge tone={tone}>
      <span className={`dot ${pending ? 'pulse' : ''}`} aria-hidden />
      {label}
    </Badge>
  );
}

export function ScoreChip({ score, band }: { score: number; band: Band }) {
  return (
    <span className={`score-chip ${band}`} title={`${band} (${score.toFixed(1)} out of 10)`}>
      {score.toFixed(1)}/10
    </span>
  );
}

export function Meter({ score, band }: { score: number; band: Band }) {
  return (
    <div className={`meter ${band}`} role="img" aria-label={`Score ${score.toFixed(1)} out of 10`}>
      <span style={{ width: `${Math.max(3, score * 10)}%` }} />
    </div>
  );
}

export function Delta({ value, suffix = '' }: { value: number; suffix?: string }) {
  const tone = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  const sign = value > 0 ? '+' : '';
  return (
    <span className={`delta ${tone}`}>
      {sign}
      {value.toFixed(1)}
      {suffix}
    </span>
  );
}

const CHECK_ICON: Record<CheckStatus, string> = { pass: '✓', warn: '!', fail: '×' };

export function CheckRow({ check }: { check: StructuralCheck }) {
  return (
    <div className={`check ${check.status}`}>
      <span className="icon" aria-hidden>
        {CHECK_ICON[check.status]}
      </span>
      <span>
        <span>{check.title}</span>
        {check.status !== 'pass' && <span className="detail"> — {check.detail}</span>}
      </span>
    </div>
  );
}

export function Callout({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger';
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className={`callout ${tone === 'neutral' ? '' : tone}`}>
      <div>
        {title && <strong>{title}</strong>}
        <span>{children}</span>
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p className="small">{children}</p>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="empty">
      <div className="spinner" aria-hidden />
      <p className="small">{label}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty">
      <h3>Something went wrong</h3>
      <p className="small">{message}</p>
      {onRetry && (
        <button className="small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: string }) {
  return <div className="skeleton" style={{ height, width }} />;
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
