import { NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
async function proxy(request: Request, context: { params: { path: string[] } }) {
  const url = new URL(request.url);
  const target = new URL(`/api/${context.params.path.map(encodeURIComponent).join('/')}`, BACKEND_URL);
  target.search = url.search;
  // Forward only necessary headers; never trust client-supplied proxy headers.
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const authorization = request.headers.get('authorization');
  if (authorization) headers.set('authorization', authorization);
  try {
    const response = await fetch(target, { method: request.method, headers, cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(25000), body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text() });
    return new NextResponse(await response.text(), { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch { return NextResponse.json({ error: 'Gateway unavailable. Retry shortly.' }, { status: 502 }); }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;
