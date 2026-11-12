import { createInferenceGateway } from '../workspace/inference.js';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { resolve, sep, extname } from 'node:path';
import { createWorkspaceHandler } from '../workspace/plugin.js';
import { createWorkspacePool } from './workspaces.js';
import { BROWSER_HEADERS } from '../../build/browserSecurity.js';

const PREFIX = '/api/world/v1';
const SESSION = '__Host-neighbor_session';
const TRANSACTION = '__Host-neighbor_oidc';
const random = () => randomBytes(32).toString('base64url');
const same = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const cookie = (name, value, age) =>
  `${name}=${value}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}`;
function readCookie(req, name) {
  const values = (req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.startsWith(`${name}=`));
  return values.length === 1 ? values[0].slice(name.length + 1) : undefined;
}
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.geojson': 'application/geo+json',
  '.czml': 'application/json',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.avif': 'image/avif',
  '.ktx2': 'image/ktx2',
  '.bin': 'application/octet-stream',
  '.webm': 'video/webm',
};

/** One-process hosted gateway. Authentication is server-only; no header or request field chooses an account. */
export function createHostedApplication({
  config,
  oidc,
  nativeFactory,
  inference = createInferenceGateway(),
  now = Date.now,
  maxSessions = 4096,
  maxTransactions = 1024,
  maxWorkers = 16,
}) {
  const sessions = new Map(),
    transactions = new Map();
  const pool = createWorkspacePool({
    ...config,
    nativeFactory,
    now,
    maxWorkers,
  });
  const send = (res, status, value, headers = {}) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(JSON.stringify(value));
  };
  const failure = (res, status, code) => send(res, status, { error: { code } });
  const sweep = (map) => {
    for (const [id, item] of map) if (now() >= item.expires) map.delete(id);
  };
  const current = (req) => {
    const session = sessions.get(readCookie(req, SESSION));
    return session && now() < session.expires ? session : undefined;
  };
  const permittedOrigin = (req) =>
    (!req.headers.origin || req.headers.origin === config.publicOrigin) &&
    req.headers['sec-fetch-site'] !== 'cross-site';
  const mutationsAllowed = (req, session) =>
    req.headers.origin === config.publicOrigin &&
    same(req.headers['x-neighbor-csrf'], session.csrf);
  const workspace = createWorkspaceHandler({
    inference,
    async authorizeHosted(req, res, path) {
      if (['/pair', '/connect', '/session', '/logout'].includes(path)) {
        failure(res, 404, 'NOT_AVAILABLE');
        return;
      }
      const session = current(req);
      if (!session) {
        failure(res, 401, 'UNAUTHENTICATED');
        return;
      }
      if (
        !permittedOrigin(req) ||
        (req.method !== 'GET' && !mutationsAllowed(req, session))
      ) {
        failure(res, 403, 'NOT_AVAILABLE');
        return;
      }
      return pool.acquire(session.identity);
    },
  });
  async function handler(req, res) {
    for (const [key, value] of Object.entries(BROWSER_HEADERS))
      res.setHeader(key, value);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    res.setHeader('X-Frame-Options', 'DENY');
    req.setTimeout(30_000, () => req.destroy());
    // Reverse-proxy headers never supply identity, origin, host or scheme authority.
    if (req.headers.host !== new URL(config.publicOrigin).host)
      return failure(res, 403, 'NOT_AVAILABLE');
    let url;
    try {
      url = new URL(req.url, config.publicOrigin);
    } catch {
      return failure(res, 400, 'INVALID');
    }
    if (url.origin !== config.publicOrigin)
      return failure(res, 403, 'NOT_AVAILABLE');
    try {
      if (url.pathname === '/healthz' && req.method === 'GET')
        return send(res, 200, { status: 'ok', mode: 'hosted' });
      if (url.pathname === '/auth/login' && req.method === 'GET') {
        sweep(transactions);
        if (transactions.size >= maxTransactions)
          return failure(res, 429, 'RATE_LIMITED');
        const transaction = await oidc.begin();
        // Reserve capacity again after async discovery/PKCE to bound concurrent starts.
        if (transactions.size >= maxTransactions)
          return failure(res, 429, 'RATE_LIMITED');
        transactions.set(transaction.state, {
          ...transaction,
          expires: now() + 600_000,
        });
        res.writeHead(302, {
          Location: transaction.url,
          'Cache-Control': 'no-store',
          'Set-Cookie': cookie(TRANSACTION, transaction.state, 600),
        });
        return res.end();
      }
      if (url.pathname === '/auth/callback' && req.method === 'GET') {
        const state = url.searchParams.get('state');
        const transaction = transactions.get(state);
        if (
          url.searchParams.getAll('state').length !== 1 ||
          !transaction ||
          now() >= transaction.expires ||
          !same(readCookie(req, TRANSACTION), state)
        )
          return failure(res, 401, 'UNAUTHENTICATED');
        transactions.delete(state); // Single use, including failed exchanges.
        const identity = await oidc.complete(url, transaction);
        if (
          !identity ||
          new URL(identity.iss).href !== new URL(config.issuer).href ||
          typeof identity.sub !== 'string' ||
          !identity.sub ||
          identity.sub.length > 255
        )
          return failure(res, 401, 'UNAUTHENTICATED');
        sweep(sessions);
        const previous = readCookie(req, SESSION);
        if (sessions.size >= maxSessions && !sessions.has(previous))
          return failure(res, 429, 'RATE_LIMITED');
        sessions.delete(previous);
        const sid = random();
        sessions.set(sid, {
          identity: { iss: identity.iss, sub: identity.sub },
          csrf: random(),
          expires: now() + 28_800_000,
        });
        res.writeHead(302, {
          Location: '/',
          'Cache-Control': 'no-store',
          'Set-Cookie': [
            cookie(TRANSACTION, '', 0),
            cookie(SESSION, sid, 28800),
          ],
        });
        return res.end();
      }
      if (url.pathname === `${PREFIX}/session` && req.method === 'GET') {
        if (!permittedOrigin(req)) return failure(res, 403, 'NOT_AVAILABLE');
        const session = current(req);
        return send(
          res,
          200,
          session
            ? {
                paired: true,
                mode: 'hosted',
                engine: 'quanta-native',
                csrf: session.csrf,
              }
            : { paired: false, mode: 'hosted', signInPath: '/auth/login' },
        );
      }
      if (url.pathname === `${PREFIX}/logout` && req.method === 'POST') {
        const session = current(req);
        if (!session) return failure(res, 401, 'UNAUTHENTICATED');
        if (!permittedOrigin(req) || !mutationsAllowed(req, session))
          return failure(res, 403, 'NOT_AVAILABLE');
        sessions.delete(readCookie(req, SESSION));
        return send(
          res,
          200,
          { status: 'signed-out' },
          { 'Set-Cookie': cookie(SESSION, '', 0) },
        );
      }
      if (url.pathname === `${PREFIX}/pair`)
        return failure(res, 404, 'NOT_AVAILABLE');
      if (url.pathname.startsWith(`${PREFIX}/`))
        return await workspace(req, res);
      if (
        url.pathname.startsWith('/api/') ||
        url.pathname.startsWith('/auth/') ||
        !['GET', 'HEAD'].includes(req.method)
      )
        return failure(res, 404, 'NOT_AVAILABLE');
      const decoded = decodeURIComponent(url.pathname);
      if (
        decoded.includes('\\') ||
        decoded.includes('\0') ||
        decoded.split('/').some((part) => part.startsWith('.'))
      )
        return failure(res, 404, 'NOT_AVAILABLE');
      const file = resolve(
        config.staticRoot,
        decoded === '/' ? 'index.html' : `.${decoded}`,
      );
      const type = TYPES[extname(file)];
      if (!type || !file.startsWith(config.staticRoot + sep))
        return failure(res, 404, 'NOT_AVAILABLE');
      const actual = await realpath(file);
      if (!actual.startsWith((await realpath(config.staticRoot)) + sep))
        return failure(res, 404, 'NOT_AVAILABLE');
      const info = await stat(actual);
      if (!info.isFile()) return failure(res, 404, 'NOT_AVAILABLE');
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': info.size,
        'Cache-Control':
          extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600',
      });
      if (req.method === 'HEAD') return res.end();
      return await pipeline(createReadStream(actual), res);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (url.pathname.startsWith('/auth/'))
        return failure(res, 401, 'UNAUTHENTICATED');
      if (
        ['ENOENT', 'ENOTDIR', 'EISDIR', 'URIError'].includes(
          error.code || error.name,
        )
      )
        return failure(res, 404, 'NOT_AVAILABLE');
      return failure(
        res,
        error.message === 'RATE_LIMITED' ? 429 : 503,
        error.message === 'RATE_LIMITED'
          ? 'RATE_LIMITED'
          : 'NATIVE_UNAVAILABLE',
      );
    }
  }
  return {
    handler,
    async close() {
      sessions.clear();
      transactions.clear();
      await pool.close();
    },
  };
}
