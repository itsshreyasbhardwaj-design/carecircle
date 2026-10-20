/**
 * Returns a safe in-app redirect target.
 *
 * A `back` value arrives in form data, so without this a crafted form could
 * redirect a signed-in user off-site after a successful action — an open
 * redirect, useful for phishing. Only a single-slash absolute path on this
 * origin is accepted; anything else falls back to the caller's default.
 *
 * Kept out of the server-only action module so it can be tested directly.
 */
export function safeBackPath(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const value = raw.trim();
  if (!value.startsWith('/')) return fallback;      // no scheme, no scheme-relative
  if (value.startsWith('//')) return fallback;      // //host is an authority, not a path
  if (value.includes('\\')) return fallback;         // backslash tricks
  if (/[\r\n\t\0]/.test(value)) return fallback;     // header/control injection
  if (value.length > 300) return fallback;
  return value;
}
