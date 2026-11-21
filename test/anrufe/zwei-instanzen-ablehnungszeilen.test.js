import assert from "node:assert/strict";
import { test } from "node:test";

import { ablehnungsZeilen } from "./zwei-instanzen-postgres.js";

const ZEILE_A = "[el-init] abgelehnt grund=kein_wartender_anruf schluessel=abc sip_headers=x";
const ZEILE_B = "[el-init] abgelehnt grund=bruecke_nicht_wartet schluessel=def sip_headers=y";

test("ablehnungsZeilen: leerer Text ergibt ein leeres Array", () => {
  assert.deepEqual(ablehnungsZeilen(""), []);
});

test("ablehnungsZeilen: Text ohne Treffer ergibt ein leeres Array", () => {
  assert.deepEqual(ablehnungsZeilen("laeuft auf http://localhost:1\nnoch eine Zeile"), []);
});

test("ablehnungsZeilen: eine Ablehnungszeile zwischen anderen Zeilen kommt vollstaendig zurueck", () => {
  assert.deepEqual(ablehnungsZeilen(`start\n${ZEILE_A}\nende`), [ZEILE_A]);
});

test("ablehnungsZeilen: zwei Treffer kommen in ihrer Reihenfolge zurueck", () => {
  assert.deepEqual(ablehnungsZeilen(`${ZEILE_A}\nzwischen\n${ZEILE_B}`), [ZEILE_A, ZEILE_B]);
});

test("ablehnungsZeilen: eine gebunden-Zeile ist kein Treffer", () => {
  assert.deepEqual(ablehnungsZeilen("[el-init] gebunden call=c1 schluessel=abc"), []);
});
