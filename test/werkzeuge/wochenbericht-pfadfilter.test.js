import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { test } from "node:test";

import { cruise } from "dependency-cruiser";

import { indentOf, isContentLine } from "../../tools/workflows-pruefen/struktur.mjs";
import { REPO_ROOT, probeDirectory } from "./probe-repo.js";
import { workflowLines } from "./workflow-dateien.js";

const WORKFLOW = "wochenbericht.yml";
const ENTRIES = ["tools/wochenbericht.mjs", "tools/wochenbericht"];
const TRIGGERS = ["push", "pull_request"];
const CRUISE_OPTIONS = { doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] };
const TOOLS_PREFIX = "tools/";
const FOLDER_GLOB = /^(.*\/)\*\*$/;
const LIST_ITEM = /^\s*-\s+(.*?)\s*$/;
const QUOTES = /^["']|["']$/g;

async function importedTools(entries, baseDir) {
  const { output } = await cruise(entries, { ...CRUISE_OPTIONS, baseDir });
  const sources = output.modules.map(({ source }) => source);
  return sources.filter((source) => source.startsWith(TOOLS_PREFIX)).sort();
}

function section(lines, key) {
  const start = lines.findIndex((line) => line.trim() === `${key}:`);
  if (start === -1) return [];
  const indent = indentOf(lines[start]);
  const end = lines.findIndex(
    (line, index) => index > start && isContentLine(line) && indentOf(line) <= indent,
  );
  return lines.slice(start + 1, end === -1 ? lines.length : end);
}

function listEntry(line) {
  const match = LIST_ITEM.exec(line);
  return match === null ? undefined : match[1].replace(QUOTES, "");
}

function pathFilters(lines, trigger) {
  const paths = section(section(section(lines, "on"), trigger), "paths");
  return paths.map(listEntry).filter((filter) => filter !== undefined);
}

function covers(filter, file) {
  const folder = FOLDER_GLOB.exec(filter);
  return filter === file || (folder !== null && file.startsWith(folder[1]));
}

function unlisted(filters, files) {
  return files.filter((file) => !filters.some((filter) => covers(filter, file)));
}

test("wochenbericht-pfadfilter: push und pull_request nennen jedes Modul, das die Wochenbericht-Werkzeuge laden", async () => {
  const modules = await importedTools(ENTRIES, REPO_ROOT);
  const lines = workflowLines(WORKFLOW);
  assert.ok(modules.includes("tools/wochenbericht.mjs"));
  for (const trigger of TRIGGERS) {
    assert.deepEqual(
      unlisted(pathFilters(lines, trigger), modules),
      [],
      `${trigger}: Modul fehlt im Pfadfilter`,
    );
  }
});

test("wochenbericht-pfadfilter: die Ableitung folgt Importen über mehrere Stufen und bleibt unter tools/", async (context) => {
  const directory = probeDirectory(context, {
    "tools/start.mjs":
      'import "./stufe/eins.mjs";\nimport "node:fs";\nimport "../fremd/aussen.mjs";\n',
    "tools/stufe/eins.mjs": 'import "../zwei.mjs";\n',
    "tools/zwei.mjs": 'import "node:path";\n',
    "tools/unbeteiligt.mjs": "export const X = 1;\n",
    "fremd/aussen.mjs": "export const Y = 2;\n",
  });
  assert.deepEqual(await importedTools(["tools/start.mjs"], realpathSync(directory)), [
    "tools/start.mjs",
    "tools/stufe/eins.mjs",
    "tools/zwei.mjs",
  ]);
});

const FILES = ["tools/a.mjs", "tools/ordner/b.mjs", "tools/anderer/c.mjs"];

const FILTER_CASES = [
  {
    name: "genaue Dateien und ein Ordner-Glob decken ihre Module",
    paths: ["tools/a.mjs", "tools/ordner/**", "tools/anderer/c.mjs"],
    expected: [],
  },
  {
    name: "Anführungszeichen um einen Eintrag ändern nichts",
    paths: ['"tools/a.mjs"', "'tools/ordner/**'", "tools/anderer/c.mjs"],
    expected: [],
  },
  {
    name: "ein Modul ohne Eintrag bleibt übrig",
    paths: ["tools/a.mjs", "tools/ordner/**"],
    expected: ["tools/anderer/c.mjs"],
  },
  {
    name: "ein Ordner-Glob deckt keinen Nachbarordner mit gleichem Anfang",
    paths: ["tools/a.mjs", "tools/ord/**", "tools/anderer/c.mjs"],
    expected: ["tools/ordner/b.mjs"],
  },
  {
    name: "ohne paths-Liste ist nichts gedeckt",
    paths: [],
    expected: FILES,
  },
];

function triggerBlock(name, paths) {
  const list = paths.length === 0 ? [] : ["    paths:", ...paths.map((path) => `      - ${path}`)];
  return [`  ${name}:`, "    branches: [master]", ...list];
}

function workflowWith(trigger, paths) {
  const blocks = TRIGGERS.flatMap((name) => triggerBlock(name, name === trigger ? paths : []));
  return ["name: Probe", "on:", ...blocks, "  workflow_dispatch:", "jobs: {}"];
}

test("wochenbericht-pfadfilter: der Leser der Pfadlisten meldet genau die Module ohne Eintrag", () => {
  for (const { name, paths, expected } of FILTER_CASES) {
    for (const trigger of TRIGGERS) {
      const filters = pathFilters(workflowWith(trigger, paths), trigger);
      assert.deepEqual(unlisted(filters, FILES), expected, `${name} (${trigger})`);
    }
  }
});

test("wochenbericht-pfadfilter: Pfade unter dem anderen Auslöser zählen nicht", () => {
  const lines = workflowWith("push", ["tools/a.mjs"]);
  assert.deepEqual(unlisted(pathFilters(lines, "pull_request"), ["tools/a.mjs"]), ["tools/a.mjs"]);
  assert.deepEqual(unlisted(pathFilters(lines, "push"), ["tools/a.mjs"]), []);
});
