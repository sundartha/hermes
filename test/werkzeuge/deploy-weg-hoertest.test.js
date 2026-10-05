import assert from "node:assert/strict";
import { test } from "node:test";

import { HOERTEST_TITEL, hoertest } from "../../tools/deploy-weg/hoertest.mjs";
import {
  anfragenAn,
  attrappeStarten,
  COMMIT_C,
  einstellungenFuer,
  REPO,
  sammler,
  weltAnlegen,
} from "./deploy-weg-attrappe.mjs";

const TEILE = ["anrufstart.de.eigentuemer", "stimmen"];
const VORHANDENES_ISSUE = 12;
const MENSCHEN_ISSUE = 5;
const NEUES_ISSUE = 99;
const HTTP_FEHLER = 500;
const BOT = "github-actions[bot]";

async function hoertestMit(kontext, welt = {}) {
  const attrappe = await attrappeStarten(kontext, weltAnlegen(welt));
  const einstellungen = einstellungenFuer("hoertest", attrappe.basis);
  const { zeilen, ausgabe } = sammler();
  const ok = await hoertest({ einstellungen, commit: COMMIT_C, teile: TEILE, ausgabe });
  return { ok, text: zeilen.join("\n"), attrappe };
}

function erwarteterText(basis) {
  return [
    "Der Commit " + COMMIT_C + " ändert das Gespräch. Vor dem Live-Deploy ist ein Hörtest nötig.",
    "",
    "Geänderte Teile des Gesprächsabdrucks:",
    "- anrufstart.de.eigentuemer",
    "- stimmen",
    "",
    "Lauf: " + basis + "/server/" + REPO + "/actions/runs/4711",
    "",
    "Nach dem Hörtest startet Antonio20045 oder jonas986 den Workflow „live“ von Hand:",
    "Actions → live → Run workflow, Branch master, Eingabe commit = " + COMMIT_C + ".",
    "Der Hand-Start gilt als bestätigter Hörtest; alle anderen Prüfungen laufen trotzdem.",
    "",
  ].join("\n");
}

test("Hörtest-Issue wird angelegt, wenn keins offen ist, mit festem Titel und nur Commit, Teil-Namen, Lauf-Link und Anleitung", async (kontext) => {
  const lauf = await hoertestMit(kontext);
  assert.equal(lauf.ok, true);
  const [anlage, ...mehr] = anfragenAn(lauf.attrappe, "POST", /\/issues$/);
  assert.deepEqual(mehr, []);
  assert.deepEqual(anlage.koerper, { title: HOERTEST_TITEL, body: erwarteterText(lauf.attrappe.basis) });
  assert.deepEqual(anfragenAn(lauf.attrappe, "PATCH", /\/issues\//), []);
  assert.match(lauf.text, /Hörtest-Issue #99 angelegt/);
  assert.equal(NEUES_ISSUE, Number(/#(\d+)/.exec(lauf.text)[1]));
});

test("Hörtest-Issue: ein offenes Issue des Bots wird ersetzt statt ein zweites anzulegen", async (kontext) => {
  const issue = { number: VORHANDENES_ISSUE, title: HOERTEST_TITEL, user: { login: BOT } };
  const lauf = await hoertestMit(kontext, { issues: [issue] });
  assert.equal(lauf.ok, true);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", /\/issues$/), []);
  const aenderungen = anfragenAn(lauf.attrappe, "PATCH", /\/issues\//);
  assert.deepEqual(
    aenderungen.map(({ pfad, koerper }) => [pfad, Object.keys(koerper)]),
    [["/gh/repos/" + REPO + "/issues/" + VORHANDENES_ISSUE, ["body"]]],
  );
  assert.equal(aenderungen[0].koerper.body, erwarteterText(lauf.attrappe.basis));
  assert.match(lauf.text, /Hörtest-Issue #12: Text ersetzt/);
});

test("Hörtest-Issue: ein Issue eines Menschen mit demselben Titel wird nicht angefasst", async (kontext) => {
  const issue = { number: MENSCHEN_ISSUE, title: HOERTEST_TITEL, user: { login: "Antonio20045" } };
  const lauf = await hoertestMit(kontext, { issues: [issue] });
  assert.deepEqual(anfragenAn(lauf.attrappe, "PATCH", /\/issues\//), []);
  assert.equal(anfragenAn(lauf.attrappe, "POST", /\/issues$/).length, 1);
});

test("Hörtest-Issue: scheitert die Suche, wird nichts geschrieben", async (kontext) => {
  const attrappe = await attrappeStarten(kontext, weltAnlegen({ issuesStatus: HTTP_FEHLER }));
  const einstellungen = einstellungenFuer("hoertest", attrappe.basis);
  const rahmen = { einstellungen, commit: COMMIT_C, teile: TEILE, ausgabe: sammler().ausgabe };
  await assert.rejects(hoertest(rahmen), { name: "Abbruch", schritt: "issue_suche" });
  assert.deepEqual(anfragenAn(attrappe, "POST", /\/issues$/), []);
});
