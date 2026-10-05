import assert from "node:assert/strict";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { weitereRunde } from "../../tools/auftrag/reparatur.mjs";
import { isolatedEnvironment, probeDirectory } from "./probe-repo.js";
import { probeRepo, scheinSha, starteEinstieg } from "./pruefer/hilfen.mjs";

const AUSFUEHRBAR = 0o755;
const EXIT_ROT = 1;
const PR_NUMMER = 7;
const BEFEHLSTEILE = 3;
const SHA = scheinSha("a");
const ZIEL = `${SHA}-0`;
const ANDERER = `${SHA}-1`;
const REPRODUKTION = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { ZAHL } from "../src/zahl.js";',
  'test("ZAHL ist 2", () => assert.equal(ZAHL, 2));',
  "",
].join("\n");

const AGENT = `#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
readFileSync(0, "utf8");
const rolle = process.env.HERMES_ROLLE;
appendFileSync(process.env.ERSATZ_STARTS, rolle + " " + process.argv.slice(2).join(" ") + "\\n");
const einsatz = JSON.parse(readFileSync(process.env.ERSATZ_DREHBUCH, "utf8"))[rolle] ?? {};
for (const [pfad, inhalt] of Object.entries(einsatz.dateien ?? {})) writeFileSync(pfad, inhalt);
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: einsatz.antwort ?? "fertig" }) + "\\n");
`;

const GH = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const eingabe = process.argv.includes("-") ? readFileSync(0, "utf8") : "";
appendFileSync(process.env.ERSATZ_GH, JSON.stringify([...process.argv.slice(2), eingabe]) + "\\n");
`;

test("eine weitere Runde gibt es nur, wenn die rote Reproduktion grün ist und keine andere rot wurde", () => {
  const vorher = new Map([
    [ZIEL, "erwartung"],
    [ANDERER, "gruen"],
  ]);
  const faelle = [
    [[ZIEL, "gruen"], [ANDERER, "gruen"], true],
    [[ZIEL, "erwartung"], [ANDERER, "gruen"], false],
    [[ZIEL, "laden"], [ANDERER, "gruen"], false],
    [[ZIEL, "gruen"], [ANDERER, "erwartung"], false],
  ];
  for (const [ziel, anderer, erwartet] of faelle) {
    assert.equal(
      weitereRunde(vorher, new Map([ziel, anderer])),
      erwartet,
      JSON.stringify([ziel, anderer]),
    );
  }
  assert.equal(weitereRunde(new Map([[ZIEL, "gruen"]]), new Map([[ZIEL, "gruen"]])), false);
});

function reparaturLauf(context, drehbuch) {
  const repo = probeRepo(context);
  const befund = {
    schwere: "BLOCKER",
    id: "G5",
    datei: "src/zahl.js",
    zeile: 1,
    beleg: "ZAHL ist 1",
    reproduktion: REPRODUKTION,
    reparatur: "ZAHL auf 2",
    sicherheit: false,
  };
  const ergebnis = {
    format: 1,
    head: SHA,
    branch: "fix/zahl",
    pr: PR_NUMMER,
    commits: [{ sha: SHA, patchId: "", zustand: "geprueft", befunde: [befund] }],
  };
  const nachstellung = {
    format: 1,
    ergebnisse: [{ schluessel: ZIEL, pr: "erwartung", basis: "gruen" }],
  };
  const werkzeug = probeDirectory(context, {
    "claude.mjs": AGENT,
    "gh.mjs": GH,
    "drehbuch.json": JSON.stringify(drehbuch),
    "ergebnis/ergebnis.json": JSON.stringify(ergebnis),
    "nachstellung/nachstellung.json": JSON.stringify(nachstellung),
  });
  for (const name of ["claude.mjs", "gh.mjs"]) chmodSync(join(werkzeug, name), AUSFUEHRBAR);
  const umgebung = {
    ...isolatedEnvironment(),
    HOME: werkzeug,
    HERMES_CLAUDE: join(werkzeug, "claude.mjs"),
    HERMES_GH: join(werkzeug, "gh.mjs"),
    ERSATZ_DREHBUCH: join(werkzeug, "drehbuch.json"),
    ERSATZ_GH: join(werkzeug, "gh.log"),
    ERSATZ_STARTS: join(werkzeug, "starts.log"),
  };
  const args = [
    "reparatur",
    "--ergebnis",
    join(werkzeug, "ergebnis"),
    "--nachstellung",
    join(werkzeug, "nachstellung"),
  ];
  const lies = (name) =>
    existsSync(join(werkzeug, name)) ? readFileSync(join(werkzeug, name), "utf8") : "";
  return { repo, lauf: starteEinstieg(args, { cwd: repo.ordner, umgebung }), lies };
}

test("eine Reparatur mit Wirkung endet grün, ohne Entscheidungsnotiz, mit einem frischen Opus-Agenten", async (context) => {
  const { lauf, lies, repo } = reparaturLauf(context, {
    bau: { dateien: { "src/zahl.js": "export const ZAHL = 2;\n" } },
  });
  const { status, stdout, stderr } = await lauf;
  assert.equal(status, 0, stderr);
  assert.match(stdout, /^Reparatur wirkt/m);
  assert.equal(lies("gh.log"), "");
  assert.match(lies("starts.log"), /^bau -p --agent bau-kritisch .*--session-id \S+/);
  assert.equal(
    readFileSync(join(repo.ordner, "test/pruefer-reproduktion.test.js"), "utf8"),
    REPRODUKTION,
  );
});

test("eine Reparatur ohne Wirkung endet mit einer Entscheidungsnotiz im PR statt einer weiteren Runde", async (context) => {
  const { lauf, lies } = reparaturLauf(context, {
    notiz: { antwort: "1. Den Befund prüfen lassen (Empfehlung)" },
  });
  const { status, stdout } = await lauf;
  assert.equal(status, EXIT_ROT);
  assert.match(stdout, /Reparatur ohne Wirkung: Entscheidung nötig\./);
  const aufrufe = lies("gh.log")
    .trim()
    .split("\n")
    .map((zeile) => JSON.parse(zeile));
  assert.deepEqual(
    aufrufe.map((aufruf) => aufruf.slice(0, BEFEHLSTEILE)),
    [
      ["pr", "comment", String(PR_NUMMER)],
      ["pr", "edit", String(PR_NUMMER)],
    ],
  );
  assert.match(
    aufrufe[0].at(-1),
    /## Entscheidung nötig[\s\S]*keine Wirkung[\s\S]*Den Befund prüfen lassen/,
  );
  assert.equal(
    lies("starts.log")
      .split("\n")
      .filter((zeile) => zeile.startsWith("bau ")).length,
    1,
  );
});
