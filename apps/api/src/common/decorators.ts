import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'sanad:isPublic';
/** Route needs no access token. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ALLOW_PENDING_PASSWORD_CHANGE = 'sanad:allowPendingPasswordChange';
/** Route stays reachable while the user must change their password (e.g. /me, change-password). */
export const AllowPendingPasswordChange = () => SetMetadata(ALLOW_PENDING_PASSWORD_CHANGE, true);

export const REQUIRED_PERMISSIONS = 'sanad:requiredPermissions';
/** All listed permission codes are required. SUPER_ADMIN has every permission. */
export const RequirePermissions = (...codes: string[]) => SetMetadata(REQUIRED_PERMISSIONS, codes);

export interface AuthUser {
  id: string;
  role: 'SEEKER' | 'EMPLOYER' | 'ADMIN' | 'SUPER_ADMIN';
  mustChangePassword: boolean;
}

/** Injects the authenticated user (set by JwtAuthGuard). */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});
