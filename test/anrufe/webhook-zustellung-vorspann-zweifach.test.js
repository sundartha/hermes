import assert from "node:assert/strict";
import { test } from "node:test";

import pg from "pg";

import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { TELNYX_GAP10_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { nowSeconds } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { makeTelnyxSigner, startServer } from "../helpers.js";
import { starteDatenbankRelais } from "./datenbank-relais.js";
import { postgresVorhanden } from "./hermes-mit-postgres.js";
import { WEBHOOK_ZUSTELLUNG_SECRET, mitDatenbankVorDemStart, zeilenBis } from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const ANRUF = "call_vorsp1";
const ANRUF_HAENGT = "call_vorsp2";
const ANRUF_ZWEI = "call_vorsp3";
const ZWEI_ANRUFE = 2;
const CALLEE_BEIN = "cc_callee_vorsp";
const EL_BEIN = "cc_el_vorsp";
const EINMAL = 1;
const RUHEZEIT_MS = 3_000;
const ANTWORT_FRIST_MS = 3_000;
const SEGMENT_SQL =
  "INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1, $2, $3, $4, now()::text)";
const BRUECKE_SQL =
  "UPDATE call SET call_control_id = $2, el_call_control_id = $3, bridged_at = now() WHERE id = $1";
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, answered_at, max_duration_s, provider)
  VALUES ($1, $2, $3, 'outbound', 'active', (SELECT e164 FROM number WHERE tenant_id = $2),
  '+4915112345678', 'Testziel', now()::text, now()::text, 600, 'telnyx')`;
const STATUS_SQL = "SELECT status FROM call WHERE id = $1";
const WIEDERHOLT_LOG = /\[webhook-idempotenz\] wiederholte_zustellung weg=vorspann art=antwort_wiederholt/;
const OHNE_ERKENNUNG = "[webhook-idempotenz] wiederholte_zustellung weg=vorspann art=ohne_erkennung grund=frist";

function verwaltungsAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

function signiertesAuflegen(signer, callId) {
  const rumpf = JSON.stringify({
    data: { id: `evt-${callId}`, event_type: "call.hangup", payload: { call_control_id: CALLEE_BEIN } },
  });
  const zeitstempel = String(nowSeconds());
  return {
    pfad: `/voice/vorspann?callId=${callId}`,
    optionen: {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf),
        "telnyx-timestamp": zeitstempel,
      },
      body: rumpf,
    },
  };
}

const senden = async (instanz, zustellung) =>
  (await abrufMitFrist(`${instanz.localUrl}${zustellung.pfad}`, zustellung.optionen)).status;

function starteTelnyxAttrappe(auflegen) {
  return starteAttrappe((anfrage, antwort) => {
    anfrage.resume();
    anfrage.on("end", () => {
      if (anfrage.url.endsWith("/actions/hangup")) auflegen.push(anfrage.url);
      antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
      antwort.end(JSON.stringify({ data: { result: "ok" } }));
    });
  });
}

async function gebrueckterAnruf(sql, callId) {
  await sql(SEGMENT_SQL, [callId, BOOTSTRAP_TENANT_ID, "caller", "Ich moechte einen Termin"]);
  await sql(SEGMENT_SQL, [callId, BOOTSTRAP_TENANT_ID, "agent", "Gern, wann passt es Ihnen?"]);
  await sql(BRUECKE_SQL, [callId, CALLEE_BEIN, EL_BEIN]);
}

test("Auflegen des Vorspann-Anrufs gleichzeitig an zwei Instanzen: genau eine Zusammenfassung und ein Auflegen des EL-Beins", async (t) => {
  const auflegen = [];
  const telnyx = await starteTelnyxAttrappe(auflegen);
  t.after(() => telnyx.close());
  const env = {
    TELNYX_API_BASE: telnyx.url,
    TELNYX_API_KEY: TELNYX_GAP10_SCHLUESSEL,
    WEBHOOK_ZUSTELLUNG_SECRET,
  };
  await mitDatenbankVorDemStart(t, { anrufe: [ANRUF], env }, async ({ sql, signer, modell, starte }) => {
    await gebrueckterAnruf(sql, ANRUF);
    const [a, b] = [await starte(), await starte()];
    const vorher = modell.count();
    const zustellung = signiertesAuflegen(signer, ANRUF);
    const [vonA, vonB] = await Promise.all([senden(a, zustellung), senden(b, zustellung)]);
    assert.equal(vonA, HTTP_OK);
    assert.equal(vonB, HTTP_OK);
    await zeilenBis(async () => modell.count() - vorher, (anzahl) => anzahl >= EINMAL);
    await echtWarten(RUHEZEIT_MS);
    assert.equal(modell.count() - vorher, EINMAL);
    assert.equal(auflegen.filter((pfad) => pfad.includes(EL_BEIN)).length, EINMAL);
    assert.match(a.stdout + b.stdout, WIEDERHOLT_LOG);
  });
});

async function mitHaengenderAblage(t, lauf) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const db = await echteDatenbankMitRolle(t);
  const relais = await starteDatenbankRelais(db.adresse);
  const verwaltung = new pg.Client({ connectionString: verwaltungsAdresse(db.adresse) });
  await verwaltung.connect();
  const signer = makeTelnyxSigner();
  const umgebung = pgStartUmgebung(relais.adresse, {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    WEBHOOK_ZUSTELLUNG_SECRET,
  });
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  let instanz = null;
  try {
    await (await startServer({ env: umgebung })).stop();
    await sql(ANRUF_SQL, [ANRUF_HAENGT, BOOTSTRAP_TENANT_ID, `tok_${ANRUF_HAENGT}`]);
    await gebrueckterAnruf(sql, ANRUF_HAENGT);
    instanz = await startServer({ env: umgebung });
    return await lauf({ a: instanz, sql, signer, relais });
  } finally {
    relais.fortsetzen();
    await instanz?.stop();
    await relais.schliessen();
    await verwaltung.end();
  }
}

test("Vorspann-Zustellung bei hängender Ablage: die Instanz verarbeitet sie trotzdem und antwortet rechtzeitig", async (t) => {
  await mitHaengenderAblage(t, async ({ a, sql, signer, relais }) => {
    relais.anhalten();
    const beginn = Date.now();
    const status = await senden(a, signiertesAuflegen(signer, ANRUF_HAENGT));
    assert.equal(status, HTTP_OK);
    assert.ok(Date.now() - beginn <= ANTWORT_FRIST_MS);
    assert.ok(a.stdout.includes(OHNE_ERKENNUNG), a.stdout);
    relais.fortsetzen();
    const stand = await zeilenBis(
      async () => (await sql(STATUS_SQL, [ANRUF_HAENGT])).rows[0].status,
      (zustand) => zustand === "completed",
    );
    assert.equal(stand, "completed");
  });
});

test("Gleicher Körper zur selben Zeit für zwei verschiedene Anrufe: beide werden verarbeitet", async (t) => {
  const telnyx = await starteTelnyxAttrappe([]);
  t.after(() => telnyx.close());
  const env = { TELNYX_API_BASE: telnyx.url, TELNYX_API_KEY: TELNYX_GAP10_SCHLUESSEL, WEBHOOK_ZUSTELLUNG_SECRET };
  await mitDatenbankVorDemStart(t, { anrufe: [ANRUF, ANRUF_ZWEI], env }, async ({ sql, signer, modell, starte }) => {
    await gebrueckterAnruf(sql, ANRUF);
    await gebrueckterAnruf(sql, ANRUF_ZWEI);
    const a = await starte();
    const vorher = modell.count();
    const erste = signiertesAuflegen(signer, ANRUF);
    const zweite = { ...erste, pfad: `/voice/vorspann?callId=${ANRUF_ZWEI}` };
    assert.equal(await senden(a, erste), HTTP_OK);
    assert.equal(await senden(a, zweite), HTTP_OK);
    await zeilenBis(async () => modell.count() - vorher, (anzahl) => anzahl >= ZWEI_ANRUFE);
    assert.equal(modell.count() - vorher, ZWEI_ANRUFE);
  });
});
