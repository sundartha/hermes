import assert from "node:assert/strict";
import { test } from "node:test";

import { aufgeteilt } from "./mutationspruefung-hilfen.js";
import { EXIT_ROT } from "./mutationspruefung-probe.js";
import { commitAll, probeRepository, writeFiles } from "./probe-repo.js";
import { ALTE_SEITE, FREMDE_EINTRAEGE, FREMDER_TENANT, MIT_WIRKUNG, NEGATIV, NEUE_SEITE, NORMAL, OFFSET, OHNE_WIRKUNG, TENANT, geaendert, quelle, seitentest } from "./schutzwirkung-probe.js";

const ZWEITE_OHNE_WIRKUNG = 'test("[NIE3] offset 2.5 liefert keine Seite", () => assert.notDeepEqual(seite(L, "2.5", "t", "t").eintraege, "a"));';
const ZWEITE_MIT_WIRKUNG = 'test("[NIE2] offset a ist 400", () => assert.equal(seite(L, "a", "t", "t").status, 400));';
const ZWEISTELLIG = 'test("zweistelliges offset", () => assert.deepEqual(seite(L, "10", "t", "t").eintraege, []));';
const ZEICHEN_VOR = 'test("Zeichen vor der Zahl", () => assert.deepEqual(seite(L, "x1", "t", "t"), { status: 400, fehler: "offset" }));';
const ZEICHEN_NACH = 'test("Zeichen nach der Zahl", () => assert.equal(seite(L, "1x", "t", "t").status, 400));';
const ALLGEMEIN = [NEGATIV, ZWEISTELLIG, ZEICHEN_VOR, ZEICHEN_NACH];

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
  const belegt = aufgeteilt(context, mitAnspruch(context, 3), { basis: "HEAD~1" }).urteil;
  assert.equal(belegt.status, 0, belegt.stdout + belegt.stderr);
  assert.match(belegt.stdout, /^Hinweis: Schutz im alten Code belegt \(src\/seite\.js:3\): \[NIE1\] fremder Tenant sieht keine Einträge$/m);
});

test("alter Schutz aus der Commit-Nachricht auf einer geänderten Zeile bleibt ein Verstoß", (context) => {
  const lauf = aufgeteilt(context, mitAnspruch(context, 2), { basis: "HEAD~1" }).urteil;
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Alter Schutz nicht belegt \(src\/seite\.js:2 ist seit der Basis geändert\): \[NIE1\] fremder Tenant sieht keine Einträge$/m);
});
