import { test } from "node:test";
import assert from "node:assert/strict";

const REGELN_FEHLEN = "Lebenszeichen: die Regeln für Fehlerart und Verzug fehlen";
const MODUL_FEHLT = "ERR_MODULE_NOT_FOUND";
const GRENZE_MS = 20;

const regeln = await import("../../src/lebenszeichen-regeln.js").catch((fehler) => {
  if (fehler?.code === MODUL_FEHLT) return null;
  throw fehler;
});

function ladeRegeln() {
  assert.equal(typeof regeln?.fehlerart, "function", REGELN_FEHLEN);
  assert.equal(typeof regeln?.verzugUeberGrenze, "function", REGELN_FEHLEN);
  return regeln;
}

const mitCode = (code, ursache) =>
  Object.assign(new Error("gescheitert", ursache ? { cause: ursache } : undefined), { code });

const NETZFEHLER = new TypeError("fetch failed", { cause: mitCode("ECONNREFUSED") });
const NETZFEHLER_MIT_EIGENEM_CODE = mitCode("EIGEN", mitCode("ECONNRESET"));
const URSACHE_OHNE_CODE = mitCode("57P01", new Error("ohne Code"));
const ZEITUEBERSCHREITUNG = new DOMException("Frist abgelaufen", "TimeoutError");

test("Lebenszeichen: die Fehlerart nennt den Code der Ursache, sonst den eigenen Code, sonst den Namen", () => {
  const { fehlerart } = ladeRegeln();
  const faelle = [
    ["Netzfehler mit Code in der Ursache", NETZFEHLER, "ECONNREFUSED"],
    ["Code der Ursache vor eigenem Code", NETZFEHLER_MIT_EIGENEM_CODE, "ECONNRESET"],
    ["Fehler mit eigenem Code", mitCode("ECONNREFUSED"), "ECONNREFUSED"],
    ["Ursache ohne Code, eigener Code", URSACHE_OHNE_CODE, "57P01"],
    ["Fehler nur mit Namen, Zahl als Code", ZEITUEBERSCHREITUNG, "TimeoutError"],
  ];
  for (const [fall, fehler, erwartet] of faelle) {
    assert.equal(fehlerart(fehler), erwartet, `Lebenszeichen: Fehlerart bei ${fall}`);
  }
});

test("Lebenszeichen: die Fehlerart nennt auch ohne Fehlerobjekt einen nicht leeren Grund", () => {
  const { fehlerart } = ladeRegeln();
  for (const [fall, fehler] of [
    ["undefined", undefined],
    ["null", null],
    ["Objekt ohne Namen", {}],
  ]) {
    const grund = fehlerart(fehler);
    assert.equal(typeof grund, "string", `Lebenszeichen: Fehlerart bei ${fall} ist kein Text`);
    assert.notEqual(grund.trim(), "", `Lebenszeichen: Fehlerart bei ${fall} ist leer`);
  }
});

test("Lebenszeichen: der Verzug ist nur echt über der Grenze krank", () => {
  const { verzugUeberGrenze } = ladeRegeln();
  const faelle = [
    ["beide unter der Grenze", 5, 5, false],
    ["nur der Takt-Verzug drüber", 25, 5, true],
    ["nur der Höchstverzug drüber", 5, 25, true],
    ["beide drüber", 25, 25, true],
    ["Takt-Verzug genau auf der Grenze", GRENZE_MS, 5, false],
    ["Höchstverzug genau auf der Grenze", 5, GRENZE_MS, false],
  ];
  for (const [fall, taktVerzugMs, hoechstVerzugMs, krank] of faelle) {
    assert.equal(
      verzugUeberGrenze({ taktVerzugMs, hoechstVerzugMs, grenzeMs: GRENZE_MS }),
      krank,
      `Lebenszeichen: Verzug bei ${fall}`,
    );
  }
});
