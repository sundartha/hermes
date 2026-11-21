import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";

import { elevenlabsOutbound } from "../../src/elevenlabs/registry.ts";
import { makePostgresAnrufstartMarker, makePostgresFristen } from "../../src/store.js";
import { makeFristenLauf } from "../../src/telephony/fristen-lauf.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { withFetch } from "../helpers.js";
import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const MANDANT = "t_h5493_kunde";
const ZIEL = "+4915112340093";
const ABSENDER = "+4930555000493";
const KONVERSATION = "conv_x";
const GEHEIMNIS = "h5493-werkzeug-geheimnis";
const HTTP_OK = 200;
const HTTP_UNPROCESSABLE = 422;
const MS_JE_SEKUNDE = 1000;
const VERSUCHT_MS = Date.parse("2026-11-17T10:00:00.000Z");
const BREMS_SCHRITTE = 200;
const SPEICHERN_FEHLER = "Speichern der Konversations-ID abgelehnt";
const FLUSH_MELDUNG = "[pg] Flush fehlgeschlagen:";
const ID_SCHREIBEN = /elevenlabs_conversation_id\s*=\s*(\$3|EXCLUDED)/;
const ANTWORT_SQL = "UPDATE call SET answered_at";
const ZEILE_SQL = "SELECT status, answered_at, elevenlabs_conversation_id AS id, frist_abfrage_at FROM call WHERE id = $1";

const naechsterDurchlauf = () => new Promise((fertig) => setImmediate(fertig));

async function bremse(schritte) {
  for (let schritt = 0; schritt < schritte; schritt += 1) await naechsterDurchlauf();
}

const unbeobachtet = (db) => ({
  withClient: (fn) => fn({ query: (text, params) => db.query(text, params), exec: (sql) => db.exec(sql) }),
});

function beobachteteDatenbank(db, { bremsSchritte, ablehnen }) {
  const beobachtung = { gebremst: 0, abgelehnt: 0, idBeiAntwort: undefined };
  const query = async (text, params) => {
    if (ID_SCHREIBEN.test(text)) {
      beobachtung.gebremst += 1;
      await bremse(bremsSchritte);
      if (ablehnen && beobachtung.abgelehnt === 0) {
        beobachtung.abgelehnt += 1;
        throw new Error(SPEICHERN_FEHLER);
      }
    }
    if (text.startsWith(ANTWORT_SQL)) {
      const { rows } = await db.query("SELECT elevenlabs_conversation_id AS id FROM call WHERE id = $1", [params[1]]);
      beobachtung.idBeiAntwort = rows[0]?.id ?? null;
    }
    return db.query(text, params);
  };
  return { beobachtung, runner: { withClient: (fn) => fn({ query, exec: (sql) => db.exec(sql) }) } };
}

async function neuerAufbau({ bremsSchritte = BREMS_SCHRITTE, ablehnen = false } = {}) {
  const db = await pgliteAlsRolleOhneSuperuser();
  await makePgStore(unbeobachtet(db)).init();
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [MANDANT]);
  await db.query(`INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)`, [MANDANT]);
  const { beobachtung, runner } = beobachteteDatenbank(db, { bremsSchritte, ablehnen });
  const pgStore = makePgStore(runner);
  await pgStore.init();
  const call = pgStore.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: MANDANT });
  await pgStore.persistCall(call.id);
  const marker = makePostgresAnrufstartMarker(runner);
  await marker.setze({ callId: call.id, tenantId: MANDANT, jetztIso: new Date(VERSUCHT_MS).toISOString() });
  const fristen = makePostgresFristen(runner);
  const store = {
    ...pgStore,
    anrufstartMarker: marker,
    setzeAbfrageFrist: async (anfrage) => {
      await pgStore.drainFlushes();
      return fristen.setzeAbfrage(anfrage);
    },
  };
  return { db, store, call, beobachtung };
}

const mitKonfiguration = () =>
  withConfigNamespaces({
    elevenLabsOutbound: { apiKey: "test-key", apiBase: "https://el.test", resultPollMs: 5 },
    elevenLabsToolToken: GEHEIMNIS,
  });

const baueAusgehend = (store) =>
  elevenlabsOutbound().makeElevenLabsOutbound({
    store,
    config: mitKonfiguration(),
    terminateAndBillCall: async ({ persistEnd }) => persistEnd(),
    billThunk: () => () => {},
    finishCall: () => {},
  });

const anbieter = (anfragen) => async (url, init) => {
  anfragen.push(`${init.method} ${url}`);
  const antwort = (daten) => ({ ok: true, status: HTTP_OK, json: async () => daten });
  if (init.method === "DELETE") return antwort({});
  if (String(url).includes("?")) return antwort({ conversations: [{ conversation_id: KONVERSATION }], has_more: false });
  if (String(url).endsWith(KONVERSATION)) return antwort(gespraech());
  return { ok: false, status: HTTP_UNPROCESSABLE };
};

const gespraech = () => ({
  conversation_initiation_client_data: {
    dynamic_variables: { callee: ZIEL, tenant_token: createHmac("sha256", GEHEIMNIS).update(`v1:${MANDANT}`).digest("hex") },
  },
});

async function gleicheAb({ store, call }) {
  const auftrag = baueAusgehend(store).macheAnrufstartAuftrag({
    store,
    starte: async () => assert.fail("der Abgleich waehlt nicht"),
    sperren: { eingefroren: () => false, pausiert: () => false, abgebrochen: () => false },
    beendeOhneWahl: async () => {},
    armeTimer: () => {},
    jetztMs: () => VERSUCHT_MS + MS_JE_SEKUNDE,
  });
  const anfragen = [];
  const ausgang = await withFetch(anbieter(anfragen), () => auftrag({ payload: { callId: call.id } }));
  return { ausgang, anfragen };
}

test("h5493 K1: bei verzoegertem Speichern steht die Konversations-ID schon in der Zeile, wenn der Abgleich-Anruf abhebt", async () => {
  const { db, store, call, beobachtung } = await neuerAufbau();
  const { ausgang } = await gleicheAb({ store, call });
  assert.equal(ausgang, "abgeglichen");
  assert.ok(beobachtung.gebremst > 0, "die Bremse hat das Speichern der ID verzoegert");
  assert.equal(beobachtung.idBeiAntwort, KONVERSATION);
  const [zeile] = (await db.query(ZEILE_SQL, [call.id])).rows;
  assert.equal(zeile.status, "active");
  assert.equal(zeile.id, KONVERSATION);
  assert.ok(zeile.answered_at);
});

test("h5493 K2: scheitert das Speichern der ID, steht das im Protokoll, der Anruf hebt trotzdem ab und die Abfrage-Frist ist gesetzt", async (t) => {
  const meldungen = [];
  t.mock.method(console, "error", (...teile) => meldungen.push(teile.join(" ")));
  const { db, store, call, beobachtung } = await neuerAufbau({ bremsSchritte: 0, ablehnen: true });
  const { ausgang } = await gleicheAb({ store, call });
  assert.equal(ausgang, "abgeglichen");
  assert.equal(beobachtung.abgelehnt, 1);
  assert.ok(meldungen.some((meldung) => meldung.includes(FLUSH_MELDUNG) && meldung.includes(SPEICHERN_FEHLER)), meldungen.join("\n"));
  const [zeile] = (await db.query(ZEILE_SQL, [call.id])).rows;
  assert.equal(zeile.status, "active");
  assert.ok(zeile.answered_at);
  assert.ok(zeile.frist_abfrage_at);
});

test("h5493 K3: laeuft die Max-Dauer eines Abgleich-Anrufs nach verzoegertem Speichern ab, findet die Kappung die Konversation conv_x und beendet sie", async () => {
  const { db, store, call } = await neuerAufbau();
  await gleicheAb({ store, call });
  const anderer = makePgStore(unbeobachtet(db));
  await anderer.init();
  const fristen = makePostgresFristen(unbeobachtet(db));
  await fristen.setzeHoechstdauer({ callId: call.id, tenantId: MANDANT, faelligAt: new Date(VERSUCHT_MS).toISOString() });
  const anfragen = [];
  const beende = async (angehoben) => {
    assert.equal(angehoben.elevenlabsConversationId, KONVERSATION);
    await withFetch(anbieter(anfragen), () => baueAusgehend(anderer).endActiveCall(angehoben.id));
    await anderer.setCallEndedAt(angehoben.id, "completed", new Date(VERSUCHT_MS).toISOString());
  };
  const lauf = makeFristenLauf({
    store: { ...anderer, faelligeFristen: fristen.faellige },
    beende,
    limitJeMandant: 5,
    leaseMs: MS_JE_SEKUNDE,
  });
  assert.deepEqual(await lauf.takt(), { beendet: 1, offen: 0, gelesen: true });
  assert.ok(anfragen.includes(`DELETE https://el.test/v1/convai/conversations/${KONVERSATION}`), anfragen.join("\n"));
  const [zeile] = (await db.query("SELECT status FROM call WHERE id = $1", [call.id])).rows;
  assert.notEqual(zeile.status, "active");
});
