import { NextResponse, type NextRequest } from 'next/server';
import { buildBackendUrl } from '@/lib/backend';

// The proxy must resolve BACKEND_URL at runtime, never at build time.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface RouteContext {
  params: Promise<{ path: string[] }>;
}

/**
 * Thin BFF proxy: the browser only talks to the Next.js origin, and Next.js
 * forwards `/api/*` to the internal Express Service. This keeps the backend
 * private (ClusterIP) and avoids CORS configuration.
 */
async function proxy(
  request: NextRequest,
  { params }: RouteContext,
): Promise<NextResponse> {
  const { path } = await params;
  const target = buildBackendUrl(
    process.env.BACKEND_URL,
    path,
    request.nextUrl.search,
  );

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');

  const method = request.method.toUpperCase();
  const hasBody = method !== 'GET' && method !== 'HEAD';

  try {
    const upstream = await fetch(target, {
      method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      cache: 'no-store',
      redirect: 'manual',
    });

    // fetch already decoded the body, so the original encoding headers no
    // longer describe what is returned to the browser.
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.delete('content-encoding');
    responseHeaders.delete('content-length');

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('[api-proxy] backend request failed', error);
    return NextResponse.json(
      { error: 'Backend unavailable' },
      { status: 502 },
    );
  }
}

export {
  proxy as DELETE,
  proxy as GET,
  proxy as HEAD,
  proxy as OPTIONS,
  proxy as PATCH,
  proxy as POST,
  proxy as PUT,
};
