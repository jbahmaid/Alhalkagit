import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import type { ApiErrorBody } from '@sanad/shared';
import type { Response } from 'express';

const STATUS_CODES: Record<number, string> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Maps any thrown error to the uniform `{ statusCode, code, message, details? }` body. */
export function toApiError(exception: unknown): ApiErrorBody {
  if (exception instanceof ThrottlerException) {
    return { statusCode: 429, code: 'RATE_LIMITED', message: 'Too many requests' };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const res = exception.getResponse();
    if (typeof res === 'object' && res && 'code' in res) {
      const r = res as ApiErrorBody;
      return { statusCode: status, code: r.code, message: r.message ?? r.code, details: r.details };
    }
    const message =
      typeof res === 'string' ? res : ((res as { message?: string })?.message ?? exception.message);
    return {
      statusCode: status,
      code: STATUS_CODES[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'FORBIDDEN'),
      message: String(message),
    };
  }
  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    if (exception.code === 'P2002') return { statusCode: 409, code: 'CONFLICT', message: 'Duplicate value' };
    if (exception.code === 'P2025')
      return { statusCode: 404, code: 'NOT_FOUND', message: 'Record not found' };
  }
  if (isSystemAccountViolation(exception)) {
    return { statusCode: 403, code: 'SYSTEM_ACCOUNT_PROTECTED', message: 'The system account is protected' };
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Internal server error' };
}

/** The DB trigger protect_system_account() raises P0001 "System account ...". */
export function isSystemAccountViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /System account .* cannot be/i.test(msg);
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const body = toApiError(exception);
    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(body.statusCode).json(body);
  }
}
