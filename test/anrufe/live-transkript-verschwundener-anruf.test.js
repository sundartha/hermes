import assert from "node:assert/strict";
import { test } from "node:test";

import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { makeElevenLabsOutbound } from "../../src/elevenlabs/outbound.js";
import * as ops from "../../src/store/state-ops.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { storeOpsFacade, waitUntil, withFetch } from "../helpers.js";

const HTTP_OK = 200;
const CONV_ID = "conv_verschwunden";
const ACCOUNT = { apiKey: "test-key", apiBase: "https://el.test", resultPollMs: 1 };
const GESPRAECH = {
  conversation_id: CONV_ID,
  status: "in-progress",
  transcript: [{ role: "agent", message: "Guten Tag." }],
  analysis: null,
  metadata: { call_duration_secs: 3 },
};

test("live-transkript-verschwundener-anruf: verschwindet der Anruf während des Abrufs, bleibt der Takt ohne Fehler und schreibt nichts", async () => {
  const state = ops.makeDefaultState();
  const call = ops.createCall(state, {
    direction: "outbound",
    from: "+491700000000",
    to: "+491701111111",
    goal: "Termin vereinbaren",
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  call.elevenlabsConversationId = CONV_ID;
  call.answeredAt = new Date().toISOString();
  call.startedAt = call.answeredAt;
  const fassade = storeOpsFacade(state);
  let verschwunden = false;
  let abfragenDanach = 0;
  const store = {
    ...fassade,
    getCall: (id) => {
      if (verschwunden) abfragenDanach++;
      return fassade.getCall(id);
    },
  };
  const abgelehnt = [];
  const merke = (grund) => abgelehnt.push(grund);
  process.on("unhandledRejection", merke);
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: ACCOUNT }),
    terminateAndBillCall: () => {},
    billThunk: () => () => {},
    finishCall: () => {},
  });
  try {
    await withFetch(
      async (_url, init) => {
        if (init.method !== "GET") return { ok: true, status: HTTP_OK };
        state.calls = state.calls.filter((eintrag) => eintrag.id !== call.id);
        verschwunden = true;
        return { ok: true, status: HTTP_OK, json: async () => GESPRAECH };
      },
      async () => {
        el.rearmActiveConversationPolls();
        await waitUntil(() => abgelehnt.length > 0 || abfragenDanach >= 2);
      },
    );
  } finally {
    process.off("unhandledRejection", merke);
  }
  assert.deepEqual(abgelehnt, []);
  assert.equal(state.calls.length, 0);
});
