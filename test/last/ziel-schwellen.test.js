import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { STAGING_ADRESSE, fuehreAusWennErlaubt, zielErlaubt } from "../../scripts/last/ziel.mjs";
import { bewerteLauf } from "../../scripts/last/schwellen.mjs";

const STAGING_WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const PRODUKTION = ["https://hermes.sundartha.com", "https://vodafone-agent.onrender.com"];

const ZIELE = [
  ["http://127.0.0.1:3999", "ci", true],
  ["http://localhost:3999", "ci", true],
  [STAGING_ADRESSE, "staging", true],
  [`${STAGING_ADRESSE}/mcp`, "staging", true],
  [PRODUKTION[0], "staging", false],
  [PRODUKTION[1], "staging", false],
  [PRODUKTION[0], "ci", false],
  [PRODUKTION[1], "ci", false],
  ["", "ci", false],
  [undefined, "staging", false],
  ["kein url", "ci", false],
  ["https://fremd.example.com", "staging", false],
  [STAGING_ADRESSE, "ci", false],
  ["http://127.0.0.1:3999", "staging", false],
  ["http://127.0.0.1", "ci", false],
  ["https://127.0.0.1:3999", "ci", false],
  ["http://localhost.evil.example:3999", "ci", false],
  [`https://${PRODUKTION[0].slice(8)}@hermes-staging-erpv.onrender.com`, "staging", false],
  ["https://user:pw@hermes-staging-erpv.onrender.com", "staging", false],
  ["http://hermes-staging-erpv.onrender.com", "staging", false],
  [STAGING_ADRESSE, undefined, false],
  [STAGING_ADRESSE, "produktion", false],
  [PRODUKTION[0], "toString", false],
];

test("Staging-Adresse im Lastlauf ist die aus staging.yml", () => {
  assert.ok(STAGING_WORKFLOW.includes(`STAGING_URL: ${STAGING_ADRESSE}\n`));
});

for (const [adresse, umgebung, erwartet] of ZIELE) {
  test(`zielErlaubt(${String(adresse)}, ${String(umgebung)}) = ${erwartet}`, () => {
    const urteil = zielErlaubt(adresse, umgebung);
    assert.equal(urteil.erlaubt, erwartet);
    assert.equal(urteil.grund === "", erwartet);
  });
}

test("zielErlaubt nennt den Grund", () => {
  assert.equal(zielErlaubt("kein url", "ci").grund, "adresse_unlesbar");
  assert.equal(zielErlaubt("https://u:p@x.example", "ci").grund, "zugangsdaten_in_adresse");
  assert.equal(zielErlaubt(STAGING_ADRESSE, "produktion").grund, "umgebung_unbekannt");
  assert.equal(zielErlaubt(PRODUKTION[0], "staging").grund, "ziel_nicht_erlaubt");
});

const GUT = { fehlerquoteProzent: 0.49, verloreneAnrufe: 0, wartezeitSekunden: 120, routen: [{ name: "get_call_result", istMs: 300, budgetMs: 300 }] };

const SCHWELLEN = [
  ["Gutfall", GUT, true, []],
  ["Fehlerquote 0,5 %", { ...GUT, fehlerquoteProzent: 0.5 }, false, ["fehlerquote"]],
  ["Fehlerquote 0 %", { ...GUT, fehlerquoteProzent: 0 }, true, []],
  ["ein verlorener Anruf", { ...GUT, verloreneAnrufe: 1 }, false, ["verlorene_anrufe"]],
  ["Wartezeit 121 s", { ...GUT, wartezeitSekunden: 121 }, false, ["wartezeit"]],
  ["Route 1 ms ueber Budget", { ...GUT, routen: [{ name: "r", istMs: 301, budgetMs: 300 }] }, false, ["route_ueber_budget:r"]],
  ["Fehlerquote fehlt", { ...GUT, fehlerquoteProzent: undefined }, false, ["messwert_fehlt:fehlerquote"]],
  ["Fehlerquote NaN", { ...GUT, fehlerquoteProzent: Number.NaN }, false, ["messwert_fehlt:fehlerquote"]],
  ["Anrufe als Text", { ...GUT, verloreneAnrufe: "0" }, false, ["messwert_fehlt:verlorene_anrufe"]],
  ["Wartezeit fehlt", { ...GUT, wartezeitSekunden: undefined }, false, ["messwert_fehlt:wartezeit"]],
  ["Routen fehlen", { ...GUT, routen: undefined }, false, ["messwert_fehlt:routen"]],
  ["Routen leer", { ...GUT, routen: [] }, false, ["messwert_fehlt:routen"]],
  ["Route ohne Messwert", { ...GUT, routen: [{ name: "r", budgetMs: 300 }] }, false, ["messwert_fehlt:r"]],
  ["Route ist null", { ...GUT, routen: [null] }, false, ["route_ungueltig"]],
  ["kein Ergebnis", undefined, false, ["messwert_fehlt:fehlerquote", "messwert_fehlt:verlorene_anrufe", "messwert_fehlt:wartezeit", "messwert_fehlt:routen"]],
  ["mehrere Verstoesse", { ...GUT, fehlerquoteProzent: 2, verloreneAnrufe: 3 }, false, ["fehlerquote", "verlorene_anrufe"]],
];

for (const [name, ergebnis, gruen, gruende] of SCHWELLEN) {
  test(`bewerteLauf: ${name}`, () => {
    assert.deepEqual(bewerteLauf(ergebnis), { gruen, gruende });
  });
}

test("SG-30 Lastlauf gegen Produktion oder ein unbekanntes Ziel wird vor dem ersten Request abgebrochen", async () => {
  const anfragen = [];
  const aufruf = async (ziel) => anfragen.push(ziel);
  for (const adresse of [...PRODUKTION, "", "kein url"]) {
    for (const umgebung of ["ci", "staging"]) {
      await assert.rejects(fuehreAusWennErlaubt(adresse, umgebung, aufruf), /Lastlauf abgebrochen/);
    }
  }
  assert.deepEqual(anfragen, []);
  await fuehreAusWennErlaubt("http://127.0.0.1:3999/mcp", "ci", aufruf);
  assert.deepEqual(anfragen, ["http://127.0.0.1:3999"]);
});
