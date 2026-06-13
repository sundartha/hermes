// Auth fuer /mcp: statisches Bearer-Token (Legacy/token) oder OAuth 2.1 als
// Resource Server (oauth). Das Gateway prueft nur Tokens - kein eigener Login,
// keine Sessions. Niemals Tokens loggen.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";
import { audit, safeEqual } from "./util.js";

// Localhost anhand der echten Socket-Adresse (nicht spoofbar via X-Forwarded-For).
const isLocalSocket = (req) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

// Erwartete Audience: explizit gesetzt oder kanonische MCP-URL.
const audience = () => config.oauthAudience || `${config.publicUrl}/mcp`;
const metadataUrl = () => `${config.publicUrl}/.well-known/oauth-protected-resource`;

// JWKS-URI ueber die Standard-Metadata des Issuers finden. Beide gaengigen
// Pfade versuchen: OIDC (openid-configuration) und OAuth 2.1 AS-Metadata
// (oauth-authorization-server, so dokumentiert WorkOS AuthKit). Erster Treffer
// mit jwks_uri gewinnt.
async function discoverJwksUri() {
  const paths = ["/.well-known/openid-configuration", "/.well-known/oauth-authorization-server"];
  let lastErr;
  for (const p of paths) {
    try {
      const r = await fetch(`${config.oauthIssuerUrl}${p}`);
      if (!r.ok) {
        lastErr = new Error(`${p} HTTP ${r.status}`);
        continue;
      }
      const { jwks_uri } = await r.json();
      if (jwks_uri) return jwks_uri;
      lastErr = new Error(`${p} ohne jwks_uri`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("keine OAuth-Metadata gefunden");
}

// Remote-JWKS, von jose gecacht. Lazy: erst beim ersten Token-Check geladen,
// damit der Server auch ohne erreichbaren IdP startet.
let jwks = null;
async function getJwks() {
  if (jwks) return jwks;
  jwks = createRemoteJWKSet(new URL(await discoverJwksUri()));
  return jwks;
}

// Test-Naht: erlaubt das Zuruecksetzen des JWKS-Caches zwischen Testlaeufen.
export function _resetJwksCache() {
  jwks = null;
}

// RFC 6750 / 9728: 401 mit WWW-Authenticate-Header inkl. Verweis auf die
// Protected-Resource-Metadata, damit der Client den Auth-Server findet.
function deny401(res, error, description) {
  res.set(
    "WWW-Authenticate",
    `Bearer resource_metadata="${metadataUrl()}", error="${error}", error_description="${description}"`
  );
  return res.status(401).json({ error: description });
}

async function verifyOauth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    audit("auth_failed", req, "path=/mcp grund=kein_token");
    return deny401(res, "invalid_token", "Kein Token");
  }
  try {
    const { payload } = await jwtVerify(token, await getJwks(), {
      issuer: config.oauthIssuerUrl,
      audience: audience(),
      clockTolerance: 30,
    });
    req.auth = { sub: payload.sub, email: payload.email || null, claims: payload };
    next();
  } catch (e) {
    audit("auth_failed", req, `path=/mcp grund=${e.code || "invalid_token"}`);
    deny401(res, "invalid_token", "Token-Pruefung fehlgeschlagen");
  }
}

// Express-Middleware vor POST /mcp.
export async function mcpAuth(req, res, next) {
  if (config.mcpAuth === "oauth") return verifyOauth(req, res, next);
  if (config.mcpAuth === "off") return next();

  // Modus "token" und Legacy ("") teilen die statische Bearer-Pruefung.
  if (config.mcpAuthToken) {
    if (safeEqual(req.headers.authorization || "", `Bearer ${config.mcpAuthToken}`)) return next();
    audit("auth_failed", req, "path=/mcp");
    return res.status(401).json({ error: "unauthorized" });
  }
  // Kein Token gesetzt: "token" verlangt trotzdem eines, Legacy faellt auf
  // localhost-only zurueck (fail-closed wie seit Phase 1).
  if (config.mcpAuth === "token") {
    audit("auth_failed", req, "path=/mcp grund=kein_token");
    return res.status(401).json({ error: "unauthorized" });
  }
  if (isLocalSocket(req)) return next();
  audit("auth_failed", req, "path=/mcp");
  return res.status(401).json({ error: "MCP_AUTH_TOKEN nicht gesetzt - /mcp ist nur von localhost erreichbar" });
}

// RFC 9728: Protected Resource Metadata. Beide Pfade bedienen (generisch und
// pfadbezogen), weil MCP-Clients hier unterschiedlich raten.
export function registerWellKnown(app) {
  const doc = () => ({
    resource: audience(),
    authorization_servers: config.oauthIssuerUrl ? [config.oauthIssuerUrl] : [],
    bearer_methods_supported: ["header"],
  });
  app.get("/.well-known/oauth-protected-resource", (_q, res) => res.json(doc()));
  app.get("/.well-known/oauth-protected-resource/mcp", (_q, res) => res.json(doc()));
}
