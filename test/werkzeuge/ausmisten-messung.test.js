import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  DOPPELT,
  FREMDE_QUELLE,
  GATE_TEST,
  GRUNDDATEIEN,
  RECHNEN_HILFE,
  RECHNEN_TEST,
} from "./ausmisten/hilfen.mjs";
import {
  EXIT_GRUEN,
  EXIT_ROT,
  messePaket,
  messeUndMelde,
  plane,
  testDatei,
} from "./ausmisten/messung.mjs";

const ZEILEN_JE_GROSSER_QUELLE = 1600;
const GROSSE_QUELLEN_FUER_ZWEI_PAKETE = 2;
const ZU_VIELE_GROSSE_QUELLEN = 21;
const MAX_MUTANTEN_JE_PAKET = 3000;
const SHA256_ZEICHEN = 64;
const ISSUE_IM_TEST = 42;
const BERECHNET_TEST = "test/post/berechnet.test.js";

test("ausmisten-messung: ein Mutant, den der gelöschte Test tötet und ein unveränderter Test auch, bleibt grün", async (context) => {
  const ergebnis = await messeUndMelde(context, { weg: [DOPPELT] });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.equal(ergebnis.zweig.status, EXIT_GRUEN, ergebnis.zweig.ausgabe);
  assert.deepEqual(ergebnis.gelesen.tests, { alt: [DOPPELT], neu: [] });
  assert.ok(Object.values(ergebnis.gelesen.mutanten).includes("Killed"), ergebnis.basis.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_GRUEN, ergebnis.melden.ausgabe);
  assert.equal(ergebnis.status.state, "success");
});

test("ausmisten-messung: ein Mutant, den nur der gelöschte Test tötet, macht den Lauf rot", async (context) => {
  const ergebnis = await messeUndMelde(context, { weg: [RECHNEN_TEST] });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.deepEqual(ergebnis.gelesen.dateien, [FREMDE_QUELLE, "src/post/eingang.js"]);
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
  assert.match(
    ergebnis.melden.ausgabe,
    /Mutant auf dem Branch nicht mehr getötet: src\/fremd\/rechnen\.js:/,
  );
  assert.equal(ergebnis.status.state, "failure");
});

test("ausmisten-messung: eine geänderte Testhilfe bringt die Testdatei, die sie lädt, in die Messung", async (context) => {
  const neu = { [RECHNEN_HILFE]: `${GRUNDDATEIEN[RECHNEN_HILFE]}void process.env.HOME;\n` };
  const ergebnis = await messeUndMelde(context, { weg: [], neu });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.deepEqual(ergebnis.gelesen.tests, { alt: [RECHNEN_TEST], neu: [RECHNEN_TEST] });
  assert.ok(ergebnis.gelesen.dateien.includes(FREMDE_QUELLE));
  assert.ok(Object.values(ergebnis.gelesen.mutanten).includes("Killed"), ergebnis.basis.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_GRUEN, ergebnis.melden.ausgabe);
});

test("ausmisten-messung: ein gelöschter Test, der eine src-Datei über einen berechneten Import lädt, wird rot", async (context) => {
  const berechnet = [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    "",
    'test("verdoppelt über einen berechneten Import", async () => {',
    "  const stand = 1;",
    "  const { doppelt } = await import(`../../src/fremd/rechnen.js?stand=${stand}`);",
    "  assert.equal(doppelt(3), 6);",
    "});",
    "",
  ].join("\n");
  const dateien = { [BERECHNET_TEST]: berechnet, [RECHNEN_TEST]: GRUNDDATEIEN[RECHNEN_TEST] };
  const ergebnis = await messeUndMelde(context, { weg: [BERECHNET_TEST] }, { dateien });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.ok(ergebnis.gelesen.dateien.includes(FREMDE_QUELLE), ergebnis.basis.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
  assert.match(
    ergebnis.melden.ausgabe,
    /Mutant auf dem Branch nicht mehr getötet: src\/fremd\/rechnen\.js:/,
  );
});

test("ausmisten-messung: ein geschwächter Gate-Test wird im Gate-Lauf rot, auch wenn ein anderer Test den Mutanten tötet", async (context) => {
  const pruefung =
    'assert.equal(modul.gesperrt("+900 1"), true);\n  assert.equal(modul.gesperrt("+49 1"), false);';
  const dateien = {
    [GATE_TEST]: testDatei("../src/sperre.js", "sperrt teure Ziele", pruefung),
    "test/sperre-zusatz.test.js": testDatei("../src/sperre.js", "sperrt auch hier", pruefung),
  };
  const schwach = testDatei("../src/sperre.js", "sperrt teure Ziele", "assert.ok(modul.gesperrt);");
  const ergebnis = await messeUndMelde(
    context,
    { weg: [], neu: { [GATE_TEST]: schwach } },
    { dateien },
  );
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.ok(Object.values(ergebnis.gelesen.gate).includes("Killed"), ergebnis.basis.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
  assert.match(ergebnis.melden.ausgabe, /Gate-Lauf: Mutant nicht mehr getötet: src\/sperre\.js:/);
  assert.doesNotMatch(ergebnis.melden.ausgabe, /Verstoß: Mutant auf dem Branch nicht mehr getötet/);
});

function grosseQuelle(nummer) {
  const zeilen = Array.from(
    { length: ZEILEN_JE_GROSSER_QUELLE },
    (_leer, zeile) => `export const w${nummer}_${zeile} = ${zeile} + 1;`,
  );
  return `${zeilen.join("\n")}\n`;
}

function grosseQuellen(anzahl) {
  return Object.fromEntries(
    Array.from({ length: anzahl }, (_leer, nummer) => [
      `src/post/gross-${nummer}.js`,
      grosseQuelle(nummer),
    ]),
  );
}

test("ausmisten-messung: der Planer teilt eine große Messmenge in mehrere Pakete", async (context) => {
  const stand = await plane(
    context,
    { weg: [DOPPELT] },
    grosseQuellen(GROSSE_QUELLEN_FUER_ZWEI_PAKETE),
  );
  assert.equal(stand.planen.status, EXIT_GRUEN, stand.planen.ausgabe);
  const plan = JSON.parse(readFileSync(join(stand.artefakte, "plan", "plan.json"), "utf8"));
  assert.equal(JSON.parse(stand.plan.pakete).length, GROSSE_QUELLEN_FUER_ZWEI_PAKETE);
  assert.ok(
    plan.pakete.every(({ mutanten }) => mutanten <= MAX_MUTANTEN_JE_PAKET),
    stand.planen.ausgabe,
  );
  const alle = plan.pakete.flatMap(({ dateien }) => dateien).sort();
  assert.deepEqual(alle, plan.dateien);
});

test("ausmisten-messung: zu viele Pakete machen den Plan rot", async (context) => {
  const stand = await plane(context, { weg: [DOPPELT] }, grosseQuellen(ZU_VIELE_GROSSE_QUELLEN));
  assert.equal(stand.planen.status, EXIT_ROT, stand.planen.ausgabe);
  assert.match(
    stand.planen.ausgabe,
    /Zu viel auf einmal geändert: die Messung bräuchte 21 Pakete, höchstens 20/,
  );
});

test("ausmisten-messung: ein nach dem Festhalten verändertes Basis-Paket stoppt den Branch-Job", async (context) => {
  const vorBranch = (artefakte) => appendFileSync(join(artefakte, "basis-0", "basis-0.json"), " ");
  const ergebnis = await messeUndMelde(context, { weg: [DOPPELT] }, { vorBranch });
  assert.equal(ergebnis.zweig.status, EXIT_ROT, ergebnis.zweig.ausgabe);
  assert.match(
    ergebnis.zweig.ausgabe,
    /Basis-Artefakt unbrauchbar: Artefakt basis-0 passt nicht zur Prüfsumme/,
  );
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
});

test("ausmisten-messung: ein nach der Basis-Messung ausgetauschtes Basis-Artefakt glaubt melden nicht", async (context) => {
  const vorMelden = (artefakte) => {
    const datei = join(artefakte, "basis-0", "basis-0.json");
    const daten = JSON.parse(readFileSync(datei, "utf8"));
    writeFileSync(datei, `${JSON.stringify({ ...daten, mutanten: {}, gate: {} })}\n`);
  };
  const ergebnis = await messeUndMelde(context, { weg: [DOPPELT] }, { vorMelden });
  assert.equal(ergebnis.zweig.status, EXIT_GRUEN, ergebnis.zweig.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_ROT, ergebnis.melden.ausgabe);
  assert.match(ergebnis.melden.ausgabe, /Artefakt basis-0 passt nicht zur Prüfsumme/);
  assert.equal(ergebnis.status.state, "failure");
});

test("ausmisten-messung: ein Plan, der nicht zur Prüfsumme passt, stoppt die Basis-Messung", async (context) => {
  const stand = await plane(context, { weg: [DOPPELT] });
  const basis = await messePaket(
    { ...stand, plan: { ...stand.plan, pruefsumme: "0".repeat(SHA256_ZEICHEN) } },
    { art: "basis", paket: 0 },
  );
  assert.equal(basis.status, EXIT_ROT, basis.ausgabe);
  assert.match(basis.ausgabe, /Plan unbrauchbar: Der Plan passt nicht zur Prüfsumme/);
});

test("ausmisten-messung: eine geänderte Testdatei ohne Regressionstest bricht die Messung nicht ab", async (context) => {
  const katalog = "test/post/katalog.test.js";
  const dateien = {
    [katalog]: testDatei(
      "../../src/post/eingang.js",
      "GAP-99 kürzt den Eingang",
      'assert.equal(modul.eingang(" a "), "a");',
    ),
  };
  const ergebnis = await messeUndMelde(context, { weg: [katalog] }, { dateien });
  assert.equal(ergebnis.basis.status, EXIT_GRUEN, ergebnis.basis.ausgabe);
  assert.equal(ergebnis.zweig.status, EXIT_GRUEN, ergebnis.zweig.ausgabe);
  assert.equal(ergebnis.melden.status, EXIT_GRUEN, ergebnis.melden.ausgabe);
  assert.deepEqual(ergebnis.gelesen.tests.alt, [katalog]);
});

function geplant(stand) {
  return JSON.parse(readFileSync(join(stand.artefakte, "plan", "plan.json"), "utf8"));
}

test("ausmisten-messung: eine Zeile Issue: #<Nummer> im Kopf-Commit landet im Plan", async (context) => {
  const nachricht = "Miste doppelte Tests aus\n\nWarum: doppelt.\n\nIssue: #42\nPaket: 37";
  const stand = await plane(context, { weg: [DOPPELT], nachricht });
  assert.equal(stand.planen.status, EXIT_GRUEN, stand.planen.ausgabe);
  assert.equal(geplant(stand).issue, ISSUE_IM_TEST);
});

test("ausmisten-messung: ohne genaue Issue-Zeile bleibt der Plan ohne Issue", async (context) => {
  const nachricht = "Miste aus\n\nIssue: #42; echo x\nSiehe Issue: #43";
  const stand = await plane(context, { weg: [DOPPELT], nachricht });
  assert.equal(stand.planen.status, EXIT_GRUEN, stand.planen.ausgabe);
  assert.equal(geplant(stand).issue, null);
});
