import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { SPEICHER_REGEL } from "../../tools/auftrag/agenten.mjs";
import { funktion, ROTER_TEST, umbauMitNachrunde, VERDOPPELT } from "./auftrag-lauf-hilfen.js";
import { starte } from "./auftrag-lauf-probe.js";

test("Speicher-Regel: der Test-Agent bekommt sie in der ersten Runde und in der Mutanten-Nachrunde", (context) => {
  const ersteRunde = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": VERDOPPELT } } });
  const nachrunde = umbauMitNachrunde(context);
  for (const [{ werkzeug, lauf }, rolle] of [[ersteRunde, "test"], [nachrunde, "test-nachrunde"]]) {
    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    const prompt = readFileSync(join(werkzeug, `prompt-${rolle}.txt`), "utf8");
    assert.ok(prompt.includes(`\n${SPEICHER_REGEL}\n`), `${rolle}: ${prompt}`);
  }
});
