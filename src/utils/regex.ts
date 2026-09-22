/**
 * Escapes a user-supplied string for safe use inside a RegExp.
 *
 * Without this, user input is treated as a regex: an invalid pattern throws a 500, and a
 * pathological pattern (`(a+)+$`) can cause catastrophic backtracking (ReDoS). Search
 * inputs should match literally.
 */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
