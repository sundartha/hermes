import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { isDeepStrictEqual } from "node:util";

import { CONSULT_ON, legacySnapshot, stdioSnapshot } from "../mcp-draht-pfade.js";
import { REPO_ROOT } from "./probe-repo.js";

const PIN_PATH = "test/werkzeuge/werkzeugtexte.json";
const TEXT_KEYS = new Set(["title", "description"]);
const INVOCATION_KEY = "toolInvocation";
const JSON_INDENT = 2;

function textEntries(value, path = []) {
  if (typeof value === "string") {
    const key = path.at(-1);
    return TEXT_KEYS.has(key) || key.includes(INVOCATION_KEY) ? [[path.join("."), value]] : [];
  }
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) => textEntries(inner, [...path, key]));
}

function textsByTool(tools) {
  const sorted = tools.toSorted((left, right) => left.name.localeCompare(right.name));
  return Object.fromEntries(
    sorted.map(({ name, ...tool }) => [name, Object.fromEntries(textEntries(tool))]),
  );
}

function onlyDifferent(texts, reference) {
  const entries = Object.entries(texts);
  return Object.fromEntries(
    entries.filter(([name, own]) => !isDeepStrictEqual(own, reference[name])),
  );
}

async function wireTexts() {
  const withoutConsult = textsByTool((await stdioSnapshot({})).tools);
  const withConsult = textsByTool((await legacySnapshot(CONSULT_ON)).tools);
  return {
    "ohne Consult": withoutConsult,
    "mit Consult": onlyDifferent(withConsult, withoutConsult),
  };
}

test("die Texte aus tools/list stehen unverändert in der festgehaltenen Datei", async () => {
  const actual = await wireTexts();
  const pinned = JSON.parse(readFileSync(join(REPO_ROOT, PIN_PATH), "utf8"));
  const text = `${JSON.stringify(actual, null, JSON_INDENT)}\n`;
  const copy = join(mkdtempSync(join(tmpdir(), "werkzeugtexte-")), "werkzeugtexte.json");
  writeFileSync(copy, text);
  assert.deepEqual(
    actual,
    pinned,
    `Die Werkzeugtexte am Draht weichen von ${PIN_PATH} ab. Ist die Änderung gewollt, übernimmt „cp ${copy} ${PIN_PATH}“ den neuen Stand; der PR braucht dann die Freigabe als Werkzeugtext-Änderung.`,
  );
});
