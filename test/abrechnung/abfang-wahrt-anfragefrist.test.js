import assert from "node:assert/strict";
import { test } from "node:test";

import { ANTWORTFRIST_MS } from "../gemeinsam/antwortfrist.mjs";
import { aussenweltAbfangen, START_FRIST_MS } from "./server-mit-testdatenbank.js";

const LOKALE_ADRESSE = "http://127.0.0.1:4711/x";
const FREMDE_ADRESSE = "https://fremd.invalid/x";

async function mitAbfang(aufruf) {
  const ausgangsFetch = globalThis.fetch;
  const empfangen = [];
  globalThis.fetch = async (url, optionen) => {
    empfangen.push({ url, optionen });
    return new Response("{}", { status: 200 });
  };
  try {
    aussenweltAbfangen([], []);
    await aufruf(globalThis.fetch);
    return empfangen;
  } finally {
    globalThis.fetch = ausgangsFetch;
  }
}

function fristenAufzeichnen(t) {
  const fristen = [];
  const echtesTimeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms) => {
    fristen.push(ms);
    return echtesTimeout.call(AbortSignal, 2 ** 30);
  });
  return fristen;
}

test("abfang-wahrt-anfragefrist: lokale Anfrage behält die Aufwärmfrist des Gerüsts", async (t) => {
  const fristen = fristenAufzeichnen(t);
  const eigenes = new AbortController();
  await mitAbfang((abruf) => abruf(LOKALE_ADRESSE, { signal: eigenes.signal }));
  assert.equal(Math.max(...fristen), START_FRIST_MS + ANTWORTFRIST_MS);
});

test("abfang-wahrt-anfragefrist: die Frist des Aufrufers wirkt weiter", async (t) => {
  fristenAufzeichnen(t);
  const eigenes = new AbortController();
  const empfangen = await mitAbfang((abruf) => abruf(LOKALE_ADRESSE, { signal: eigenes.signal }));
  const weitergegeben = empfangen[0].optionen.signal;
  assert.equal(weitergegeben.aborted, false);
  eigenes.abort();
  assert.equal(weitergegeben.aborted, true);
});

test("abfang-wahrt-anfragefrist: lokale Anfrage ohne Signal bekommt eine noch nicht abgelaufene Frist", async (t) => {
  fristenAufzeichnen(t);
  const empfangen = await mitAbfang((abruf) => abruf(LOKALE_ADRESSE));
  assert.ok(empfangen[0].optionen.signal instanceof AbortSignal);
  assert.equal(empfangen[0].optionen.signal.aborted, false);
});

test("abfang-wahrt-anfragefrist: fremde Adresse bleibt gesperrt", async () => {
  await mitAbfang(async (abruf) => {
    await assert.rejects(() => abruf(FREMDE_ADRESSE), /Zugriff nach außen gesperrt/);
  });
});
