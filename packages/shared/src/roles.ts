/** Mirrors the Prisma enums in apps/api/prisma/schema.prisma (keep in sync). */
export const USER_ROLES = ['SEEKER', 'EMPLOYER', 'ADMIN', 'SUPER_ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ADMIN_ROLES: readonly UserRole[] = ['ADMIN', 'SUPER_ADMIN'];

export function isAdminRole(role: UserRole | null | undefined): boolean {
  return !!role && ADMIN_ROLES.includes(role);
}

/** Landing area of each role in the web app (path after the locale prefix). */
export const ROLE_HOME: Record<UserRole, string> = {
  SEEKER: '/seeker',
  EMPLOYER: '/employer',
  ADMIN: '/admin',
  SUPER_ADMIN: '/admin',
};

/** Fine-grained permission codes seeded by apps/api/prisma/seed.ts. */
export const PERMISSIONS = {
  PROFILE_SELF_READ: 'profile.self.read',
  PROFILE_SELF_UPDATE: 'profile.self.update',
  JOBS_BROWSE: 'jobs.browse',
  INTERESTS_CREATE: 'interests.create',
  JOBS_OWN_MANAGE: 'jobs.own.manage',
  INTERESTS_OWN_READ: 'interests.own.read',
  REPORTS_GENERAL_READ: 'reports.general.read',
  DATA_EXPORT: 'data.export',
  SEEKERS_READ: 'seekers.read',
  SEEKERS_UPDATE: 'seekers.update',
  SEEKERS_ID_NUMBER_REVEAL: 'seekers.id_number.reveal',
  EMPLOYERS_READ: 'employers.read',
  EMPLOYERS_UPDATE: 'employers.update',
  EMPLOYERS_APPROVE: 'employers.approve',
  JOBS_MANAGE: 'jobs.manage',
  INTERESTS_READ: 'interests.read',
  LOOKUPS_MANAGE: 'lookups.manage',
  REPORTS_ALL_READ: 'reports.all.read',
  AUDIT_READ: 'audit.read',
  SETTINGS_MANAGE: 'settings.manage',
  USERS_MANAGE: 'users.manage',
  RECORDS_HARD_DELETE: 'records.hard_delete',
  ADMINS_MANAGE: 'admins.manage',
} as const;
export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const AUDIT_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'HARD_DELETE',
  'RESTORE',
  'LOGIN',
  'LOGIN_FAILED',
  'LOGOUT',
  'EMAIL_VERIFIED',
  'PASSWORD_RESET',
  'APPROVE',
  'REJECT',
  'SUSPEND',
  'STATUS_CHANGE',
  'VIEW_SENSITIVE',
  'EXPORT',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
