'use client';

import type { ApiErrorBody, FieldErrorDetail } from '@sanad/shared';
import { getAccessToken, refreshSession } from './auth-store';

/** Error thrown for any non-2xx answer. `code` is translated with t(`errors.${code}`). */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(code);
  }

  /** Field-level problems when code === 'VALIDATION_FAILED'. */
  get fieldErrors(): FieldErrorDetail[] {
    return this.code === 'VALIDATION_FAILED' && Array.isArray(this.details)
      ? (this.details as FieldErrorDetail[])
      : [];
  }
}

type Options = { method?: string; body?: unknown; auth?: boolean; signal?: AbortSignal };

async function send(path: string, opts: Options, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  try {
    return await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK');
  }
}

/**
 * Calls the API through the same-origin proxy (/api/*). With `auth` (default), the in-memory
 * access token is attached and, if it expired, refreshed once via the HttpOnly cookie.
 */
export async function api<T>(path: string, opts: Options = {}): Promise<T> {
  const useAuth = opts.auth !== false;
  let res = await send(path, opts, useAuth ? getAccessToken() : null);
  if (useAuth && res.status === 401) {
    const refreshed = await refreshSession();
    if (refreshed) res = await send(path, opts, getAccessToken());
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      res.status,
      err.code ?? (res.status >= 500 ? 'INTERNAL_ERROR' : 'FORBIDDEN'),
      err.details,
    );
  }
  return body as T;
}
