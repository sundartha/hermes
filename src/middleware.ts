import type { NextFunction, Request, Response } from "express";
import { auditAuthFailed, AUTH_FAILED_GRUND, maskNumbersInText } from "./util.ts";
import { fehlerStapel, fehlerText } from "./utils/fehler-text.ts";
import { MS_PER_MINUTE, MS_PER_SECOND } from "./utils/timer.ts";
import {
  HTTP_FORBIDDEN,
  HTTP_NO_CONTENT,
  HTTP_SERVER_ERROR,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_TOO_MANY_REQUESTS,
} from "./utils/http.ts";

const LOGIN_BREMSE_RETRY_AFTER_S = 5;

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
export const HSTS_HEADER_VALUE = `max-age=${String(HSTS_MAX_AGE_SECONDS)}; includeSubDomains`;

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
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

export function crossOriginRequest(originHeader: string | undefined, host: string | undefined): boolean {
  if (!originHeader) return false;
  if (!host) return true;
  let originHost: string;
  try {
    originHost = new URL(originHeader).host;
  } catch {
    return true;
  }
  return originHost.toLowerCase() !== host.toLowerCase();
}

export function createSameOriginGuard({ enforce }: { enforce?: boolean }): (req: Request, res: Response, next: NextFunction) => void {
  const aktiv = enforce !== false;
  return function sameOriginOnlyMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!aktiv || SAFE_METHODS.has(req.method)) {
      next();
      return;
    }
    if (!crossOriginRequest(req.headers.origin, req.headers.host)) {
      next();
      return;
    }
    auditAuthFailed(req, AUTH_FAILED_GRUND.CROSS_ORIGIN);
    res.status(HTTP_FORBIDDEN).json({ error: CROSS_ORIGIN_ERROR });
  };
}

const MCP_ORIGIN_SCHEMES = new Set(["http:", "https:"]);
const ORIGIN_LOG_HOST = /^[a-z0-9.:-]{1,64}$/;
const ORIGIN_LOG_UNLESBAR = "unlesbar";

function absoluterHttpOrigin(wert: string | null | undefined): URL | null {
  if (!wert) return null;
  try {
    const url = new URL(wert);
    return MCP_ORIGIN_SCHEMES.has(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

export function normalisierterOrigin(wert: string | null | undefined): string | null {
  const url = absoluterHttpOrigin(wert);
  return url ? url.origin.toLowerCase() : null;
}

export function mcpErlaubteOrigins({
  publicUrl,
  zusaetzlicheOrigins,
}: {
  publicUrl: string | null | undefined;
  zusaetzlicheOrigins?: (string | null | undefined)[];
}): string[] {
  const kandidaten: (string | null | undefined)[] = [publicUrl];
  if (zusaetzlicheOrigins !== undefined) {
    kandidaten.push(...zusaetzlicheOrigins);
  }
  const origins = kandidaten.flatMap((wert) => {
    const origin = normalisierterOrigin(wert);
    return origin ? [origin] : [];
  });
  return [...new Set(origins)];
}

export function mcpOriginErlaubt(originHeader: string | undefined, erlaubteOrigins: string[]): boolean {
  if (!originHeader) return true;
  const origin = normalisierterOrigin(originHeader);
  if (!origin) return false;
  return erlaubteOrigins.includes(origin);
}

export function originLogWert(originHeader: string | undefined): string {
  const url = absoluterHttpOrigin(originHeader);
  const host = url ? url.host.toLowerCase() : "";
  return ORIGIN_LOG_HOST.test(host) ? host : ORIGIN_LOG_UNLESBAR;
}

export function createMcpOriginGuard({
  erlaubteOrigins,
  enforce,
  ablehnungsDrossel,
}: {
  erlaubteOrigins: string[];
  enforce?: boolean;
  ablehnungsDrossel: AblehnungsDrossel;
}): (req: Request, res: Response, next: NextFunction) => void {
  const aktiv = enforce !== false;
  return function mcpOriginOnlyMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!aktiv || mcpOriginErlaubt(req.headers.origin, erlaubteOrigins)) {
      next();
      return;
    }
    if (!pruefeAblehnungsDrossel(req, res, { ablehnungsDrossel })) return;
    auditAuthFailed(
      req,
      AUTH_FAILED_GRUND.MCP_CROSS_ORIGIN,
      `origin=${originLogWert(req.headers.origin)}`,
    );
    res.status(HTTP_FORBIDDEN).json({ error: CROSS_ORIGIN_ERROR });
  };
}

export function mcpCorsOrigin(originHeader: unknown, corsOrigins: string[]): string | null {
  if (typeof originHeader !== "string") return null;
  return corsOrigins.includes(originHeader) ? originHeader : null;
}

const MCP_CORS_PFAD = "/";
const MCP_CORS_ALLOW_METHODS = "POST";
const MCP_CORS_ALLOW_HEADERS = "authorization, content-type, mcp-session-id, mcp-protocol-version";
const MCP_CORS_EXPOSE_HEADERS = "Mcp-Session-Id, WWW-Authenticate";

export function createMcpCors({ corsOrigins }: { corsOrigins: string[] }): (req: Request, res: Response, next: NextFunction) => void {
  return function mcpCorsMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (req.path !== MCP_CORS_PFAD) {
      next();
      return;
    }
    const treffer = mcpCorsOrigin(req.headers.origin, corsOrigins);
    if (!treffer) {
      next();
      return;
    }
    res.vary("Origin");
    res.set("Access-Control-Allow-Origin", treffer);
    res.set("Access-Control-Expose-Headers", MCP_CORS_EXPOSE_HEADERS);
    if (req.method !== "OPTIONS") {
      next();
      return;
    }
    res.set("Access-Control-Allow-Methods", MCP_CORS_ALLOW_METHODS);
    res.set("Access-Control-Allow-Headers", MCP_CORS_ALLOW_HEADERS);
    res.status(HTTP_NO_CONTENT).end();
  };
}

interface Treffer {
  allowed: boolean;
  retryAfterS: number;
}
interface Fenster {
  count: number;
  startedAt: number;
}
interface FensterZaehler {
  (key: string | undefined): Treffer;
  peek: (key: string | undefined) => Treffer;
}
type AblehnungsDrossel = (req: Request, args: { verifizierteSub: string | null }) => Treffer;

export const RATE_WINDOW_MS = MS_PER_MINUTE;
export const RATE_SWEEP_INTERVAL_MS = 5 * MS_PER_MINUTE;

export function makeFixedWindowCounter({
  windowMs,
  limit,
  sweepMs,
}: {
  windowMs: number;
  limit: number;
  sweepMs: number;
}): FensterZaehler {
  const windows = new Map<string | undefined, Fenster>();

  setInterval(() => {
    const now = Date.now();
    for (const [key, w] of windows) if (now - w.startedAt >= windowMs) windows.delete(key);
  }, sweepMs).unref();

  const retryAfterS = (fenster: Fenster, now: number): number => Math.ceil((fenster.startedAt + windowMs - now) / MS_PER_SECOND);
  const laufendesFenster = (key: string | undefined, now: number): Fenster | null => {
    const fenster = windows.get(key);
    return fenster && now - fenster.startedAt < windowMs ? fenster : null;
  };

  function hit(key: string | undefined): Treffer {
    const now = Date.now();
    let w = laufendesFenster(key, now);
    if (!w) {
      w = { count: 0, startedAt: now };
      windows.set(key, w);
    }
    w.count++;
    return { allowed: w.count <= limit, retryAfterS: retryAfterS(w, now) };
  }

  hit.peek = function peek(key: string | undefined): Treffer {
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

export function respondTooManyRequests(
  res: Response,
  { retryAfterS, body }: { retryAfterS: number; body: unknown },
): Response {
  res.set("Retry-After", String(retryAfterS));
  return res.status(HTTP_TOO_MANY_REQUESTS).json(body);
}

export function pruefeAblehnungsDrossel(
  req: Request,
  res: Response,
  { ablehnungsDrossel, verifizierteSub = null }: { ablehnungsDrossel: AblehnungsDrossel; verifizierteSub?: string | null },
): boolean {
  return sende429WennGesperrt(res, ablehnungsDrossel(req, { verifizierteSub }));
}

export function sende429WennGesperrt(res: Response, { allowed, retryAfterS }: Treffer): boolean {
  if (allowed) return true;
  respondTooManyRequests(res, { retryAfterS, body: RATE_LIMIT_BODY });
  return false;
}

const keyByIp = (req: Request): string | undefined => req.ip;

export function createRateLimiter(
  limitPerMin: number,
  { schluessel = keyByIp }: { schluessel?: (req: Request) => string | undefined } = {},
): (req: Request, res: Response, next: NextFunction) => void {
  const rateHit = makeFixedWindowCounter({
    windowMs: RATE_WINDOW_MS,
    limit: limitPerMin,
    sweepMs: RATE_SWEEP_INTERVAL_MS,
  });

  return (req: Request, res: Response, next: NextFunction): void => {
    const { allowed, retryAfterS } = rateHit(schluessel(req));
    if (!allowed) {
      respondTooManyRequests(res, { retryAfterS, body: RATE_LIMIT_BODY });
      return;
    }
    next();
  };
}

export function createGeteilterRateLimiter({
  zaehlen,
  limitPerMin,
}: {
  zaehlen: (args: { ip: string | undefined; nowMs: number; windowMs: number }) => Promise<{ anzahl: number; beginnMs: number }>;
  limitPerMin: number;
}): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const fensterS = RATE_WINDOW_MS / MS_PER_SECOND;
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const nowMs = Date.now();
    let treffer: Awaited<ReturnType<typeof zaehlen>>;
    try {
      treffer = await zaehlen({ ip: keyByIp(req), nowMs, windowMs: RATE_WINDOW_MS });
    } catch (err) {
      console.error("[login-bremse]", maskNumbersInText(fehlerText(err)));
      res.set("Retry-After", String(LOGIN_BREMSE_RETRY_AFTER_S));
      res.status(HTTP_SERVICE_UNAVAILABLE).json({ error: "service unavailable" });
      return;
    }
    if (treffer.anzahl <= limitPerMin) {
      next();
      return;
    }
    const verbleibendS = Math.ceil((treffer.beginnMs + RATE_WINDOW_MS - nowMs) / MS_PER_SECOND);
    const retryAfterS = Math.min(fensterS, Math.max(1, verbleibendS));
    respondTooManyRequests(res, { retryAfterS, body: RATE_LIMIT_BODY });
  };
}

export function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  console.error("[error]", maskNumbersInText(fehlerStapel(err)));
  if (res.writableEnded) return;
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(HTTP_SERVER_ERROR).json({ error: "internal error" });
}
