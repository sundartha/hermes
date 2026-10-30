import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const WERKZEUG = join(REPO_ROOT, "tools/test-statisch.mjs");
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_ABBRUCH = 2;
const ALS_MODUL = { "package.json": '{ "type": "module" }\n' };
const ECHTE_WARTEZEITEN = "tools/basis/echte-wartezeiten.json";
const OHNE_EINTRAG = { [ECHTE_WARTEZEITEN]: "[]\n" };
const KOPF = ['import assert from "node:assert/strict";', 'import { test } from "node:test";'];
const SCHLEIFE = [...KOPF, "for (const nummer of [1, 2]) {", "  test(`fall ${nummer}`, () => {", "    assert.ok(nummer > 0);", "  });", "}", ""].join("\n");
const FESTER_NAME = 'test("fester Fall", () => {\n  assert.ok(true);\n});\n';
const WARTET = [...KOPF, 'import { echtWarten } from "./echt-warten.js";', 'test("wartet", async () => {', "  await echtWarten(300);", "  assert.ok(true);", "});", ""].join("\n");
const EINTRAG_300 = [{ datei: "test/warte.test.js", argument: "300", hoechstwert_ms: 300, grund: "Probe" }];
const OHNE_NAMEN = /^Verstoß: Test ohne festen Namen: test\/schleife\.test\.js › `fall \$\{nummer\}`$/m;
const OHNE_LISTENEINTRAG = /^Verstoß: test\/warte\.test\.js: echtWarten\(300\): 300 ms, über 100 ms nur mit Eintrag in tools\/basis\/echte-wartezeiten\.json$/m;
const VERWAIST = /^Verstoß: tools\/basis\/echte-wartezeiten\.json: Eintrag test\/warte\.test\.js: echtWarten\(300\) passt zu keinem Aufruf über 100 ms$/m;

function pruefeNach(context, vorher, nachher) {
  const repo = probeRepository(context, { ...ALS_MODUL, ...vorher });
  writeFiles(repo, nachher);
  commitAll(repo, "Änderung");
  return runIn(repo, process.execPath, [WERKZEUG, "--basis", "HEAD~1"]);
}

test("eine neue Testdatei mit Template-Namen macht die statische Testprüfung rot, mit derselben Meldung wie die Testwirkung in CI", (context) => {
  const lauf = pruefeNach(context, OHNE_EINTRAG, { "test/schleife.test.js": SCHLEIFE });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, OHNE_NAMEN);
  assert.ok(lauf.stdout.includes(zweckBlock("tests/statisch").join("\n")), lauf.stdout);
});

test("ein Template-Name, der schon auf der Basis stand, macht die statische Testprüfung nicht rot", (context) => {
  const lauf = pruefeNach(context, { ...OHNE_EINTRAG, "test/schleife.test.js": SCHLEIFE }, { "test/schleife.test.js": `${SCHLEIFE}${FESTER_NAME}` });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stdout, /Verstoß:/);
  assert.doesNotMatch(lauf.stdout, /Wozu:/);
});

const WEB_TEST = "apps/web/test/schleife.test.js";

test("ein neuer Test der Web-App mit Template-Namen macht die statische Testprüfung rot", (context) => {
  const lauf = pruefeNach(context, OHNE_EINTRAG, { [WEB_TEST]: SCHLEIFE });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Test ohne festen Namen: apps\/web\/test\/schleife\.test\.js › `fall \$\{nummer\}`$/m);
});

test("ein neuer Test der Web-App mit festem Namen lässt die statische Testprüfung grün", (context) => {
  const lauf = pruefeNach(context, OHNE_EINTRAG, { [WEB_TEST]: `${KOPF.join("\n")}\n${FESTER_NAME}` });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stdout, /Verstoß:/);
});

test("ein Template-Name der Web-App, der schon auf der Basis stand, macht die statische Testprüfung nicht rot", (context) => {
  const lauf = pruefeNach(context, { ...OHNE_EINTRAG, [WEB_TEST]: SCHLEIFE }, { [WEB_TEST]: `${SCHLEIFE}${FESTER_NAME}` });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stdout, /Verstoß:/);
});

test("echtWarten(300) ohne Eintrag in der Basisliste macht die statische Testprüfung rot", (context) => {
  const lauf = pruefeNach(context, OHNE_EINTRAG, { "test/warte.test.js": WARTET });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, OHNE_LISTENEINTRAG);
});

test("echtWarten(300) mit passendem Eintrag in der Basisliste lässt die statische Testprüfung grün", (context) => {
  const lauf = pruefeNach(context, { [ECHTE_WARTEZEITEN]: JSON.stringify(EINTRAG_300) }, { "test/warte.test.js": WARTET });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stdout, /Verstoß:/);
});

test("ein Eintrag in der Basisliste ohne passenden Aufruf macht die statische Testprüfung rot wie in CI", (context) => {
  const lauf = pruefeNach(context, { [ECHTE_WARTEZEITEN]: JSON.stringify(EINTRAG_300) }, { "test/anders.test.js": `${KOPF.join("\n")}\n${FESTER_NAME}` });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, VERWAIST);
});

test("ohne Basisliste gilt keine Wartezeit über 100 ms als erlaubt", (context) => {
  const lauf = pruefeNach(context, {}, { "test/warte.test.js": WARTET });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, OHNE_LISTENEINTRAG);
});

test("ohne --basis bricht die statische Testprüfung mit dem Aufruf ab", (context) => {
  const repo = probeRepository(context, ALS_MODUL);
  const lauf = runIn(repo, process.execPath, [WERKZEUG]);
  assert.equal(lauf.status, EXIT_ABBRUCH, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /^Abbruch: --basis fehlt oder ist leer\. Aufruf: node tools\/test-statisch\.mjs --basis <commit>$/m);
});

test("ci:lokal fährt die statische Testprüfung bei jedem Lauf gegen die Basis, nicht erst mit den teuren Schritten", () => {
  const { schritte } = JSON.parse(readFileSync(join(REPO_ROOT, "tools/ci-lokal.json"), "utf8"));
  const schritt = schritte.find(({ befehl }) => befehl === 'node tools/test-statisch.mjs --basis "$BASIS"');
  assert.ok(schritt, JSON.stringify(schritte.map(({ name }) => name)));
  assert.notEqual(schritt.teuer, true);
  assert.equal(schritt.werkzeug, undefined);
  assert.deepEqual(schritt.ci, [".github/workflows/ci.yml › pruefungen › Statische Testprüfung"]);
});
