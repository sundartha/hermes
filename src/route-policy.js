// ---- Routen-Auth-Politik (PLAN-AUTH-GATE P1) -------------------------------------
// Die maschinenlesbare Fassung von Absoluter Regel 3 (AUTH FAIL-CLOSED). Bis AUTH-P7
// trug ein einziges Basic-Auth-Gate als Sammelsicherung alles, was nicht ausdruecklich
// ausgenommen war. Diese Sammelsicherung ist gefallen (Owner-Entscheidung,
// PLAN-AUTH-GATE.md). Ihr Ersatz ist kein zweites Gate, sondern eine
// Vollstaendigkeitspruefung: test/route-auth-inventory.test.js laeuft ueber den
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
import { APP_PATH, LEGACY_PORTAL_PATH, LOGIN_ALIAS_PATHS, APP_ALIAS_PATHS } from "./portal-paths.js";
import { ELEVENLABS_INIT_PATH } from "./routes/webhooks-elevenlabs-init.js";
import { COOKIE_CONSENT_PATH } from "./cookie-consent-log.js";
import { PUBLIC_CANCELLATION_PATH } from "./public-cancellation-routes.js";

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
  GATE_ONLY: "gate_only", // haengt allein an einer Sammelsicherung (seit AUTH-P7 leer, bleibt als Mechanismus)
  UNPROTECTED: "unprotected", // nirgends eingeordnet -> Testfehler
});

// ---- Bewusst oeffentlich bzw. handler-intern abgesichert --------------------------
// Jeder Eintrag nennt seine Sicherung. "oeffentlich" heisst hier: es gibt nichts zu
// schuetzen (statisches Asset, oeffentlicher Katalog) ODER die Sicherung sitzt im
// Handler und ist darum von aussen nicht als Middleware sichtbar.

// Begruendungen, die sich mehrere Routen teilen - EINE Quelle (G5), damit eine
// Praezisierung nicht an fuenf Stellen nachgezogen werden muss.
const VOICE_SIGNATURE_REASON =
  "PRAEFIX-MIDDLEWARE (Runbook-Fall 3): Provider-Signaturpruefung (Telnyx Ed25519, " +
  "fail-closed) sitzt vor allen /voice-Handlern, nicht an der einzelnen Route.";
const MCP_METHOD_NOT_ALLOWED_REASON =
  "Fester 405 (der Transport ist POST-only). Kein Zustand, kein Inhalt.";
const ALIAS_REASON =
  "302-Umleitung einer von Hand getippten Adresse (AUTH-P7). Liefert keine Daten, liest " +
  "keinen Zustand, reicht keinen Query weiter; das Ziel ist eine Konstante, nie eine " +
  "Eingabe. Die Sicherung liegt am ZIEL, nicht hier.";

export const PUBLIC_ROUTES = Object.freeze([
  {
    method: "GET",
    path: "/healthz",
    reason:
      "Keep-Alive + Deploy-Wahrheit (nur Commit-SHA, seit OpenAI-P10b ohne configHash - " +
      "Preimage-Befund). Kein Rohwert, kein Hash, kein Secret.",
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
    method: "GET",
    path: "/.well-known/openai-apps-challenge",
    reason:
      "Domain-Ownership-Challenge der OpenAI-Einreichung (O-4/O-5) - der Zweck IST die " +
      "unauthentifizierte Abholbarkeit. Liefert einen einzigen, von OpenAI zugewiesenen " +
      "Verifikations-Token als Klartext und sonst nichts: keine Tenant-Daten, kein Zustand, " +
      "kein Schreibpfad, kein Query-Echo. Bei leerer Env antwortet sie 404.",
  },
  {
    method: "GET",
    path: "/.well-known/security.txt",
    reason:
      "RFC 9116 Sicherheitskontakt - muss ohne Login abrufbar sein. Statischer Text " +
      "(Kontakt, Ablaufdatum), keine Tenant-Daten, keine Eingabe.",
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
    method: "POST",
    path: "/webhooks/elevenlabs/consult",
    reason:
      "HANDLER-INTERNE AUTH (Runbook-Fall 2): der ElevenLabs-Agent ruft das Werkzeug " +
      "get_consult serverseitig, kann keinen Session-Cookie senden - und ElevenLabs " +
      "SIGNIERT Werkzeug-Webhooks nicht (nur frei konfigurierbare Header). Absicherung im " +
      "Handler: timing-sicherer Vergleich (safeEqual) des Headers x-hermes-tool-token gegen " +
      "ELEVENLABS_TOOL_TOKEN, leerer Wert lehnt JEDEN Aufruf ab; danach Bindung an einen " +
      "laufenden Anruf UND an dessen Mandanten (SEC-P4: der Anrufstart gibt dem Agenten " +
      "einen aus dem Mandanten abgeleiteten Wert mit, den die Werkzeug-Definition " +
      "zurueckschickt; ein Aufruf fuer Mandant A passt an keinem Anruf von Mandant B), " +
      "Consult-Faehigkeits-Gate und die pro-Tenant-Kostendecke. Jede dieser drei " +
      "Ablehnungen antwortet mit demselben Grund (404), nur das Log unterscheidet sie.",
  },
  {
    method: "POST",
    path: "/webhooks/elevenlabs/lookup",
    reason:
      "HANDLER-INTERNE AUTH, wortgleiche Bauart wie /webhooks/elevenlabs/consult darueber " +
      "(Thema B, 2026-08-19): derselbe timing-sichere x-hermes-tool-token-Vergleich " +
      "(fail-closed bei leerem Wert), dieselbe Bindung an einen " +
      "laufenden Anruf UND an dessen Mandanten (SEC-P4: der Anrufstart gibt dem Agenten " +
      "einen aus dem Mandanten abgeleiteten Wert mit, den die Werkzeug-Definition " +
      "zurueckschickt; ein Aufruf fuer Mandant A passt an keinem Anruf von Mandant B), " +
      "danach das Recherche-Gate (LOOKUP_ENABLED + EXA_API_KEY + per-Tenant allowLookup + " +
      "Richtung outbound, research/registry.js), die pro-Tenant-Kostendecke und der " +
      "Deckel LOOKUP_MAX_PER_CALL. Jede dieser drei Ablehnungen antwortet mit demselben " +
      "Grund (404), nur das Log unterscheidet sie. Egress-Filter sanitizeLookupQuery vor " +
      "jedem Versand.",
  },
  {
    method: "POST",
    path: ELEVENLABS_INIT_PATH,
    reason:
      "HANDLER-INTERNE AUTH (IEL-B6, Conversation-Initiation-Webhook): der Anbieter ruft " +
      "serverseitig, ohne Session und ohne Signatur. Stufe 1: safeEqual des Headers " +
      "x-hermes-init-token gegen ELEVENLABS_INIT_WEBHOOK_TOKEN; leer oder kuerzer als " +
      "INIT_WEBHOOK_TOKEN_MIN_LENGTH -> 403 fuer JEDEN Aufruf. Der Header beweist nur das " +
      "Anbieter-Konto, nicht die Zugehoerigkeit zu einem Anruf - Barriere ist Stufe 2: " +
      "Zuordnung NUR ueber das 16-Byte-Bindungs-Token an einen aktiven, wartenden " +
      "Inbound-EL-Anruf (oder die identische Wiederholung binnen " +
      "EL_INIT_WIEDERHOLUNG_FRIST_MS), dann Schalter/Allowlist, dann set-once-Bindung. Jede " +
      "Ablehnung 404 mit konstantem Koerper ohne Daten. Loest selbst keinen Anruf aus.",
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
    method: "GET",
    path: "/newsletter/confirm",
    reason:
      "HANDLER-INTERNE AUTH (F2-Newsletter-Recipients): der Empfaenger hat kein Dashboard/keine " +
      "Session - Sicherung ist der kryptografisch unratbare Bestaetigungs-Token (32 Byte, nur " +
      "als SHA256-Hash gespeichert, 48h Ablauf, Einmalverwendung), timing-sicher verglichen " +
      "(safeEqual, state-ops.js confirmNewsletterRecipientByToken). Idempotenter GET ohne " +
      "Zustandsaenderung am Aufrufer, kein CSRF-Risiko.",
  },
  {
    method: "GET",
    path: "/newsletter/unsubscribe",
    reason:
      "HANDLER-INTERNE AUTH (F2-Newsletter-Recipients): Muster /newsletter/confirm oben, " +
      "permanenter Abmelde-Token (kein Ablauf, das Opt-out muss jederzeit moeglich sein), " +
      "timing-sicher verglichen (safeEqual, state-ops.js unsubscribeNewsletterRecipientByToken).",
  },
  {
    method: "POST",
    path: COOKIE_CONSENT_PATH,
    reason:
      "Cookie-Einwilligungs-Protokoll (Nachweis Art. 7 Abs. 1 DSGVO): Besucher der " +
      "Marketing-Seite haben keine Sitzung, der Beleg entsteht VOR jeder Identitaet. " +
      "Schreibt ausschliesslich eine anonyme, append-only Zeile (Zufalls-UUID des " +
      "Browsers, Banner-Version, zwei Booleans, Host aus dem Origin) - keine IP, kein " +
      "Tenant, kein Account. Liest nichts, liefert nichts zurueck (204), loest weder " +
      "Anruf noch SMS noch Zahlung aus. Strikte Eingabepruefung (UUID-v4, Ganzzahl-" +
      "Version, echte Booleans, 1-kB-Body), sonst 400; die Schreibrate deckelt der " +
      "globale Per-IP-Rate-Limiter.",
  },
  {
    method: "POST",
    path: PUBLIC_CANCELLATION_PATH,
    reason:
      "Kuendigung ohne Anmeldung (§ 312k BGB): eine Login-Pflicht ist nach LG Koeln " +
      "33 O 355/22 und LG Muenchen I 33 O 15098/22 eine unzulaessige Huerde - die Route " +
      "MUSS ohne Sitzung erreichbar sein. Sicherung im Handler-Pfad: strikte " +
      "Eingabepruefung (sonst 400), eigene Per-IP-Drossel (5 je 15 min), Honeypot, eine " +
      "Antwort ohne Konto-Aufzaehlung (nur der Eingangszeitpunkt), Mails nur an die " +
      "Konto-Adresse oder das eigene Kundenpostfach, nie an die Formular-Adresse. Einzige " +
      "Wirkung: Abo-Ende vormerken (vom Inhaber im Kundenbereich ruecknehmbar); weder " +
      "Anruf noch SMS noch Zahlung (src/public-cancellation-routes.js).",
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
    path: "/voice/el-rueckfall",
    reason: VOICE_SIGNATURE_REASON,
  },
  {
    method: "POST",
    path: "/voice/el-bein",
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
  // AUTH-P7: die sieben Umleitungen. Abgeleitet aus derselben Quelle, aus der src/app.js
  // sie mountet (G5) - eine achte Wiederholung der Pfade waere genau die Duplizierung,
  // die src/portal-paths.js verhindern soll. Zwei Zwangspunkte bleiben trotzdem: der
  // ROUTE_FINGERPRINT und die Abdeckungsregel von test/probe-auth-table.test.js werden
  // rot, wenn jemand hier einen Pfad ergaenzt, ohne ihn ueberall nachzuziehen.
  ...LOGIN_ALIAS_PATHS.map((path) => ({ method: "GET", path, reason: ALIAS_REASON })),
  ...APP_ALIAS_PATHS.map((path) => ({ method: "GET", path, reason: ALIAS_REASON })),
]);

// ---- Restarbeit: haengt allein an einer Sammelsicherung ---------------------------
// Diese Routen sind NICHT oeffentlich. Bis AUTH-P7 haengten sie ausschliesslich an der
// Basic-Auth-Sammelsicherung; die Liste bleibt als MECHANISMUS stehen, damit eine
// kuenftige Route nicht wieder still allein an einer Sammelsicherung haengt, die es
// heute nicht mehr gibt. Der Inventar-Test laesst die hier gelisteten Routen durch und
// haelt sie zugleich sichtbar: die Liste IST die Arbeitsliste.
//
// HARTE VORBEDINGUNG FUER P7 WAR: das Gate durfte erst fallen, wenn diese Liste LEER
// ist. Das Legacy-Checkout-Paar traegt seit AUTH-P7 `internalOnly` (dieselbe
// Middleware wie die sieben P5-Routen) und ist damit in die Klasse AUTH gewandert -
// die Liste ist jetzt leer. Geloescht wird das Paar erst in P9 (Karenzfrist).
export const GATE_ONLY_ROUTES = Object.freeze([]);

// Schluessel einer Route. EINE Quelle fuer beide Listen und den Test (G5).
export const routeKey = (method, path) => `${String(method).toUpperCase()} ${path}`;

const PUBLIC_KEYS = new Set(PUBLIC_ROUTES.map((route) => routeKey(route.method, route.path)));
const GATE_ONLY_KEYS = new Set(GATE_ONLY_ROUTES.map((route) => routeKey(route.method, route.path)));

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
