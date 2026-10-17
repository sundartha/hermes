import assert from "node:assert/strict";
import { test } from "node:test";

import { prueferBefehl } from "../../tools/auftrag/pruefer-lauf.mjs";

const ENDSTAND = "am Endstand des Pull Requests";
const ALTE_REGEL = "auf diesem Commit";

test("der Prüfer bekommt in Schema und Anweisung dieselbe Regel, dass die Reproduktion am Endstand des Pull Requests scheitert", () => {
  const befehl = prueferBefehl({ dateien: ["src/zahl.js"], kritisch: false }, "claude");
  const anweisung = befehl[befehl.indexOf("--append-system-prompt") + 1];
  const { befunde } = JSON.parse(befehl[befehl.indexOf("--json-schema") + 1]).properties;
  const { reproduktion } = befunde.items.properties;
  const beschreibung = reproduktion.description;
  assert.ok(anweisung.includes(`Die Reproduktion läuft ${ENDSTAND}`), anweisung);
  assert.ok(beschreibung.includes(`${ENDSTAND} an einer Erwartung scheitert`), beschreibung);
  assert.ok(!beschreibung.includes(ALTE_REGEL), beschreibung);
});
