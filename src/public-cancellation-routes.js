// POST /api/cancellation - die Kuendigungserklaerung des oeffentlichen Formulars auf
// sundartha.com/kuendigen (§ 312k BGB, Fachlogik in billing/public-cancellation.js).
//
// AUTH-AUSNAHME (Regel 3, begruendet in src/route-policy.js): wer kuendigen will, darf
// dafuer keine Anmeldung brauchen - genau das ist der Zweck der Route. Die Sicherung:
// strikte Eingabepruefung, eine eigene enge Per-IP-Drossel, eine Antwort, die nie verraet,
// ob eine Email Kunde ist, und Mails ausschliesslich an die Konto-Adresse oder das eigene
// Kundenpostfach - nie an die Adresse aus dem Formular. Loest weder Anruf noch SMS noch
// Zahlung aus; die einzige Geldwirkung ist das Vormerken des Abo-Endes, das der Inhaber
// im Kundenbereich zuruecknimmt.
//
// Das Formular sendet per fetch als application/x-www-form-urlencoded - ein CORS-
// "einfacher" Request ohne Preflight; der globale Parser (app.js) liest den Body schon.
// Lesbar ist die Antwort fuer den Browser nur, wenn der Origin unten gelistet ist.
import express from "express";
import { makeFixedWindowCounter, sende429WennGesperrt } from "./middleware.js";
import {
  parseCancellationDeclaration,
  receivePublicCancellation,
} from "./billing/public-cancellation.js";
import { makeTenantByEmail } from "./account-email-lookup.js";

export const PUBLIC_CANCELLATION_PATH = "/api/cancellation";

// Die Seiten, auf denen das Formular steht: Live-Site und Labor. Eine feste Liste statt
// eines Env-Werts: sie aendert sich nur mit einem neuen Seiten-Host, und dann ohnehin im
// Code (apps/web). NIE "*" - die Antwort traegt den Eingangszeitpunkt einer Erklaerung.
export const CANCELLATION_FORM_ORIGINS = Object.freeze([
  "https://sundartha.com",
  "https://www.sundartha.com",
  "https://hermes-web-staging.onrender.com",
]);

// Eine echte Kuendigung braucht einen Versuch, allenfalls zwei. Fuenf je Viertelstunde
// und IP lassen Tippfehler zu und machen das Formular als Spam-Kanal wertlos.
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const WINDOW_MINUTES = 15;
const WINDOW_MS = WINDOW_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;
const ATTEMPTS_PER_WINDOW = 5;

const HTTP_BAD_REQUEST = 400;
const HTTP_SERVER_ERROR = 500;
const HTTP_UNAVAILABLE = 503;

// Verstecktes Feld, das nur Bots ausfuellen. Sie bekommen dieselbe Antwort wie ein
// Mensch (sonst lernen sie das Feld), aber es passiert nichts.
const HONEYPOT_FIELD = "website";

function allowFormOrigin(req, res, next) {
  const origin = req.get("origin");
  if (origin && CANCELLATION_FORM_ORIGINS.includes(origin)) {
    res.vary("Origin");
    res.set("Access-Control-Allow-Origin", origin);
  }
  next();
}

function makeCancellationThrottle() {
  const hit = makeFixedWindowCounter({
    windowMs: WINDOW_MS,
    limit: ATTEMPTS_PER_WINDOW,
    sweepMs: WINDOW_MS,
  });
  return function cancellationThrottle(req, res, next) {
    if (sende429WennGesperrt(res, hit(req.ip))) next();
  };
}

// deps: { store, billing, accounts, tenantByEmail, auditStore, mailer, config } -
// dieselben Instanzen wie der Knopf im Kundenbereich (wiring/web-login.js), kein zweiter
// Mailer, kein zweiter Store.
export function makePublicCancellationRoutes(deps) {
  const router = express.Router();
  async function receiveCancellation(req, res) {
    const receivedAt = new Date().toISOString();
    const body = req.body || {};
    if (body[HONEYPOT_FIELD]) return res.json({ receivedAt });
    const { declaration, invalid } = parseCancellationDeclaration(body);
    if (!declaration)
      return res.status(HTTP_BAD_REQUEST).json({ error: "invalid", fields: invalid });
    try {
      const result = await receivePublicCancellation(deps, { declaration, receivedAt });
      if (!result.ok) return res.status(HTTP_UNAVAILABLE).json({ error: "unavailable" });
      res.json({ receivedAt: result.receivedAt });
    } catch (err) {
      console.error(`[public-cancel] Eingang fehlgeschlagen: ${err.message}`);
      res.status(HTTP_SERVER_ERROR).json({ error: "unavailable" });
    }
  }
  router.post(
    PUBLIC_CANCELLATION_PATH,
    allowFormOrigin,
    makeCancellationThrottle(),
    receiveCancellation,
  );
  return router;
}

// Die EINE Verdrahtung (G5, Muster mountCookieConsentLog): Konto-Zuordnung auf dem
// uebergebenen Runner + Route. Aufgerufen aus wiring/web-login.js (pg-Block) mit
// denselben Instanzen wie der Knopf im Kundenbereich (billing, mailer, auditStore).
export function mountPublicCancellation({ app, runner, deps }) {
  app.use(makePublicCancellationRoutes({ ...deps, tenantByEmail: makeTenantByEmail(runner) }));
}
