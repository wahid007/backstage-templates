export interface HealthPayload {
  status: 'ok';
  service: string;
  version: string;
  timestamp: string;
}

/**
 * Builds the payload returned by the `/api/health` endpoint.
 *
 * The endpoint is used by the Kubernetes readiness and liveness probes, so the
 * function is intentionally dependency-free and easy to unit test.
 */
export function buildHealthPayload(
  service: string,
  now: Date = new Date(),
): HealthPayload {
  return {
    status: 'ok',
    service,
    version: process.env.APP_VERSION ?? 'dev',
    timestamp: now.toISOString(),
  };
}
