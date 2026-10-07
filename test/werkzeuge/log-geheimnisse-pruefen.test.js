import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, outputLines, probeDirectory, runIn } from "./probe-repo.js";

const SCANNER = join(REPO_ROOT, "tools/log-geheimnisse-pruefen.mjs");
const TELNYX_DATEI = "src/telephony/adapters/telnyx/voice.js";
const ROUTEN_DATEI = "src/routes/voice.js";
const EXIT_SAUBER = 0;
const EXIT_FUND = 1;
const EXIT_FALSCHER_AUFRUF = 2;
const HARMLOSER_LOG = 'console.log("Anruf angenommen");\n';
const MINDESTZAHL_SYNTHETISCHER_FUNDE = 3;

const DREI_SYNTHETISCHE_LECKS = [
  "console.log(`bearer=${config.telnyxShimSharedSecret}`);",
  'console.warn("caller " + "+491700000000");',
  "console.error(req.headers.authorization);",
].join("\n");

const LECK_HINTER_ESCAPETEM_ZEICHEN = 'console.warn("bad\\")" + config.telnyxApiKey);\n';

function miniWurzel(context, telnyxQuelle) {
  return probeDirectory(context, { [TELNYX_DATEI]: telnyxQuelle, [ROUTEN_DATEI]: HARMLOSER_LOG });
}

function scanne(argumente) {
  return runIn(REPO_ROOT, process.execPath, [SCANNER, ...argumente]);
}

test("drei synthetische Lecks in einem Log-Aufruf werden je mit Datei und Zeile gemeldet", (context) => {
  const ergebnis = scanne(["--wurzel", miniWurzel(context, DREI_SYNTHETISCHE_LECKS)]);
  assert.equal(ergebnis.status, EXIT_FUND, ergebnis.stderr);
  const zeilen = outputLines(ergebnis.stdout);
  assert.ok(zeilen.length >= MINDESTZAHL_SYNTHETISCHER_FUNDE, ergebnis.stdout);
  for (const zeile of ["1", "2", "3"]) {
    const ort = `${TELNYX_DATEI}:${zeile} `;
    assert.ok(zeilen.some((befund) => befund.startsWith(ort)), `${ort} fehlt in ${ergebnis.stdout}`);
  }
});

test("ein Geheimnis hinter einem escapeten Anfuehrungszeichen im Log-Text wird trotzdem gemeldet", (context) => {
  const ergebnis = scanne(["--wurzel", miniWurzel(context, LECK_HINTER_ESCAPETEM_ZEICHEN)]);
  assert.equal(ergebnis.status, EXIT_FUND, ergebnis.stderr);
  const gemeldet = outputLines(ergebnis.stdout).some(
    (befund) =>
      befund.startsWith(`${TELNYX_DATEI}:1 `) && befund.includes(String(/config\.telnyxApiKey/)),
  );
  assert.ok(gemeldet, ergebnis.stdout);
});

test("eine Mini-Wurzel mit harmlosen Log-Aufrufen besteht ohne Meldung", (context) => {
  const ergebnis = scanne(["--wurzel", miniWurzel(context, HARMLOSER_LOG)]);
  assert.equal(ergebnis.status, EXIT_SAUBER, ergebnis.stdout);
  assert.equal(ergebnis.stdout, "");
});

test("eine gescannte Datei ganz ohne Log-Aufruf gilt als Drift und wird gemeldet", (context) => {
  const ergebnis = scanne(["--wurzel", miniWurzel(context, "export const leer = true;\n")]);
  assert.equal(ergebnis.status, EXIT_FUND, ergebnis.stderr);
  const ort = `${TELNYX_DATEI}:1 `;
  assert.ok(outputLines(ergebnis.stdout).some((befund) => befund.startsWith(ort)), ergebnis.stdout);
});

test("das echte Repo hat keine Log-Aufrufe mit Geheimnissen in den gescannten Dateien", () => {
  const ergebnis = scanne([]);
  assert.equal(ergebnis.status, EXIT_SAUBER, ergebnis.stdout + ergebnis.stderr);
});

test("eine unbekannte Option ist ein falscher Aufruf", () => {
  assert.equal(scanne(["--unbekannt"]).status, EXIT_FALSCHER_AUFRUF);
});

test("eine Wurzel, die es nicht gibt, ist ein falscher Aufruf", (context) => {
  const ordner = probeDirectory(context, {});
  assert.equal(scanne(["--wurzel", join(ordner, "gibt-es-nicht")]).status, EXIT_FALSCHER_AUFRUF);
});
