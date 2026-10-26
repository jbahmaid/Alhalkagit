'use client';

import { SESSION_HINT_COOKIE, type MeDto, type RefreshResultDto, type SessionDto } from '@sanad/shared';

/**
 * Session state lives in memory only: the access token is never written to storage. The HttpOnly
 * refresh cookie restores it after a reload (silent refresh).
 */
export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';
export interface AuthState {
  status: AuthStatus;
  user: MeDto | null;
}

let state: AuthState = { status: 'loading', user: null };
let accessToken: string | null = null;
const listeners = new Set<() => void>();

function emit(next: AuthState) {
  state = next;
  listeners.forEach((l) => l());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getState = (): AuthState => state;
export const getServerState = (): AuthState => ({ status: 'loading', user: null });
export const getAccessToken = (): string | null => accessToken;

export function setSession(session: SessionDto): void {
  accessToken = session.accessToken;
  emit({ status: 'authenticated', user: session.user });
}

export function setUser(user: MeDto): void {
  emit({ status: state.status, user });
}

export function clearSession(): void {
  accessToken = null;
  emit({ status: 'anonymous', user: null });
}

export function hasSessionHint(): boolean {
  return (
    typeof document !== 'undefined' &&
    document.cookie.split('; ').some((c) => c.startsWith(`${SESSION_HINT_COOKIE}=`))
  );
}

let inflight: Promise<boolean> | null = null;

/** Single-flight silent refresh. Resolves true when a session is active afterwards. */
export function refreshSession(): Promise<boolean> {
  inflight ??= (async () => {
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
        if (!res.ok) break;
        const body = (await res.json()) as RefreshResultDto;
        if (body.authenticated) {
          setSession(body);
          return true;
        }
        // Another tab rotated the token a moment ago: its new cookie arrives shortly.
        if (body.code === 'AUTH_REFRESH_RACE') {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
        break;
      }
    } catch {
      // network error: treat as signed out
    }
    clearSession();
    return false;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** Called once on app start. */
export async function initAuth(): Promise<void> {
  if (state.status !== 'loading') return;
  if (!hasSessionHint()) {
    clearSession();
    return;
  }
  await refreshSession();
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  } finally {
    clearSession();
  }
}
