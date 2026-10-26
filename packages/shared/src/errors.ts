/**
 * Stable error codes returned by the API as `{ statusCode, code, message, details? }`.
 * The web app translates them with the `errors.<CODE>` keys in messages/{ar,en}.json.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'CONFLICT',
  'FORBIDDEN',
  'UNAUTHENTICATED',
  'INTERNAL_ERROR',
  'API_UNAVAILABLE',
  'AUTH_INVALID_CREDENTIALS',
  'AUTH_ACCOUNT_LOCKED',
  'AUTH_ACCOUNT_SUSPENDED',
  'AUTH_EMAIL_NOT_VERIFIED',
  'AUTH_EMAIL_TAKEN',
  'AUTH_TOKEN_INVALID',
  'AUTH_TOKEN_EXPIRED',
  'AUTH_REFRESH_INVALID',
  'AUTH_REFRESH_REUSED',
  'AUTH_REFRESH_RACE',
  'AUTH_CODE_INVALID',
  'AUTH_CODE_EXPIRED',
  'AUTH_CODE_TOO_MANY_ATTEMPTS',
  'AUTH_RESEND_COOLDOWN',
  'AUTH_ALREADY_VERIFIED',
  'AUTH_CONSENT_REQUIRED',
  'AUTH_WRONG_PASSWORD',
  'AUTH_PASSWORD_REUSED',
  'PASSWORD_CHANGE_REQUIRED',
  'PASSWORD_POLICY',
  'PERMISSION_DENIED',
  'SYSTEM_ACCOUNT_PROTECTED',
  'RAW_WRITE_FORBIDDEN',
  'LOOKUP_TYPE_UNKNOWN',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  statusCode: number;
  code: ErrorCode | string;
  message: string;
  details?: unknown;
}

/** One entry per invalid field when code === 'VALIDATION_FAILED'. */
export interface FieldErrorDetail {
  field: string;
  /** e.g. ['isEmail'], ['PASSWORD_POLICY'] */
  errors: string[];
}
