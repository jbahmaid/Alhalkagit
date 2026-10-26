import { ROLE_HOME, type UserRole } from '@sanad/shared';

export type NavItem = { href: string; labelKey: string; enabled: boolean };

/**
 * Navigation per role (prototype NAV). Items are shown only when `enabled`; later batches flip
 * them on as screens are built.
 */
export const ROLE_NAV: Record<'SEEKER' | 'EMPLOYER' | 'ADMIN', NavItem[]> = {
  SEEKER: [
    { href: '/seeker/jobs', labelKey: 'jobs', enabled: false },
    { href: '/seeker/requests', labelKey: 'myRequests', enabled: false },
    { href: '/seeker', labelKey: 'myProfile', enabled: true },
  ],
  EMPLOYER: [
    { href: '/employer', labelKey: 'dashboard', enabled: true },
    { href: '/employer/jobs/new', labelKey: 'postJob', enabled: false },
    { href: '/employer/reports', labelKey: 'reports', enabled: false },
  ],
  ADMIN: [
    { href: '/admin', labelKey: 'overview', enabled: true },
    { href: '/admin/approvals', labelKey: 'approvals', enabled: false },
    { href: '/admin/lookups', labelKey: 'lookups', enabled: false },
    { href: '/admin/users', labelKey: 'users', enabled: false },
    { href: '/admin/audit', labelKey: 'audit', enabled: false },
    { href: '/admin/reports', labelKey: 'reports', enabled: false },
  ],
};

export function navFor(role: UserRole): NavItem[] {
  return (role === 'SUPER_ADMIN' ? ROLE_NAV.ADMIN : ROLE_NAV[role]).filter((i) => i.enabled);
}

export const homeFor = (role: UserRole): string => ROLE_HOME[role];

/** Only accept same-site relative paths as ?next= targets. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
  return next;
}
