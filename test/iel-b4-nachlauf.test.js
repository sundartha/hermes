// ---- IEL-B4: Nachlauf-Politik fuer ueberbrueckte Inbound-Calls im EL-Poll ----------------
// Ein Inbound-Call, dessen Gespraech der ElevenLabs-Agent fuehrt (Kostenprofil
// telnyx_inbound_el_convai), wird vom ziehenden Ergebnisweg nachbereitet, OHNE unser
// abgerechnetes Telnyx-Bein anzutasten: Anker bleibt, keine Anbieter-Zusammenfassung, kein
// next_steps-Item, Beende-Versuch ueber das Traeger-Bein, Frist ab dem Nachlauf-Marker,
// Ende-Anker = Carrier-Ende, Single-Flight ueber Register + frische Pruefung nach dem Abruf.
//
// Offline, kein Netz, kein Server: Harness in test/_iel-inbound-harness.js (Anbieter-Attrappe
// ueber withFetch, echte state-ops-Mutatoren, echte makeCallFinish-Instanz).
// Zeitanker relativ zu Date.now(): carrierEndMsOf = min(now, Marker) liefert fuer jedes
// spaetere now denselben Wert - deterministisch ohne gemockte Uhr (waitUntil braucht die echte).
//
// Namen beginnen mit "IEL-B4-<n>: " - trifft weder i18nCatalogPattern noch abnahmePattern,
// laeuft also in npm test.
import { test } from "node:test";
import assert from "node:assert/strict";

import { liveVoiceSpendCents, voiceMinutesOf } from "../src/billing/metering.js";
import { KOSTENPROFIL } from "../src/billing/kostenarten.js";
import { INBOUND_NACHLAUF_FRIST_MS, PERMANENT_ERROR_STREAK_LIMIT } from "../src/elevenlabs/outbound.js";
import { nachlaufPolitikFuer, pollDarfWirken } from "../src/elevenlabs/nachlauf-politik.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { POLL_TIMEOUT_REASON } from "../src/telephony/failure-reason.js";
import { MS_PER_SECOND } from "../src/utils/timer.js";
import {
  CONVERSATION_DONE_WITH_ANALYSIS,
  CONVERSATION_IN_PROGRESS,
  ERROR_ENVELOPES,
} from "./fixtures/elevenlabs-conversations.js";
import { waitUntil, withFetch } from "./helpers.js";
import {
  CONV_ID,
  FIXTURE_ZEILEN,
  INBOUND_FROM,
  INBOUND_TO,
  RUHE_TAKTE,
  WARTE,
  baueHarness,
  beendeSchleifen,
  fehlerAntwort,
  isoVor,
  makeAnbieter,
  mitAnbieter,
  okAntwort,
  ruhe,
  seedInboundElCall,
} from "./_iel-inbound-harness.js";

const MINDEST_TAKTE = 3;
const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
const ZWANZIG_MINUTEN_S = 1200;
const NEXT_STEP_TEXT = "Rueckruf am Montag";
const ENDE_NACH_S = 90;
const GESPRAECH_S = 240;
const GESPRAECH_MINUTEN_BIS_MARKER = 3;
const FRIST_UEBERZUG_S = 1;
const BEIN_VOR_MARKER_S = 120;
const BEIN_MINUTEN_BIS_MARKER = 2;
const FRISCHER_MARKER_S = 1;
const LIVE_T0_MS = Date.parse("2026-09-14T10:00:00.000Z");
const LIVE_MARKER_NACH_S = 150;
const EINE_MINUTE = 1;
const ZEHN_MINUTEN = 10;
const ZWEI_SCHLEIFEN = 2;

const INBOUND_DONE = Object.freeze({
  ...CONVERSATION_DONE_WITH_ANALYSIS,
  analysis: {
    ...CONVERSATION_DONE_WITH_ANALYSIS.analysis,
    data_collection_results: { next_steps: { data_collection_id: "next_steps", value: NEXT_STEP_TEXT } },
  },
});

// ---- Build: Datensaetze (Bausteine fuer Inbound-EL in test/_iel-inbound-harness.js) -------

function seedOutboundElCall(state, { answeredVorS }) {
  const call = ops.createCall(state, {
    direction: "outbound",
    from: INBOUND_TO,
    to: INBOUND_FROM,
    goal: "Termin vereinbaren",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  call.elevenlabsConversationId = CONV_ID;
  call.startedAt = isoVor(answeredVorS);
  call.answeredAt = call.startedAt;
  return call;
}

// ---- 1: Politik-Tabelle ------------------------------------------------------------------

const ERWARTET_HEUTE = {
  ankerNachziehen: true,
  anbieterZusammenfassung: true,
  naechsteSchritteAlsAufgabe: true,
  beendeVersuch: "el",
  fristAnker: "anbieter_cap",
  endeAnker: "jetzt",
  frischPruefenNachAbruf: false,
};
const ERWARTET_INBOUND_EL = {
  ankerNachziehen: false,
  anbieterZusammenfassung: false,
  naechsteSchritteAlsAufgabe: false,
  beendeVersuch: "traeger",
  fristAnker: "nachlauf_start",
  endeAnker: "carrier_ende",
  frischPruefenNachAbruf: true,
};
const EL_INBOUND = KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI;

test("IEL-B4-1: nachlaufPolitikFuer waehlt je Brueckenzustand die richtige Politik, pollDarfWirken sperrt nur Ende und Rueckfall", () => {
  const faelle = [
    [{ direction: "outbound" }, ERWARTET_HEUTE],
    [{ direction: "inbound", costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET }, ERWARTET_HEUTE],
    [{ costProfile: EL_INBOUND }, ERWARTET_INBOUND_EL],
    [{ costProfile: EL_INBOUND, elevenlabsConversationId: CONV_ID }, ERWARTET_INBOUND_EL],
    [{ costProfile: EL_INBOUND, elevenlabsConversationId: CONV_ID, elFallbackAt: isoVor(1) }, ERWARTET_INBOUND_EL],
    [null, ERWARTET_HEUTE],
  ];
  for (const [call, erwartet] of faelle) assert.deepEqual({ ...nachlaufPolitikFuer(call) }, erwartet);

  assert.equal(pollDarfWirken({ status: "active", costProfile: EL_INBOUND, elevenlabsConversationId: CONV_ID }), true);
  assert.equal(pollDarfWirken({ status: "completed" }), false);
  assert.equal(pollDarfWirken({ status: "active", costProfile: EL_INBOUND, elFallbackAt: isoVor(1) }), false);
  assert.equal(pollDarfWirken(null), false);
});

// ---- 2 / 2P: Abschluss ohne Anbieter-Zusammenfassung und ohne next_steps-Item ------------

test("IEL-B4-2: Inbound done -> summarizeCall laeuft auf dem EL-Transkript, kein next_steps-Item, Anker und Leitung unberuehrt", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S, nachlaufVorS: ENDE_NACH_S });
  const ankerVorher = call.answeredAt;
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(INBOUND_DONE));

  await mitAnbieter({ state, anbieter }, async () => {
    harness.el.rearmActiveConversationPolls();
    await waitUntil(() => harness.zusammenfassungen.length === 1, WARTE);
  });

  assert.deepEqual(harness.zusammenfassungen, [{ summary: null, rollen: ["agent", "caller"] }]);
  assert.deepEqual(ops.callActionItems(state, call.id), []);
  assert.equal(harness.gebucht.length, 1);
  assert.ok(call.billedAt);
  assert.equal(call.answeredAt, ankerVorher);
  assert.equal(anbieter.deletes, 0);
  assert.deepEqual(harness.traegerAuflegen, []);
});

test("IEL-B4-2P: Positiv-Kontrolle - dieselbe Fixture als Outbound-EL-Call schreibt Anbieter-Zusammenfassung und next_steps-Item", async () => {
  const state = ops.makeDefaultState();
  const call = seedOutboundElCall(state, { answeredVorS: GESPRAECH_S });
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(INBOUND_DONE));

  await mitAnbieter({ state, anbieter }, async () => {
    harness.el.rearmActiveConversationPolls();
    await waitUntil(() => harness.gebucht.length === 1, WARTE);
  });

  assert.equal(call.summary, CONVERSATION_DONE_WITH_ANALYSIS.analysis.transcript_summary);
  assert.deepEqual(ops.callActionItems(state, call.id).map((item) => item.text), [NEXT_STEP_TEXT]);
});

// ---- 3: Ende-Anker = Carrier-Ende --------------------------------------------------------

test("IEL-B4-3: Inbound done 90 s nach dem Carrier-Ende -> endedAt ist der Nachlauf-Marker, gebucht wird bis dorthin", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S, nachlaufVorS: ENDE_NACH_S });
  const marker = call.elNachlaufStartedAt;
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(INBOUND_DONE));

  await mitAnbieter({ state, anbieter }, async () => {
    harness.el.rearmActiveConversationPolls();
    await waitUntil(() => harness.gebucht.length === 1, WARTE);
  });

  assert.equal(call.endedAt, marker);
  assert.equal(voiceMinutesOf(call), GESPRAECH_MINUTEN_BIS_MARKER);
});

// ---- 4 / 5 / 5P: Nachlauf-Frist ----------------------------------------------------------

test("IEL-B4-4: Frist ab Marker abgelaufen -> Abschluss ueber das Traeger-Bein, Frist nicht gebucht, Anker bleibt", async () => {
  const state = ops.makeDefaultState();
  const nachlaufVorS = INBOUND_NACHLAUF_FRIST_MS / MS_PER_SECOND + FRIST_UEBERZUG_S;
  const call = seedInboundElCall(state, { answeredVorS: nachlaufVorS + BEIN_VOR_MARKER_S, nachlaufVorS });
  const { elNachlaufStartedAt: marker, answeredAt: ankerVorher } = call;
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(CONVERSATION_IN_PROGRESS));

  await mitAnbieter({ state, anbieter }, async () => {
    harness.el.rearmActiveConversationPolls();
    await waitUntil(() => harness.gebucht.length === 1, WARTE);
  });

  assert.equal(call.endedAt, marker);
  assert.equal(voiceMinutesOf(call), BEIN_MINUTEN_BIS_MARKER);
  assert.equal(call.failureReason, POLL_TIMEOUT_REASON);
  assert.deepEqual(harness.traegerAuflegen, [call.id]);
  assert.equal(anbieter.gets, 0, "abgelaufene Frist schliesst im ersten Takt vor jedem Abruf ab");
  assert.equal(anbieter.deletes, 0);
  assert.equal(call.answeredAt, ankerVorher);
});

test("IEL-B4-5: Frist zaehlt ab dem Marker, nicht ab dem Anbieter-Deckel - 20 min altes Bein bleibt im Nachlauf aktiv", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: ZWANZIG_MINUTEN_S, nachlaufVorS: FRISCHER_MARKER_S });
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(CONVERSATION_IN_PROGRESS));

  await mitAnbieter({ state, anbieter }, async () => {
    harness.el.rearmActiveConversationPolls();
    await waitUntil(() => anbieter.gets >= MINDEST_TAKTE, WARTE);
    assert.equal(call.status, "active");
    assert.equal(call.billedAt, null);
    await beendeSchleifen(state, anbieter);
  });
});

test("IEL-B4-5P: Positiv-Kontrolle - Outbound-EL-Call mit demselben answeredAt schliesst im ersten Takt ueber den Anbieter-Deckel ab", async () => {
  const state = ops.makeDefaultState();
  const call = seedOutboundElCall(state, { answeredVorS: ZWANZIG_MINUTEN_S });
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(CONVERSATION_IN_PROGRESS));

  await mitAnbieter({ state, anbieter }, async () => {
    harness.el.rearmActiveConversationPolls();
    await waitUntil(() => harness.gebucht.length === 1, WARTE);
  });

  assert.notEqual(call.status, "active");
  assert.equal(call.failureReason, POLL_TIMEOUT_REASON);
});

// ---- 6: dauerhafter Anbieter-Fehler ------------------------------------------------------

test("IEL-B4-6: 3x 404 -> Anker bleibt (kein clearAnchor), Traeger-Bein wird beendet, Ende-Anker = Marker", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S, nachlaufVorS: ENDE_NACH_S });
  const { elNachlaufStartedAt: marker, answeredAt: ankerVorher } = call;
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => fehlerAntwort(ERROR_ENVELOPES.notFound));

  await mitAnbieter({ state, anbieter }, async () => {
    harness.el.rearmActiveConversationPolls();
    await waitUntil(() => harness.gebucht.length === 1, WARTE);
  });

  assert.equal(anbieter.gets, PERMANENT_ERROR_STREAK_LIMIT);
  assert.equal(call.answeredAt, ankerVorher);
  assert.equal(call.answeredUnclearReason, null);
  assert.deepEqual(harness.traegerAuflegen, [call.id]);
  assert.equal(anbieter.deletes, 0);
  assert.equal(call.endedAt, marker);
});

// ---- 7 / 7P: Live-Term -------------------------------------------------------------------

function liveInboundElCall({ mitMarker }) {
  return {
    direction: "inbound",
    status: "active",
    costProfile: EL_INBOUND,
    from: INBOUND_FROM,
    to: INBOUND_TO,
    answeredAt: new Date(LIVE_T0_MS).toISOString(),
    elNachlaufStartedAt: mitMarker ? new Date(LIVE_T0_MS + LIVE_MARKER_NACH_S * MS_PER_SECOND).toISOString() : null,
  };
}

const markerMs = () => LIVE_T0_MS + LIVE_MARKER_NACH_S * MS_PER_SECOND;

test("IEL-B4-7: Live-Term eines Calls im Nachlauf waechst nicht weiter", () => {
  const call = liveInboundElCall({ mitMarker: true });
  assert.equal(
    liveVoiceSpendCents([call], markerMs() + EINE_MINUTE * MS_PER_MINUTE),
    liveVoiceSpendCents([call], markerMs() + ZEHN_MINUTEN * MS_PER_MINUTE),
  );
});

test("IEL-B4-7P: Positiv-Kontrolle - derselbe Call ohne Marker waechst mit der Zeit", () => {
  const call = liveInboundElCall({ mitMarker: false });
  assert.notEqual(
    liveVoiceSpendCents([call], markerMs() + EINE_MINUTE * MS_PER_MINUTE),
    liveVoiceSpendCents([call], markerMs() + ZEHN_MINUTEN * MS_PER_MINUTE),
  );
});

// ---- 8 - 11: Single-Flight ---------------------------------------------------------------

// Ruft das Start-Tor, WAEHREND die laufende Schleife in ihrem Abruf haengt: eine zweite
// Schleife liefe sofort in einen eigenen Abruf (offen === 2). Ohne das Festhalten antwortet
// die Attrappe so schnell, dass sich zwei Schleifen zeitlich nie ueberlappen und maxOffen
// nichts belegt. Gibt danach mit "laeuft noch" frei.
async function startTorWaehrendAbruf(harness, anbieter, callId) {
  let freigeben;
  const tor = new Promise((resolve) => {
    freigeben = resolve;
  });
  anbieter.setzeAntwort(() => tor);
  await waitUntil(() => anbieter.offen === 1, WARTE);
  harness.el.startInboundNachlauf(callId);
  await ruhe(RUHE_TAKTE);
  const offenNachStart = anbieter.offen;
  anbieter.setzeAntwort(async () => okAntwort(CONVERSATION_IN_PROGRESS));
  freigeben(okAntwort(CONVERSATION_IN_PROGRESS));
  return offenNachStart;
}

test("IEL-B4-8: Boot-Re-Arm plus Start-Tor -> eine Schleife, genau eine Persistenz und eine Buchung", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(CONVERSATION_IN_PROGRESS));

  await mitAnbieter({ state, anbieter }, async () => {
    harness.el.rearmActiveConversationPolls();
    await waitUntil(() => anbieter.gets >= ZWEI_SCHLEIFEN, WARTE);
    assert.equal(await startTorWaehrendAbruf(harness, anbieter, call.id), 1, "das Start-Tor startet keine zweite Schleife");
    assert.ok(call.elNachlaufStartedAt, "das Start-Tor setzt den Marker auch bei laufender Schleife");
    await waitUntil(() => anbieter.gets >= ZWEI_SCHLEIFEN + MINDEST_TAKTE, WARTE);
    anbieter.setzeAntwort(async () => okAntwort(INBOUND_DONE));
    await waitUntil(() => harness.zusammenfassungen.length === 1, WARTE);
    await ruhe(RUHE_TAKTE);
  });

  assert.equal(anbieter.maxOffen, 1);
  const [zusammenfassung] = harness.zusammenfassungen;
  assert.equal(zusammenfassung.rollen.length, FIXTURE_ZEILEN);
  assert.equal(harness.zusammenfassungen.length, 1);
  assert.equal(harness.gebucht.length, 1);
});

test("IEL-B4-9: startInboundNachlauf zweimal synchron -> eine Schleife, der erste Marker bleibt", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(CONVERSATION_IN_PROGRESS));

  await mitAnbieter({ state, anbieter }, async () => {
    harness.el.startInboundNachlauf(call.id);
    const ersterMarker = call.elNachlaufStartedAt;
    harness.el.startInboundNachlauf(call.id);
    await waitUntil(() => anbieter.gets >= MINDEST_TAKTE, WARTE);
    assert.equal(call.elNachlaufStartedAt, ersterMarker);
    await beendeSchleifen(state, anbieter);
  });

  assert.equal(anbieter.maxOffen, 1);
});

// Zwei Fabrik-Instanzen (je eigenes Register) auf DEMSELBEN Datensatz: beide haengen im
// selben Abruf, erst dann wird freigegeben - isoliert die frische Pruefung nach dem await.
async function zweiSchleifenImSelbenAbruf() {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S, nachlaufVorS: ENDE_NACH_S });
  const erste = baueHarness(state);
  const zweite = baueHarness(state);
  let freigeben;
  const tor = new Promise((resolve) => {
    freigeben = resolve;
  });
  const anbieter = makeAnbieter(() => tor);
  const beide = () => [erste, zweite];
  const summe = (feld) => beide().reduce((anzahl, harness) => anzahl + harness[feld].length, 0);

  await mitAnbieter({ state, anbieter }, async () => {
    for (const harness of beide()) harness.el.rearmActiveConversationPolls();
    await waitUntil(() => anbieter.offen === ZWEI_SCHLEIFEN, WARTE);
    freigeben(okAntwort(INBOUND_DONE));
    await waitUntil(() => summe("zusammenfassungen") === 1, WARTE);
    await ruhe(RUHE_TAKTE);
  });
  return { state, call, beide, summe, anbieter };
}

test("IEL-B4-10: zwei Schleifen im selben Abruf -> genau ein Abschluss, eine Buchung, eine Detektor-Zaehlung", async () => {
  const { summe } = await zweiSchleifenImSelbenAbruf();
  assert.equal(summe("zusammenfassungen"), 1);
  assert.equal(summe("gebucht"), 1);
  assert.equal(summe("detektorZaehlungen"), 1);
});

test("IEL-B4-11: nach dem Abschluss haelt der Purge - ein weiterer Re-Arm schreibt kein Transkript zurueck", async () => {
  const { state, call, beide, anbieter } = await zweiSchleifenImSelbenAbruf();
  await mitAnbieter({ state, anbieter }, async () => {
    beide()[0].el.rearmActiveConversationPolls();
    await ruhe(MINDEST_TAKTE + RUHE_TAKTE);
  });
  assert.equal(call.transcript.length, 0);
});

// ---- 12 / 13: Rueckfall-Riegel -----------------------------------------------------------

test("IEL-B4-12: Neustart waehrend RUECKFALL -> kein Re-Arm, kein Abruf, keine Buchung", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  ops.markInboundElFallback(state, call.id, new Date().toISOString());
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(INBOUND_DONE));

  await mitAnbieter({ state, anbieter }, async () => {
    harness.el.rearmActiveConversationPolls();
    await new Promise((resolve) => setImmediate(resolve));
  });

  assert.equal(anbieter.gets, 0);
  assert.equal(call.status, "active");
  assert.equal(call.billedAt, null);
});

test("IEL-B4-13: Rueckfall waehrend eines laufenden Abrufs -> kein Abschluss, keine Buchung, Schleife endet", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S });
  const harness = baueHarness(state);
  let freigeben;
  const tor = new Promise((resolve) => {
    freigeben = resolve;
  });
  const anbieter = makeAnbieter(() => tor);

  await mitAnbieter({ state, anbieter }, async () => {
    harness.el.rearmActiveConversationPolls();
    await waitUntil(() => anbieter.offen === 1, WARTE);
    ops.markInboundElFallback(state, call.id, new Date().toISOString());
    freigeben(okAntwort(INBOUND_DONE));
    await waitUntil(() => anbieter.offen === 0, WARTE);
    await ruhe(RUHE_TAKTE);
  });

  assert.equal(call.status, "active");
  assert.equal(call.billedAt, null);
  assert.equal(harness.gebucht.length, 0);
  assert.equal(anbieter.gets, 1, "nach dem Riegel plant die Schleife keinen Folgetakt");
});

// ---- 14 / 15: Neustart ohne Nachlauf-Marker ----------------------------------------------

test("IEL-B4-14: GEBUNDEN ohne Nachlauf-Start -> keine eigene Frist; done schliesst genau einmal mit Ende = jetzt ab", async () => {
  const teststartMs = Date.now();
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: ZWANZIG_MINUTEN_S });
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(CONVERSATION_IN_PROGRESS));

  await mitAnbieter({ state, anbieter }, async () => {
    harness.el.rearmActiveConversationPolls();
    await waitUntil(() => anbieter.gets >= MINDEST_TAKTE, WARTE);
    assert.equal(call.status, "active");
    anbieter.setzeAntwort(async () => okAntwort(INBOUND_DONE));
    await waitUntil(() => harness.gebucht.length === 1, WARTE);
    await ruhe(RUHE_TAKTE);
  });

  assert.equal(harness.gebucht.length, 1);
  assert.ok(Date.parse(call.endedAt) >= teststartMs);
});

test("IEL-B4-15: Marker waehrend laufender Schleife -> frische Frist ab Marker, kein Abschluss, weiter eine Schleife", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: ZWANZIG_MINUTEN_S });
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(CONVERSATION_IN_PROGRESS));

  await mitAnbieter({ state, anbieter }, async () => {
    harness.el.rearmActiveConversationPolls();
    await waitUntil(() => anbieter.gets >= ZWEI_SCHLEIFEN, WARTE);
    assert.equal(await startTorWaehrendAbruf(harness, anbieter, call.id), 1, "das Start-Tor startet keine zweite Schleife");
    const getsBeimStart = anbieter.gets;
    await waitUntil(() => anbieter.gets >= getsBeimStart + ZWEI_SCHLEIFEN, WARTE);
    assert.equal(call.status, "active");
    assert.equal(harness.gebucht.length, 0);
    await beendeSchleifen(state, anbieter);
  });

  assert.equal(anbieter.maxOffen, 1);
});

// ---- 16: Beende-Versuch-Pfad (Pflicht-Uebergabe politik) ---------------------------------

test("IEL-B4-16: endActiveCall fuer Inbound-EL -> keine Anbieter-Zusammenfassung, Anker unveraendert", async () => {
  const state = ops.makeDefaultState();
  const call = seedInboundElCall(state, { answeredVorS: GESPRAECH_S, nachlaufVorS: ENDE_NACH_S });
  const ankerVorher = call.answeredAt;
  const harness = baueHarness(state);
  const anbieter = makeAnbieter(async () => okAntwort(INBOUND_DONE));

  await withFetch(anbieter.fetch, () => harness.el.endActiveCall(call.id));

  assert.equal(call.summary, null);
  assert.equal(call.answeredAt, ankerVorher);
});
