import test from "node:test";
import assert from "node:assert/strict";
import fs, { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import path, { join } from "node:path";
import { spawnSync } from "node:child_process";
import { ROOT } from "./helpers.js";
import { REVIEWER_SEED_CALLS } from "../scripts/lib/reviewer-demo-seed.mjs";
import { REPO_ROOT, isolatedEnvironment, outputLines, probeDirectory } from "./werkzeuge/probe-repo.js";

const DOC_PATH = path.join(ROOT, "docs", "OPENAI-REVIEWER-ACCESS.md");
const SEED_BLOCKS = {
  en: {
    begin: "SEED-EN-BEGIN -->",
    end: "<!-- SEED-EN-END",
    call: "Incoming call from",
    item: "Action item:",
  },
  de: {
    begin: "SEED-DE-BEGIN -->",
    end: "<!-- SEED-DE-END",
    call: "Eingehender Anruf von",
    item: "Action Item:",
  },
};

const readDoc = () => fs.readFileSync(DOC_PATH, "utf8");

function between(doc, { begin, end }) {
  const start = doc.indexOf(begin);
  const stop = doc.indexOf(end, start + begin.length);
  assert.ok(start !== -1 && stop > start, `Abschnitt ${begin}..${end} fehlt`);
  return { start, stop: stop + end.length, body: doc.slice(start + begin.length, stop) };
}

const nonEmptyLines = (text) => text.split("\n").filter((line) => line.trim().length > 0);

function expectedSeedLines({ call, item }) {
  return REVIEWER_SEED_CALLS.flatMap((entry) => [
    `- ${call} ${entry.from}: ${entry.summary}`,
    ...entry.actionItems.map((text) => `  - ${item} ${text}`),
  ]);
}

test("Reviewer-Doku: Beispieldaten in EN und DE sind genau REVIEWER_SEED_CALLS", () => {
  const doc = readDoc();
  for (const [lang, markers] of Object.entries(SEED_BLOCKS)) {
    const actual = nonEmptyLines(between(doc, markers).body);
    assert.deepEqual(actual, expectedSeedLines(markers), `${lang}: Beispieldaten weichen ab`);
  }
});

const PRUEFSKRIPT = join(REPO_ROOT, "tools/openai-doku-pruefen.mjs");
const DOKU_REVIEWER = join(REPO_ROOT, "docs/OPENAI-REVIEWER-ACCESS.md");
const EXIT_BEFUND = 1;
const SKRIPT_FRIST_MS = 150_000;

test("weichen die Beispieldaten der Reviewer-Doku vom Seed ab, nennt die Pruefung Sprache und Zeile", (context) => {
  const reviewer = join(probeDirectory(context, {}), "reviewer-beispiele.md");
  copyFileSync(DOKU_REVIEWER, reviewer);
  const geaendert = readFileSync(reviewer, "utf8")
    .replace("picked up until 6 pm.", "picked up until 7 pm.")
    .replace("  - Action Item: Bring gardening gloves to the cleanup.\n", "");
  writeFileSync(reviewer, geaendert);
  const lauf = spawnSync(process.execPath, [PRUEFSKRIPT, "--doku-reviewer", reviewer], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: isolatedEnvironment(),
    timeout: SKRIPT_FRIST_MS,
  });
  const zeilen = outputLines(lauf.stdout);
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stdout + lauf.stderr);
  for (const [sprache, zeile] of [["en", 3], ["de", 7]]) {
    assert.ok(
      zeilen.some((befund) =>
        befund.startsWith(`reviewer Beispieldaten: ${sprache}: Beispieldaten weichen in Zeile ${zeile} ab`),
      ),
      lauf.stdout,
    );
  }
});
