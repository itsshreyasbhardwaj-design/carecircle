import 'server-only';
import { redirect } from 'next/navigation';
import { ZodError, type TypeOf, type ZodTypeAny } from 'zod';
import { AuthzError } from '@/lib/authz';
import { safeBackPath } from '@/lib/redirects';

/** Redirects back with a short, user-readable message in the query string. */
export function fail(path: string, message: string): never {
  const sep = path.includes('?') ? '&' : '?';
  redirect(`${path}${sep}error=${encodeURIComponent(message.slice(0, 300))}`);
}

export function done(path: string, message?: string): never {
  if (!message) redirect(path);
  const sep = path.includes('?') ? '&' : '?';
  redirect(`${path}${sep}ok=${encodeURIComponent(message.slice(0, 300))}`);
}

/**
 * Turns an exception into something a person can act on. AuthzError messages are
 * written for users; anything unexpected gets a generic message so an internal
 * detail is never rendered into the page.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof AuthzError) return err.message;
  if (err instanceof ZodError) return err.issues[0]?.message ?? 'Check the form and try again.';
  if (err instanceof Error) {
    // Service-layer errors are written as user-facing sentences on purpose.
    if (err.message && err.message.length < 300 && !/\bSQLITE|constraint|ENOENT\b/i.test(err.message)) {
      return err.message;
    }
    if (/UNIQUE constraint/i.test(err.message)) return 'That already exists.';
  }
  return 'Something went wrong. Nothing was saved.';
}

export function parseOr<S extends ZodTypeAny>(
  schema: S, value: unknown, path: string,
): TypeOf<S> {
  const result = schema.safeParse(value);
  if (!result.success) fail(path, result.error.issues[0]?.message ?? 'Check the form and try again.');
  return result.data;
}

/** Reads the `back` form field as a safe in-app path. See lib/redirects.ts. */
export function safeBack(data: FormData, fallback: string): string {
  return safeBackPath(data.get('back'), fallback);
}

export function str(data: FormData, key: string): string {
  const v = data.get(key);
  return typeof v === 'string' ? v : '';
}

export function bool(data: FormData, key: string): boolean {
  return data.get(key) === 'on' || data.get(key) === 'true';
}

export function strOrNull(data: FormData, key: string): string | null {
  const v = str(data, key).trim();
  return v.length ? v : null;
}

export function list(data: FormData, key: string): string[] {
  return data.getAll(key).map(String).filter((v) => v.trim().length > 0);
}
