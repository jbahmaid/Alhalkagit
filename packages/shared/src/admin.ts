import type { EmployerAccountDto } from './jobs';
import type { LookupType } from './lookups';
import type { AuditAction, UserRole, UserStatus } from './roles';

// ---------------------------------------------------------------------------
// S-17 admin dashboard
// ---------------------------------------------------------------------------

export interface AuditEntryDto {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  /** Email or username of the actor, if it still exists. */
  actorLabel: string | null;
  actorRole: UserRole | null;
  action: AuditAction;
  entity: string;
  entityId: string | null;
  ip: string | null;
  /** Stored already masked: secrets appear as "[REDACTED]". */
  before: unknown;
  after: unknown;
}

export interface AdminDashboardDto {
  stats: {
    seekers: number;
    employersApproved: number;
    employersPending: number;
    openJobs: number;
    interestRequests: number;
    hiredViaPlatform: number;
  };
  pending: { id: string; organizationName: string; sectorId: string; createdAt: string }[];
  recentAudit: AuditEntryDto[];
}

// ---------------------------------------------------------------------------
// S-19 lookups (admin view includes inactive items)
// ---------------------------------------------------------------------------

export interface AdminLookupItemDto {
  id: string;
  /** Unique code; ISO 3166-1 alpha-2 for countries. */
  code: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
  /** education-levels only (unique) */
  rank?: number;
  /** fakhdhs only (optional link) */
  darId?: string | null;
}

export interface AdminLookupInput {
  code: string;
  nameAr: string;
  nameEn: string;
  sortOrder?: number;
  isActive?: boolean;
  rank?: number;
  darId?: string | null;
}

export const LOOKUP_LIMITS = { codeMax: 64, nameMax: 150 } as const;
export type AdminLookupType = LookupType;

// ---------------------------------------------------------------------------
// S-20 users
// ---------------------------------------------------------------------------

export interface AdminUserRowDto {
  id: string;
  name: string;
  email: string;
  username: string | null;
  role: UserRole;
  status: UserStatus;
  isSystemAccount: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminUserFilters {
  q?: string;
  role?: UserRole | '';
  status?: UserStatus | '';
}

export interface AdminUserDetailDto extends AdminUserRowDto {
  displayName: string | null;
  mustChangePassword: boolean;
  locale: 'ar' | 'en';
  /** Present for employers. */
  employer: (EmployerAccountDto & { id: string }) | null;
  /** Present for seekers: the profile is read from /admin/users/:id/profile. */
  hasSeekerProfile: boolean;
}

export interface CreateAdminInput {
  email: string;
  username?: string | null;
  name: string;
  role: 'ADMIN' | 'SUPER_ADMIN';
}

export interface RevealedIdDto {
  idType: 'NATIONAL_ID' | 'PASSPORT';
  idNumber: string;
}

// ---------------------------------------------------------------------------
// S-21 audit viewer
// ---------------------------------------------------------------------------

export interface AuditFilters {
  /** Free text matched against the actor's email, username or name. */
  user?: string;
  action?: AuditAction | '';
  entity?: string;
  /** YYYY-MM-DD, inclusive */
  from?: string;
  to?: string;
}

export interface AuditPageDto extends Paged<AuditEntryDto> {
  /** Tables that appear in the log, for the filter. */
  entities: string[];
}

// ---------------------------------------------------------------------------
// Settings and export
// ---------------------------------------------------------------------------

export interface MatchingSettingsDto {
  weights: { sector: number; education: number; experience: number; keywords: number };
  thresholds: { suitable: number; near: number };
}

export const EXPORT_KINDS = ['full', 'users', 'audit'] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export interface ExportTokenDto {
  token: string;
  expiresAt: string;
}

/** Rows of the audit sheet in a full export. */
export const EXPORT_AUDIT_LIMIT = 5000;

// ---------------------------------------------------------------------------
// "My account" (every role)
// ---------------------------------------------------------------------------

export interface AccountDto {
  email: string;
  username: string | null;
  displayName: string;
  role: UserRole;
  isSystemAccount: boolean;
  /** New email waiting for its code, if any. */
  pendingEmail: string | null;
}
