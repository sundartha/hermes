import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startServerExpectExit } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echteDatenbank } from "../gemeinsam/echtes-postgres.js";

const HTTP_OK = 200;
const EXIT_ABBRUCH = 1;
const ZEITGRENZE_MS = 60_000;
const START_FRIST_MS = 30_000;
const GEHEIMNIS = "geheim-2991-passwort";
const UNERREICHBAR = `postgres://hermes:${GEHEIMNIS}@127.0.0.1:1/hermes`;
const ABBRUCH_MELDUNG = "[boot] Warteschlange nicht erreichbar - fail-closed, kein Start";
const PGBOSS_TABELLE = "SELECT to_regclass('pgboss.version') AS tabelle";

async function healthzStatus(srv) {
  return (await abrufMitFrist(`${srv.localUrl}/healthz`)).status;
}

test(
  "K1b-S1: pgboss mit erreichbarer Datenbank legt beim Hochfahren das pgboss-Schema an, /healthz 200",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const db = await echteDatenbank(t);
    if (!db) return;
    const srv = await startServer({ env: { QUEUE_BACKEND: "pgboss", DATABASE_URL: db.adresse } });
    t.after(() => srv.stop());
    assert.equal(await healthzStatus(srv), HTTP_OK);
    const verbindung = await db.verbinden();
    const { rows } = await verbindung.query(PGBOSS_TABELLE);
    assert.notEqual(rows[0].tabelle, null, "pgboss.version fehlt: Warteschlange wurde nicht gestartet");
  },
);

test(
  "K1b-B1: pgboss mit unerreichbarer Datenbank bricht den Start mit Exit 1 ab",
  { timeout: ZEITGRENZE_MS },
  async () => {
    const { code, output } = await startServerExpectExit({
      env: { QUEUE_BACKEND: "pgboss", DATABASE_URL: UNERREICHBAR },
      timeoutMs: START_FRIST_MS,
    });
    assert.equal(code, EXIT_ABBRUCH, `erwartet exit 1, Output:\n${output}`);
    assert.ok(output.includes(ABBRUCH_MELDUNG), `Abbruchmeldung fehlt, Output:\n${output}`);
    assert.doesNotMatch(output, /Gateway laeuft/, "darf NICHT gestartet sein");
  },
);

test(
  "K1b-B1b: der Abbruch gibt das Passwort aus DATABASE_URL nicht aus",
  { timeout: ZEITGRENZE_MS },
  async () => {
    const { code, output } = await startServerExpectExit({
      env: { QUEUE_BACKEND: "pgboss", DATABASE_URL: UNERREICHBAR },
      timeoutMs: START_FRIST_MS,
    });
    assert.equal(code, EXIT_ABBRUCH, `erwartet exit 1, Output:\n${output}`);
    assert.ok(output.includes(ABBRUCH_MELDUNG), `Abbruchmeldung fehlt, Output:\n${output}`);
    assert.ok(!output.includes(GEHEIMNIS), "Passwort darf nicht im Log stehen");
  },
);

test(
  "K1b-M: memory startet ohne Datenbank, kein Verbindungsversuch, /healthz 200",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    const srv = await startServer({ env: { QUEUE_BACKEND: "memory", DATABASE_URL: UNERREICHBAR } });
    t.after(() => srv.stop());
    assert.equal(await healthzStatus(srv), HTTP_OK);
    assert.ok(!srv.stdout.includes(ABBRUCH_MELDUNG));
  },
);
