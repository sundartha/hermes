import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { entscheiden } from "../../tools/auftrag/pruefer-befehle.mjs";
import { issueText, legeIssuesAn } from "../../tools/auftrag/pruefer-issues.mjs";
import { urteile } from "../../tools/auftrag/pruefer-urteil.mjs";
import { isolatedEnvironment, probeDirectory } from "./probe-repo.js";
import {
  ciLauf,
  ereignisDatei,
  prueferLauf,
  scheinGithub as scheinServer,
  scheinSha,
  setzeAusloeser,
  starteEinstieg,
  workflowAbfrage,
} from "./pruefer/hilfen.mjs";

const HEAD = scheinSha("d");
const TITEL = "Prüfer: N7 in src/zahl.js";
const PRIVAT = "sundartha/hermes-sicherheit";
const ABLAGE_TITEL = "Sicherheit: Prüfer: SG-12 in `src/zahl.js`, Zeile 1";
const TITEL_MIT_SPAN = "Prüfer: N7 in `src/zahl.js`, Zeile 1";
const GUELTIGE_PR = 1133;
const TITELLIMIT = 200;

function mitStatus(offen, geschlossen) {
  return [...offen.map((title) => ({ title, state: "open" })), ...geschlossen.map((title) => ({ title, state: "closed" }))];
}

function scheinGithub(offen = [], geschlossen = []) {
  const gesendet = [];
  return {
    gesendet,
    hole: workflowAbfrage,
    alle: async (pfad, liste) => liste(mitStatus(offen, geschlossen)),
    sende: async (methode, pfad, daten) => {
      gesendet.push({ methode, pfad, daten });
      if (pfad === "/issues") offen.push(daten.title);
      return {};
    },
  };
}

function hinweis(felder = {}) {
  return {
    schwere: "SOLLTE",
    id: "N7",
    datei: "src/zahl.js",
    zeile: 1,
    beleg: "Name @jemand ``` unklar",
    reproduktion: "",
    reparatur: "Umbenennen",
    sicherheit: false,
    ...felder,
  };
}

function ergebnisOrdner(context, commits, kopf = {}) {
  return probeDirectory(context, {
    "ergebnis.json": JSON.stringify({ format: 1, head: HEAD, branch: "fix/zahl", ...kopf, commits }),
  });
}

test("ein offenes Issue mit gleichem Titel verhindert ein neues, ein anderer Titel wird angelegt", async () => {
  const github = scheinGithub([TITEL]);
  const issues = [
    { titel: TITEL, sha: HEAD, befund: hinweis(), grund: "" },
    {
      titel: "Prüfer: G5 in src/text.js",
      sha: HEAD,
      befund: hinweis({ id: "G5", datei: "src/text.js" }),
      grund: "",
    },
  ];
  assert.deepEqual(await legeIssuesAn(issues, github), { neu: 1, vorhanden: 1 });
  assert.deepEqual(
    github.gesendet.map(({ daten }) => [daten.title, daten.labels]),
    [["Prüfer: G5 in src/text.js", ["pruefer"]]],
  );
  const [{ daten }] = github.gesendet;
  assert.match(daten.body, /````text\nName @jemand ``` unklar\n````/);
});

test("entscheiden setzt den Status Prüfer am Head-Commit und legt jedes Issue nur einmal an", async (context) => {
  setzeAusloeser(context, ciLauf());
  const commit = { sha: HEAD, patchId: "", zustand: "geprueft", befunde: [hinweis()] };
  const ordner = ergebnisOrdner(context, [commit]);
  const github = scheinGithub();
  await entscheiden({ ergebnis: ordner, head: HEAD }, ordner, { github });
  await entscheiden({ ergebnis: ordner, head: HEAD }, ordner, { github });
  const status = github.gesendet
    .filter(({ pfad }) => pfad === `/statuses/${HEAD}`)
    .map(({ daten }) => daten);
  assert.deepEqual(
    status.map(({ state, context: kontext, description }) => [state, kontext, description]),
    [
      ["success", "Prüfer", "1 Commits geprüft, 0 übernommen"],
      ["success", "Prüfer", "1 Commits geprüft, 0 übernommen"],
    ],
  );
  assert.equal(github.gesendet.filter(({ pfad }) => pfad === "/issues").length, 1);
});

async function angelegt(context, commits) {
  setzeAusloeser(context, ciLauf());
  const ordner = ergebnisOrdner(context, commits, { pr: GUELTIGE_PR });
  const github = scheinGithub();
  await entscheiden({ ergebnis: ordner, head: HEAD }, ordner, { github });
  const ersterLauf = github.gesendet.filter(({ pfad }) => pfad === "/issues").map(({ daten }) => daten);
  await entscheiden({ ergebnis: ordner, head: HEAD }, ordner, { github });
  const alle = github.gesendet.filter(({ pfad }) => pfad === "/issues").map(({ daten }) => daten);
  return { ersterLauf, wiederholt: alle.length - ersterLauf.length };
}

test("zwei Befunde in derselben Datei, mit oder ohne Katalog-ID, werden zwei Issues mit je eigenem Beleg; ein Wiederholungslauf legt keine weiteren an", async (context) => {
  const befunde = [
    hinweis({ id: "", zeile: 10, beleg: "ERSTER-OHNE-ID" }),
    hinweis({ id: "", zeile: 20, beleg: "ZWEITER-OHNE-ID" }),
    hinweis({ zeile: 30, beleg: "ERSTER-MIT-ID" }),
    hinweis({ zeile: 40, beleg: "ZWEITER-MIT-ID" }),
  ];
  const { ersterLauf, wiederholt } = await angelegt(context, [
    { sha: HEAD, patchId: "", zustand: "geprueft", befunde },
  ]);
  const titel = ersterLauf.map(({ title }) => title);
  assert.equal(new Set(titel).size, befunde.length, JSON.stringify(titel));
  for (const { beleg } of befunde) {
    assert.equal(ersterLauf.filter(({ body }) => body.includes(beleg)).length, 1, beleg);
  }
  assert.equal(wiederholt, 0);
});

test("derselbe Befund an derselben Stelle in zwei Commits wird nur ein Issue", async (context) => {
  const befund = hinweis({ id: "", zeile: 10 });
  const { ersterLauf } = await angelegt(context, [
    { sha: HEAD, patchId: "", zustand: "geprueft", befunde: [befund] },
    { sha: scheinSha("e"), patchId: "", zustand: "geprueft", befunde: [befund] },
  ]);
  assert.equal(ersterLauf.length, 1);
});

test("ein sehr langer Dateipfad kostet im Titel weder die Zeile noch die PR-Nummer", async (context) => {
  const datei = `src/${"a".repeat(TITELLIMIT)}.js`;
  const befunde = [hinweis({ id: "", datei, zeile: 5 }), hinweis({ id: "", datei, zeile: 6 })];
  const { ersterLauf } = await angelegt(context, [
    { sha: HEAD, patchId: "", zustand: "geprueft", befunde },
  ]);
  assert.equal(ersterLauf.length, 2);
  for (const [index, zeile] of [5, 6].entries()) {
    const { title } = ersterLauf[index];
    assert.ok(title.length <= TITELLIMIT, title);
    assert.ok(title.endsWith(`, Zeile ${zeile} (PR #${GUELTIGE_PR})`), title);
  }
});

test("fehlt das Ergebnis, setzt entscheiden error; war der auslösende Lauf rot, setzt es nichts", async (context) => {
  const leer = probeDirectory(context, {});
  const github = scheinGithub();
  setzeAusloeser(context, ciLauf());
  await entscheiden({ ergebnis: join(leer, "fehlt"), head: HEAD }, leer, { github });
  assert.deepEqual(
    github.gesendet.map(({ daten }) => [daten.state, daten.description]),
    [["error", "Prüfer nicht gelaufen: kein Ergebnis"]],
  );
  process.env.GITHUB_EVENT_PATH = ereignisDatei(context, ciLauf({ conclusion: "failure" }));
  assert.equal(
    await entscheiden({ ergebnis: join(leer, "fehlt"), head: HEAD }, leer, { github }),
    0,
  );
  assert.equal(github.gesendet.length, 1);
});

test("eine gefälschte Nachstellung mit unbekanntem Schlüssel oder Wert gilt als fehlend", async (context) => {
  setzeAusloeser(context, prueferLauf());
  const blocker = hinweis({
    schwere: "BLOCKER",
    reproduktion: 'import { test } from "node:test";\n',
  });
  const ordner = ergebnisOrdner(context, [
    { sha: HEAD, patchId: "", zustand: "geprueft", befunde: [blocker] },
  ]);
  const falsch = [
    { schluessel: `${HEAD}-9`, pr: "gruen", basis: "gruen" },
    { schluessel: `${HEAD}-0`, pr: "bestanden", basis: "gruen" },
  ];
  const nachstellung = probeDirectory(context, {
    "nachstellung.json": JSON.stringify({ format: 1, ergebnisse: falsch }),
  });
  const github = scheinGithub();
  await entscheiden({ ergebnis: ordner, nachstellung }, ordner, { github });
  assert.deepEqual(
    github.gesendet.map(({ daten }) => [daten.state, daten.description]),
    [["error", "Nachstellung fehlt: src/zahl.js"]],
  );
});

function einzigesIssue(befund) {
  const commits = [{ sha: HEAD, patchId: "", zustand: "geprueft", befunde: [befund] }];
  const [issue] = urteile({ commits }).issues;
  return { titel: issue.titel, text: issueText(issue) };
}

test("eine Katalog-ID ausserhalb des Katalogmusters steht weder im Titel noch im Text", () => {
  const { titel, text } = einzigesIssue(
    hinweis({ id: "G5 @jemand [mehr](https://boese.example)", datei: "src/`zahl`.js @jemand" }),
  );
  assert.equal(titel, "Prüfer: Befund in `src/zahl.js @jemand`, Zeile 1");
  assert.equal(text.includes("Katalog-ID"), false);
  assert.equal(text.includes("boese.example"), false);
  assert.ok(text.includes("- Stelle: `src/zahl.js @jemand`, Zeile 1"), text);
});

test("eine Katalog-ID nach Muster und die Datei als Code-Span stehen in Titel und Text", () => {
  const { titel, text } = einzigesIssue(hinweis({ id: "SG-07", datei: "src/zahl.js" }));
  assert.equal(titel, "Prüfer: SG-07 in `src/zahl.js`, Zeile 1");
  assert.ok(text.includes("- Katalog-ID: SG-07\n- Stelle: `src/zahl.js`, Zeile 1"), text);
});

async function ablegenGegen(context, ablage, { offen = [], geschlossen = [] } = {}) {
  const server = await scheinServer(
    context,
    new Map([
      [`GET /repos/${PRIVAT}/issues`, mitStatus(offen, geschlossen)],
      [`POST /repos/${PRIVAT}/issues`, {}],
    ]),
  );
  const umgebung = { ...isolatedEnvironment(), GH_TOKEN: "gh-schein", GITHUB_API_URL: server.url };
  const lauf = await starteEinstieg(["pruefer", "ablegen", "--ablage", ablage, "--repo", PRIVAT], { cwd: ablage, umgebung });
  const neu = server.anfragen.filter(({ methode }) => methode === "POST");
  return { lauf, neu, pfade: server.anfragen.map(({ pfad }) => pfad) };
}

test("ablegen legt Sicherheitshinweise nur im privaten Repo als Issue an, jeden Titel nur einmal", async (context) => {
  const befund = hinweis({ id: "SG-12", beleg: "GEHEIMER-BELEG", sicherheit: true });
  const ablage = probeDirectory(context, {
    "sicherheitshinweise.json": JSON.stringify({ format: 1, hinweise: [{ sha: HEAD, befund }] }),
  });
  const erster = await ablegenGegen(context, ablage);
  assert.equal(erster.lauf.status, 0, erster.lauf.stderr);
  assert.deepEqual(
    erster.neu.map(({ pfad, rumpf }) => [pfad, rumpf.title, rumpf.labels]),
    [[`/repos/${PRIVAT}/issues`, ABLAGE_TITEL, ["pruefer"]]],
  );
  const [{ rumpf }] = erster.neu;
  assert.match(rumpf.body, /GEHEIMER-BELEG/);
  assert.match(rumpf.body, /Schwere: SOLLTE \(Sicherheitsbezug, nicht öffentlich\)/);
  assert.ok(erster.pfade.every((pfad) => pfad.startsWith(`/repos/${PRIVAT}/`)));
  const zweiter = await ablegenGegen(context, ablage, { offen: [ABLAGE_TITEL] });
  assert.equal(zweiter.lauf.status, 0, zweiter.lauf.stderr);
  assert.deepEqual(zweiter.neu, []);
});

test("ablegen gleicht nur mit offenen Sicherheits-Issues ab; ein geschlossenes hält keinen neuen Hinweis auf", async (context) => {
  const befund = hinweis({ id: "SG-12", sicherheit: true });
  const ablage = probeDirectory(context, {
    "sicherheitshinweise.json": JSON.stringify({ format: 1, hinweise: [{ sha: HEAD, befund }] }),
  });
  const { lauf, neu } = await ablegenGegen(context, ablage, { geschlossen: [ABLAGE_TITEL] });
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.deepEqual(neu.map(({ rumpf }) => rumpf.title), [ABLAGE_TITEL]);
});

test("ablegen ohne gültige Ablage-Datei scheitert und legt nichts an", async (context) => {
  const leer = probeDirectory(context, {});
  const ohneDatei = await ablegenGegen(context, leer);
  assert.notEqual(ohneDatei.lauf.status, 0);
  assert.deepEqual(ohneDatei.neu, []);
  const ohneMerker = hinweis({ schwere: "BLOCKER" });
  const falsch = probeDirectory(context, {
    "sicherheitshinweise.json": JSON.stringify({ format: 1, hinweise: [{ sha: HEAD, befund: ohneMerker }] }),
  });
  const ohneSicherheit = await ablegenGegen(context, falsch);
  assert.notEqual(ohneSicherheit.lauf.status, 0);
  assert.deepEqual(ohneSicherheit.neu, []);
});

test("ablegen legt einen Sicherheits-BLOCKER im privaten Repo an, der Titel nennt die Schwere", async (context) => {
  const befund = hinweis({ id: "SG-12", schwere: "BLOCKER", beleg: "GEHEIMER-BELEG", sicherheit: true });
  const ablage = probeDirectory(context, {
    "sicherheitshinweise.json": JSON.stringify({ format: 1, hinweise: [{ sha: HEAD, befund }] }),
  });
  const { lauf, neu } = await ablegenGegen(context, ablage);
  assert.equal(lauf.status, 0, lauf.stderr);
  assert.deepEqual(
    neu.map(({ pfad, rumpf }) => [pfad, rumpf.title]),
    [[`/repos/${PRIVAT}/issues`, "Sicherheit BLOCKER: Prüfer: SG-12 in `src/zahl.js`, Zeile 1"]],
  );
  assert.match(neu[0].rumpf.body, /GEHEIMER-BELEG/);
  assert.match(neu[0].rumpf.body, /Schwere: BLOCKER \(Sicherheitsbezug, nicht öffentlich\)/);
});

test("ein Folge-Issue nennt PR und Commit; ein schon geschlossenes Issue mit gleichem Titel verhindert ein neues", async () => {
  const geschlossen = "Prüfer: N7 in `src/zahl.js` (PR #7)";
  const abgefragt = [];
  const github = scheinGithub([], [geschlossen]);
  const alle = github.alle;
  github.alle = (pfad, liste) => abgefragt.push(pfad) && alle(pfad, liste);
  const issues = [
    { titel: geschlossen, sha: HEAD, pr: 7, befund: hinweis(), grund: "" },
    { titel: "Prüfer: G5 in `src/text.js` (PR #7)", sha: HEAD, pr: 7, befund: hinweis({ id: "G5" }), grund: "" },
  ];
  assert.deepEqual(await legeIssuesAn(issues, github), { neu: 1, vorhanden: 1 });
  assert.deepEqual(abgefragt, ["/issues?state=all&labels=pruefer"]);
  const [{ daten }] = github.gesendet;
  assert.ok(daten.body.startsWith(`Der Prüfer hat im Pull Request #7 im Commit ${HEAD} einen Befund gemeldet`), daten.body);
});

test("entscheiden übernimmt nur eine positive ganze PR-Nummer und verwirft das Ergebnis bei jeder anderen Angabe", async (context) => {
  setzeAusloeser(context, ciLauf());
  const commit = { sha: HEAD, patchId: "", zustand: "geprueft", befunde: [hinweis()] };
  const gesendetBei = async (pr) => {
    const ordner = ergebnisOrdner(context, [commit], { pr });
    const github = scheinGithub();
    await entscheiden({ ergebnis: ordner, head: HEAD }, ordner, { github });
    return github.gesendet.map(({ pfad, daten }) => [pfad, daten.state ?? daten.title]);
  };
  assert.deepEqual(await gesendetBei(GUELTIGE_PR), [
    [`/statuses/${HEAD}`, "success"],
    ["/issues", `${TITEL_MIT_SPAN} (PR #${GUELTIGE_PR})`],
  ]);
  for (const pr of ["7 @jemand", "7", 0, -GUELTIGE_PR, GUELTIGE_PR + 0.5, [GUELTIGE_PR]]) {
    assert.deepEqual(await gesendetBei(pr), [[`/statuses/${HEAD}`, "error"]], JSON.stringify(pr));
  }
});
