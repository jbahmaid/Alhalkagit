import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@sanad/shared';

/**
 * Every expected error is thrown as an AppException carrying a stable code
 * (see packages/shared/src/errors.ts). The web app translates the code.
 */
export class AppException extends HttpException {
  constructor(
    public readonly code: ErrorCode,
    status: HttpStatus,
    public readonly details?: unknown,
    message?: string,
  ) {
    super({ statusCode: status, code, message: message ?? code, details }, status);
  }
}

export const Errors = {
  validation: (details: unknown) => new AppException('VALIDATION_FAILED', HttpStatus.BAD_REQUEST, details),
  unauthenticated: (code: ErrorCode = 'UNAUTHENTICATED') => new AppException(code, HttpStatus.UNAUTHORIZED),
  forbidden: (code: ErrorCode = 'FORBIDDEN', details?: unknown) =>
    new AppException(code, HttpStatus.FORBIDDEN, details),
  notFound: (code: ErrorCode = 'NOT_FOUND') => new AppException(code, HttpStatus.NOT_FOUND),
  conflict: (code: ErrorCode = 'CONFLICT', details?: unknown) =>
    new AppException(code, HttpStatus.CONFLICT, details),
  tooMany: (code: ErrorCode = 'RATE_LIMITED', details?: unknown) =>
    new AppException(code, HttpStatus.TOO_MANY_REQUESTS, details),
  badRequest: (code: ErrorCode, details?: unknown) => new AppException(code, HttpStatus.BAD_REQUEST, details),
};
