import assert from "node:assert/strict";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import * as modul from "../../scripts/anruf-probe/anrufer.mjs";
import { STATE_CALLS } from "../../src/routes/api-read.ts";

const ZIEL = "+12722205602";
const FREMD = "+4930555000199";
const JETZT = Date.parse("2026-11-17T10:00:00.000Z");
const HEUTE = "2026-11-17T01:00:00.000Z";

function anruferMit(anzahl) {
  const calls = Array.from({ length: anzahl }, (_x, index) => ({
    id: `v${index}`,
    direction: "outbound",
    counterparty: FREMD,
    status: "completed",
  }));
  const abfrage = async (_url, optionen) => {
    const { name, arguments: argumente } = JSON.parse(optionen.body).params;
    const strukturiert =
      name === "list_calls" ? { calls } : { call_id: argumente.call_id, status: "completed", started_at: HEUTE };
    const rpc = { jsonrpc: "2.0", id: 1, result: { structuredContent: strukturiert } };
    return { ok: true, status: 200, text: async () => JSON.stringify(rpc) };
  };
  const uhr = { jetzt: () => JETZT, warte: async () => {} };
  return modul.anruferBauen({
    basis: "https://hermes-staging-erpv.onrender.com",
    token: PROBE_STAGING_TEST_TOKEN,
    ziel: ZIEL,
    sprache: "de",
    auftraggeber: "Probe GmbH",
    vorname: "Anna",
    abfrage,
    uhr,
  });
}

test("Listengrenze der Anrufprobe ist die Grenze von /api/state (STATE_CALLS)", () => {
  assert.equal(modul.LISTE_OBERGRENZE, STATE_CALLS);
});

test("Tagesstand: genau STATE_CALLS Anrufe, alle von heute, stoppt mit probe_tageszaehl_unklar", async () => {
  await assert.rejects(anruferMit(STATE_CALLS).tagesstand(), /probe_tageszaehl_unklar/);
});

test("Tagesstand: einen Anruf weniger als STATE_CALLS zählt normal", async () => {
  assert.deepEqual(await anruferMit(STATE_CALLS - 1).tagesstand(), { erstversuche: 0, anrufe: 0 });
});
