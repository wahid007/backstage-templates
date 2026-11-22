import { Router } from 'express';
import { buildHealthPayload } from '../lib/health';

/**
 * Kubernetes startup, readiness and liveness probes hit this endpoint. It is
 * intentionally dependency-free so a failing database or downstream service
 * cannot make the pod look unhealthy (and get restarted) during an outage.
 */
export const healthRouter: Router = Router();

healthRouter.get('/health', (_req, res) => {
  res
    .status(200)
    .json(buildHealthPayload(process.env.APP_NAME ?? 'express-backend'));
});
