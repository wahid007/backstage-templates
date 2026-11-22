export const DEFAULT_BACKEND_URL = 'http://localhost:3001';

/**
 * Normalises the `BACKEND_URL` environment variable used by the Next.js API
 * proxy. The value is read at request time, so the same frontend image works in
 * local development and inside Kubernetes.
 */
export function normalizeBackendUrl(value: string | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/, '') : DEFAULT_BACKEND_URL;
}

/**
 * Builds the absolute URL of an Express endpoint from the catch-all path
 * segments received by `app/api/[...path]/route.ts`.
 */
export function buildBackendUrl(
  baseUrl: string | undefined,
  path: readonly string[],
  search = '',
): string {
  const base = normalizeBackendUrl(baseUrl);
  const suffix = path.map((segment) => encodeURIComponent(segment)).join('/');
  const url = new URL(`/api/${suffix}`, `${base}/`);
  url.search = search;
  return url.toString();
}
