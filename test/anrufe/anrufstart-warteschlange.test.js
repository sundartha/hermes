import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ANRUFSTART_AUSGANG,
  ANRUFSTART_SPERRE,
  ANRUFSTART_WARTE_TAKT_MS,
  makeAnrufstartAuftrag,
} from "../../src/elevenlabs/anrufstart-auftrag.ts";
import { makeAnrufstartMarker } from "../../src/store.js";
import { WARTEFRIST_REASON, failureReasonBase, meldetAlsNichtGestartet } from "../../src/telephony/failure-reason.ts";

const MS_JE_SEKUNDE = 1000;
const ANGELEGT_MS = Date.parse("2026-11-17T10:00:00.000Z");
const CALL_ID = "call_warten_1";
const WARTEFRIST_MS = 120 * MS_JE_SEKUNDE;

function aufbau({ belegt = [], sperren = {}, vorher = null } = {}) {
  const spur = [];
  const uhr = { ms: ANGELEGT_MS };
  const call = {
    id: CALL_ID,
    tenantId: "t_warten",
    to: "+4915112340077",
    status: "active",
    startedAt: new Date(ANGELEGT_MS).toISOString(),
  };
  const marker = makeAnrufstartMarker();
  const versuche = [...belegt];
  const abhaengigkeiten = {
    store: { leseCall: async () => call, load: () => ({ calls: [call] }), anderesAnrufMitKonversation: async () => false, anrufstartMarker: marker },
    starte: async () => spur.push("starte"),
    anbieterGespraeche: { liste: async () => ({ conversations: [], has_more: false }), hole: async () => null },
    haltAnrufStartFest: () => spur.push("festgehalten"),
    beendeStartUnklar: async () => spur.push("unklar"),
    sperren: {
      eingefroren: () => sperren.eingefroren?.(uhr) ?? false,
      pausiert: () => sperren.pausiert?.(uhr) ?? false,
      abgebrochen: () => call.status !== "active",
    },
    beendeOhneWahl: async (callId, grund) => spur.push(`ohne-wahl:${callId}:${grund}`),
    armeTimer: () => spur.push("timer"),
    wartefristMs: WARTEFRIST_MS,
    mandantenToken: () => "token",
    jetztMs: () => uhr.ms,
    platz: {
      belege: async () => {
        const frei = versuche.length === 0 ? true : versuche.shift();
        spur.push(frei ? "platz" : "kein-platz");
        return frei;
      },
      beendeNachWartefrist: async (callId) => spur.push(`frist-ende:${callId}`),
      warte: async (ms) => {
        spur.push(`warte:${ms}`);
        uhr.ms += ms;
      },
    },
  };
  return { spur, uhr, call, marker, auftrag: makeAnrufstartAuftrag({ ...abhaengigkeiten, ...vorher?.(abhaengigkeiten) }) };
}

const lauf = ({ auftrag }) => auftrag({ payload: { callId: CALL_ID } });
const starts = (spur) => spur.filter((eintrag) => eintrag === "starte").length;

test("Warteschlange: der Takt ist eine Sekunde, ohne Frist-Angabe gilt kein Warten", async () => {
  assert.equal(ANRUFSTART_WARTE_TAKT_MS, MS_JE_SEKUNDE);
  const bau = aufbau({ belegt: [false, true], vorher: () => ({ wartefristMs: undefined }) });
  assert.equal(await lauf(bau), ANRUFSTART_AUSGANG.ABGELAUFEN);
  assert.deepEqual(bau.spur, [`frist-ende:${CALL_ID}`]);
});

test("Warteschlange: ist sofort ein Platz frei, wird ohne Warten genau einmal gewaehlt", async () => {
  const bau = aufbau();
  assert.equal(await lauf(bau), ANRUFSTART_AUSGANG.GESTARTET);
  assert.deepEqual(bau.spur, ["platz", "starte", "timer"]);
});

test("Warteschlange: ohne Platz wird ohne Anbieteraufruf gewartet, danach startet der Anruf genau einmal", async () => {
  const bau = aufbau({ belegt: [false, false, false] });
  assert.equal(await lauf(bau), ANRUFSTART_AUSGANG.GESTARTET);
  assert.deepEqual(bau.spur, [
    ...Array(3).fill(["kein-platz", `warte:${ANRUFSTART_WARTE_TAKT_MS}`]).flat(),
    "platz",
    "starte",
    "timer",
  ]);
});

test("Warteschlange: der Marker wird erst gesetzt, wenn der Platz belegt ist", async () => {
  const markerBeimPlatzversuch = [];
  const bau = aufbau({
    belegt: [false, true],
    vorher: (alt) => ({
      platz: {
        ...alt.platz,
        belege: async (angelegt) => {
          markerBeimPlatzversuch.push(await alt.store.anrufstartMarker.lies(angelegt.id));
          return alt.platz.belege(angelegt);
        },
      },
    }),
  });
  await lauf(bau);
  assert.deepEqual(markerBeimPlatzversuch, [null, null]);
  assert.equal(typeof (await bau.marker.lies(CALL_ID)), "string");
});

test("Warteschlange: eine Millisekunde vor Ablauf der 120 Sekunden wird noch gewartet, genau zum Ablauf endet der Anruf ohne Wahl", async () => {
  const nochDa = aufbau({ belegt: [true] });
  nochDa.uhr.ms = ANGELEGT_MS + WARTEFRIST_MS - 1;
  assert.equal(await lauf(nochDa), ANRUFSTART_AUSGANG.GESTARTET);
  assert.equal(starts(nochDa.spur), 1);

  const abgelaufen = aufbau({ belegt: [false, true] });
  abgelaufen.uhr.ms = ANGELEGT_MS + WARTEFRIST_MS;
  assert.equal(await lauf(abgelaufen), ANRUFSTART_AUSGANG.ABGELAUFEN);
  assert.deepEqual(abgelaufen.spur, [`frist-ende:${CALL_ID}`]);
  assert.equal(await abgelaufen.marker.lies(CALL_ID), null);
});

test("Warteschlange: ohne Platz bis zur Frist endet der Anruf ohne Wahl, ohne Marker, ohne Timer", async () => {
  const bau = aufbau({ belegt: Array.from({ length: 500 }, () => false) });
  assert.equal(await lauf(bau), ANRUFSTART_AUSGANG.ABGELAUFEN);
  assert.equal(starts(bau.spur), 0);
  assert.equal(bau.spur.filter((eintrag) => eintrag.startsWith("warte")).length, WARTEFRIST_MS / ANRUFSTART_WARTE_TAKT_MS);
  assert.deepEqual(bau.spur.slice(-2), [`warte:${ANRUFSTART_WARTE_TAKT_MS}`, `frist-ende:${CALL_ID}`]);
  assert.equal(await bau.marker.lies(CALL_ID), null);
});

test("Warteschlange: ein Anruf ohne lesbaren Beginn wartet nicht, sondern endet sofort", async () => {
  const bau = aufbau({ belegt: [false, true] });
  delete bau.call.startedAt;
  assert.equal(await lauf(bau), ANRUFSTART_AUSGANG.ABGELAUFEN);
  assert.equal(starts(bau.spur), 0);
});

for (const [name, sperre, grund] of [
  ["Anrufpause", { pausiert: (uhr) => uhr.ms >= ANGELEGT_MS + 2 * MS_JE_SEKUNDE }, ANRUFSTART_SPERRE.PAUSE],
  ["OUTBOUND_FROZEN", { eingefroren: (uhr) => uhr.ms >= ANGELEGT_MS + 2 * MS_JE_SEKUNDE }, ANRUFSTART_SPERRE.EINGEFROREN],
]) {
  test(`Warteschlange: ${name} waehrend des Wartens, danach wird nie gewaehlt und der Anruf endet`, async () => {
    const bau = aufbau({ belegt: [false, false, false, true], sperren: sperre });
    assert.equal(await lauf(bau), ANRUFSTART_AUSGANG.ABGESPERRT);
    assert.equal(starts(bau.spur), 0);
    assert.equal(bau.spur.filter((eintrag) => eintrag === "kein-platz").length, 2);
    assert.equal(bau.spur.at(-1), `ohne-wahl:${CALL_ID}:${grund}`);
    assert.equal(await bau.marker.lies(CALL_ID), null);
  });
}

test("Warteschlange: ein waehrend des Wartens abgebrochener Anruf wird nie gewaehlt", async () => {
  const bau = aufbau({ belegt: [false, true] });
  bau.call.status = "cancelled";
  assert.equal(await lauf(bau), ANRUFSTART_AUSGANG.ABGESPERRT);
  assert.deepEqual(bau.spur, []);
});

test("Warteschlange: ein bereits gesetzter Marker wartet nie und gleicht nur ab", async () => {
  const bau = aufbau({ belegt: [false] });
  await bau.marker.setze({ callId: CALL_ID, tenantId: "t_warten", jetztIso: new Date(ANGELEGT_MS).toISOString() });
  assert.equal(await lauf(bau), ANRUFSTART_AUSGANG.OFFEN);
  assert.deepEqual(bau.spur, []);
});

test("Warteschlange: ein Anruf, der waehrend des Wartens aus dem Speicher verschwindet, wird nie gewaehlt", async () => {
  let gelesen = 0;
  const bau = aufbau({
    belegt: [false, true],
    vorher: (alt) => ({ store: { ...alt.store, leseCall: async () => (++gelesen === 1 ? bau.call : null) } }),
  });
  await assert.rejects(lauf(bau), /ohne bekannten Anruf/);
  assert.equal(starts(bau.spur), 0);
});

test("Warteschlange: der Grund nach der Frist ist ein Auslastungsgrund und kein unklarer Ausgang", () => {
  assert.equal(WARTEFRIST_REASON, "at-capacity:queue-timeout");
  assert.equal(failureReasonBase(WARTEFRIST_REASON), "at-capacity");
  assert.equal(meldetAlsNichtGestartet(WARTEFRIST_REASON), true);
});

test("Warteschlange: ein waehrend des Wartens abgebrochener Anruf wird am frisch gelesenen Anruf erkannt und nie gewaehlt", async () => {
  let gespeichert = null;
  const bau = aufbau({
    belegt: [false, true],
    vorher: (alt) => ({
      store: { ...alt.store, leseCall: async () => gespeichert ?? { ...bau.call } },
      platz: {
        ...alt.platz,
        warte: async (ms) => {
          await alt.platz.warte(ms);
          gespeichert = { ...bau.call, status: "cancelled" };
        },
      },
      sperren: { ...alt.sperren, abgebrochen: (call) => call.status !== "active" },
    }),
  });
  assert.equal(await lauf(bau), ANRUFSTART_AUSGANG.ABGESPERRT);
  assert.equal(starts(bau.spur), 0);
  assert.equal(bau.spur.filter((eintrag) => eintrag === "kein-platz").length, 1);
  assert.equal(await bau.marker.lies(CALL_ID), null);
});

for (const [name, sperre, grund] of [
  ["Anrufpause", { pausiert: () => true }, ANRUFSTART_SPERRE.PAUSE],
  ["OUTBOUND_FROZEN", { eingefroren: () => true }, ANRUFSTART_SPERRE.EINGEFROREN],
]) {
  test(`Warteschlange: ${name} gilt auch fuer einen Auftrag mit abgelaufener Frist vor der Fristpruefung`, async () => {
    const bau = aufbau({ belegt: [false, true], sperren: sperre });
    bau.uhr.ms = ANGELEGT_MS + WARTEFRIST_MS + MS_JE_SEKUNDE;
    assert.equal(await lauf(bau), ANRUFSTART_AUSGANG.ABGESPERRT);
    assert.deepEqual(bau.spur, [`ohne-wahl:${CALL_ID}:${grund}`]);
    assert.equal(await bau.marker.lies(CALL_ID), null);
  });
}

test("Warteschlange: ein abgebrochener Auftrag mit abgelaufener Frist endet als abgesperrt und nicht als Wartefrist", async () => {
  const bau = aufbau({ belegt: [false, true] });
  bau.uhr.ms = ANGELEGT_MS + WARTEFRIST_MS + MS_JE_SEKUNDE;
  bau.call.status = "cancelled";
  assert.equal(await lauf(bau), ANRUFSTART_AUSGANG.ABGESPERRT);
  assert.deepEqual(bau.spur, []);
});
