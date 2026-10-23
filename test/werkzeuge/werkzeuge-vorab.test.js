import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";

import { MELDUNG, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { BASIS, EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { mitErsatzWerkzeugen } from "./ersatz-werkzeuge.js";
import { AUFTRAG, EXIT_AUFRUF, planeAntworten } from "./planung-plane-probe.js";
import { ORDNER, aufrufe, plane } from "./planung-probe.js";
import { probeDirectory } from "./probe-repo.js";

const AUSFUEHRBAR = 0o755;
const SCHEITERT = "#!/bin/sh\necho kaputt >&2\nexit 1\n";
const DATEI = "src/text.js";
const DREHBUCH = { bau: { [DATEI]: "export const text = 1;\n" }, "bau-antwort": "Zweck vorab: Drehbuchtext des Ersatz-Agenten." };
const POSTGRES_FEHLT = "Postgres für test:wirkung fehlt; ohne es überspringen die Postgres-Tests still";
const PAKETE_FEHLEN = "Die Pakete aus package.json fehlen in node_modules; ohne sie brechen lint, tsc und die Tests ab (nicht installiert: nicht-installiert).";

function mitKaputtem(context, name) {
  const ordner = probeDirectory(context, {});
  const umgebung = mitErsatzWerkzeugen(ordner);
  writeFileSync(join(ordner, "ersatz-bin", name), SCHEITERT, { mode: AUSFUEHRBAR });
  return umgebung;
}

function ohneSystemOrdner(ordner) {
  const eigene = join(ordner, "eigene-bin");
  mkdirSync(eigene);
  const suchpfad = process.env.PATH.split(delimiter);
  const git = suchpfad.map((teil) => join(teil, "git")).find((pfad) => existsSync(pfad));
  symlinkSync(git, join(eigene, "git"));
  symlinkSync(process.execPath, join(eigene, "node"));
  return [join(ordner, "ersatz-bin"), eigene].join(delimiter);
}

function haeltVorDemErstenAuftrag({ lauf, beleg, werkzeug }, zeile, id) {
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.includes(zeile), lauf.stderr);
  assert.ok(lauf.stderr.includes(zweckBlock(id).join("\n")), lauf.stderr);
  assert.equal(beleg, null);
  assert.ok(!existsSync(join(werkzeug, "prompt-bau.txt")));
}

test("lauf hält vor dem ersten Auftrag an, wenn HERMES_TEST_POSTGRES_URL fehlt", (context) => {
  const lauf = starte(context, { auftrag: UMBAU, drehbuch: DREHBUCH, umgebung: { HERMES_TEST_POSTGRES_URL: "" } });
  haeltVorDemErstenAuftrag(lauf, `${POSTGRES_FEHLT} (HERMES_TEST_POSTGRES_URL ist nicht gesetzt).`, MELDUNG.POSTGRES_FEHLT);
});

test("lauf hält vor dem ersten Auftrag an, wenn pg_isready den Postgres aus HERMES_TEST_POSTGRES_URL nicht erreicht", (context) => {
  const lauf = starte(context, { auftrag: UMBAU, drehbuch: DREHBUCH, umgebung: mitKaputtem(context, "pg_isready") });
  haeltVorDemErstenAuftrag(lauf, `${POSTGRES_FEHLT} (pg_isready endete mit Exit 1: kaputt).`, MELDUNG.POSTGRES_FEHLT);
});

test("lauf hält vor dem ersten Auftrag an, wenn pg_isready nicht im PATH liegt", (context) => {
  const ordner = probeDirectory(context, {});
  const umgebung = mitErsatzWerkzeugen(ordner);
  rmSync(join(ordner, "ersatz-bin", "pg_isready"));
  const lauf = starte(context, { auftrag: UMBAU, drehbuch: DREHBUCH, umgebung: { ...umgebung, PATH: ohneSystemOrdner(ordner) } });
  haeltVorDemErstenAuftrag(lauf, `${POSTGRES_FEHLT} (pg_isready ließ sich nicht starten: `, MELDUNG.POSTGRES_FEHLT);
});

test("lauf hält vor dem ersten Auftrag an, wenn ein Paket aus package.json nicht in node_modules liegt", (context) => {
  const paket = { ...JSON.parse(BASIS["package.json"]), devDependencies: { "nicht-installiert": "1.0.0" } };
  const lauf = starte(context, { auftrag: UMBAU, drehbuch: DREHBUCH, dateien: { "package.json": JSON.stringify(paket) } });
  haeltVorDemErstenAuftrag(lauf, PAKETE_FEHLEN, MELDUNG.PAKETE_FEHLEN);
});

test("lauf nennt bei vier fehlenden Paketen die ersten drei und zählt den Rest", (context) => {
  const fehlend = { "fehlt-a": "1.0.0", "fehlt-b": "1.0.0", "fehlt-c": "1.0.0", "fehlt-d": "1.0.0" };
  const paket = { ...JSON.parse(BASIS["package.json"]), devDependencies: fehlend };
  const lauf = starte(context, { auftrag: UMBAU, drehbuch: DREHBUCH, dateien: { "package.json": JSON.stringify(paket) } });
  haeltVorDemErstenAuftrag(lauf, "(nicht installiert: fehlt-a, fehlt-b, fehlt-c und 1 weitere).", MELDUNG.PAKETE_FEHLEN);
});

test("plane hält vor dem ersten Agenten an, wenn pg_isready den Postgres nicht erreicht, und legt keine Ablage an", (context) => {
  const lauf = plane(context, { werkzeug: AUFTRAG, grund: planeAntworten(), ueberschrieben: {}, argumente: ["plane", ORDNER], umgebung: mitKaputtem(context, "pg_isready") });
  assert.equal(lauf.status, EXIT_AUFRUF, lauf.stdout + lauf.stderr);
  assert.ok(lauf.stderr.includes(`${POSTGRES_FEHLT} (pg_isready endete mit Exit 1: kaputt).`), lauf.stderr);
  assert.ok(lauf.stderr.includes(zweckBlock(MELDUNG.POSTGRES_FEHLT).join("\n")), lauf.stderr);
  assert.deepEqual(aufrufe(lauf, "planer"), []);
  assert.ok(!existsSync(join(lauf.wurzel, ORDNER, "planung")));
});
