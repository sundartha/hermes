import { test } from "node:test";
import assert from "node:assert/strict";

import { mitAnfrageKennung, mitKennung, setzeKennungInLogzeilen } from "../../src/utils/anfrage-kennung.ts";
import { merkeLogGeheimnisse } from "../../src/log-maske.js";
import { installProcessGuards } from "../../src/process-guards.js";
import * as metrics from "../../src/metrics.js";
import { WEB_SITZUNGS_GEHEIMNIS } from "./erfundene-geheimnisse.js";

const KENNUNG = "11111111-2222-3333-4444-555555555555";
const MARKE = `rid=${KENNUNG} `;

function geschrieben(stueck) {
  const gesehen = [];
  const schreiber = mitAnfrageKennung((text) => gesehen.push(text));
  setzeKennungInLogzeilen(true);
  mitKennung(KENNUNG, () => schreiber(stueck));
  setzeKennungInLogzeilen(false);
  return gesehen;
}

test("Kennung je Zeile: jede Zeile eines mehrzeiligen Stuecks beginnt mit rid=", () => {
  assert.deepEqual(geschrieben("a\nb\nc"), [`${MARKE}a\n${MARKE}b\n${MARKE}c`]);
});

test("Kennung je Zeile: die leere Zeile nach dem letzten Zeilenumbruch bekommt keine Kennung", () => {
  assert.deepEqual(geschrieben("a\nb\n"), [`${MARKE}a\n${MARKE}b\n`]);
});

test("Kennung je Zeile: nur die [metrics]-Zeile im Stueck bleibt ohne rid=", () => {
  assert.deepEqual(geschrieben("a\n[metrics] x {}\nc\n"), [`${MARKE}a\n[metrics] x {}\n${MARKE}c\n`]);
});

test("Kennung je Zeile: LOG_PREFIX kommt aus metrics und ist die [metrics]-Marke", () => {
  assert.equal(metrics.LOG_PREFIX, "[metrics]");
});

test("Prozess-Waechter: zweimal installiert steht rid= je Zeile einmal und das Geheimnis bleibt maskiert", () => {
  merkeLogGeheimnisse({ KENNUNG_ZEILEN_SECRET: WEB_SITZUNGS_GEHEIMNIS });
  const gesehen = [];
  const vorher = process.stderr.write;
  process.stderr.write = (text) => gesehen.push(text);
  try {
    installProcessGuards();
    installProcessGuards();
    setzeKennungInLogzeilen(true);
    mitKennung(KENNUNG, () => process.stderr.write(`a ${WEB_SITZUNGS_GEHEIMNIS}\nb\n`));
  } finally {
    setzeKennungInLogzeilen(false);
    process.stderr.write = vorher;
  }
  assert.deepEqual(gesehen, [`${MARKE}a ***\n${MARKE}b\n`]);
});
