import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";
import { audit, safeEqual } from "./util.js";
import { pruefeAblehnungsDrossel, sende429WennGesperrt } from "./middleware.js";

const isLocalSocket = (req) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

export function legacyLocalBypassAllowed(req, isProduction = config.server.isProduction) {
  return !isProduction && isLocalSocket(req);
}

const audience = () => config.auth.oauthAudience || `${config.server.publicUrl}/mcp`;
const metadataUrl = () => `${config.server.publicUrl}/.well-known/oauth-protected-resource`;

export const OAUTH_SCOPES = Object.freeze(["openid", "email", "offline_access"]);
const OAUTH_SCOPE_PARAM = OAUTH_SCOPES.join(" ");

const GRANT_ONLY_SCOPES = Object.freeze(["offline_access"]);

export const ENFORCED_OAUTH_SCOPES = Object.freeze(
  OAUTH_SCOPES.filter((scope) => !GRANT_ONLY_SCOPES.includes(scope)),
);

async function discoverJwksUri() {
  const paths = ["/.well-known/openid-configuration", "/.well-known/oauth-authorization-server"];
  let lastErr;
  for (const path of paths) {
    try {
      const response = await fetch(`${config.auth.oauthIssuerUrl}${path}`);
      if (!response.ok) {
        lastErr = new Error(`${path} HTTP ${response.status}`);
        continue;
      }
      const { jwks_uri } = await response.json();
      if (jwks_uri) return jwks_uri;
      lastErr = new Error(`${path} ohne jwks_uri`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("keine OAuth-Metadata gefunden");
}

let jwks = null;
async function getJwks() {
  if (jwks) return jwks;
  jwks = createRemoteJWKSet(new URL(await discoverJwksUri()));
  return jwks;
}

export function _resetJwksCache() {
  jwks = null;
}

const HTTP_UNAUTHORIZED = 401;
function sendBearerChallenge(res, challenge, { body, status = HTTP_UNAUTHORIZED } = {}) {
  res.set("WWW-Authenticate", challenge);
  return res.status(status).json(body);
}

function bearerChallenge(paare) {
  return `Bearer ${paare.map(([schluessel, wert]) => `${schluessel}="${wert}"`).join(", ")}`;
}

export function oauthBearerChallenge(error, description) {
  return bearerChallenge([
    ["resource_metadata", metadataUrl()],
    ["scope", OAUTH_SCOPE_PARAM],
    ["error", error],
    ["error_description", description],
  ]);
}

function deny401(res, error, description) {
  const challenge = oauthBearerChallenge(error, description);
  return sendBearerChallenge(res, challenge, { body: { error: description } });
}

function grantedScopes(payload) {
  if (typeof payload.scope === "string" && payload.scope.trim() !== "") {
    return payload.scope.trim().split(/\s+/);
  }
  if (Array.isArray(payload.scp)) return payload.scp;
  if (typeof payload.scp === "string" && payload.scp.trim() !== "") return payload.scp.trim().split(/\s+/);
  return [];
}

function hasRequiredScopes(payload) {
  const granted = new Set(grantedScopes(payload));
  return ENFORCED_OAUTH_SCOPES.every((scope) => granted.has(scope));
}

const HTTP_FORBIDDEN = 403;

function deny403InsufficientScope(res) {
  const challenge = bearerChallenge([
    ["error", "insufficient_scope"],
    ["scope", OAUTH_SCOPE_PARAM],
    ["resource_metadata", metadataUrl()],
    ["error_description", "Token traegt nicht alle geforderten Scopes"],
  ]);
  return sendBearerChallenge(res, challenge, { body: { error: "insufficient_scope" }, status: HTTP_FORBIDDEN });
}

const STATIC_BEARER_CHALLENGE = 'Bearer error="invalid_token"';

function nichtLeererString(wert) {
  return typeof wert === "string" && wert ? wert : null;
}

function mitAblehnungsDrossel({ req, res, ablehnungsDrossel, verifizierteSub = null, auditFn }, sende) {
  if (!pruefeAblehnungsDrossel(req, res, { ablehnungsDrossel, verifizierteSub })) return;
  auditFn();
  return sende();
}

function makeVerifyOauth(ablehnungsDrossel) {
  return async function verifyOauth(req, res, next) {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) {
      return mitAblehnungsDrossel(
        {
          req,
          res,
          ablehnungsDrossel,
          auditFn: () => audit("auth_failed", req, "path=/mcp grund=kein_token"),
        },
        () => deny401(res, "invalid_token", "Kein Token"),
      );
    }
    try {
      const { payload } = await jwtVerify(token, await getJwks(), {
        issuer: config.auth.oauthIssuerUrl,
        audience: audience(),
        clockTolerance: 30,
        requiredClaims: ["exp"],
      });
      if (!hasRequiredScopes(payload)) {
        return mitAblehnungsDrossel(
          {
            req,
            res,
            ablehnungsDrossel,
            verifizierteSub: nichtLeererString(payload.sub),
            auditFn: () => audit("auth_failed", req, "path=/mcp grund=insufficient_scope"),
          },
          () => deny403InsufficientScope(res),
        );
      }
      req.auth = { sub: payload.sub, email: payload.email || null, claims: payload };
      next();
    } catch (err) {
      const verifizierteSub =
        err.code === "ERR_JWT_EXPIRED" ? nichtLeererString(err.payload?.sub) : null;
      mitAblehnungsDrossel(
        {
          req,
          res,
          ablehnungsDrossel,
          verifizierteSub,
          auditFn: () => audit("auth_failed", req, `path=/mcp grund=${err.code || "invalid_token"}`),
        },
        () => deny401(res, "invalid_token", "Token-Pruefung fehlgeschlagen"),
      );
    }
  };
}

function makeVerifyStatic({ ablehnungsDrossel, ipSperre }) {
  const lehneAb = (req, res, { grund, body }) =>
    mitAblehnungsDrossel(
      { req, res, ablehnungsDrossel, auditFn: () => audit("auth_failed", req, grund) },
      () => sendBearerChallenge(res, STATIC_BEARER_CHALLENGE, { body }),
    );

  return function verifyStatic(req, res, next) {
    if (!sende429WennGesperrt(res, ipSperre(req))) return;
    if (config.auth.mcpAuthToken) {
      if (safeEqual(req.headers.authorization || "", `Bearer ${config.auth.mcpAuthToken}`)) return next();
      return lehneAb(req, res, { grund: "path=/mcp", body: { error: "unauthorized" } });
    }
    if (config.auth.mcpAuth === "token") {
      return lehneAb(req, res, { grund: "path=/mcp grund=kein_token", body: { error: "unauthorized" } });
    }
    if (legacyLocalBypassAllowed(req)) return next();
    return lehneAb(req, res, {
      grund: "path=/mcp",
      body: {
        error: "MCP_AUTH_TOKEN nicht gesetzt - /mcp ist nur von localhost (ausserhalb Produktion) erreichbar",
      },
    });
  };
}

export function makeMcpAuth({ ablehnungsDrossel, ipSperre }) {
  if (!ablehnungsDrossel) throw new Error("makeMcpAuth: ablehnungsDrossel fehlt (fail-closed)");
  if (!ipSperre) throw new Error("makeMcpAuth: ipSperre fehlt (fail-closed)");
  const verifyOauth = makeVerifyOauth(ablehnungsDrossel);
  const verifyStatic = makeVerifyStatic({ ablehnungsDrossel, ipSperre });

  return async function mcpAuth(req, res, next) {
    if (config.auth.mcpAuth === "oauth") return verifyOauth(req, res, next);
    if (config.auth.mcpAuth === "off") return next();
    return verifyStatic(req, res, next);
  };
}

export function registerWellKnown(app) {
  const doc = () => {
    const authorizationServers = config.auth.oauthIssuerUrl ? [config.auth.oauthIssuerUrl] : [];
    return {
      resource: audience(),
      authorization_servers: authorizationServers,
      bearer_methods_supported: ["header"],
      ...(authorizationServers.length > 0 ? { scopes_supported: [...OAUTH_SCOPES] } : {}),
    };
  };
  app.get("/.well-known/oauth-protected-resource", (_q, res) => res.json(doc()));
  app.get("/.well-known/oauth-protected-resource/mcp", (_q, res) => res.json(doc()));
}
