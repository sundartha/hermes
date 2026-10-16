import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";

import { passingTest, probeDirectory } from "./probe-repo.js";
import { API_PFAD, CI_NUMMER, REPO, ciEreignis, warteschlange, wegwerfRepo } from "./warteschlange/hilfen.mjs";

const DATEI = "test/wackel.test.js";
const TEST = "wackelt manchmal";
const TITEL = `Wackelig: ${DATEI} › ${TEST}`;
const SHA_LAENGE = 40;
const LAEUFE = ["a".repeat(SHA_LAENGE), "b".repeat(SHA_LAENGE)];
const ERSTES_ISSUE = 90;
const ISSUE_NUMMER = /^\/issues\/(\d+)/;
const HTTP_OK = 200;
const HTTP_NICHT_DA = 404;
const EXIT_OK = 0;
const ZEITLIMIT_MS = 60_000;

async function rumpfVon(anfrage) {
  let text = "";
  for await (const stueck of anfrage) text += stueck;
  return text === "" ? null : JSON.parse(text);
}

function issueSpeicher() {
  const issues = [];
  let wartend = [];
  return {
    issues,
    liste() {
      if (wartend === null) return issues.map((issue) => ({ ...issue }));
      const antwort = new Promise((fertig) => wartend.push(fertig));
      if (wartend.length === LAEUFE.length) {
        for (const fertig of wartend) fertig([]);
        wartend = null;
      }
      return antwort;
    },
    lege(rumpf) {
      const issue = { ...rumpf, number: ERSTES_ISSUE + issues.length, state: "open", kommentare: [] };
      issues.push(issue);
      return { number: issue.number };
    },
  };
}

function antwortAuf(speicher, { methode, pfad, rumpf }) {
  if (`${methode} ${pfad}` === "GET /actions/workflows/ci.yml") return { id: CI_NUMMER };
  if (`${methode} ${pfad}` === "GET /issues") return speicher.liste();
  if (`${methode} ${pfad}` === "POST /issues") return speicher.lege(rumpf);
  const issue = speicher.issues.find(({ number }) => number === Number(ISSUE_NUMMER.exec(pfad)?.[1]));
  if (issue === undefined) return undefined;
  if (methode === "PATCH") Object.assign(issue, rumpf);
  if (methode === "POST" && pfad.endsWith("/comments")) issue.kommentare.push(rumpf.body);
  return {};
}

async function issueAttrappe(context) {
  const speicher = issueSpeicher();
  const server = createServer(async (anfrage, antwort) => {
    const pfad = new URL(anfrage.url, "http://attrappe").pathname.slice(API_PFAD.length);
    const rumpf = await rumpfVon(anfrage);
    const wert = await antwortAuf(speicher, { methode: anfrage.method, pfad, rumpf });
    antwort.writeHead(wert === undefined ? HTTP_NICHT_DA : HTTP_OK, { "content-type": "application/json" });
    antwort.end(JSON.stringify(wert ?? { message: "Not Found" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => server.close());
  return { url: `http://127.0.0.1:${server.address().port}`, issues: speicher.issues };
}

test("zwei gleichzeitige Läufe mit demselben wackeligen Test hinterlassen genau ein offenes Issue mit beiden Belegen", { timeout: ZEITLIMIT_MS }, async (context) => {
  const repo = wegwerfRepo(context, { [DATEI]: passingTest(TEST) });
  const beleg = JSON.stringify({ format: 1, commit: null, lauf: null, wackelig: [{ datei: DATEI, test: TEST }], rot: [] });
  const ordner = probeDirectory(context, { "wackelig-teil-1/wackelig.json": beleg });
  const github = await issueAttrappe(context);
  const laeufe = await Promise.all(
    LAEUFE.map((sha) =>
      warteschlange(["wackelig", "--ordner", ordner], {
        cwd: repo.ordner,
        umgebung: {
          GITHUB_API_URL: github.url,
          GH_TOKEN: "probe",
          GITHUB_REPOSITORY: REPO,
          GITHUB_EVENT_PATH: ciEreignis(context, { event: "merge_group", head_sha: sha }),
        },
      }),
    ),
  );
  for (const lauf of laeufe) assert.equal(lauf.status, EXIT_OK, lauf.stderr);
  const offen = github.issues.filter((issue) => issue.title === TITEL && issue.state === "open");
  assert.equal(offen.length, 1, JSON.stringify(github.issues));
  const belege = [offen[0].body, ...offen[0].kommentare].join("\n");
  for (const sha of LAEUFE) assert.ok(belege.includes(sha), belege);
});
