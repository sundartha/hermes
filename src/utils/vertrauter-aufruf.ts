import type { NextFunction, Request, Response } from "express";

import { auditAuthFailed, AUTH_FAILED_GRUND } from "../util.ts";
import { HTTP_FORBIDDEN } from "./http.ts";

const LOKALE_ADRESSEN = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

type Anfragekopf = Pick<Request, "socket" | "headers">;

export const isLocalSocket = (req: Pick<Request, "socket">): boolean =>
  LOKALE_ADRESSEN.includes(String(req.socket.remoteAddress));

const isProxyForwarded = (req: Pick<Request, "headers">): boolean =>
  Boolean(req.headers["x-forwarded-for"]);

export const isTrustedLocalCaller = (req: Anfragekopf): boolean =>
  isLocalSocket(req) && !isProxyForwarded(req);

export function internalOnly<Parameter>(
  req: Request<Parameter>,
  res: Response,
  next: NextFunction,
): void {
  if (isTrustedLocalCaller(req)) {
    next();
    return;
  }
  auditAuthFailed(req, AUTH_FAILED_GRUND.NOT_LOCAL);
  res.status(HTTP_FORBIDDEN).json({ error: "Forbidden" });
}
