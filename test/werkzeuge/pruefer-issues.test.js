import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { entscheiden } from "../../tools/auftrag/pruefer-befehle.mjs";
import { legeIssuesAn } from "../../tools/auftrag/pruefer-issues.mjs";
import { probeDirectory } from "./probe-repo.js";
import {
  ciLauf,
  ereignisDatei,
  prueferLauf,
  scheinSha,
  setzeAusloeser,
  workflowAbfrage,
} from "./pruefer/hilfen.mjs";

const HEAD = scheinSha("d");
const TITEL = "Prüfer: N7 in src/zahl.js";

function scheinGithub(offen = []) {
  const gesendet = [];
  return {
    gesendet,
    hole: workflowAbfrage,
    alle: async (pfad, liste) => liste(offen.map((title) => ({ title }))),
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

function ergebnisOrdner(context, commits) {
  return probeDirectory(context, {
    "ergebnis.json": JSON.stringify({ format: 1, head: HEAD, branch: "fix/zahl", commits }),
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
