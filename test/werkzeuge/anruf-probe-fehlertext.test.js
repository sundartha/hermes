import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { TELNYX_MESSZEILE_SCHLUESSEL as TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer-stub-fehlertext.mjs", import.meta.url));
const ZIEL = "+12722205602";

function probeMit(fehlertext) {
  const env = {
    PATH: process.env.PATH,
    GITHUB_SHA: "d".repeat(40),
    STAGING_URL: "https://hermes-staging-erpv.onrender.com",
    STAGING_PROBE_ZIEL: ZIEL,
    STAGING_PROBE_TOKEN: TOKEN,
    STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
    STAGING_PROBE_VORNAME: "Anna",
    SLACK_ALERT_URL: "http://127.0.0.1:1/x",
    PROBE_ANRUFER_MODUL: MODUL,
    PROBE_FEHLERTEXT: fehlertext,
  };
  return new Promise((fertig) => {
    execFile("node", ["scripts/anruf-probe/probe.mjs"], { env }, (fehler, stdout, stderr) => {
      const zeilen = `${stdout}${stderr}`.split("\n").filter((zeile) => !zeile.startsWith("::add-mask::"));
      fertig({ code: fehler?.code ?? 0, zeilen });
    });
  });
}

const ROT = "Probe rot: messung grund=mcp_place_call_fehlgeschlagen:";

test("Probe rot bei unbekanntem place_call-Fehler: die Zeile nennt den Werkzeugtext als Auszug", async () => {
  const { code, zeilen } = await probeMit("Der Anruf ging schief");
  assert.equal(code, 1);
  assert.ok(zeilen.includes(`${ROT}unklar text="Der Anruf ging schief"`));
});

test("Auszug: Zeilenumbrüche werden Leerzeichen, Ziffernfolgen ab 4 Ziffern # und lange Wörter …", async () => {
  const lang = "x".repeat(20);
  const kurz = "y".repeat(19);
  const { zeilen } = await probeMit(`Fehler\nWert 491701234567 Code 123 ${lang} ${kurz} 1234\r\nEnde`);
  assert.ok(zeilen.includes(`${ROT}unklar text="Fehler Wert # Code 123 … ${kurz} # Ende"`));
});

test("Auszug: höchstens 120 Zeichen", async () => {
  const { zeilen } = await probeMit("ab ".repeat(100));
  assert.ok(zeilen.includes(`${ROT}unklar text="${"ab ".repeat(40)}"`));
});

test("Auszug: der Token erscheint nie, Anführungszeichen werden zu Apostrophen", async () => {
  const { zeilen } = await probeMit(`Bearer ${TOKEN} abgelehnt "so"`);
  assert.ok(zeilen.includes(`${ROT}unklar text="Bearer … abgelehnt 'so'"`));
  assert.equal(zeilen.some((zeile) => zeile.includes(TOKEN)), false);
});

test("Klasse bleibt im Grund, der Auszug kommt zusätzlich", async () => {
  const { zeilen } = await probeMit("Tageslimit erreicht");
  assert.ok(zeilen.includes(`${ROT}limit_erreicht text="Tageslimit erreicht"`));
});
