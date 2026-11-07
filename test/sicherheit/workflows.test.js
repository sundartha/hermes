import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const AKTIONEN = ".github/actions";
const ORDNER = [".github/workflows", ...readdirSync(join(REPO_ROOT, AKTIONEN)).map((name) => `${AKTIONEN}/${name}`)];
const YAML = /\.ya?ml$/;
const USES = /^\s*-?\s*uses:\s*(\S+)/gm;
const LOKAL = /^\.\//;
const GEPINNT = /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/;
const NPM_INSTALL = /^(?!\s*-?\s*name:).*\bnpm (?:ci|install|i)\b.*$/gm;
const OHNE_SKRIPTE = /--ignore-scripts/;
const PR_AUSLOESER = /^\s*(pull_request|pull_request_review|merge_group):/m;
const GEHEIMNIS = /\$\{\{\s*secrets\.(?!GITHUB_TOKEN\b)/;

function dateien() {
  return ORDNER.flatMap((ordner) =>
    readdirSync(join(REPO_ROOT, ordner))
      .filter((name) => YAML.test(name))
      .map((name) => ({ pfad: `${ordner}/${name}`, text: readFileSync(join(REPO_ROOT, ordner, name), "utf8") })),
  );
}

function treffer(muster, verboten) {
  const funde = [];
  for (const { pfad, text } of dateien()) {
    for (const [zeile, wert = zeile] of text.matchAll(muster)) {
      if (verboten(wert)) funde.push(`${pfad}: ${wert.trim()}`);
    }
  }
  return funde;
}

test("SG-18 Workflow mit pull_request_target wird abgelehnt: kein Workflow nutzt ihn, PR-Workflows lesen keine Geheimnisse", () => {
  const mitTarget = dateien().filter(({ text }) => text.includes("pull_request_target"));
  assert.deepEqual(mitTarget.map(({ pfad }) => pfad), []);
  const prMitGeheimnis = dateien().filter(({ text }) => PR_AUSLOESER.test(text) && GEHEIMNIS.test(text));
  assert.deepEqual(prMitGeheimnis.map(({ pfad }) => pfad), []);
});

test("SG-20 Action mit Tag statt Commit-SHA wird abgelehnt: jede fremde Action ist auf eine volle SHA gepinnt", () => {
  assert.deepEqual(treffer(USES, (ziel) => !LOKAL.test(ziel) && !GEPINNT.test(ziel)), []);
});

test("SG-15 neues Paket mit Install-Skript wird in der CI gestoppt: jede Installation läuft ohne Paket-Skripte", () => {
  assert.deepEqual(treffer(NPM_INSTALL, (zeile) => !OHNE_SKRIPTE.test(zeile)), []);
});
