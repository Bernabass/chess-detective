/**
 * Where to go after signing in: `next` if it's a path on this site, otherwise /daily. Only
 * same-site paths are allowed, so the sign-in page can't be used as an open redirect.
 */
export function safeNext(next: string | null): string {
  if (
    next === null ||
    !next.startsWith('/') ||
    next.startsWith('//') ||
    next.includes('\\') ||
    // Control characters, like the server's SafeReturnTo (browsers drop tabs and newlines).
    Array.from(next).some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
  ) {
    return '/daily';
  }
  return next;
}
