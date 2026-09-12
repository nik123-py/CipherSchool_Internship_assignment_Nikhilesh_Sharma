import type {
  AppConfig,
  Attempt,
  AttemptDetail,
  HistoryEntry,
  ProblemDetail,
  ProblemSummary,
  StructuralReport,
} from './types';

/**
 * There is no login in this MVP. A learner is a random id kept in localStorage
 * and sent as a header, which is enough to make attempt history real without
 * building an account system the product does not need yet.
 */
const LEARNER_KEY = 'lld.learnerId';

export function learnerId(): string {
  let id = localStorage.getItem(LEARNER_KEY);
  if (!id) {
    id = `learner_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(LEARNER_KEY, id);
  }
  return id;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

// In production the Vite proxy is not available, so we read the Railway API
// base URL from the build-time env variable. In development this is an empty
// string and the Vite proxy forwards /api → localhost:4000 as before.
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        'x-learner-id': learnerId(),
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check that the API is reachable.');
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } })
      .error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN',
      error?.message ?? `Request failed with status ${response.status}.`,
      error?.details ?? {},
    );
  }
  return payload as T;
}

export const api = {
  config: () => call<AppConfig>('/config'),

  problems: () => call<{ problems: ProblemSummary[] }>('/problems'),

  problem: (id: string) => call<{ problem: ProblemDetail; attempts: HistoryEntry[] }>(`/problems/${id}`),

  startAttempt: (problemId: string) =>
    call<{ attempt: Attempt; resumed: boolean }>('/attempts', {
      method: 'POST',
      body: JSON.stringify({ problemId }),
    }),

  attempt: (id: string) => call<AttemptDetail>(`/attempts/${id}`),

  history: (problemId?: string) =>
    call<{ attempts: HistoryEntry[] }>(`/attempts${problemId ? `?problemId=${encodeURIComponent(problemId)}` : ''}`),

  saveDraft: (id: string, sections: Record<string, string>) =>
    call<{ attempt: Attempt; savedAt: string }>(`/attempts/${id}/draft`, {
      method: 'PATCH',
      body: JSON.stringify({ sections }),
    }),

  structuralCheck: (id: string, sections: Record<string, string>) =>
    call<StructuralReport>(`/attempts/${id}/structural-check`, {
      method: 'POST',
      body: JSON.stringify({ sections }),
    }),

  submit: (id: string, sections: Record<string, string>) =>
    call<{ attempt: Attempt; outcome: string; structural: StructuralReport }>(`/attempts/${id}/submission`, {
      method: 'POST',
      body: JSON.stringify({ sections }),
    }),

  retryEvaluation: (id: string) =>
    call<{ attempt: Attempt }>(`/attempts/${id}/evaluation/retry`, { method: 'POST' }),
};
