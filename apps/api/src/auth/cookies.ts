import { REFRESH_COOKIE, SESSION_HINT_COOKIE } from '@sanad/shared';
import type { CookieOptions, Response } from 'express';

/** The refresh cookie only travels to the auth endpoints (through the web proxy at /api). */
export const REFRESH_COOKIE_PATH = '/api/auth';

function base(secure: boolean): CookieOptions {
  return { sameSite: 'lax', secure };
}

export function setSessionCookies(
  res: Response,
  opts: { refreshToken: string; expiresAt: Date; role: string; secure: boolean },
): void {
  res.cookie(REFRESH_COOKIE, opts.refreshToken, {
    ...base(opts.secure),
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    expires: opts.expiresAt,
  });
  // Hint for the web app's route guards (no secret inside; the API re-checks everything).
  res.cookie(SESSION_HINT_COOKIE, opts.role, {
    ...base(opts.secure),
    httpOnly: false,
    path: '/',
    expires: opts.expiresAt,
  });
}

export function clearSessionCookies(res: Response, secure: boolean): void {
  res.clearCookie(REFRESH_COOKIE, { ...base(secure), httpOnly: true, path: REFRESH_COOKIE_PATH });
  res.clearCookie(SESSION_HINT_COOKIE, { ...base(secure), path: '/' });
}
