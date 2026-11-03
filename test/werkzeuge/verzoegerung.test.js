import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";

import {
  budgetDatei,
  budgetOrdner,
  EXIT_ROT,
  REPO,
  rueckfrageKartePruefen,
  TEST_FRIST,
} from "./karten-lauf-hilfen.js";

const CONSULT_BUDGET_UEBER_GEWOEHNLICHER_ANTWORT_MS = 800;
const SICHERHEITSABSTAND_DER_VERZOEGERUNG_MS = 200;
const VERZOEGERUNG_MS =
  CONSULT_BUDGET_UEBER_GEWOEHNLICHER_ANTWORT_MS + SICHERHEITSABSTAND_DER_VERZOEGERUNG_MS;
const EXIT_FEHLER = 1;
const HERMES_CTL = join(REPO, "tools", "hermes-ctl.mjs");
const GROSSZUEGIG_MS = 60000;
const LOOKUP_BUDGET_UNTER_VERZOEGERUNG_MS = 600;

const ordner = budgetOrdner("verzoegerung-test-");

function verzoegert(name, werte) {
  return rueckfrageKartePruefen(budgetDatei(ordner, name, werte), [
    "--verzoegern",
    `elevenlabs-consult=${VERZOEGERUNG_MS}`,
  ]);
}

test("Verzögerter Rückfrage-Webhook macht die Karte Rückfrage rot", TEST_FRIST, async () => {
  const lauf = await verzoegert("consult-knapp", {
    "elevenlabs-consult": CONSULT_BUDGET_UEBER_GEWOEHNLICHER_ANTWORT_MS,
    "elevenlabs-lookup": GROSSZUEGIG_MS,
  });
  assert.equal(lauf.exit, EXIT_ROT, lauf.ausgabe);
  const treffer = lauf.ausgabe.match(
    new RegExp(
      `elevenlabs-consult (\\d+) ms über dem Budget ${CONSULT_BUDGET_UEBER_GEWOEHNLICHER_ANTWORT_MS} ms`,
    ),
  );
  assert.notEqual(treffer, null, lauf.ausgabe);
  assert.ok(Number(treffer[1]) >= VERZOEGERUNG_MS, lauf.ausgabe);
});

test("Verzögerung trifft nur den genannten Webhook", TEST_FRIST, async () => {
  const lauf = await verzoegert("lookup-knapp", {
    "elevenlabs-consult": GROSSZUEGIG_MS,
    "elevenlabs-lookup": LOOKUP_BUDGET_UNTER_VERZOEGERUNG_MS,
  });
  assert.equal(lauf.exit, 0, lauf.ausgabe);
  assert.match(lauf.ausgabe, /Funktionskarte: sauber/);
});

function startMitVerzoegerung(angabe) {
  return new Promise((fertig) => {
    execFile(
      process.execPath,
      [HERMES_CTL, "start", "--sitzung", "verzoegerung-ungueltig", "--verzoegern", angabe],
      { cwd: REPO },
      (fehler, stdout) => fertig({ exit: fehler?.code ?? 0, ausgabe: JSON.parse(stdout) }),
    );
  });
}

test("Verzögerung für einen unbekannten Webhook bricht den Start ab", TEST_FRIST, async () => {
  const lauf = await startMitVerzoegerung("gibt-es-nicht=500");
  assert.equal(lauf.exit, EXIT_FEHLER);
  assert.equal(lauf.ausgabe.ok, false);
  assert.match(lauf.ausgabe.fehler, /Ungültige Verzögerung: gibt-es-nicht=500/);
});

test("Verzögerung ohne Millisekunden bricht den Start ab", TEST_FRIST, async () => {
  const lauf = await startMitVerzoegerung("elevenlabs-consult");
  assert.equal(lauf.exit, EXIT_FEHLER);
  assert.equal(lauf.ausgabe.ok, false);
  assert.match(lauf.ausgabe.fehler, /Ungültige Verzögerung: elevenlabs-consult/);
});
