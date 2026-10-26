import assert from "node:assert/strict";
import { test } from "node:test";

import { ohneTestdatei } from "../../tools/auftrag/gleichwertig.mjs";
import { ABSATZ_ALTER_STAND, MIT_MUTATION } from "./auftrag-lauf-hilfen.js";
import { EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const OHNE_TEST = ohneTestdatei("src/text.js", 2).schluessel;
const GRUND = "die Datei kein Modul importiert";
const ERSATZ_MUTATION = `const alt = process.argv.includes("--alter-stand");
if (alt) process.exitCode = 1;
console.log(alt ? ${JSON.stringify(`Verstoß: Mutant überlebt: ${OHNE_TEST}`)} : "grün: keiner überlebt");
`;

test("meldet der Test-Agent einen Mutanten ohne Testdatei mit Datei und Zeile als gleichwertig, steht die Meldung in der Entscheidungsnotiz und der Umbau bleibt zurückgestellt", (context) => {
  const drehbuch = {
    bau: {
      "src/text.js": "export function gross(text) {\n  return text.toLocaleUpperCase();\n}\n",
    },
    "test-nachrunde": {},
    "test-nachrunde-antwort": `${ABSATZ_ALTER_STAND}\n\nGleichwertig: src/text.js:2, weil ${GRUND}`,
  };
  const { repo, lauf, beleg, basis } = starte(context, {
    auftrag: UMBAU,
    drehbuch,
    dateien: { ...MIT_MUTATION, "mutation.mjs": ERSATZ_MUTATION },
  });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  const zeilen = (beleg.entscheidung?.text ?? "").split("\n");
  const kopf = zeilen.indexOf("Gleichwertig laut Test-Agent, braucht eine Freigabe:");
  assert.ok(kopf >= 0, zeilen.join("\n"));
  assert.equal(zeilen[kopf + 1], `Gleichwertig: ${OHNE_TEST}, weil ${GRUND}`);
  assert.ok(zeilen.includes(`- ${OHNE_TEST}`), zeilen.join("\n"));
  assert.equal(runIn(repo, "git", ["diff", "--name-only", basis, "HEAD"]).stdout.trim(), "");
});
