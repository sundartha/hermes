import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { codeOhneFreigabe, freigabeImProbeRepo, grundZeile, nachgerechnet } from "./freigabe/hilfen.mjs";
import { REPO_ROOT, commitAll, probeRepository, runIn, writeFiles } from "./probe-repo.js";

const LISTEN_KUERZEN = join(REPO_ROOT, "tools/auftrag/listen-kuerzen.mjs");
const EXIT_OK = 0;
const EXIT_ROT = 1;
const BEREICHE = "tools/bereiche.json";
const KNIP = "tools/basis/knip.json";
const GATES = "tools/gate-tests.json";
const ALLE_LISTEN = [BEREICHE, KNIP, GATES];
const PORTS = "src/mail/ports.js";
const REST_MUSTER = String.raw`      "^src/x/rest\\.[jt]s$",`;
const REST_BEFUND = '    "exports|src/x/rest.js|rest",\n';
const FREMD_EINTRAG = '"files|src/alt/weg.js|src/alt/weg.js"';
const FREMD_BEFUND = `    ${FREMD_EINTRAG},\n`;
const PORTS_MODUL = '"src/mail/ports.js", ';

const BASIS = {
  ".github/CODEOWNERS": "/tools/ @Antonio20045\n",
  "package.json": JSON.stringify({ type: "module" }),
  [PORTS]: "export {};\n",
  "src/x/rest.js": "export const rest = 1;\n",
  [BEREICHE]: String.raw`[
  {
    "bereich": "probe",
    "quellen": ["^src/"],
    "eingaenge": [
${REST_MUSTER}
      "^src/[^/]+/ports\\.[jt]s$",
      "^src/nie\\.js$"
    ]
  }
]
`,
  [KNIP]: `{
  "befunde": [
${REST_BEFUND}${FREMD_BEFUND}    "files|src/mail/ports.js|src/mail/ports.js"
  ]
}
`,
  [GATES]: `{
  "Probe": {
    "module": [${PORTS_MODUL}"src/x/rest.js"],
    "tests": []
  }
}
`,
};

function aenderung(verzeichnis, { loeschen = [PORTS], danach = {} }) {
  if (loeschen.length > 0) runIn(verzeichnis, "git", ["rm", "-q", ...loeschen]);
  const lauf = runIn(verzeichnis, process.execPath, [LISTEN_KUERZEN, "--basis", "HEAD"]);
  assert.equal(lauf.status, EXIT_OK, lauf.stdout + lauf.stderr);
  const gelesen = (pfad) => readFileSync(join(verzeichnis, pfad), "utf8");
  writeFiles(verzeichnis, Object.fromEntries(Object.entries(danach).map(([pfad, umformen]) => [pfad, umformen(gelesen(pfad))])));
  commitAll(verzeichnis, "Löschung");
}

function kuerzungen(context, aenderungen) {
  const verzeichnis = probeRepository(context, BASIS);
  aenderung(verzeichnis, aenderungen);
  return nachgerechnet(verzeichnis, { modul: "tools/freigabe-listenkuerzung.mjs", funktion: "listenkuerzungen", basis: "HEAD~1", pfade: ALLE_LISTEN });
}

test("listenkuerzung: Löschung und die nachgerechnete Kürzung zählen als Listenkürzung", (context) => {
  assert.deepEqual(kuerzungen(context, {}), [KNIP, BEREICHE]);
});

test("listenkuerzung: wird ein Eintrag gestrichen, dessen Datei weiter existiert, ist die Liste keine Listenkürzung", (context) => {
  const danach = { [KNIP]: (text) => text.replace(REST_BEFUND, "") };
  assert.deepEqual(kuerzungen(context, { danach }), [BEREICHE]);
});

test("listenkuerzung: wird ein schon an der Basis behobener fremder Eintrag mitgestrichen, ist die Liste keine Listenkürzung", (context) => {
  const danach = { [KNIP]: (text) => text.replace(`,\n    ${FREMD_EINTRAG}`, "") };
  assert.deepEqual(kuerzungen(context, { danach }), [BEREICHE]);
});

test("listenkuerzung: ändert sich neben der Kürzung noch etwas an der Liste, ist sie keine Listenkürzung", (context) => {
  const danach = { [BEREICHE]: (text) => text.replace(REST_MUSTER, `${REST_MUSTER}\n      "^src/neu\\\\.js$",`) };
  assert.deepEqual(kuerzungen(context, { danach }), [KNIP]);
});

test("listenkuerzung: ohne Löschung im PR ist keine gekürzte Liste eine Listenkürzung", (context) => {
  const danach = { [KNIP]: (text) => text.replace(REST_BEFUND, "") };
  assert.deepEqual(kuerzungen(context, { loeschen: [], danach }), []);
});

test("listenkuerzung: eine gekürzte Schutzliste wie tools/gate-tests.json ist keine Listenkürzung", (context) => {
  const danach = { [GATES]: (text) => text.replace(PORTS_MODUL, "") };
  assert.deepEqual(kuerzungen(context, { danach }), [KNIP, BEREICHE]);
});

test("listenkuerzung: eine Liste ohne gültiges JSON ist keine Listenkürzung", (context) => {
  const danach = { [KNIP]: () => "{\n" };
  assert.deepEqual(kuerzungen(context, { danach }), [BEREICHE]);
});

async function freigabePruefung(context, aenderungen) {
  const verzeichnis = probeRepository(context, BASIS);
  const basis = runIn(verzeichnis, "git", ["rev-parse", "HEAD"]).stdout.trim();
  aenderung(verzeichnis, aenderungen);
  return freigabeImProbeRepo(context, { verzeichnis, basis });
}

test("freigabe-pruefung: eine Löschung mit der nachgerechneten Listenkürzung ist art:code ohne Freigabe", async (context) => {
  codeOhneFreigabe(await freigabePruefung(context, {}));
});

test("freigabe-pruefung: streicht die Kürzung einen Eintrag, dessen Datei weiter existiert, wartet die Liste als art:pruefung", async (context) => {
  const lauf = await freigabePruefung(context, { danach: { [KNIP]: (text) => text.replace(REST_BEFUND, "") } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Art art:pruefung\./);
  assert.match(grundZeile(lauf.stdout), /tools\/basis\/knip\.json/);
  assert.doesNotMatch(grundZeile(lauf.stdout), /tools\/bereiche\.json/);
});
