import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, probeDirectory, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import { ALS_MODUL, EXIT_GRUEN, EXIT_ROT } from "./testwirkung-probe.js";
import { workflowJobLines } from "./workflow-dateien.js";

const WERKZEUG = join(REPO_ROOT, "tools/testwirkung.mjs");
const EXIT_ABBRUCH = 2;
const NUR_DAS_URTEIL = /^(?:Verstoß|Hinweis: Test|Katalogtests|Tests geänderter|Geänderte bestehende|Erreichte Zeilen|Scheitern weitergegeben|grün:|rot:)/;
const LAEUFE_ROT = /\(\d von 5 Läufen rot\)/;
const SEKUNDE_MS = 1000;
const WIEDERHOLUNGEN = 5;

function datei(...zeilen) {
  return [...zeilen, ""].join("\n");
}

function geaendertesRepo(context, vorher, nachher) {
  const repo = probeRepository(context, { ...ALS_MODUL, ...vorher });
  writeFiles(repo, nachher);
  commitAll(repo, "Änderung");
  return repo;
}

function werkzeug(repo, ...argumente) {
  return runIn(repo, process.execPath, [WERKZEUG, "--basis", "HEAD~1", ...argumente]);
}

function plan(repo, ablage) {
  const pfad = join(ablage, "plan.json");
  const lauf = werkzeug(repo, "--plan", pfad);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  return JSON.parse(readFileSync(pfad, "utf8"));
}

function ergebnisDatei(ablage, teil) {
  return join(ablage, `wirkung-teil-${teil}.json`);
}

function miss(repo, ablage, { teil, teile }) {
  const lauf = werkzeug(repo, "--teil", String(teil), "--teile", String(teile), "--ergebnis", ergebnisDatei(ablage, teil));
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
}

function urteil(repo, ablage, teile) {
  return werkzeug(repo, "--urteil", ablage, "--teile", String(teile));
}

function ueberTeile(context, repo, { vorEinemLauf = () => {} } = {}) {
  const ablage = probeDirectory(context, {});
  const { anzahl, teile } = plan(repo, ablage);
  vorEinemLauf();
  for (const teil of teile) miss(repo, ablage, { teil, teile: anzahl });
  return { ablage, anzahl };
}

function zeilenDesUrteils({ stdout }) {
  return stdout
    .split("\n")
    .filter((zeile) => NUR_DAS_URTEIL.test(zeile))
    .map((zeile) => zeile.replace(LAEUFE_ROT, "(n von 5 Läufen rot)"));
}

function sortiert(zeilen) {
  return [...zeilen].sort((links, rechts) => (links < rechts ? -1 : 1));
}

function protokollierend(protokoll, name, zeile = "assert.ok(true);") {
  return datei(
    'import assert from "node:assert/strict";',
    'import { appendFileSync } from "node:fs";',
    'import { test } from "node:test";',
    "function art() {",
    "  try {",
    "    assert.ok(true);",
    '    return "echt";',
    "  } catch {",
    '    return "attrappe";',
    "  }",
    "}",
    `test(${JSON.stringify(name)}, () => {`,
    `  appendFileSync(${JSON.stringify(protokoll)}, \`\${JSON.stringify(${JSON.stringify(name)})} \${art()}\\n\`);`,
    `  ${zeile}`,
    "});",
  );
}

function auszaehlung(protokoll) {
  const zaehlung = new Map();
  if (!existsSync(protokoll)) return zaehlung;
  for (const eintrag of readFileSync(protokoll, "utf8").split("\n").filter(Boolean)) zaehlung.set(eintrag, (zaehlung.get(eintrag) ?? 0) + 1);
  return zaehlung;
}

function wechselnd(ablage) {
  return datei(
    'import assert from "node:assert/strict";',
    'import { closeSync, openSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { test } from "node:test";',
    'test("wechselt", () => {',
    "  let stand = 0;",
    "  for (;;) {",
    "    try {",
    `      closeSync(openSync(join(${JSON.stringify(ablage)}, String(stand)), "wx"));`,
    "      break;",
    "    } catch {",
    "      stand += 1;",
    "    }",
    "  }",
    "  assert.equal(stand % 2, 1);",
    "});",
  );
}

test("jeder Test läuft über alle Teile genau einmal in A und genau einmal je Lauf B1 bis B5, auch ein Katalogtest in einer unveränderten Datei", (context) => {
  const protokoll = join(probeDirectory(context, {}), "laeufe");
  const katalog = datei(
    "| Kennung | Angriff | Verletzte Grenze | Mechanismus | Negativtest |",
    "| --- | --- | --- | --- | --- |",
    "| SG-01 | Angriff | Grenze | Mechanismus | SG-01 lehnt ab |",
  );
  const repo = geaendertesRepo(
    context,
    { "docs/sicherheitsgrenzen.md": katalog, "test/grenze.test.js": protokollierend(protokoll, "SG-01 lehnt ab") },
    {
      "test/eins.test.js": protokollierend(protokoll, "eins"),
      "test/zwei.test.js": protokollierend(protokoll, "zwei"),
      "test/drei.test.js": protokollierend(protokoll, "drei"),
    },
  );
  const { ablage, anzahl } = ueberTeile(context, repo, { vorEinemLauf: () => rmSync(protokoll, { force: true }) });
  assert.equal(anzahl, 3);
  assert.equal(urteil(repo, ablage, anzahl).status, EXIT_GRUEN);
  const zaehlung = auszaehlung(protokoll);
  for (const name of ["eins", "zwei", "drei"]) {
    assert.equal(zaehlung.get(`"${name}" echt`), WIEDERHOLUNGEN, name);
    assert.equal(zaehlung.get(`"${name}" attrappe`), 1, name);
  }
  assert.equal(zaehlung.get('"SG-01 lehnt ab" attrappe'), 1);
  assert.equal(zaehlung.get('"SG-01 lehnt ab" echt'), undefined);
});

test("ein geänderter bestehender Test läuft über die Teile so oft wie in einem Lauf über alles", (context) => {
  const protokoll = join(probeDirectory(context, {}), "laeufe");
  const repo = geaendertesRepo(
    context,
    { "test/alt.test.js": protokollierend(protokoll, "alt") },
    {
      "test/alt.test.js": protokollierend(protokoll, "alt", "assert.equal(1 + 1, 2);"),
      "test/neu.test.js": protokollierend(protokoll, "neu"),
    },
  );
  rmSync(protokoll, { force: true });
  assert.equal(werkzeug(repo).status, EXIT_GRUEN);
  const inEinemLauf = auszaehlung(protokoll);
  const { ablage, anzahl } = ueberTeile(context, repo, { vorEinemLauf: () => rmSync(protokoll, { force: true }) });
  assert.equal(anzahl, 2);
  assert.equal(urteil(repo, ablage, anzahl).status, EXIT_GRUEN);
  assert.deepEqual(auszaehlung(protokoll), inEinemLauf);
});

test("das Urteil aus mehreren Teilen ist dasselbe wie aus einem Lauf über alles, auch für wackelt, ohne wirksame Prüfung und nicht gelaufen", (context) => {
  const staende = probeDirectory(context, {});
  const repo = geaendertesRepo(
    context,
    { "test/geaendert.test.js": protokollierend(join(staende, "protokoll"), "prüft erst", "assert.equal(1, 1);") },
    {
      "test/geaendert.test.js": protokollierend(join(staende, "protokoll"), "prüft erst", "Math.max(1, 2);"),
      "test/gut.test.js": pruefendeDatei("prüft", 1),
      "test/leer.test.js": datei('import { test } from "node:test";', 'test("prüft nichts", () => {});'),
      "test/kaputt.test.js": datei('import { test } from "node:test";', 'throw new Error("kaputt");', 'test("lädt nie", () => {});'),
      "test/wechselt.test.js": wechselnd(staende),
    },
  );
  const staendeLeeren = () => {
    rmSync(staende, { recursive: true, force: true });
    mkdirSync(staende);
  };
  staendeLeeren();
  const einLauf = werkzeug(repo);
  const { ablage, anzahl } = ueberTeile(context, repo, { vorEinemLauf: staendeLeeren });
  const gesammelt = urteil(repo, ablage, anzahl);
  assert.ok(anzahl > 1, `Plan mit ${anzahl} Teilen`);
  assert.equal(einLauf.status, EXIT_ROT, einLauf.stdout + einLauf.stderr);
  assert.equal(gesammelt.status, EXIT_ROT, gesammelt.stdout + gesammelt.stderr);
  const erwartet = [
    "Verstoß: Test bleibt grün, obwohl jede Prüfung scheitert: test/leer.test.js › prüft nichts",
    "Verstoß: Test wackelt: test/wechselt.test.js › wechselt (n von 5 Läufen rot)",
    "Verstoß: Test prüft nach der Änderung nichts mehr: test/geaendert.test.js › prüft erst",
  ];
  for (const zeile of erwartet) assert.ok(zeilenDesUrteils(einLauf).includes(zeile), `${zeile}\n${einLauf.stdout}`);
  assert.match(einLauf.stdout, /^Verstoß: Test nicht gelaufen: test\/kaputt\.test\.js › lädt nie \(Lauf A/m);
  assert.deepEqual(sortiert(zeilenDesUrteils(gesammelt)), sortiert(zeilenDesUrteils(einLauf)));
});

test("Zeilen einer Hilfsdatei, die ein Test eines anderen Teils weiter erreicht, sind kein Befund; Zeilen, die keiner mehr erreicht, schon", (context) => {
  const hilfe = (kommentar) =>
    datei(
      `// ${kommentar}`,
      'import assert from "node:assert/strict";',
      "export function erste() {",
      "  assert.equal(1, 1);",
      "}",
      "export function zweite() {",
      "  assert.equal(2, 2);",
      "}",
    );
  const nutzer = (name, aufruf) =>
    datei('import assert from "node:assert/strict";', 'import { test } from "node:test";', 'import { erste, zweite } from "./hilfe.js";', `test(${JSON.stringify(name)}, () => {`, "  assert.ok(erste && zweite);", `  ${aufruf}`, "});");
  const vorher = {
    "test/hilfe.js": hilfe("alt"),
    "test/a.test.js": nutzer("a", "erste();"),
    "test/b.test.js": nutzer("b", "zweite();"),
  };
  const faelle = [
    { fall: "der andere Teil übernimmt die Zeile", b: "erste(); zweite();", status: EXIT_GRUEN },
    { fall: "niemand erreicht die Zeile mehr", b: "zweite(); assert.equal(3, 3);", status: EXIT_ROT },
  ];
  for (const { fall, b, status } of faelle) {
    const repo = geaendertesRepo(context, vorher, {
      "test/hilfe.js": hilfe("neu"),
      "test/a.test.js": nutzer("a", "assert.equal(0, 0);"),
      "test/b.test.js": nutzer("b", b),
    });
    const einLauf = werkzeug(repo);
    const { ablage, anzahl } = ueberTeile(context, repo);
    const gesammelt = urteil(repo, ablage, anzahl);
    assert.equal(anzahl, 2, fall);
    assert.equal(einLauf.status, status, `${fall}\n${einLauf.stdout}${einLauf.stderr}`);
    assert.equal(gesammelt.status, status, `${fall}\n${gesammelt.stdout}${gesammelt.stderr}`);
    assert.deepEqual(sortiert(zeilenDesUrteils(gesammelt)), sortiert(zeilenDesUrteils(einLauf)), fall);
  }
});

function pruefendeDatei(name, wert) {
  return datei('import assert from "node:assert/strict";', 'import { test } from "node:test";', `test(${JSON.stringify(name)}, () => assert.equal(${wert}, ${wert}));`);
}

function zweiGeaenderteDateien(context) {
  return geaendertesRepo(context, {}, { "test/eins.test.js": pruefendeDatei("eins", 1), "test/zwei.test.js": pruefendeDatei("zwei", 2) });
}

test("fehlt das Ergebnis eines Teils oder passt es nicht zum Plan, ist das Urteil rot und nennt den Teil", (context) => {
  const repo = zweiGeaenderteDateien(context);
  const { ablage, anzahl } = ueberTeile(context, repo);
  assert.equal(anzahl, 2);
  assert.equal(urteil(repo, ablage, anzahl).status, EXIT_GRUEN);

  const unlesbar = probeDirectory(context, {});
  cpSync(ablage, unlesbar, { recursive: true });
  writeFiles(unlesbar, { "wirkung-teil-1.json": "{ abgeschnitten" });
  const faelle = [
    { fall: "Ergebnis fehlt", vorbereiten: () => rmSync(ergebnisDatei(ablage, 2)), mappe: ablage, teil: 2, test: "zwei" },
    { fall: "Ergebnis unlesbar", vorbereiten: () => {}, mappe: unlesbar, teil: 1, test: "eins" },
  ];
  for (const { fall, vorbereiten, mappe, teil, test: name } of faelle) {
    vorbereiten();
    const lauf = urteil(repo, mappe, anzahl);
    assert.equal(lauf.status, EXIT_ROT, `${fall}\n${lauf.stdout}${lauf.stderr}`);
    assert.match(lauf.stdout, new RegExp(`^Verstoß: Teilergebnis fehlt: Teil ${teil} von ${anzahl}`, "m"), fall);
    assert.match(lauf.stdout, new RegExp(`^Verstoß: Test nicht gelaufen: test/${name}\\.test\\.js › ${name} \\(Lauf A`, "m"), fall);
  }

  const leer = probeDirectory(context, {});
  assert.equal(urteil(repo, leer, anzahl).status, EXIT_ROT);
});

test("das Ergebnis eines anderen Teils unter dem Namen eines fehlenden zählt nicht", (context) => {
  const repo = zweiGeaenderteDateien(context);
  const { ablage, anzahl } = ueberTeile(context, repo);
  cpSync(ergebnisDatei(ablage, 1), ergebnisDatei(ablage, 2));
  const lauf = urteil(repo, ablage, anzahl);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /^Verstoß: Teilergebnis fehlt: Teil 2 von 2/m);
});

test("CI: der Sammeljob verlangt Plan, alle Teile und das Urteil der Testwirkung, und das Urteil läuft auch nach einem gescheiterten Teil", () => {
  const sammeljob = workflowJobLines("ci.yml", "ci").find((zeile) => zeile.startsWith("    needs: "));
  for (const job of ["wirkungsplan", "wirkungsteil", "wirkungsurteil"]) assert.ok(sammeljob.includes(job), `${job} fehlt in ${sammeljob}`);
  assert.ok(workflowJobLines("ci.yml", "wirkungsurteil").includes("    if: ${{ !cancelled() && needs.wirkungsplan.result == 'success' }}"));
});

function gemessen(dauernSekunden) {
  const tabelle = (auswahl) => ({ lauf: 1, dauern: Object.fromEntries(auswahl.map(([pfad, sekunden]) => [pfad, sekunden * SEKUNDE_MS])) });
  const paare = Object.entries(dauernSekunden);
  const imWerkzeugordner = ([pfad]) => pfad.startsWith("test/werkzeuge/");
  return {
    "tools/testlaufzeit/laufzeiten.json": `${JSON.stringify(tabelle(paare.filter((paar) => !imWerkzeugordner(paar))))}\n`,
    "tools/testlaufzeit/werkzeug-laufzeiten.json": `${JSON.stringify(tabelle(paare.filter(imWerkzeugordner)))}\n`,
  };
}

const PLAENE = [
  { fall: "wenig gemessene Testzeit bleibt ein Teil", dauern: { "test/a.test.js": 100, "test/werkzeuge/b.test.js": 200 }, teile: [1] },
  { fall: "Testzeit aus beiden Messdateien zählt zusammen", dauern: { "test/a.test.js": 500, "test/werkzeuge/b.test.js": 500 }, teile: [1, 2] },
  { fall: "viel gemessene Testzeit verteilt sich auf mehrere Teile", dauern: { "test/a.test.js": 1000, "test/werkzeuge/b.test.js": 1000, "test/werkzeuge/c.test.js": 700 }, teile: [1, 2, 3] },
];

test("unter der Schwelle gemessener Testzeit plant die Testwirkung einen Teil, darüber mehrere", (context) => {
  for (const { fall, dauern, teile } of PLAENE) {
    const geaendert = Object.fromEntries(Object.keys(dauern).map((pfad) => [pfad, datei('import { test } from "node:test";', `test(${JSON.stringify(pfad)}, () => {});`)]));
    const repo = geaendertesRepo(context, gemessen(dauern), geaendert);
    assert.deepEqual(plan(repo, probeDirectory(context, {})), { anzahl: teile.length, teile }, fall);
  }
});

test("ein Aufruf mit einer anderen Teilzahl als der Plan bricht ab, statt einen falschen Schnitt zu messen", (context) => {
  const repo = geaendertesRepo(context, {}, {
    "test/eins.test.js": datei('import { test } from "node:test";', 'test("eins", () => {});'),
  });
  const ablage = probeDirectory(context, {});
  assert.equal(werkzeug(repo, "--teil", "1", "--teile", "2", "--ergebnis", ergebnisDatei(ablage, 1)).status, EXIT_ABBRUCH);
  assert.equal(existsSync(ergebnisDatei(ablage, 1)), false);
  assert.equal(urteil(repo, ablage, 2).status, EXIT_ABBRUCH);
});
