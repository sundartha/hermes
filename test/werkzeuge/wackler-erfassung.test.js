import assert from "node:assert/strict";
import { test } from "node:test";

import { wacklerAuswerten, wacklerErfassen } from "../../tools/testschutz.mjs";

const LAUF_LINK = "https://github.com/sundartha/hermes/actions/runs/900/attempts/2";
const ALTER_LINK = "https://github.com/sundartha/hermes/actions/runs/900/attempts/1";

const LOG = [
  "2026-11-20T10:00:00.1234567Z # Subtest: /home/runner/work/hermes/hermes/test/anmeldung/sitzung.test.js",
  "2026-11-20T10:00:00.1234567Z     ok 1 - laeuft",
  "2026-11-20T10:00:00.1234567Z     not ok 2 - Sitzung verfaellt nach Ablauf",
  "2026-11-20T10:00:00.1234567Z       ---",
  "2026-11-20T10:00:00.1234567Z not ok 1 - /home/runner/work/hermes/hermes/test/anmeldung/sitzung.test.js",
].join("\n");

const TITEL = "Wackelig: test/anmeldung/sitzung.test.js › Sitzung verfaellt nach Ablauf";

function versuch(jobs, nummer = 1) {
  return { versuch: nummer, laufLink: ALTER_LINK, jobs };
}

function auswerten(eingabe) {
  return wacklerAuswerten({ versuche: [], logs: {}, offeneIssues: [], laufLink: LAUF_LINK, ...eingabe });
}

const ROTER_JOB = { id: 11, name: "Tests 3/12", conclusion: "failure" };

test("Roter Vorversuch mit lesbarem Testnamen ergibt ein Anlegen mit Titel, Label und Lauf-Link", () => {
  const ergebnis = auswerten({ versuche: [versuch([ROTER_JOB])], logs: { 11: LOG } });
  assert.equal(ergebnis.length, 1);
  assert.equal(ergebnis[0].anlegen.title, TITEL);
  assert.deepEqual(ergebnis[0].anlegen.labels, ["wackelig"]);
  assert.match(ergebnis[0].anlegen.body, /Neulauf-Wackler Nr\. 1: https:\/\/github\.com\/sundartha\/hermes\/actions\/runs\/900\/attempts\/2/);
});

test("Mehrere rote Versuche mit demselben Test ergeben nur ein Anlegen", () => {
  const ergebnis = auswerten({ versuche: [versuch([ROTER_JOB], 1), versuch([{ ...ROTER_JOB, id: 12 }], 2)], logs: { 11: LOG, 12: LOG } });
  assert.equal(ergebnis.length, 1);
});

test("Ein offenes Issue mit gleichem Titel wird kommentiert und hochgezaehlt statt neu angelegt", () => {
  const ergebnis = auswerten({
    versuche: [versuch([ROTER_JOB])],
    logs: { 11: LOG },
    offeneIssues: [{ number: 42, title: TITEL, laeufe: 3 }, { number: 43, title: "Wackelig: anderes", laeufe: 9 }],
  });
  assert.equal(ergebnis.length, 1);
  assert.equal(ergebnis[0].anlegen, undefined);
  assert.equal(ergebnis[0].kommentieren.nummer, 42);
  assert.equal(ergebnis[0].kommentieren.body, `Neulauf-Wackler Nr. 5: ${LAUF_LINK}`);
});

const KEINE_AKTION = [
  ["kein frueherer Versuch", []],
  ["Vorversuch ohne roten Job", [versuch([{ id: 11, name: "Tests 3/12", conclusion: "success" }])]],
  ["Vorversuch abgebrochen", [versuch([{ id: 11, name: "Tests 3/12", conclusion: "cancelled" }])]],
  ["nur der Sammel-Job CI war rot", [versuch([{ id: 11, name: "CI", conclusion: "failure" }])]],
];

for (const [name, versuche] of KEINE_AKTION) {
  test(`Keine Aktion bei ${name}`, () => {
    assert.deepEqual(auswerten({ versuche, logs: { 11: LOG } }), []);
  });
}

test("Ohne lesbaren Testnamen steht der Jobname im Titel", () => {
  const ergebnis = auswerten({ versuche: [versuch([{ id: 11, name: "Prüfungen", conclusion: "failure" }])], logs: { 11: "Fehler ohne TAP\n" } });
  assert.equal(ergebnis[0].anlegen.title, "Wackelig: Prüfungen");
});

test("Zwei rote Tests desselben Jobs ergeben zwei Eintraege", () => {
  const log = `${LOG}\n2026-11-20T10:00:00.1234567Z     not ok 3 - zweiter Test # Fehler`;
  const ergebnis = auswerten({ versuche: [versuch([ROTER_JOB])], logs: { 11: log } });
  assert.deepEqual(ergebnis.map(({ anlegen }) => anlegen.title), [TITEL, "Wackelig: test/anmeldung/sitzung.test.js › zweiter Test"]);
});

function fakeGithub({ offene = [], kommentare = {} } = {}) {
  const gesendet = [];
  return {
    gesendet,
    lesen: async (pfad) => {
      assert.match(pfad, /^\/actions\/runs\/900\/attempts\/1\/jobs\?per_page=100$/);
      return { jobs: [ROTER_JOB, { id: 12, name: "Web-Tests", conclusion: "success" }, { id: 13, name: "CI", conclusion: "failure" }] };
    },
    alleSeiten: async (pfad) => {
      if (pfad === "/issues?state=open&labels=wackelig") return offene;
      return kommentare[pfad] ?? [];
    },
    log: async (id) => {
      assert.equal(id, 11);
      return LOG;
    },
    senden: async (pfad, methode, koerper) => {
      gesendet.push({ pfad, methode, koerper });
      return {};
    },
  };
}

const UMGEBUNG = { GITHUB_RUN_ID: "900", GITHUB_RUN_ATTEMPT: "2", GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "sundartha/hermes" };

test("Simulierter Neulauf-Wackler legt ueber die API genau ein Issue an", async () => {
  const github = fakeGithub();
  await wacklerErfassen(github, UMGEBUNG);
  assert.equal(github.gesendet.length, 1);
  const [anfrage] = github.gesendet;
  const { title, labels, body } = anfrage.koerper;
  assert.equal(anfrage.pfad, "/issues");
  assert.equal(anfrage.methode, "POST");
  assert.equal(title, TITEL);
  assert.deepEqual(labels, ["wackelig"]);
  assert.match(body, new RegExp(LAUF_LINK));
});

test("Simulierter zweiter Neulauf-Wackler kommentiert das offene Issue mit hochgezaehltem Zaehler", async () => {
  const kommentare = { "/issues/42/comments": [{ body: "Neulauf-Wackler Nr. 2: x" }, { body: "Kommentar von Hand" }] };
  const github = fakeGithub({ offene: [{ number: 42, title: TITEL }], kommentare });
  await wacklerErfassen(github, UMGEBUNG);
  assert.equal(github.gesendet.length, 1);
  const [anfrage] = github.gesendet;
  assert.equal(anfrage.pfad, "/issues/42/comments");
  assert.equal(anfrage.methode, "POST");
  assert.equal(anfrage.koerper.body, `Neulauf-Wackler Nr. 3: ${LAUF_LINK}`);
});

test("Bei Versuch 3 werden Versuch 1 und 2 gelesen", async () => {
  const gelesen = [];
  const github = fakeGithub();
  github.lesen = async (pfad) => {
    gelesen.push(pfad);
    return { jobs: [] };
  };
  await wacklerErfassen(github, { ...UMGEBUNG, GITHUB_RUN_ATTEMPT: "3" });
  assert.deepEqual(gelesen, ["/actions/runs/900/attempts/1/jobs?per_page=100", "/actions/runs/900/attempts/2/jobs?per_page=100"]);
});

test("Zeilenende CRLF und Web-Testdatei werden gelesen", () => {
  const log = "2026-11-20T10:00:00.1Z # Subtest: /w/hermes/apps/web/test/seite.test.js\r\n2026-11-20T10:00:00.1Z     not ok 1 - rendert\r\n";
  const ergebnis = auswerten({ versuche: [versuch([ROTER_JOB])], logs: { 11: log } });
  assert.equal(ergebnis[0].anlegen.title, "Wackelig: apps/web/test/seite.test.js › rendert");
});

test("Roter Test ohne vorherige Testdatei steht mit Jobname im Titel", () => {
  const log = "2026-11-20T10:00:00.1Z     not ok 1 - rendert\n";
  const ergebnis = auswerten({ versuche: [versuch([ROTER_JOB])], logs: { 11: log } });
  assert.equal(ergebnis[0].anlegen.title, "Wackelig: Tests 3/12 › rendert");
});

test("Beim ersten Versuch wird nichts gelesen und nichts gesendet", async () => {
  const github = fakeGithub();
  github.lesen = async () => assert.fail("kein Lesen");
  await wacklerErfassen(github, { ...UMGEBUNG, GITHUB_RUN_ATTEMPT: "1" });
  assert.equal(github.gesendet.length, 0);
});

const SPEC_LOG = [
  "2026-11-20T10:00:00.1234567Z   ✔ laeuft (1.2ms)",
  "2026-11-20T10:00:00.1234567Z   ✗ Sitzung verfaellt (nach Ablauf) (/home/runner/work/hermes/hermes/test/anmeldung/sitzung.test.js:336:1)",
  "2026-11-20T10:00:00.1234567Z   ✗ rendert (/home/runner/work/hermes/hermes/apps/web/test/seite.test.js:12:5)",
].join("\n");

test("Spec-Zeile mit Zeitstempel ergibt Titel mit Testdatei ab test/ und Testname", () => {
  const ergebnis = auswerten({ versuche: [versuch([ROTER_JOB])], logs: { 11: SPEC_LOG } });
  assert.deepEqual(ergebnis.map(({ anlegen }) => anlegen.title), [
    "Wackelig: test/anmeldung/sitzung.test.js › Sitzung verfaellt (nach Ablauf)",
    "Wackelig: apps/web/test/seite.test.js › rendert",
  ]);
});

test("Derselbe Test in zwei Shards ergibt genau ein Anlegen", () => {
  const zweiter = { id: 12, name: "Tests 4/12", conclusion: "failure" };
  const ergebnis = auswerten({ versuche: [versuch([ROTER_JOB, zweiter])], logs: { 11: SPEC_LOG, 12: SPEC_LOG } });
  assert.equal(ergebnis.length, 2);
});

test("Offenes Issue zum Spec-Titel wird hochgezaehlt", () => {
  const titel = "Wackelig: apps/web/test/seite.test.js › rendert";
  const ergebnis = auswerten({ versuche: [versuch([ROTER_JOB])], logs: { 11: SPEC_LOG }, offeneIssues: [{ number: 7, title: titel, laeufe: 1 }] });
  assert.deepEqual(ergebnis[1], { kommentieren: { nummer: 7, body: `Neulauf-Wackler Nr. 3: ${LAUF_LINK}` } });
});

test("Basis-rot-Zeile im Mutationsjob ergibt Titel mit Mutation und keinen Jobnamen", () => {
  const log = "2026-11-20T10:00:00.1Z Basis rot: test/anmeldung/sitzung.test.js war bei 14/14 zweimal ohne Mutant rot und ist fuer den Rest des Jobs ausgeschlossen\n";
  const ergebnis = auswerten({ versuche: [versuch([{ id: 14, name: "Mutation 14/14", conclusion: "failure" }])], logs: { 14: log } });
  assert.deepEqual(ergebnis.map(({ anlegen }) => anlegen.title), ["Wackelig: test/anmeldung/sitzung.test.js (Mutation)"]);
});
