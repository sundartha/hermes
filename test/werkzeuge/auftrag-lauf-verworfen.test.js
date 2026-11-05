import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { ABSATZ_ALTER_STAND, ALT_MUTANT, MIT_MUTATION } from "./auftrag-lauf-hilfen.js";
import { BASIS, EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

test("ein Umbau ungeschützten Verhaltens wird verworfen; mit dem Test auf dem alten Stand läuft er neu", (context) => {
  const umbau = { "src/text.js": "export function gross(text) {\n  return text.toLocaleUpperCase();\n}\n" };
  const leerTest = { "test/text.test.js": `${BASIS["test/text.test.js"]}test("leer", () => assert.equal(gross(""), ""));\n` };
  for (const [nachrunde, status] of [[{}, EXIT_ROT], [leerTest, 0]]) {
    const drehbuch = { bau: umbau, "test-nachrunde": nachrunde, "test-nachrunde-antwort": ABSATZ_ALTER_STAND };
    const { repo, werkzeug, lauf, beleg, basis } = starte(context, { auftrag: UMBAU, drehbuch, dateien: MIT_MUTATION });
    assert.equal(lauf.status, status, lauf.stdout + lauf.stderr);
    assert.ok(beleg.hinweise.includes(`Umbau verworfen: auf dem alten Stand überlebt ${ALT_MUTANT}`));
    assert.match(readFileSync(join(werkzeug, "prompt-test-nachrunde.txt"), "utf8"), /auf dem alten Stand/);
    const geaendert = runIn(repo, "git", ["diff", "--name-only", basis, "HEAD"]).stdout.trim();
    assert.equal(geaendert, status === 0 ? "src/text.js\ntest/text.test.js" : "");
  }
});
