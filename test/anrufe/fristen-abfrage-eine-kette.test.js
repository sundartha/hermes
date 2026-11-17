import assert from "node:assert/strict";
import { test } from "node:test";
import { makeFristenLauf } from "../../src/telephony/fristen-lauf.ts";
import { makeElevenLabsOutbound } from "../../src/elevenlabs/outbound.js";
import { POLL_MS, baueElMitStore } from "../_iel-inbound-harness.js";
import { pinConfig, pinCall, pinStore } from "../helpers/elevenlabs-anrufstart-attrappe.mjs";
import { withFetch } from "../helpers.js";
import { CONVERSATION_DONE_WITH_ANALYSIS } from "../fixtures/elevenlabs-conversations.js";

const TAKT_MS = 15_000;
const UEBERNAHME_MS = 30_000;
const ABRUF_FRIST_MS = 120_000;
const JETZT_MS = Date.parse("2031-03-04T05:06:07.000Z");
const ANRUF = "call_eine_kette";
const MANDANT = "tenant_eine_kette";
const INTERVALLE = 3;

const abwarten = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise((erfuellen) => setImmediate(erfuellen));
};
const laeuft = () => ({
  ok: true,
  status: 200,
  json: async () => ({ status: "in-progress", transcript: [], metadata: { call_duration_secs: 0 } }),
});
const fertig = () => ({ ok: true, status: 200, json: async () => CONVERSATION_DONE_WITH_ANALYSIS });

function speicher({ faelligMs }) {
  const jetzt = new Date(JETZT_MS).toISOString();
  const call = {
    id: ANRUF,
    tenantId: MANDANT,
    status: "active",
    elevenlabsConversationId: "conv_eine_kette",
    answeredAt: jetzt,
    startedAt: jetzt,
    endedAt: null,
  };
  const zeile = { faelligMs, leaseBisMs: 0 };
  const geschrieben = [];
  const store = {
    getCall: () => call,
    leseCall: async () => call,
    load: () => ({ calls: [call] }),
    addTranscript: () => {},
    recordProviderCallResult: () => {},
    recordProviderCollectedFields: () => {},
    recordCalleeConfirmedTimezone: () => {},
    recordSipCallId: () => {},
    recordElDetectorCounts: () => {},
    recordFromRegistrationSource: () => {},
    recordActualSender: () => {},
    trueUpAnsweredAt: () => {},
    recordAnsweredUnclearReason: () => {},
    recordFailureReason: () => {},
    setCallEndedAt: (_id, status, endedAtIso) => {
      call.status = status;
      call.endedAt = endedAtIso;
      return { endedAt: endedAtIso };
    },
    endCallRecord: (_id, status) => {
      call.status = status;
      return { endedAt: new Date(JETZT_MS).toISOString() };
    },
    faelligeFristen: async ({ art, leaseMs }) => {
      const jetztMs = Date.now();
      if (art !== "abfrage" || zeile.faelligMs === null || zeile.faelligMs > jetztMs || zeile.leaseBisMs > jetztMs) return [];
      zeile.leaseBisMs = jetztMs + leaseMs;
      return [{ callId: ANRUF, tenantId: MANDANT, faelligAt: new Date(zeile.faelligMs).toISOString(), versuche: 1 }];
    },
    setzeAbfrageFrist: async (frist) => {
      geschrieben.push(frist);
      zeile.faelligMs = frist.faelligAt === null ? null : Date.parse(frist.faelligAt);
    },
  };
  return { store, call, zeile, geschrieben };
}

const prozess = (store) => {
  const el = baueElMitStore(store);
  const lauf = makeFristenLauf({ store, beende: async () => {}, limitJeMandant: 5, leaseMs: TAKT_MS, abfrage: { poll: el.pollFrist } });
  return { el, lauf };
};

function zaehlendeAbfrage({ haengtAb = 0 } = {}) {
  const stand = { abrufe: 0, gleichzeitig: 0, hoechstens: 0, freigeben: [] };
  const antwort = async () => {
    stand.abrufe += 1;
    stand.gleichzeitig += 1;
    stand.hoechstens = Math.max(stand.hoechstens, stand.gleichzeitig);
    if (stand.abrufe === haengtAb) await new Promise((weiter) => stand.freigeben.push(weiter));
    stand.gleichzeitig -= 1;
    return laeuft();
  };
  return { stand, antwort };
}

test("Eine Abfrage-Kette: nach dem Neustart mit schon faelliger Frist und laufendem Fristenlauf fragt nur eine Kette je Intervall ab", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const { store } = speicher({ faelligMs: JETZT_MS - 60_000 });
  const { stand, antwort } = zaehlendeAbfrage();
  const { el, lauf } = prozess(store);
  await withFetch(antwort, async () => {
    await el.rearmActiveConversationPolls();
    await abwarten();
    for (let intervall = 0; intervall < INTERVALLE; intervall += 1) {
      await lauf.abfrageTakt();
      t.mock.timers.tick(POLL_MS);
      await abwarten();
    }
  });
  assert.equal(stand.abrufe, INTERVALLE + 1);
});

test("Eine Abfrage-Kette: haengt der erste Abruf nach dem Neustart laenger als die Uebernahmezeit, laeuft hoechstens ein Abruf", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const { store } = speicher({ faelligMs: JETZT_MS - 60_000 });
  const { stand, antwort } = zaehlendeAbfrage({ haengtAb: 1 });
  const { el, lauf } = prozess(store);
  await withFetch(antwort, async () => {
    await el.rearmActiveConversationPolls();
    await abwarten();
    for (let schritt = 0; schritt < 3; schritt += 1) {
      await lauf.abfrageTakt();
      t.mock.timers.tick(UEBERNAHME_MS / 2 + 1);
      await abwarten();
    }
    for (const weiter of stand.freigeben) weiter();
    await abwarten();
  });
  assert.equal(stand.abrufe, 1);
  assert.equal(stand.hoechstens, 1);
});

test("Eine Abfrage-Kette: stirbt der Prozess nach dem Anrufstart vor der ersten Abfrage, uebernimmt der Fristenlauf eines anderen Prozesses", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const { store, call, zeile } = speicher({ faelligMs: null });
  Object.assign(call, { ...pinCall(), id: ANRUF, elevenlabsConversationId: undefined });
  store.recordElevenlabsConversationId = (_id, kennung) => {
    call.elevenlabsConversationId = kennung;
  };
  store.markAnswered = async () => {};
  const schreibeSofort = store.setzeAbfrageFrist;
  store.setzeAbfrageFrist = async (frist) => {
    await new Promise((erfuellen) => setImmediate(erfuellen));
    await schreibeSofort(frist);
  };
  const grundlage = pinStore();
  const erster = makeElevenLabsOutbound({
    store: { ...grundlage, ...store, load: () => ({ ...grundlage.load(), calls: [call] }) },
    config: pinConfig(),
    terminateAndBillCall: async () => {},
    billThunk: () => async () => {},
    finishCall: async () => {},
  });
  const abrufe = [];
  await withFetch(
    async (url, init) => {
      if (init?.method === "POST") return { ok: true, json: async () => ({ conversation_id: "conv_eine_kette" }) };
      abrufe.push(String(url));
      return laeuft();
    },
    async () => {
      await erster.originateCall(call);
      assert.equal(abrufe.length, 0);
      assert.ok(zeile.faelligMs > JETZT_MS);
      t.mock.timers.setTime(zeile.faelligMs + 1);
      const { lauf } = prozess(store);
      await lauf.abfrageTakt();
      await abwarten();
    },
  );
  assert.equal(abrufe.length, 1);
});

test("Eine Abfrage-Kette: die wieder aufgenommene Abfrage kennt den Mandanten des Anrufs und schreibt ihn in die geleerte Frist", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const { store, geschrieben } = speicher({ faelligMs: null });
  const { el } = prozess(store);
  await withFetch(async () => fertig(), async () => {
    await el.rearmActiveConversationPolls();
    await abwarten();
  });
  assert.deepEqual(geschrieben.at(-1), { callId: ANRUF, tenantId: MANDANT, faelligAt: null });
});

test("Eine Abfrage-Kette: der Nachlauf nach dem Beanspruchen kennt den Mandanten des Anrufs und schreibt ihn in die geleerte Frist", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const { store, call, geschrieben } = speicher({ faelligMs: null });
  store.beanspruecheInboundElNachlauf = async () => ({ call, changed: true });
  const { el } = prozess(store);
  await withFetch(async () => fertig(), async () => {
    await el.startInboundNachlauf(ANRUF);
    await abwarten();
  });
  assert.deepEqual(geschrieben.at(-1), { callId: ANRUF, tenantId: MANDANT, faelligAt: null });
});

test("Eine Abfrage-Kette: die Frist steht vor dem ersten Abruf des Neustarts und vor dem ersten Abruf des Nachlaufs auf Abruffrist plus Uebernahmezeit", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const erwartet = { callId: ANRUF, tenantId: MANDANT, faelligAt: new Date(JETZT_MS + ABRUF_FRIST_MS + UEBERNAHME_MS).toISOString() };
  const neustart = speicher({ faelligMs: null });
  const nachlauf = speicher({ faelligMs: null });
  nachlauf.store.beanspruecheInboundElNachlauf = async () => ({ call: nachlauf.call, changed: true });
  const gesehen = { neustart: null, nachlauf: null };
  const el1 = prozess(neustart.store).el;
  const el2 = prozess(nachlauf.store).el;
  await withFetch(async () => {
    gesehen.neustart ??= neustart.geschrieben[0];
    gesehen.nachlauf ??= nachlauf.geschrieben[0];
    return laeuft();
  }, async () => {
    await el1.rearmActiveConversationPolls();
    await el2.startInboundNachlauf(ANRUF);
    await abwarten();
  });
  assert.deepEqual(gesehen.neustart, erwartet);
  assert.deepEqual(gesehen.nachlauf, erwartet);
});
