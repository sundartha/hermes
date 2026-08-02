// ---- Routen-Auth-Politik (PLAN-AUTH-GATE P1) -------------------------------------
// Die maschinenlesbare Fassung von Absoluter Regel 3 (AUTH FAIL-CLOSED). Bis heute
// traegt ein einziges Basic-Auth-Gate (src/wiring/auth-gate.js) als Sammelsicherung
// alles, was nicht ausdruecklich ausgenommen ist. Diese Sammelsicherung faellt
// (Owner-Entscheidung, PLAN-AUTH-GATE.md). Ihr Ersatz ist kein zweites Gate, sondern
// eine Vollstaendigkeitspruefung: test/route-auth-inventory.test.js laeuft ueber den
// PRODUKTIONS-Routengraph und verlangt fuer JEDE Route eine bewusste Einordnung.
// Eine neue Route ohne Auth-Middleware und ohne Eintrag hier macht `npm test` rot.
//
// KEIN Laufzeit-Konsument, und das ist Absicht: eine zur Laufzeit ausgewertete
// Allowlist waere ein zweites Gate mit eigenem Umgehungsrisiko. Die Liste wirkt
// stattdessen zur Testzeit. Sie liegt trotzdem in src/ (nicht in test/), weil sie
// Teil des Produkt-Vertrags ist: wer eine Route hinzufuegt, muss sie HIER begruenden,
// nicht in einer Testdatei.
//
// GRENZE (bewusst offengelegt, PLAN-AUTH-GATE Abschnitt 5/W8): sichtbar ist nur
// route-level Middleware. NICHT sichtbar sind
//   (a) Auth im Handler-Rumpf (drei Faelle, unten namentlich mit Begruendung),
//   (b) Praefix-Middleware eines Routers (die /voice-Signaturpruefung),
//   (c) Routen, die nur hinter einem Flag registriert werden (POST /auth/dev-login
//       existiert nur bei DEV_LOGIN_ENABLED und taucht im geprueften Graph nicht auf).
// Fuer diese drei Klassen traegt der quartalsweise Pruefpunkt in
// docs/RUNBOOK-AUTH-REVIEW.md die Last - ein Mensch, kein Mechanismus.
//
// Pfade, fuer die es bereits eine benannte Konstante gibt, werden importiert statt
// als Literal wiederholt (G5/G25) - test/p14-checkout-return-app-shell.test.js pinnt
// das fuer den Altpfad ausdruecklich.
import { APP_PATH, LEGACY_PORTAL_PATH } from "./portal-paths.js";

// Benannte Auth-Middlewares. Der Inventar-Test erkennt sie an handler.name in der
// Route-Handler-Kette. INVARIANTE: diese Middlewares MUESSEN benannte Funktionen
// bleiben - eine anonyme Arrow waere im Express-Stack "<anonymous>" und damit fuer
// den Test unsichtbar (die Route saehe ungeschuetzt aus und der Test schluege an;
// umgekehrt duerfte niemand eine Route durch Umbenennen still "schuetzen").
export const AUTH_MIDDLEWARE_NAMES = Object.freeze([
  // src/web-auth.js - Browser-Session (signiertes Cookie + DB-Session + aktiver Account)
  "webAuthGateMiddleware",
  // src/web-auth.js - zusaetzliche Admin-Stufe (role==='admin' ODER ADMIN_EMAILS)
  "adminOnlyMiddleware",
  // src/auth.js - MCP-Bearer/OIDC, fail-closed
  "mcpAuth",
  // src/wiring/internal-only.js - genuin lokaler In-Process-Aufrufer
  // (echter Loopback-Socket OHNE X-Forwarded-For), AUTH-P5
  "internalOnly",
]);

// Einordnung einer Route durch den Inventar-Test.
export const ROUTE_CLASS = Object.freeze({
  AUTH: "auth", // traegt eine benannte Auth-Middleware
  PUBLIC: "public", // bewusst oeffentlich bzw. handler-intern abgesichert
  GATE_ONLY: "gate_only", // haengt HEUTE allein am Basic-Auth-Gate (Restarbeit)
  UNPROTECTED: "unprotected", // nirgends eingeordnet -> Testfehler
});

// ---- Bewusst oeffentlich bzw. handler-intern abgesichert --------------------------
// Jeder Eintrag nennt seine Sicherung. "oeffentlich" heisst hier: es gibt nichts zu
// schuetzen (statisches Asset, oeffentlicher Katalog) ODER die Sicherung sitzt im
// Handler und ist darum von aussen nicht als Middleware sichtbar.

// Begruendungen, die sich mehrere Routen teilen - EINE Quelle (G5), damit eine
// Praezisierung nicht an fuenf Stellen nachgezogen werden muss.
const VOICE_SIGNATURE_REASON =
  "PRAEFIX-MIDDLEWARE (Runbook-Fall 3): Provider-Signaturpruefung (Twilio HMAC / Telnyx " +
  "Ed25519, fail-closed) sitzt vor allen /voice-Handlern, nicht an der einzelnen Route.";
const MCP_METHOD_NOT_ALLOWED_REASON =
  "Fester 405 (der Transport ist POST-only). Kein Zustand, kein Inhalt.";

export const PUBLIC_ROUTES = Object.freeze([
  {
    method: "GET",
    path: "/healthz",
    reason:
      "Keep-Alive + Deploy-Wahrheit (Commit-SHA, Einweg-Hash). Traegt keinen Rohwert und kein Secret.",
  },
  {
    method: "GET",
    path: "/api/plans",
    reason:
      "Oeffentlicher Tarifkatalog, Spiegel von sundartha.com/preise. Keine Tenant-Daten, kein Schreibpfad.",
  },
  {
    method: "GET",
    path: "/.well-known/oauth-protected-resource",
    reason: "OAuth-Metadata - muss per Spezifikation ohne Login erreichbar sein.",
  },
  {
    method: "GET",
    path: "/.well-known/oauth-protected-resource/mcp",
    reason: "OAuth-Metadata (MCP-Variante) - muss ohne Login erreichbar sein.",
  },
  {
    method: "POST",
    path: "/v1/chat/completions",
    reason:
      "HANDLER-INTERNE AUTH (Runbook-Fall 2): Telnyx BYO-LLM ruft serverseitig, kann keinen " +
      "Session-Cookie senden. Absicherung im Handler: 404 bei abgeschaltetem Assistant-Flag " +
      "plus timing-sicherer Bearer-Vergleich (safeEqual) gegen das Shim-Secret.",
  },
  {
    method: "GET",
    path: "/auth/login",
    reason: "Einstieg in den OIDC-Login. Vor der Anmeldung existiert keine Identitaet.",
  },
  {
    method: "GET",
    path: "/auth/callback",
    reason:
      "OIDC-Rueckkehr. Die Sicherung ist der state-/PKCE-/nonce-Abgleich im Handler gegen die " +
      "signierten Login-Cookies - eine Session gibt es an dieser Stelle noch nicht.",
  },
  {
    method: "POST",
    path: "/auth/logout",
    reason:
      "Beendet ausschliesslich die Session des Aufrufers. Ohne gueltige Session ist der Aufruf " +
      "wirkungslos; ein Auth-Zwang wuerde nur das Aufraeumen einer kaputten Session verhindern.",
  },
  {
    method: "POST",
    path: "/webhooks/stripe",
    reason:
      "HANDLER-INTERNE AUTH: Stripe kann keine Credentials senden. Sicherung ist die " +
      "HMAC-Signaturpruefung gegen STRIPE_WEBHOOK_SECRET (fail-closed); ohne PAYMENT_ENABLED 404.",
  },
  {
    method: "GET",
    path: LEGACY_PORTAL_PATH,
    reason:
      "302 auf /app (Altpfad-Umleitung fuer Bookmarks und vor dem Deploy geoeffnete " +
      "Stripe-Sessions). Liefert keine Daten.",
  },
  {
    method: "GET",
    path: `${APP_PATH}/*`,
    reason:
      "SPA-Fallback auf die statische App-Shell. Statisches HTML/JS ohne Tenant-Daten; jede " +
      "Tenant-Sicht laedt erst ueber /api/self-service/* hinter der Session.",
  },
  {
    method: "GET",
    path: "/voice/tts/:token",
    reason:
      "HANDLER-INTERNE AUTH (Runbook-Fall 1): Einmal-Token mit TTL, im Handler per takeOnce " +
      "verbraucht. Liegt bewusst VOR der Signatur-Middleware, weil der Provider das Audio " +
      "ohne Signatur abholt.",
  },
  {
    method: "POST",
    path: "/voice/incoming",
    reason: VOICE_SIGNATURE_REASON,
  },
  {
    method: "POST",
    path: "/voice/turn",
    reason: VOICE_SIGNATURE_REASON,
  },
  {
    method: "POST",
    path: "/voice/outbound",
    reason: VOICE_SIGNATURE_REASON,
  },
  {
    method: "POST",
    path: "/voice/status",
    reason: VOICE_SIGNATURE_REASON,
  },
  {
    method: "POST",
    path: "/voice/call-control",
    reason: VOICE_SIGNATURE_REASON,
  },
  {
    method: "GET",
    path: "/mcp",
    reason: MCP_METHOD_NOT_ALLOWED_REASON,
  },
  {
    method: "DELETE",
    path: "/mcp",
    reason: MCP_METHOD_NOT_ALLOWED_REASON,
  },
]);

// ---- Restarbeit: haengt HEUTE allein am Basic-Auth-Gate ---------------------------
// Diese Routen sind NICHT oeffentlich. Sie sind geschuetzt - aber ausschliesslich
// durch die Sammelsicherung, die dieser Plan aufloest. Der Inventar-Test laesst sie
// deshalb durch und haelt sie zugleich sichtbar: die Liste IST die Arbeitsliste.
//
// HARTE VORBEDINGUNG FUER P7: das Gate darf erst fallen, wenn diese Liste LEER ist.
// Jede Zeile verschwindet hier erst dann, wenn die Route in P4 geloescht (b2) oder in
// P5/P6 mit eigener Auth versehen wurde (b1). Waere sie stattdessen nach PUBLIC_ROUTES
// gewandert, haette der Test gruen gemeldet, was in Wahrheit eine offene Tuer ist.
//
// Stand nach AUTH-P6: nur noch das Legacy-Checkout-Paar. P7 darf das Gate erst nehmen,
// wenn diese Liste leer ist (P9 leert sie).
export const GATE_ONLY_ROUTES = Object.freeze([
  { method: "POST", path: "/api/billing/setup-checkout", plan: "P9 loeschen (Karenz)" },
  { method: "GET", path: "/api/billing/checkout-return", plan: "P9 loeschen (Karenz)" },
]);

// Schluessel einer Route. EINE Quelle fuer beide Listen und den Test (G5).
export const routeKey = (method, path) => `${String(method).toUpperCase()} ${path}`;

const PUBLIC_KEYS = new Set(PUBLIC_ROUTES.map((r) => routeKey(r.method, r.path)));
const GATE_ONLY_KEYS = new Set(GATE_ONLY_ROUTES.map((r) => routeKey(r.method, r.path)));

// Einordnung einer einzelnen Route. Reine Funktion (kein Express, kein Zustand) -
// damit sie mit synthetischen Eingaben pruefbar ist, ohne die App zu bauen.
// handlerNames = die Namen der Route-Handler-Kette in Mount-Reihenfolge.
// Reihenfolge der Pruefung ist load-bearing: eine Route mit echter Auth-Middleware
// gilt als geschuetzt, auch wenn sie (noch) in einer der Listen steht - sonst
// meldete der Test nach P5/P6 einen Fehler fuer Routen, die gerade abgesichert wurden.
export function classifyRoute({ method, path, handlerNames = [] }) {
  if (handlerNames.some((name) => AUTH_MIDDLEWARE_NAMES.includes(name))) return ROUTE_CLASS.AUTH;
  const key = routeKey(method, path);
  if (PUBLIC_KEYS.has(key)) return ROUTE_CLASS.PUBLIC;
  if (GATE_ONLY_KEYS.has(key)) return ROUTE_CLASS.GATE_ONLY;
  return ROUTE_CLASS.UNPROTECTED;
}
