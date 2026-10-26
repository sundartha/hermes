import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { codeOhneFreigabe, freigabeImProbeRepo, grundZeile, nachgerechnet } from "./freigabe/hilfen.mjs";
import { REPO_ROOT, commitAll, probeRepository, runIn } from "./probe-repo.js";

const BEREICHE = "tools/bereiche.json";
const FRAGE = "src/consult/question.js";
const ABSAGE = "src/billing/decline.js";
const NEU = String.raw`^src/billing/(charge)\.[jt]s$`;
const BASIS = {
  ".github/CODEOWNERS": "/tools/ @Antonio20045\n",
  "package.json": JSON.stringify({ type: "module" }),
  [FRAGE]: "export {};\n",
  [ABSAGE]: "export {};\n",
  "src/consult/answer.js": "export {};\n",
  "src/billing/charge.js": "export {};\n",
  [BEREICHE]: String.raw`[
  {
    "bereich": "probe",
    "fachlogik": ["^src/consult/answer\\.[jt]s$", "^src/consult/question\\.[jt]s$"],
    "eingaenge": [
      "^src/billing/(charge|decline)\\.[jt]s$"
    ]
  }
]
`,
};
const EINZEILIG = { geloescht: FRAGE, argumente: [] };
const ALTERNATIVE = { geloescht: ABSAGE, argumente: ["--alternativen"] };

function gekuerztCommittet(context, { geloescht, argumente }) {
  const repo = probeRepository(context, BASIS);
  const basis = runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim();
  runIn(repo, "git", ["rm", "-q", geloescht]);
  const kuerzen = runIn(repo, process.execPath, [join(REPO_ROOT, "tools/auftrag/listen-kuerzen.mjs"), "--basis", "HEAD", ...argumente]);
  assert.equal(kuerzen.status, 0, kuerzen.stdout + kuerzen.stderr);
  commitAll(repo, "Löschung");
  assert.notEqual(runIn(repo, "git", ["diff", "--quiet", basis, "HEAD", "--", BEREICHE]).status, 0, "tools/bereiche.json blieb unverändert");
  return { verzeichnis: repo, basis };
}

function kuerzungen(verzeichnis) {
  return nachgerechnet(verzeichnis, { modul: "tools/freigabe-listenkuerzung.mjs", funktion: "listenkuerzungen", basis: "HEAD~1", pfade: [BEREICHE] });
}

test("listenkuerzung: ein aus einer einzeiligen Liste gestrichener Eintrag zählt als Listenkürzung", (context) => {
  assert.deepEqual(kuerzungen(gekuerztCommittet(context, EINZEILIG).verzeichnis), [BEREICHE]);
});

test("listenkuerzung: eine gestrichene Alternative in tools/bereiche.json ist keine Listenkürzung", (context) => {
  const { verzeichnis } = gekuerztCommittet(context, ALTERNATIVE);
  assert.ok(runIn(verzeichnis, "git", ["show", `HEAD:${BEREICHE}`]).stdout.includes(JSON.stringify(NEU)));
  assert.deepEqual(kuerzungen(verzeichnis), []);
});

test("freigabe-pruefung: eine Löschung mit nachgerechneter Kürzung einer einzeiligen Liste ist art:code ohne Freigabe", async (context) => {
  codeOhneFreigabe(await freigabeImProbeRepo(context, gekuerztCommittet(context, EINZEILIG)));
});

test("freigabe-pruefung: eine Löschung mit gestrichener Alternative in tools/bereiche.json wartet als art:pruefung", async (context) => {
  const lauf = await freigabeImProbeRepo(context, gekuerztCommittet(context, ALTERNATIVE));
  assert.equal(lauf.status, 1, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /Art art:pruefung\./);
  assert.match(grundZeile(lauf.stdout), /tools\/bereiche\.json/);
});
