import assert from "node:assert/strict";
import { test } from "node:test";
import { POLL_MS, baueElMitStore } from "../_iel-inbound-harness.js";
import { withFetch } from "../helpers.js";
import { CONVERSATION_DONE_WITH_ANALYSIS } from "../fixtures/elevenlabs-conversations.js";

const UEBERNAHME_MS = 30_000;
const JETZT_MS = Date.parse("2031-03-04T05:06:07.000Z");
const ANRUF = "call_abfrage_schreiben";
const MANDANT = "tenant_abfrage_schreiben";

const laeuft = () => ({
  ok: true,
  status: 200,
  json: async () => ({ status: "in-progress", transcript: [], metadata: { call_duration_secs: 0 } }),
});
const fertig = () => ({ ok: true, status: 200, json: async () => CONVERSATION_DONE_WITH_ANALYSIS });

function betrieb({ schreibenScheitert = false } = {}) {
  const jetzt = new Date(JETZT_MS).toISOString();
  const call = {
    id: ANRUF,
    tenantId: MANDANT,
    status: "active",
    elevenlabsConversationId: "conv_abfrage_schreiben",
    answeredAt: jetzt,
    startedAt: jetzt,
    endedAt: null,
  };
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
    setzeAbfrageFrist: async (frist) => {
      if (schreibenScheitert) throw new Error("schreiben verweigert");
      geschrieben.push(frist);
    },
  };
  const el = baueElMitStore(store);
  return { call, geschrieben, el, store };
}

const abwarten = () => new Promise((erfuellen) => setImmediate(erfuellen));

async function mitFristZeilen(t, body) {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  await body();
  return zeilen.filter((zeile) => zeile.startsWith("[fristen]"));
}

test("Abfrage-Frist schreiben: nach einer Abfrage ohne Ergebnis steht die naechste Frist auf Intervall plus Uebernahmezeit, und sie wird nicht geleert", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const { geschrieben, el } = betrieb();
  await withFetch(async () => laeuft(), async () => {
    await el.pollFrist(ANRUF, MANDANT);
    await abwarten();
  });
  assert.deepEqual(geschrieben, [
    { callId: ANRUF, tenantId: MANDANT, faelligAt: new Date(JETZT_MS + POLL_MS + UEBERNAHME_MS).toISOString() },
  ]);
});

test("Abfrage-Frist schreiben: nach dem Ergebnis des Anbieters wird die Frist geleert", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const { call, geschrieben, el } = betrieb();
  await withFetch(async () => fertig(), async () => {
    await el.pollFrist(ANRUF, MANDANT);
    await abwarten();
  });
  assert.notEqual(call.status, "active");
  assert.deepEqual(geschrieben, [{ callId: ANRUF, tenantId: MANDANT, faelligAt: null }]);
});

test("Abfrage-Frist schreiben: scheitert das Schreiben, steht der Fehler mit Anruf-Kennung im Log und die Abfrage laeuft nach dem Intervall weiter", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const { el } = betrieb({ schreibenScheitert: true });
  let abfragen = 0;
  const zeilen = await mitFristZeilen(t, async () => {
    await withFetch(async () => {
      abfragen += 1;
      return laeuft();
    }, async () => {
      await el.pollFrist(ANRUF, MANDANT);
      await abwarten();
      t.mock.timers.tick(POLL_MS);
      await abwarten();
    });
  });
  assert.equal(abfragen, 2);
  assert.deepEqual(zeilen, [
    `[fristen] Abfrage-Frist schreiben fehlgeschlagen: ${ANRUF} Error: schreiben verweigert`,
    `[fristen] Abfrage-Frist schreiben fehlgeschlagen: ${ANRUF} Error: schreiben verweigert`,
  ]);
});

test("Abfrage-Frist: ein Anruf ohne Gespraechskennung wird nicht abgefragt, seine Frist wird geleert", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const { call, geschrieben, el } = betrieb();
  call.elevenlabsConversationId = undefined;
  let abfragen = 0;
  await withFetch(async () => {
    abfragen += 1;
    return laeuft();
  }, async () => {
    await el.pollFrist(ANRUF, MANDANT);
    await abwarten();
  });
  assert.equal(abfragen, 0);
  assert.deepEqual(geschrieben, [{ callId: ANRUF, tenantId: MANDANT, faelligAt: null }]);
});

test("Abfrage-Frist: die Abfrage liest den Anruf ohne ihn an diesen Prozess zu binden", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const { call, el, store } = betrieb();
  const gelesen = { gebunden: 0, ungebunden: 0 };
  store.leseCall = async () => {
    gelesen.gebunden += 1;
    return call;
  };
  store.leseCallUngebunden = async () => {
    gelesen.ungebunden += 1;
    return call;
  };
  await withFetch(async () => laeuft(), async () => {
    await el.pollFrist(ANRUF, MANDANT);
    await abwarten();
  });
  assert.equal(gelesen.ungebunden, 2);
});
