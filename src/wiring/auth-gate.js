// ---- makeAuthGate (Server-Slim P14) ---------------------------------------------
// Kern-Safety-Naht: das Basic-Auth-Gate fuer Dashboard + Owner-Legacy-API (Public
// Hosting) als einzeln unit-testbare Middleware-Factory. REINE Verschiebung aus
// server.js (byte-identische Exemption-Reihenfolge, Semantik, 401-Antwort, Audit-
// Event) - Teil der server.js-Decomposition (PLAN-SERVER-SLIM P14). Mount an
// UNVERAENDERTER Position (nach der WEB_DIST_DIR-Static-Schicht, VOR
// express.static(publicDir), INV-2). AUTH FAIL-CLOSED (Absolute Regel 3): ohne
// gueltige Credentials -> 401. Die Exemption-Reihenfolge ist EINGEFROREN (INV-3,
// test/auth-gate-exemption-order.test.js): CUSTOMER_PORTAL_PATH (nur unter
// SELF_SERVICE + MULTI_TENANT) -> /voice* -> /mcp* -> /.well-known* ->
// STRIPE_WEBHOOK_PATH -> /healthz -> BRAND_ASSETS_PREFIX* -> /favicon.ico ->
// isTrustedLocalCaller -> safeEqual. Jede ausgelassene Exemption blockt einen
// Provider (tote Webhooks); jede zusaetzliche oeffnet das Dashboard.
//
import { isSelfServiceLive } from "../config.js";

// deps (injiziert, EINE Quelle je Kollaborator, DIP/G5): config wird per-Request
// gelesen (dashboardPassword/selfServiceEnabled/multiTenant) -> die Factory SCHLIESST
// config, friert es NICHT zur Import-Zeit ein (wie makeVoiceRender). audit=util.audit
// (loggt nur den Pfad, kein Secret). safeEqual=util.safeEqual (timing-sicher,
// unveraendert). isTrustedLocalCaller=request-tenant.js. BRAND_ASSETS_PREFIX=
// mcp-server-info.js. VOICE_PATH_PREFIX=app.js (EINE Quelle, G5, geteilt mit
// rawBody-Capture + Rate-Limit-Bypass). paths.STRIPE_WEBHOOK_PATH bleibt EINE Quelle (INV-1).
export function makeAuthGate({
  config,
  audit,
  isTrustedLocalCaller,
  safeEqual,
  BRAND_ASSETS_PREFIX,
  VOICE_PATH_PREFIX,
  paths: { STRIPE_WEBHOOK_PATH, CUSTOMER_PORTAL_PATH },
}) {
  return (req, res, next) => {
    if (!config.dashboardPassword) return next();
    // Self-Service-Seite (I9 + #3) ist die GETRENNTE Tenant-Sicht: NICHT hinter der
    // Admin-Basic-Auth. Nur die statische HTML-Seite ist frei - sie enthaelt KEINE
    // Tenant-Daten (die kommen ueber /api/self-service/*, abgesichert per webAuthMw +
    // Session-Cookie aus dem OIDC-Browser-Login, nicht mehr per Bearer-Paste).
    // Hinter den Flags (Self-Service + MULTI_TENANT): aus -> nicht ausgenommen ->
    // byte-identisch zum Bestand.
    if (isSelfServiceLive(config) && req.path === CUSTOMER_PORTAL_PATH) return next();
    // /webhooks/stripe ist Basic-Auth-exempt: Stripe kann KEINE Basic-Auth-Credentials
    // senden. Die Sicherung ist die HMAC-Signaturpruefung gegen STRIPE_WEBHOOK_SECRET
    // (fail-closed, Regel 3) - exakt analog zu /voice (Twilio-/Telnyx-Signatur). Zusaetzlich
    // PAYMENT_ENABLED-gegated (aus -> 404). Der Handler liegt im guardedBoot-Block (braucht
    // accounts/sessions), die Exemption hier ist die Basic-Auth-Vorschaltung.
    if (
      req.path.startsWith(VOICE_PATH_PREFIX) ||
      req.path.startsWith("/mcp") ||
      req.path.startsWith("/.well-known") ||
      req.path === STRIPE_WEBHOOK_PATH ||
      req.path === "/healthz" ||
      // T3: das Server-Icon (public/brand/*, Quelle src/mcp-server-info.js) ist keine
      // sensible Nutzdaten-Route, nur ein statisches PNG. Ein MCP-Host laedt
      // icons[0].src aus der initialize-Antwort OHNE Dashboard-Credentials - ohne diese
      // Ausnahme liefert die express.static-Route weiter unten in Produktion
      // (DASHBOARD_PASSWORD gesetzt) 401 statt des Icons, der T3-Fix waere live
      // wirkungslos (empirisch geprueft, exakt wie die STRIPE_WEBHOOK_PATH-Begruendung
      // oben: eng auf ein Praefix begrenzt, kein Blanket-Bypass).
      req.path.startsWith(BRAND_ASSETS_PREFIX) ||
      // Favicon-Konvention: Icon-Fetcher (Browser-Tabs, Connector-UIs wie
      // claude.ai) ziehen /favicon.ico OHNE Credentials von der Wurzel - hinter
      // Basic-Auth antwortete die Route in Produktion 401 (empirisch 2026-07-02),
      // der Host fiel auf einen generischen Platzhalter zurueck. Dieselbe enge
      // Ein-Pfad-Begruendung wie BRAND_ASSETS_PREFIX: ein statisches, oeffentliches
      // Marken-Asset, keine Nutzdaten.
      req.path === "/favicon.ico"
    )
      return next();
    // Genuiner lokaler In-Process-Aufrufer (MCP-Tools rufen die eigene /api ueber
    // http://localhost) ist von der Basic-Auth ausgenommen. NICHT per Socket-Adresse
    // allein: hinter Render ist auch externer Traffic Loopback -> das oeffnete Dashboard
    // + API ohne Passwort fuer das ganze Internet (AM1, empirisch bestaetigt).
    // isTrustedLocalCaller verlangt zusaetzlich KEIN X-Forwarded-For (Proxy-Weiterleitung).
    if (isTrustedLocalCaller(req)) return next();
    const expected = "Basic " + Buffer.from("admin:" + config.dashboardPassword).toString("base64");
    if (safeEqual(req.headers.authorization || "", expected)) return next();
    audit("auth_failed", req, `path=${req.path}`);
    res.set("WWW-Authenticate", 'Basic realm="Hermes"');
    res.status(401).send("Auth required");
  };
}
