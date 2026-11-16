import assert from "node:assert/strict";
import { test } from "node:test";

import { VOICE_ENGINE } from "../../src/config.js";
import { cappedEndedAtMs, classifyCallTime } from "../../src/store/state-ops.js";
import { makeAniOwnershipRecheck } from "../../src/telephony/ani-ownership-recheck.js";
import { makeAntwortdauerMiddleware } from "../../src/telephony/antwortdauer.ts";
import { billThunk, hangUpAction, terminateAndBillCall } from "../../src/telephony/call-termination.ts";
import { CAP_FAILURE_REASON, makeCallLifecycle } from "../../src/telephony/call-lifecycle.ts";
import { reattachActiveCall } from "../../src/telephony/reattach.ts";
import { makeWebhookIdempotenz } from "../../src/telephony/webhook-idempotenz.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import konfiguration from "../../eslint.config.js";

const JETZT_MS = 1_800_000_000_000;
const SEKUNDE_MS = 1_000;
const RESERVE_GNADE_MS = 7_000;
const bestand = konfiguration.find((block) => block.name === "uhr-als-wert").ignores;

for (const datei of ["ani-ownership-recheck.js", "antwortdauer.ts", "call-lifecycle.ts", "reattach.ts", "webhook-idempotenz.ts"]) {
  test(`uhr-telephony: ${datei} steht nicht mehr im Uhr-Bestand`, () => {
    assert.ok(!bestand.includes(`src/telephony/${datei}`));
  });
}

test("uhr-telephony: die Antwortdauer ist der Abstand der gereichten Uhr", () => {
  const werte = [JETZT_MS, JETZT_MS + 250];
  const zeilen = [];
  const log = console.log;
  console.log = (...teile) => zeilen.push(teile.join(" "));
  try {
    const schliessen = [];
    const res = { locals: { kennung: "k1" }, writableFinished: true, statusCode: 200, on: (_ereignis, fn) => schliessen.push(fn) };
    let weiter = 0;
    makeAntwortdauerMiddleware(() => werte.shift())({ route: { path: "/voice/x" } }, res, () => {
      weiter += 1;
    });
    assert.equal(res.locals.eingangMs, JETZT_MS);
    schliessen[0]();
    assert.equal(weiter, 1);
  } finally {
    console.log = log;
  }
  assert.deepEqual(zeilen, ["[voice-antwort] weg=/voice/x ms=250 status=200 ende=beendet"]);
});

test("uhr-telephony: die ANI-Nachmessung setzt die Frist ueber den gereichten Zeitgeber und raeumt ihn bei Antwort ab", async () => {
  const gesetzt = [];
  const geraeumt = [];
  const recheck = makeAniOwnershipRecheck({
    telnyxRead: { findPhoneNumber: async () => ({ treffer: [] }) },
    timeoutMs: 1234,
    setTimer: (fn, ms) => {
      gesetzt.push(ms);
      return "handle-1";
    },
    clearTimer: (handle) => geraeumt.push(handle),
  });
  assert.equal(await recheck("+4915100000000"), true);
  assert.deepEqual(gesetzt, [1234]);
  assert.deepEqual(geraeumt, ["handle-1"]);
});

test("uhr-telephony: feuert die gereichte Frist der ANI-Nachmessung, wirft sie TimeoutError", async () => {
  let feuern;
  const recheck = makeAniOwnershipRecheck({
    telnyxRead: { findPhoneNumber: () => new Promise(() => undefined) },
    setTimer: (fn) => {
      feuern = fn;
      return 1;
    },
    clearTimer: () => undefined,
  });
  const ergebnis = recheck("+4915100000000");
  feuern();
  await assert.rejects(ergebnis, { name: "TimeoutError" });
});

function aktiverAnruf(vorSekunden) {
  return {
    id: "uhr_c1",
    twilioSid: "CA_uhr_c1",
    status: "active",
    answeredAt: new Date(JETZT_MS - vorSekunden * SEKUNDE_MS).toISOString(),
    startedAt: null,
    maxDurationS: 60,
  };
}

function reattachDeps(call, now) {
  const geplant = [];
  const beendet = [];
  return {
    geplant,
    beendet,
    deps: {
      attachActiveCall: async () => call,
      maxCallDurationS: 180,
      terminateCappedCall: async (callId, sid, status) => beendet.push([callId, sid, status]),
      scheduleMaxDurationEnd: (_call, sid, ms) => geplant.push([sid, ms]),
      budgetAxisFor: () => false,
      terminateOverBudgetCall: async () => undefined,
      now,
    },
  };
}

test("uhr-telephony: Wiederanbindung plant die Restdauer nach der gereichten Uhr", async () => {
  const { deps, geplant, beendet } = reattachDeps(aktiverAnruf(10), () => JETZT_MS);
  const ergebnis = await reattachActiveCall("uhr_c1", deps);
  assert.equal(ergebnis.call.id, "uhr_c1");
  assert.deepEqual(geplant, [["CA_uhr_c1", 50_000]]);
  assert.deepEqual(beendet, []);
});

test("uhr-telephony: Wiederanbindung beendet einen Anruf, dessen Dauer nach der gereichten Uhr genau abgelaufen ist", async () => {
  const { deps, geplant, beendet } = reattachDeps(aktiverAnruf(0), () => JETZT_MS + 60 * SEKUNDE_MS);
  const ergebnis = await reattachActiveCall("uhr_c2", deps);
  assert.equal(ergebnis.call, null);
  assert.deepEqual(beendet, [["uhr_c1", "CA_uhr_c1", "failed"]]);
  assert.deepEqual(geplant, []);
});

function lifecycleMit({ anruf, now, setTimer }) {
  const call = { ...anruf };
  const reihenfolge = [];
  let abgerechnet;
  const fertig = new Promise((resolve) => {
    abgerechnet = resolve;
  });
  const lifecycle = makeCallLifecycle({
    store: {
      load: () => ({ calls: [call] }),
      getCall: (id) => (id === call.id ? call : null),
      setCallEndedAt: (_id, status, endedAtIso) => {
        call.status = status;
        call.endedAt = endedAtIso;
      },
      recordFailureReason: (_id, grund) => {
        call.failureReason = grund;
      },
    },
    config: withConfigNamespaces({ voiceEngine: VOICE_ENGINE.BUDGET, reserveReleaseGraceMs: RESERVE_GNADE_MS }),
    finishCall: () => abgerechnet(),
    releaseReserve: (angerufen) => reihenfolge.push(["frei", angerufen.id]),
    voiceControl: () => ({ endCall: async () => undefined }),
    terminateAndBillCall,
    hangUpAction,
    billThunk,
    reattachActiveCallCore: () => ({ call: null, logUnknown: false }),
    cappedEndedAtMs,
    classifyCallTime,
    now,
    setTimer,
  });
  return { lifecycle, fertig, reihenfolge, call };
}

function lebenderAnruf(vorSekunden) {
  return { ...aktiverAnruf(vorSekunden), provider: "telnyx" };
}

test("uhr-telephony: Neustart plant die Rest-Maximaldauer ueber den gereichten Zeitgeber nach der gereichten Uhr", () => {
  const gesetzt = [];
  const { lifecycle } = lifecycleMit({
    anruf: lebenderAnruf(10),
    now: () => JETZT_MS,
    setTimer: (fn, ms) => gesetzt.push(ms),
  });
  lifecycle.rearmActiveCallTimers();
  assert.deepEqual(gesetzt, [50_000]);
});

test("uhr-telephony: Neustart beendet einen Zombie-Anruf mit Ende am Deckel statt an der gereichten Uhr", async () => {
  const gesetzt = [];
  const { lifecycle, fertig, call } = lifecycleMit({ anruf: lebenderAnruf(90), now: () => JETZT_MS, setTimer: (fn, ms) => gesetzt.push(ms) });
  lifecycle.rearmActiveCallTimers();
  await fertig;
  assert.deepEqual(gesetzt, []);
  assert.equal(call.status, "failed");
  assert.equal(call.failureReason, CAP_FAILURE_REASON);
  assert.equal(call.endedAt, new Date(JETZT_MS - 30 * SEKUNDE_MS).toISOString());
});

test("uhr-telephony: Maximaldauer-Timer endet den Anruf zur gereichten Uhr und die Reserve-Freigabe folgt nach Frist plus Gnade", async () => {
  const zeitgeber = [];
  const { lifecycle, fertig, reihenfolge, call } = lifecycleMit({
    anruf: lebenderAnruf(30),
    now: () => JETZT_MS,
    setTimer: (fn, ms) => zeitgeber.push({ fn, ms }),
  });
  lifecycle.armReserveReleaseTimer(call);
  lifecycle.armMaxDurationTimer(call, "CA_uhr_c1");
  const [reserve, dauer] = zeitgeber;
  assert.equal(dauer.ms + RESERVE_GNADE_MS, reserve.ms);
  dauer.fn();
  await fertig;
  assert.equal(call.status, "completed");
  assert.equal(call.endedAt, new Date(JETZT_MS).toISOString());
  reserve.fn();
  assert.deepEqual(reihenfolge, [["frei", "uhr_c1"]]);
});

const FREMDE_ANNAHME = { eigen: false, kennung: "k1", alterMs: 1_000 };

function ablageMit() {
  const protokoll = { lesen: 0 };
  const ablage = {
    annehmen: async () => FREMDE_ANNAHME,
    lies: async () => {
      protokoll.lesen += 1;
      return { offen: true };
    },
    uebernehmen: async () => ({ eigen: true, kennung: "k1" }),
    freigeben: async () => undefined,
    beantworten: async () => undefined,
  };
  return { ablage, protokoll };
}

test("uhr-telephony: das Warten auf eine fremde Antwort endet nach den Takten bis zur gereichten Frist", async () => {
  const { ablage, protokoll } = ablageMit();
  const pausen = [];
  let jetzt = JETZT_MS;
  const zeilen = [];
  const log = console.log;
  console.log = (...teile) => zeilen.push(teile.join(" "));
  try {
    const { forTurn } = makeWebhookIdempotenz({
      store: { webhookZustellung: ablage, getCall: () => null, recordWebhookAnchors: () => undefined },
      keepAliveXml: () => "<Response/>",
      elPasswort: "x",
      now: () => jetzt,
      pause: async (ms) => {
        pausen.push(ms);
        jetzt += ms;
      },
    });
    const res = { statusCode: 200, get: () => "text/xml", send: (body) => body, on: () => undefined };
    let weiter = 0;
    await forTurn({ headers: {}, query: { turnToken: "tok1" }, rawBody: "" }, res, () => {
      weiter += 1;
    });
    assert.equal(weiter, 1);
  } finally {
    console.log = log;
  }
  assert.equal(protokoll.lesen, 70);
  assert.equal(pausen.length, 69);
  assert.ok(pausen.every((ms) => ms === 200));
  assert.ok(zeilen.includes("[webhook-idempotenz] wiederholte_zustellung weg=turn art=uebernommen warte_ms=13800"));
});
