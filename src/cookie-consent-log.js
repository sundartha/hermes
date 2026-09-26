// Cookie-Einwilligungs-Protokoll: der Nachweis nach Art. 7 Abs. 1 DSGVO ("der
// Verantwortliche muss nachweisen koennen, dass die betroffene Person eingewilligt hat").
//
// Die Entscheidung selbst lebt weiterhin im Browser (localStorage "hermes.consent",
// apps/web/src/scripts/consent.js) - dort wird sie gelesen und wirkt. Diese Tabelle ist
// NUR der Beleg: jede Entscheidung (Zustimmung, Ablehnung, Aenderung, Widerruf) landet
// als eigene, unveraenderliche Zeile. Der aktuelle Stand einer Einwilligung ist die
// juengste Zeile ihrer consent_id.
//
// DATENMINIMIERUNG (Art. 5 Abs. 1 lit. c DSGVO), bewusst:
//   - keine IP-Adresse, kein User-Agent, kein Account, kein Tenant;
//   - consent_id ist eine im Browser erzeugte Zufalls-UUID (crypto.randomUUID) und
//     sonst nirgends gespeichert - sie verknuepft nur die Entscheidungen EINES Browsers;
//   - site ist allein der Host der Seite, auf der entschieden wurde (sundartha.com vs.
//     Labor), abgeleitet aus dem Origin-Header - nie ein Pfad oder Query.
//
// Aufbewahrung: drei Jahre (regelmaessige Verjaehrung, § 195 BGB) - so lange kann eine
// Einwilligung streitig werden. Der Sweep unten loescht aeltere Zeilen.
//
// AUTH-AUSNAHME (Regel 3, begruendet in src/route-policy.js): Besucher der Marketing-
// Seite haben keine Sitzung. Die Route schreibt ausschliesslich eine anonyme Zeile in
// diese Tabelle, liest nichts, liefert nichts zurueck; der globale Per-IP-Rate-Limiter
// (app.js installGlobalMiddleware) deckelt die Schreibrate.
import express from "express";

export const COOKIE_CONSENT_PATH = "/api/cookie-consent";

const DAYS_PER_YEAR = 365;
const RETENTION_YEARS = 3;
export const COOKIE_CONSENT_RETENTION_DAYS = RETENTION_YEARS * DAYS_PER_YEAR;
const HOURS_PER_DAY = 24;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const MS_PER_DAY = HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;
const RETENTION_SWEEP_INTERVAL_MS = MS_PER_DAY;

// Ein Datensatz ist rund 100 Byte JSON. 1 kB ist grosszuegig und haelt Muell klein.
const BODY_LIMIT = "1kb";
// navigator.sendBeacon mit Blob-Typ text/plain ist ein CORS-"einfacher" Request ohne
// Preflight - deshalb kommt der Body als Text, nicht als JSON.
const BEACON_CONTENT_TYPE = "text/plain";
// Obergrenze der Banner-Version: echte Werte sind einstellig. Schuetzt die Spalte vor
// beliebig grossen Zahlen aus einem gebastelten Request.
const MAX_CONSENT_VERSION = 999;
// RFC-4122-Version-4-UUID, klein geschrieben (crypto.randomUUID liefert genau diese Form).
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WEB_PROTOCOLS = new Set(["https:", "http:"]);

const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_SERVER_ERROR = 500;

function bodyAsObject(body) {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

const isVersion = (value) => Number.isInteger(value) && value >= 1 && value <= MAX_CONSENT_VERSION;

// Reine Pruefung (kein IO): liefert den normalisierten Datensatz oder null. Strikt:
// Kategorien muessen echte Booleans sein - ein "true"-String ist KEINE Einwilligung.
export function parseConsentRecord(body) {
  const raw = bodyAsObject(body);
  if (!raw || typeof raw !== "object") return null;
  const { id, version, statistics, marketing } = raw;
  if (typeof id !== "string" || !UUID_V4.test(id)) return null;
  if (!isVersion(version)) return null;
  if (typeof statistics !== "boolean" || typeof marketing !== "boolean") return null;
  return { consentId: id, version, statistics, marketing };
}

// Host der entscheidenden Seite aus dem Origin-Header, oder null. Browser senden Origin
// bei jedem POST; fehlt er oder ist er kein http(s)-Origin, ist es kein Seitenbesuch.
export function siteFromOrigin(origin) {
  if (typeof origin !== "string" || !origin) return null;
  try {
    const url = new URL(origin);
    return WEB_PROTOCOLS.has(url.protocol) ? url.host : null;
  } catch {
    return null;
  }
}

// Schreib-/Loeschpfad auf die Tabelle cookie_consent_log (schema.sql). Keine RLS: die
// Tabelle hat keine Tenant-Dimension und wird NIE ueber Kunden-Reads exponiert.
export function makeCookieConsentLog(runner) {
  return {
    record: ({ consentId, version, statistics, marketing, site }) =>
      runner.withClient((client) =>
        client.query(
          `INSERT INTO cookie_consent_log (consent_id, version, statistics, marketing, site)
           VALUES ($1, $2, $3, $4, $5)`,
          [consentId, version, statistics, marketing, site],
        ),
      ),
    pruneOlderThanDays: async (days) => {
      const result = await runner.withClient((client) =>
        // RETURNING statt rowCount: der Zaehler heisst bei pg und pglite verschieden,
        // die zurueckgegebenen Zeilen sind bei beiden gleich.
        client.query(
          `DELETE FROM cookie_consent_log WHERE at < now() - make_interval(days => $1) RETURNING id`,
          [days],
        ),
      );
      return result.rows.length;
    },
  };
}

// Boot-Lauf + taeglicher Sweep der Aufbewahrungsfrist. Muster scheduleStripeReconcile
// (wiring/web-login.js): fire-and-forget, eigener catch, unref().
export function scheduleCookieConsentRetention(consentLog) {
  const run = () =>
    void consentLog
      .pruneOlderThanDays(COOKIE_CONSENT_RETENTION_DAYS)
      .then((removed) => {
        if (removed > 0)
          console.log(`[cookie-consent] ${removed} Protokollzeilen nach Fristablauf geloescht`);
      })
      .catch((err) =>
        console.error("[cookie-consent] Aufbewahrungs-Sweep fehlgeschlagen:", err.message),
      );
  run();
  setInterval(run, RETENTION_SWEEP_INTERVAL_MS).unref();
}

// POST /api/cookie-consent. Antwortet 204 ohne Body - der Browser liest die Antwort
// eines Beacons ohnehin nicht, und eine Antwort ohne Inhalt verraet nichts.
export function makeCookieConsentRoutes({ consentLog }) {
  const router = express.Router();
  async function recordCookieConsent(req, res) {
    const site = siteFromOrigin(req.get("origin"));
    const record = parseConsentRecord(req.body);
    if (!site || !record)
      return res.status(HTTP_BAD_REQUEST).json({ error: "ungueltiger Einwilligungs-Datensatz" });
    try {
      await consentLog.record({ ...record, site });
      res.status(HTTP_NO_CONTENT).end();
    } catch (err) {
      console.error("[cookie-consent] Protokoll-Schreibfehler:", err.message);
      res.status(HTTP_SERVER_ERROR).json({ error: "interner Fehler" });
    }
  }
  router.post(
    COOKIE_CONSENT_PATH,
    express.text({ type: BEACON_CONTENT_TYPE, limit: BODY_LIMIT }),
    recordCookieConsent,
  );
  return router;
}

// Die EINE Verdrahtung (G5): Schreiber auf dem uebergebenen Runner, Fristen-Sweep, Route.
// Aufgerufen aus wiring/web-login.js (pg-Block) mit dem portalRunner.
export function mountCookieConsentLog({ app, runner }) {
  const consentLog = makeCookieConsentLog(runner);
  scheduleCookieConsentRetention(consentLog);
  app.use(makeCookieConsentRoutes({ consentLog }));
}
