import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { aufgeteilt } from "./mutationspruefung-hilfen.js";
import { EXIT_ROT } from "./mutationspruefung-probe.js";
import { commitAll, gitAusgabe, probeDirectory, probeRepository, setzeUmgebung, writeFiles } from "./probe-repo.js";
import {
  ALLGEMEIN,
  ALTE_SEITE,
  FREMDE_EINTRAEGE,
  FREMDER_TENANT,
  GEAENDERTE_OFFSET_ZEILE,
  MIT_WIRKUNG,
  NEUE_SEITE,
  NORMAL,
  OFFSET,
  OHNE_WIRKUNG,
  TENANT,
  UNVERAENDERTE_MANDANTENZEILE,
  ZWEITE_MIT_WIRKUNG,
  ZWEITE_OHNE_WIRKUNG,
  geaendert,
  quelle,
  seitentest,
} from "./schutzwirkung-probe.js";

function urteil(context, repo) {
  const { urteil: lauf } = aufgeteilt(context, repo, { basis: "HEAD" });
  const zeilen = (anfang) => lauf.stdout.split("\n").filter((zeile) => zeile.startsWith(anfang));
  return { lauf, meldung: lauf.stdout + lauf.stderr, zeilen };
}

test("(a) ein Schutztest, der einen Mutanten seiner Zeile tötet, ist im Mutationsurteil wirksam und das Urteil grün", (context) => {
  const { lauf, meldung, zeilen } = urteil(context, geaendert(context, quelle(TENANT, OFFSET, NEUE_SEITE), ...ALLGEMEIN, MIT_WIRKUNG));
  assert.equal(lauf.status, 0, meldung);
  assert.deepEqual(zeilen("Schutztest wirksam: "), ["Schutztest wirksam: [NIE1] offset x20 ist 400"]);
  assert.deepEqual(zeilen("Verstoß: "), []);
  assert.deepEqual(zeilen("grün: 1 Schutztests"), ["grün: 1 Schutztests, 0 ohne nachgewiesene Wirkung."]);
});

test("(b) ein Schutztest, der die neuen Zeilen durchläuft und keinen Mutanten tötet, macht das Mutationsurteil rot", (context) => {
  const { lauf, meldung, zeilen } = urteil(context, geaendert(context, quelle(TENANT, OFFSET, NEUE_SEITE), ...ALLGEMEIN, OHNE_WIRKUNG));
  assert.equal(lauf.status, EXIT_ROT, meldung);
  assert.deepEqual(zeilen("Verstoß: "), ["Verstoß: Schutztest wirkungslos: [NIE1] offset 1.5 liefert keine Seite"]);
  assert.deepEqual(zeilen("rot: 1 Schutztests"), ["rot: 1 Schutztests, 1 ohne nachgewiesene Wirkung."]);
  assert.match(meldung, /^Wozu: Ein Schutztest hält seinen Satz/m, "das rote Urteil nennt den Zweck der Schutzwirkung");
});

test("(b) wie B3a L2: von drei Schutztests macht der wirkungslose erste und dritte das Urteil rot, der wirksame zweite nicht", (context) => {
  const faelle = [OHNE_WIRKUNG, ZWEITE_MIT_WIRKUNG, ZWEITE_OHNE_WIRKUNG];
  const { lauf, meldung, zeilen } = urteil(context, geaendert(context, quelle(TENANT, OFFSET, NEUE_SEITE), ...ALLGEMEIN, ...faelle));
  assert.equal(lauf.status, EXIT_ROT, meldung);
  assert.deepEqual(zeilen("Verstoß: "), ["Verstoß: Schutztest wirkungslos: [NIE1] offset 1.5 liefert keine Seite", "Verstoß: Schutztest wirkungslos: [NIE3] offset 2.5 liefert keine Seite"]);
  assert.deepEqual(zeilen("Schutztest wirksam: "), ["Schutztest wirksam: [NIE2] offset a ist 400"]);
  assert.deepEqual(zeilen("rot: 3 Schutztests"), ["rot: 3 Schutztests, 2 ohne nachgewiesene Wirkung."]);
});

test("(c) ein Schutztest, der keine neue Zeile erreicht, ist nur ein Hinweis und kein Verstoß", (context) => {
  const { lauf, meldung, zeilen } = urteil(context, geaendert(context, quelle(TENANT, OFFSET, NEUE_SEITE), ...ALLGEMEIN, FREMDER_TENANT));
  assert.equal(lauf.status, 0, meldung);
  assert.deepEqual(zeilen("Hinweis: Schutztest"), ["Hinweis: Schutztest erreicht keine neue Zeile, Wirkung nicht prüfbar: [NIE1] fremder Tenant bekommt 403"]);
  assert.deepEqual(zeilen("Verstoß: "), []);
});

test("(d) ein Pull Request ohne Schutztest mit [NIE]-Kennung bekommt keine Zeile zur Schutzwirkung, das Urteil bleibt unverändert", (context) => {
  const { lauf, meldung } = urteil(context, geaendert(context, quelle(TENANT, OFFSET, NEUE_SEITE), ...ALLGEMEIN, MIT_WIRKUNG.replace("[NIE1] ", "")));
  assert.equal(lauf.status, 0, meldung);
  assert.doesNotMatch(meldung, /Schutztest|Schutztests|Schutzwirkung|Alter Schutz/);
});

test("ein übersprungener [NIE]-Fall zählt nicht als Schutztest", (context) => {
  const uebersprungen = MIT_WIRKUNG.replace("test(", "test.skip(");
  const { lauf, meldung } = urteil(context, geaendert(context, quelle(TENANT, OFFSET, NEUE_SEITE), ...ALLGEMEIN, uebersprungen));
  assert.equal(lauf.status, 0, meldung);
  assert.doesNotMatch(meldung, /Verstoß: Schutztest/);
});

const ALTER_SCHUTZ_NACHRICHT = "Fasse die Seitenprüfung zusammen\n\nWarum: ein Test.\nAlter Schutz: [NIE1] src/seite.js:ZEILE, weil der Mandantenvergleich dort den fremden Tenant abweist\n";

function mitAnspruch(context, zeilenummer) {
  const repo = probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    "src/seite.js": quelle(TENANT, ALTE_SEITE),
    "test/seite.test.js": seitentest(NORMAL),
  });
  writeFiles(repo, { "src/seite.js": quelle(OFFSET, TENANT, NEUE_SEITE), "test/seite.test.js": seitentest(NORMAL, ...ALLGEMEIN, FREMDE_EINTRAEGE) });
  commitAll(repo, ALTER_SCHUTZ_NACHRICHT.replace("ZEILE", String(zeilenummer)));
  return repo;
}

test("alter Schutz aus der Commit-Nachricht gilt im Urteil nur, wenn der Fall Mutanten genau dieser unveränderten Zeile tötet", (context) => {
  const ohne = geaendert(context, quelle(OFFSET, TENANT, NEUE_SEITE), ...ALLGEMEIN, FREMDE_EINTRAEGE);
  const ohneAnspruch = aufgeteilt(context, ohne, { basis: "HEAD" }).urteil;
  assert.equal(ohneAnspruch.status, EXIT_ROT, ohneAnspruch.stdout + ohneAnspruch.stderr);
  const belegt = aufgeteilt(context, mitAnspruch(context, UNVERAENDERTE_MANDANTENZEILE), { basis: "HEAD~1" }).urteil;
  assert.equal(belegt.status, 0, belegt.stdout + belegt.stderr);
  assert.match(belegt.stdout, /^Hinweis: Schutz im alten Code belegt \(src\/seite\.js:3\): \[NIE1\] fremder Tenant sieht keine Einträge$/m);
});

test("alter Schutz aus der Commit-Nachricht auf einer geänderten Zeile bleibt ein Verstoß", (context) => {
  const lauf = aufgeteilt(context, mitAnspruch(context, GEAENDERTE_OFFSET_ZEILE), { basis: "HEAD~1" }).urteil;
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Alter Schutz nicht belegt \(src\/seite\.js:2 ist seit der Basis geändert\): \[NIE1\] fremder Tenant sieht keine Einträge$/m);
});

const UMBAU_FALL = "[NIE2] ein durchgereichter Runner wird unverändert benutzt";

function auftragsCommit(repo, dateien, auftrag) {
  writeFiles(repo, dateien);
  commitAll(repo, `Baue ${auftrag}\n\nWarum: Probe.\n\nAuftrag: ${auftrag}\nArt: aenderung\n`);
  return gitAusgabe(repo, "rev-parse", "HEAD");
}

function umbauOhneMutanten(context) {
  const repo = probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    "src/anlage.js": "export function anlage(x) {\n  return x;\n}\n",
    "src/umbau.js": "export function umbau(r) {\n  return r;\n}\n",
    "test/anlage.test.js": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { anlage } from "../src/anlage.js";\ntest("eins bleibt eins", () => assert.equal(anlage(1), 1));\n',
  });
  const basis = gitAusgabe(repo, "rev-parse", "HEAD");
  auftragsCommit(
    repo,
    {
      "src/anlage.js": "export function anlage(x) {\n  if (x === null) return 0;\n  return x;\n}\n",
      "test/anlage.test.js": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { anlage } from "../src/anlage.js";\ntest("eins bleibt eins", () => assert.equal(anlage(1), 1));\ntest("null wird 0", () => assert.equal(anlage(null), 0));\n',
    },
    "P-1/a1",
  );
  const umbau = auftragsCommit(
    repo,
    {
      "src/umbau.js": "export function umbau(r) {\n  const runner = r;\n  return runner;\n}\n",
      "test/umbau.test.js": `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { anlage } from "../src/anlage.js";\nimport { umbau } from "../src/umbau.js";\ntest(${JSON.stringify(UMBAU_FALL)}, () => {\n  anlage(2);\n  assert.equal(umbau(5), 5);\n});\n`,
    },
    "P-1/u1",
  );
  return { repo, basis, umbau };
}

test("ein Umbau-Fall ohne Mutanten in den Zeilen seines Auftrags lässt das Mutationsurteil auf den Prüf-Agenten warten: Exit 1 ohne rot-Zeile und Verstoß, mit nicht-pruefbar.json", (context) => {
  const { repo, basis, umbau } = umbauOhneMutanten(context);
  const datei = join(probeDirectory(context, {}), "nicht-pruefbar.json");
  setzeUmgebung(context, { NICHT_PRUEFBAR_DATEI: datei, EVENT_NAME: "workflow_dispatch" });
  const lauf = aufgeteilt(context, repo, { basis }).urteil;
  const meldung = lauf.stdout + lauf.stderr;
  assert.equal(lauf.status, EXIT_ROT, meldung);
  const zeilen = lauf.stdout.split("\n");
  assert.ok(zeilen.includes(`Schutzwirkung nicht prüfbar (Auftrag P-1/u1, 0 Mutanten in seinen Zeilen): ${UMBAU_FALL}`), meldung);
  assert.ok(zeilen.includes("wartet auf Prüf-Agent: 1 von 1 Schutztests nicht prüfbar, ohne Freigabe."), meldung);
  assert.deepEqual(zeilen.filter((zeile) => zeile.startsWith("rot: ") || zeile.startsWith("Verstoß: ")), [], meldung);
  assert.doesNotMatch(meldung, /^Wozu: Ein Schutztest hält seinen Satz/m, "der Zweck des wirkungslosen Schutztests gehört nicht zum Warten");
  const eintraege = JSON.parse(readFileSync(datei, "utf8"));
  assert.deepEqual(eintraege, [{ fall: UMBAU_FALL, testdatei: "test/umbau.test.js", auftrag: "P-1/u1", commit: umbau, zeilen: [{ datei: "src/umbau.js", von: 2, bis: 3 }], freigegeben: false }]);
});
