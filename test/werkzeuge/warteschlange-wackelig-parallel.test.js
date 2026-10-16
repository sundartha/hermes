import assert from "node:assert/strict";
import { test } from "node:test";

import { passingTest, probeDirectory } from "./probe-repo.js";
import { API_PFAD, CI_ROUTE, REPO, ciEreignis, githubAttrappe, warteschlange, wegwerfRepo } from "./warteschlange/hilfen.mjs";

const DATEI = "test/wackel.test.js";
const TEST = "wackelt manchmal";
const TITEL = `Wackelig: ${DATEI} › ${TEST}`;
const SHA_LAENGE = 40;
const LAEUFE = ["a".repeat(SHA_LAENGE), "b".repeat(SHA_LAENGE)];
const ERSTES_ISSUE = 90;
const EXIT_OK = 0;

function issueRouten(issues) {
  let ersteAbfragen = 0;
  const routen = new Map([CI_ROUTE]);
  routen.set(`GET ${API_PFAD}/issues`, () => {
    if (ersteAbfragen === LAEUFE.length) return issues.map((issue) => ({ ...issue }));
    ersteAbfragen += 1;
    return [];
  });
  routen.set(`POST ${API_PFAD}/issues`, ({ rumpf }) => {
    const issue = { ...rumpf, number: ERSTES_ISSUE + issues.length, state: "open", kommentare: [] };
    issues.push(issue);
    return { number: issue.number };
  });
  for (const stelle of LAEUFE.keys()) {
    const nummer = ERSTES_ISSUE + stelle;
    const issue = () => issues.find((eintrag) => eintrag.number === nummer);
    routen.set(`PATCH ${API_PFAD}/issues/${nummer}`, ({ rumpf }) => {
      Object.assign(issue(), rumpf);
      return {};
    });
    routen.set(`POST ${API_PFAD}/issues/${nummer}/comments`, ({ rumpf }) => {
      issue().kommentare.push(rumpf.body);
      return {};
    });
  }
  return routen;
}

test("zwei gleichzeitige Läufe mit demselben wackeligen Test hinterlassen genau ein offenes Issue mit beiden Belegen", async (context) => {
  const repo = wegwerfRepo(context, { [DATEI]: passingTest(TEST) });
  const beleg = JSON.stringify({ format: 1, commit: null, lauf: null, wackelig: [{ datei: DATEI, test: TEST }], rot: [] });
  const ordner = probeDirectory(context, { "wackelig-teil-1/wackelig.json": beleg });
  const issues = [];
  const github = await githubAttrappe(context, issueRouten(issues));
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
  const offen = issues.filter((issue) => issue.title === TITEL && issue.state === "open");
  assert.equal(offen.length, 1, JSON.stringify(issues));
  const belege = [offen[0].body, ...offen[0].kommentare].join("\n");
  for (const sha of LAEUFE) assert.ok(belege.includes(sha), belege);
});
