/**
 * Same-origin proxy: the browser only ever talks to the web origin (port 3000), which forwards
 * /api/* to the API container (API_INTERNAL_URL, default http://api:4000). Cookies therefore stay
 * first-party and the app works from other devices on the LAN.
 */
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const API = (process.env.API_INTERNAL_URL || 'http://localhost:4000').replace(/\/+$/, '');

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
]);

/**
 * The caller's IP. In the Docker image `client-ip.cjs` strips any forwarding headers the browser
 * sent, so Next fills `x-forwarded-for` with the socket's peer address and that is what we read.
 * With TRUST_PROXY_HEADERS=true (behind your own reverse proxy) the first entry is the client
 * that proxy saw.
 */
function clientIp(req: NextRequest): string | null {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!first) return null;
  return first.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');
}

async function proxy(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path } = await ctx.params;
  const target = `${API}/api/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });
  for (const h of ['x-forwarded-for', 'x-real-ip', 'forwarded']) headers.delete(h);
  const ip = clientIp(req);
  if (ip) headers.set('x-forwarded-for', ip);
  headers.set('x-forwarded-proto', req.nextUrl.protocol.replace(':', ''));
  headers.set('x-forwarded-host', req.headers.get('host') ?? '');

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body: hasBody ? await req.arrayBuffer() : undefined,
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    return Response.json(
      { statusCode: 503, code: 'API_UNAVAILABLE', message: 'API unavailable' },
      { status: 503 },
    );
  }

  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    const k = key.toLowerCase();
    if (k === 'set-cookie' || k === 'content-encoding' || HOP_BY_HOP.has(k)) return;
    out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append('set-cookie', cookie);

  return new Response(upstream.status === 204 ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
