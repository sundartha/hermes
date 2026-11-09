import { auditAuthFailed, AUTH_FAILED_GRUND, maskNumbersInText } from "./util.js";
import { MS_PER_MINUTE, MS_PER_SECOND } from "./utils/timer.js";
import { HTTP_FORBIDDEN, HTTP_NO_CONTENT, HTTP_SERVER_ERROR, HTTP_TOO_MANY_REQUESTS } from "./utils/http.js";

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join("; ");

const HSTS_MAX_AGE_SECONDS = 15552000;
export const HSTS_HEADER_VALUE = `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`;

export function securityHeaders(req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": HSTS_HEADER_VALUE,
    "Content-Security-Policy": CSP,
  });
  if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
  next();
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const CROSS_ORIGIN_ERROR = "cross_origin_blocked";

export function crossOriginRequest(originHeader, host) {
  if (!originHeader) return false;
  if (!host) return true;
  let originHost;
  try {
    originHost = new URL(originHeader).host;
  } catch {
    return true;
  }
  return originHost.toLowerCase() !== host.toLowerCase();
}

export function createSameOriginGuard({ enforce }) {
  const aktiv = enforce !== false;
  return function sameOriginOnlyMiddleware(req, res, next) {
    if (!aktiv || SAFE_METHODS.has(req.method)) return next();
    if (!crossOriginRequest(req.headers.origin, req.headers.host)) return next();
    auditAuthFailed(req, AUTH_FAILED_GRUND.CROSS_ORIGIN);
    res.status(HTTP_FORBIDDEN).json({ error: CROSS_ORIGIN_ERROR });
  };
}

const MCP_ORIGIN_SCHEMES = new Set(["http:", "https:"]);
const ORIGIN_LOG_HOST = /^[a-z0-9.:-]{1,64}$/;
const ORIGIN_LOG_UNLESBAR = "unlesbar";

function absoluterHttpOrigin(wert) {
  if (!wert) return null;
  try {
    const url = new URL(wert);
    return MCP_ORIGIN_SCHEMES.has(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function normalisierterOrigin(wert) {
  const url = absoluterHttpOrigin(wert);
  return url ? url.origin.toLowerCase() : null;
}

export function mcpErlaubteOrigins({ publicUrl, zusaetzlicheOrigins = [] }) {
  const kandidaten = [publicUrl, ...zusaetzlicheOrigins];
  return [...new Set(kandidaten.map((wert) => normalisierterOrigin(wert)).filter(Boolean))];
}

export function mcpOriginErlaubt(originHeader, erlaubteOrigins) {
  if (!originHeader) return true;
  const origin = normalisierterOrigin(originHeader);
  if (!origin) return false;
  return erlaubteOrigins.includes(origin);
}

export function originLogWert(originHeader) {
  const url = absoluterHttpOrigin(originHeader);
  const host = url ? url.host.toLowerCase() : "";
  return ORIGIN_LOG_HOST.test(host) ? host : ORIGIN_LOG_UNLESBAR;
}

export function createMcpOriginGuard({ erlaubteOrigins, enforce, ablehnungsDrossel }) {
  const aktiv = enforce !== false;
  return function mcpOriginOnlyMiddleware(req, res, next) {
    if (!aktiv || mcpOriginErlaubt(req.headers.origin, erlaubteOrigins)) return next();
    if (!pruefeAblehnungsDrossel(req, res, { ablehnungsDrossel })) return;
    auditAuthFailed(
      req,
      AUTH_FAILED_GRUND.MCP_CROSS_ORIGIN,
      `origin=${originLogWert(req.headers.origin)}`,
    );
    res.status(HTTP_FORBIDDEN).json({ error: CROSS_ORIGIN_ERROR });
  };
}

export function mcpCorsOrigin(originHeader, corsOrigins) {
  if (typeof originHeader !== "string") return null;
  return corsOrigins.includes(originHeader) ? originHeader : null;
}

const MCP_CORS_PFAD = "/";
const MCP_CORS_ALLOW_METHODS = "POST";
const MCP_CORS_ALLOW_HEADERS = "authorization, content-type, mcp-session-id, mcp-protocol-version";
const MCP_CORS_EXPOSE_HEADERS = "Mcp-Session-Id, WWW-Authenticate";

export function createMcpCors({ corsOrigins }) {
  return function mcpCorsMiddleware(req, res, next) {
    if (req.path !== MCP_CORS_PFAD) return next();
    const treffer = mcpCorsOrigin(req.headers.origin, corsOrigins);
    if (!treffer) return next();
    res.vary("Origin");
    res.set("Access-Control-Allow-Origin", treffer);
    res.set("Access-Control-Expose-Headers", MCP_CORS_EXPOSE_HEADERS);
    if (req.method !== "OPTIONS") return next();
    res.set("Access-Control-Allow-Methods", MCP_CORS_ALLOW_METHODS);
    res.set("Access-Control-Allow-Headers", MCP_CORS_ALLOW_HEADERS);
    res.status(HTTP_NO_CONTENT).end();
  };
}

export const RATE_WINDOW_MS = MS_PER_MINUTE;
export const RATE_SWEEP_INTERVAL_MS = 5 * MS_PER_MINUTE;

export function makeFixedWindowCounter({ windowMs, limit, sweepMs }) {
  const windows = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, w] of windows) if (now - w.startedAt >= windowMs) windows.delete(key);
  }, sweepMs).unref();

  const retryAfterS = (fenster, now) => Math.ceil((fenster.startedAt + windowMs - now) / MS_PER_SECOND);
  const laufendesFenster = (key, now) => {
    const fenster = windows.get(key);
    return fenster && now - fenster.startedAt < windowMs ? fenster : null;
  };

  function hit(key) {
    const now = Date.now();
    let w = laufendesFenster(key, now);
    if (!w) {
      w = { count: 0, startedAt: now };
      windows.set(key, w);
    }
    w.count++;
    return { allowed: w.count <= limit, retryAfterS: retryAfterS(w, now) };
  }

  hit.peek = function peek(key) {
    const now = Date.now();
    const fenster = laufendesFenster(key, now);
    if (!fenster) return { allowed: true, retryAfterS: 0 };
    return { allowed: fenster.count < limit, retryAfterS: retryAfterS(fenster, now) };
  };
  return hit;
}

export const RATE_LIMIT_BODY = Object.freeze({
  error: "Zu viele Anfragen. Bitte spaeter erneut versuchen.",
});

export function respondTooManyRequests(res, { retryAfterS, body }) {
  res.set("Retry-After", String(retryAfterS));
  return res.status(HTTP_TOO_MANY_REQUESTS).json(body);
}

export function pruefeAblehnungsDrossel(req, res, { ablehnungsDrossel, verifizierteSub = null }) {
  return sende429WennGesperrt(res, ablehnungsDrossel(req, { verifizierteSub }));
}

export function sende429WennGesperrt(res, { allowed, retryAfterS }) {
  if (allowed) return true;
  respondTooManyRequests(res, { retryAfterS, body: RATE_LIMIT_BODY });
  return false;
}

const keyByIp = (req) => req.ip;

export function createRateLimiter(limitPerMin, { schluessel = keyByIp } = {}) {
  const rateHit = makeFixedWindowCounter({
    windowMs: RATE_WINDOW_MS,
    limit: limitPerMin,
    sweepMs: RATE_SWEEP_INTERVAL_MS,
  });

  return (req, res, next) => {
    const { allowed, retryAfterS } = rateHit(schluessel(req));
    if (!allowed) return respondTooManyRequests(res, { retryAfterS, body: RATE_LIMIT_BODY });
    next();
  };
}

export function createGeteilterRateLimiter({ zaehlen, limitPerMin }) {
  const fensterS = RATE_WINDOW_MS / MS_PER_SECOND;
  return async (req, res, next) => {
    const nowMs = Date.now();
    let treffer;
    try {
      treffer = await zaehlen({ ip: keyByIp(req), nowMs, windowMs: RATE_WINDOW_MS });
    } catch (err) {
      return next(err);
    }
    if (treffer.anzahl <= limitPerMin) return next();
    const verbleibendS = Math.ceil((treffer.beginnMs + RATE_WINDOW_MS - nowMs) / MS_PER_SECOND);
    const retryAfterS = Math.min(fensterS, Math.max(1, verbleibendS));
    return respondTooManyRequests(res, { retryAfterS, body: RATE_LIMIT_BODY });
  };
}

export function errorHandler(err, _req, res, next) {
  console.error("[error]", maskNumbersInText(err && err.stack ? err.stack : String(err)));
  if (res.headersSent) return next(err);
  res.status(HTTP_SERVER_ERROR).json({ error: "internal error" });
}
