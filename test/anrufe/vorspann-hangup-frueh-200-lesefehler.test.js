import assert from "node:assert/strict";
import test from "node:test";

import pg from "pg";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { OWNER_TEST_FIRST_NAME, OWNER_TEST_LAST_NAME, makeTelnyxSigner, nowSeconds } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { starteAnAnbieter, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { WEBHOOK_ZUSTELLUNG_SECRET } from "./zwei-instanzen-postgres.js";
import { starteDatenbankRelais } from "./datenbank-relais.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const AUDIO = Buffer.alloc(200_000, 0xab);
const CALLEE_BEIN = "cc_callee_frueh200";
const EL_BEIN = "cc_el_frueh200";
const ZIEL = "+4915112399014";
const ZUSTAND_FEHLT = "rueckfall grund=zustand_fehlt";
const LESEFEHLER_LOG = "[el-vorspann] ereignis fehlgeschlagen call=";
const VERSUCHE_INSGESAMT = 4;
const NACHLAUF_MS = 4_000;
const GEBUCHT_SQL = "SELECT status, billed_at AS gebucht FROM call WHERE id = $1";
const REGISTRIERUNG = "phnum_pg_seed";
const TABELLE_WEG = "ALTER TABLE vorspann_zustand RENAME TO vorspann_zustand_weg";
const TABELLE_DA = "ALTER TABLE vorspann_zustand_weg RENAME TO vorspann_zustand";

const beinFuer = (roh) => (roh.includes('-el"') ? EL_BEIN : CALLEE_BEIN);

function starteAnbieter() {
  const aufrufe = { auflegen: [] };
  const anfrageVon = (anfrage) =>
    new Promise((fertig) => {
      const teile = [];
      anfrage.on("data", (stueck) => teile.push(stueck));
      anfrage.on("end", () => fertig(Buffer.concat(teile).toString()));
    });
  const server = starteAttrappe(async (anfrage, antwort) => {
    const roh = await anfrageVon(anfrage);
    if (anfrage.url.startsWith("/v1/text-to-speech/")) {
      antwort.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
      return antwort.end(AUDIO);
    }
    if (anfrage.url.endsWith("/actions/hangup")) aufrufe.auflegen.push(anfrage.url);
    antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
    antwort.end(JSON.stringify({ data: { sid: "v3:frueh200", result: "ok", call_control_id: beinFuer(roh) } }));
  });
  return server.then((attrappe) => ({ attrappe, aufrufe }));
}

function ereignis(signer, srv, { callId, art: eventType }) {
  const rumpf = JSON.stringify({
    data: { id: `evt-${eventType}-${callId}`, event_type: eventType, payload: { call_control_id: CALLEE_BEIN, status: "ok" } },
  });
  const zeitstempel = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf), "telnyx-timestamp": zeitstempel },
    body: rumpf,
  });
}

const platziere = (srv) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: ZIEL, objective: "Termin am Donnerstag vereinbaren" }),
  });

async function mitAnbieter(t, lauf) {
  const signer = makeTelnyxSigner();
  const { attrappe, aufrufe } = await starteAnbieter();
  t.after(() => attrappe.close());
  const env = {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    WEBHOOK_ZUSTELLUNG_SECRET,
    ELEVENLABS_API_BASE: attrappe.url,
    TELNYX_API_BASE: attrappe.url,
  };
  const db = await echteDatenbankMitRolle(t);
  const adresse = new URL(process.env[POSTGRES_VARIABLE]);
  adresse.pathname = new URL(db.adresse).pathname;
  const verwaltung = new pg.Client({ connectionString: adresse.href });
  await verwaltung.connect();
  const relais = await starteDatenbankRelais(db.adresse);
  const anbieter = await starteAnrufstartAttrappe();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  const starte = () => starteAnAnbieter({ ...db, adresse: relais.adresse }, anbieter, env);
  let a = await starte();
  try {
    await a.stop();
    await sql("UPDATE tenant SET owner_name = $2, first_name = $3 WHERE id = $1", [
      BOOTSTRAP_TENANT_ID,
      `${OWNER_TEST_FIRST_NAME} ${OWNER_TEST_LAST_NAME}`,
      OWNER_TEST_FIRST_NAME,
    ]);
    await sql("UPDATE number SET provider_agent_phone_number_id = $2 WHERE tenant_id = $1", [BOOTSTRAP_TENANT_ID, REGISTRIERUNG]);
    a = await starte();
    const neustart = async () => {
      await a.stop();
      a = await starte();
      return a;
    };
    await lauf({ a, neustart, sql, signer, aufrufe, relais });
  } finally {
    relais.fortsetzen();
    await a.stop();
    await relais.schliessen();
    await anbieter.schliessen();
    await verwaltung.end();
  }
}

const callIdVon = async (sql) => {
  const { rows } = await sql("SELECT id FROM call WHERE to_e164 = $1", [ZIEL]);
  assert.equal(rows.length, 1);
  return rows[0].id;
};

const zaehle = (text, marke) => text.split(marke).length - 1;

const nochEinVersuch = (srv, anzahl = VERSUCHE_INSGESAMT + 1) =>
  zeilenBis(async () => [srv.stdout], ([ausgabe]) => zaehle(ausgabe, LESEFEHLER_LOG) >= anzahl, NACHLAUF_MS);

async function fruehes200MitLesefehler({ srv, sql, relais, signer, callId, art }) {
  relais.anhalten();
  const antwort = await ereignis(signer, srv, { callId, art });
  assert.equal(antwort.status, HTTP_OK);
  await sql(TABELLE_WEG);
  relais.fortsetzen();
}

test("Ist der Zustand nach dem frühen 200 beim Auflegen kurz nicht lesbar, wird der Anruf trotzdem beendet", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, async ({ a, neustart, sql, signer, relais }) => {
    assert.equal((await platziere(a)).status, HTTP_OK);
    const callId = await callIdVon(sql);
    const frisch = await neustart();
    await fruehes200MitLesefehler({ srv: frisch, sql, relais, signer, callId, art: "call.hangup" });
    await zeilenBis(async () => [frisch.stdout], ([ausgabe]) => ausgabe.includes(LESEFEHLER_LOG));
    await sql(TABELLE_DA);
    await zeilenBis(async () => (await sql(GEBUCHT_SQL, [callId])).rows, (zeilen) => zeilen[0].status !== "active" && zeilen[0].gebucht);
    assert.equal((await sql(GEBUCHT_SQL, [callId])).rows[0].status, "failed");
    assert.equal(zaehle(frisch.stdout, ZUSTAND_FEHLT), 0);
  });
});

test("Bleibt der Zustand nach dem frühen 200 beim Auflegen unlesbar, bleibt der Anruf aktiv und die Versuche sind begrenzt", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, async ({ a, neustart, sql, signer, aufrufe, relais }) => {
    assert.equal((await platziere(a)).status, HTTP_OK);
    const callId = await callIdVon(sql);
    const frisch = await neustart();
    await fruehes200MitLesefehler({ srv: frisch, sql, relais, signer, callId, art: "call.hangup" });
    await zeilenBis(async () => [frisch.stdout], ([ausgabe]) => zaehle(ausgabe, LESEFEHLER_LOG) >= VERSUCHE_INSGESAMT);
    await assert.rejects(nochEinVersuch(frisch), /nicht erreicht/);
    assert.equal(zaehle(frisch.stdout, LESEFEHLER_LOG), VERSUCHE_INSGESAMT);
    assert.equal((await sql(GEBUCHT_SQL, [callId])).rows[0].status, "active");
    assert.equal(zaehle(frisch.stdout, ZUSTAND_FEHLT), 0);
    assert.deepEqual(aufrufe.auflegen, []);
  });
});

test("Andere Ereignisse als Auflegen werden nach dem frühen 200 nicht wiederholt", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, async ({ a, neustart, sql, signer, relais }) => {
    assert.equal((await platziere(a)).status, HTTP_OK);
    const callId = await callIdVon(sql);
    const frisch = await neustart();
    await fruehes200MitLesefehler({ srv: frisch, sql, relais, signer, callId, art: "call.answered" });
    await zeilenBis(async () => [frisch.stdout], ([ausgabe]) => ausgabe.includes(LESEFEHLER_LOG));
    await assert.rejects(nochEinVersuch(frisch, 2), /nicht erreicht/);
    assert.equal(zaehle(frisch.stdout, LESEFEHLER_LOG), 1);
    assert.equal((await sql(GEBUCHT_SQL, [callId])).rows[0].status, "active");
  });
});
