import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { SPEICHER_REGEL } from "../../tools/auftrag/agenten.mjs";
import { ABSATZ_MUTATION, ehrlicheNachrunde, mitSieben, NOETIG, SIEBEN_TEST } from "./auftrag-lauf-hilfen.js";

test("Speicher-Regel: der Test-Agent bekommt sie in der ersten Runde und in der Mutanten-Nachrunde", (context) => {
  const nachgeholt = { "test-nachrunde": { "test/rechnen.test.js": SIEBEN_TEST }, "test-nachrunde-antwort": ABSATZ_MUTATION };
  const { werkzeug, lauf } = mitSieben(context, { ...ehrlicheNachrunde(NOETIG), ...nachgeholt });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  for (const rolle of ["test", "test-nachrunde"]) {
    const prompt = readFileSync(join(werkzeug, `prompt-${rolle}.txt`), "utf8");
    assert.ok(prompt.includes(`\n${SPEICHER_REGEL}\n`), `${rolle}: ${prompt}`);
  }
});
