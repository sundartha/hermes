// HTTP-Schutzschichten fuer das Gateway - bewusst in-house, ohne neue Dependency.
import { auditAuthFailed, AUTH_FAILED_GRUND } from "./util.js";

// CSP. script-src ist strikt: 'self', kein 'unsafe-inline', kein 'unsafe-eval'. Der
// urspruengliche Grund fuer die Lockerung - das alte Dashboard public/tenant.html mit
// Inline-<script> und onclick-Handlern - ist mit P14 entfallen, und der eigene Auftrag,
// den der Vorgaengerkommentar ankuendigte, ist SEC-P5: der apps/web-Build wurde gegen die
// engere Policy gemessen (kein is:inline in den Quellen, assetsInlineLimit 0 -> Astro
// buendelt jedes Skript als externes same-origin-Modul). test/sec-p5-web-haertung.test.js
// haelt das fest.
// style-src behaelt 'unsafe-inline' - das war nicht Teil des Auftrags und ist eine eigene
// Entscheidung, kein Mitnehmen bei der Gelegenheit.
// font-src 'self' (18.09.2026): das Dashboard (apps/web) liefert seit dem Hermes-Rebrand
// (bdee7cf9) ALLE Schriften selbst aus /assets/fonts/ aus (styles/fonts.css) - Norse fuer
// den Schriftzug, Space Grotesk, die Serif- und die Mono-Schrift. Die Direktive kannte
// nur fonts.gstatic.com; jede eigene Schrift wurde auf app.sundartha.com blockiert
// ("Refused to load the font ... violates font-src"), und das Dashboard lief live in
// Ersatzschriften des Systems. Die Website (Static-Service, render.yaml) ist nicht
// betroffen: dort gibt es kein font-src, es gilt default-src 'self'.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
].join("; ");

// HSTS: 180 Tage inklusive Subdomains. Bewusst NICHT ein Jahr und bewusst OHNE
// "preload" - die Zusage ist nicht widerrufbar: ein Browser vergisst sie erst, wenn
// max-age abgelaufen ist, und die Preload-Liste ist praktisch endgueltig. 180 Tage ist
// die kleinste Frist, die der Auftrag verlangt, also das kleinste Zeitfenster im
// Fehlerfall. Betroffene Namen, alle ausschliesslich ueber HTTPS erreichbar (Render):
// sundartha.com, www.sundartha.com, app.sundartha.com, vodafone-agent.onrender.com.
// Ueber Klartext-HTTP ignorieren Browser den Header (RFC 6797) - er darf deshalb
// bedingungslos mitgehen, ohne eine zweite, spoofbare Protokollquelle zu brauchen.
const HSTS_MAX_AGE_SECONDS = 15552000;
// EINE Quelle (G5) fuer beide Auslieferungswege: dieses Gateway und der Static-Service
// in render.yaml. test/sec-p5-web-haertung.test.js haelt beide Seiten deckungsgleich.
export const HSTS_HEADER_VALUE = `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains`;

export function securityHeaders(req, res, next) {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": HSTS_HEADER_VALUE,
    "Content-Security-Policy": CSP,
  });
  // API-Antworten (Transkripte!) duerfen nirgends zwischengespeichert werden
  if (req.path.startsWith("/api/")) res.set("Cache-Control", "no-store");
  next();
}

// ---- Herkunftspruefung (SEC-P3) --------------------------------------------------
// Methoden ohne Zustandsaenderung (RFC 9110 "safe"): unberuehrt. Ein CSRF-Angriff
// braucht eine schreibende Methode; GET /api/self-service/billing/return ist der
// Stripe-Browser-Redirect und darf NIE an dieser Stelle scheitern.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Sprachneutraler Antwort-Token in der Vokabelform der Self-Service-Oberflaeche
// (invalid_private_number / no_card). Die Antwort nennt den Grund und sonst NICHTS:
// kein Echo des Origins, keine Liste erlaubter Herkuenfte.
const CROSS_ORIGIN_ERROR = "cross_origin_blocked";
// Antwortcode der Herkunftspruefung. Benannt wie im Bestand (
// routes/webhooks-elevenlabs.js): der nackte Zahlenwert im Handler waere ein Magic
// Number.
const HTTP_FORBIDDEN = 403;

// Reines Praedikat ohne HTTP-Wissen (Muster makeFixedWindowCounter): "kommt dieser
// Request NACHWEISLICH von einem fremden Ursprung?" Drei Faelle, absichtlich in dieser
// Reihenfolge:
//   1. kein Origin -> false. PFLICHT, keine Nachlaessigkeit: Anbieter-Webhooks, /mcp
//      und Server-zu-Server-Aufrufer senden keinen Origin; fail-closed wuerde genau
//      diese Aufrufer brechen.
//   2. Origin unparsbar ("null" aus einem sandboxed iframe, Muell) -> true.
//   3. sonst Host-Vergleich. Verglichen wird der HOST (inkl. Port), NICHT das Schema:
//      der Proxy terminiert TLS, ein Schema-Vergleich braeuchte X-Forwarded-Proto und
//      damit eine zweite, spoofbare Quelle (bewusst getragen, s. PLAN-SECURITY.md).
//      Host ist case-insensitiv -> beide Seiten kleingeschrieben, sonst sperrt ein
//      "Host: App.Sundartha.com" legitimen Verkehr aus.
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

// Express-Adapter. Vergleichsanker ist req.headers.host, NICHT req.hostname: bei
// "trust proxy" liest req.hostname X-Forwarded-Host, das ein Aufrufer selbst setzen
// koennte; den Host-Header kann ein Cross-Origin-fetch nicht setzen (forbidden header
// name). enforce !== false statt Boolean(enforce): NUR der Literalwert false schaltet
// ab - ein fehlender/vermuellter Wert darf eine Sicherung nie stillschweigend loesen.
export function createSameOriginGuard({ enforce }) {
  const aktiv = enforce !== false;
  return function sameOriginOnlyMiddleware(req, res, next) {
    if (!aktiv || SAFE_METHODS.has(req.method)) return next();
    if (!crossOriginRequest(req.headers.origin, req.headers.host)) return next();
    // EIN Forensik-Kanal (G5): dieselbe auth_failed-Zeile wie webAuthGateMiddleware /
    // adminOnlyMiddleware / internalOnly, mit req.path (nie originalUrl) und OHNE den
    // Origin-Wert - er ist angreifer-kontrollierter Text und gehoert nicht ungeprueft
    // ins Log.
    auditAuthFailed(req, AUTH_FAILED_GRUND.CROSS_ORIGIN);
    res.status(HTTP_FORBIDDEN).json({ error: CROSS_ORIGIN_ERROR });
  };
}

// ---- Herkunftswache fuer /mcp (E5, MCP-Spec T-06) --------------------------------
// ABGRENZUNG zur Schwesterwache oben - sie darf NICHT mit ihr verschmolzen werden; das
// waere eine Aufweichung, keine Vereinheitlichung (Lehre clean-code-audit-2026-07:
// Fragilitaet = Invarianten-per-Konvention):
//   crossOriginRequest -> Anker ist req.headers.host (Host-Echo). Richtig fuer die
//     Self-Service-Routen: sie werden aus dem Browser unter GENAU dem Host bedient, der
//     den Request annimmt (lokal http://127.0.0.1:<port>, live app.sundartha.com) -
//     eine Allowlist saeg dort das eigene Dashboard ab.
//   mcpOriginErlaubt   -> Anker ist eine KONFIGURIERTE Allowlist. Fuer /mcp ist der
//     Host-Anker WIRKUNGSLOS: beim DNS-Rebinding schickt der Angreifer genau den Host,
//     den der Dienst annimmt, und passiert jeden Host-Echo-Vergleich.
// Zwei Anker, zwei Wachen - EIN Antwort-Vokabular und EIN Forensik-Kanal (G5).
const MCP_ORIGIN_SCHEMES = new Set(["http:", "https:"]);
// Zeichenklasse des LOG-Werts: Hostnamen-Alphabet plus Port-Doppelpunkt, laengenbegrenzt.
const ORIGIN_LOG_HOST = /^[a-z0-9.:-]{1,64}$/;
const ORIGIN_LOG_UNLESBAR = "unlesbar";

// Der EINE Parse-Versuch (G5): beide reinen Funktionen unten brauchen dieselbe Antwort
// auf "ist das ein absoluter http(s)-Origin?". Das Schema-Gate ist PFLICHT und kein
// Zierrat: fuer ein fremdes Schema liefert URL.origin den STRING "null" (gemessen:
// new URL("foo://Bar").origin === "null"). Ohne das Gate koennte ein unparsbarer
// Listeneintrag mit demselben "null" verglichen werden - eine Allowlist, die bei Muell
// auf Muell passt, ist fail-open.
function absoluterHttpOrigin(wert) {
  if (!wert) return null;
  try {
    const url = new URL(wert);
    return MCP_ORIGIN_SCHEMES.has(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

// Kanonische Form eines Origins oder null. URL.origin streicht Default-Ports und Pfade:
// "HTTPS://Agent.Test" und "https://agent.test/" sind damit derselbe Eintrag,
// "https://agent.test:8443" bewusst NICHT (der Port gehoert zum Origin).
export function normalisierterOrigin(wert) {
  const url = absoluterHttpOrigin(wert);
  return url ? url.origin.toLowerCase() : null;
}

// Die EINE Stelle, die die Allowlist bildet (G5). publicUrl ist der ANGEKUENDIGTE Origin
// (Token-Audience, PRM-resource, 401-Metadaten-Verweis); zusaetzlicheOrigins ist die
// additive Env-Liste. Unparsbare Eintraege werden VERWORFEN statt durchgelassen, sonst
// haengt an einem Tippfehler ein Eintrag, der mit nichts vergleichbar ist. Duplikate
// fallen weg. Leeres Ergebnis heisst deny-all fuer JEDEN vorhandenen Origin - gewollt.
export function mcpErlaubteOrigins({ publicUrl, zusaetzlicheOrigins = [] }) {
  const kandidaten = [publicUrl, ...zusaetzlicheOrigins];
  return [...new Set(kandidaten.map((wert) => normalisierterOrigin(wert)).filter(Boolean))];
}

// Reines Praedikat (Muster crossOriginRequest), drei Faelle in dieser Reihenfolge:
//   1. kein Origin-Header -> true. PFLICHT, keine Nachlaessigkeit: Server-zu-Server-
//      Aufrufer (der heute verbundene Connector, stdio-MCP, 47 Testdateien) senden
//      keinen Origin, und T-06 verlangt die Ablehnung nur fuer "vorhanden und
//      ungueltig". Damit bleibt das Verhalten OHNE Origin byte-identisch zu vorher.
//   2. vorhanden, aber kein absoluter http(s)-Origin ("null" aus sandboxed iframe, zwei
//      von Node zu "a, b" zusammengefasste Origin-Header, Muell) -> false.
//   3. sonst Mengenvergleich auf normalisierten Werten.
// Warum NICHT die SDK-Option enableDnsRebindingProtection: sie ueberspringt die Pruefung
// bei leerer Liste (fail-open), echot den angreifer-kontrollierten Origin in den
// Fehler-Body und umgeht diesen Forensik-Kanal. erlaubteOrigins ist die Ausgabe von
// mcpErlaubteOrigins - die Liste wird EINMAL in der Fabrik normalisiert, nicht pro
// Request.
export function mcpOriginErlaubt(originHeader, erlaubteOrigins) {
  if (!originHeader) return true;
  const origin = normalisierterOrigin(originHeader);
  if (!origin) return false;
  return erlaubteOrigins.includes(origin);
}

// Log-Wert der Ablehnung: der HOST des Origins, wenn er die enge Zeichenklasse erfuellt,
// sonst ein Sentinel. Ohne diesen Wert ist ein Aussperren nicht diagnostizierbar (die
// Heilung ist der Nachtrag in MCP_ALLOWED_ORIGINS); der ROHE Header ist
// angreifer-kontrollierter Text und gehoert nie ins Log (Regel 4, gleiche Begruendung
// wie bei der Schwesterwache oben).
export function originLogWert(originHeader) {
  const url = absoluterHttpOrigin(originHeader);
  const host = url ? url.host.toLowerCase() : "";
  return ORIGIN_LOG_HOST.test(host) ? host : ORIGIN_LOG_UNLESBAR;
}

// Express-Adapter. KEINE SAFE_METHODS-Ausnahme (anders als createSameOriginGuard): die
// Wache ist DNS-Rebinding-Schutz, kein CSRF-Schutz - ein GET/OPTIONS fremder Herkunft ist
// genau der Fall, den T-06 abweist. BEWUSSTE Vertragsaenderung: OPTIONS /mcp antwortet
// mit fremdem Origin 403 statt der 200 aus Express' Auto-OPTIONS.
// enforce !== false statt Boolean(enforce): NUR der Literalwert false loest die
// Sicherung - Bauform und Begruendung wie csrfEnforce/createSameOriginGuard. Das
// Notventil ist Pflicht, kein Komfort (Owner-Entscheidung E-4): die 403 laeuft VOR
// mcpAuth, ein Origin-sendender Client sieht dann nie die 401-Bearer-Challenge (src/auth.js,
// deny401) - den einzigen Zeiger auf den Authorization Server - und kann sich nicht neu autorisieren.
// Ohne Schalter ist der einzige Reparaturweg ein Deploy. Mit enforce=false schreibt die
// Wache auch KEINE Zeile: ein geloester Riegel soll nicht aussehen wie ein greifender.
export function createMcpOriginGuard({ erlaubteOrigins, enforce }) {
  const aktiv = enforce !== false;
  return function mcpOriginOnlyMiddleware(req, res, next) {
    if (!aktiv || mcpOriginErlaubt(req.headers.origin, erlaubteOrigins)) return next();
    auditAuthFailed(
      req,
      AUTH_FAILED_GRUND.MCP_CROSS_ORIGIN,
      `origin=${originLogWert(req.headers.origin)}`,
    );
    res.status(HTTP_FORBIDDEN).json({ error: CROSS_ORIGIN_ERROR });
  };
}

// Exportiert: app.js baut den Fehlversuch-Zaehler der Init-Schranke (IEX-A7) mit demselben
// Fenster, und die Schranke fasst ihre Drossel-Zeile je Fenster zusammen - eine Quelle (G5).
export const RATE_WINDOW_MS = 60_000;
export const RATE_SWEEP_INTERVAL_MS = 5 * 60_000;

// Generischer Fixed-Window-Zaehler pro Schluessel (G5): EINE Quelle fuer den Per-IP-
// Rate-Limiter (unten) UND den Fehlversuch-Zaehler der Init-Token-Schranke (app.js, IEX-A7).
// windowMs/limit/sweepMs als EIN Optionsobjekt (F1). Liefert eine hit(key)-Funktion, die den
// Zaehler fuer key erhoeht und {allowed, retryAfterS} zurueckgibt - reine Query+Zaehl-
// Logik, kein HTTP-Wissen (der Express-Adapter bleibt beim Aufrufer).
export function makeFixedWindowCounter({ windowMs, limit, sweepMs }) {
  const windows = new Map(); // key -> { count, startedAt }

  // Abgelaufene Fenster regelmaessig raeumen, damit die Map nicht unbegrenzt waechst.
  // unref(): der Timer darf den Prozess (z.B. Tests) nicht am Beenden hindern.
  setInterval(() => {
    const now = Date.now();
    for (const [key, w] of windows) if (now - w.startedAt >= windowMs) windows.delete(key);
  }, sweepMs).unref();

  return function hit(key) {
    const now = Date.now();
    let w = windows.get(key);
    if (!w || now - w.startedAt >= windowMs) {
      w = { count: 0, startedAt: now };
      windows.set(key, w);
    }
    w.count++;
    return {
      allowed: w.count <= limit,
      retryAfterS: Math.ceil((w.startedAt + windowMs - now) / 1000),
    };
  };
}

const RATE_LIMIT_BODY = Object.freeze({ error: "Zu viele Anfragen. Bitte spaeter erneut versuchen." });

// Die EINE Drossel-Antwort (G5): globaler Limiter und Init-Token-Schranke (IEX-A7) - nur der
// konstante Koerper unterscheidet sich. Die 429 bleibt hier bewusst als Literal stehen: sie
// ist ein in eslint-suppressions.json eingefrorener Bestandsbefund dieser Datei, und das
// Commit-Gate (scripts/check-staged-suppressions.js) laesst eine Aenderung nur durch, wenn
// sich die Befundmenge nicht bewegt - die Datei ganz zu raeumen verlangt einen eigenen Umbau
// von errorHandler (max-params, von Express' Vier-Parameter-Erkennung erzwungen).
export function respondTooManyRequests(res, { retryAfterS, body }) {
  res.set("Retry-After", String(retryAfterS));
  return res.status(429).json(body);
}

// Fixed-Window-Rate-Limiter pro Client-IP. Die Ausnahmen (localhost-Socket,
// /voice mit eigener Provider-Signaturpruefung) entscheidet der Aufrufer in server.js.
export function createRateLimiter(limitPerMin) {
  const rateHit = makeFixedWindowCounter({
    windowMs: RATE_WINDOW_MS,
    limit: limitPerMin,
    sweepMs: RATE_SWEEP_INTERVAL_MS,
  });

  return (req, res, next) => {
    const { allowed, retryAfterS } = rateHit(req.ip);
    if (!allowed) return respondTooManyRequests(res, { retryAfterS, body: RATE_LIMIT_BODY });
    next();
  };
}

// Catch-all 4-arg-Error-Middleware (AC4): Last-Resort-Netz fuer Routen-Fehler, die
// nicht schon per-Route gefangen wurden (synchron geworfen oder per next(err)
// gereicht). MUSS in server.js NACH allen Route-Mounts und VOR app.listen registriert
// werden (Express-Error-MW sieht nur Fehler von davor gemounteten Routen). Liefert dem
// Client IMMER eine generische 500 - NIE err.message, err.stack oder Config/Env (Secret-/
// Param-Leak, Regel 4/5). err.stack wird NUR server-seitig laut geloggt (Debug bleibt
// moeglich, ohne den Client-Body zu vergiften). Bei bereits gesendeten Headern an den
// Express-Default delegieren (kein zweiter Write). Die 4-arg-Signatur ist Pflicht -
// daran erkennt Express die Error-MW; _next bleibt deshalb in der Signatur.
export function errorHandler(err, _req, res, next) {
  // secret-frei + laut: nur der Stack ins Server-Log, nie in die Antwort.
  console.error("[error]", err && err.stack ? err.stack : String(err));
  if (res.headersSent) return next(err);
  res.status(500).json({ error: "internal error" });
}
