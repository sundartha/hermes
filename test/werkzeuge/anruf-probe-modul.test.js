import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const BASIS = "https://hermes-staging-erpv.onrender.com";
const ZIEL = "+12722205602";
const STAND = {
  call_id: "c1",
  status: "completed",
  duration_s: 12,
  started_at: new Date().toISOString(),
  answered_at: new Date().toISOString(),
  last_transcript_lines: [],
  failure_reason: null,
};
const urspruenglich = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = urspruenglich;
});

function stubben() {
  const aufrufe = [];
  globalThis.fetch = async (url, optionen) => {
    const { name } = JSON.parse(optionen.body).params;
    aufrufe.push({ url, optionen, name });
    const strukturiert = {
      get_agent_number: { number: ZIEL },
      place_call: { call_id: "c1", status: "dialing" },
      get_call_status: STAND,
      list_calls: { calls: [{ id: "c1", direction: "outbound", counterparty: ZIEL, status: "completed", startedAt: "x" }] },
    }[name];
    const rpc = { jsonrpc: "2.0", id: 1, result: { structuredContent: strukturiert } };
    return { ok: true, status: 200, text: async () => JSON.stringify(rpc) };
  };
  return aufrufe;
}

const UMGEBUNG = {
  STAGING_URL: BASIS,
  STAGING_PROBE_TOKEN: PROBE_STAGING_TEST_TOKEN,
  STAGING_PROBE_ZIEL: ZIEL,
  STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
  STAGING_PROBE_VORNAME: "Anna",
};

Object.assign(process.env, UMGEBUNG);
const modul = await import("../../scripts/anruf-probe/anrufer.mjs");

test("Anrufer-Modul: Adresse, Token, Ziel, Auftraggeber und Vorname kommen aus der Umgebung des Laufs", async () => {
  const aufrufe = stubben();
  assert.equal(modul.uhr, undefined);
  assert.equal(await modul.anrufer.eigeneNummer(), ZIEL);
  assert.equal(aufrufe[0].url, `${BASIS}/intern/probe/mcp`);
  const { headers } = aufrufe[0].optionen;
  assert.equal(headers.authorization, `Bearer ${PROBE_STAGING_TEST_TOKEN}`);
  assert.deepEqual(await modul.anrufer.tagesstand(), { erstversuche: 1, anrufe: 1 });
  const messung = await modul.anrufer.anrufen({ ziel: ZIEL });
  assert.equal(messung.auftraggeber, "Probe GmbH");
  assert.equal(messung.vorname, "Anna");
  assert.equal(messung.sprache, "de");
  assert.equal(messung.richtung, "eingehend");
  assert.ok(aufrufe.some((aufruf) => aufruf.name === "place_call"));
});
