import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";

const ZEITGRENZE_MS = 60_000;
const KIND = fileURLToPath(new URL("./anruf-abbruch-kind.js", import.meta.url));

function imKindprozess(adresse) {
  const kind = spawn(process.execPath, [KIND], {
    env: { ...process.env, ABBRUCH_KIND_DATENBANK: adresse },
    stdio: ["ignore", "pipe", "inherit"],
    timeout: ZEITGRENZE_MS,
  });
  let aus = "";
  kind.stdout.on("data", (stueck) => {
    aus += stueck;
  });
  return new Promise((fertig) => kind.on("close", () => fertig(aus)));
}

function letzteZeile(text) {
  const zeilen = text.trim().split("\n");
  return zeilen[zeilen.length - 1];
}

test("ERÖFFNUNG-4: nach dem Abbruch eines ElevenLabs-Anrufs bleibt der Leitungsplatz bis zum Ablauf belegt und ist danach frei", async (t) => {
  const datenbank = await echteDatenbankMitRolle(t);
  if (!datenbank) return;
  const ergebnis = JSON.parse(letzteZeile(await imKindprozess(datenbank.adresse)));
  assert.equal(ergebnis.belegt, "frei");
  assert.equal(ergebnis.vorAbbruch, "kunde_voll");
  assert.equal(ergebnis.koerper.status, "cancelled");
  assert.equal(ergebnis.koerper.line_hangup_confirmed, false);
  assert.equal(ergebnis.bewacht, false);
  assert.equal(ergebnis.nachAbbruch, "kunde_voll");
  assert.equal(ergebnis.nachAblauf, "frei");
});
