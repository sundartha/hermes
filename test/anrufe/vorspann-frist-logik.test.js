import assert from "node:assert/strict";
import { test } from "node:test";

import { makeVorspannAblauf } from "../../src/elevenlabs/vorspann-ablauf.js";
import { STAND } from "../../src/elevenlabs/vorspann-bruecke.js";
import { beiVorspannFrist, setzeVorspannFristen } from "../../src/elevenlabs/vorspann-fristen.js";
import { makeSpeicherVorspannZustand } from "../../src/store/vorspann-zustand.js";
import { starteFristenTakt } from "../../src/telephony/fristen-lauf.ts";

const JETZT_MS = 1_000_000;
const WIEDERGABE_MS = 20_000;
const EL_MS = 30_000;
const CALL = { id: "call_4b_logik", tenantId: "tenant_4b_logik", status: "active", provider: "telnyx", to: "+4915112300001", from: "+4930123456", streamToken: "st" };
const CALLEE = "cc_callee_4b";

test("Vorspann-Fristen setzen: Wiedergabe- und EL-Bein-Frist stehen auf jetzt plus ihrer Dauer, je Anruf und Mandant", async () => {
  const gesetzt = [];
  const store = { setzeVorspannFrist: async (frist) => gesetzt.push(frist) };
  const config = { voice: { elevenLabsOutbound: { vorspannWiedergabeFristMs: WIEDERGABE_MS, bridgeStartDeadlineMs: EL_MS } } };
  await setzeVorspannFristen({ call: CALL, store, config, jetzt: () => JETZT_MS });
  assert.deepEqual(gesetzt, [
    { tenantId: CALL.tenantId, callId: CALL.id, frist: "wiedergabe", faelligAt: new Date(JETZT_MS + WIEDERGABE_MS).toISOString() },
    { tenantId: CALL.tenantId, callId: CALL.id, frist: "elBein", faelligAt: new Date(JETZT_MS + EL_MS).toISOString() },
  ]);
});

const zustandMit = (...marken) => ({ stand: new Map(marken.map((marke) => [marke, 1])), calleeId: CALLEE });

const FRISTFAELLE = [
  { name: "Wiedergabe-Frist ohne Marke", frist: "wiedergabe", marken: [STAND.ABGEHOBEN], status: "active", wirkt: true },
  { name: "EL-Frist ohne Marke", frist: "elBein", marken: [STAND.ABGEHOBEN, STAND.WIEDERGABE], status: "active", wirkt: true },
  { name: "Wiedergabe-Frist nach abgespieltem Satz", frist: "wiedergabe", marken: [STAND.WIEDERGABE], status: "active", wirkt: false },
  { name: "EL-Frist nach EL-Annahme", frist: "elBein", marken: [STAND.EL_BEIN], status: "active", wirkt: false },
  { name: "Wiedergabe-Frist nach Abbruch", frist: "wiedergabe", marken: [STAND.ABGEBROCHEN], status: "active", wirkt: false },
  { name: "EL-Frist nach Abbruch", frist: "elBein", marken: [STAND.ABGEBROCHEN], status: "active", wirkt: false },
  { name: "Wiedergabe-Frist nach Bruecke", frist: "wiedergabe", marken: [STAND.BRUECKE], status: "active", wirkt: false },
  { name: "EL-Frist nach Bruecke", frist: "elBein", marken: [STAND.BRUECKE], status: "active", wirkt: false },
  { name: "Wiedergabe-Frist bei beendetem Anruf", frist: "wiedergabe", marken: [STAND.ABGEHOBEN], status: "failed", wirkt: false },
];

for (const { name, frist, marken, status, wirkt } of FRISTFAELLE) {
  test(`Vorspann-Frist behandeln: ${name} ${wirkt ? "meldet und legt beide Beine auf" : "tut nichts"}`, async () => {
    const ablauf = [];
    const zustand = zustandMit(...marken);
    await beiVorspannFrist({
      frist,
      call: { ...CALL, status },
      ladeZustand: async () => zustand,
      melde: { wiedergabe: async () => ablauf.push("melde-wiedergabe"), elBein: async () => ablauf.push("melde-el") },
      beineAuf: async (geladen) => ablauf.push(geladen === zustand ? "beine-auf" : "fremder-zustand"),
    });
    const soll = wirkt ? [frist === "wiedergabe" ? "melde-wiedergabe" : "melde-el", "beine-auf"] : [];
    assert.deepEqual(ablauf, soll);
  });
}

test("Vorspann-Frist behandeln: ohne Zustandszeile passiert nichts", async () => {
  const ablauf = [];
  await beiVorspannFrist({
    frist: "wiedergabe",
    call: CALL,
    ladeZustand: async () => undefined,
    melde: { wiedergabe: async () => ablauf.push("melde") },
    beineAuf: async () => ablauf.push("beine-auf"),
  });
  assert.deepEqual(ablauf, []);
});

function baueAblauf({ fristSchreibenScheitert }) {
  const protokoll = { beendet: [], wiedergaben: [], vermerkt: [] };
  const vorspannZustand = makeSpeicherVorspannZustand();
  const steuerung = {
    endCallViaCallControl: async (bein) => protokoll.beendet.push(bein),
    playbackStart: async (bein) => protokoll.wiedergaben.push(bein),
    dialCallControl: async () => ({ callControlId: "cc_el_4b" }),
  };
  const store = {
    leseCall: async () => ({ ...CALL }),
    markAnswered: async () => {},
    save: () => {},
    recordFailureReason: (callId, grund) => protokoll.vermerkt.push([callId, grund]),
    setzeVorspannFrist: async () => {
      if (fristSchreibenScheitert) throw new Error("frist verweigert");
    },
  };
  const config = {
    server: { publicUrl: "https://agent.test" },
    telephony: { telnyxCallControlAppId: "app" },
    voice: { elevenLabsOutbound: { vorspannWiedergabeFristMs: WIEDERGABE_MS, bridgeStartDeadlineMs: EL_MS } },
  };
  const ablauf = makeVorspannAblauf({
    voiceControl: () => steuerung,
    store,
    config,
    ttsStore: { release: () => {} },
    vorspannZustand,
    inboundBridges: {},
    ausgehendGesperrt: async () => false,
    terminateAndBillCall: async () => {},
    awaitAndPersistInboundElResult: async () => {},
    billThunk: () => async () => {},
    finishCall: async () => {},
    now: () => JETZT_MS,
    setTimer: () => {},
  });
  return { ablauf, vorspannZustand, protokoll };
}

test("Vorspann abheben: scheitert das Schreiben der Fristen, steht der Fehler im Log, das Bein wird aufgelegt und der Satz nicht gestartet", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { ablauf, vorspannZustand, protokoll } = baueAblauf({ fristSchreibenScheitert: true });
  await vorspannZustand.anlegen({ tenantId: CALL.tenantId, callId: CALL.id, token: "tok", text: "Satz", ttlMs: WIEDERGABE_MS });
  await vorspannZustand.setzeCallee({ tenantId: CALL.tenantId, callId: CALL.id, calleeId: CALLEE });
  await ablauf.behandle({ call: { ...CALL }, ereignis: { ereignis: "abgehoben", callControlId: CALLEE }, zugang: { username: "u", password: "p" } });
  assert.deepEqual(zeilen, [`[el-vorspann] frist fehlgeschlagen call=${CALL.id}: frist verweigert`]);
  assert.deepEqual(protokoll.beendet, [CALLEE]);
  assert.deepEqual(protokoll.wiedergaben, []);
});

test("Vorspann abheben: gelingt das Schreiben der Fristen, startet der Satz und kein Bein wird aufgelegt", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { ablauf, vorspannZustand, protokoll } = baueAblauf({ fristSchreibenScheitert: false });
  await vorspannZustand.anlegen({ tenantId: CALL.tenantId, callId: CALL.id, token: "tok", text: "Satz", ttlMs: WIEDERGABE_MS });
  await vorspannZustand.setzeCallee({ tenantId: CALL.tenantId, callId: CALL.id, calleeId: CALLEE });
  await ablauf.behandle({ call: { ...CALL }, ereignis: { ereignis: "abgehoben", callControlId: CALLEE }, zugang: { username: "u", password: "p" } });
  assert.deepEqual(protokoll.wiedergaben, [CALLEE]);
  assert.deepEqual(protokoll.beendet, []);
  assert.deepEqual(zeilen.filter((zeile) => zeile.startsWith("[el-vorspann]")), []);
});

function takt({ hierKaputt }) {
  const handles = [];
  const gelesen = [];
  const uhr = { setzeTakt: (aufgabe) => (handles.push(aufgabe), { unref: () => {} }), loescheTakt: () => {} };
  const store = {
    faelligeFristen: async (anfrage) => {
      gelesen.push(anfrage.art);
      if (anfrage.art === "hoechstdauer") throw new Error("db weg");
      return [];
    },
    attachActiveCall: async () => null,
    getCall: () => null,
    setzeGeldFrist: async () => {},
    setzeReserveFrist: async () => {},
    setzeUebergabeFrist: async () => {},
    leereVorspannFrist: async () => {},
  };
  const abgelaufeneHier = () => {
    if (hierKaputt) throw new Error("hier kaputt");
    return [];
  };
  starteFristenTakt({ store, beende: async () => {}, abgelaufeneHier, limitJeMandant: 1, leaseMs: 1, taktMs: 1, uhr, vorspann: { bei: async () => {} } });
  return { tick: handles[0], gelesen };
}

const nachRunde = () => new Promise((erfuellen) => setImmediate(erfuellen));

test("Fristentakt: laufen alle Runden ohne Abbruch, steht kein Abbruch im Log", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { tick } = takt({ hierKaputt: false });
  tick();
  await nachRunde();
  tick();
  await nachRunde();
  assert.deepEqual(zeilen.filter((zeile) => zeile.startsWith("[fristen] Takt abgebrochen")), []);
});

test("Fristentakt: wirft die erste Runde, steht der Abbruch mit ihrem Fehler im Log und die Vorspann-Runde laeuft trotzdem", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { tick, gelesen } = takt({ hierKaputt: true });
  tick();
  await nachRunde();
  tick();
  await nachRunde();
  assert.deepEqual(zeilen.filter((zeile) => zeile.startsWith("[fristen] Takt abgebrochen")), ["[fristen] Takt abgebrochen: Error: hier kaputt"]);
  assert.equal(gelesen.filter((art) => art === "vorspann").length, 2);
});
