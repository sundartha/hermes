import assert from "node:assert/strict";
import { test } from "node:test";

import { ABSATZ_ALTER_STAND, MIT_MUTATION } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const ERSTER = "src/text.js:2:10 MethodExpression → text";
const ZWEITER = "src/text.js:2:3 ReturnStatement → ;";
const GRUND = "der Aufruf dasselbe Ergebnis liefert";
const UMBAU_QUELLE = { "src/text.js": "export function gross(text) {\n  return text.toLocaleUpperCase();\n}\n" };
const ERSATZ_MUTATION = `const gemeldet = process.argv.flatMap((wert, index) => (process.argv[index - 1] === "--gleichwertig" ? [wert] : []));
const alt = process.argv.includes("--alter-stand");
const offen = alt ? ${JSON.stringify([ERSTER, ZWEITER])}.filter((mutant) => !gemeldet.includes(mutant)) : [];
if (offen.length > 0) process.exitCode = 1;
for (const mutant of offen) console.log("Verstoß: Mutant überlebt: " + mutant);
if (offen.length === 0) console.log("grün: keiner überlebt");
`;

function umbau(context, meldungen) {
  const drehbuch = {
    bau: UMBAU_QUELLE,
    "test-nachrunde": {},
    "test-nachrunde-antwort": [ABSATZ_ALTER_STAND, "", ...meldungen.map((mutant) => `Gleichwertig: ${mutant}, weil ${GRUND}`)].join("\n"),
  };
  return starte(context, { auftrag: UMBAU, drehbuch, dateien: { ...MIT_MUTATION, "mutation.mjs": ERSATZ_MUTATION } });
}

test("meldet der Test-Agent alle überlebenden Mutanten des alten Stands als gleichwertig, nimmt der Lauf sie an, baut den Umbau ein und nennt die Meldungen im Bericht", (context) => {
  const { repo, lauf } = umbau(context, [ERSTER, ZWEITER]);
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const nachricht = runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout;
  assert.ok(nachricht.includes(`Gleichwertig: ${ERSTER}, weil ${GRUND}`), nachricht);
  assert.ok(nachricht.includes(`Gleichwertig: ${ZWEITER}, weil ${GRUND}`), nachricht);
  assert.match(runIn(repo, "git", ["show", "HEAD:src/text.js"]).stdout, /toLocaleUpperCase/);
});

test("meldet der Test-Agent nur einen von zwei überlebenden Mutanten des alten Stands als gleichwertig, bleibt der andere ein Fall für „Entscheidung nötig“", (context) => {
  const { repo, lauf, beleg, basis } = umbau(context, [ERSTER]);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  const zeilen = (beleg.entscheidung?.text ?? "").split("\n");
  assert.ok(zeilen.includes(`- ${ZWEITER}`), zeilen.join("\n"));
  assert.ok(!zeilen.includes(`- ${ERSTER}`), zeilen.join("\n"));
  assert.equal(runIn(repo, "git", ["diff", "--name-only", basis, "HEAD"]).stdout.trim(), "");
});
