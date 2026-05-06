import { NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://gateway:3000';

async function proxyRequest(request: Request, path: string[]) {
  const url = new URL(request.url);
  const target = new URL(`${BACKEND_URL}/${path.join('/')}`);
  target.search = url.search;

  const headers = new Headers(request.headers);
  headers.delete('host');

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text();
  }

  const response = await fetch(target, init);
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('transfer-encoding');

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: responseHeaders,
  });
}

export async function GET(request: Request, context: { params: { path: string[] } }) {
  return proxyRequest(request, context.params.path);
}

export async function POST(request: Request, context: { params: { path: string[] } }) {
  return proxyRequest(request, context.params.path);
}

export async function PUT(request: Request, context: { params: { path: string[] } }) {
  return proxyRequest(request, context.params.path);
}

export async function PATCH(request: Request, context: { params: { path: string[] } }) {
  return proxyRequest(request, context.params.path);
}

export async function DELETE(request: Request, context: { params: { path: string[] } }) {
  return proxyRequest(request, context.params.path);
}
