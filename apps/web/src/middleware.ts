import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';

const intl = createMiddleware(routing);

/** Areas that need a signed-in user. The API enforces access; this only saves a round trip. */
const PROTECTED = /^\/(ar|en)\/(seeker|employer|admin|account|change-password)(\/|$)/;
const SESSION_HINT_COOKIE = 'sanad_session';

export default function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const match = PROTECTED.exec(pathname);
  if (match && !req.cookies.get(SESSION_HINT_COOKIE)) {
    const url = req.nextUrl.clone();
    url.pathname = `/${match[1]}/login`;
    url.search = `?next=${encodeURIComponent(pathname.slice(match[1].length + 1) + search)}`;
    return NextResponse.redirect(url);
  }
  return intl(req);
}

export const config = {
  // Everything except the API proxy, Next internals and files with an extension.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
