import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { aequivalenteLaden, mutationUrteil, prTextFormfehler } from "../../tools/pruefen.mjs";
import { testschutzBefunde } from "../../tools/testschutz.mjs";

const PRUEFEN = resolve(import.meta.dirname, "../../tools/pruefen.mjs");
const LISTE = "test/gemeinsam/aequivalente-mutanten.jsonl";

const GRUND = "äquivalent, beide Seiten liefern denselben Wert";
const MUTANT = { schluessel: "src/a.js:3/7", datei: "src/a.js", zeile: "const x = 1;", mutation: "BooleanLiteral: false", ergebnis: "überlebt" };

function urteil(mutanten, aequivalente, prText = "") {
  const vorher = process.env.PR_TEXT;
  process.env.PR_TEXT = prText;
  try {
    return mutationUrteil(mutanten, 1, aequivalente);
  } finally {
    if (vorher === undefined) delete process.env.PR_TEXT;
    else process.env.PR_TEXT = vorher;
  }
}

const vorhanden = () => true;

test("Ein PR-Text ohne Abschnitt Überlebende Mutanten hat keinen Formfehler", () => {
  assert.deepEqual(prTextFormfehler("Closes #1\n", vorhanden), []);
  assert.deepEqual(prTextFormfehler(undefined, vorhanden), []);
});

test("Beide vorgeschriebenen Zeilenformen gelten als Form", () => {
  const text = `## Überlebende Mutanten\n\`src/a.js:3/7\` wird getötet von \`test/a.test.js\`\n\`src/a.js:4/8\`: ${GRUND}\n`;
  assert.deepEqual(prTextFormfehler(text, vorhanden), []);
});

test("Ein Schlüssel ohne Backticks oder ohne Mutantennummer ist ein Formfehler", () => {
  for (const zeile of ["src/a.js:3/7 wird getötet von `test/a.test.js`", "`src/a.js:3` wird getötet von `test/a.test.js`", "`src/a.js:3/7` wird getötet durch `test/a.test.js`"]) {
    const fehler = prTextFormfehler(`## Überlebende Mutanten\n${zeile}\n`, vorhanden);
    assert.equal(fehler.length, 1, zeile);
    assert.match(fehler[0], /nicht die vorgeschriebene Form/);
  }
});

test("Eine Begründung unter 20 Zeichen ist ein Formfehler", () => {
  assert.equal(prTextFormfehler("## Überlebende Mutanten\n`src/a.js:3/7`: äquivalent\n", vorhanden).length, 1);
});

test("Eine genannte Testdatei, die es nicht gibt, ist ein Formfehler", () => {
  const fehler = prTextFormfehler("## Überlebende Mutanten\n`src/a.js:3/7` wird getötet von `test/fehlt.test.js`\n", (datei) => datei !== "test/fehlt.test.js");
  assert.equal(fehler.length, 1);
  assert.match(fehler[0], /test\/fehlt\.test\.js` eine Testdatei, die es nicht gibt/);
});

test("Ein überlebender Mutant mit Eintrag in der Liste gilt als begründet", () => {
  const liste = [{ datei: "src/a.js", mutation: "BooleanLiteral: false", zeile: "const x = 1;", grund: GRUND }];
  assert.equal(urteil([MUTANT], liste), true);
});

test("Die Liste gilt nur für dieselbe Datei, Mutation und Zeile und nur mit Begründung ab 20 Zeichen", () => {
  const eintrag = { datei: "src/a.js", mutation: "BooleanLiteral: false", zeile: "const x = 1;", grund: GRUND };
  for (const abweichung of [{ datei: "src/b.js" }, { mutation: "BooleanLiteral: true" }, { zeile: "const x = 2;" }, { grund: "kurz" }]) {
    assert.equal(urteil([MUTANT], [{ ...eintrag, ...abweichung }]), false, JSON.stringify(abweichung));
  }
});

test("Ein getöteter oder nicht geprüfter Mutant wird durch einen Listeneintrag nicht begründet", () => {
  const liste = [{ datei: "src/a.js", mutation: "BooleanLiteral: false", zeile: "const x = 1;", grund: GRUND }];
  assert.equal(urteil([{ ...MUTANT, ergebnis: "nicht geprüft (Frist)" }], liste), false);
});

test("Fließtext ohne Schlüssel und eine Begründung mit dem Wort getötet sind kein Formfehler", () => {
  const text = `## Überlebende Mutanten\nKeine; alles wird von den Stimmentests getötet.\n\`src/a.js:3/7\`: kann nicht getötet werden, weil beide Seiten denselben Wert liefern\n`;
  assert.deepEqual(prTextFormfehler(text, vorhanden), []);
});

test("Ein Schlüssel zu einer .cjs-, .tsx- oder .cts-Datei ohne Backticks ist ebenfalls ein Formfehler", () => {
  for (const datei of ["src/a.cjs", "src/b.tsx", "src/c.cts"]) {
    assert.equal(prTextFormfehler(`## Überlebende Mutanten\n${datei}:3/7 wird getötet von test/a.test.js\n`, vorhanden).length, 1, datei);
  }
});

function mitOrdner(ablauf) {
  const ordner = mkdtempSync(join(tmpdir(), "mutation-liste-"));
  try {
    return ablauf(ordner);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("Die Liste liest eine JSON-Zeile je Eintrag, überspringt Leerzeilen und ist ohne Datei leer", () => {
  mitOrdner((ordner) => {
    const datei = join(ordner, "liste.jsonl");
    writeFileSync(datei, `{"datei":"src/a.js","grund":"x"}\n\n{"datei":"src/b.js","grund":"y"}\n`);
    assert.deepEqual(aequivalenteLaden(datei).map((eintrag) => eintrag.datei), ["src/a.js", "src/b.js"]);
    assert.deepEqual(aequivalenteLaden(join(ordner, "fehlt.jsonl")), []);
  });
});

test("Ein mehrzeiliger Mutant gilt nur mit dem ganzen Text seiner Zeilen als begründet", () => {
  const eintrag = { datei: "src/a.js", mutation: "BooleanLiteral: false", zeile: "if (x) {\nreturn 1;\n}", grund: GRUND };
  assert.equal(urteil([{ ...MUTANT, zeile: "if (x) {\nreturn 1;\n}" }], [eintrag]), true);
  assert.equal(urteil([{ ...MUTANT, zeile: "if (x) {\nreturn 2;\n}" }], [eintrag]), false);
});

test("pr-text endet mit 1 bei falscher Form und mit 0 bei richtiger, aus einer Markdown- und aus einer JSON-Datei", () => {
  mitOrdner((ordner) => {
    const lauf = (name, inhalt) => {
      writeFileSync(join(ordner, name), inhalt);
      return spawnSync(process.execPath, [PRUEFEN, "pr-text", join(ordner, name)], { encoding: "utf8" });
    };
    const schlecht = "## Überlebende Mutanten\nsrc/a.js:3/7 wird getötet von test/a.test.js\n";
    const gut = "## Überlebende Mutanten\nKeine.\n";
    const rot = lauf("schlecht.md", schlecht);
    assert.equal(rot.status, 1);
    assert.match(rot.stdout + rot.stderr, /Rot: /);
    assert.equal(lauf("schlecht.json", JSON.stringify({ title: "Paket", body: schlecht })).status, 1);
    assert.equal(lauf("gut.md", gut).status, 0);
    assert.equal(lauf("gut.json", JSON.stringify({ title: "Paket", body: gut })).status, 0);
  });
});

function imRepo(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))), encoding: "utf8" }).trim();
}

function schutzBefunde(vorher, nachher) {
  return mitOrdner((ordner) => {
    mkdirSync(join(ordner, dirname(LISTE)), { recursive: true });
    writeFileSync(join(ordner, LISTE), vorher);
    imRepo(ordner, "init", "-q");
    imRepo(ordner, "add", "--", ".");
    imRepo(ordner, "commit", "-q", "--allow-empty", "-m", "basis");
    const basis = imRepo(ordner, "rev-parse", "HEAD");
    writeFileSync(join(ordner, LISTE), nachher);
    imRepo(ordner, "add", "--", ".");
    imRepo(ordner, "commit", "-q", "-m", "kopf");
    const rueckkehr = process.cwd();
    process.chdir(ordner);
    try {
      return testschutzBefunde(basis, "HEAD");
    } finally {
      process.chdir(rueckkehr);
    }
  });
}

test("Ein angehängter Eintrag in der Liste ist für den Testschutz kein Befund, ein geänderter schon", () => {
  const eintrag = (name) => `{"datei":"${name}","mutation":"m","zeile":"z","grund":"${GRUND}"}\n`;
  assert.deepEqual(schutzBefunde("", eintrag("src/a.js")), []);
  assert.deepEqual(schutzBefunde(eintrag("src/a.js"), eintrag("src/a.js") + eintrag("src/b.js")), []);
  assert.equal(schutzBefunde(eintrag("src/a.js"), eintrag("src/c.js")).length, 1);
});

const QUELLE = ["const stryMutAct_9fa48 = () => false;", "export function eins() {", '  return stryMutAct_9fa48("1") ? 0 : 1;', "}", ""].join("\n");
const TESTLAUF = [
  "const datei = process.argv[3];",
  'const quelle = await import("../src/quelle.mjs");',
  "quelle.eins();",
  'process.exitCode = datei === "test/neu.test.js" && process.env.__STRYKER_ACTIVE_MUTANT__ === "1" ? 1 : 0;',
  "",
].join("\n");

function mutantMit(nachgereicht) {
  return mitOrdner((ordner) => {
    mkdirSync(join(ordner, "src"));
    mkdirSync(join(ordner, "test"));
    writeFileSync(join(ordner, "src/quelle.mjs"), QUELLE);
    writeFileSync(join(ordner, "test/testbaenke-run.mjs"), TESTLAUF);
    for (const datei of ["alt", "neu"]) writeFileSync(join(ordner, `test/${datei}.test.js`), "");
    const plan = { frist: Date.now() + 600_000, tests: ["test/alt.test.js"], dateien: ["src/quelle.mjs"], eingebettete: {}, abdeckung: { "test/alt.test.js": [] }, nachgereicht, protokoll: join(ordner, "protokoll.jsonl"), basisRot: join(ordner, "basis-rot.json") };
    writeFileSync(join(ordner, "plan.json"), JSON.stringify(plan));
    spawnSync(process.execPath, [PRUEFEN, "mutant"], { cwd: ordner, env: { ...process.env, TEIL: "0", TEILE: "1", __STRYKER_ACTIVE_MUTANT__: "1", MUTATION_PLAN: join(ordner, "plan.json") } });
    const { id, ergebnis, test: testdatei } = JSON.parse(readFileSync(join(ordner, "protokoll.jsonl"), "utf8").trim().split("\n").at(-1));
    return { id, ergebnis, testdatei };
  });
}

test("Ein überlebender Mutant läuft gegen die nachgereichte Testdatei und wird dort getötet", () => {
  assert.deepEqual(mutantMit({ "src/quelle.mjs": ["test/neu.test.js"] }), { id: "1", ergebnis: "getötet", testdatei: "test/neu.test.js" });
});

test("Ohne Nachreichung überlebt derselbe Mutant, weil die Abdeckung ihn keinem Test zuordnet", () => {
  assert.deepEqual(mutantMit({}), { id: "1", ergebnis: "überlebt", testdatei: undefined });
});
