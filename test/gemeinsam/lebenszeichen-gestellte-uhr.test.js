import { test } from "node:test";
import assert from "node:assert/strict";
import { starteLebenszeichen } from "../../src/lebenszeichen.js";

const TAKT_MS = 20;
const GRENZE_MS = 20;
const MESSTAKT_MS = 10;
const SPRUNG_MS = 60;
const LANGER_TAKT_MS = 200;
const HOEHERE_GRENZE_MS = 30;
const ANHALTEN_MS = 50;
const ADRESSE = "http://127.0.0.1:9/herzschlag";
const JSON_SPEICHER = { storeBackend: "json" };

function gestellteUhr() {
  const uhr = { jetztMs: 1000, geplant: [] };
  uhr.zeit = {
    jetzt: () => uhr.jetztMs,
    planeTakt: (aufgabe, abstandMs) => uhr.geplant.push({ aufgabe, abstandMs }),
  };
  uhr.stelle = (ms) => {
    uhr.jetztMs += ms;
  };
  uhr.takt = (abstandMs) => uhr.geplant.find((eintrag) => eintrag.abstandMs === abstandMs).aufgabe;
  return uhr;
}

function starteMitUhr(t, uhr, { taktMs, grenzeMs } = { taktMs: TAKT_MS, grenzeMs: GRENZE_MS }) {
  const meldungen = [];
  t.mock.method(globalThis, "fetch", async (adresse) => {
    meldungen.push(String(adresse));
    return new Response(null, { status: 200 });
  });
  starteLebenszeichen(
    {
      herzschlagUrl: ADRESSE,
      herzschlagTaktMs: taktMs,
      herzschlagVerzugGrenzeMs: grenzeMs,
      herzschlagFristMs: 1000,
    },
    JSON_SPEICHER,
    uhr.zeit,
  );
  return meldungen;
}

test("Lebenszeichen: ein Sprung der Uhr über der Grenze verhindert die Meldung, im nächsten Takt kommt sie wieder", async (t) => {
  const uhr = gestellteUhr();
  const meldungen = starteMitUhr(t, uhr);
  const herzschlag = uhr.takt(TAKT_MS);
  uhr.stelle(TAKT_MS);
  await herzschlag();
  assert.equal(meldungen.length, 1, "Lebenszeichen: gesunder Takt meldet nicht");
  uhr.stelle(TAKT_MS + SPRUNG_MS);
  await herzschlag();
  assert.equal(meldungen.length, 1, "Lebenszeichen: Takt nach dem Sprung meldet trotz Verzug");
  uhr.stelle(TAKT_MS);
  await herzschlag();
  assert.equal(meldungen.length, 2, "Lebenszeichen: nach dem Verzug kommt keine Meldung mehr");
  assert.equal(meldungen[0], ADRESSE);
});

test("Lebenszeichen: ein Verzug nur im Messtakt verhindert die nächste Meldung", async (t) => {
  const uhr = gestellteUhr();
  const meldungen = starteMitUhr(t, uhr, { taktMs: LANGER_TAKT_MS, grenzeMs: HOEHERE_GRENZE_MS });
  const herzschlag = uhr.takt(LANGER_TAKT_MS);
  const messung = uhr.takt(MESSTAKT_MS);
  uhr.stelle(ANHALTEN_MS);
  messung();
  uhr.stelle(LANGER_TAKT_MS - ANHALTEN_MS);
  await herzschlag();
  assert.equal(meldungen.length, 0, "Lebenszeichen: Messverzug verhindert die Meldung nicht");
  uhr.stelle(LANGER_TAKT_MS);
  await herzschlag();
  assert.equal(meldungen.length, 1, "Lebenszeichen: nach dem Messverzug kommt keine Meldung mehr");
});
