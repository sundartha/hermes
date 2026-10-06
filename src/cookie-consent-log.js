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

const BODY_LIMIT = "1kb";
const BEACON_CONTENT_TYPE = "text/plain";
const MAX_CONSENT_VERSION = 999;
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

export function parseConsentRecord(body) {
  const raw = bodyAsObject(body);
  if (!raw || typeof raw !== "object") return null;
  const { id, version, statistics, marketing } = raw;
  if (typeof id !== "string" || !UUID_V4.test(id)) return null;
  if (!isVersion(version)) return null;
  if (typeof statistics !== "boolean" || typeof marketing !== "boolean") return null;
  return { consentId: id, version, statistics, marketing };
}

export function siteFromOrigin(origin) {
  if (typeof origin !== "string" || !origin) return null;
  try {
    const url = new URL(origin);
    return WEB_PROTOCOLS.has(url.protocol) ? url.host : null;
  } catch {
    return null;
  }
}

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
        client.query(
          `DELETE FROM cookie_consent_log WHERE at < now() - make_interval(days => $1) RETURNING id`,
          [days],
        ),
      );
      return result.rows.length;
    },
  };
}

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

export function mountCookieConsentLog({ app, runner }) {
  const consentLog = makeCookieConsentLog(runner);
  scheduleCookieConsentRetention(consentLog);
  app.use(makeCookieConsentRoutes({ consentLog }));
}
