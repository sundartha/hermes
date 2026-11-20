import assert from "node:assert/strict";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";
import { anruferBauen } from "../../scripts/anruf-probe/anrufer.mjs";

const JETZT = Date.parse("2026-11-17T10:00:00.000Z");
const ZIEL = "+12722205602";
const SCHLUESSEL = "hermes/stimmen_anzahl";
const TAKT_MS = 2000;

function antwort(strukturiert, meta) {
  const ergebnis = { isError: false, structuredContent: strukturiert, ...(meta === undefined ? {} : { _meta: meta }) };
  const koerper = JSON.stringify({ jsonrpc: "2.0", id: 1, result: ergebnis });
  return { ok: true, status: 200, text: async () => koerper };
}

function bauen(zahlAbAbruf) {
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
  return { anrufer, wartezeiten };
}

async function gelesen(zahlAbAbruf) {
  const { anrufer, wartezeiten } = bauen(zahlAbAbruf);
  await anrufer.anrufen({ ziel: ZIEL });
  wartezeiten.length = 0;
  return { wert: await anrufer.stimmenAnzahl(), wartezeiten };
}

test("Nachlauf: Zahl erst ab dem zweiten Abruf wird gelesen", async () => {
  const { wert, wartezeiten } = await gelesen(2);
  assert.equal(wert, 1);
  assert.deepEqual(wartezeiten, [TAKT_MS]);
});

test("Nachlauf: Zahl nie geliefert bleibt nach der Frist undefined", async () => {
  const { wert, wartezeiten } = await gelesen(Number.POSITIVE_INFINITY);
  assert.equal(wert, undefined);
  assert.deepEqual(wartezeiten, Array(70).fill(TAKT_MS));
});

test("Nachlauf: Zahl beim ersten Abruf wartet nicht", async () => {
  const { wert, wartezeiten } = await gelesen(1);
  assert.equal(wert, 1);
  assert.deepEqual(wartezeiten, []);
});

test("Nachlauf: Zahl im letzten Versuch vor Fristablauf zählt noch", async () => {
  const { wert } = await gelesen(4);
  assert.equal(wert, 1);
});
