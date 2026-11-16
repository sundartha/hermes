import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryLine, budgetedMemoryLines } from "../../src/call-memory.ts";

const ERGEBNIS_GRENZE_ZEICHEN = 100;
const URL_VORSPANN = "https://beispiel.de/";
const ANZAHL_A_HINTER_DER_URL = 120;

const gedaechtnisZeilen = async ({ outcome, facts }) => budgetedMemoryLines([{ outcome, facts }]);

test("S1: Ergebnis ueber 100 Zeichen endet an der Wortgrenze mit „…“ (98 Zeichen)", async () => {
  const zeilen = await gedaechtnisZeilen({
    outcome:
      "Rueckruf vereinbart, Frau Weber hat den Termin fuer die Lieferung bestaetigt am Dienstag um 15:30 Uhr",
    facts: [],
  });
  const erwartet = "Rueckruf vereinbart, Frau Weber hat den Termin fuer die Lieferung bestaetigt am Dienstag um 15:30…";
  assert.equal(erwartet.length, 98);
  assert.ok(zeilen.includes(erwartet), `erwartet: ${erwartet}\nerhalten: ${zeilen.join("\n")}`);
  assert.ok(!zeilen.join("\n").includes("15:30 Uh"));
});

test("S2: ganze Zeile ueber 200 Zeichen endet an der Wortgrenze mit „…“ (196 Zeichen)", async () => {
  const zeilen = await gedaechtnisZeilen({
    outcome: "Rueckruf vereinbart fuer naechste Woche",
    facts: [
      "Ansprechpartnerin ist Frau Weber aus der Buchhaltung im zweiten Stock",
      "Kundennummer 4711-0815 bei allen Rueckfragen angeben",
      "Lieferung kommt per Spedition Hansen",
    ],
  });
  const erwartet =
    "Rueckruf vereinbart fuer naechste Woche; Ansprechpartnerin ist Frau Weber aus der Buchhaltung im zweiten Stock; Kundennummer 4711-0815 bei allen Rueckfragen angeben; Lieferung kommt per Spedition…";
  assert.equal(erwartet.length, 196);
  assert.ok(zeilen.includes(erwartet), `erwartet: ${erwartet}\nerhalten: ${zeilen.join("\n")}`);
  assert.ok(!zeilen.join("\n").includes("Spedition Hans"));
});

test("S3: Ergebnis ohne Leerzeichen wird hart auf 99 Zeichen gekuerzt und bekommt „…“ (100 Zeichen)", async () => {
  const outcome = URL_VORSPANN + "a".repeat(ANZAHL_A_HINTER_DER_URL);
  const zeilen = await gedaechtnisZeilen({ outcome, facts: [] });
  const erwartet = `${outcome.slice(0, ERGEBNIS_GRENZE_ZEICHEN - 1)}…`;
  assert.equal(erwartet.length, ERGEBNIS_GRENZE_ZEICHEN);
  assert.ok(zeilen.includes(erwartet), zeilen.join("\n"));
});

test("B1: Zeile, die unter die Grenzen passt, steht unveraendert ohne „…“", async () => {
  const zeilen = await gedaechtnisZeilen({
    outcome: "Reklamation 4711 aufgenommen",
    facts: ["Reklamationsnummer 4711"],
  });
  assert.ok(zeilen.includes("Reklamation 4711 aufgenommen; Reklamationsnummer 4711"), zeilen.join("\n"));
  assert.ok(!zeilen.join("\n").includes("…"));
});

test("B2: Ergebnis von genau 100 Zeichen passt und bekommt kein „…“", async () => {
  const outcome = "Frau Weber bestaetigt die Lieferung am Dienstag um 15:30 Uhr an die Hauptstrasse 12 in Berlin-Mitte.";
  assert.equal(outcome.length, ERGEBNIS_GRENZE_ZEICHEN);
  const zeilen = await gedaechtnisZeilen({ outcome, facts: [] });
  assert.ok(zeilen.includes(outcome), zeilen.join("\n"));
  assert.ok(!zeilen.join("\n").includes("…"));
});

test("B3: fehlender Gedaechtniseintrag ergibt keine Zeile statt eines Absturzes", () => {
  assert.equal(memoryLine(null), null);
  assert.equal(memoryLine(undefined), null);
  assert.deepEqual(budgetedMemoryLines([null, { outcome: "Rueckruf vereinbart", facts: [] }]), ["Rueckruf vereinbart"]);
});
