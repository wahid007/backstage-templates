import { NextResponse } from 'next/server';

// Frontend-local health endpoint used by the Kubernetes probes and the Docker
// HEALTHCHECK. It deliberately does not proxy to Express, so a backend outage
// does not restart the frontend pods.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: process.env.APP_NAME ?? 'frontend',
      version: process.env.APP_VERSION ?? 'dev',
    },
    { status: 200 },
  );
}
