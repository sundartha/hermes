import assert from "node:assert/strict";
import { test } from "node:test";

import { planeUebernahme } from "../../tools/uebernahme/baum.mjs";
import {
  DATEI_A,
  DATEI_B,
  JETZT,
  KENNUNG,
  REPOSITORY,
  erzeugerLauf,
  laufListe,
  pullRequestRoute,
  schein,
  vereint,
  zweiBaeume,
} from "./uebernahme-hilfen.js";

const CI_TEIL = { jobName: "Tests", berichtDatei: "dateien.jsonl" };
const PRUEFLEITER_TEIL = {
  jobName: "Prüfleiter Werkzeugtests",
  berichtDatei: "werkzeugteil-1.jsonl",
  artefakt: "werkzeugteil-1",
};
const FUENFUNDZWANZIG_STUNDEN_MS = 90_000_000;
const WARTESCHLANGEN_REF = "refs/heads/gh-readonly-queue/master/pr-5-abcdef1";
const KEIN_LAUF = /kein Lauf mit gleichem Baum/;

function ciTeile(aenderung = {}) {
  return [
    { ...CI_TEIL, artefakt: "testlaufzeit-teil-1", dateien: [[DATEI_A, true]], ...aenderung },
    { ...CI_TEIL, artefakt: "testlaufzeit-teil-2", dateien: [[DATEI_B, true]] },
  ];
}

function verbraucher(repo, github, felder) {
  return {
    art: "ci",
    teil: 1,
    dateien: [DATEI_A, DATEI_B],
    baum: repo.kopf.baum,
    kennung: KENNUNG,
    github,
    repo: REPOSITORY,
    jetzt: JETZT,
    wurzel: repo.ordner,
    ...felder,
  };
}

async function planNachPush(context, { lauf, teile = ciTeile(), kopf, dateien }) {
  const repo = zweiBaeume(context);
  const erzeuger = erzeugerLauf({
    id: 11,
    workflow: "ci.yml",
    ereignis: "merge_group",
    kopf: kopf?.(repo) ?? repo.kopf,
    teile,
    lauf,
  });
  const routen = vereint(erzeuger.routen, laufListe("ci.yml", [erzeuger.lauf]));
  const { github } = await schein(context, routen);
  const felder = { ereignis: "push", ref: "refs/heads/master", ...(dateien && { dateien }) };
  return planeUebernahme(verbraucher(repo, github, felder));
}

test("ein grüner Lauf der Warteschlange mit gleichem Baum macht jede Datei des Teils übernehmbar", async (context) => {
  const plan = await planNachPush(context, {});
  assert.equal(plan.teilUebernehmbar, true);
  assert.deepEqual(
    plan.dateien.map(({ datei, uebernehmbar, erwartet }) => [datei, uebernehmbar, erwartet.bestanden]),
    [
      [DATEI_A, true, true],
      [DATEI_B, true, true],
    ],
  );
  assert.deepEqual(
    plan.erzeuger.map(({ lauf }) => lauf),
    [11],
  );
});

const VERWEIGERUNGEN = [
  ["ein Lauf aus einem Fork", { lauf: { head_repository: { full_name: "fremd/hermes" } } }, KEIN_LAUF],
  [
    "ein Lauf, der älter als 24 Stunden ist",
    { lauf: { created_at: new Date(JETZT - FUENFUNDZWANZIG_STUNDEN_MS).toISOString() } },
    KEIN_LAUF,
  ],
  ["ein Lauf eines anderen Ereignisses", { lauf: { event: "push" } }, KEIN_LAUF],
  ["ein anderer Baum", { kopf: (repo) => repo.anderer }, KEIN_LAUF],
  ["ein roter Teiljob des Erzeugers", { teile: ciTeile({ conclusion: "failure" }) }, /endete mit failure/],
  ["wackelige Tests im Erzeuger", { teile: ciTeile({ festhaltung: { wackelig: 1 } }) }, /wackelige Tests/],
  [
    "ein anderer Baum im Protokoll des Erzeugers",
    { teile: ciTeile({ festhaltung: { baum: "1".repeat(40) } }) },
    /anderen geprüften Baum/,
  ],
  [
    "eine andere Node-Version",
    { teile: ciTeile({ festhaltung: { kennung: { ...KENNUNG, node: "v20.0.0" } } }) },
    /anderen Node-Version/,
  ],
  [
    "ein anderes Runner-Image",
    { teile: ciTeile({ festhaltung: { kennung: { ...KENNUNG, image: "ubuntu24-20260101.1" } } }) },
    /anderen Runner-Image/,
  ],
  ["eine fehlende Prüfsumme im Protokoll", { teile: ciTeile({ ohneFesthaltung: true }) }, /nicht genau einmal/],
  ["ein verändertes Artefakt", { teile: ciTeile({ manipuliert: true }) }, /Prüfsumme/],
  [
    "eine Datei, die im Erzeuger nicht bestanden hat",
    { teile: ciTeile({ dateien: [[DATEI_A, false]] }) },
    /nicht bestanden/,
  ],
];

for (const [name, aenderung, grund] of VERWEIGERUNGEN) {
  test(`nichts wird übernommen bei: ${name}`, async (context) => {
    const plan = await planNachPush(context, aenderung);
    assert.equal(plan.teilUebernehmbar, false);
    const gruende = [...plan.dateien, ...plan.erzeuger].map((eintrag) => eintrag.grund ?? "");
    assert.ok(
      gruende.some((text) => grund.test(text)),
      gruende.join(" | "),
    );
  });
}

test("eine Datei des Teils ohne Ergebnis im Erzeuger macht den ganzen Teil nicht übernehmbar", async (context) => {
  const plan = await planNachPush(context, { dateien: [DATEI_A, DATEI_B, "test/neu.test.js"] });
  assert.equal(plan.teilUebernehmbar, false);
  assert.deepEqual(
    plan.dateien.map(({ datei, uebernehmbar }) => [datei, uebernehmbar]),
    [
      [DATEI_A, true],
      [DATEI_B, true],
      ["test/neu.test.js", false],
    ],
  );
});

async function planInDerWarteschlange(context, { pullRequest = 5, pruefleiterKopf }) {
  const repo = zweiBaeume(context);
  const beteiligt = { pull_requests: [{ number: pullRequest }] };
  const ci = erzeugerLauf({
    id: 21,
    workflow: "ci.yml",
    ereignis: "pull_request",
    kopf: repo.kopf,
    teile: [{ ...CI_TEIL, artefakt: "testlaufzeit-teil-1", dateien: [[DATEI_A, true]] }],
    lauf: beteiligt,
  });
  const werkzeuge = erzeugerLauf({
    id: 22,
    workflow: "pruefleiter.yml",
    ereignis: "pull_request",
    kopf: pruefleiterKopf?.(repo) ?? repo.kopf,
    teile: [{ ...PRUEFLEITER_TEIL, dateien: [[DATEI_B, true]] }],
    lauf: beteiligt,
  });
  const routen = vereint(
    ci.routen,
    werkzeuge.routen,
    laufListe("ci.yml", [ci.lauf]),
    laufListe("pruefleiter.yml", [werkzeuge.lauf]),
    pullRequestRoute(),
  );
  const { github } = await schein(context, routen);
  return planeUebernahme(verbraucher(repo, github, { ereignis: "merge_group", ref: WARTESCHLANGEN_REF }));
}

test("in der Warteschlange kommen die Dateien aus dem PR-Lauf der CI und die Werkzeugtests aus dem des Prüfleiters", async (context) => {
  const plan = await planInDerWarteschlange(context, {});
  assert.equal(plan.teilUebernehmbar, true);
  assert.deepEqual(
    plan.dateien.map(({ datei, quelle }) => [datei, quelle]),
    [
      [DATEI_A, 21],
      [DATEI_B, 22],
    ],
  );
});

test("der Lauf eines anderen PR liefert in der Warteschlange nichts", async (context) => {
  const plan = await planInDerWarteschlange(context, { pullRequest: 9 });
  assert.equal(plan.teilUebernehmbar, false);
  assert.deepEqual(
    plan.dateien.map(({ uebernehmbar }) => uebernehmbar),
    [false, false],
  );
});

test("ein Prüfleiter-Lauf mit anderem Baum macht nur die Werkzeugtests unübernehmbar", async (context) => {
  const plan = await planInDerWarteschlange(context, { pruefleiterKopf: (repo) => repo.anderer });
  assert.equal(plan.teilUebernehmbar, false);
  assert.deepEqual(
    plan.dateien.map(({ datei, uebernehmbar }) => [datei, uebernehmbar]),
    [
      [DATEI_A, true],
      [DATEI_B, false],
    ],
  );
});
