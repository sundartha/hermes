import { isBelegRef as lnProbe } from "./store/cost-evidence.js";
// ---- Kompositionswurzel HTTP-Schicht (PLAN-SERVER-SLIM.md) ----------------------
// buildApp(deps) baut die Express-App als EINE sichtbare Middleware-/Mount-Sequenz
// (INV-2) aus benannten Registrar-Funktionen + Router-Factory-Mounts. REINE
// Verschiebung aus server.js (byte-identische Reihenfolge, Semantik, Antworten).
// Laufzeit-Instanzen (config/store/audit + die in server.js konstruierten P1-P6-
// Instanzen) kommen via deps herein; reine Helfer/Factories/Konstanten werden direkt
// importiert (Konvention wie wiring/web-login.js). STRIPE_WEBHOOK_PATH bleibt EINE
// Konstante (INV-1), gespeist an captureRawBody + wireWebLogin(stripeWebhookPath).
import path from "path";
import express from "express";
import {
  securityHeaders,
  createRateLimiter,
  errorHandler,
  makeFixedWindowCounter,
  RATE_WINDOW_MS,
  RATE_SWEEP_INTERVAL_MS,
} from "./middleware.js";
import { registerWellKnown } from "./auth.js";
import { makeMcpDrosseln } from "./mcp-rate-limit.js";
import { PLAN_CATALOG } from "./plans.js";
import {
  voiceControl,
  webhookEvents,
  inboundSignatureVerifier,
  providerFromHeaders,
} from "./telephony/registry.js";
import { terminateAndBillCall, hangUpAction, billThunk, elevenLabsHangUpAction } from "./telephony/call-termination.js";
import { stripeBilling } from "./billing/stripe.js";
import { makeVoiceRoutes } from "./routes/voice.js";
import { makeElevenLabsWebhookRoutes } from "./routes/webhooks-elevenlabs.js";
import {
  INIT_FEHLVERSUCHE_PRO_MIN,
  initTokenSchranke,
  istInitWebhookAnfrage,
  makeElevenLabsInitWebhookRoutes,
} from "./routes/webhooks-elevenlabs-init.js";
import { makeConsultRaised } from "./conversation/consult-raised.js";
import { makeReadRoutes } from "./routes/api-read.js";
import { makeInboxRoutes } from "./routes/api-inbox.js";
import { makeBillingRoutes } from "./routes/api-billing.js";
import { makeCallRoutes } from "./routes/api-calls.js";
import { makeCallConfirmationRoutes } from "./routes/api-call-confirmations.js";
import { makeOnboardRoutes } from "./routes/api-onboard.js";
import { makeDeployInfoRoutes } from "./routes/api-deploy-info.js";
import { makeMcpRoutes } from "./routes/mcp.js";
import { wireWebLogin } from "./wiring/web-login.js";
import { guardedBoot } from "./boot-guard.js";
import { createPortalRunner as defaultCreatePortalRunner } from "./portal-pool.js";
import {
  isTrustedLocalCaller,
  internalIdentity,
  OWNER_ID,
  tenantOwnsCall,
} from "./request-tenant.js";
// P14: App-Shell- und Altpfad als EINE Quelle (src/portal-paths.js) - dieselben
// Konstanten brauchen die Stripe-Rueckkehr-Ziele in self-service-routes.js und
// api-billing.js (Import in die Gegenrichtung waere ein Zyklus). LOGIN_ALIAS_PATHS/
// APP_ALIAS_PATHS (AUTH-P7): die sieben eingetippten Sackgassen, s. registerPathRedirects.
import { APP_PATH, LEGACY_PORTAL_PATH, LOGIN_ALIAS_PATHS, APP_ALIAS_PATHS } from "./portal-paths.js";

// Body-Groesse begrenzen: kein Endpunkt braucht mehr als 100kb (Provider-Webhooks
// und API-Payloads sind klein) - schuetzt vor Memory-Druck durch Riesen-Bodies.
const BODY_LIMIT = "100kb";
// P5: Ziel des Landing-Redirects (kein Magic-String, G25). "/" hat kein Index ->
// 302 auf den Login (= Registrierung, Strategie R2). Pfad lebt auf dem Gateway
// (makeWebAuthRoutes GET /auth/login), nicht auf der Static Site.
const LOGIN_PATH = "/auth/login";
// W4: Stripe-Webhook-Pfad (kein Magic-String, G25). Die HMAC-Signaturpruefung braucht
// den unveraenderten Roh-Body -> wird zusaetzlich zu /voice erfasst (s. captureRawBody).
const STRIPE_WEBHOOK_PATH = "/webhooks/stripe";
// /voice-Praefix als EINE Quelle (G5): rawBody-Capture und der Rate-Limit-Bypass
// teilen denselben Praefix.
const VOICE_PATH_PREFIX = "/voice";
// T2-07 (T-28): EIN Praedikat fuer "ist dies der /mcp-POST", an beiden Ausnahmestellen
// verwendet (globaler IP-Limiter, globale Body-Parser) - keine zweite Kopie des
// Pfad-/Methoden-Vergleichs. Nur GENAU diese Form; Varianten (Gross-/Kleinschreibung,
// Schraegstrich am Ende), die Express trotzdem auf die Route matcht, bleiben im globalen
// Limiter und den globalen Parsern (strenger, nicht lockerer).
const isMcpPost = (req) => req.method === "POST" && req.path === "/mcp";
// E7 (O-4): der Challenge-Pfad ist woertlich vorgeschrieben - kein Praefix, kein Suffix,
// kein Tenant-Segment. Als Konstante, damit der Handler unten keinen nackten Magic-String
// traegt (G25). Die zweite Nennung in src/route-policy.js bleibt bewusst ein Literal
// (dort begruendet und mechanisch bewacht).
const OPENAI_CHALLENGE_PATH = "/.well-known/openai-apps-challenge";
// OpenAI-P10b (I-2b, RFC 9116): Sicherheitskontakt-Datei. Exportiert (statt lokal), weil
// der Drift-Test (test/openai-p10b-healthz.test.js) denselben Kontaktwert gegen das
// Impressum abgleicht - EINE Quelle statt einer zweiten, unabgestimmten Kopie (G5).
export const SECURITY_TXT_PATH = "/.well-known/security.txt";
// Rollenadresse aus dem Impressum (apps/web/src/data/legal/imprint.de.json), NICHT die
// persoenliche Owner-Adresse. Als Konstante statt Env: der Wert ist oeffentlich und im
// Impressum fest verdrahtet - eine zweite, per Env gesetzte Quelle waere ein Drift-Risiko
// statt eines Sicherheitsgewinns (keine neue Env-Variable, Vier-Orte-Regel entfaellt).
export const SECURITY_CONTACT = "mailto:kontakt@sundartha.com";
// RFC 9116 Abschnitt 2.5.5: das Feld MUSS in der Zukunft liegen und SOLLTE weniger als
// ein Jahr entfernt sein. Fest codiert (kein pro-Request-Neuberechnen, s. Handler-
// Kommentar unten) - Erneuerungspflicht vor diesem Datum steht in PLAN-SECURITY.md.
export const SECURITY_TXT_EXPIRES = "2027-09-01T00:00:00.000Z";
export const SECURITY_TXT_BODY =
  `Contact: ${SECURITY_CONTACT}\n` + `Expires: ${SECURITY_TXT_EXPIRES}\n` + `Preferred-Languages: de, en\n`;
// Statuscodes als benannte Konstanten (G25): die Umleitung und die Grenzen, innerhalb
// derer ein Body-Parser-Fehler als Eingabefehler des Aufrufers gilt (400 einschliesslich
// bis 500 ausschliesslich).
const HTTP_FOUND = 302;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
// rawBody fuer /voice (Telnyx) UND den Stripe-Webhook erfassen: beide pruefen
// gegen den unveraenderten Body. Die Erfassung aendert das Parsen NICHT (verify
// laeuft VOR dem Parsen, additiv).
// Object.assign statt direkter Zuweisung: req GEHOERT Express, nicht uns - die Mutation
// ist der vom verify-Vertrag vorgesehene Weg, ein Rohwert an den Request zu haengen, und
// sie wird hier als solche benannt statt als Parameter-Mutation geschrieben (P6/F2).
const captureRawBody = (req, _res, buf) => {
  if (req.path.startsWith(VOICE_PATH_PREFIX) || req.path === STRIPE_WEBHOOK_PATH)
    Object.assign(req, { rawBody: buf });
};

// Body-Parser-Fehler (413 zu gross, 400 kaputtes JSON) als JSON statt HTML beantworten.
// Alles ausserhalb der 4xx-Spanne wandert unveraendert weiter an das Error-Netz.
function respondToParserError(err, res, next) {
  if (!err) return next();
  if (!err.status || err.status < HTTP_BAD_REQUEST || err.status >= HTTP_SERVER_ERROR)
    return next(err);
  res.status(err.status).json({ error: err.type || "bad request" });
}

// Der Parser meldet seinen Fehler an den Callback, den er selbst aufruft - die Antwort
// entsteht damit DORT, wo der Fehler entsteht. Vorher stand dafuer eine app-weite
// Fehler-Middleware direkt hinter den beiden Parsern; gleiches Verhalten, aber ohne den
// Vier-Parameter-Handler, den Express nur an fn.length erkennt (F1: Obergrenze 3).
const withParserErrors = (parser) => (req, res, next) =>
  parser(req, res, (err) => respondToParserError(err, res, next));

// IEX-A7/E12: eigener Fehlversuch-Zaehler der Init-Schranke - getrennt vom globalen Limiter,
// dessen Zaehlung diese Anfragen nie sieht.
function makeInitTokenSchranke(config) {
  const zaehler = makeFixedWindowCounter({
    windowMs: RATE_WINDOW_MS,
    limit: INIT_FEHLVERSUCHE_PRO_MIN,
    sweepMs: RATE_SWEEP_INTERVAL_MS,
  });
  return initTokenSchranke({ config, zaehler });
}

export function installGlobalMiddleware({ app, config }) {
  app.use(securityHeaders);

  // ---- Rate-Limit fuer alle Routen ausser /voice und POST /mcp (vor Auth: bremst auch
  // Brute-Force). /voice/* ist ausgenommen (kommt vom Provider, eigene Signaturpruefung),
  // ebenso vertrauenswuerdige lokale In-Process-Aufrufe (interne MCP-Tools): echtes
  // Loopback OHNE Proxy-Weiterleitung. NICHT per isLocalSocket allein - hinter Render
  // erscheint auch externer Traffic als Loopback (-> sonst liefe das Limit fuer den ganzen
  // Internet-Traffic ins Leere). isTrustedLocalCaller verlangt zusaetzlich kein
  // X-Forwarded-For. POST auf den Init-Webhook (IEX-A7/E12) laeuft STATT des globalen
  // Limiters durch die Init-Token-Schranke - VOR den Parsern und VOR der Loopback-
  // Ausnahme, damit ein ungueltiges Token nie geparst wird, egal von wo. Geteilte
  // Anbieter-IPs: nur ungueltige Tokens zaehlen, ein gueltiges wird nie gedrosselt.
  // T2-07 (T-28): POST /mcp nimmt der globale IP-Limiter GENAUSO aus - dort zaehlen
  // stattdessen die zwei mandanten-/ablehnungs-basierten Zaehler aus mcpDrosseln
  // (makeMcpRoutes), weil OpenAIs gemeinsame ChatGPT-Egress-IPs sonst alle Nutzer in
  // denselben globalen Eimer draengten. GET/DELETE/OPTIONS auf /mcp bleiben im globalen
  // Limiter (nur POST hat eigene Zaehler noetig, s. mcp-rate-limit.js).
  const rateLimiter = createRateLimiter(config.safety.rateLimitPerMin);
  const initSchranke = makeInitTokenSchranke(config);
  app.use((req, res, next) => {
    if (istInitWebhookAnfrage(req)) return initSchranke(req, res, next);
    if (isMcpPost(req)) return next();
    if (req.path.startsWith(VOICE_PATH_PREFIX) || isTrustedLocalCaller(req)) return next();
    rateLimiter(req, res, next);
  });

  // T2-07 (T-28): dieselben zwei Parser-Instanzen wie bisher, aber POST /mcp laesst sie
  // hier aus - dort laufen sie ERST HINTER mcpAuth (makeMcpRoutes/bodyParsers), damit ein
  // Unauthentifizierter nie geparst wird (Pre-Mortem 2 der Phase). Beide Instanzen werden
  // unveraendert an makeMcpRoutes weitergereicht (EIN Parser-Paar, nicht zwei).
  const urlencodedParser = withParserErrors(
    express.urlencoded({ extended: false, limit: BODY_LIMIT, verify: captureRawBody }),
  ); // Provider-Webhooks (form-encoded)
  const jsonParser = withParserErrors(
    express.json({ limit: BODY_LIMIT, verify: captureRawBody }),
  ); // eigene API + MCP (MCP: nur hinter mcpAuth, s.o.)
  app.use((req, res, next) => (isMcpPost(req) ? next() : urlencodedParser(req, res, next)));
  app.use((req, res, next) => (isMcpPost(req) ? next() : jsonParser(req, res, next)));

  // T2-07 (T-28): EINE Instanz je Prozess (Fixed-Window-Zustand darf nicht pro Request neu
  // entstehen) - Mandanten-/Ablehnungs-Zaehler fuer POST /mcp, dasselbe Limit wie der
  // globale IP-Limiter (config.safety.rateLimitPerMin).
  const mcpDrosseln = makeMcpDrosseln({ limitPerMin: config.safety.rateLimitPerMin });

  return { mcpDrosseln, mcpBodyParsers: [urlencodedParser, jsonParser] };
}

export function registerPublicRoutes({ app, config }) {
  // ---- Routen, die vor jeder Identitaet erreichbar sein muessen. Jede einzeln in
  // src/route-policy.js (PUBLIC_ROUTES) begruendet und maschinell gegen den
  // Produktions-Routengraph geprueft (test/route-auth-inventory.test.js).
  // GAP-36 (Deploy-Wahrheit): der EINE oeffentliche Ort, an dem der laufende Dienst
  // selbst sagt, welchen Commit er faehrt (Post-Deploy-Smoke + Rollback-Drill,
  // Ziel-Pin von scripts/probe-auth.sh). AUTH-AUSNAHME bleibt unveraendert (Keep-Alive).
  // OpenAI-P10b: configHash ist HIER NICHT MEHR dabei. Grund: der Hash liegt ueber
  // sieben niedrig-entropischen Betriebsachsen (src/config-fingerprint.js) und wurde
  // live aus 9216 Kandidaten eindeutig zurueckgerechnet (Preimage-Befund,
  // PLAN-SECURITY.md, Abschnitt "OpenAI-P10b", Punkt 1) - er war fuer diese Achsen damit KEIN Einweg-Schutz,
  // sondern gab sie effektiv im Klartext preis. Die Deploy-Wahrheit teilt sich seither
  // auf: commit bleibt oeffentlich (unauthentifiziert lesbar noetig), configHash gibt es
  // nur noch hinter einer Admin-Sitzung (GET /api/admin/deploy-info,
  // src/routes/api-deploy-info.js) und im Boot-Log (src/boot.js). Commit-SHA bleibt ein
  // akzeptiertes Risiko: ohne ihn liefe probe-auth.sh (Ziel-Pin W7) blind, und beide
  // GitHub-Repos sind privat (kein Code-Zugriff ueber den SHA allein).
  app.get("/healthz", (_req, res) => res.json({ ok: true, commit: config.server.deployedCommit }));

  // ---- GET /.well-known/security.txt: Sicherheitskontakt (RFC 9116, OpenAI-P10b) ----
  // AUTH-AUSNAHME (Absolute Regel 3, begruendet): RFC 9116 verlangt, dass die Datei ohne
  // jede Identitaet abrufbar ist - genau das ist ihr Zweck (ein Sicherheitsforscher hat
  // per Definition noch keine Tenant-Sitzung). Liefert ausschliesslich statischen Text
  // (Kontakt + Ablaufdatum + Sprachpraeferenz), liest keine Eingabe, haelt keinen
  // Zustand, hat keinen Schreibpfad, kennt keine Tenant-Daten. Kontaktadresse
  // (SECURITY_CONTACT) ist die im Impressum veroeffentlichte Rollenadresse
  // (apps/web/src/data/legal/imprint.de.json), drift-getestet gegen genau diese Quelle
  // (test/openai-p10b-healthz.test.js). KEIN Canonical-Feld: das wuerde den Host
  // (app.sundartha.com) hart verdrahten - eine Rebrand-/Origin-Falle; RFC 9116 fuehrt
  // Canonical ausdruecklich als optional. SECURITY_TXT_EXPIRES ist FEST (kein
  // pro-Request-Neuberechnen) - ein sich selbst verlaengerndes Ablaufdatum wuerde den
  // Zweck des Feldes (Staleness-Signal) aufheben; Erneuerung vor diesem Datum ist in
  // PLAN-SECURITY.md (Abschnitt OpenAI-P10b) als Pflicht festgehalten.
  app.get(SECURITY_TXT_PATH, (_req, res) => res.type("text/plain").send(SECURITY_TXT_BODY));

  // ---- GET /api/plans: oeffentlicher, read-only Plan-Katalog (BK0) -------------
  // AUTH-AUSNAHME (Regel 3, begruendet): bewusst ohne Login erreichbar - exakt wie
  // /healthz. Liefert NUR den oeffentlichen Tarif-Katalog (Preise/Leistungen,
  // identisch zu www.sundartha.com/preise) - KEINE Tenant-Daten, KEINE Secrets, KEINE
  // PII, kein Schreibpfad. SSoT: src/plans.js (Marketing-Spiegel apps/web/src/lib/
  // plans.js, drift-getestet). BK1 (Dashboard-Kacheln) konsumiert ihn.
  app.get("/api/plans", (_req, res) => res.json(PLAN_CATALOG));

  // ---- GET /.well-known/openai-apps-challenge: Domain-Ownership (O-4/O-5) --------
  // AUTH-AUSNAHME (Absolute Regel 3, begruendet): OpenAI ruft diesen Pfad ohne jede
  // Identitaet ab - der Zweck IST die unauthentifizierte Abholbarkeit. Eintrag mit
  // Begruendung in src/route-policy.js, gepinnt im ROUTE_FINGERPRINT und in der
  // Erwartungstabelle von scripts/probe-auth.sh.
  // Antwortet NUR mit dem zugewiesenen Klartext-Token: kein JSON, keine Liste, kein
  // Zeilenumbruch (O-4 woertlich). Leerer/ungesetzter Wert -> 404 wie eine nicht
  // existierende Route: fail-closed, ohne zu verraten, dass hier etwas vorbereitet ist.
  // EIN Wert, weil O-5 den Pfad ignoriert - die Challenge gilt dem HOST.
  // Laufzeit-Pruefung statt bedingter Registrierung: eine nur-bei-Token gemountete
  // Route waere im geprueften Routengraph unsichtbar (src/route-policy.js, Klasse (c)).
  app.get(OPENAI_CHALLENGE_PATH, (_req, res) => {
    const token = config.server.openaiAppsChallengeToken;
    if (!token) return res.status(HTTP_NOT_FOUND).end();
    res.type("text/plain").send(token);
  });

  registerWellKnown(app);

  // P5: "/" hat kein Index (public/ traegt nur statische Marken-Assets) -> ginge sonst auf 404.
  // 302 auf den Login (= Registrierung, Strategie R2). VOR express.static gemountet wie
  // /auth/*; traegt keine Tenant-Daten, braucht keine Session - daher unkonditional (greift
  // auch ohne Web-Login-Infra).
  // Single-Origin (P1): mit WEB_DIST_DIR faellt "/" bewusst durch auf die statische
  // Marketing-index.html (dist/index.html, weiter unten gemountet) -> der Landing-Redirect
  // gilt nur OHNE den unified Build (byte-identisch zum Bestand).
  if (!config.server.webDistDir) {
    app.get("/", (_req, res) => res.redirect(HTTP_FOUND, LOGIN_PATH));
  }
}

export function registerPathRedirects({ app }) {
  // ---- Eingetippte Sackgassen -> 302 (AUTH-P7, Owner-Entscheidung 2026-08-02) ------
  // Das war der urspruengliche Ausloeser von PLAN-AUTH-GATE: wer /login oder /dashboard
  // tippt, soll im Login landen statt in einer Sackgasse. Mount VOR wireWebLogin und
  // VOR beiden statischen Schichten - kein Shadowing, weil app.get EXAKT matcht (nicht
  // app.use/Praefix) und keiner der sieben Pfade als Route, als apps/web-Seite oder in
  // public/ existiert; /admin und /api/admin/* sind verschiedene Pfade.
  // NUR GET: ein POST auf /login soll 404 bleiben, hier gibt es kein Formular.
  // KEIN Query-Durchreichen (anders als LEGACY_PORTAL_PATH, wo die Stripe-Rueckkehr es
  // braucht): niemand kommt hier mit sinnvollem Query an, und ein ungeprueft in die
  // Location gereichter Query waere unnoetige Flaeche. Beide Ziele sind Konstanten aus
  // dem Modul - nie aus dem Request abgeleitet (kein Open Redirect).
  const umleitungAuf = (ziel) => (_req, res) => res.redirect(HTTP_FOUND, ziel);
  for (const pfad of LOGIN_ALIAS_PATHS) app.get(pfad, umleitungAuf(LOGIN_PATH));
  for (const pfad of APP_ALIAS_PATHS) app.get(pfad, umleitungAuf(APP_PATH));
}

// ---- Cache-Header fuer die statische Auslieferung (AUTH-P9a) ----------------------
// Bewusst HIER statt im Konstanten-Block am Dateikopf: sie werden ausschliesslich von
// registerStaticServing gebraucht (G10, Deklaration nah am Verwendungsort).
// Astro schreibt fingerprintete Assets in sein Default-Verzeichnis _astro/
// (apps/web/astro.config.mjs setzt build.assets NICHT), z.B. /_astro/index.CC3WiDDo.css:
// der Inhalts-Hash steckt im Dateinamen, derselbe Name kann also nie einen anderen Inhalt
// bekommen. Alles andere in dist/ traegt KEINEN Hash - apps/web/public/* wird verbatim
// kopiert (/assets/hero.js, /favicon.svg, /robots.txt).
const ASTRO_ASSET_DIR = "_astro";
const HTML_SUFFIX = ".html";
// Ein Jahr in Sekunden - die von RFC 9111 empfohlene Obergrenze fuer max-age.
const IMMUTABLE_MAX_AGE_SECONDS = 31_536_000;
const IMMUTABLE_CACHE_CONTROL = `public, max-age=${IMMUTABLE_MAX_AGE_SECONDS}, immutable`;
// HTML muss bei JEDEM Deploy neu geholt werden: veraltetes HTML zeigt auf Chunk-Namen des
// Vorgaenger-Builds, die es nicht mehr gibt (Vorfall 2026-07-28, PLAN-AUTH-GATE Abschnitt
// 1/2). no-cache = darf gespeichert werden, MUSS aber vor jeder Nutzung revalidiert werden.
const HTML_CACHE_CONTROL = "no-cache";

// Welcher Cache-Control-Wert gilt fuer DIESE Datei? Reine Entscheidung ohne Nebenwirkung
// (P5 Command-Query): null = kein eigener Wert -> der serve-static-Default
// (public, max-age=0) bleibt unangetastet stehen. filePath ist der ABSOLUTE Dateisystem-
// Pfad, den serve-static gerade ausliefert; astroDirPrefix ist "<dist>/_astro" + Trenner.
//
// Reihenfolge ist Absicht, nicht Zufall: HTML zuerst. Ein faelschlich als immutable
// ausgeliefertes HTML ueberlebt jeden Rollback im Browser des Nutzers, und kein Deploy holt
// es zurueck - diese Reihenfolge macht das strukturell unmoeglich (G27 Struktur statt
// Konvention), statt sich darauf zu verlassen, dass nie eine .html unter _astro/ landet.
//
// EXAKTER Praefix-Match, KEIN "enthaelt _astro": ein Geschwister-Verzeichnis wie
// _astrophysik/ oder eine Datei _astro.txt darf niemals immutable werden.
function cacheControlForStaticFile(filePath, astroDirPrefix) {
  if (filePath.endsWith(HTML_SUFFIX)) return HTML_CACHE_CONTROL;
  if (filePath.startsWith(astroDirPrefix)) return IMMUTABLE_CACHE_CONTROL;
  return null;
}

export function registerStaticServing({ app, config }) {
  // ---- Single-Origin: apps/web (Astro-Build) statisch ausliefern (WEB_DIST_DIR) ----
  // Hinter dem Pfad-Flag (leer = aus -> heutiges Serving byte-identisch).
  // AUTH-AUSNAHME (Regel 3, begruendet): Marketing-Seiten + die /app-Shell sind bewusst
  // oeffentlich - statisches HTML/JS OHNE Tenant-Daten. Jede Tenant-Sicht laedt ihre Daten
  // erst ueber /api/self-service/* (webAuthMw, active-only, Session-Cookie) -> kein
  // Datenleck ueber das statische Serving. /api/*, /auth/*, /.well-known/*, der Stripe-
  // Webhook und /healthz sind oben bereits gematcht (Mount-Reihenfolge) -> kein Shadowing;
  // die Reihenfolge bleibt aus diesem Grund fix, auch ohne die frueher davorstehende
  // Basic-Auth-Schicht. Die Owner-Legacy-API (weiter unten gemountet) traegt seit AUTH-P7
  // ihre eigene Sicherung (internalOnly).
  if (config.server.webDistDir) {
    // Altpfad /tenant.html -> /app. Die Datei public/tenant.html ist mit P14 geloescht;
    // dieser Redirect bleibt trotzdem, und zwar NICHT nur wegen Bookmarks: eine Stripe-
    // Checkout-Session, die VOR dem Deploy geoeffnet wurde, traegt die alte Rueckkehr-
    // Adresse in der Stripe-Session - ohne den Redirect landet genau der Kunde, der
    // gerade bezahlt hat, auf einem 404. P2/D2: den Query-String ERHALTEN, sonst saehe
    // die BillingIsland (?card/?sub-Handler) den Parameter nie. Nur den Such-Teil
    // anhaengen (kein Query -> reines /app).
    app.get(LEGACY_PORTAL_PATH, (req, res) => {
      const queryAt = req.originalUrl.indexOf("?");
      const search = queryAt === -1 ? "" : req.originalUrl.slice(queryAt);
      res.redirect(HTTP_FOUND, APP_PATH + search);
    });
    // Statische Marketing-Site + App-Shell. extensions:["html"] loest /preise -> preise.html
    // auf; "/" liefert dist/index.html, /app -> app/index.html (express.static-Index-Default).
    // AUTH-P9a: EINE Quelle fuer den Praefix (G5), einmal beim Mount berechnet statt pro
    // Request. config.server.webDistDir ist bereits absolut (config.js path.resolve, AM3) -
    // dieselbe Basis, gegen die serve-static den ausgelieferten Pfad aufloest.
    const astroDirPrefix = path.join(config.server.webDistDir, ASTRO_ASSET_DIR) + path.sep;
    app.use(
      express.static(config.server.webDistDir, {
        extensions: ["html"],
        // serve-static feuert setHeaders VOR seinem eigenen Cache-Control-Default und setzt
        // diesen nur, wenn der Header noch nicht steht -> unser Wert gewinnt, und wo wir
        // nichts setzen, bleibt der heutige Default (public, max-age=0) unveraendert.
        setHeaders: (res, filePath) => {
          const cacheControl = cacheControlForStaticFile(filePath, astroDirPrefix);
          if (cacheControl) res.set("Cache-Control", cacheControl);
        },
      }),
    );
    // SPA-Fallback: Unterpfade unter /app liefern die App-Shell (Client-seitiges Routing).
    app.get("/app/*", (_req, res) => res.sendFile(path.join(config.server.webDistDir, "app", "index.html")));
  }
}

// ---- REST-API + MCP: die Mount-Sequenz hinter den Voice-Webhooks -------------------
// Eigener benannter Registrar wie installGlobalMiddleware/registerPublicRoutes/
// registerStaticServing - REINE Verschiebung aus buildApp, Reihenfolge und Argumente
// unveraendert (INV-2: die Sequenz bleibt an EINER Stelle sichtbar, sie ist nur eine
// Ebene tiefer benannt). deps kommt als GANZES herein, damit diese Liste nicht zum
// zweiten, mitzupflegenden Abbild der buildApp-Signatur wird; operatorAuth entsteht erst
// im Web-Login-Block darueber und wird deshalb getrennt gereicht.
export function registerApiRoutes({ app, deps, operatorAuth }) {
  const {
    config,
    store,
    audit,
    callFinish,
    lifecycle,
    provisioning,
    outboundGates,
    // T2-08 (T-27): dieselbe makeOutboundGates-Instanz wie outboundGates, EIN zweites
    // Feld (kein zweiter Aufruf von makeOutboundGates, keine zweite Quelle).
    callQuotaDenial,
    requestTenant,
    requireTenant,
    costTruing,
    consultDelivery,
    elevenLabsOutbound,
    // T2-07 (T-28): in installGlobalMiddleware gebaut, s. Kommentar an buildApp.
    mcpDrosseln,
    mcpBodyParsers,
  } = deps;

  // ---- Outbound-Call-Routen -------------------------------------------------------
  // Die Outbound-Call-Route-Gruppe (POST /api/calls, POST /api/calls/:id/cancel) lebt
  // in src/routes/api-calls.js (makeCallRoutes, DI-Muster wie makeReadRoutes) - reine
  // Verschiebung, Verhalten unveraendert. An unveraenderter Mount-Position (nach
  // der REST-API-Section, vor makeReadRoutes), hinter `internalOnly` (AUTH-P5).
  // INV-9: die Outbound-Gate-Kette (outboundGates = EIN gepinntes Array) + der Max-Dauer-
  // Cap (arm.*) + der Fehlerpfad (terminateAndBillCall) wandern unveraendert mit; finishCall
  // = die EINE callFinish-Instanz (INV-7), arm.* = die EINE lifecycle-Instanz.
  //
  // T2-13 (N-10): die Bestaetigungs-Vorschau (POST /api/call-confirmations) sitzt
  // UNMITTELBAR VOR makeCallRoutes, absichtlich NICHT unter /api/calls/... (Kollision mit
  // /api/calls/:id) und ohne outboundGates/finishCall - sie faehrt keine Gate-Kette,
  // ersetzt keins, schreibt nichts in den Store (s. Kommentar an der Route).
  app.use(makeCallConfirmationRoutes({ store, config, tenant: { requestTenant } }));

  app.use(
    makeCallRoutes({
      store,
      config,
      audit,
      outboundGates,
      // T2-08 (T-27): fehlt sie im deps-Buendel, bleibt der Platz LEER statt hier zu
      // werfen - makeCallRoutes setzt dann seinen fail-closed Ersatz ein (503 statt
      // stillem "immer erlaubt", s. callQuotaDenialNotWired dort).
      callQuotaDenial,
      voiceControl,
      // EL-Anrufstart: die EINE Instanz aus server.js (INV-7, Naht wie callFinish) - sie
      // haelt den ziehenden Ergebnisweg des Anbieters. Fehlt sie im deps-Buendel, bleibt
      // der Platz LEER statt hier zu werfen: makeCallRoutes setzt dann seinen
      // fail-closed Ersatz ein (kein Anruf ohne verdrahteten Anrufstart).
      originateElevenLabsCall: elevenLabsOutbound?.originateCall,
      terminateAndBillCall,
      hangUpAction,
      // TEIL B (Owner-Auftrag 15.08.2026): die EL-Parallele zu hangUpAction, plus die
      // konkrete Implementierung (dieselbe elevenLabsOutbound-Instanz wie oben).
      elevenLabsHangUpAction,
      endActiveCall: elevenLabsOutbound?.endActiveCall,
      // IEL-B5 (E10): Ergebnis-Teil des Bruecken-Beende-Thunks fuer cancel_call.
      awaitAndPersistInboundElResult: elevenLabsOutbound?.awaitAndPersistInboundElResult,
      billThunk,
      finishCall: callFinish.finishCall,
      arm: {
        armMaxDurationTimer: lifecycle.armMaxDurationTimer,
        armReserveReleaseTimer: lifecycle.armReserveReleaseTimer,
      },
      tenant: { requestTenant, requireTenant, tenantOwnsCall },
      // AL-P13: die EINE Consult-Zustell-Instanz (INV-7, in server.js konstruiert) -
      // Poll-Zaehler und Drain-Flag leben in ihrem Closure-Scope; eine zweite Instanz
      // haette zweite Zaehler und damit keine Obergrenze.
      consultDelivery,
      internalIdentity,
      OWNER_ID,
    }),
  );

  // ---- Read-/Export-Routen (Phase 3) ----
  // T4-Decomposition: die GET-Route-Gruppe (/api/state, /api/calls/:id,
  // /api/tenant-data/export) lebt in src/routes/api-read.js (makeReadRoutes,
  // DI-Muster wie makeCallRoutes) - reine Verschiebung, Verhalten unveraendert.
  // STATE_*-Konstanten und die View-Helfer (publicCall/upcomingCalendar/activeNumberFor)
  // sind mitgewandert; tenantOwnsCall (eine Quelle wie POST /api/calls/:id/cancel) und
  // die request-tenant-Resolver werden injiziert. Hinter `internalOnly` (AUTH-P5); die
  // lesenden MCP-Tools erben das Scoping AUTOMATISCH ueber /api/state.
  app.use(
    makeReadRoutes({
      store,
      config,
      audit,
      tenant: { requestTenant, requireTenant, tenantOwnsCall },
    }),
  );

  // ---- Inbox-Route (INBOX-P2) -------------------------------------------------------
  // POST /api/inbox/poll lebt in src/routes/api-inbox.js (makeInboxRoutes, DI-Muster wie
  // makeCallRoutes/makeBillingRoutes). EIGENE Factory, weil die Route Zustand VERBRAUCHT
  // und damit nicht in die Read-/Export-Gruppe gehoert (E-4). Mount NACH makeReadRoutes,
  // damit die Reihenfolge der bestehenden Gruppen unveraendert bleibt. Hinter
  // `internalOnly` (in der Factory) + requireTenant (im Handler, REJECT -> 403).
  app.use(
    makeInboxRoutes({
      store,
      audit,
      tenant: { requireTenant },
    }),
  );

  // ---- Billing-Routen ---------------------------------------------------------------
  // Die /api/billing/*-Route-Gruppe (flush-meters, setup-checkout, checkout-return,
  // cost-truing/sweep) lebt in src/routes/api-billing.js (makeBillingRoutes, DI-Muster
  // wie makeReadRoutes). An unveraenderter Mount-Position (nach makeReadRoutes, vor
  // /api/onboard). Die vier Betreiber-Routen (flush-meters, cost-truing/sweep,
  // cost-drift, platform-costs) haengen hinter webAuthMw+adminMw und werden NUR DANN
  // gemountet, wenn operatorAuth existiert (AUTH-P6, s.o.). Das Legacy-Checkout-Paar
  // (setup-checkout, checkout-return, geloescht erst in P9) traegt seit AUTH-P7
  // `internalOnly` (dieselbe Middleware wie die sieben P5-Routen). billing =
  // stripeBilling (EINE Instanz, INV-7); requireTenant = die EINE Wurzel-Instanz (403
  // bei TENANT_REJECT). costTruing = die EINE LCT-P3-Instanz (INV-7, in server.js
  // konstruiert).
  app.use(
    makeBillingRoutes({
      config,
      store,
      audit,
      billing: stripeBilling,
      tenant: { requireTenant },
      costTruing,
      operatorAuth,
    }),
  );

  // ---- Onboarding-Routen ------------------------------------------------------------
  // /api/onboard + /api/onboard/retry lebt in src/routes/api-onboard.js
  // (makeOnboardRoutes, DI-Muster wie makeBillingRoutes/makeCallRoutes). Unveraenderte
  // Mount-Position (nach makeBillingRoutes, vor /mcp), hinter webAuthMw+adminMw, NUR
  // DANN gemountet, wenn operatorAuth existiert (AUTH-P6, s.o.).
  // provisioning = die EINE P6-Instanz (INV-7). Der withStoreLock-kritische Abschnitt +
  // Nummern-Caps + persist_error->503 sind unveraendert.
  app.use(makeOnboardRoutes({ store, config, audit, provisioning, operatorAuth }));

  // ---- Deploy-Nachweis (OpenAI-P10b) -------------------------------------------------
  // GET /api/admin/deploy-info lebt in src/routes/api-deploy-info.js
  // (makeDeployInfoRoutes, DI-Muster wie makeOnboardRoutes/makeBillingRoutes). Mount
  // NACH makeOnboardRoutes, vor /mcp - hinter webAuthMw+adminMw, NUR DANN gemountet,
  // wenn operatorAuth existiert (AUTH-P6, s.o.). Ersatz fuer die aus /healthz entfernte
  // configHash-Preisgabe (Preimage-Befund, s. Kommentar in api-deploy-info.js).
  app.use(makeDeployInfoRoutes({ config, operatorAuth }));

  // ================= MCP ueber Streamable HTTP (Custom Connector) =================
  // Das /mcp-Trio (POST mit mcpAuth, GET/DELETE -> 405) lebt in src/routes/mcp.js
  // (makeMcpRoutes, DI-Muster wie makeBillingRoutes/makeVoiceRoutes) - reine Verschiebung,
  // Verhalten unveraendert. Mount an UNVERAENDERTER Position: nach makeOnboardRoutes, vor
  // errorHandler (INV-2). mcpAuth (src/auth.js) bleibt die einzige IDENTITAETS-Pruefung
  // auf POST, fail-closed; die Herkunftswache (mcpOriginOnlyMiddleware, E5) laeuft im
  // Modul davor und ersetzt sie nicht. Stateless pro Request
  // (INV-8) + res.on("close")-Cleanup sind ins Modul mitgewandert. requestTenant = die EINE
  // Wurzel-Instanz (INV-7). mcpDrosseln/mcpBodyParsers (T2-07/T-28): dieselben Instanzen
  // wie im globalen Middleware-Stack (installGlobalMiddleware), hier injiziert statt
  // ein zweites Mal gebaut.
  app.use(
    makeMcpRoutes({ config, store, requestTenant, mcpDrosseln, bodyParsers: mcpBodyParsers }),
  );
}

export async function buildApp(deps) {
  // Nur, was DIESE Ebene selbst braucht - die Kollaborateure der REST-API-Sequenz nimmt
  // registerApiRoutes direkt aus deps (kein zweites, mitzupflegendes Abbild).
  const {
    config,
    store,
    audit,
    callFinish,
    lifecycle,
    provisioning,
    ttsStore,
    directiveSynth,
    voiceRender,
    messaging,
    // IEL-B5: die EINE EL-Instanz - /voice/status startet ueber sie den Nachlauf (INV-7).
    elevenLabsOutbound,
    // IEL-B6: die EINE Frist-Instanz der Inbound-Bruecken (INV-7) - die Init-Route loescht ihre
    // Fristen bei der ersten Bindung. B8: auch die Voice-Routen.
    inboundBridges,
    // EL-BL4: die EINE ConsultDelivery-Instanz (INV-7). registerApiRoutes nimmt sie fuer
    // die Poll-Route direkt aus deps; DIESE Ebene braucht sie selbst, weil der
    // ElevenLabs-Rueckfrage-Webhook hier gemountet wird und auf ihren Slot-Zaehlern und
    // ihrem Drain-Flag sitzt.
    consultDelivery,
    // F2-Mail: spaet gebundene Accounts-Zelle (server.js) - an wireWebLogin durchgereicht,
    // das accountsRef.current NACH dem Bau von accounts setzt (Muster operatorAuth unten).
    accountsRef,
    // KV2-1: dieselbe Mechanik fuer den durablen Audit-Sink des Kostenpfads.
    auditStoreRef,
    // P3: der mandanten-gebundene durable Auditor (server.js) - der EL-Rueckfrage-Webhook
    // schreibt damit die Spur eines gescheiterten Halts. Kein neuer Weg, dieselbe Fabrik.
    durableAuditFor,
    // DIP-Seam (PLAN-AUTH-GATE P1) - dieselbe Naht, die wireWebLogin intern schon nutzt,
    // nur eine Ebene hoeher gezogen: der Routen-Inventar-Test
    // (test/route-auth-inventory.test.js) muss den PRODUKTIONS-Routengraph bauen
    // (sessionSecret + storeBackend "pg" -> Web-Login-Block gemountet), und der einzige
    // infrastruktur-beruehrende Kollaborator darin ist der pg-Pool. Default = der echte
    // Runner -> der Produktivpfad (server.js reicht den Dep nicht) bleibt unveraendert.
    createPortalRunner = defaultCreatePortalRunner,
  } = deps;

  const app = express();
  // Genau EIN vertrauenswuerdiger Proxy (Render). Nicht `true`: sonst kann jeder Client
  // per X-Forwarded-For eine beliebige IP vortaeuschen.
  app.set("trust proxy", 1);

  // T2-07 (T-28): mcpDrosseln + mcpBodyParsers entstehen HIER (installGlobalMiddleware
  // baut sie, s. dort) und wandern unveraendert an registerApiRoutes -> makeMcpRoutes -
  // EINE Instanz je Prozess, kein zweiter Bau.
  const { mcpDrosseln, mcpBodyParsers } = installGlobalMiddleware({ app, config });
  registerPublicRoutes({ app, config });
  registerPathRedirects({ app });

  // ---- OIDC-Browser-Login (/auth/*) -----------------------------------
  // Nur aktiv wenn sessionSecret UND pg-Backend gesetzt: ohne DB kein Session-Store,
  // ohne Secret keine Cookie-Signatur. Muss VOR express.static liegen, damit
  // /auth/login nicht durch das statische Serving geschattet wird.
  //
  // AUTH-P6: operatorAuth traegt die Admin-Sitzungs-Middlewares (webAuthMw+adminMw) fuer
  // die sechs Betreiber-Routen (makeBillingRoutes/makeOnboardRoutes, s.u.) nach oben.
  // Initialwert null, Zuweisung NUR im guardedBoot-Callback: wirft ein Schritt davor oder
  // laeuft der Block gar nicht (kein sessionSecret/pg), bleibt operatorAuth null -
  // fail-closed by construction, kein Zweig, den man vergessen kann. guardedBoot selbst
  // bleibt unveraendert (liefert weiterhin boolean, s. INV-11/boot-guard.test.js).
  let operatorAuth = null;
  if (config.auth.sessionSecret && config.store.storeBackend === "pg") {
    // INV-11: der gesamte Web-Login/Portal/Stripe-Webhook/Self-Service-Block (in
    // src/wiring/web-login.js, wireWebLogin) laeuft in guardedBoot (fail-OPEN). Wirft
    // createPortalRunner (F5-Rollen-Assertion ODER Portal-DB unerreichbar) oder ein
    // Wiring-Schritt, faengt guardedBoot es laut + secret-frei ab -> Routen NICHT gemountet
    // (404), aber /voice, /healthz, /mcp und das Owner-Dashboard leben weiter. Q1: wireWebLogin
    // loggt im Erfolgsfall "[boot] Web-Login aktiv" (eigene Zeile), sodass der fail-open-
    // Zustand nicht mehr unsichtbar ist. createPortalRunner injiziert (DIP-Seam, offline
    // fakebar); STRIPE_WEBHOOK_PATH/APP_PATH bleiben EINE Konstante
    // (INV-1) und werden hereingereicht. provision = provisioning.triggerTenantProvisioning
    // (die EINE P6-Orchestrator-Instanz, in server.js konstruiert, TDZ-Vermeidung).
    await guardedBoot("Web-Login/Portal", async () => {
      operatorAuth = await wireWebLogin({
        app,
        config,
        store,
        audit,
        provision: provisioning.triggerTenantProvisioning,
        createPortalRunner,
        stripeWebhookPath: STRIPE_WEBHOOK_PATH,
        appPath: APP_PATH,
        messaging,
        // F2-Mail: wireWebLogin setzt accountsRef.current NACH dem Bau von accounts.
        accountsRef,
        // KV2-1: dieselbe Mechanik fuer den durablen Audit-Sink des Kostenpfads.
        auditStoreRef,
      });
    });
  }

  registerStaticServing({ app, config });
  app.use(express.static(config.server.publicDir));

  // Play-TTS-Seam, Voice-Render-Helfer und Directiven-Synth kommen als die EINEN
  // Wurzel-Instanzen herein (INV-7, in server.js konstruiert).

  // ---- Voice-Webhooks -----------------------------------------------------------------
  // Alle /voice/* (GET /voice/tts/:token, app.use("/voice",sig-MW), incoming/turn/outbound/
  // status) leben in routes/voice.js (makeVoiceRoutes, DI-Muster wie
  // makeCallRoutes). Mount an UNVERAENDERTER Position: nach express.static(publicDir), vor
  // makeCallRoutes (INV-2). Sicherung ist die Provider-Signaturpruefung, fail-closed. INV-4: TTS-Route
  // VOR der Sig-MW (im Router festgehalten). finishCall = die EINE callFinish-Instanz
  // (INV-7); voiceRender/directiveSynth/ttsStore/lifecycle = die EINEN Wurzel-Instanzen.
  app.use(
    makeVoiceRoutes({
      store,
      config,
      audit,
      voiceRender,
      directiveSynth,
      ttsStore,
      lifecycle,
      finishCall: callFinish.finishCall,
      webhookEvents,
      providerFromHeaders,
      inboundSignatureVerifier,
      terminateAndBillCall,
      billThunk,
      startInboundNachlauf: elevenLabsOutbound?.startInboundNachlauf,
      // IEL-B8: die EINE Frist-Instanz (INV-7) - /voice/incoming armiert, /voice/el-rueckfall loescht,
      // /voice/el-bein armiert die innere Frist.
      inboundBridges,
    }),
  );

  // ---- Werkzeug-Webhooks des ElevenLabs-Laufwerks (get_consult + look_up) ---------
  // Seit Thema B (2026-08-19) traegt derselbe Router auch den Recherche-Webhook
  // /webhooks/elevenlabs/lookup - gleiche Bauart, eigene Gates (PLAN-SECURITY EL-P7).
  // AUTH-AUSNAHME (Regel 3, begruendet): der Agent des Anbieters ruft serverseitig und
  // kann keinen Session-Cookie senden; ElevenLabs signiert Werkzeug-Webhooks nicht.
  // Absicherung im Handler: timing-sicherer Vergleich (safeEqual) des Headers
  // x-hermes-tool-token gegen ELEVENLABS_TOOL_TOKEN, fail-closed bei leerem Wert - dann
  // Bindung an einen laufenden Anruf, Faehigkeits-Gate und die pro-Tenant-Kostendecke
  // (volle Begruendung im Routenmodul + src/route-policy.js). NICHT unter /voice: die
  // Ed25519-Signaturpruefung dort bleibt unberuehrt. Die Wirkung laeuft ueber den
  // BESTEHENDEN Consult-Kanal (call.consults, AL-P13); makeConsultRaised haelt selbst
  // keinen Zustand und wird deshalb hier in der Kompositionswurzel gebaut.
  //
  // BEIDE Nahtstellen zeigen auf DIESELBE consultDelivery-Instanz (INV-7), und zwar
  // aus zwei Gruenden: ihre Slot-Zaehler begrenzen, wie viele Verbindungen gleichzeitig
  // an einem Anruf/Mandanten haengen duerfen - dieser Webhook ist ein solcher Halter
  // (EL-BL4) -, und ihr Drain-Flag loest beim Deploy auch den hier wartenden Aufruf auf,
  // bevor httpServer.close() darauf wartet (EL-BEFUND-4). Eine zweite Instanz haette
  // zweite Zaehler und damit gar keine Obergrenze.
  app.use(
    makeElevenLabsWebhookRoutes({
      store,
      config,
      consultSlots: consultDelivery,
      onConsultRaised: makeConsultRaised({ store, isDraining: consultDelivery.isDraining }),
      // P3 (N-10): der durable, mandanten-gebundene Audit-Weg. OHNE Default und bewusst:
      // ein stiller No-op verstecke genau die Blindheit, die diese Phase behebt. Dass die
      // Verdrahtung steht, pinnt test/el-consult-timeout-spur.test.js (P3-7).
      auditFor: durableAuditFor,
    }),
  );

  // ---- IEL-B6: Conversation-Initiation-Webhook (POST /webhooks/elevenlabs/init) ----------
  // AUTH-AUSNAHME (Regel 3, begruendet in src/route-policy.js und im Routenmodul): Geheimnis-
  // Header, dann Zuordnung ueber das Bindungs-Token an einen wartenden Inbound-EL-Anruf. NICHT
  // unter /voice; statt des globalen Limiters haengt die Init-Token-Schranke vor den Parsern
  // (installGlobalMiddleware, IEX-A7).
  app.use(makeElevenLabsInitWebhookRoutes({ store, config, bridges: inboundBridges }));

  // ================= REST-API (Dashboard + MCP-Tools) + MCP-Transport ==============
  // Die Mount-Sequenz selbst steht in registerApiRoutes (oben) - Position, Reihenfolge
  // und Argumente unveraendert (INV-2). operatorAuth entsteht im Web-Login-Block und
  // entscheidet dort ueber die sechs Betreiber-Routen (AUTH-P6).
  // T2-07 (T-28): mcpDrosseln/mcpBodyParsers reisen als ZUSAETZLICHE Felder auf demselben
  // deps-Objekt mit - registerApiRoutes bekommt weiter "deps als GANZES" (Kommentar dort),
  // nur um die zwei hier oben gebauten Kollaboratoren ergaenzt (kein zweites Abbild).
  registerApiRoutes({ app, deps: { ...deps, mcpDrosseln, mcpBodyParsers }, operatorAuth });

  // ---- Catch-all Error-Net -----------------------------------------------------------
  // MUSS NACH allen Route-Mounts und VOR app.listen stehen: Express-Error-MW sieht nur
  // Fehler von davor gemounteten Routen. Last-Resort-Netz fuer synchron geworfene/per
  // next(err) gereichte Routen-Fehler -> generische 500, NIE err.message/stack/Env an den
  // Client (Regel 4/5); err.stack nur server-seitig laut geloggt. Die per-Route-try/catch
  // (z.B. /auth/login, /voice/turn) bleiben die primaere Schicht (Express 4 reicht
  // async-Rejections NICHT automatisch hierher). Die body-parser-Error-MW (oben, 4xx
  // Parser-Fehler) bleibt unveraendert an ihrer Stelle.
  app.use(errorHandler);

  return { app };
}
