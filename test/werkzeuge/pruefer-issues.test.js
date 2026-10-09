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
const ABLAGE_TITEL = "Sicherheit: Prüfer: SG-12 in `src/zahl.js`";

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

function einzigesIssue(befund) {
  const commits = [{ sha: HEAD, patchId: "", zustand: "geprueft", befunde: [befund] }];
  const [issue] = urteile({ commits }).issues;
  return { titel: issue.titel, text: issueText(issue) };
}

test("eine Katalog-ID ausserhalb des Katalogmusters steht weder im Titel noch im Text", () => {
  const { titel, text } = einzigesIssue(
    hinweis({ id: "G5 @jemand [mehr](https://boese.example)", datei: "src/`zahl`.js @jemand" }),
  );
  assert.equal(titel, "Prüfer: Befund in `src/zahl.js @jemand`");
  assert.equal(text.includes("Katalog-ID"), false);
  assert.equal(text.includes("boese.example"), false);
  assert.ok(text.includes("- Stelle: `src/zahl.js @jemand`, Zeile 1"), text);
});

test("eine Katalog-ID nach Muster und die Datei als Code-Span stehen in Titel und Text", () => {
  const { titel, text } = einzigesIssue(hinweis({ id: "SG-07", datei: "src/zahl.js" }));
  assert.equal(titel, "Prüfer: SG-07 in `src/zahl.js`");
  assert.ok(text.includes("- Katalog-ID: SG-07\n- Stelle: `src/zahl.js`, Zeile 1"), text);
});

async function ablegenGegen(context, ablage, offen) {
  const server = await scheinServer(
    context,
    new Map([
      [`GET /repos/${PRIVAT}/issues`, offen.map((title) => ({ title }))],
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
  const erster = await ablegenGegen(context, ablage, []);
  assert.equal(erster.lauf.status, 0, erster.lauf.stderr);
  assert.deepEqual(
    erster.neu.map(({ pfad, rumpf }) => [pfad, rumpf.title, rumpf.labels]),
    [[`/repos/${PRIVAT}/issues`, ABLAGE_TITEL, ["pruefer"]]],
  );
  const [{ rumpf }] = erster.neu;
  assert.match(rumpf.body, /GEHEIMER-BELEG/);
  assert.match(rumpf.body, /Schwere: SOLLTE \(Sicherheitsbezug, nicht öffentlich\)/);
  assert.ok(erster.pfade.every((pfad) => pfad.startsWith(`/repos/${PRIVAT}/`)));
  const zweiter = await ablegenGegen(context, ablage, [ABLAGE_TITEL]);
  assert.equal(zweiter.lauf.status, 0, zweiter.lauf.stderr);
  assert.deepEqual(zweiter.neu, []);
});

test("ablegen ohne gültige Ablage-Datei scheitert und legt nichts an", async (context) => {
  const leer = probeDirectory(context, {});
  const ohneDatei = await ablegenGegen(context, leer, []);
  assert.notEqual(ohneDatei.lauf.status, 0);
  assert.deepEqual(ohneDatei.neu, []);
  const blocker = hinweis({ schwere: "BLOCKER", sicherheit: true });
  const falsch = probeDirectory(context, {
    "sicherheitshinweise.json": JSON.stringify({ format: 1, hinweise: [{ sha: HEAD, befund: blocker }] }),
  });
  const mitBlocker = await ablegenGegen(context, falsch, []);
  assert.notEqual(mitBlocker.lauf.status, 0);
  assert.deepEqual(mitBlocker.neu, []);
});
