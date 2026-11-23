import assert from "node:assert/strict";
import { test } from "node:test";

import { postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";
import { mitZweiInstanzenMitKostendecke } from "../anrufe/zwei-instanzen-kernwege-hilfen.js";

const ZEITGRENZE_MS = 120_000;
const HTTP_OK = 200;
const HTTP_PAYMENT_REQUIRED = 402;
const TARIF_CENT = 20;
const DECKE_FUER_EINEN_ANRUF_CENT = 60;
const ZIELE = Object.freeze({ a: "+4915112399111", b: "+4915112399112" });
const EINMAL = 1;

async function gleichzeitigerStart(t, reihenfolge) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const params = { tarifCent: TARIF_CENT, deckeCent: DECKE_FUER_EINEN_ANRUF_CENT };
  await mitZweiInstanzenMitKostendecke(t, params, async (lauf) => {
    const { rufeAn, anbieter } = lauf;
    const antworten = await Promise.all(reihenfolge.map((name) => rufeAn(lauf[name], ZIELE[name])));
    const stati = antworten.map((antwort) => antwort.status).sort();
    assert.deepEqual(stati, [HTTP_OK, HTTP_PAYMENT_REQUIRED]);
    assert.equal(anbieter.starts().length, EINMAL);
  });
}

test("T11 Start auf A zuerst, gleichzeitig Start auf B: genau ein Anruf wird gestartet, der andere von der Kostendecke abgelehnt", { timeout: ZEITGRENZE_MS }, (t) =>
  gleichzeitigerStart(t, ["a", "b"]));

test("T11 Start auf B zuerst, gleichzeitig Start auf A: genau ein Anruf wird gestartet, der andere von der Kostendecke abgelehnt", { timeout: ZEITGRENZE_MS }, (t) =>
  gleichzeitigerStart(t, ["b", "a"]));
