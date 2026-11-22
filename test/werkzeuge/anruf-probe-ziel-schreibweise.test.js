import assert from "node:assert/strict";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";

const GEWAEHLT = "+12544670400";
const JETZT = Date.parse("2026-11-17T10:00:00.000Z");

const SCHREIBWEISEN = [
  ["Punkt", "+1 (254) 467.0400"],
  ["Leerzeichen und Bindestrich", "+1 254 467-0400"],
  ["Leerraum am Rand", " +12544670400\n"],
];

function antwort(strukturiert) {
  const rpc = { jsonrpc: "2.0", id: 1, result: { isError: false, structuredContent: strukturiert } };
  return { ok: true, status: 200, text: async () => JSON.stringify(rpc) };
}

for (const [name, ziel] of SCHREIBWEISEN) {
  test(`Anrufprobe schickt place_call die Nummer ohne Trennzeichen: ${name}`, async () => {
    const uhr = { zeit: JETZT, jetzt: () => uhr.zeit, warte: async (ms) => (uhr.zeit += ms) };
    const gesendet = [];
    const abfrage = async (url, optionen) => {
      const { name: werkzeug, arguments: argumente } = JSON.parse(optionen.body).params;
      if (werkzeug === "place_call") {
        gesendet.push(argumente.to);
        return antwort({ call_id: "c1", status: "dialing" });
      }
      return antwort({
        call_id: "c1",
        status: "completed",
        duration_s: 31,
        started_at: new Date(JETZT).toISOString(),
        answered_at: new Date(JETZT + 4000).toISOString(),
        last_transcript_lines: [],
        failure_reason: null,
      });
    };
    const anrufer = anruferBauen({
      basis: "https://hermes-staging-erpv.onrender.com",
      token: PROBE_STAGING_TEST_TOKEN,
      ziel: GEWAEHLT,
      sprache: "de",
      auftraggeber: "Probe GmbH",
      vorname: "Anna",
      abfrage,
      uhr,
    });
    await anrufer.anrufen({ ziel }).catch(() => undefined);
    assert.deepEqual(gesendet, [GEWAEHLT]);
  });
}
