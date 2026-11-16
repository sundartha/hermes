import { test, mock } from "node:test";
import assert from "node:assert/strict";

import { voiceMinutesOf } from "../../src/billing/metering.js";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { makeElevenLabsOutbound } from "../../src/elevenlabs/outbound.js";
import { mapStatus } from "../../src/mcp/anruf-ergebnis.js";
import * as ops from "../../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { terminateAndBillCall } from "../../src/telephony/call-termination.ts";
import { MS_PER_SECOND } from "../../src/utils/timer.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { echtWarten } from "../echt-warten.js";
import { storeOpsFacade, waitUntil, withFetch } from "../helpers.js";

const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test" };
const HTTP_OK = 200;
const FRIST_S = 75;
const JETZT_MS = Date.parse("2026-11-16T10:00:00.000Z");
const FRIST_MS = FRIST_S * MS_PER_SECOND;
const BEOBACHTUNG_MS = 60;

function seedAktivenAnruf({
  alterMs,
  costProfile = KOSTENPROFIL.EL_CONVAI_SIP,
  richtung = "outbound",
}) {
  const state = ops.makeDefaultState();
  const call = ops.createCall(state, {
    direction: richtung,
    from: "+491700000000",
    to: "+491701111111",
    goal: "Termin vereinbaren",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  call.costProfile = costProfile;
  call.elevenlabsConversationId = "conv_4755";
  const start = new Date(JETZT_MS - alterMs).toISOString();
  call.startedAt = start;
  call.answeredAt = start;
  return { call, store: storeOpsFacade(state) };
}

const laufendesGespraech = (zusatz = {}) => ({
  conversation_id: "conv_4755",
  status: "in-progress",
  transcript: [],
  metadata: { call_duration_secs: 0 },
  ...zusatz,
});

async function pollen({ alterMs, gespraech, costProfile, vorher }) {
  const uhr = mock.method(Date, "now", () => JETZT_MS);
  const { call, store } = seedAktivenAnruf({ alterMs, costProfile });
  vorher?.(call, store);
  const abrechnungen = [];
  const loeschungen = [];
  let abschliessen = false;
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: ACCOUNT }),
    terminateAndBillCall,
    billThunk: () => () => abrechnungen.push(call.id),
    finishCall: () => {},
  });
  const antwort = () => (abschliessen ? { ...gespraech, status: "done" } : gespraech);
  let schnappschuss;
  try {
    await withFetch(
      async (url, init) => {
        if (init.method === "DELETE") {
          loeschungen.push(url);
          return { ok: true, status: HTTP_OK };
        }
        return { ok: true, status: HTTP_OK, json: async () => antwort() };
      },
      async () => {
        el.rearmActiveConversationPolls();
        await echtWarten(BEOBACHTUNG_MS);
        schnappschuss = {
          status: mapStatus(call),
          failureReason: call.failureReason ?? null,
          answeredAt: call.answeredAt,
          unklarerGrund: call.answeredUnclearReason ?? null,
          minuten: voiceMinutesOf(call),
          abrechnungen: abrechnungen.length,
          loeschungen: loeschungen.length,
        };
        abschliessen = true;
        await waitUntil(() => call.status !== "active");
      },
    );
  } finally {
    uhr.mock.restore();
  }
  return schnappschuss;
}

test("4755 K1: 75 s ohne Annahme -> failed mit no-answer, ohne Abbruch durch den Nutzer, 0 Minuten, einmal abgerechnet, Gespraech beim Anbieter beendet", async () => {
  const ergebnis = await pollen({ alterMs: FRIST_MS, gespraech: laufendesGespraech() });

  assert.deepEqual(ergebnis, {
    status: "failed",
    failureReason: "no-answer",
    answeredAt: null,
    unklarerGrund: "call_duration_secs_zero_not_answered",
    minuten: 0,
    abrechnungen: 1,
    loeschungen: 1,
  });
});

test("4755 K1: eine Millisekunde unter 75 s ist noch innerhalb der Frist, der Anruf bleibt aktiv", async () => {
  const ergebnis = await pollen({ alterMs: FRIST_MS - 1, gespraech: laufendesGespraech() });

  assert.equal(ergebnis.status, "in_progress");
  assert.equal(ergebnis.failureReason, null);
  assert.equal(ergebnis.abrechnungen, 0);
  assert.equal(ergebnis.loeschungen, 0);
});

test("4755 K5: gesprochene Zeilen oder Anbieter-Dauer belegen die Annahme, die Frist beendet nicht", async () => {
  const mitZeile = laufendesGespraech({ transcript: [{ role: "agent", message: "Guten Tag" }] });
  const mitDauer = laufendesGespraech({ metadata: { call_duration_secs: 12 } });
  for (const gespraech of [mitZeile, mitDauer]) {
    const ergebnis = await pollen({ alterMs: FRIST_MS * 2, gespraech });

    assert.equal(ergebnis.status, "in_progress");
    assert.equal(ergebnis.abrechnungen, 0);
    assert.notEqual(ergebnis.answeredAt, null);
  }
});

test("4755 K2: ein schon beendeter Anruf (besetzt) wird von der Frist nicht erneut beendet oder abgerechnet", async () => {
  const ergebnis = await pollen({
    alterMs: FRIST_MS * 2,
    gespraech: laufendesGespraech(),
    vorher: (call, store) => {
      store.recordFailureReason(call.id, "busy");
      store.endCallRecord(call.id, "failed");
    },
  });

  assert.equal(ergebnis.status, "failed");
  assert.equal(ergebnis.failureReason, "busy");
  assert.equal(ergebnis.abrechnungen, 0);
  assert.equal(ergebnis.loeschungen, 0);
});

test("4755: nur der EL-Weg wird von der Frist beendet, ein Telnyx-Anruf mit gleichem Alter nicht", async () => {
  const ergebnis = await pollen({
    alterMs: FRIST_MS * 2,
    gespraech: laufendesGespraech(),
    costProfile: KOSTENPROFIL.TELNYX_BUDGET,
  });

  assert.equal(ergebnis.status, "in_progress");
  assert.equal(ergebnis.abrechnungen, 0);
});

test("4755: Zeilen ohne Text zaehlen nicht als Annahme", async () => {
  const gespraech = laufendesGespraech({ transcript: [{ role: "agent", message: "" }, null] });
  const ergebnis = await pollen({ alterMs: FRIST_MS, gespraech });

  assert.equal(ergebnis.failureReason, "no-answer");
});

test("4755: ohne bekannten Startzeitpunkt beendet die Frist nicht", async () => {
  const ergebnis = await pollen({
    alterMs: FRIST_MS * 2,
    gespraech: laufendesGespraech(),
    vorher: (call) => {
      call.startedAt = null;
    },
  });

  assert.equal(ergebnis.status, "in_progress");
  assert.equal(ergebnis.abrechnungen, 0);
});
