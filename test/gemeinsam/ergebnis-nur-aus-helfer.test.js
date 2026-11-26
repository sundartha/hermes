import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const WURZEL = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const REGEL = "hermes/ergebnis-nur-aus-helfer";
const HELFER = "src/utils/ergebnis.ts";
const PRODUKT_TS = "src/utils/anfrage-kennung.ts";

const eslint = new ESLint({ cwd: WURZEL });

async function befunde(datei, quelltext) {
  const [ergebnis] = await eslint.lintText(quelltext, { filePath: resolve(WURZEL, datei) });
  assert.deepEqual(
    ergebnis.messages.filter((meldung) => meldung.fatal),
    [],
    `Ergebnisregel: ${datei} ließ sich nicht prüfen`,
  );
  return ergebnis.messages.filter((meldung) => meldung.ruleId === REGEL);
}

async function erwarteBefund(quelltext) {
  const gefunden = await befunde(PRODUKT_TS, quelltext);
  assert.equal(gefunden.length, 1, `Ergebnisregel: ${quelltext} wurde nicht genau einmal gemeldet`);
  assert.equal(gefunden[0].severity, 2);
  assert.match(gefunden[0].message, /fehler\(grund\) aus src\/utils\/ergebnis\.ts/);
}

async function erwarteKeinen(datei, quelltext) {
  assert.deepEqual(await befunde(datei, quelltext), [], `Ergebnisregel: ${datei} wurde gemeldet: ${quelltext}`);
}

const LITERAL = 'export const a = (): object => ({ ok: false, reason: "x" });\n';
const LITERAL_JS = 'export const a = () => ({ ok: false, reason: "x" });\n';

test("Ergebnisregel: ein Objektliteral mit ok false in einer .ts-Datei unter src ist ein Fehler", () =>
  erwarteBefund(LITERAL));
test("Ergebnisregel: ok false in einem verschachtelten Objektliteral ist ein Fehler", () =>
  erwarteBefund("export const a = (): object => ({ seite: { ok: false } });\n"));
test("Ergebnisregel: ok als Textschlüssel ist ein Fehler", () =>
  erwarteBefund('export const a = (): object => ({ "ok": false });\n'));
test("Ergebnisregel: ok als berechneter fester Text ist ein Fehler", () =>
  erwarteBefund('export const a = (): object => ({ ["ok"]: false });\n'));
test("Ergebnisregel: false mit as const ist ein Fehler", () =>
  erwarteBefund("export const a = (): object => ({ ok: false as const });\n"));
test("Ergebnisregel: false mit satisfies ist ein Fehler", () =>
  erwarteBefund("export const a = (): object => ({ ok: false satisfies boolean });\n"));

test("Ergebnisregel: ein Typliteral mit ok false bleibt frei", () =>
  erwarteKeinen(PRODUKT_TS, "export type A = { ok: false; reason: string } | { ok: true };\n"));
test("Ergebnisregel: ein Objektliteral mit ok true bleibt frei", () =>
  erwarteKeinen(PRODUKT_TS, "export const a = (): object => ({ ok: true });\n"));
test("Ergebnisregel: ein anderer Schlüssel mit false bleibt frei", () =>
  erwarteKeinen(PRODUKT_TS, "export const a = (): object => ({ done: false });\n"));
test("Ergebnisregel: ein berechneter Schlüssel aus einer Variable bleibt frei", () =>
  erwarteKeinen(PRODUKT_TS, "export const a = (ok: string): object => ({ [ok]: false });\n"));
test("Ergebnisregel: ok mit einem Wert aus einer Variable bleibt frei", () =>
  erwarteKeinen(PRODUKT_TS, "export const a = (wert: boolean): object => ({ ok: wert });\n"));
test("Ergebnisregel: ein Objektmuster mit Vorgabe ok false bleibt frei", () =>
  erwarteKeinen(PRODUKT_TS, "export const a = ({ ok = false }: { ok?: boolean }): boolean => ok;\n"));
test("Ergebnisregel: ein Spread im Objektliteral bleibt frei", () =>
  erwarteKeinen(PRODUKT_TS, "export const a = (rest: object): object => ({ ...rest });\n"));

test("Ergebnisregel: der Helfer src/utils/ergebnis.ts ist frei", () =>
  erwarteKeinen(HELFER, readFileSync(resolve(WURZEL, HELFER), "utf8")));
test("Ergebnisregel: eine .js-Datei unter src ist frei", () => erwarteKeinen("src/probe-ergebnis.js", LITERAL_JS));
test("Ergebnisregel: eine .ts-Datei unter test ist frei", () =>
  erwarteKeinen("test/anrufe/6183-anrufstart.test.ts", LITERAL));

test("Ergebnisregel: gilt als Fehler auch für .mts und .cts unter src", async () => {
  for (const datei of ["src/probe-ergebnis.mts", "src/probe-ergebnis.cts"]) {
    const einstellung = await eslint.calculateConfigForFile(resolve(WURZEL, datei));
    assert.equal(einstellung.rules[REGEL]?.[0], 2, `Ergebnisregel: ${datei} ist nicht geprüft`);
  }
});

test("Ergebnisregel: keine Bestandsliste und keine Unterdrückung für die Regel", () => {
  const ablagen = [
    "eslint-suppressions.json",
    "tools/bausteine.json",
    ...readdirSync(resolve(WURZEL, "tools/basis")).map((datei) => `tools/basis/${datei}`),
  ];
  for (const ablage of ablagen)
    assert.equal(readFileSync(resolve(WURZEL, ablage), "utf8").includes("ergebnis-nur-aus-helfer"), false, ablage);
});

test("Ergebnisregel: unter src ist in keiner .ts-Datei ein Treffer", async () => {
  const ergebnisse = await eslint.lintFiles(["src/**/*.ts"]);
  assert.ok(ergebnisse.length > 1);
  const treffer = ergebnisse.flatMap(({ filePath, messages }) =>
    messages.filter((meldung) => meldung.ruleId === REGEL || meldung.fatal).map(({ line }) => `${filePath}:${line}`),
  );
  assert.deepEqual(treffer, []);
  const einstellung = await eslint.calculateConfigForFile(resolve(WURZEL, PRODUKT_TS));
  assert.equal(einstellung.rules[REGEL]?.[0], 2);
});
