import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ESLint } from "eslint";
import { TOOLS } from "../../tools/basis-vergleich.mjs";
import { bauPrompt, testumbauPrompt } from "../../tools/auftrag/agenten.mjs";
import { altlastBefunde, musterEintraege } from "../../tools/auftrag/musterpruefung.mjs";
import { EXIT_OK, REPO, frischeWurzel, lesen, neu, raeumeWurzelnAuf } from "./neu-hilfen.js";
import { probeDirectory } from "./probe-repo.js";

const LEERE_UNTERDRUECKUNGEN = "eslint-suppressions.empty.json";
const DEPCRUISE = join(REPO, "node_modules/dependency-cruiser/bin/dependency-cruiser.mjs");
const ANGELEGT = /^angelegt: (.+)$/gm;
const IMPORT_ZEILE = /^import .+;$/gm;
const BEFEHL = "npm run neu";
const NAMEN = ["vorlagen-probe", "vorlagen-zweite-probe"];
const FAELLE = [
  { art: "test", ziel: "anrufe" },
  { art: "route", ziel: "betrieb" },
  { art: "fachdatei", ziel: "rueckfrage" },
];
const KEIN_NODE_MODULES = (pfad) => !pfad.includes("node_modules");
const KEIN_TESTCODE = (pfad) => !pfad.endsWith(".test.js") && !pfad.includes("node_modules");

after(raeumeWurzelnAuf);

function projekt({ mitTests = false } = {}) {
  const wurzel = frischeWurzel("neu-vorlagen-");
  cpSync(join(REPO, "src"), join(wurzel, "src"), { recursive: true });
  cpSync(join(REPO, "test"), join(wurzel, "test"), {
    recursive: true,
    filter: mitTests ? KEIN_NODE_MODULES : KEIN_TESTCODE,
  });
  cpSync(join(REPO, "tools/mutationspruefung"), join(wurzel, "tools/mutationspruefung"), {
    recursive: true,
  });
  cpSync(join(REPO, ".dependency-cruiser.cjs"), join(wurzel, ".dependency-cruiser.cjs"));
  writeFileSync(join(wurzel, "package.json"), readFileSync(join(REPO, "package.json")));
  symlinkSync(join(REPO, "node_modules"), join(wurzel, "node_modules"));
  symlinkSync(join(REPO, "public"), join(wurzel, "public"));
  const erzeugt = NAMEN.flatMap((name) =>
    FAELLE.map((fall) => {
      const lauf = neu(wurzel, fall.art, fall.ziel, name);
      assert.equal(lauf.status, EXIT_OK, lauf.stderr);
      return { ...fall, pfade: [...lauf.stdout.matchAll(ANGELEGT)].map(([, pfad]) => pfad) };
    }),
  );
  return { wurzel, erzeugt };
}

test("die Prompts der Agenten nennen den Befehl für neue Dateien", (context) => {
  const muster = musterEintraege(REPO);
  const dateien = Object.fromEntries(
    muster.map(({ datei }) => [datei, "export const MUSTER = 1;\n"]),
  );
  const root = probeDirectory(context, dateien);
  const bereich = "src/routes/neue-route.js";
  const auftrag = {
    id: "A1",
    art: "umbau",
    ziel: "Baue",
    bereich,
    erwarteteDateien: [bereich],
    vorbild: "src/store/pg.js",
    abnahme: "test/a.test.js",
  };
  const bau = bauPrompt(
    { phase: { entwurf: { [bereich]: "Entwurf." } }, auftrag, root },
    "Ausgabe.",
  );
  const abnahme = "test/gemeinsam/neue-route.test.js";
  const umbau = {
    id: "A1",
    art: "testumbau",
    ziel: "Baue Tests um",
    bereich: abnahme,
    erwarteteDateien: [abnahme],
    abnahme,
  };
  const testumbau = testumbauPrompt({ entwurf: { [abnahme]: "Entwurf." } }, umbau, root);
  assert.ok(bau.includes(BEFEHL), "Der Prompt nennt npm run neu nicht");
  assert.ok(testumbau.includes(BEFEHL), "Der Prompt nennt npm run neu nicht");
});

test("keine Musterdatei steht in einer Liste geduldeter Befunde", () => {
  assert.deepEqual(altlastBefunde(REPO), []);
});

test("die erzeugte Route übernimmt die Importe der Musterdatei für Routen", () => {
  const [muster] = musterEintraege(REPO).filter((eintrag) => eintrag.art === "Route");
  const wurzel = frischeWurzel("neu-vorlagen-");
  assert.equal(neu(wurzel, "route", "betrieb", NAMEN[0]).status, EXIT_OK);
  const erzeugteImporte = lesen(wurzel, `src/routes/${NAMEN[0]}.js`).match(IMPORT_ZEILE);
  assert.deepEqual(
    erzeugteImporte,
    readFileSync(join(REPO, muster.datei), "utf8").match(IMPORT_ZEILE),
  );
});

test("jede erzeugte Datei besteht ESLint mit leerer Unterdrückungsliste", async () => {
  const eslint = new ESLint({ cwd: REPO, suppressionsLocation: LEERE_UNTERDRUECKUNGEN });
  const { wurzel, erzeugt } = projekt();
  for (const { art, pfade } of erzeugt) {
    assert.ok(pfade.length > 0, `${art}: keine Datei angelegt`);
    for (const pfad of pfade) {
      const [ergebnis] = await eslint.lintText(lesen(wurzel, pfad), { filePath: join(REPO, pfad) });
      assert.deepEqual(ergebnis.messages, [], `${art}: ${pfad}`);
    }
  }
});

test("die Abhängigkeitsregeln finden an den erzeugten Dateien nichts", () => {
  const { wurzel, erzeugt } = projekt();
  const lauf = spawnSync(
    process.execPath,
    [DEPCRUISE, "src", "test", "--config", ".dependency-cruiser.cjs", "--output-type", "json"],
    { cwd: wurzel, encoding: "utf8", maxBuffer: 268_435_456 },
  );
  const erzeugtePfade = erzeugt.flatMap(({ pfade }) => pfade);
  const verstoesse = JSON.parse(lauf.stdout).summary.violations;
  const eigene = verstoesse.filter(
    ({ from, to }) => erzeugtePfade.includes(from) || erzeugtePfade.includes(to),
  );
  assert.deepEqual(eigene, []);
});

test("jeder erzeugte Test läuft grün", () => {
  const { wurzel, erzeugt } = projekt();
  const tests = erzeugt.flatMap(({ pfade }) => pfade).filter((pfad) => pfad.endsWith(".test.js"));
  assert.equal(tests.length, FAELLE.length * NAMEN.length);
  const lauf = spawnSync(process.execPath, ["--test", ...tests], {
    cwd: wurzel,
    encoding: "utf8",
    env: { ...process.env, NODE_ENV: "test", NODE_TEST_CONTEXT: undefined },
  });
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
});

function eigeneBefunde(befunde, erzeugt) {
  const pfade = erzeugt.flatMap((eintrag) => eintrag.pfade);
  return befunde
    .map(({ location }) => location)
    .filter((ort) => pfade.some((pfad) => ort.includes(pfad)));
}

test("jscpd findet an zwei Dateien je Art aus derselben Vorlage keine Kopie", () => {
  const { wurzel, erzeugt } = projekt({ mitTests: true });
  assert.deepEqual(eigeneBefunde(TOOLS.jscpd.findings(wurzel), erzeugt), []);
});
