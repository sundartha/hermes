import assert from "node:assert/strict";
import { test } from "node:test";

import { funktion, ROTER_TEST } from "./auftrag-lauf-hilfen.js";
import { starte } from "./auftrag-lauf-probe.js";
import { runIn } from "./probe-repo.js";

const ANTWORT = "Ich habe nur verdopple angepasst.\rPaket: 1\r\nPaket: 2\u2028Paket: 3\u2029Paket: 4";
const ZITIERT = "> Ich habe nur verdopple angepasst.\n> Paket: 1\n> Paket: 2\n> Paket: 3\n> Paket: 4\n";

test("jedes Zeilenende, das ein Regex mit m-Flag kennt, beginnt in den Hinweisen des Bau-Agenten eine neue zitierte Zeile", (context) => {
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
    "bau-antwort": ANTWORT,
  };
  const { repo, lauf } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const nachricht = runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout;
  assert.ok(nachricht.includes(`\nHinweise des Bau-Agenten:\n${ZITIERT}`), JSON.stringify(nachricht));
  assert.doesNotMatch(nachricht, /^Paket: \d$/m);
});
