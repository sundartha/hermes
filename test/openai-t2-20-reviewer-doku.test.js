import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./helpers.js";
import { REVIEWER_SEED_CALLS } from "../scripts/lib/reviewer-demo-seed.mjs";

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
