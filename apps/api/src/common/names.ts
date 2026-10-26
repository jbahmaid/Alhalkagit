import type { User } from '@prisma/client';

/** Name shown for any account: seeker's name, employer contact, admin display name, username, email. */
export function nameOf(
  u: Pick<User, 'email' | 'username' | 'displayName'>,
  person?: { firstName: string; fatherName: string; grandfatherName: string; familyName: string } | null,
  employer?: { contactName: string } | null,
): string {
  if (person)
    return [person.firstName, person.fatherName, person.grandfatherName, person.familyName].join(' ');
  return employer?.contactName ?? u.displayName ?? u.username ?? u.email;
}
