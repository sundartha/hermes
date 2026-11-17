import assert from "node:assert/strict";
import { test } from "node:test";
import { POLL_MS, baueElMitStore } from "../_iel-inbound-harness.js";
import { withFetch } from "../helpers.js";

const JETZT_MS = Date.parse("2031-03-04T05:06:07.000Z");
const UEBERNAHME_MS = 30_000;
const ABRUF_FRIST_MS = 120_000;
const ANRUF = "call_abfrage_neustart";
const MANDANT = "tenant_abfrage_neustart";

const abwarten = () => new Promise((erfuellen) => setImmediate(erfuellen));
const laeuft = () => ({
  ok: true,
  status: 200,
  json: async () => ({ status: "in-progress", transcript: [], metadata: { call_duration_secs: 0 } }),
});

function betrieb() {
  const jetzt = new Date(JETZT_MS).toISOString();
  const call = {
    id: ANRUF,
    tenantId: MANDANT,
    status: "active",
    elevenlabsConversationId: "conv_abfrage_neustart",
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
    setzeAbfrageFrist: async (frist) => {
      geschrieben.push(frist);
    },
  };
  return { el: baueElMitStore(store), geschrieben };
}

const frist = (inMs) => ({ callId: ANRUF, tenantId: MANDANT, faelligAt: new Date(JETZT_MS + inMs).toISOString() });

test("Abfrage-Frist beim Neustart: die wieder aufgenommene erste Abfrage schreibt wie jede Abfrage vor dem Abruf eine Frist und danach die Frist fuer das Intervall", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: JETZT_MS });
  const { el, geschrieben } = betrieb();
  await withFetch(async () => laeuft(), async () => {
    await el.rearmActiveConversationPolls();
    await abwarten();
    await abwarten();
    assert.deepEqual(geschrieben, [frist(ABRUF_FRIST_MS + UEBERNAHME_MS), frist(ABRUF_FRIST_MS + UEBERNAHME_MS), frist(POLL_MS + UEBERNAHME_MS)]);
    t.mock.timers.tick(POLL_MS);
    await abwarten();
    await abwarten();
  });
  assert.deepEqual(geschrieben.slice(3), [frist(POLL_MS + ABRUF_FRIST_MS + UEBERNAHME_MS), frist(POLL_MS + POLL_MS + UEBERNAHME_MS)]);
});
