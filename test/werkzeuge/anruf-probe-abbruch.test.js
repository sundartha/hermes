import assert from "node:assert/strict";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";

const BASIS = "https://hermes-staging-erpv.onrender.com";
const ZIEL = "+12722205602";
const JETZT = Date.parse("2026-11-17T10:00:00.000Z");

function echteAntwort(name, argumente, calls, abgebrochen, uhr) {
  if (name === "cancel_call") {
    abgebrochen.push({ id: argumente.call_id, zeit: uhr.zeit });
    return { content: [{ type: "text", text: JSON.stringify({ call_id: argumente.call_id, status: "cancelled" }) }] };
  }
  if (name === "list_calls") return { structuredContent: { calls } };
  if (name === "place_call") return { structuredContent: { call_id: "c1", status: "dialing" } };
  return {
    structuredContent: {
      call_id: argumente.call_id,
      status: abgebrochen.length > 0 ? "cancelled" : "in_progress",
      duration_s: 0,
      started_at: new Date(JETZT).toISOString(),
      answered_at: new Date(JETZT + 4000).toISOString(),
      last_transcript_lines: [],
    },
  };
}

function anruferMitEchtenAntworten(calls = []) {
  const uhr = { zeit: JETZT, jetzt: () => uhr.zeit, warte: async (ms) => (uhr.zeit += ms) };
  const abgebrochen = [];
  const abfrage = async (_url, optionen) => {
    const { name, arguments: argumente } = JSON.parse(optionen.body).params;
    const rpc = { jsonrpc: "2.0", id: 1, result: echteAntwort(name, argumente, calls, abgebrochen, uhr) };
    return { ok: true, status: 200, text: async () => JSON.stringify(rpc) };
  };
  const anrufer = anruferBauen({
    basis: BASIS,
    token: PROBE_STAGING_TEST_TOKEN,
    ziel: ZIEL,
    sprache: "de",
    abfrage,
    uhr,
  });
  return { anrufer, abgebrochen };
}

test("Auflegen: cancel_call ohne structuredContent beendet alle offenen Probe-Anrufe ohne Fehler", async () => {
  const calls = [
    { id: "a", direction: "outbound", counterparty: ZIEL, status: "in_progress" },
    { id: "b", direction: "outbound", counterparty: ZIEL, status: "dialing" },
  ];
  const { anrufer, abgebrochen } = anruferMitEchtenAntworten(calls);
  assert.equal(await anrufer.offeneBeenden(), 2);
  assert.deepEqual(
    abgebrochen.map((x) => x.id),
    ["a", "b"],
  );
});

test("Anruf: hartes Auflegen nach 60 s klappt mit der echten Antwort von cancel_call", async () => {
  const { anrufer, abgebrochen } = anruferMitEchtenAntworten();
  const messung = await anrufer.anrufen({ ziel: ZIEL });
  assert.deepEqual(abgebrochen, [{ id: "c1", zeit: JETZT + 60000 }]);
  assert.equal(messung.status, "cancelled");
});
