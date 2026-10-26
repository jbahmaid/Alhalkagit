/**
 * Preloaded by the production web server (`node -r ./client-ip.cjs apps/web/server.js`).
 *
 * Next.js only fills `x-forwarded-for` from the socket address when the request does not
 * already carry one, so a browser could send its own header and pick any IP it liked. The API
 * uses that IP for rate limits and the audit log, so it must be the real peer address.
 *
 * By default every client-supplied forwarding header is dropped before Next sees the request;
 * Next then sets `x-forwarded-for` to the socket's remote address, and the /api proxy route
 * forwards that to the API.
 *
 * Set TRUST_PROXY_HEADERS=true only when the web container sits behind your own reverse proxy
 * (nginx, IIS, a load balancer) that sets `x-forwarded-for` itself.
 */
'use strict';

const http = require('node:http');

const trust = /^(1|true|yes)$/i.test(process.env.TRUST_PROXY_HEADERS || '');
const FORWARDING = ['x-forwarded-for', 'x-real-ip', 'forwarded'];

if (!trust) {
  const createServer = http.createServer;
  http.createServer = function patchedCreateServer(...args) {
    const i = args.findIndex((a) => typeof a === 'function');
    if (i >= 0) {
      const listener = args[i];
      args[i] = function stripForwarding(req, res) {
        for (const h of FORWARDING) delete req.headers[h];
        return listener.call(this, req, res);
      };
    }
    return createServer.apply(this, args);
  };
}
