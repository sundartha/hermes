import assert from "node:assert/strict";
import { test } from "node:test";

import { ABSCHALTEN_NAECHSTE, EXIT_ABBRUCH, EXIT_ROT, pruefe } from "./mutationspruefung-hilfen.js";
import { probeRepository, writeFiles } from "./probe-repo.js";

const KOPF = "export function seite(eintraege, offset, tenant, besitzer) {";
const TENANT = "  if (tenant !== besitzer) return { status: 403 };";
const OFFSET = '  if (!/^\\d+$/.test(offset)) return { status: 400, fehler: "offset" };';
const ALTE_SEITE = "  return { status: 200, eintraege: eintraege.slice(offset) };";
const NEUE_SEITE = "  return { status: 200, eintraege: eintraege.slice(Number(offset)) };";
const NORMAL = 'test("normal", () => assert.deepEqual(seite(L, "1", "t", "t").eintraege, ["b", "c"]));';
const NEGATIV = 'test("negatives offset ist 400", () => assert.equal(seite(L, "-1", "t", "t").status, 400));';
const OHNE_WIRKUNG = 'test("[NIE1] offset 1.5 liefert keine Seite", () => assert.notDeepEqual(seite(L, "1.5", "t", "t").eintraege, "a"));';
const MIT_WIRKUNG = 'test("[NIE1] offset x20 ist 400", () => assert.equal(seite(L, "x20", "t", "t").status, 400));';
const FREMDER_TENANT = 'test("[NIE1] fremder Tenant bekommt 403", () => assert.equal(seite(L, "0", "t", "u").status, 403));';
const FREMDE_EINTRAEGE = 'test("[NIE1] fremder Tenant sieht keine Einträge", () => assert.equal(seite(L, "0", "t", "u").eintraege, undefined));';

function quelle(...zeilen) {
  return [KOPF, ...zeilen, "}", ""].join("\n");
}

function seitentest(...faelle) {
  return [
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    'import { seite } from "../src/seite.js";',
    'const L = ["a", "b", "c"];',
    ...faelle,
    "",
  ].join("\n");
}

function geaendert(context, quelltext, ...faelle) {
  const repo = probeRepository(context, {
    "package.json": '{ "type": "module" }\n',
    "src/seite.js": quelle(TENANT, ALTE_SEITE),
    "test/seite.test.js": seitentest(NORMAL),
  });
  writeFiles(repo, { "src/seite.js": quelltext, "test/seite.test.js": seitentest(NORMAL, ...faelle) });
  return repo;
}

function stelle(quelltext, zeile) {
  return `[NIE1] src/seite.js:${quelltext.split("\n").indexOf(zeile) + 1}`;
}

function zeilen(ausgabe, anfang) {
  return ausgabe.split("\n").filter((zeile) => zeile.startsWith(anfang));
}

test("ein Schutztest, der die neue Prüfung erreicht, aber keinen ihrer Mutanten tötet, ist ein Verstoß", (context) => {
  const repo = geaendert(context, quelle(TENANT, OFFSET, NEUE_SEITE), NEGATIV, OHNE_WIRKUNG);
  const rot = pruefe(repo, "--basis", "HEAD", "--schutzwirkung");
  assert.equal(rot.status, EXIT_ROT, rot.stdout + rot.stderr);
  assert.deepEqual(zeilen(rot.stdout, "Verstoß: "), ["Verstoß: Schutztest wirkungslos: [NIE1] offset 1.5 liefert keine Seite"]);
});

test("ein Schutztest, der einen Mutanten der neuen Zeilen tötet, ist wirksam", (context) => {
  const repo = geaendert(context, quelle(TENANT, OFFSET, NEUE_SEITE), MIT_WIRKUNG);
  const gruen = pruefe(repo, "--basis", "HEAD", "--schutzwirkung");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
  assert.deepEqual(zeilen(gruen.stdout, "Schutztest wirksam: "), ["Schutztest wirksam: [NIE1] offset x20 ist 400"]);
  assert.equal(zeilen(gruen.stdout, "src/seite.js: ").length, 1, "ein im gemeinsamen Lauf tötender Fall braucht keinen eigenen Lauf");
});

const FREMDER_TENANT_UNERREICHT = "Hinweis: Schutztest erreicht keine neue Zeile, Wirkung nicht prüfbar: [NIE1] fremder Tenant bekommt 403";

function fremderTenant(context, quelltext) {
  const repo = geaendert(context, quelltext, FREMDER_TENANT);
  const ergebnis = pruefe(repo, "--basis", "HEAD", "--schutzwirkung");
  return { status: ergebnis.status, hinweise: zeilen(ergebnis.stdout, "Hinweis: ") };
}

test("ein Schutztest für Schutz im unveränderten Code, der keine neue Zeile erreicht, ist kein Verstoß", (context) => {
  assert.deepEqual(fremderTenant(context, quelle(TENANT, OFFSET, NEUE_SEITE)), { status: 0, hinweise: [FREMDER_TENANT_UNERREICHT] });
});

test("abgeschaltete Mutanten in neuen Zeilen zählen nicht als erreicht", (context) => {
  assert.deepEqual(fremderTenant(context, quelle(TENANT, ABSCHALTEN_NAECHSTE, OFFSET, ALTE_SEITE)), { status: 0, hinweise: [FREMDER_TENANT_UNERREICHT] });
});

test("ohne neue Zeile unter src/ ist die Wirkung eines Schutztests nicht prüfbar und kein Verstoß", (context) => {
  const repo = geaendert(context, quelle(TENANT, ALTE_SEITE), OHNE_WIRKUNG);
  const gruen = pruefe(repo, "--basis", "HEAD", "--schutzwirkung");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
  assert.deepEqual(zeilen(gruen.stdout, "Hinweis: "), ["Hinweis: Wirkung der Schutztests nicht prüfbar, keine neue oder geänderte Zeile unter src/."]);
});

test("ohne neuen aktiven Schutztest ist die Wirkung nicht prüfbar, ein übersprungener [NIE]-Fall zählt nicht", (context) => {
  const uebersprungen = 'test.skip("[NIE1] offset x20 ist 400", () => assert.equal(seite(L, "x20", "t", "t").status, 400));';
  const repo = geaendert(context, quelle(TENANT, OFFSET, NEUE_SEITE), NEGATIV, uebersprungen);
  const gruen = pruefe(repo, "--basis", "HEAD", "--schutzwirkung");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
  assert.deepEqual(zeilen(gruen.stdout, "Hinweis: "), ["Hinweis: Wirkung der Schutztests nicht prüfbar, kein neuer Fall mit [NIE<n>]-Kennung."]);
});

test("alter Schutz gilt nur, wenn der Fall Mutanten der genannten unveränderten Zeile tötet", (context) => {
  const quelltext = quelle(OFFSET, TENANT, NEUE_SEITE);
  const repo = geaendert(context, quelltext, FREMDE_EINTRAEGE);
  const ohne = pruefe(repo, "--basis", "HEAD", "--schutzwirkung");
  assert.equal(ohne.status, EXIT_ROT, ohne.stdout + ohne.stderr);
  const belegt = pruefe(repo, "--basis", "HEAD", "--schutzwirkung", "--alter-schutz", stelle(quelltext, TENANT));
  assert.equal(belegt.status, 0, belegt.stdout + belegt.stderr);
  assert.deepEqual(zeilen(belegt.stdout, "Hinweis: "), ["Hinweis: Schutz im alten Code belegt (src/seite.js:3): [NIE1] fremder Tenant sieht keine Einträge"]);
  const neueZeile = pruefe(repo, "--basis", "HEAD", "--schutzwirkung", "--alter-schutz", stelle(quelltext, OFFSET));
  assert.equal(neueZeile.status, EXIT_ROT, neueZeile.stdout + neueZeile.stderr);
  assert.deepEqual(zeilen(neueZeile.stdout, "Verstoß: "), ["Verstoß: Alter Schutz nicht belegt (src/seite.js:2 ist seit der Basis geändert): [NIE1] fremder Tenant sieht keine Einträge"]);
});

test("alter Schutz bleibt ein Verstoß, wenn der Fall an der genannten Zeile nichts tötet oder die Datei fehlt", (context) => {
  const quelltext = quelle(TENANT, OFFSET, NEUE_SEITE);
  const repo = geaendert(context, quelltext, OHNE_WIRKUNG);
  const ohneTreffer = pruefe(repo, "--basis", "HEAD", "--schutzwirkung", "--alter-schutz", stelle(quelltext, TENANT));
  assert.equal(ohneTreffer.status, EXIT_ROT, ohneTreffer.stdout + ohneTreffer.stderr);
  assert.deepEqual(zeilen(ohneTreffer.stdout, "Verstoß: "), ["Verstoß: Alter Schutz nicht belegt (src/seite.js:2, der Fall tötet dort keinen Mutanten): [NIE1] offset 1.5 liefert keine Seite"]);
  const ohneDatei = pruefe(repo, "--basis", "HEAD", "--schutzwirkung", "--alter-schutz", "[NIE1] src/fehlt.js:2");
  assert.equal(ohneDatei.status, EXIT_ROT, ohneDatei.stdout + ohneDatei.stderr);
  assert.deepEqual(zeilen(ohneDatei.stdout, "Verstoß: "), ["Verstoß: Alter Schutz nicht belegt (src/fehlt.js:2 gibt es nicht): [NIE1] offset 1.5 liefert keine Seite"]);
});

test("eine Altschutz-Angabe in falscher Form, doppelt oder ohne --schutzwirkung bricht ab, statt zu prüfen", (context) => {
  const repo = geaendert(context, quelle(TENANT, OFFSET, NEUE_SEITE), OHNE_WIRKUNG);
  const falscheForm = pruefe(repo, "--basis", "HEAD", "--schutzwirkung", "--alter-schutz", "NIE1 irgendwo");
  assert.equal(falscheForm.status, EXIT_ABBRUCH, falscheForm.stdout + falscheForm.stderr);
  assert.match(falscheForm.stderr, /--alter-schutz hat nicht die Form \[NIE1\] src\/DATEI:ZEILE/);
  const doppelt = pruefe(repo, "--basis", "HEAD", "--schutzwirkung", "--alter-schutz", "[NIE1] src/seite.js:2", "--alter-schutz", "[NIE1] src/seite.js:3");
  assert.equal(doppelt.status, EXIT_ABBRUCH, doppelt.stdout + doppelt.stderr);
  assert.match(doppelt.stderr, /--alter-schutz nennt dieselbe Kennung mehr als einmal/);
  const ohneModus = pruefe(repo, "--basis", "HEAD", "--alter-schutz", "[NIE1] src/seite.js:2");
  assert.equal(ohneModus.status, EXIT_ABBRUCH, ohneModus.stdout + ohneModus.stderr);
  assert.match(ohneModus.stderr, /^Aufruf: /m);
});
