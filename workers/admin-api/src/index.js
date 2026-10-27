import { FirebaseGateway, SafeError, verifyToken } from './firebase.js';
import { ResetService } from './service.js';

export function handler({ verify = verifyToken, gateway = secret => new FirebaseGateway(secret) } = {}) {
  return async (request, env) => {
    const origin = request.headers.get('Origin');
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').includes(origin);
    const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' } : {}) };
    const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers });
    try {
      const url = new URL(request.url);
      if (origin && !allowed) throw new SafeError(403, 'Origin not allowed.');
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
      if (url.pathname === '/health' && request.method === 'GET') return response({ service: 'presence-admin-api', enabled: env.RESET_ENABLED === 'true', configured: Boolean(env.FIREBASE_SERVICE_ACCOUNT) });
      if (!['/v1/admin/password-reset', '/v1/student/password-change'].includes(url.pathname) || url.search) throw new SafeError(404, 'Not found.');
      if (request.method !== 'POST') throw new SafeError(405, 'POST required.');
      if (env.RESET_ENABLED !== 'true') throw new SafeError(503, 'Password reset service is not enabled yet.');
      const token = /^Bearer ([^\s]+)$/.exec(request.headers.get('Authorization') || '')?.[1];
      if (!token) throw new SafeError(401, 'Sign in again to continue.');
      if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) throw new SafeError(415, 'JSON required.');
      // Bound the stream rather than trusting Content-Length (which may be absent).
      const reader = request.body?.getReader(); let size = 0, chunks = [];
      if (!reader) throw new SafeError(400, 'JSON required.');
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4096) { await reader.cancel(); throw new SafeError(413, 'Request too large.'); } chunks.push(value); }
      const data = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
      let body; try { body = JSON.parse(new TextDecoder().decode(data)); } catch { throw new SafeError(400, 'Invalid JSON.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new SafeError(400, 'Invalid request.');
      const claims = await verify(token), service = new ResetService(gateway(env.FIREBASE_SERVICE_ACCOUNT));
      return response(url.pathname.startsWith('/v1/admin/') ? await service.reset(claims, body) : await service.complete(claims, body));
    } catch (error) { return response({ error: error instanceof SafeError ? error.message : 'Reset service is temporarily unavailable.' }, error instanceof SafeError ? error.status : 503); }
  };
}
export default { fetch: handler() };
