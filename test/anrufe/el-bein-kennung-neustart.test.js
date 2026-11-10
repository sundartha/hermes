import { test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

import { startServer, waitUntil as wartebis } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { echtWarten } from "../echt-warten.js";
import { zeilenBis } from "./hermes-mit-postgres.js";
import { calleeVon, elVon, hebeAb, legeAnruf, makeTelnyxSigner, neueAnrufNummer, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const HTTP_OK = 200;
const WARTE_FRIST_MS = 5_000;
const ANRUF_NUMMER = 0;
const ZWEI_BEINE = 2;
const EIGENER_NAME = "Jonas Beispiel";
const EIGENER_VORNAME = "Jonas";
const KENNUNG = "3553pg";
const PUBLIC_URL = "https://agent.test";
const REGISTRIERUNG = "phnum_pg_3553";
const EL_SPALTE_SQL = "SELECT el_call_control_id FROM call WHERE id = $1";

const waitUntil = (bedingung) => wartebis(bedingung, { timeoutMs: WARTE_FRIST_MS });
const SPEICHER_RUHE_MS = 300;
const ABGEHOBEN_SQL = "SELECT id FROM call WHERE answered_at IS NOT NULL";

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

async function mitHermesAufPostgres(t, lauf) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return;
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  const nachAbgehobenGespeichert = async () => {
    await zeilenBis(async () => (await sql(ABGEHOBEN_SQL)).rows, (zeilen) => zeilen.length > 0);
    await echtWarten(SPEICHER_RUHE_MS);
  };
  const attrappe = await starteAttrappe(nachAbgehobenGespeichert);
  const signer = makeTelnyxSigner();
  const env = pgStartUmgebung(db.adresse, vorspannUmgebung({ attrappe, signer, publicUrl: PUBLIC_URL, kennung: KENNUNG }));
  const gestartet = [];
  const starte = async () => {
    const instanz = await startServer({ env });
    gestartet.push(instanz);
    return instanz;
  };
  try {
    await (await starte()).stop();
    await verwaltung.query("UPDATE tenant SET owner_name = $2, first_name = $3 WHERE id = $1", [BOOTSTRAP_TENANT_ID, EIGENER_NAME, EIGENER_VORNAME]);
    await verwaltung.query("UPDATE number SET provider_agent_phone_number_id = $2 WHERE tenant_id = $1", [BOOTSTRAP_TENANT_ID, REGISTRIERUNG]);
    await lauf({ starte, attrappe, signer, sql });
  } finally {
    await Promise.all(gestartet.map((instanz) => instanz.stop().catch(() => {})));
    await attrappe.close();
    await verwaltung.end();
  }
}

test("3553-K2: auf Postgres kennt Hermes nach dem Abheben und einem Neustart das EL-Bein und legt beim Abbrechen beide Beine auf", async (t) => {
  await mitHermesAufPostgres(t, async ({ starte, attrappe, signer, sql }) => {
    const erste = await starte();
    const callId = await legeAnruf(erste, neueAnrufNummer(ANRUF_NUMMER));
    assert.ok(callId);
    assert.equal((await hebeAb(erste, signer, callId)).status, HTTP_OK);
    await zeilenBis(async () => (await sql(EL_SPALTE_SQL, [callId])).rows, (zeilen) => zeilen[0]?.el_call_control_id === elVon(callId));
    await erste.stop();
    const zweite = await starte();
    const vorher = attrappe.pfade.length;
    const beendet = await abrufMitFrist(`${zweite.localUrl}/api/calls/${callId}/cancel`, { method: "POST" });
    assert.equal(beendet.status, HTTP_OK);
    const neuePfade = () => attrappe.pfade.slice(vorher);
    const aufgelegt = () => neuePfade().filter((pfad) => pfad.endsWith("/actions/hangup")).sort();
    await waitUntil(() => aufgelegt().length >= ZWEI_BEINE);
    assert.deepEqual(aufgelegt(), [`/v2/calls/${calleeVon(callId)}/actions/hangup`, `/v2/calls/${elVon(callId)}/actions/hangup`]);
  });
});
