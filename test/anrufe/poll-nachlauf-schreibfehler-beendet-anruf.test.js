import { test } from "node:test";
import assert from "node:assert/strict";

import { makeElevenLabsOutbound } from "../../src/elevenlabs/outbound.js";
import * as ops from "../../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { billThunk, terminateAndBillCall } from "../../src/telephony/call-termination.ts";
import { MS_PER_SECOND } from "../../src/utils/timer.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { CONVERSATION_DONE_WITH_ANALYSIS } from "../fixtures/elevenlabs-conversations.js";
import { storeOpsFacade, waitUntil, withFetch } from "../helpers.js";
import { fehlerausgabeVonAsync } from "../gemeinsam/fehlerausgabe.js";

const HTTP_OK = 200;
const LAUFZEIT_S = 60;

test("Schreibfehler beim Sichern des Anbieter-Ergebnisses im Nachlauf: Fehler wird gemeldet, Anrufende, Abrechnung und Leitungsplatz-Freigabe laufen trotzdem", async () => {
  const state = ops.makeDefaultState();
  const call = ops.createCall(state, { direction: "outbound", from: "+491700000000", to: "+491701111111", goal: "Termin", tenantId: BOOTSTRAP_TENANT_ID });
  const anker = new Date(Date.now() - LAUFZEIT_S * MS_PER_SECOND).toISOString();
  Object.assign(call, { elevenlabsConversationId: CONVERSATION_DONE_WITH_ANALYSIS.conversation_id, startedAt: anker, answeredAt: anker });
  const freigegeben = [];
  const store = {
    ...storeOpsFacade(state),
    recordProviderCallResult: () => {
      throw new Error("db weg 5113");
    },
    leitungsplaetze: { freigeben: (id) => freigegeben.push(id) },
  };
  let abgerechnet = false;
  const el = makeElevenLabsOutbound({
    store,
    config: withConfigNamespaces({ elevenLabsOutbound: { apiKey: "test-key", apiBase: "https://el.test" } }),
    terminateAndBillCall,
    billThunk: () => () => {
      abgerechnet = true;
    },
    finishCall: () => {},
  });
  const unbehandelt = [];
  const zaehler = (grund) => unbehandelt.push(String(grund));
  process.on("unhandledRejection", zaehler);
  let zeilen;
  try {
    zeilen = await fehlerausgabeVonAsync(() =>
      withFetch(
        async () => ({ ok: true, status: HTTP_OK, json: async () => CONVERSATION_DONE_WITH_ANALYSIS }),
        async () => {
          await el.abfrageDurchLauf(call.id);
          await waitUntil(() => abgerechnet);
        },
      ),
    );
  } finally {
    process.off("unhandledRejection", zaehler);
  }

  assert.ok(zeilen.some((z) => z.includes("[el-nachlauf] Anbieter-Ergebnis nicht gesichert") && z.includes(call.id) && z.includes("db weg 5113")), zeilen.join("\n"));
  assert.ok(call.endedAt);
  assert.equal(abgerechnet, true);
  assert.deepEqual(freigegeben, [call.id]);
  assert.deepEqual(unbehandelt, []);
});
