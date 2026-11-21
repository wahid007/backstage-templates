import { NextResponse } from 'next/server';
import { buildHealthPayload } from '@/lib/health';

// The probes must always hit the running pod, never a build-time snapshot.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export function GET() {
  return NextResponse.json(
    buildHealthPayload(process.env.APP_NAME ?? 'nextjs-app'),
    { status: 200 },
  );
}
