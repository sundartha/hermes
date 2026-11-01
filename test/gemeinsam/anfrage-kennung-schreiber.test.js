import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mitAnfrageKennung,
  mitKennung,
  setzeKennungInLogzeilen,
} from "../../src/utils/anfrage-kennung.js";

const KENNUNG = "11111111-2222-3333-4444-555555555555";
const ZEILE = "[voice-antwort] weg=/voice/incoming status=200\n";
const MIT_MARKE = `rid=${KENNUNG} ${ZEILE}`;
const MESSZEILE = '[metrics] call_denied {"country":"US"}\n';

function schreibeMit({ schalter, kennung, stueck, umhuellungen = 1, rest = [] }) {
  const gesehen = [];
  const echt = function (...args) {
    gesehen.push(args);
    return true;
  };
  const schreiber = Array.from({ length: umhuellungen }).reduce(
    (innen) => mitAnfrageKennung(innen),
    echt,
  );
  setzeKennungInLogzeilen(schalter);
  const schreibe = () => schreiber(stueck, ...rest);
  if (kennung === undefined) schreibe();
  else mitKennung(kennung, schreibe);
  return gesehen;
}

test("Kennung im Schreiber: mit Schalter und Anfragekontext beginnt der Text mit rid=KENNUNG", () => {
  const gesehen = schreibeMit({ schalter: true, kennung: KENNUNG, stueck: ZEILE });
  assert.deepEqual(gesehen, [[MIT_MARKE]]);
});

test("Kennung im Schreiber: ohne Schalter bleibt der Text unveraendert", () => {
  const gesehen = schreibeMit({ schalter: false, kennung: KENNUNG, stueck: ZEILE });
  assert.deepEqual(gesehen, [[ZEILE]]);
});

test("Kennung im Schreiber: nur der Wert true schaltet ein, kein anderer", () => {
  const gesehen = schreibeMit({ schalter: "true", kennung: KENNUNG, stueck: ZEILE });
  assert.deepEqual(gesehen, [[ZEILE]]);
});

test("Kennung im Schreiber: ohne Anfragekontext bleibt der Text auch mit Schalter unveraendert", () => {
  const gesehen = schreibeMit({ schalter: true, kennung: undefined, stueck: ZEILE });
  assert.deepEqual(gesehen, [[ZEILE]]);
});

test("Kennung im Schreiber: eine [metrics]-Zeile bleibt mit Schalter und Anfragekontext unveraendert", () => {
  const gesehen = schreibeMit({ schalter: true, kennung: KENNUNG, stueck: MESSZEILE });
  assert.deepEqual(gesehen, [[MESSZEILE]]);
});

test("Kennung im Schreiber: ein Byte-Stueck geht unveraendert durch, ohne Fehler", () => {
  const stueck = Buffer.from(ZEILE);
  const gesehen = schreibeMit({ schalter: true, kennung: KENNUNG, stueck });
  assert.equal(gesehen.length, 1);
  assert.equal(gesehen[0][0], stueck);
});

test("Kennung im Schreiber: doppeltes Umhuellen setzt die Kennung nur einmal", () => {
  const gesehen = schreibeMit({ schalter: true, kennung: KENNUNG, stueck: ZEILE, umhuellungen: 2 });
  assert.deepEqual(gesehen, [[MIT_MARKE]]);
});

test("Kennung im Schreiber: Kodierung und Rueckruf kommen unveraendert beim echten Schreiber an", () => {
  const rueckruf = () => {};
  const gesehen = schreibeMit({
    schalter: true,
    kennung: KENNUNG,
    stueck: ZEILE,
    rest: ["utf8", rueckruf],
  });
  assert.deepEqual(gesehen, [[MIT_MARKE, "utf8", rueckruf]]);
});

test("Kennung im Schreiber: mitKennung gibt das Ergebnis des Aufrufs zurueck", () => {
  assert.equal(
    mitKennung(KENNUNG, () => 42),
    42,
  );
});

test("Kennung im Schreiber: ohne ein Setzen ist der Schalter aus", async () => {
  const frisch = await import("../../src/utils/anfrage-kennung.js?vorgabe");
  const gesehen = [];
  const schreiber = frisch.mitAnfrageKennung((...args) => gesehen.push(args));
  frisch.mitKennung(KENNUNG, () => schreiber(ZEILE));
  assert.deepEqual(gesehen, [[ZEILE]]);
});
