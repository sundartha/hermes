// Cookie-Einwilligungs-Protokoll (Nachweis Art. 7 Abs. 1 DSGVO): Eingabepruefung,
// Schreib-/Loeschpfad gegen das echte Schema (pglite) und die HTTP-Kante.
// Offline, kein Spawn, kein Netz ausser dem lokalen Loopback-Server.
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { PGlite } from "@electric-sql/pglite";
import { applySchema } from "../src/db/migrate.js";
import {
  COOKIE_CONSENT_PATH,
  COOKIE_CONSENT_RETENTION_DAYS,
  makeCookieConsentLog,
  makeCookieConsentRoutes,
  parseConsentRecord,
  siteFromOrigin,
} from "../src/cookie-consent-log.js";

const CONSENT_ID = "3f2b8c1e-9a4d-4c6b-8e2f-1a2b3c4d5e6f";
const VALID = Object.freeze({ id: CONSENT_ID, version: 1, statistics: true, marketing: false });
const SITE_ORIGIN = "https://sundartha.com";
const OVERSIZED_BODY_BYTES = 2048;
const DAYS_OVER_RETENTION = COOKIE_CONSENT_RETENTION_DAYS + 1;
const DAYS_INSIDE_RETENTION = COOKIE_CONSENT_RETENTION_DAYS - 1;
const DECISIONS_WRITTEN = 2;
const HTTP_NO_CONTENT = 204;
const HTTP_BAD_REQUEST = 400;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_SERVER_ERROR = 500;

// ---- Eingabepruefung --------------------------------------------------------------

test("parseConsentRecord: gueltiger Datensatz als Objekt UND als Beacon-Text", () => {
  const expected = { consentId: CONSENT_ID, version: 1, statistics: true, marketing: false };
  assert.deepEqual(parseConsentRecord({ ...VALID }), expected);
  assert.deepEqual(parseConsentRecord(JSON.stringify(VALID)), expected);
});

test("parseConsentRecord: Strings sind KEINE Einwilligung, nur echte Booleans", () => {
  assert.equal(parseConsentRecord({ ...VALID, statistics: "true" }), null);
  assert.equal(parseConsentRecord({ ...VALID, marketing: 1 }), null);
  assert.equal(parseConsentRecord({ ...VALID, statistics: undefined }), null);
});

test("parseConsentRecord: kaputte ID, Version oder Body -> null", () => {
  assert.equal(parseConsentRecord({ ...VALID, id: "nicht-uuid" }), null);
  assert.equal(parseConsentRecord({ ...VALID, id: CONSENT_ID.toUpperCase() }), null);
  assert.equal(parseConsentRecord({ ...VALID, version: 0 }), null);
  assert.equal(parseConsentRecord({ ...VALID, version: 1.5 }), null);
  assert.equal(parseConsentRecord({ ...VALID, version: 1000 }), null);
  assert.equal(parseConsentRecord("{kaputt"), null);
  assert.equal(parseConsentRecord(null), null);
  assert.equal(parseConsentRecord("null"), null);
});

test("siteFromOrigin: nur der Host eines http(s)-Origins, sonst null", () => {
  assert.equal(siteFromOrigin(SITE_ORIGIN), "sundartha.com");
  assert.equal(siteFromOrigin("http://localhost:4321"), "localhost:4321");
  assert.equal(siteFromOrigin("null"), null);
  assert.equal(siteFromOrigin("file:///etc/passwd"), null);
  assert.equal(siteFromOrigin(""), null);
  assert.equal(siteFromOrigin(undefined), null);
});

// ---- Schreib-/Loeschpfad gegen das echte Schema ------------------------------------

async function freshLog() {
  const db = new PGlite();
  const query = (text, params) => db.query(text, params);
  await applySchema({ query, exec: (sql) => db.exec(sql) });
  const log = makeCookieConsentLog({ withClient: (fn) => fn({ query }) });
  return { db, log };
}

test("record schreibt eine anonyme Zeile - Widerruf ist eine NEUE Zeile, kein Update", async () => {
  const { db, log } = await freshLog();
  const base = { consentId: CONSENT_ID, version: 1, site: "sundartha.com" };
  await log.record({ ...base, statistics: true, marketing: true });
  await log.record({ ...base, statistics: false, marketing: false });
  const rows = (
    await db.query(
      `SELECT consent_id, version, statistics, marketing, site FROM cookie_consent_log ORDER BY id`,
    )
  ).rows;
  assert.equal(rows.length, DECISIONS_WRITTEN);
  assert.deepEqual(rows[0], {
    consent_id: CONSENT_ID,
    version: 1,
    statistics: true,
    marketing: true,
    site: "sundartha.com",
  });
  assert.equal(rows[1].statistics, false, "der Widerruf steht als juengste Zeile daneben");
  const columnRows = await db.query(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'cookie_consent_log'`,
  );
  const columns = columnRows.rows.map((row) => row.column_name);
  for (const forbidden of ["ip", "user_agent", "tenant_id", "sub", "email"]) {
    assert.ok(
      !columns.includes(forbidden),
      `Datenminimierung: Spalte ${forbidden} darf es nicht geben`,
    );
  }
});

test("pruneOlderThanDays loescht nur Zeilen jenseits der Frist", async () => {
  const { db, log } = await freshLog();
  const insertAged = (days) =>
    db.query(
      `INSERT INTO cookie_consent_log (at, consent_id, version, statistics, marketing, site)
       VALUES (now() - make_interval(days => $1), $2, 1, false, false, 'sundartha.com')`,
      [days, CONSENT_ID],
    );
  await insertAged(DAYS_OVER_RETENTION);
  await insertAged(DAYS_INSIDE_RETENTION);
  const removed = await log.pruneOlderThanDays(COOKIE_CONSENT_RETENTION_DAYS);
  assert.equal(removed, 1);
  const { rows } = await db.query(`SELECT count(*)::int AS remaining FROM cookie_consent_log`);
  assert.equal(rows[0].remaining, 1);
});

// ---- HTTP-Kante --------------------------------------------------------------------

async function withServer(consentLog, fn) {
  const app = express();
  app.use(express.json());
  app.use(makeCookieConsentRoutes({ consentLog }));
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}${COOKIE_CONSENT_PATH}`);
  } finally {
    server.close();
  }
}

function recordingLog() {
  const calls = [];
  return { calls, record: async (entry) => calls.push(entry) };
}

const beacon = (url, { body = JSON.stringify(VALID), origin = SITE_ORIGIN } = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8", ...(origin ? { origin } : {}) },
    body,
  });

test("POST (Beacon, text/plain) -> 204 ohne Body, Zeile mit Host der Seite", async () => {
  const log = recordingLog();
  await withServer(log, async (url) => {
    const res = await beacon(url);
    assert.equal(res.status, HTTP_NO_CONTENT);
    assert.equal(await res.text(), "");
  });
  assert.deepEqual(log.calls, [
    {
      consentId: CONSENT_ID,
      version: 1,
      statistics: true,
      marketing: false,
      site: "sundartha.com",
    },
  ]);
});

test("POST ohne Origin, mit kaputtem Body oder String-Boolean -> 400, nichts geschrieben", async () => {
  const log = recordingLog();
  await withServer(log, async (url) => {
    assert.equal((await beacon(url, { origin: null })).status, HTTP_BAD_REQUEST);
    assert.equal((await beacon(url, { body: "{kaputt" })).status, HTTP_BAD_REQUEST);
    const stringBoolean = JSON.stringify({ ...VALID, statistics: "true" });
    assert.equal((await beacon(url, { body: stringBoolean })).status, HTTP_BAD_REQUEST);
  });
  assert.equal(log.calls.length, 0);
});

test("POST mit Riesen-Body -> 413, nichts geschrieben", async () => {
  const log = recordingLog();
  await withServer(log, async (url) => {
    const res = await beacon(url, { body: "x".repeat(OVERSIZED_BODY_BYTES) });
    assert.equal(res.status, HTTP_PAYLOAD_TOO_LARGE);
  });
  assert.equal(log.calls.length, 0);
});

test("POST mit Schreibfehler -> 500 ohne Fehlerdetail", async () => {
  const failing = { record: async () => Promise.reject(new Error("db weg: geheime Details")) };
  const { error } = console;
  console.error = () => {};
  try {
    await withServer(failing, async (url) => {
      const res = await beacon(url);
      assert.equal(res.status, HTTP_SERVER_ERROR);
      assert.ok(!(await res.text()).includes("geheime"), "kein Fehlerdetail an den Client");
    });
  } finally {
    console.error = error;
  }
});
