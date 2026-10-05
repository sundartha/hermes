import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { entscheiden, pruefen } from "../../tools/auftrag/pruefer-befehle.mjs";
import { probeDirectory } from "./probe-repo.js";
import {
  SCHEIN_TOKEN,
  aufzeichnung,
  ciLauf,
  ersatzPruefer,
  ohneGitVariablen,
  probeRepo,
  setzeAusloeser,
  workflowAbfrage,
} from "./pruefer/hilfen.mjs";

ohneGitVariablen();

const EIGENES_REPO = "sundartha/hermes";
const FORK_REPO = "fremd/hermes";
process.env.GITHUB_REPOSITORY = EIGENES_REPO;

const PR_NUMMER = 9;
const PAKET_BRANCH = "paket/99-x";
const PAKET_NACHRICHT = "Setze die Zahl\n\nWarum: Probe.\n\nPaket: 99\n";
const DEPENDABOT_NACHRICHT =
  "Bump eslint from 9.0.0 to 9.1.0\n\nSigned-off-by: dependabot[bot] <support@github.com>\n";
const OHNE_TOKEN = "";
const ZWEI_COMMITS = 2;
const PROBE_IDENTITAET = ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid"];

function ohneBefund() {
  const aufnahme = aufzeichnung("gueltig");
  const ergebnis = aufnahme.zeilen.find(({ type }) => type === "result");
  ergebnis.structured_output = { urteil: "BESTANDEN", befunde: [] };
  return aufnahme;
}

function scheinGithub({ basis, head, davor = [] }) {
  const gesendet = [];
  const pr = {
    number: PR_NUMMER,
    state: "open",
    head: { sha: head },
    base: { sha: basis, ref: "master" },
    body: "",
  };
  return {
    gesendet,
    hole: async (pfad) =>
      pfad === `/commits/${head}/pulls` ? [...davor, pr] : workflowAbfrage(pfad),
    alle: async () => [],
    sende: async (methode, pfad, daten) => {
      gesendet.push({ methode, pfad, daten });
      return {};
    },
  };
}

function gesetzteStatus(github) {
  return github.gesendet
    .filter(({ methode, pfad }) => methode === "POST" && pfad.startsWith("/statuses/"))
    .map(({ pfad, daten }) => ({ pfad, state: daten.state, description: daten.description }));
}

function anzahlZeilen(datei) {
  return existsSync(datei) ? readFileSync(datei, "utf8").trim().split("\n").length : 0;
}

function stumm(context) {
  context.mock.method(console, "log", () => {});
  context.mock.method(console, "error", () => {});
}

async function pruefeUndMelde(
  context,
  { repo, basis, branch, prRepo = EIGENES_REPO, token, davor = [] },
) {
  const head = repo.git(["rev-parse", "HEAD"]);
  const aus = join(probeDirectory(context, {}), "ergebnis");
  const aufrufe = join(probeDirectory(context, {}), "aufrufe.jsonl");
  const { programm } = ersatzPruefer(context, {
    aufnahme: ohneBefund(),
    beobachtet: { datei: join(aus, "ergebnis.json"), liste: aufrufe },
  });
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token ?? SCHEIN_TOKEN;
  setzeAusloeser(context, ciLauf());
  const github = scheinGithub({ basis, head, davor });
  await pruefen({ head, "pr-branch": branch, "pr-repo": prRepo, aus }, repo.ordner, {
    github,
    programm,
  });
  await entscheiden({ ergebnis: aus, head }, repo.ordner, { github });
  return { head, aus, aufrufe: anzahlZeilen(aufrufe), status: gesetzteStatus(github) };
}

function paketPr(context) {
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.committe({ "src/zahl.js": "export const ZAHL = 2;\n" }, PAKET_NACHRICHT);
  repo.committe({ "src/text.js": "export const TEXT = 2;\n" }, PAKET_NACHRICHT);
  return { repo, basis };
}

test("ein Paket-PR ohne Auftrags-Commit wird gelesen und erst danach grün", async (context) => {
  stumm(context);
  const lauf = await pruefeUndMelde(context, { ...paketPr(context), branch: PAKET_BRANCH });
  assert.equal(lauf.aufrufe, ZWEI_COMMITS);
  assert.deepEqual(lauf.status, [
    {
      pfad: `/statuses/${lauf.head}`,
      state: "success",
      description: "2 Commits geprüft, 0 übernommen",
    },
  ]);
});

test("ein Paket-PR ohne Auftrags-Commit, dessen Prüfung nicht laufen konnte, bleibt ohne grün", async (context) => {
  stumm(context);
  const lauf = await pruefeUndMelde(context, {
    ...paketPr(context),
    branch: PAKET_BRANCH,
    token: OHNE_TOKEN,
  });
  assert.equal(lauf.aufrufe, 0);
  assert.deepEqual(lauf.status, [
    {
      pfad: `/statuses/${lauf.head}`,
      state: "error",
      description: "Prüfer nicht gelaufen: Token fehlt",
    },
  ]);
});

test("ein Dependabot-PR wird nur mit Zugang zum Prüfer gelesen und sonst nie grün", async (context) => {
  stumm(context);
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.committe({ "package.json": '{"type":"module","version":"2"}' }, DEPENDABOT_NACHRICHT);
  const branch = "dependabot/npm_and_yarn/eslint-9.1.0";
  const ohne = await pruefeUndMelde(context, { repo, basis, branch, token: OHNE_TOKEN });
  const mit = await pruefeUndMelde(context, { repo, basis, branch });
  assert.deepEqual(
    [ohne, mit].map(({ aufrufe, status }) => [aufrufe, status.map(({ state }) => state)]),
    [
      [0, ["error"]],
      [1, ["success"]],
    ],
  );
});

test("nach einer Änderung ist nur der geprüfte Stand grün, der neue erst nach seiner Prüfung", async (context) => {
  stumm(context);
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.committe({ "src/zahl.js": "export const ZAHL = 2;\n" }, PAKET_NACHRICHT);
  const geprueft = await pruefeUndMelde(context, { repo, basis, branch: "fix/zahl" });
  repo.committe({ "src/zahl.js": "export const ZAHL = 3;\n" }, PAKET_NACHRICHT);
  const geaendert = await pruefeUndMelde(context, {
    repo,
    basis,
    branch: "fix/zahl",
    token: OHNE_TOKEN,
  });
  assert.deepEqual(
    [geprueft, geaendert].map(({ status }) => status.map(({ pfad, state }) => [pfad, state])),
    [[[`/statuses/${geprueft.head}`, "success"]], [[`/statuses/${geaendert.head}`, "error"]]],
  );
  const github = scheinGithub({ basis, head: geaendert.head });
  await entscheiden({ ergebnis: geprueft.aus, head: geaendert.head }, repo.ordner, { github });
  assert.deepEqual(gesetzteStatus(github), [
    {
      pfad: `/statuses/${geaendert.head}`,
      state: "error",
      description: "Prüfer nicht gelaufen: Ergebnis gehört zu einem anderen Commit",
    },
  ]);
});

test("ein Probe-Branch aus einem Fork wird gelesen, einer aus dem eigenen Repo wird nie grün", async (context) => {
  stumm(context);
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.committe({ "src/zahl.js": "export const ZAHL = 2;\n" }, PAKET_NACHRICHT);
  const branch = "rotprobe/zahl";
  const fork = await pruefeUndMelde(context, { repo, basis, branch, prRepo: FORK_REPO });
  const eigen = await pruefeUndMelde(context, { repo, basis, branch, prRepo: EIGENES_REPO });
  assert.deepEqual(
    [fork, eigen].map(({ aufrufe, status }) => [
      aufrufe,
      status.map(({ description }) => description),
    ]),
    [
      [1, ["1 Commits geprüft, 0 übernommen"]],
      [0, ["Probe-Branch, nicht geprüft"]],
    ],
  );
});

test("ein PR ohne einen einzigen Commit bekommt keinen grünen Status", async (context) => {
  stumm(context);
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  const lauf = await pruefeUndMelde(context, {
    repo,
    basis,
    branch: PAKET_BRANCH,
  });
  assert.equal(lauf.aufrufe, 0);
  assert.deepEqual(lauf.status, [
    {
      pfad: `/statuses/${lauf.head}`,
      state: "error",
      description: "keine Commits geprüft",
    },
  ]);
});

test("ein Merge-Commit im PR wird nicht gelesen und hält den Status von grün fern", async (context) => {
  stumm(context);
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  repo.git(["checkout", "-q", "-b", "seite"]);
  repo.committe({ "src/text.js": "export const TEXT = 2;\n" }, PAKET_NACHRICHT);
  repo.git(["checkout", "-q", "-b", "arbeit", basis]);
  repo.committe({ "src/zahl.js": "export const ZAHL = 2;\n" }, PAKET_NACHRICHT);
  repo.git([...PROBE_IDENTITAET, "merge", "-q", "--no-ff", "--no-commit", "seite"]);
  repo.committe({ "src/zusatz.js": "export const ZUSATZ = 1;\n" }, PAKET_NACHRICHT);
  const lauf = await pruefeUndMelde(context, {
    repo,
    basis,
    branch: PAKET_BRANCH,
  });
  assert.equal(lauf.aufrufe, ZWEI_COMMITS);
  assert.deepEqual(lauf.status, [
    {
      pfad: `/statuses/${lauf.head}`,
      state: "error",
      description: "Prüfer nicht gelaufen: Merge-Commit im PR, bitte rebasen",
    },
  ]);
});

test("zum Kopf-Commit zählt der PR nach master, auch wenn ein PR gegen einen anderen Branch zuerst kommt", async (context) => {
  stumm(context);
  const repo = probeRepo(context);
  const basis = repo.git(["rev-parse", "HEAD"]);
  const erster = repo.committe({ "src/zahl.js": "export const ZAHL = 2;\n" }, PAKET_NACHRICHT);
  const head = repo.committe({ "src/text.js": "export const TEXT = 2;\n" }, PAKET_NACHRICHT);
  const neben = {
    number: PR_NUMMER + 1,
    state: "open",
    head: { sha: head },
    base: { sha: erster, ref: "neben" },
    body: "",
  };
  const lauf = await pruefeUndMelde(context, {
    repo,
    basis,
    branch: PAKET_BRANCH,
    davor: [neben],
  });
  assert.equal(lauf.aufrufe, ZWEI_COMMITS);
  assert.deepEqual(lauf.status, [
    {
      pfad: `/statuses/${head}`,
      state: "success",
      description: "2 Commits geprüft, 0 übernommen",
    },
  ]);
});
