import assert from "node:assert/strict";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";
import { EL_ABORT_PROVIDER_TIMEOUT_MS, EL_TERMINATION_RESULT_ATTEMPTS } from "../../src/elevenlabs/outbound.js";
import { STIMMEN_FRIST_MS } from "../../src/elevenlabs/wirksame-stimme.ts";
import { ELEVENLABS_RESULT_POLL_STANDARD_MS } from "../../src/konfiguration/rohwerte-voice.ts";

const JETZT = Date.parse("2026-11-17T10:00:00.000Z");
const ZIEL = "+12722205602";
const SCHLUESSEL = "hermes/stimmen_anzahl";
const TAKT_MS = 2000;
const ERWARTET_MS =
  EL_TERMINATION_RESULT_ATTEMPTS * EL_ABORT_PROVIDER_TIMEOUT_MS +
  (EL_TERMINATION_RESULT_ATTEMPTS - 1) * ELEVENLABS_RESULT_POLL_STANDARD_MS +
  STIMMEN_FRIST_MS;

function antwort(strukturiert, meta) {
  const ergebnis = { isError: false, structuredContent: strukturiert, ...(meta === undefined ? {} : { _meta: meta }) };
  const koerper = JSON.stringify({ jsonrpc: "2.0", id: 1, result: ergebnis });
  return { ok: true, status: 200, text: async () => koerper };
}

async function gelesen(zahlAbAbruf) {
  const wartezeiten = [];
  let gegenAbrufe = 0;
  const abfrage = async (url, optionen) => {
    const { name, arguments: argumente } = JSON.parse(optionen.body).params;
    if (name === "place_call") return antwort({ call_id: "c1", status: "dialing" });
    if (name === "list_calls") {
      return antwort({
        calls: [
          { id: "c1", direction: "outbound", counterparty: ZIEL },
          { id: "g1", direction: "inbound", counterparty: "+12544670400" },
        ],
      });
    }
    const gegen = argumente.call_id === "g1";
    if (gegen) gegenAbrufe += 1;
    const meta = gegen && gegenAbrufe >= zahlAbAbruf ? { [SCHLUESSEL]: 1 } : undefined;
    return antwort(
      {
        call_id: argumente.call_id,
        status: "completed",
        duration_s: 30,
        started_at: new Date(JETZT + (gegen ? 2000 : 0)).toISOString(),
        answered_at: new Date(JETZT + 4000).toISOString(),
        last_transcript_lines: [],
      },
      meta,
    );
  };
  let zeit = JETZT;
  const uhr = {
    jetzt: () => zeit,
    warte: async (ms) => {
      zeit += ms;
      wartezeiten.push(ms);
    },
  };
  const anrufer = anruferBauen({
    basis: "https://hermes-staging-erpv.onrender.com",
    token: PROBE_STAGING_TEST_TOKEN,
    ziel: ZIEL,
    sprache: "de",
    auftraggeber: "Probe GmbH",
    vorname: "Anna",
    abfrage,
    uhr,
  });
  await anrufer.anrufen({ ziel: ZIEL });
  wartezeiten.length = 0;
  return { wert: await anrufer.stimmenAnzahl(), wartezeiten };
}

const summe = (liste) => liste.reduce((a, b) => a + b, 0);

test("Frist-Quelle: erwartete Frist ergibt aus den Server-Konstanten 50000 ms", () => {
  assert.equal(ERWARTET_MS, 50_000);
});

test("Frist-Quelle: Zahl nie geliefert gibt nach der aus den Server-Konstanten berechneten Frist undefined", async () => {
  const { wert, wartezeiten } = await gelesen(Number.POSITIVE_INFINITY);
  assert.equal(wert, undefined);
  assert.equal(summe(wartezeiten), ERWARTET_MS);
});

test("Frist-Quelle: Zahl im letzten Abruf vor Fristablauf zählt noch", async () => {
  const { wert } = await gelesen(ERWARTET_MS / TAKT_MS);
  assert.equal(wert, 1);
});

test("Frist-Quelle: Zahl im ersten Abruf nach Fristablauf zählt nicht mehr", async () => {
  const { wert } = await gelesen(ERWARTET_MS / TAKT_MS + 2);
  assert.equal(wert, undefined);
});
