import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
  setData: (value: T) => void;
}

/** Minimal data-fetching hook: enough for six screens, no library needed. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    loader()
      .then((value) => {
        if (!alive.current) return;
        setData(value);
        setError(null);
      })
      .catch((err: Error) => {
        if (!alive.current) return;
        setError(err.message);
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []), setData };
}

/** Runs `tick` on an interval while `active` is true. Used to poll attempt status. */
export function usePolling(active: boolean, intervalMs: number, tick: () => void): void {
  const saved = useRef(tick);
  saved.current = tick;

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => saved.current(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
}

/** Debounced value, used for draft autosave. */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
