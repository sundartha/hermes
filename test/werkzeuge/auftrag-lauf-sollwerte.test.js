import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import { test } from "node:test";

import { setzeSollwerte, sollwerteZuruecknehmen } from "../../tools/auftrag/sollwerte.mjs";

import { BASIS, EXIT_ROT, ghSkript, starte } from "./auftrag-lauf-probe.js";
import { probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const ISSUE = 54;
const PRODUKT = "src/ausgabe.js";
const GEPINNT = "test/ausgabe.test.js";
const ABNAHME = "test/ausgabe-neu.test.js";
const ANDERER = "test/anderes.test.js";
const ALT = "alt";
const NEU = "neu";
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const sha1 = (text) => createHash("sha1").update(text).digest("hex");
const ausgabe = (wert) => `export function ausgabe() {\n  return "${wert}";\n}\n`;
const KOPF = ['import assert from "node:assert/strict";', 'import { createHash } from "node:crypto";', 'import { test } from "node:test";', 'import { ausgabe } from "../src/ausgabe.js";'];
const HASH_FALL = (verfahren) => `test("Ausgabe gleicht dem gepinnten Sollwert", () => assert.equal(createHash("${verfahren}").update(ausgabe()).digest("hex"), SOLL));`;
const gepinnt = ({ soll = sha256(ALT), verfahren = "sha256", weitere = [] } = {}) => [...KOPF, `const SOLL = "${soll}";`, HASH_FALL(verfahren), ...weitere, ""].join("\n");
const SOLL_ZEILE = KOPF.length + 1;
const AUFTRAG = {
  id: "A1",
  art: "funktion",
  ziel: "Gib neu aus",
  bereich: PRODUKT,
  erwarteteDateien: [PRODUKT, ABNAHME],
  abnahme: ABNAHME,
  erwarteterFehler: "'alt' !== 'neu'",
  wasDarfNiePassieren: [],
};
const ROTER_TEST = { [ABNAHME]: [...KOPF.filter((zeile) => !zeile.includes("crypto")), 'test("gibt neu aus", () => assert.equal(ausgabe(), "neu"));', ""].join("\n") };
const PAKET = JSON.stringify({ type: "module", scripts: { ...JSON.parse(BASIS["package.json"]).scripts, "test:betroffen": "node --test #" } });
const HALT = { phase: "probe", auftrag: "A1", runde: 1, entscheidung: { text: `Alter Test ${GEPINNT}` }, alterTest: { datei: GEPINNT } };

function freigabeIssue(liste) {
  const body = ["## Absicht", "", "Neue Ausgabe.", "", "## Tests, deren Erwartung sich ändern darf", "", ...liste.map((pfad) => `- \`${pfad}\``)].join("\n");
  const label = { __typename: "LabeledEvent", createdAt: "2026-10-01T10:00:00Z", actor: { login: "Antonio20045" }, label: { name: "verhalten-geaendert" } };
  return { data: { repository: { issue: { number: ISSUE, body, lastEditedAt: null, timelineItems: { nodes: [label] } } } } };
}

function sollwertLauf(context, { test: alterTest = gepinnt(), frei = [GEPINNT] } = {}) {
  const gh = ghSkript(probeDirectory(context, {}), `process.stdout.write(${JSON.stringify(JSON.stringify(freigabeIssue(frei)))});`);
  const dateien = { "package.json": PAKET, [PRODUKT]: ausgabe(ALT), [GEPINNT]: alterTest, ".fortschritt/probe/A1.json": JSON.stringify(HALT) };
  const lauf = starte(context, { auftrag: AUFTRAG, drehbuch: { test: ROTER_TEST, bau: { [PRODUKT]: ausgabe(NEU) } }, dateien, umgebung: gh });
  const nachricht = runIn(lauf.repo, "git", ["log", "-1", "--format=%B"]).stdout;
  const baubrief = join(lauf.werkzeug, "prompt-bau.txt");
  const ersteRunde = join(lauf.repo, ".fortschritt/probe/A1.runde-1.json");
  return { ...lauf, nachricht, ersteRunde: existsSync(ersteRunde) ? JSON.parse(readFileSync(ersteRunde, "utf8")) : null, test: readFileSync(join(lauf.repo, GEPINNT), "utf8"), baubrief: existsSync(baubrief) ? readFileSync(baubrief, "utf8") : "" };
}

function unveraendertRot(ergebnis, vorher) {
  assert.equal(ergebnis.lauf.status, EXIT_ROT, ergebnis.lauf.stdout + ergebnis.lauf.stderr);
  assert.equal(ergebnis.test, vorher);
  assert.equal(ergebnis.beleg.ergebnis, "rot");
  const { pruefungen, sollwerte } = ergebnis.ersteRunde;
  assert.deepEqual(sollwerte, []);
  assert.equal(pruefungen.find(({ name }) => name === "betroffene tests").exitCode, 1);
  assert.doesNotMatch(ergebnis.nachricht, /von lauf gesetzt/);
  return pruefungen.find(({ name }) => name === "sollwerte")?.zeilen.join("\n") ?? null;
}

test("Sollwert: ist die Datei freigegeben und weicht nur der 64-stellige Hash ab, setzt lauf ihn auf den gebauten Stand, protokolliert ihn und der Auftrag wird grün", (context) => {
  const ergebnis = sollwertLauf(context);
  assert.equal(ergebnis.lauf.status, 0, ergebnis.lauf.stdout + ergebnis.lauf.stderr);
  assert.equal(ergebnis.test, gepinnt({ soll: sha256(NEU) }));
  const zeile = `${GEPINNT}:${SOLL_ZEILE} ${sha256(ALT)} → ${sha256(NEU)}, von lauf gesetzt`;
  const { sollwerte, pruefungen } = ergebnis.beleg;
  assert.deepEqual(sollwerte, [zeile]);
  assert.deepEqual(pruefungen.find(({ name }) => name === "sollwerte").zeilen, [zeile]);
  assert.ok(ergebnis.nachricht.split("\n").includes(zeile), ergebnis.nachricht);
  assert.match(ergebnis.baubrief, /Freigegebene Sollwert-Hashes[\s\S]*test\/ausgabe\.test\.js/);
  const namen = pruefungen.map(({ name }) => name);
  assert.ok(namen.indexOf("sollwerte") < namen.indexOf("betroffene tests"), namen.join(", "));
});

test("Sollwert: ohne Freigabe der Datei setzt lauf nichts, und die Datei bleibt rot wie heute", (context) => {
  const ergebnis = sollwertLauf(context, { frei: [ANDERER] });
  assert.equal(unveraendertRot(ergebnis, gepinnt()), null);
  assert.doesNotMatch(ergebnis.baubrief, /Sollwert-Hashes/);
});

test("Sollwert: ist die Datei freigegeben, aber ein weiterer Fall weicht nicht nur im Hash ab, setzt lauf nichts und bleibt rot", (context) => {
  const alterTest = gepinnt({ weitere: ['test("Ausgabe bleibt alt", () => assert.equal(ausgabe(), "alt"));'] });
  const ergebnis = sollwertLauf(context, { test: alterTest });
  assert.match(unveraendertRot(ergebnis, alterTest), /„Ausgabe bleibt alt“ ist nicht nur an einem 64-stelligen Hex-Sollwert rot/);
});

test("Sollwert: hält ein freigegebener Fall neben dem Hash eine weitere abweichende Zusicherung fest, nimmt lauf den gesetzten Wert zurück", (context) => {
  const zweiteZusicherung = `test("Ausgabe gleicht dem Sollwert und bleibt alt", () => { assert.equal(createHash("sha256").update(ausgabe()).digest("hex"), SOLL); assert.equal(ausgabe(), "alt"); });`;
  const alterTest = [...KOPF, `const SOLL = "${sha256(ALT)}";`, zweiteZusicherung, ""].join("\n");
  const ergebnis = sollwertLauf(context, { test: alterTest });
  assert.match(unveraendertRot(ergebnis, alterTest), /bleibt die Datei rot .*lauf nimmt sie zurück/);
});

test("Sollwert: ein festgehaltener Wert, der kein 64-stelliges Hex ist, wird nicht gesetzt", (context) => {
  const alterTest = gepinnt({ soll: sha1(ALT), verfahren: "sha1" });
  const ergebnis = sollwertLauf(context, { test: alterTest });
  assert.match(unveraendertRot(ergebnis, alterTest), /„Ausgabe gleicht dem gepinnten Sollwert“ ist nicht nur an einem 64-stelligen Hex-Sollwert rot/);
});

test("Sollwert: lauf nimmt seinen gesetzten Wert vor der Grenzprüfung zurück, aber nicht, wenn der Stand ihn schon festhält", (context) => {
  const kontext = env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_CONTEXT;
  context.after(() => {
    if (kontext !== undefined) env.NODE_TEST_CONTEXT = kontext;
  });
  const repo = probeRepository(context, { ...BASIS, [PRODUKT]: ausgabe(ALT), [GEPINNT]: gepinnt() });
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  writeFileSync(join(repo, PRODUKT), ausgabe(NEU));
  const { eintraege, gesetzt, befunde } = setzeSollwerte({ root: repo, basis, dateien: [GEPINNT] });
  assert.deepEqual([gesetzt.map(({ neu }) => neu), befunde], [[sha256(NEU)], []]);
  sollwerteZuruecknehmen({ root: repo, basis }, eintraege);
  assert.equal(readFileSync(join(repo, GEPINNT), "utf8"), gepinnt());
  const wieder = setzeSollwerte({ root: repo, basis, dateien: [GEPINNT] });
  runIn(repo, "git", ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "commit", "-qam", "Zwischenstand"]);
  const zwischenstand = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  sollwerteZuruecknehmen({ root: repo, basis: zwischenstand }, wieder.eintraege);
  assert.equal(readFileSync(join(repo, GEPINNT), "utf8"), gepinnt({ soll: sha256(NEU) }));
});
