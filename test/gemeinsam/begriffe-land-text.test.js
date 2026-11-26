import assert from "node:assert/strict";
import { test } from "node:test";

import {
  allowedPrivateNumberCodes,
  assertKaufbaresLand,
  kauflandFuer,
} from "../../src/begriffe/rufnummern.ts";
import { sanitizeProfile } from "../../src/begriffe/profil.ts";

const KAUFLAND_TABELLE = [
  ["us", "US"],
  ["US", "US"],
  ["DE", "US"],
  [null, "US"],
  [undefined, "US"],
  ["", "US"],
  [["DE"], "US"],
];

const PRIVATNUMMER_CODES_TABELLE = [
  ["at", ["+43"]],
  ["DE", ["+49"]],
  ["us", ["+1"]],
  ["xx", ["+49"]],
  [null, ["+49"]],
  [undefined, ["+49"]],
  ["", ["+49"]],
  [["AT"], ["+49"]],
  [43, ["+49"]],
];

test("kauflandFuer: Land als Text, alles andere ergibt das kaufbare Land", () => {
  for (const [land, erwartet] of KAUFLAND_TABELLE) {
    assert.equal(kauflandFuer(land), erwartet, JSON.stringify(land));
  }
});

test("allowedPrivateNumberCodes: nur ein Text ist ein Land, ein Array oder eine Zahl nicht", () => {
  for (const [land, erwartet] of PRIVATNUMMER_CODES_TABELLE) {
    assert.deepEqual(allowedPrivateNumberCodes(land), erwartet, JSON.stringify(land));
  }
});

test("assertKaufbaresLand: kaufbares Land geht durch, Text und fehlender Wert stehen in der Meldung", () => {
  assert.doesNotThrow(() => assertKaufbaresLand("us", "wo"));
  assert.doesNotThrow(() => assertKaufbaresLand("US", "wo"));
  assert.throws(() => assertKaufbaresLand("DE", "wo"), /^Error: wo: Land DE ist nicht kaufbar/);
  assert.throws(() => assertKaufbaresLand("", "wo"), /Land unbekannt ist nicht kaufbar/);
  assert.throws(() => assertKaufbaresLand(undefined, "wo"), /Land unbekannt ist nicht kaufbar/);
  assert.throws(() => assertKaufbaresLand(null, "wo"), /Land unbekannt ist nicht kaufbar/);
});

test("assertKaufbaresLand: ein Array oder eine Zahl ist kein Land, auch wenn sein Text eines waere", () => {
  assert.throws(() => assertKaufbaresLand(["US"], "wo"), /Land unbekannt ist nicht kaufbar/);
  assert.throws(() => assertKaufbaresLand(5, "wo"), /Land unbekannt ist nicht kaufbar/);
});

test("sanitizeProfile: ohne Aenderung kommt ein leeres Profil, bekannte Felder bleiben", () => {
  assert.deepEqual(sanitizeProfile(null), {});
  assert.deepEqual(sanitizeProfile(undefined), {});
  assert.deepEqual(sanitizeProfile(0), {});
  assert.deepEqual(sanitizeProfile({ unrestricted: true, fremd: 1 }), { unrestricted: true });
});
