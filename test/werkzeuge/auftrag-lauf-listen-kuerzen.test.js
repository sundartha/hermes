import assert from "node:assert/strict";
import { test } from "node:test";

import { BASIS, UMBAU } from "./auftrag-lauf-probe.js";
import { MIT_MUTATION, MUTANT, grenzenBau, listenLauf, zeigt } from "./auftrag-lauf-listen-probe.js";
import { runIn } from "./probe-repo.js";

const PORTS = "src/weg/ports.js";
const TOTES_MUSTER = String.raw`      "^src/[^/]+/ports\\.[jt]s$",
`;
const BEREICHE = String.raw`[
  {
    "bereich": "probe",
    "quellen": ["^src/a\\.js$"],
    "eingaenge": [
      "^src/a\\.js$",
${TOTES_MUSTER.trimEnd()}
      "^src/text\\.js$"
    ]
  }
]
`;
const AUFTRAG = { ...UMBAU, ziel: "Lösche die leere Datei src/weg/ports.js", erwarteteDateien: [PORTS] };
const DREHBUCH = { "bau-loeschen": [PORTS] };
const NACH_LOESCHUNG = `D\t${PORTS}\nM\ttools/bereiche.json\n`;

function geloescht(context, { drehbuch = DREHBUCH, skripte = {}, zusatz = {} } = {}) {
  return listenLauf(context, { auftrag: AUFTRAG, drehbuch, listen: { "tools/bereiche.json": BEREICHE, [PORTS]: "export {};\n" }, skripte, zusatz });
}

test("auftrag-lauf-listen-kuerzen: ein Umbau, der eine Datei löscht, endet mit Commit, der die Löschung und die gekürzte tools/bereiche.json enthält", (context) => {
  const { repo, lauf, basis } = geloescht(context);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(runIn(repo, "git", ["diff", "--name-status", "--no-renames", basis, "HEAD"]).stdout, NACH_LOESCHUNG);
  assert.equal(zeigt(repo, "tools/bereiche.json"), BEREICHE.replace(TOTES_MUSTER, ""));
});

test("auftrag-lauf-listen-kuerzen: Beleg und Commit-Nachricht nennen listen-kuerzen mit Exit 0, und grenzen bau ist nicht rot", (context) => {
  const { repo, lauf, beleg } = geloescht(context);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.ok(beleg.pruefungen.some(({ name, exitCode }) => name === "listen-kuerzen" && exitCode === 0), JSON.stringify(beleg.pruefungen));
  assert.match(runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout, /^listen-kuerzen: Exit 0$/m);
  assert.deepEqual(grenzenBau(beleg), [0]);
});

test("auftrag-lauf-listen-kuerzen: wiederholt der Lauf nach einem überlebenden Mutanten die Bau-Schritte, zählt grenzen bau die eigene Kürzung nicht als Verstoß", (context) => {
  const drehbuch = { ...DREHBUCH, bau: { "src/text.js": BASIS["src/text.js"].replace("return text", "return  text") }, "bau-nachrunde-antwort": `Gleichwertig: ${MUTANT}, weil nur ein Leerzeichen dazukam` };
  const { repo, lauf, beleg } = geloescht(context, { drehbuch, ...MIT_MUTATION });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual(grenzenBau(beleg), [0, 0]);
  assert.equal(zeigt(repo, "tools/bereiche.json"), BEREICHE.replace(TOTES_MUSTER, ""));
});
