import { test } from "node:test";
import assert from "node:assert/strict";

import { VORSPANN_ABLAGE_TTL_MS, VORSPANN_WAHL_GRUND, wahlSperrGrund } from "../src/elevenlabs/vorspann-pruefung.js";
import { endeFuerAufgelegt, makeVorspannAblauf } from "../src/elevenlabs/vorspann-ablauf.js";
import { PUBLIC_ROUTES } from "../src/route-policy.js";
import { CALL_CONTROL_EREIGNIS } from "../src/telephony/call-control-ereignis.js";
import { parseCallControlEvent } from "../src/telephony/adapters/telnyx/webhook-events.js";
import { billThunk, terminateAndBillCall } from "../src/telephony/call-termination.js";
import { createTtsStore } from "../src/tts/store.js";
import { echtWarten } from "./echt-warten.js";

const CALLEE = "cc_callee";
const TOKEN = "token-1";
const DID = "+4915255555555";
const AUDIO = { bytes: Buffer.from("audio"), contentType: "audio/mpeg" };

test("3365-K6: Sperrgrund vor der Wahl -> abgebrochen vor gesperrt, sonst keiner", () => {
  const tabelle = [
    [{ aktiv: false, gesperrt: false }, VORSPANN_WAHL_GRUND.ABGEBROCHEN],
    [{ aktiv: false, gesperrt: true }, VORSPANN_WAHL_GRUND.ABGEBROCHEN],
    [{ aktiv: true, gesperrt: true }, VORSPANN_WAHL_GRUND.GESPERRT],
    [{ aktiv: true, gesperrt: false }, null],
  ];
  for (const [eingabe, erwartet] of tabelle) assert.equal(wahlSperrGrund(eingabe), erwartet, JSON.stringify(eingabe));
});

test("3365-K17: Ende nach Auflegen -> abgehoben completed ohne Grund, sonst failed no-answer", () => {
  assert.deepEqual(endeFuerAufgelegt({ abgehoben: true }), { endStatus: "completed", grund: null });
  assert.deepEqual(endeFuerAufgelegt({ abgehoben: false }), { endStatus: "failed", grund: "no-answer" });
});

test("3365-K12: Ablage bisFreigabe -> mehrfach abrufbar, nach release null; ohne Option bleibt es ein Einmalabruf", async () => {
  const ablage = createTtsStore({ ttlMs: 60_000 });
  const gehalten = ablage.put({ bytes: AUDIO.bytes, contentType: AUDIO.contentType }, { bisFreigabe: true });
  assert.deepEqual(await ablage.takeOnce(gehalten), AUDIO);
  assert.deepEqual(await ablage.takeOnce(gehalten), AUDIO);
  ablage.release(gehalten);
  assert.equal(await ablage.takeOnce(gehalten), null);
  const einmal = ablage.put({ bytes: AUDIO.bytes, contentType: AUDIO.contentType });
  assert.deepEqual(await ablage.takeOnce(einmal), AUDIO);
  assert.equal(await ablage.takeOnce(einmal), null);
  assert.doesNotThrow(() => ablage.release("unbekannt"));
});

test("3365-K12: eigene Lebensdauer einer gehaltenen Datei ersetzt die Standard-Lebensdauer", async () => {
  const ablage = createTtsStore({ ttlMs: 60_000 });
  const kurz = ablage.put({ bytes: AUDIO.bytes, contentType: AUDIO.contentType }, { bisFreigabe: true, ttlMs: 5 });
  await echtWarten(40);
  assert.equal(await ablage.takeOnce(kurz), null);
});

function baue({ gesperrt = false, dialFehler = null, ohneKennung = false, playbackFehler = null, hangupFehler = null, abrechnungFehler = null } = {}) {
  const protokoll = { angenommen: [], gespeichert: [], wahlen: [], aufgelegt: [], wiedergaben: [], put: [], freigaben: [], beendet: [], abgerechnet: [] };
  const voice = {
    async dialCallControl(anfrage) {
      protokoll.wahlen.push(anfrage);
      if (dialFehler) throw dialFehler;
      if (ohneKennung) return {};
      return { callControlId: CALLEE };
    },
    async playbackStart(bein, optionen) {
      protokoll.wiedergaben.push([bein, optionen]);
      if (playbackFehler) throw playbackFehler;
    },
    async endCallViaCallControl(bein) {
      protokoll.aufgelegt.push(bein);
      if (hangupFehler) throw hangupFehler;
    },
  };
  const calls = new Map();
  const store = {
    markAnswered: (id) => protokoll.angenommen.push(id),
    save: () => protokoll.gespeichert.push(true),
    getCall: (id) => calls.get(id),
    recordFailureReason: (id, grund) => grund && protokoll.beendet.push(["grund", id, grund]),
    endCallRecord: (id, status) => protokoll.beendet.push(["ende", id, status]),
  };
  const ablauf = makeVorspannAblauf({
    voiceControl: () => voice,
    store,
    config: {
      server: { publicUrl: "https://agent.test" },
      telephony: { telnyxCallControlAppId: "app" },
      voice: { elevenLabsInbound: { sipUser: "user", sipPassword: "pw" } },
    },
    ttsStore: {
      put: (audio, optionen) => (protokoll.put.push([audio, optionen]), TOKEN),
      release: (token) => protokoll.freigaben.push(token),
    },
    ausgehendGesperrt: async () => gesperrt,
    terminateAndBillCall: abrechnungFehler
      ? async () => {
          throw abrechnungFehler;
        }
      : terminateAndBillCall,
    billThunk,
    finishCall: (call) => protokoll.abgerechnet.push(call),
  });
  return { ablauf, protokoll, registriere: (call) => (calls.set(call.id, call), call) };
}

const neuerCall = (felder = {}) => ({ id: "call_1", status: "active", provider: "telnyx", from: DID, to: "+4915112345678", maxDurationS: 300, ...felder });
const vorspann = { text: "Hallo", audio: AUDIO };
const ereignis = (art, bein = CALLEE) => ({ ereignis: art, callControlId: bein });

test("3365-K6: Kill-Switch oder Anrufpause unmittelbar vor der Wahl -> Fehler, nichts gewaehlt, keine Datei abgelegt", async () => {
  const { ablauf, protokoll, registriere } = baue({ gesperrt: true });
  await assert.rejects(ablauf.waehle({ call: registriere(neuerCall()), vorspann }), /gesperrt/);
  assert.equal(protokoll.wahlen.length, 0);
  assert.equal(protokoll.put.length, 0);
});

test("3365-K6: Anruf nicht mehr aktiv vor der Wahl -> grund abgebrochen_vor_wahl, nichts gewaehlt", async () => {
  const { ablauf, protokoll, registriere } = baue();
  const ergebnis = await ablauf.waehle({ call: registriere(neuerCall({ status: "cancelled" })), vorspann });
  assert.deepEqual(ergebnis, { grund: VORSPANN_WAHL_GRUND.ABGEBROCHEN });
  assert.equal(protokoll.wahlen.length, 0);
  assert.equal(protokoll.put.length, 0);
});

test("3365-K7: Wahl -> Datei bis Freigabe mit Lebensdauer abgelegt, Kennung am Anruf; scheitert die Wahl, wird die Datei freigegeben", async () => {
  const gut = baue();
  const call = gut.registriere(neuerCall());
  assert.deepEqual(await gut.ablauf.waehle({ call, vorspann }), { callControlId: CALLEE });
  assert.equal(call.callControlId, CALLEE);
  assert.deepEqual(gut.protokoll.put, [[AUDIO, { bisFreigabe: true, ttlMs: VORSPANN_ABLAGE_TTL_MS }]]);
  const fehler = new Error("422");
  const schlecht = baue({ dialFehler: fehler });
  await assert.rejects(schlecht.ablauf.waehle({ call: schlecht.registriere(neuerCall()), vorspann }), fehler);
  assert.deepEqual(schlecht.protokoll.freigaben, [TOKEN]);
});

test("3365-K7: Anruf waehrend der Wahl abgebrochen -> das frisch angelegte Bein wird sofort aufgelegt", async () => {
  const { ablauf, protokoll, registriere } = baue();
  const call = registriere(neuerCall());
  const wahl = ablauf.waehle({ call, vorspann });
  call.status = "cancelled";
  await wahl;
  assert.deepEqual(protokoll.aufgelegt, [CALLEE]);
});

async function angerufen(optionen) {
  const gebaut = baue(optionen);
  const call = gebaut.registriere(neuerCall());
  await gebaut.ablauf.waehle({ call, vorspann });
  return { ...gebaut, call };
}

test("3365-K8: Abheben -> Anruf als abgehoben vermerkt, Wiedergabe der abgelegten Datei; zweites Abheben bewirkt nichts", async () => {
  const { ablauf, protokoll, call } = await angerufen();
  await ablauf.behandle({ call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.ABGEHOBEN) });
  await ablauf.behandle({ call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.ABGEHOBEN) });
  assert.deepEqual(protokoll.wiedergaben, [[CALLEE, { audioUrl: `https://agent.test/voice/tts/${TOKEN}` }]]);
  assert.deepEqual(protokoll.angenommen, ["call_1"]);
  assert.equal(protokoll.gespeichert.length, 1);
  assert.equal(protokoll.wahlen.length, 1);
});

test("3365-K10: Ereignis eines anderen Beins, ohne Zustand oder ohne bekannte Art -> keine Aktion", async () => {
  const { ablauf, protokoll, call } = await angerufen();
  await ablauf.behandle({ call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.ABGEHOBEN, "fremd") });
  await ablauf.behandle({ call, ereignis: ereignis(null) });
  await ablauf.behandle({ call: neuerCall({ id: "call_2" }), ereignis: ereignis(CALL_CONTROL_EREIGNIS.ABGEHOBEN) });
  assert.equal(protokoll.wiedergaben.length, 0);
  assert.equal(protokoll.wahlen.length, 1);
});

test("3365-K8: Abheben eines nicht mehr aktiven Anrufs -> keine Aktion", async () => {
  const { ablauf, protokoll, call } = await angerufen();
  call.status = "cancelled";
  await ablauf.behandle({ call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.ABGEHOBEN) });
  assert.equal(protokoll.wiedergaben.length, 0);
  assert.equal(protokoll.wahlen.length, 1);
});

test("3365-K17: scheitert die Wiedergabe -> das Bein wird aufgelegt", async () => {
  const wiedergabe = await angerufen({ playbackFehler: new Error("500") });
  await wiedergabe.ablauf.behandle({ call: wiedergabe.call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.ABGEHOBEN) });
  assert.deepEqual(wiedergabe.protokoll.aufgelegt, [CALLEE]);
});

test("3365-K12: Wiedergabe-Ende gibt die Datei frei", async () => {
  const { ablauf, protokoll, call } = await angerufen();
  await ablauf.behandle({ call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.WIEDERGABE_ENDE) });
  assert.deepEqual(protokoll.freigaben, [TOKEN]);
});

test("3365-K17: Auflegen des Angerufenen -> Ende, Abrechnung, nichts aufzulegen; zweites Auflegen ist wirkungslos", async () => {
  const { ablauf, protokoll, call } = await angerufen();
  await ablauf.behandle({ call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.ABGEHOBEN) });
  await ablauf.behandle({ call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.AUFGELEGT) });
  await ablauf.behandle({ call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.AUFGELEGT) });
  assert.deepEqual(protokoll.beendet, [["ende", "call_1", "completed"]]);
  assert.deepEqual(protokoll.aufgelegt, []);
  assert.equal(protokoll.abgerechnet.length, 1);
  assert.deepEqual(protokoll.freigaben, [TOKEN]);
});

test("3365-K17: Auflegen vor dem Abheben -> failed mit Grund no-answer", async () => {
  const { ablauf, protokoll, call } = await angerufen();
  await ablauf.behandle({ call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.AUFGELEGT) });
  assert.deepEqual(protokoll.beendet, [["grund", "call_1", "no-answer"], ["ende", "call_1", "failed"]]);
  assert.deepEqual(protokoll.aufgelegt, []);
});

const CALL_ANFRAGE = {
  connectionId: "app",
  to: "+4915112345678",
  from: DID,
  webhookUrl: "https://agent.test/voice/vorspann?callId=call_1",
  timeLimitS: 300,
  commandId: "vorspann-call_1",
};

test("3365-K7: Wahlanfrage an den Angerufenen traegt genau die vorgesehenen Felder", async () => {
  const { protokoll } = await angerufen();
  assert.deepEqual(protokoll.wahlen, [CALL_ANFRAGE]);
});

function fehlerAusgabe(t) {
  const zeilen = [];
  t.mock.method(console, "error", (zeile) => zeilen.push(zeile));
  return zeilen;
}

test("3365-K17: scheitert die Wiedergabe, steht Grund und Anruf in der Logzeile; scheitert auch das Auflegen, steht das daneben", async (t) => {
  const zeilen = fehlerAusgabe(t);
  const { ablauf, call } = await angerufen({ playbackFehler: new Error("500"), hangupFehler: new Error("422") });
  await ablauf.behandle({ call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.ABGEHOBEN) });
  assert.deepEqual(zeilen, [
    "[el-vorspann] abheben fehlgeschlagen call=call_1: 500",
    "[el-vorspann] auflegen fehlgeschlagen call=call_1: 422",
  ]);
});

test("3365-K17: Auflegen eines Beins scheitert beim Anlegen nach Abbruch -> Logzeile, kein Abbruch der Wahl", async (t) => {
  const zeilen = fehlerAusgabe(t);
  const { ablauf, registriere } = baue({ hangupFehler: new Error("404") });
  const call = registriere(neuerCall());
  const wahl = ablauf.waehle({ call, vorspann });
  call.status = "cancelled";
  assert.deepEqual(await wahl, { callControlId: CALLEE });
  assert.deepEqual(zeilen, ["[el-vorspann] auflegen fehlgeschlagen call=call_1: 404"]);
});

test("3365-K17: ein Fehler beim Beenden wird protokolliert und nicht weitergereicht", async (t) => {
  const zeilen = fehlerAusgabe(t);
  const { ablauf, call } = await angerufen({ abrechnungFehler: new Error("abrechnung") });
  await ablauf.behandle({ call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.AUFGELEGT) });
  assert.deepEqual(zeilen, ["[el-vorspann] ereignis fehlgeschlagen call=call_1: abrechnung"]);
});

test("3365-K17: Auflegen eines schon beendeten Anrufs rechnet nichts ab", async () => {
  const { ablauf, protokoll, call } = await angerufen();
  call.status = "cancelled";
  await ablauf.behandle({ call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.AUFGELEGT) });
  assert.deepEqual(protokoll.beendet, []);
  assert.equal(protokoll.abgerechnet.length, 0);
  assert.deepEqual(protokoll.freigaben, [TOKEN]);
});

test("3365-K7: liefert der Anbieter keine Kennung, ist die Wahl gescheitert und die Datei wird freigegeben", async () => {
  const { ablauf, protokoll, registriere } = baue({ ohneKennung: true });
  await assert.rejects(ablauf.waehle({ call: registriere(neuerCall()), vorspann }), /keine Kennung/);
  assert.deepEqual(protokoll.freigaben, [TOKEN]);
});

test("3365-K8: Call-Control-Ereignisse werden anbieterneutral gelesen, Unbekanntes und Fehlformen ergeben kein Ereignis", () => {
  const koerper = (typ) => ({ data: { event_type: typ, payload: { call_control_id: CALLEE } } });
  const tabelle = [
    [koerper("call.answered"), CALL_CONTROL_EREIGNIS.ABGEHOBEN, CALLEE],
    [koerper("call.hangup"), CALL_CONTROL_EREIGNIS.AUFGELEGT, CALLEE],
    [koerper("call.playback.ended"), CALL_CONTROL_EREIGNIS.WIEDERGABE_ENDE, CALLEE],
    [koerper("call.initiated"), null, CALLEE],
    [{ data: { event_type: "call.answered" } }, CALL_CONTROL_EREIGNIS.ABGEHOBEN, null],
    [{ data: {} }, null, null],
    [{}, null, null],
    [undefined, null, null],
  ];
  for (const [eingabe, ereignis, bein] of tabelle)
    assert.deepEqual(parseCallControlEvent(eingabe), { ereignis, callControlId: bein }, JSON.stringify(eingabe));
});

function meldungen(t, kanal) {
  const zeilen = [];
  t.mock.method(console, kanal, (zeile) => zeilen.push(zeile));
  return zeilen;
}

test("3365-K8: gelingt das Abheben, steht nichts im Fehlerlog und kein Bein wird aufgelegt", async (t) => {
  const zeilen = meldungen(t, "error");
  const { ablauf, protokoll, call } = await angerufen();
  await ablauf.behandle({ call, ereignis: ereignis(CALL_CONTROL_EREIGNIS.ABGEHOBEN) });
  assert.deepEqual(zeilen, []);
  assert.deepEqual(protokoll.aufgelegt, []);
});

test("3365-K10: eine unbekannte Ereignisart auf dem eigenen Bein bewirkt weder eine Aktion noch eine Logzeile", async (t) => {
  const zeilen = meldungen(t, "error");
  const { ablauf, protokoll, call } = await angerufen();
  await ablauf.behandle({ call, ereignis: ereignis(null) });
  assert.deepEqual(zeilen, []);
  assert.deepEqual([protokoll.wiedergaben, protokoll.aufgelegt, protokoll.beendet], [[], [], []]);
});

test("3365-K6: die Rueckfallzeile steht nur bei Abbruch oder Sperre vor der Wahl und nennt Grund und Anruf", async (t) => {
  const zeilen = meldungen(t, "log");
  const gut = baue();
  await gut.ablauf.waehle({ call: gut.registriere(neuerCall()), vorspann });
  assert.deepEqual(zeilen, []);
  const abgebrochen = baue();
  await abgebrochen.ablauf.waehle({ call: abgebrochen.registriere(neuerCall({ status: "cancelled" })), vorspann });
  const gesperrt = baue({ gesperrt: true });
  await assert.rejects(gesperrt.ablauf.waehle({ call: gesperrt.registriere(neuerCall()), vorspann }), /gesperrt/);
  assert.deepEqual(zeilen, [
    "[el-vorspann] rueckfall grund=abgebrochen_vor_wahl call=call_1",
    "[el-vorspann] rueckfall grund=gesperrt_vor_wahl call=call_1",
  ]);
});

test("3365-K8: die Ereignisarten sind nichtleer und untereinander verschieden", () => {
  const arten = Object.values(CALL_CONTROL_EREIGNIS);
  assert.equal(arten.length, 3);
  assert.equal(new Set(arten).size, arten.length);
  assert.ok(arten.every((art) => typeof art === "string" && art.length > 0));
});

const oeffentlicheRoute = (method, path) => PUBLIC_ROUTES.find((route) => route.method === method && route.path === path);

test("3365-K12: die Oeffentlich-Liste begruendet den Abruf der Audio-Datei mit Token, Einmalabruf und Vorspann-Freigabe", () => {
  assert.equal(
    oeffentlicheRoute("GET", "/voice/tts/:token").reason,
    "HANDLER-INTERNE AUTH (Runbook-Fall 1): Token mit TTL, im Handler per takeOnce verbraucht (Vorspann-Token bleiben bis zur Freigabe oder TTL abrufbar). Liegt bewusst VOR der Signatur-Middleware, weil der Provider das Audio ohne Signatur abholt.",
  );
});

test("3365-K11: die Vorspann-Ereignisroute steht mit derselben Signatur-Begruendung in der Oeffentlich-Liste wie die EL-Bein-Route", () => {
  const vorspannRoute = oeffentlicheRoute("POST", "/voice/vorspann");
  assert.deepEqual(vorspannRoute, { method: "POST", path: "/voice/vorspann", reason: oeffentlicheRoute("POST", "/voice/el-bein").reason });
  assert.ok(vorspannRoute.reason.length > 0);
});
