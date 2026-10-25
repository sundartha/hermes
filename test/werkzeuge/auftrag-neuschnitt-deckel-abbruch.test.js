import assert from "node:assert/strict";
import { test } from "node:test";

import { BIS_ZUM_ABBRUCH } from "./nachrichten-ersatz.js";
import { ORDNER, PITCH, erkunderMitNachrichten, ersterVersuch, nachrichtenJeAufruf } from "./neuschnitt-probe.js";

const EXIT_DECKEL = 5;
const TAUSEND = 1000;
const LAUF_FRIST_MS = 240_000;
const DECKEL = 125 * TAUSEND;
const VOR_DER_MARKE = [20 * TAUSEND, 30 * TAUSEND, 40 * TAUSEND];
const NACH_DER_MARKE = [50 * TAUSEND, 60 * TAUSEND];
const ABBRUCH = /Deckel (\d+) Token: gemessen (\d+), live (\d+), Vorhalt (\d+)/;

function mitFreigabe(deckel) {
  return { [`${ORDNER}/pitch.md`]: PITCH.replace("\n\n## Anforderungen", `\n\nPlanung freigegeben: ${deckel} Token\n\n## Anforderungen`) };
}

test("Neuschnitt --deckel: der laufende Verbrauch bricht den Erkunder des Neuschnitts am Deckel ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const erkunder = erkunderMitNachrichten([...VOR_DER_MARKE, BIS_ZUM_ABBRUCH, ...NACH_DER_MARKE]);
  const versuch = ersterVersuch(context, { erkunder: [erkunder] }, { dateien: mitFreigabe(DECKEL) });

  assert.deepEqual(nachrichtenJeAufruf(versuch, "erkunder"), [VOR_DER_MARKE.length]);
  assert.equal(versuch.versuche.length, 1, JSON.stringify(versuch.versuche));
  const { exit, grund } = versuch.versuche[0].planung;
  assert.equal(exit, EXIT_DECKEL, grund);
  const [, genannt, gemessen, live, vorhalt] = ABBRUCH.exec(grund) ?? assert.fail(grund);
  assert.equal(Number(genannt), DECKEL, grund);
  assert.ok(Number(gemessen) + Number(live) + Number(vorhalt) > DECKEL, grund);
  assert.ok(grund.includes("„Erkundung des Neuschnitts“"), grund);
  assert.deepEqual(["planer", "pruefer-planung", "entwurf"].map((rolle) => versuch.datei(`anzahl-${rolle}`)), ["", "", ""]);
  assert.match(versuch.datei("gh.log"), new RegExp(`Der Neuschnitt hat am Kostendeckel angehalten; ein weiterer Versuch lief nicht\\. Deckel ${DECKEL} Token: gemessen`));
});
