/**
 * Password policy shared by the API (validation) and the web app (hints, client checks).
 * Approved copy: "At least 8 characters, including a letter and a number."
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
/** At least one letter (any script) and one digit (Latin or Arabic-Indic). */
export const PASSWORD_PATTERN = /^(?=.*\p{L})(?=.*[0-9٠-٩]).+$/u;

export type PasswordProblem = 'TOO_SHORT' | 'TOO_LONG' | 'NEEDS_LETTER_AND_DIGIT';

export function checkPassword(password: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'TOO_SHORT';
  if (password.length > PASSWORD_MAX_LENGTH) return 'TOO_LONG';
  if (!PASSWORD_PATTERN.test(password)) return 'NEEDS_LETTER_AND_DIGIT';
  return null;
}
