import { ValidationError, ValidationPipe } from '@nestjs/common';
import type { FieldErrorDetail } from '@sanad/shared';
import { Errors } from './app-exception';

function flatten(errors: ValidationError[], parent = ''): FieldErrorDetail[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own: FieldErrorDetail[] = e.constraints ? [{ field, errors: Object.keys(e.constraints) }] : [];
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/** Global pipe: strips unknown fields is not enough, unknown fields are rejected. */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    stopAtFirstError: false,
    exceptionFactory: (errors) => Errors.validation(flatten(errors)),
  });
}
