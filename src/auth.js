// Auth fuer /mcp: statisches Bearer-Token (Legacy/token) oder OAuth 2.1 als
// Resource Server (oauth). Das Gateway prueft nur Tokens - kein eigener Login,
// keine Sessions. Niemals Tokens loggen.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";
import { audit, safeEqual } from "./util.js";

// Localhost anhand der echten Socket-Adresse (nicht spoofbar via X-Forwarded-For).
// ACHTUNG: hinter einem Reverse-Proxy (Render) ist remoteAddress IMMER der Loopback-
// Sidecar -> fuer den /mcp-Bypass deshalb NUR ueber legacyLocalBypassAllowed nutzen.
const isLocalSocket = (req) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

// AM1: Der Legacy-Socket-Bypass (MCP_AUTH="" ohne MCP_AUTH_TOKEN) ist reine lokale Dev-
// Bequemlichkeit und darf in Produktion /mcp NIE oeffnen (s.o. - dort ist jeder Request
// "localhost"). Nur ausserhalb der Produktion (config.server.isProduction = RENDER_EXTERNAL_URL).
// isProduction injizierbar -> unit-testbar (Muster productionFootguns). Reine Query.
export function legacyLocalBypassAllowed(req, isProduction = config.server.isProduction) {
  return !isProduction && isLocalSocket(req);
}

// Erwartete Audience: explizit gesetzt oder kanonische MCP-URL.
const audience = () => config.auth.oauthAudience || `${config.server.publicUrl}/mcp`;
const metadataUrl = () => `${config.server.publicUrl}/.well-known/oauth-protected-resource`;

// JWKS-URI ueber die Standard-Metadata des Issuers finden. Beide gaengigen
// Pfade versuchen: OIDC (openid-configuration) und OAuth 2.1 AS-Metadata
// (oauth-authorization-server, so dokumentiert WorkOS AuthKit). Erster Treffer
// mit jwks_uri gewinnt.
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

// RFC 6750 / 9728: jeder 401 von /mcp traegt eine Bearer-Challenge. Einzige
// Stelle im Modul, die den WWW-Authenticate-Header setzt und den 401-Code sendet.
const HTTP_UNAUTHORIZED = 401;
function sendBearer401(res, challenge, body) {
  res.set("WWW-Authenticate", challenge);
  return res.status(HTTP_UNAUTHORIZED).json(body);
}

// oauth-Zweig: Challenge inkl. Verweis auf die Protected-Resource-Metadata,
// damit der Client den Auth-Server findet.
function deny401(res, error, description) {
  const challenge = `Bearer resource_metadata="${metadataUrl()}", error="${error}", error_description="${description}"`;
  return sendBearer401(res, challenge, { error: description });
}

// token- und Legacy-Zweig sprechen kein OAuth: kein resource_metadata-Verweis IM
// HEADER, der schickte den Client in eine Discovery, deren Token dieser Zweig nie
// annimmt (P6, Lead-Entscheidung 3). RFC 6750 SS3 erlaubt die Bearer-Challenge
// ohne diesen Parameter. Das Well-known-Dokument selbst (registerWellKnown weiter
// unten, /.well-known/oauth-protected-resource) wird davon NICHT beruehrt - es wird
// in JEDEM mcpAuth-Modus ausgeliefert, ungated. Ein Client, der der Spec folgt,
// faellt bei fehlendem Header-Verweis auf diese Well-known-URI zurueck; steht dort
// ein OAUTH_ISSUER_URL, findet er den Authorization-Server auch ohne den Header.
// Der fehlende Header verhindert also keine Discovery - er verweigert nur die
// Abkuerzung darauf.
const STATIC_BEARER_CHALLENGE = 'Bearer error="invalid_token"';

async function verifyOauth(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) {
    audit("auth_failed", req, "path=/mcp grund=kein_token");
    return deny401(res, "invalid_token", "Kein Token");
  }
  try {
    const { payload } = await jwtVerify(token, await getJwks(), {
      issuer: config.auth.oauthIssuerUrl,
      audience: audience(),
      clockTolerance: 30,
    });
    // no-param-reassign: dasselbe Express-Idiom wie req.tenant in web-auth.js:838,
    // dort ebenso ueber eslint-suppressions.json (count:1) akzeptiert statt einer
    // Regel-Ausnahme - eine dateiweite Ausnahme wuerde eine ZWEITE req.xyz-Zuweisung
    // an anderer Stelle dieser Datei unbemerkt durchlassen (P6-Review Runde 2).
    req.auth = { sub: payload.sub, email: payload.email || null, claims: payload };
    next();
  } catch (err) {
    audit("auth_failed", req, `path=/mcp grund=${err.code || "invalid_token"}`);
    deny401(res, "invalid_token", "Token-Pruefung fehlgeschlagen");
  }
}

// Express-Middleware vor POST /mcp.
export async function mcpAuth(req, res, next) {
  if (config.auth.mcpAuth === "oauth") return verifyOauth(req, res, next);
  if (config.auth.mcpAuth === "off") return next();

  // Modus "token" und Legacy ("") teilen die statische Bearer-Pruefung.
  if (config.auth.mcpAuthToken) {
    if (safeEqual(req.headers.authorization || "", `Bearer ${config.auth.mcpAuthToken}`)) return next();
    audit("auth_failed", req, "path=/mcp");
    return sendBearer401(res, STATIC_BEARER_CHALLENGE, { error: "unauthorized" });
  }
  // Kein Token gesetzt: "token" verlangt trotzdem eines, Legacy faellt AUSSERHALB der
  // Produktion auf localhost-only zurueck (fail-closed wie seit Phase 1). In Produktion
  // ist der Socket-Bypass deaktiviert (AM1) -> 401, auch von localhost.
  if (config.auth.mcpAuth === "token") {
    audit("auth_failed", req, "path=/mcp grund=kein_token");
    return sendBearer401(res, STATIC_BEARER_CHALLENGE, { error: "unauthorized" });
  }
  if (legacyLocalBypassAllowed(req)) return next();
  audit("auth_failed", req, "path=/mcp");
  return sendBearer401(res, STATIC_BEARER_CHALLENGE, {
    error: "MCP_AUTH_TOKEN nicht gesetzt - /mcp ist nur von localhost (ausserhalb Produktion) erreichbar",
  });
}

// RFC 9728: Protected Resource Metadata. Beide Pfade bedienen (generisch und
// pfadbezogen), weil MCP-Clients hier unterschiedlich raten.
export function registerWellKnown(app) {
  const doc = () => ({
    resource: audience(),
    authorization_servers: config.auth.oauthIssuerUrl ? [config.auth.oauthIssuerUrl] : [],
    bearer_methods_supported: ["header"],
  });
  app.get("/.well-known/oauth-protected-resource", (_q, res) => res.json(doc()));
  app.get("/.well-known/oauth-protected-resource/mcp", (_q, res) => res.json(doc()));
}
