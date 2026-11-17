import assert from "node:assert/strict";
import { test } from "node:test";

import { errorHandler } from "../../src/middleware.ts";
import { fehlerausgabeVon } from "./fehlerausgabe.js";

function fehlerMitStapel(stapel) {
  const err = new Error("meldung");
  err.stack = stapel;
  return err;
}

const GELOGGT = [
  ["Error mit Stack loggt den Stack", fehlerMitStapel("Stapeltext"), "[error] Stapeltext"],
  ["Error ohne Stack loggt Name und Meldung", fehlerMitStapel(""), "[error] Error: meldung"],
  ["Text loggt den Text", "text", "[error] text"],
  ["null loggt null", null, "[error] null"],
  ["undefined loggt undefined", undefined, "[error] undefined"],
  [
    "Objekt mit stack ist kein Error und loggt String(err)",
    { stack: "x" },
    "[error] [object Object]",
  ],
];

for (const [name, wurf, erwartet] of GELOGGT) {
  test(`fehler-stapel: ${name}`, () => {
    const status = [];
    const res = {
      headersSent: false,
      status(code) {
        status.push(code);
        return { json: () => undefined };
      },
    };
    const zeilen = fehlerausgabeVon(() => errorHandler(wurf, {}, res, () => undefined));
    assert.deepEqual(zeilen, [erwartet]);
    assert.deepEqual(status, [500]);
  });
}

test("fehler-stapel: nach gesendeten Headern geht der Wurf an next und es folgt keine Antwort", () => {
  const weitergegeben = [];
  const status = [];
  const res = {
    headersSent: true,
    status(code) {
      status.push(code);
      return { json: () => undefined };
    },
  };
  const wurf = fehlerMitStapel("Stapeltext");
  fehlerausgabeVon(() => errorHandler(wurf, {}, res, (e) => weitergegeben.push(e)));
  assert.deepEqual(weitergegeben, [wurf]);
  assert.deepEqual(status, []);
});
