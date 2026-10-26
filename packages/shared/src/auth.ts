import type { Locale } from './locale';
import type { UserRole, UserStatus } from './roles';

/** One-time codes (email verification, password reset). */
export const OTP_LENGTH = 6;
export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECONDS = 60;

/** Login lockout after repeated failures. */
export const LOGIN_MAX_FAILED_ATTEMPTS = 5;
export const LOGIN_LOCK_MINUTES = 15;

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 7;

/** Cookie names. The refresh cookie is HttpOnly and scoped to /api/auth. */
export const REFRESH_COOKIE = 'sanad_rt';
/** Non-sensitive hint cookie (path /) telling the web app a session may exist. No token inside. */
export const SESSION_HINT_COOKIE = 'sanad_session';

/** Response of GET /api/me (and embedded in login/refresh/verify responses). */
export interface MeDto {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
  role: UserRole;
  status: UserStatus;
  locale: Locale;
  mustChangePassword: boolean;
  isSystemAccount: boolean;
  permissions: string[];
}

export interface SessionDto {
  accessToken: string;
  expiresIn: number;
  user: MeDto;
}

/** POST /api/auth/refresh never answers 401 (avoids console noise); it returns this instead. */
export type RefreshResultDto =
  | ({ authenticated: true } & SessionDto)
  | { authenticated: false; code: string };

export interface PendingVerificationDto {
  email: string;
  /** Seconds before another code can be requested. */
  resendAvailableIn: number;
}
