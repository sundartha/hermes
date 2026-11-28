import assert from "node:assert/strict";
import { test } from "node:test";

import { vorspannZustand } from "../../src/store.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { makeTelnyxSigner, nowSeconds } from "../helpers.js";
import { starteAttrappe } from "./attrappen-server.js";
import { mitZweiHermesAufPostgres, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const HTTP_SERVERFEHLER = 500;
const TTL_MS = 120_000;
const AUDIO = Buffer.alloc(200_000, 0xab);
const CALLEE = "cc_callee_einzel";
const EL = "cc_el_einzel";
const ZIEL = "+4915112399005";
const ZEILE_SQL = "SELECT aufgelegt FROM vorspann_zustand WHERE call_id = $1";
const WARTENDE_SQL = "SELECT count(*)::int AS anzahl FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid()";
const SPERRTRIGGER_SQL = `CREATE FUNCTION aufgelegt_gesperrt() RETURNS trigger AS $$ BEGIN
  IF NEW.aufgelegt IS DISTINCT FROM OLD.aufgelegt THEN RAISE EXCEPTION 'aufgelegt gesperrt'; END IF;
  RETURN NEW; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER aufgelegt_gesperrt BEFORE UPDATE ON vorspann_zustand FOR EACH ROW EXECUTE FUNCTION aufgelegt_gesperrt()`;

const PROTOKOLL_SQL = `CREATE TABLE aufgelegt_protokoll (nr serial PRIMARY KEY, alt jsonb, neu jsonb);
  GRANT ALL ON aufgelegt_protokoll TO PUBLIC; GRANT ALL ON SEQUENCE aufgelegt_protokoll_nr_seq TO PUBLIC;
  CREATE FUNCTION aufgelegt_protokollieren() RETURNS trigger AS $$ BEGIN
  IF NEW.aufgelegt IS DISTINCT FROM OLD.aufgelegt THEN INSERT INTO aufgelegt_protokoll (alt, neu) VALUES (OLD.aufgelegt, NEW.aufgelegt); END IF;
  RETURN NEW; END $$ LANGUAGE plpgsql;
  CREATE TRIGGER aufgelegt_protokollieren AFTER UPDATE ON vorspann_zustand FOR EACH ROW EXECUTE FUNCTION aufgelegt_protokollieren()`;
const PROTOKOLL_LESEN_SQL = "SELECT alt, neu FROM aufgelegt_protokoll ORDER BY nr";

const beinFuer = (roh) => (roh.includes('-el"') ? EL : CALLEE);

function starteAnbieter({ elAuflegen }) {
  const aufrufe = { wiedergaben: [], auflegen: [] };
  const server = starteAttrappe(async (anfrage, antwort) => {
    const teile = [];
    for await (const stueck of anfrage) teile.push(stueck);
    const roh = Buffer.concat(teile).toString();
    if (anfrage.url.startsWith("/v1/text-to-speech/")) {
      antwort.writeHead(HTTP_OK, { "content-type": "audio/mpeg" });
      return antwort.end(AUDIO);
    }
    if (anfrage.url.endsWith("/actions/playback_start")) aufrufe.wiedergaben.push(JSON.parse(roh));
    if (anfrage.url.endsWith("/actions/hangup")) {
      aufrufe.auflegen.push(anfrage.url.includes(EL) ? EL : CALLEE);
      if (anfrage.url.includes(EL) && (await elAuflegen())) {
        antwort.writeHead(HTTP_SERVERFEHLER, { "content-type": "application/json" });
        return antwort.end("{}");
      }
    }
    antwort.writeHead(HTTP_OK, { "content-type": "application/json" });
    antwort.end(JSON.stringify({ data: { sid: "v3:einzel", result: "ok", call_control_id: beinFuer(roh) } }));
  });
  return server.then((attrappe) => ({ attrappe, aufrufe }));
}

function ereignis(signer, srv, { callId, art: eventType, bein = CALLEE, kennung }) {
  const rumpf = JSON.stringify({
    data: { id: `evt-${eventType}-${callId}-${kennung}`, event_type: eventType, payload: { call_control_id: bein, status: "ok" } },
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
  };
  await mitZweiHermesAufPostgres(t, { env }, (instanzen) => lauf({ ...instanzen, signer, aufrufe }));
}

async function bisAbgebrochen({ a, sql, signer, aufrufe }, art) {
  assert.equal((await platziere(a)).status, HTTP_OK);
  const { rows } = await sql("SELECT id FROM call WHERE to_e164 = $1", [ZIEL]);
  const callId = rows[0].id;
  assert.equal((await ereignis(signer, a, { callId, art: "call.answered", kennung: "ab" })).status, HTTP_OK);
  await zeilenBis(async () => aufrufe.wiedergaben, (liste) => liste.length === 1);
  return { callId, abbruch: (srv) => ereignis(signer, srv, { callId, art, kennung: "ende" }) };
}

const verarbeitet = (instanzen) =>
  instanzen.reduce((summe, srv) => summe + srv.stdout.split('"ereignis":"wiedergabe_ende"').length - 1, 0);

test("Abnahme 1: Speichert Instanz A am Ereignisende mit veralteter Kopie, nachdem B das gescheiterte Auflegen des EL-Beins zurueckgenommen hat, bleibt das EL-Bein offen, und das Hangup des Callee-Beins legt es auf", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  let elScheitertNoch = true;
  let elFreigeben;
  const elFrei = new Promise((fertig) => (elFreigeben = fertig));
  const elAuflegen = async () => {
    if (!elScheitertNoch) return false;
    elScheitertNoch = false;
    await elFrei;
    return true;
  };
  t.after(() => elFreigeben());
  await mitAnbieter(t, { elAuflegen }, async ({ a, b, sql, signer, aufrufe }) => {
    await sql(PROTOKOLL_SQL);
    const { callId, abbruch } = await bisAbgebrochen({ a, sql, signer, aufrufe }, "call.playback.ended");
    assert.equal((await abbruch(b)).status, HTTP_OK);
    await zeilenBis(async () => aufrufe.auflegen, (liste) => liste.includes(EL));
    const beide = await zeilenBis(async () => (await sql(ZEILE_SQL, [callId])).rows[0]?.aufgelegt ?? [], (liste) => liste.length === 2);
    assert.deepEqual([...beide].sort(), [CALLEE, EL]);
    await sql("BEGIN");
    await sql("SELECT 1 FROM vorspann_zustand WHERE call_id = $1 FOR UPDATE", [callId]);
    elFreigeben();
    await zeilenBis(async () => (await sql(WARTENDE_SQL)).rows[0].anzahl, (anzahl) => anzahl >= 1);
    const veraltet = ereignis(signer, a, { callId, art: "call.playback.ended", bein: EL, kennung: "a" });
    await zeilenBis(async () => (await sql(WARTENDE_SQL)).rows[0].anzahl, (anzahl) => anzahl >= 2);
    await sql("COMMIT");
    assert.equal((await veraltet).status, HTTP_OK);
    await zeilenBis(async () => verarbeitet([a, b]), (anzahl) => anzahl === 2);
    assert.deepEqual((await sql(ZEILE_SQL, [callId])).rows[0].aufgelegt, [CALLEE]);
    const uebergaenge = (await sql(PROTOKOLL_LESEN_SQL)).rows.map((zeile) => `${zeile.alt.sort()}>${zeile.neu.sort()}`);
    assert.equal(uebergaenge.length, 3);
    const erstesBein = uebergaenge[0].slice(1);
    assert.ok([CALLEE, EL].includes(erstesBein));
    assert.deepEqual(uebergaenge, [`>${erstesBein}`, `${erstesBein}>${CALLEE},${EL}`, `${CALLEE},${EL}>${CALLEE}`]);
    assert.equal((await ereignis(signer, b, { callId, art: "call.hangup", kennung: "hangup" })).status, HTTP_OK);
    await zeilenBis(async () => aufrufe.auflegen, (liste) => liste.filter((bein) => bein === EL).length === 2);
  });
});

test("Scheitert das Schreiben von aufgelegt in der Zeile, werden beide Beine trotzdem aufgelegt", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, { elAuflegen: async () => false }, async ({ a, sql, signer, aufrufe }) => {
    const { callId, abbruch } = await bisAbgebrochen({ a, sql, signer, aufrufe }, "call.playback.ended");
    await sql(SPERRTRIGGER_SQL);
    assert.equal((await abbruch(a)).status, HTTP_OK);
    await zeilenBis(async () => aufrufe.auflegen, (liste) => liste.includes(EL) && liste.includes(CALLEE));
    assert.deepEqual((await sql(ZEILE_SQL, [callId])).rows[0].aufgelegt, []);
  });
});

test("Abnahme 2 und 3 (Speicher): ein Speichern mit veralteter Kopie nimmt ein eingetragenes Bein nicht zurueck, Einzeländerungen sind einmalig und wirken pro Bein", async () => {
  const ref = { tenantId: "t_einzel", callId: "call_einzel_speicher" };
  await vorspannZustand.anlegen({ ...ref, token: "tok", text: "Satz", ttlMs: TTL_MS });
  const veraltet = await vorspannZustand.lade(ref);
  await vorspannZustand.legeAufgelegtAn({ ...ref, bein: "a" });
  await vorspannZustand.legeAufgelegtAn({ ...ref, bein: "a" });
  await vorspannZustand.legeAufgelegtAn({ ...ref, bein: "b" });
  await vorspannZustand.speichere({ ...ref, stand: { M: 1 } });
  assert.deepEqual(veraltet.aufgelegt, []);
  assert.deepEqual((await vorspannZustand.lade(ref)).aufgelegt, ["a", "b"]);
  assert.deepEqual((await vorspannZustand.lade(ref)).stand, { M: 1 });
  await vorspannZustand.nimmAufgelegtWeg({ ...ref, bein: "a" });
  assert.deepEqual((await vorspannZustand.lade(ref)).aufgelegt, ["b"]);
  await vorspannZustand.speichere({ ...ref, stand: { M: 2 } });
  assert.deepEqual((await vorspannZustand.lade(ref)).aufgelegt, ["b"]);
  await vorspannZustand.nimmAufgelegtWeg({ ...ref, bein: "x" });
  assert.deepEqual((await vorspannZustand.lade(ref)).aufgelegt, ["b"]);
  await vorspannZustand.speichere({ ...ref, stand: {}, aufgelegt: ["c"] });
  assert.deepEqual((await vorspannZustand.lade(ref)).aufgelegt, ["c"]);
  await vorspannZustand.legeAufgelegtAn({ tenantId: "t_einzel", callId: "call_ohne_zeile", bein: "a" });
  assert.equal(await vorspannZustand.lade({ tenantId: "t_einzel", callId: "call_ohne_zeile" }), undefined);
  await vorspannZustand.loesche(ref);
});
