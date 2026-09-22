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

// T-16/T-12 (T2-23): EINE Scope-Menge, gelesen von PRM (scopes_supported), der
// oauth-401-Challenge (scope=) und securitySchemes (src/mcp-security-schemes.js) -
// einzige Stelle im Code mit diesen Literalen. "openid"+"email" ist T-16 (OpenAI
// verlangt genau diese Identitaets-Scopes); "offline_access" ist noetig, weil ein
// spec-treuer Client nach dieser Aenderung nur noch die Challenge-/PRM-Menge anfragt -
// ohne offline_access bekaeme er nie ein Refresh-Token. Kein "profile" (Minimalmenge),
// keine erfundenen Hermes-Scopes (calls:write o.ae.): der Auth-Server bewirbt nur
// Identitaets-Scopes (docs/OPENAI-AUTH-ABWEICHUNGEN.md), ein erfundener Scope wuerde
// beim Auth-Server als invalid_scope scheitern. Keine Env-Var: die Menge ist eine
// Produktentscheidung, kein Umgebungswert - Rueckweg ist ein Revert dieses Commits.
export const OAUTH_SCOPES = Object.freeze(["openid", "email", "offline_access"]);
const OAUTH_SCOPE_PARAM = OAUTH_SCOPES.join(" ");

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

// RFC 6750 / 9728: jede Bearer-Challenge-Antwort von /mcp setzt Header und Status
// gemeinsam. Einzige Stelle im Modul, die "WWW-Authenticate" setzt. `status` faellt
// auf 401 zurueck (der haeufige Fall - alle Zweige ausser Scope-Mangel); 403 nutzt
// `deny403InsufficientScope` explizit. Optionen statt eines vierten Positionsarguments
// (Argument-Obergrenze .claude/refs/clean-code.md).
const HTTP_UNAUTHORIZED = 401;
function sendBearerChallenge(res, challenge, { body, status = HTTP_UNAUTHORIZED } = {}) {
  res.set("WWW-Authenticate", challenge);
  return res.status(status).json(body);
}

// Reiner Baustein: setzt eine geordnete Parameterliste zu einem Bearer-Challenge-
// String zusammen. `resource_metadata` bleibt ERSTER Parameter
// (test/openai-p7-token-pruefachsen.test.js:47 prueft `^Bearer resource_metadata="`).
function bearerChallenge(paare) {
  return `Bearer ${paare.map(([schluessel, wert]) => `${schluessel}="${wert}"`).join(", ")}`;
}

// oauth-Zweig: Challenge inkl. Verweis auf die Protected-Resource-Metadata und der
// erwarteten Scope-Menge (T-16), damit der Client den Auth-Server findet und weiss,
// welche Scopes er anfragen muss.
function deny401(res, error, description) {
  const challenge = bearerChallenge([
    ["resource_metadata", metadataUrl()],
    ["scope", OAUTH_SCOPE_PARAM],
    ["error", error],
    ["error_description", description],
  ]);
  return sendBearerChallenge(res, challenge, { body: { error: description } });
}

// T-12 (T2-23, Commit B): welche Scopes traegt das Token? RFC 6749/8693 kennt zwei
// Schreibweisen - `scope` als leerzeichengetrennter String (der ueblichere Fall) oder
// `scp` als Array (manche IdPs, z.B. Azure AD) oder ebenfalls als String. Fehlt
// beides, ist die Menge leer - das Token traegt dann garantiert nicht alle
// Elemente von OAUTH_SCOPES und die Pruefung unten schlaegt fehl (fail-closed).
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
  return OAUTH_SCOPES.every((scope) => granted.has(scope));
}

const HTTP_FORBIDDEN = 403;

// RFC 6750 Runtime Insufficient Scope Errors: 403 statt 401 - das Token selbst ist
// gueltig, es fehlt nur die geforderte Scope-Menge. Parameterreihenfolge wie im Plan
// (T2-23) woertlich uebernommen: error, scope, resource_metadata, error_description -
// bewusst ANDERS als deny401 (dort resource_metadata zuerst), weil dies eine andere
// RFC-Fehlerklasse ist, keine Variante derselben Challenge.
function deny403InsufficientScope(res) {
  const challenge = bearerChallenge([
    ["error", "insufficient_scope"],
    ["scope", OAUTH_SCOPE_PARAM],
    ["resource_metadata", metadataUrl()],
    ["error_description", "Token traegt nicht alle geforderten Scopes"],
  ]);
  return sendBearerChallenge(res, challenge, { body: { error: "insufficient_scope" }, status: HTTP_FORBIDDEN });
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
      // T-12: jose prueft exp nur, wenn der Claim vorhanden ist - ohne diese Zeile
      // gilt ein signiertes Token OHNE exp unbefristet. requiredClaims erzwingt den
      // Claim; fehlt er, wirft jwtVerify (ERR_JWT_CLAIM_VALIDATION_FAILED) und landet
      // im catch-Zweig unten -> 401 + oauth-Challenge, kein Token im Audit-Log.
      requiredClaims: ["exp"],
    });
    // T-12 (Commit B): das Token muss jedes Element von OAUTH_SCOPES tragen - erst
    // NACH erfolgreicher Signatur-/Claim-Pruefung, damit ein manipuliertes Token nie
    // bis hierher kommt. Audit ohne Token- oder Claim-Inhalt (nur der Grund).
    if (!hasRequiredScopes(payload)) {
      audit("auth_failed", req, "path=/mcp grund=insufficient_scope");
      return deny403InsufficientScope(res);
    }
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
    return sendBearerChallenge(res, STATIC_BEARER_CHALLENGE, { body: { error: "unauthorized" } });
  }
  // Kein Token gesetzt: "token" verlangt trotzdem eines, Legacy faellt AUSSERHALB der
  // Produktion auf localhost-only zurueck (fail-closed wie seit Phase 1). In Produktion
  // ist der Socket-Bypass deaktiviert (AM1) -> 401, auch von localhost.
  if (config.auth.mcpAuth === "token") {
    audit("auth_failed", req, "path=/mcp grund=kein_token");
    return sendBearerChallenge(res, STATIC_BEARER_CHALLENGE, { body: { error: "unauthorized" } });
  }
  if (legacyLocalBypassAllowed(req)) return next();
  audit("auth_failed", req, "path=/mcp");
  return sendBearerChallenge(res, STATIC_BEARER_CHALLENGE, {
    body: { error: "MCP_AUTH_TOKEN nicht gesetzt - /mcp ist nur von localhost (ausserhalb Produktion) erreichbar" },
  });
}

// RFC 9728: Protected Resource Metadata. Beide Pfade bedienen (generisch und
// pfadbezogen), weil MCP-Clients hier unterschiedlich raten.
export function registerWellKnown(app) {
  const doc = () => {
    const authorizationServers = config.auth.oauthIssuerUrl ? [config.auth.oauthIssuerUrl] : [];
    return {
      resource: audience(),
      authorization_servers: authorizationServers,
      bearer_methods_supported: ["header"],
      // T-16: scopes_supported NUR mit Authorization-Server - ohne einen ist die
      // Menge bedeutungslos (kein AS, der sie ausstellen koennte), Feld bleibt dann
      // abwesend statt einer leeren Liste.
      ...(authorizationServers.length > 0 ? { scopes_supported: [...OAUTH_SCOPES] } : {}),
    };
  };
  app.get("/.well-known/oauth-protected-resource", (_q, res) => res.json(doc()));
  app.get("/.well-known/oauth-protected-resource/mcp", (_q, res) => res.json(doc()));
}
