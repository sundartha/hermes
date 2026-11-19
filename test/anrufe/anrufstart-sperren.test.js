import assert from "node:assert/strict";
import { test } from "node:test";

import { ANRUFSTART_AUSGANG, ANRUFSTART_SPERRE, makeAnrufstartAuftrag } from "../../src/elevenlabs/anrufstart-auftrag.ts";
import * as speicher from "../../src/store.js";
import { legeMandantAn, makePgTestStore } from "../pg-helpers.js";

const MANDANT = "t_anrufstart_sperre";
const ZIEL = "+4915112340022";
const ABSENDER = "+4930555000402";
const MS_JE_SEKUNDE = 1000;
const FEST_MS = Date.parse("2026-11-17T10:00:00.500Z");
const ZEHN_MINUTEN_MS = 600 * MS_JE_SEKUNDE;

const gespraech = (callee) => ({
  conversation_initiation_client_data: { dynamic_variables: { callee, tenant_token: "token-sperre" } },
});

async function neuerAufbau({ sperren = {}, startFehler = null, markerVorMs = null, anbieterListe = [] } = {}) {
  const { store: db, runner } = await makePgTestStore();
  await legeMandantAn(db, MANDANT);
  const call = db.createCall({ direction: "outbound", from: ABSENDER, to: ZIEL, goal: "Test", tenantId: MANDANT });
  await db.persistCall(call.id);
  const marker = speicher.makePostgresAnrufstartMarker(runner);
  if (markerVorMs !== null)
    await marker.setze({ callId: call.id, tenantId: MANDANT, jetztIso: new Date(FEST_MS - markerVorMs).toISOString() });
  const spur = [];
  const abhaengigkeiten = {
    store: { leseCall: (id) => db.leseCall(id), load: () => db.load(), anderesAnrufMitKonversation: (id, konv) => db.anderesAnrufMitKonversation(id, konv), anrufstartMarker: marker },
    starte: async () => {
      spur.push("starte");
      if (startFehler) throw startFehler;
    },
    anbieterGespraeche: {
      liste: async () => ({ conversations: anbieterListe.map((id) => ({ conversation_id: id })), has_more: false }),
      hole: async () => gespraech(ZIEL),
    },
    haltAnrufStartFest: (angelegt, id) => spur.push(`festgehalten:${id}`),
    beendeStartUnklar: async () => {
      spur.push("unklar");
    },
    sperren: {
      eingefroren: () => sperren.eingefroren ?? false,
      pausiert: (angelegt) => {
        spur.push(`pause-fuer:${angelegt.tenantId}`);
        return sperren.pausiert ?? false;
      },
      abgebrochen: (angelegt) => {
        spur.push(`abbruch-fuer:${angelegt.id}`);
        return sperren.abgebrochen ?? false;
      },
    },
    beendeOhneWahl: async (callId, grund) => {
      spur.push(`ohne-wahl:${callId}:${grund}`);
    },
    armeTimer: (angelegt) => spur.push(`timer:${angelegt.id}`),
    mandantenToken: () => "token-sperre",
    jetztMs: () => FEST_MS,
  };
  return { call, marker, spur, auftrag: makeAnrufstartAuftrag(abhaengigkeiten) };
}

const lauf = ({ auftrag, call }) => auftrag({ payload: { callId: call.id } });
const starts = (spur) => spur.filter((eintrag) => eintrag === "starte").length;

test("Anrufstart-Sperren: Gutfall startet einmal, die Timer werden erst nach dem Start gesetzt", async () => {
  const aufbau = await neuerAufbau();
  assert.equal(await lauf(aufbau), ANRUFSTART_AUSGANG.GESTARTET);
  assert.deepEqual(aufbau.spur, [
    `abbruch-fuer:${aufbau.call.id}`,
    `pause-fuer:${MANDANT}`,
    "starte",
    `timer:${aufbau.call.id}`,
  ]);
});

for (const [name, sperren, grund] of [
  ["OUTBOUND_FROZEN", { eingefroren: true }, ANRUFSTART_SPERRE.EINGEFROREN],
  ["Anrufpause", { pausiert: true }, ANRUFSTART_SPERRE.PAUSE],
]) {
  test(`Anrufstart-Sperren: ${name} zwischen Antwort und Auftrag, nichts wird gewaehlt, Anruf endet, kein Marker`, async () => {
    const aufbau = await neuerAufbau({ sperren });
    assert.equal(await lauf(aufbau), ANRUFSTART_AUSGANG.ABGESPERRT);
    assert.equal(starts(aufbau.spur), 0);
    assert.ok(aufbau.spur.includes(`ohne-wahl:${aufbau.call.id}:${grund}`));
    assert.equal(aufbau.spur.some((eintrag) => eintrag.startsWith("timer")), false);
    assert.equal(await aufbau.marker.lies(aufbau.call.id), null);
  });
}

test("Anrufstart-Sperren: Gruende sind verschieden und benannt", () => {
  assert.deepEqual(ANRUFSTART_SPERRE, { EINGEFROREN: "outbound-frozen", PAUSE: "anrufpause" });
  assert.equal(ANRUFSTART_AUSGANG.ABGESPERRT, "abgesperrt");
});

test("Anrufstart-Sperren: abgebrochener Anruf wird nicht gewaehlt, das Ende hat cancel_call schon geschrieben", async () => {
  const aufbau = await neuerAufbau({ sperren: { abgebrochen: true } });
  assert.equal(await lauf(aufbau), ANRUFSTART_AUSGANG.ABGESPERRT);
  assert.equal(starts(aufbau.spur), 0);
  assert.equal(aufbau.spur.some((eintrag) => eintrag.startsWith("ohne-wahl")), false);
  assert.equal(await aufbau.marker.lies(aufbau.call.id), null);
});

test("Anrufstart-Sperren: Einfrieren hat Vorrang vor allem anderen, die Pause wird gar nicht erst gefragt", async () => {
  const aufbau = await neuerAufbau({ sperren: { eingefroren: true, pausiert: true } });
  await lauf(aufbau);
  assert.deepEqual(aufbau.spur, [
    `abbruch-fuer:${aufbau.call.id}`,
    `ohne-wahl:${aufbau.call.id}:${ANRUFSTART_SPERRE.EINGEFROREN}`,
  ]);
});

test("Anrufstart-Sperren: Wirft der Start, werden keine Timer gesetzt und es gibt keinen zweiten Start", async () => {
  const aufbau = await neuerAufbau({ startFehler: new Error("Zeitablauf") });
  await assert.rejects(lauf(aufbau), /Zeitablauf/);
  assert.equal(aufbau.spur.some((eintrag) => eintrag.startsWith("timer")), false);
  assert.equal(await lauf(aufbau), ANRUFSTART_AUSGANG.OFFEN);
  assert.equal(starts(aufbau.spur), 1);
});

test("Anrufstart-Sperren: Sperre nach gesetztem Marker aendert nichts, es wird nur abgeglichen, nie gewaehlt", async () => {
  const aufbau = await neuerAufbau({ sperren: { eingefroren: true }, markerVorMs: ZEHN_MINUTEN_MS });
  assert.equal(await lauf(aufbau), ANRUFSTART_AUSGANG.UNKLAR);
  assert.equal(starts(aufbau.spur), 0);
  assert.equal(aufbau.spur.some((eintrag) => eintrag.startsWith("ohne-wahl")), false);
});

test("Anrufstart-Sperren: abgeglichener Anruf bekommt seine Timer ab dem gefundenen Gespraech", async () => {
  const aufbau = await neuerAufbau({ markerVorMs: ZEHN_MINUTEN_MS, anbieterListe: ["conv_neu"] });
  assert.equal(await lauf(aufbau), ANRUFSTART_AUSGANG.ABGEGLICHEN);
  assert.deepEqual(aufbau.spur, ["festgehalten:conv_neu", `timer:${aufbau.call.id}`]);
});

test("SG-34 Auftrag fuer eingefrorenen Mandanten oder pausierte Anrufe wird nie gewaehlt", async () => {
  for (const sperren of [{ eingefroren: true }, { pausiert: true }, { abgebrochen: true }]) {
    const aufbau = await neuerAufbau({ sperren });
    await lauf(aufbau);
    assert.equal(starts(aufbau.spur), 0);
  }
});

test("SG-35 Wiederholung eines Anrufstarts wird nie ein zweiter Anbieteraufruf", async () => {
  const aufbau = await neuerAufbau({ startFehler: new Error("unklarer Ausgang") });
  await assert.rejects(lauf(aufbau));
  await lauf(aufbau);
  await lauf(aufbau);
  assert.equal(starts(aufbau.spur), 1);
});
