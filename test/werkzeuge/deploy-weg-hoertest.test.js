import assert from "node:assert/strict";
import { test } from "node:test";

import { HOERTEST_TITEL, hoertestIssueAnlegenOderErsetzen } from "../../tools/deploy-weg/hoertest.mjs";
import {
  anfragenAn,
  attrappeStarten,
  COMMIT_C,
  einstellungenFuer,
  HTTP_OK,
  REPO,
  sammler,
  weltAnlegen,
} from "./deploy-weg-attrappe.mjs";

const TEILE = ["anrufstart.de.eigentuemer", "stimmen"];
const VORHANDENES_ISSUE = 12;
const NEUERES_ISSUE = 20;
const ERSTE_FREMDE_NUMMER = 1000;
const MENSCHEN_ISSUE = 5;
const NEUES_ISSUE = 99;
const HTTP_FEHLER = 500;
const BOT = "github-actions[bot]";
const SEITE = 100;

async function rahmenFuer(kontext, welt = {}, teile = TEILE) {
  const attrappe = await attrappeStarten(kontext, weltAnlegen(welt));
  const einstellungen = einstellungenFuer("hoertest", attrappe.basis);
  const { zeilen, ausgabe } = sammler();
  return { attrappe, zeilen, rahmen: { einstellungen, commit: COMMIT_C, teile, ausgabe } };
}

async function hoertestMit(kontext, welt = {}, teile = TEILE) {
  const { attrappe, zeilen, rahmen } = await rahmenFuer(kontext, welt, teile);
  await hoertestIssueAnlegenOderErsetzen(rahmen);
  return { text: zeilen.join("\n"), attrappe };
}

async function hoertestScheitertMit(kontext, welt) {
  const { attrappe, zeilen, rahmen } = await rahmenFuer(kontext, welt);
  await assert.rejects(hoertestIssueAnlegenOderErsetzen(rahmen), { name: "Abbruch", schritt: "issue_schreiben" });
  return { text: zeilen.join("\n"), attrappe };
}

function volleSeite() {
  return Array.from({ length: SEITE }, (_leer, index) => ({
    number: ERSTE_FREMDE_NUMMER + index,
    title: "Wochenbericht KW " + index,
    user: { login: BOT },
  }));
}

function seitenNummer(pfad) {
  return Number(new URLSearchParams(pfad.split("?")[1]).get("page") ?? "1");
}

async function mitSeiten(kontext, seiten) {
  const attrappe = await attrappeStarten(kontext, weltAnlegen());
  const letzte = () => attrappe.anfragen.at(-1);
  const aktuell = () => seiten[seitenNummer(letzte().pfad) - 1] ?? [HTTP_OK, []];
  Object.defineProperties(attrappe.welt, {
    issuesStatus: { get: () => aktuell()[0] },
    issues: { get: () => aktuell()[1] },
  });
  const einstellungen = einstellungenFuer("hoertest", attrappe.basis);
  const rahmen = { einstellungen, commit: COMMIT_C, teile: TEILE, ausgabe: sammler().ausgabe };
  return { attrappe, rahmen };
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
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", /\/issues$/), []);
  const aenderungen = anfragenAn(lauf.attrappe, "PATCH", /\/issues\//);
  assert.deepEqual(
    aenderungen.map(({ pfad, koerper }) => [pfad, Object.keys(koerper)]),
    [["/gh/repos/" + REPO + "/issues/" + VORHANDENES_ISSUE, ["body"]]],
  );
  assert.equal(aenderungen[0].koerper.body, erwarteterText(lauf.attrappe.basis));
  assert.match(lauf.text, /Hörtest-Issue #12: Text ersetzt/);
});

test("Hörtest-Issue: meldet der Abgleich keine Teile, nennt der Text das statt einer leeren Liste", async (kontext) => {
  const lauf = await hoertestMit(kontext, {}, []);
  const [anlage] = anfragenAn(lauf.attrappe, "POST", /\/issues$/);
  assert.match(anlage.koerper.body, /^Geänderte Teile des Gesprächsabdrucks:\n- \(der Abgleich hat keine Namen gemeldet\)\n\n/m);
  assert.doesNotMatch(anlage.koerper.body, /^- anrufstart/m);
});

test("Hörtest-Issue: scheitert das Ersetzen mit 500, bricht der Lauf ab und legt kein zweites an", async (kontext) => {
  const issue = { number: VORHANDENES_ISSUE, title: HOERTEST_TITEL, user: { login: BOT } };
  const lauf = await hoertestScheitertMit(kontext, { issues: [issue], issueErsetzenStatus: HTTP_FEHLER });
  assert.equal(anfragenAn(lauf.attrappe, "PATCH", /\/issues\//).length, 1);
  assert.deepEqual(anfragenAn(lauf.attrappe, "POST", /\/issues$/), []);
  assert.doesNotMatch(lauf.text, /Text ersetzt/);
});

test("Hörtest-Issue: antwortet das Anlegen ohne Issue-Nummer, bricht der Lauf ab und meldet nichts als angelegt", async (kontext) => {
  const lauf = await hoertestScheitertMit(kontext, { issueAnlage: {} });
  assert.equal(anfragenAn(lauf.attrappe, "POST", /\/issues$/).length, 1);
  assert.doesNotMatch(lauf.text, /angelegt/);
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
  await assert.rejects(hoertestIssueAnlegenOderErsetzen(rahmen), { name: "Abbruch", schritt: "issue_suche" });
  assert.deepEqual(anfragenAn(attrappe, "POST", /\/issues$/), []);
});

test("Hörtest-Issue: liegt das offene Issue des Bots auf Seite 2, wird es ersetzt statt ein zweites anzulegen", async (kontext) => {
  const issue = { number: VORHANDENES_ISSUE, title: HOERTEST_TITEL, user: { login: BOT } };
  const { attrappe, rahmen } = await mitSeiten(kontext, [
    [HTTP_OK, volleSeite()],
    [HTTP_OK, [issue]],
  ]);
  await hoertestIssueAnlegenOderErsetzen(rahmen);
  assert.deepEqual(anfragenAn(attrappe, "POST", /\/issues$/), []);
  const aenderungen = anfragenAn(attrappe, "PATCH", /\/issues\//);
  assert.deepEqual(
    aenderungen.map(({ pfad }) => pfad),
    ["/gh/repos/" + REPO + "/issues/" + VORHANDENES_ISSUE],
  );
});

test("Hörtest-Issue: ist Seite 2 nicht lesbar, wird abgebrochen und nichts geschrieben", async (kontext) => {
  const unlesbar = [
    [HTTP_FEHLER, []],
    [HTTP_OK, {}],
  ];
  for (const seiteZwei of unlesbar) {
    const { attrappe, rahmen } = await mitSeiten(kontext, [[HTTP_OK, volleSeite()], seiteZwei]);
    await assert.rejects(hoertestIssueAnlegenOderErsetzen(rahmen), { name: "Abbruch", schritt: "issue_suche" });
    assert.deepEqual(anfragenAn(attrappe, "POST", /\/issues$/), []);
    assert.deepEqual(anfragenAn(attrappe, "PATCH", /\/issues\//), []);
  }
});

test("Hörtest-Issue: ist es auf keiner Seite, wird nach dem Lesen aller Seiten eines angelegt", async (kontext) => {
  const { attrappe, rahmen } = await mitSeiten(kontext, [
    [HTTP_OK, volleSeite()],
    [HTTP_OK, []],
  ]);
  await hoertestIssueAnlegenOderErsetzen(rahmen);
  const gelesen = anfragenAn(attrappe, "GET", /\/issues\?/);
  assert.deepEqual(gelesen.map(({ pfad }) => seitenNummer(pfad)), [1, 2]);
  assert.equal(anfragenAn(attrappe, "POST", /\/issues$/).length, 1);
});

test("Hörtest-Issue: stehen mehrere Issues des Bots auf verschiedenen Seiten, wird das mit der kleinsten Nummer ersetzt", async (kontext) => {
  const neueres = { number: NEUERES_ISSUE, title: HOERTEST_TITEL, user: { login: BOT } };
  const aelteres = { number: VORHANDENES_ISSUE, title: HOERTEST_TITEL, user: { login: BOT } };
  const { attrappe, rahmen } = await mitSeiten(kontext, [
    [HTTP_OK, [neueres, ...volleSeite().slice(1)]],
    [HTTP_OK, [aelteres]],
  ]);
  await hoertestIssueAnlegenOderErsetzen(rahmen);
  const aenderungen = anfragenAn(attrappe, "PATCH", /\/issues\//);
  assert.deepEqual(
    aenderungen.map(({ pfad }) => pfad),
    ["/gh/repos/" + REPO + "/issues/" + VORHANDENES_ISSUE],
  );
  assert.deepEqual(anfragenAn(attrappe, "POST", /\/issues$/), []);
});
