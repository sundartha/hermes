import assert from "node:assert/strict";
import { test } from "node:test";

import { AUFTRAG_TOOL, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const EXIT_GRUEN = 0;
const NEUE_MIGRATION = "src/db/migrations/0003_bestaetigungscodes.sql";
const START_TEST = "test/gemeinsam/migrationen-start.test.js";
const RLS_TEST = "test/rls-with-check.test.js";
const HINWEIS = "Festwert-Test: prüfen, ob er mit der neuen Migration angepasst werden muss; sonst im Entwurf „bleibt unverändert grün“ vermerken";
const FESTWERT_ZEILE = /Festwert-Test: prüfen, ob er mit der neuen Migration angepasst werden muss/;
const ABNAHME = "test/gemeinsam/bestaetigungscodes-einmal.test.js";
const BESTAND = {
  "tools/bereiche.json": JSON.stringify([{ bereich: "gemeinsam" }]),
  "src/db/migrations/0001_ausgang.sql": "create table ausgang (id int);\n",
  "src/db/migrations/0002_versionstabelle.sql": "create table schema_migrations (id int);\n",
  "src/db/migrate.js": "export const MIGRATE = 1;\n",
  [START_TEST]: 'import { test } from "node:test";\ntest("liste", () => { const liste = ["0001_ausgang", "0002_versionstabelle"]; });\n',
  [RLS_TEST]: 'import { test } from "node:test";\ntest("rls", () => { const policy = "tenant_isolation"; });\n',
  "test/werkzeuge/migrationen-probe.test.js": 'import { test } from "node:test";\ntest("werkzeug", () => { const liste = "0001_ausgang tenant_isolation"; });\n',
  "test/gemeinsam/unbeteiligt.test.js": 'import { test } from "node:test";\ntest("nichts", () => {});\n',
};

function migrationsauftrag(felder = {}) {
  return {
    id: "a1",
    art: "funktion",
    ziel: "Einmal-Verbrauch der Codes gilt über Prozesse",
    bereich: "src/",
    erwarteteDateien: [NEUE_MIGRATION, "src/db/migrate.js", ABNAHME],
    abnahme: ABNAHME,
    erwarteterFehler: "Code an Prozess B als bestätigt angenommen",
    wasDarfNiePassieren: ["Ein Code gilt zweimal."],
    prueft: ["S1"],
    szenarien: { S1: "Gegeben zwei Prozesse, wenn der Code zweimal eingelöst wird, dann gilt er einmal." },
    ...felder,
  };
}

function pruefeMit(context, auftrag, { entwurf = "Was sich ändert: eine Migration für die Codes.", dateien = {} } = {}) {
  const ordner = probeRepository(context, { ...BESTAND, ...dateien });
  const phase = { phase: "F-001-probe", issue: 7, entwurf: { "src/": entwurf }, auftraege: [auftrag] };
  writeFiles(ordner, { "phase.json": JSON.stringify(phase) });
  return runIn(ordner, process.execPath, [AUFTRAG_TOOL, "pruefe", "phase.json"]);
}

function festwertZeilen(lauf) {
  return lauf.stderr.split("\n").filter((zeile) => FESTWERT_ZEILE.test(zeile));
}

test("auftrag-pruefe festwert: eine neue Migration meldet jeden Test, der Migrationsnamen oder tenant_isolation festschreibt, als Hinweis ohne Halt", (context) => {
  const lauf = pruefeMit(context, migrationsauftrag());
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  assert.deepEqual(festwertZeilen(lauf).sort(), [`Hinweis: a1: ${START_TEST}: ${HINWEIS}`, `Hinweis: a1: ${RLS_TEST}: ${HINWEIS}`]);
  assert.match(lauf.stdout, /^grün: 1 Aufträge in phase\.json sind vollständig\.$/m);
});

test("auftrag-pruefe festwert: ein Treffer in erwarteteDateien oder namentlich im Entwurf wird nicht gemeldet", (context) => {
  const inDateien = pruefeMit(context, migrationsauftrag({ erwarteteDateien: [NEUE_MIGRATION, ABNAHME, START_TEST] }));
  assert.equal(inDateien.status, EXIT_GRUEN, inDateien.stderr);
  assert.deepEqual(festwertZeilen(inDateien), [`Hinweis: a1: ${RLS_TEST}: ${HINWEIS}`]);
  const imEntwurf = pruefeMit(context, migrationsauftrag(), { entwurf: "Die Migration ändert nichts an rls-with-check.test.js; das bleibt unverändert grün." });
  assert.equal(imEntwurf.status, EXIT_GRUEN, imEntwurf.stderr);
  assert.deepEqual(festwertZeilen(imEntwurf), [`Hinweis: a1: ${START_TEST}: ${HINWEIS}`]);
});

test("auftrag-pruefe festwert: ohne neue Migration im Auftrag gibt es keinen Hinweis, auch wenn eine bestehende Migration in erwarteteDateien steht", (context) => {
  const ohne = pruefeMit(context, migrationsauftrag({ erwarteteDateien: ["src/db/migrate.js", ABNAHME] }));
  assert.equal(ohne.status, EXIT_GRUEN, ohne.stderr);
  assert.deepEqual(festwertZeilen(ohne), []);
  const bestehend = pruefeMit(context, migrationsauftrag({ erwarteteDateien: ["src/db/migrations/0002_versionstabelle.sql", ABNAHME] }));
  assert.equal(bestehend.status, EXIT_GRUEN, bestehend.stderr);
  assert.deepEqual(festwertZeilen(bestehend), []);
});

test("auftrag-pruefe festwert: der S2a-Plan vor dem ersten Halt von a1 meldet migrationen-start und rls-with-check", (context) => {
  const plan = migrationsauftrag({
    erwarteteDateien: [
      "src/routes/api-call-confirmations.js",
      "src/call-confirmation.js",
      NEUE_MIGRATION,
      "src/db/migrate.js",
      "src/app.js",
      "src/store.js",
      "src/store/pg.js",
      "src/store/bestaetigungscodes.js",
      ABNAHME,
      "test/call-confirmation.test.js",
    ],
  });
  const dateien = Object.fromEntries(
    ["src/routes/api-call-confirmations.js", "src/call-confirmation.js", "src/app.js", "src/store.js", "src/store/pg.js", "test/call-confirmation.test.js"].map((pfad) => [pfad, "export const X = 1;\n"]),
  );
  const lauf = pruefeMit(context, plan, { entwurf: "Was sich ändert: Verbrauch und Slot liegen in Postgres, Policy `tenant_isolation`, Migration `0001_ausgang` als Vorbild.", dateien });
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stderr);
  assert.ok(festwertZeilen(lauf).includes(`Hinweis: a1: ${START_TEST}: ${HINWEIS}`), lauf.stderr);
  assert.ok(festwertZeilen(lauf).includes(`Hinweis: a1: ${RLS_TEST}: ${HINWEIS}`), lauf.stderr);
});
