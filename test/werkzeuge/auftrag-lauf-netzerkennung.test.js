import assert from "node:assert/strict";
import { test } from "node:test";

import { netzabbruch } from "../../tools/auftrag/netz.mjs";

const EXIT_ABBRUCH = 1;
const EXIT_GRUEN = 0;

const ECONNRESET = "API Error: Connection dropped (ECONNRESET)";
const ENOTFOUND = "API Error: Can't reach the API server — check your internet or DNS (ENOTFOUND)";
const ECONNREFUSED = "API Error: Connection refused — a firewall or proxy may be blocking it (ECONNREFUSED)";
const KEINE_ANTWORT = "API Error: No response from API (waited 3m, then 10m on the retry). If a proxy or gateway on your network holds responses until they complete, raise API_TIMEOUT_MS or CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS to wait longer.";

function pruefeNetzabbruch(text) {
  assert.equal(netzabbruch({ exitCode: EXIT_ABBRUCH, volleAntwort: text }), true);
  assert.equal(netzabbruch({ exitCode: EXIT_ABBRUCH, volleAntwort: `  ${text}\n` }), true);
}

function pruefeKeinNetzabbruchBeiExitNull(text) {
  assert.equal(netzabbruch({ exitCode: EXIT_GRUEN, volleAntwort: text }), false);
}

function pruefeKeinNetzabbruch(text) {
  assert.equal(netzabbruch({ exitCode: EXIT_ABBRUCH, volleAntwort: text }), false);
}

test("ECONNRESET mit Exit 1 ist ein Netzabbruch, auch mit Leerraum drumherum", () => pruefeNetzabbruch(ECONNRESET));
test("ENOTFOUND mit Exit 1 ist ein Netzabbruch, auch mit Leerraum drumherum", () => pruefeNetzabbruch(ENOTFOUND));
test("ECONNREFUSED mit Exit 1 ist ein Netzabbruch, auch mit Leerraum drumherum", () => pruefeNetzabbruch(ECONNREFUSED));
test("„No response from API“ mit Exit 1 ist ein Netzabbruch, auch mit Leerraum drumherum", () => pruefeNetzabbruch(KEINE_ANTWORT));

test("ECONNRESET mit Exit 0 ist kein Netzabbruch", () => pruefeKeinNetzabbruchBeiExitNull(ECONNRESET));
test("ENOTFOUND mit Exit 0 ist kein Netzabbruch", () => pruefeKeinNetzabbruchBeiExitNull(ENOTFOUND));
test("ECONNREFUSED mit Exit 0 ist kein Netzabbruch", () => pruefeKeinNetzabbruchBeiExitNull(ECONNREFUSED));
test("„No response from API“ mit Exit 0 ist kein Netzabbruch", () => pruefeKeinNetzabbruchBeiExitNull(KEINE_ANTWORT));

test("ein 400 invalid_request_error mit Exit 1 ist kein Netzabbruch", () => pruefeKeinNetzabbruch("API Error: 400 invalid_request_error"));
test("ein 408 Request timeout mit Exit 1 ist kein Netzabbruch", () => pruefeKeinNetzabbruch("API Error: 408 Request timeout"));
test("ECONNRESET mit angehängtem Text und Exit 1 ist kein Netzabbruch", () => pruefeKeinNetzabbruch(`${ECONNRESET} und danach noch Text`));
test("ECONNRESET als letzte Zeile eines Fließtexts mit Exit 1 ist kein Netzabbruch", () => pruefeKeinNetzabbruch(`Ich habe das Repository gelesen.\n${ECONNRESET}`));
test("ECONNRESET in Kleinbuchstaben mit Exit 1 ist kein Netzabbruch", () => pruefeKeinNetzabbruch(ECONNRESET.toLowerCase()));
test("eine fertige Antwort mit Exit 1 ist kein Netzabbruch", () => pruefeKeinNetzabbruch("Fertig."));
test("eine leere Antwort mit Exit 1 ist kein Netzabbruch", () => pruefeKeinNetzabbruch(""));
test("eine fehlende Antwort mit Exit 1 ist kein Netzabbruch", () => pruefeKeinNetzabbruch(undefined));
