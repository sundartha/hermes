import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  anfragenAn,
  attrappeStarten,
  COMMIT_C,
  COMMIT_P,
  DEPLOY_TOKEN,
  laufEreignis,
  RENDER_SCHLUESSEL,
  temporaerOrdner,
  umgebungFuer,
  weltAnlegen,
  werkzeugStarten,
} from "./deploy-weg-attrappe.mjs";

const EXIT_OK = 0;
const EXIT_ROT = 1;
const AUFRUF = /Aufruf: node tools\/deploy-weg\.mjs/;
const AUSLOESEN = /\/deploys$/;
const MASKE = "::add-mask::";
const DEPLOY_AUFRUF = ["deploy", "--commit", COMMIT_C, "--produktion", COMMIT_P];
const DEPLOY_ARGUMENTE = [...DEPLOY_AUFRUF, "--frisch-geweckt", "nein"];

function ohneMasken(text) {
  return text
    .split("\n")
    .filter((zeile) => !zeile.startsWith(MASKE))
    .join("\n");
}

test("CLI ohne Befehl meldet den Aufruf und endet mit Exit 1", async () => {
  const lauf = await werkzeugStarten([], {});
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.ausgabe, AUFRUF);
  assert.match(lauf.ausgabe, /Ergebnis: nein/);
});

test("CLI staging mit ungültigem Commit meldet den Aufruf", async () => {
  const lauf = await werkzeugStarten(["staging", "--commit", "master"], {});
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.ausgabe, AUFRUF);
});

test("CLI hoertest mit unzulässigem Teil-Namen meldet den Aufruf", async () => {
  const argumente = ["hoertest", "--commit", COMMIT_C, "--teile", "gut,+49 151 12345678"];
  const lauf = await werkzeugStarten(argumente, {});
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.ausgabe, AUFRUF);
  assert.ok(!lauf.ausgabe.includes("12345678"));
});

test("CLI deploy ohne Einstellungen nennt nur die Namen der fehlenden Einstellungen", async () => {
  const argumente = DEPLOY_ARGUMENTE;
  const lauf = await werkzeugStarten(argumente, {});
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.ausgabe, /Einstellung fehlt oder ist ungültig: RENDER_API_KEY/);
  assert.match(lauf.ausgabe, /Einstellung fehlt oder ist ungültig: HERMES_DEPLOY_TOKEN/);
  assert.match(lauf.ausgabe, /Abbruch im Schritt einstellungen/);
});

test("CLI deploy lehnt eine Render-Adresse außerhalb von Render und Loopback ab", async () => {
  const argumente = DEPLOY_ARGUMENTE;
  const umgebung = umgebungFuer("http://127.0.0.1:9", { RENDER_API_URL: "https://fremd.invalid/v1" });
  const lauf = await werkzeugStarten(argumente, umgebung);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.ausgabe, /Einstellung fehlt oder ist ungültig: RENDER_API_URL/);
});

test("CLI entscheiden rot: schreibt deploy=nein nach GITHUB_OUTPUT und endet mit Exit 1", async (kontext) => {
  const attrappe = await attrappeStarten(kontext, weltAnlegen());
  const ordner = temporaerOrdner(kontext);
  const ereignisDatei = join(ordner, "ereignis.json");
  const ausgabeDatei = join(ordner, "ausgaben");
  writeFileSync(ereignisDatei, JSON.stringify(laufEreignis({ conclusion: "failure" }).nutzlast));
  writeFileSync(ausgabeDatei, "");
  const umgebung = umgebungFuer(attrappe.basis, {
    GITHUB_EVENT_PATH: ereignisDatei,
    GITHUB_OUTPUT: ausgabeDatei,
  });
  const lauf = await werkzeugStarten(["entscheiden"], umgebung);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.ausgabe, /Rot: der Staging-Lauf ist nicht grün \(failure\)/);
  const zeilen = readFileSync(ausgabeDatei, "utf8").split("\n");
  assert.ok(zeilen.includes("deploy=nein"));
  assert.ok(zeilen.includes("hoertest=nein"));
  assert.ok(zeilen.includes("commit=" + COMMIT_C));
  assert.ok(zeilen.includes("frisch_geweckt=nein"));
});

test("CLI deploy grün: genau ein Deploy-POST, Exit 0, Schlüssel nur in add-mask-Zeilen", async (kontext) => {
  const welt = weltAnlegen({ produktion: [COMMIT_P, COMMIT_C], deployStatus: ["live"] });
  const attrappe = await attrappeStarten(kontext, welt);
  const argumente = DEPLOY_ARGUMENTE;
  const lauf = await werkzeugStarten(argumente, umgebungFuer(attrappe.basis));
  assert.equal(lauf.status, EXIT_OK, lauf.ausgabe);
  const posts = anfragenAn(attrappe, "POST", AUSLOESEN);
  assert.deepEqual(
    posts.map(({ koerper }) => koerper),
    [{ commitId: COMMIT_C }],
  );
  assert.match(lauf.ausgabe, /Ergebnis: ja/);
  assert.ok(lauf.ausgabe.includes(MASKE + RENDER_SCHLUESSEL));
  assert.ok(!ohneMasken(lauf.ausgabe).includes(RENDER_SCHLUESSEL));
  assert.ok(!ohneMasken(lauf.ausgabe).includes(DEPLOY_TOKEN));
  assert.ok(!ohneMasken(lauf.ausgabe).includes("127.0.0.1"));
});

test("CLI deploy rot: die Anruf-Abfrage scheitert mit 401, kein Deploy-POST", async (kontext) => {
  const attrappe = await attrappeStarten(kontext, weltAnlegen());
  const argumente = DEPLOY_ARGUMENTE;
  const umgebung = umgebungFuer(attrappe.basis, {
    HERMES_DEPLOY_TOKEN: "a".repeat(DEPLOY_TOKEN.length),
  });
  const lauf = await werkzeugStarten(argumente, umgebung);
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.ausgabe, /Abbruch im Schritt anrufe: HTTP 401/);
  assert.deepEqual(anfragenAn(attrappe, "POST", AUSLOESEN), []);
});

test("CLI deploy ohne --frisch-geweckt oder mit einem anderen Wert als ja/nein meldet den Aufruf", async (kontext) => {
  const attrappe = await attrappeStarten(kontext, weltAnlegen());
  for (const argumente of [DEPLOY_AUFRUF, [...DEPLOY_AUFRUF, "--frisch-geweckt", "true"]]) {
    const lauf = await werkzeugStarten(argumente, umgebungFuer(attrappe.basis));
    assert.equal(lauf.status, EXIT_ROT);
    assert.match(lauf.ausgabe, AUFRUF);
  }
  assert.deepEqual(attrappe.anfragen, []);
});
