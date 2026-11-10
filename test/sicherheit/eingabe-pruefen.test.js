import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { pruefeAbfrage, pruefeKoerper } from "../../src/utils/eingabe-pruefen.js";

const HTTP_BAD_REQUEST = 400;
const SCHEMA = z.object({ session_id: z.string().min(1) });

function antwort() {
  const res = { gesendet: null };
  res.status = (code) => {
    res.code = code;
    return res;
  };
  res.json = (nutzlast) => {
    res.gesendet = nutzlast;
    return res;
  };
  return res;
}

const FAELLE = [
  { name: "fehlend", eingabe: {}, gueltig: false },
  { name: "leer", eingabe: { session_id: "" }, gueltig: false },
  { name: "Zahl", eingabe: { session_id: 5 }, gueltig: false },
  { name: "null", eingabe: { session_id: null }, gueltig: false },
  { name: "Array", eingabe: { session_id: ["a", "b"] }, gueltig: false },
  { name: "Objekt", eingabe: { session_id: { a: 1 } }, gueltig: false },
  { name: "Text statt Objekt", eingabe: "text", gueltig: false },
  { name: "null statt Objekt", eingabe: null, gueltig: false },
  { name: "gueltig", eingabe: { session_id: "cs_1" }, gueltig: true },
];

const PRUEFER = [
  { name: "pruefeAbfrage", pruefe: pruefeAbfrage },
  { name: "pruefeKoerper", pruefe: pruefeKoerper },
];

for (const { name, pruefe } of PRUEFER) {
  for (const fall of FAELLE) {
    test(`${name} mit Eingabe ${fall.name} ohne Meldung`, () => {
      const res = antwort();
      const ergebnis = pruefe(res, { schema: SCHEMA }, fall.eingabe);
      if (fall.gueltig) {
        assert.deepEqual(ergebnis, fall.eingabe);
        assert.equal(res.code, undefined);
      } else {
        assert.equal(ergebnis, undefined);
        assert.equal(res.code, HTTP_BAD_REQUEST);
        assert.deepEqual(res.gesendet, { error: "invalid_body" });
      }
    });

    test(`${name} mit Eingabe ${fall.name} und eigener Meldung`, () => {
      const res = antwort();
      const ergebnis = pruefe(
        res,
        { schema: SCHEMA, meldung: "session_id ist Pflicht" },
        fall.eingabe,
      );
      if (fall.gueltig) {
        assert.deepEqual(ergebnis, fall.eingabe);
        assert.equal(res.code, undefined);
      } else {
        assert.equal(ergebnis, undefined);
        assert.equal(res.code, HTTP_BAD_REQUEST);
        assert.deepEqual(res.gesendet, { error: "session_id ist Pflicht" });
      }
    });
  }
}
