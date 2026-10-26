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

function xhrUpload(
  path: string,
  form: FormData,
  token: string | null,
  onProgress?: (fraction: number) => void,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api${path}`);
    xhr.setRequestHeader('accept', 'application/json');
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        body = null;
      }
      resolve({ status: xhr.status, body });
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK'));
    xhr.onabort = () => reject(new ApiError(0, 'NETWORK'));
    xhr.send(form);
  });
}

/**
 * Multipart upload through the same-origin proxy, with upload progress (fetch has none).
 * Refreshes the access token once on 401, like `api`.
 */
export async function upload<T>(
  path: string,
  form: FormData,
  onProgress?: (fraction: number) => void,
): Promise<T> {
  let res = await xhrUpload(path, form, getAccessToken(), onProgress);
  if (res.status === 401 && (await refreshSession())) {
    res = await xhrUpload(path, form, getAccessToken(), onProgress);
  }
  if (res.status >= 200 && res.status < 300) return res.body as T;
  const err = (res.body ?? {}) as Partial<ApiErrorBody>;
  const fallback = res.status === 413 ? 'FILE_TOO_LARGE' : res.status >= 500 ? 'INTERNAL_ERROR' : 'FORBIDDEN';
  throw new ApiError(res.status, err.code ?? fallback, err.details);
}

/**
 * POSTs to an endpoint that answers with a file (the Excel export) and saves it through a
 * temporary object URL. Errors come back as JSON and are thrown as ApiError, like `api`.
 */
export async function download(path: string, body: unknown, fallbackName: string): Promise<void> {
  let res = await send(path, { method: 'POST', body }, getAccessToken());
  if (res.status === 401 && (await refreshSession()))
    res = await send(path, { method: 'POST', body }, getAccessToken());
  if (!res.ok) {
    const err = ((await res.json().catch(() => null)) ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(
      res.status,
      err.code ?? (res.status >= 500 ? 'INTERNAL_ERROR' : 'FORBIDDEN'),
      err.details,
    );
  }
  const blob = await res.blob();
  const disposition = res.headers.get('content-disposition') ?? '';
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
