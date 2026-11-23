import assert from "node:assert/strict";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makeTelnyxSigner, nowSeconds } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { mitZweiHermesAufPostgres, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const HTTP_SERVERFEHLER = 500;
const AUDIO = Buffer.alloc(200_000, 0xab);
const CALLEE_BEIN = "cc_callee_andere";
const EL_BEIN = "cc_el_andere";
const ZIEL = "+4915112399003";
const ZWEITES_ZIEL = "+4915112399004";
const ZUSTAND_FEHLT = "rueckfall grund=zustand_fehlt";
const STATUS_SQL = "SELECT status, failure_reason FROM call WHERE id = $1";
const ZEILE_SQL = "SELECT callee_id, abgehoben, stand FROM vorspann_zustand WHERE call_id = $1";

const beinFuer = (roh) => (roh.includes('-el"') ? EL_BEIN : CALLEE_BEIN);

function starteAnbieter(verhalten) {
  const aufrufe = { wiedergaben: [], auflegen: [] };
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
    if (anfrage.url.endsWith("/actions/playback_start")) aufrufe.wiedergaben.push(JSON.parse(roh));
    if (anfrage.url.endsWith("/actions/hangup")) aufrufe.auflegen.push(anfrage.url);
    if (anfrage.url.endsWith("/actions/hangup") && verhalten.auflegenScheitert) {
      antwort.writeHead(HTTP_SERVERFEHLER, { "content-type": "application/json" });
      return antwort.end("{}");
    }
    if (anfrage.url === "/v2/calls") await verhalten.beiWahl?.();
    antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
    antwort.end(JSON.stringify({ data: { sid: "v3:andere", result: "ok", call_control_id: beinFuer(roh) } }));
  });
  return server.then((attrappe) => ({ attrappe, aufrufe }));
}

function ereignis(signer, srv, { callId, art: eventType, kennung = "" }) {
  const rumpf = JSON.stringify({
    data: { id: `evt-${eventType}-${callId}-${kennung}`, event_type: eventType, payload: { call_control_id: CALLEE_BEIN, status: "ok" } },
  });
  const zeitstempel = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf), "telnyx-timestamp": zeitstempel },
    body: rumpf,
  });
}

const platziere = (srv, ziel = ZIEL) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: ziel, objective: "Termin am Donnerstag vereinbaren" }),
  });

async function mitAnbieter(t, verhalten, lauf) {
  const signer = makeTelnyxSigner();
  const { attrappe, aufrufe } = await starteAnbieter(verhalten);
  t.after(() => attrappe.close());
  const env = {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    ELEVENLABS_API_BASE: attrappe.url,
    TELNYX_API_BASE: attrappe.url,
    ...verhalten.umgebung,
  };
  await mitZweiHermesAufPostgres(t, { env }, (instanzen) => lauf({ ...instanzen, signer, aufrufe }));
}

const callIdVon = async (sql, ziel = ZIEL) => {
  const { rows } = await sql("SELECT id FROM call WHERE to_e164 = $1", [ziel]);
  assert.equal(rows.length, 1);
  return rows[0].id;
};

const zaehleMarke = (instanzen, marke) => instanzen.reduce((summe, srv) => summe + srv.stdout.split(marke).length - 1, 0);

test("Landet das Abheben auf Instanz B, obwohl A den Anruf aufgebaut hat, spielt B den Vorspann ab und der Anruf bleibt aktiv", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, {}, async ({ a, b, sql, signer, aufrufe }) => {
    assert.equal((await platziere(a)).status, HTTP_OK);
    const callId = await callIdVon(sql);
    assert.equal((await ereignis(signer, b, { callId, art: "call.answered" })).status, HTTP_OK);
    const [wiedergabe] = await zeilenBis(async () => aufrufe.wiedergaben, (liste) => liste.length >= 1);
    const { rows } = await sql("SELECT token FROM vorspann_zustand WHERE call_id = $1", [callId]);
    assert.match(wiedergabe.audio_url, new RegExp(`^https://instanz-\\d+\\.agent\\.test/voice/tts/${rows[0].token}$`));
    assert.deepEqual((await sql(STATUS_SQL, [callId])).rows, [{ status: "active", failure_reason: null }]);
    assert.equal(zaehleMarke([a, b], ZUSTAND_FEHLT), 0);
    assert.deepEqual(aufrufe.auflegen, []);
  });
});

test("Trifft dasselbe Abheben gleichzeitig auf beiden Instanzen ein, startet die Wiedergabe genau einmal", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, {}, async ({ a, b, sql, signer, aufrufe }) => {
    assert.equal((await platziere(a)).status, HTTP_OK);
    const callId = await callIdVon(sql);
    const antworten = await Promise.all([
      ereignis(signer, a, { callId, art: "call.answered", kennung: "a" }),
      ereignis(signer, b, { callId, art: "call.answered", kennung: "b" }),
    ]);
    assert.deepEqual(antworten.map((antwort) => antwort.status), [HTTP_OK, HTTP_OK]);
    await zeilenBis(async () => zaehleMarke([a, b], "playback_start"), (anzahl) => anzahl >= 1);
    assert.equal(aufrufe.wiedergaben.length, 1);
    assert.equal(zaehleMarke([a, b], "playback_start"), 1);
    assert.equal((await sql(ZEILE_SQL, [callId])).rows[0].abgehoben, true);
  });
});

test("Das Abheben vor dem Eintragen der Bein-Kennung geht nicht verloren und ist kein fehlender Zustand", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  let wahlFreigeben;
  const wahlFrei = new Promise((fertig) => (wahlFreigeben = fertig));
  const beiWahl = () => wahlFrei;
  t.after(() => wahlFreigeben());
  await mitAnbieter(t, { beiWahl }, async ({ a, b, sql, signer, aufrufe }) => {
    const start = platziere(a);
    const { rows } = await zeilenBis(
      () => sql("SELECT call_id, callee_id FROM vorspann_zustand"),
      (ergebnis) => ergebnis.rowCount === 1,
    ).then((rowsErgebnis) => ({ rows: rowsErgebnis.rows }));
    assert.equal(rows[0].callee_id, null);
    assert.equal((await ereignis(signer, b, { callId: rows[0].call_id, art: "call.answered" })).status, HTTP_OK);
    await zeilenBis(async () => aufrufe.wiedergaben, (liste) => liste.length === 1);
    wahlFreigeben();
    assert.equal((await start).status, HTTP_OK);
    const { rows: danach } = await sql(ZEILE_SQL, [rows[0].call_id]);
    assert.equal(danach[0].callee_id, CALLEE_BEIN);
    assert.equal(zaehleMarke([a, b], ZUSTAND_FEHLT), 0);
    assert.deepEqual(aufrufe.auflegen, []);
  });
});

const ZEILE_ABBRUCH_SQL = "SELECT stand, aufgelegt FROM vorspann_zustand WHERE call_id = $1";

async function brichAufBAb(srv, { art }) {
  assert.equal((await platziere(srv.a)).status, HTTP_OK);
  const id = await callIdVon(srv.sql);
  assert.equal((await ereignis(srv.signer, srv.b, { callId: id, art: "call.answered" })).status, HTTP_OK);
  await zeilenBis(async () => srv.aufrufe.wiedergaben, (liste) => liste.length >= 1);
  assert.equal((await ereignis(srv.signer, srv.b, { callId: id, art })).status, HTTP_OK);
  return id;
}

test("Bricht B den Vorspann ab, steht der Abbruch samt aufgelegtem Bein in der Zeile und A sieht ihn", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, {}, async (srv) => {
    const callId = await brichAufBAb(srv, { art: "call.playback.ended" });
    const [zeile] = await zeilenBis(
      async () => (await srv.sql(ZEILE_ABBRUCH_SQL, [callId])).rows,
      (zeilen) => zeilen[0]?.aufgelegt.length >= 1,
    );
    assert.deepEqual(Object.keys(zeile.stand).sort(), ["ABGEBROCHEN", "ABGEHOBEN"]);
    assert.ok(zeile.aufgelegt.includes(CALLEE_BEIN));
    assert.equal(srv.aufrufe.auflegen.length >= 1, true);
  });
});

test("Gelingt das Auflegen eines Beins nicht, bleibt es in der Zeile als nicht aufgelegt", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, { auflegenScheitert: true }, async (srv) => {
    const callId = await brichAufBAb(srv, { art: "call.playback.ended" });
    await zeilenBis(async () => srv.aufrufe.auflegen, (liste) => liste.length >= 1);
    const [zeile] = await zeilenBis(
      async () => (await srv.sql(ZEILE_ABBRUCH_SQL, [callId])).rows,
      (zeilen) => zeilen[0]?.aufgelegt.length === 0 && "ABGEBROCHEN" in zeilen[0].stand,
    );
    assert.deepEqual(zeile.aufgelegt, []);
  });
});

test("Ist die Zeile beim Ablauf der Wiedergabefrist verschwunden, wirft die Frist nichts und tut nichts", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, { umgebung: { VORSPANN_WIEDERGABE_FRIST_MS: "1500", FRISTEN_TAKT_MS: "200" } }, async ({ a, sql, signer, aufrufe }) => {
    assert.equal((await platziere(a)).status, HTTP_OK);
    const erster = await callIdVon(sql);
    assert.equal((await ereignis(signer, a, { callId: erster, art: "call.answered" })).status, HTTP_OK);
    await zeilenBis(async () => aufrufe.wiedergaben, (liste) => liste.length >= 1);
    await sql("DELETE FROM vorspann_zustand WHERE call_id = $1", [erster]);
    assert.equal((await platziere(a, ZWEITES_ZIEL)).status, HTTP_OK);
    const zweiter = await callIdVon(sql, ZWEITES_ZIEL);
    assert.equal((await ereignis(signer, a, { callId: zweiter, art: "call.answered" })).status, HTTP_OK);
    await zeilenBis(async () => a.stdout, (text) => text.includes(`rueckfall grund=vorspann_nicht_abgespielt call=${zweiter}`));
    assert.equal(a.stdout.includes("[guard] unhandledRejection"), false);
    assert.equal((await sql(STATUS_SQL, [erster])).rows[0].status, "active");
  });
});

const FRIST_KURZ_MS = "1500";
const FRIST_LANG_MS = "600000";
const FRISTEN_TAKT_KURZ_MS = "200";
const FRISTEN_SQL = `SELECT (EXTRACT(EPOCH FROM (frist_el_bein_at - frist_wiedergabe_at)) * 1000)::int AS abstand_ms,
  frist_wiedergabe_at > now() + interval '590 seconds' AS wiedergabe_weit,
  frist_wiedergabe_at < now() + interval '610 seconds' AS wiedergabe_nah
  FROM vorspann_zustand WHERE call_id = $1`;

const meldeMitStatus = (signer, srv, { callId, art }) => {
  const rumpf = JSON.stringify({ data: { id: `evt-4b-${art}-${callId}`, event_type: art, payload: { call_control_id: CALLEE_BEIN, status: "completed" } } });
  const zeitstempel = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf), "telnyx-timestamp": zeitstempel },
    body: rumpf,
  });
};

async function beendeInstanz(srv) {
  const beendet = new Promise((fertig) => srv.child.once("exit", fertig));
  srv.child.kill("SIGTERM");
  await beendet;
}

const fristUmgebung = (wiedergabeMs, elMs) => ({ VORSPANN_WIEDERGABE_FRIST_MS: wiedergabeMs, EL_BRIDGE_START_DEADLINE_MS: elMs, FRISTEN_TAKT_MS: FRISTEN_TAKT_KURZ_MS });

async function hebeAufAAb({ a, sql, signer, aufrufe }) {
  assert.equal((await platziere(a)).status, HTTP_OK);
  const callId = await callIdVon(sql);
  assert.equal((await ereignis(signer, a, { callId, art: "call.answered" })).status, HTTP_OK);
  await zeilenBis(async () => aufrufe.wiedergaben, (liste) => liste.length === 1);
  await zeilenBis(async () => (await sql("SELECT el_call_control_id FROM call WHERE id = $1", [callId])).rows, (zeilen) => zeilen[0]?.el_call_control_id === EL_BEIN);
  return callId;
}

const beideBeineAufgelegt = (aufrufe) => aufrufe.auflegen.some((url) => url.includes(CALLEE_BEIN)) && aufrufe.auflegen.some((url) => url.includes(EL_BEIN));

test("5928-4b K7: kommt nach dem Abheben auf A kein Wiedergabe-Ende und ist A beendet, legt B beide Beine auf und vermerkt vorspann_nicht_abgespielt", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, { umgebung: fristUmgebung(FRIST_KURZ_MS, FRIST_LANG_MS) }, async (srv) => {
    const callId = await hebeAufAAb(srv);
    await beendeInstanz(srv.a);
    await zeilenBis(async () => srv.aufrufe, beideBeineAufgelegt);
    const [anruf] = await zeilenBis(async () => (await srv.sql(STATUS_SQL, [callId])).rows, (zeilen) => zeilen[0]?.failure_reason === "vorspann_nicht_abgespielt");
    assert.equal(anruf.failure_reason, "vorspann_nicht_abgespielt");
    assert.equal(srv.aufrufe.auflegen.length, 2);
    assert.equal(zaehleMarke([srv.b], "rueckfall grund=vorspann_nicht_abgespielt"), 1);
    assert.equal(zaehleMarke([srv.a, srv.b], ZUSTAND_FEHLT), 0);
  });
});

test("5928-4b K7: kommt nach dem Wiedergabe-Ende auf B kein EL-Bein und ist A beendet, legt B beide Beine auf und vermerkt el_frist", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, { umgebung: fristUmgebung(FRIST_LANG_MS, FRIST_KURZ_MS) }, async (srv) => {
    const callId = await hebeAufAAb(srv);
    assert.equal((await meldeMitStatus(srv.signer, srv.b, { callId, art: "call.playback.ended" })).status, HTTP_OK);
    await beendeInstanz(srv.a);
    await zeilenBis(async () => srv.aufrufe, beideBeineAufgelegt);
    const [anruf] = await zeilenBis(async () => (await srv.sql(STATUS_SQL, [callId])).rows, (zeilen) => zeilen[0]?.failure_reason === "el_frist");
    assert.equal(anruf.failure_reason, "el_frist");
    assert.equal(zaehleMarke([srv.b], "rueckfall grund=el_frist"), 1);
    assert.equal(zaehleMarke([srv.a, srv.b], ZUSTAND_FEHLT), 0);
  });
});

test("5928-4b K7: nach dem Abheben stehen Wiedergabe- und EL-Bein-Frist in der Zeile, je mit ihrer eigenen Dauer ab jetzt", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, { umgebung: fristUmgebung(FRIST_LANG_MS, "700000") }, async (srv) => {
    const callId = await hebeAufAAb(srv);
    const { rows } = await srv.sql(FRISTEN_SQL, [callId]);
    assert.deepEqual(rows, [{ abstand_ms: 100000, wiedergabe_weit: true, wiedergabe_nah: true }]);
  });
});

test("5928-4b K7: scheitert das Schreiben der Fristen, steht der Fehler im Log, das Bein wird aufgelegt und der Satz nicht gestartet", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, { umgebung: fristUmgebung(FRIST_LANG_MS, FRIST_LANG_MS) }, async (srv) => {
    await srv.sql("ALTER TABLE vorspann_zustand DROP COLUMN frist_el_bein_at");
    assert.equal((await platziere(srv.a)).status, HTTP_OK);
    const callId = await callIdVon(srv.sql);
    assert.equal((await ereignis(srv.signer, srv.a, { callId, art: "call.answered" })).status, HTTP_OK);
    const ausgabeA = () => srv.a.stdout;
    await zeilenBis(async () => ausgabeA(), (text) => text.includes(`[el-vorspann] frist fehlgeschlagen call=${callId}:`));
    await zeilenBis(async () => srv.aufrufe.auflegen, (liste) => liste.length === 1);
    assert.deepEqual(srv.aufrufe.wiedergaben, []);
    const [aufgelegt] = srv.aufrufe.auflegen;
    assert.ok(aufgelegt.includes(CALLEE_BEIN));
  });
});
