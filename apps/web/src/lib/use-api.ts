'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';

/**
 * GET a resource once the component mounts (and again when `path` changes), with a reload.
 * `path` null skips the request. `error` is the ApiError code, for a translated message.
 */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (path === null) return;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    api<T>(path, { signal: ctrl.signal })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if ((err as Error).name === 'AbortError') return;
        setError(err instanceof ApiError ? err.code : 'INTERNAL_ERROR');
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [path, tick]);

  return { data, setData, error, loading, reload };
}
