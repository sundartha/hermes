import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { befundSchluessel } from "../../tools/eslint-rules/bestand.js";
import { bestandsDatei } from "./hermes-regeln-probe.js";
import { REPO_ROOT } from "./probe-repo.js";
import { brichtOhneBasisAb, nachCommitPruefen, repoMitBasis } from "./pr-probe.js";

const TOOL = join(REPO_ROOT, "tools/neue-kommentare.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;
const BESTAND = "tools/basis/kommentare.json";
const CODE = "export const wert = true;";
const ZWEITER_CODE = "export const zweiter = false;";

function quelle(zeilen) {
  return `${zeilen.join("\n")}\n`;
}

function basisRepo(context, dateien = {}) {
  return repoMitBasis(context, {
    "eslint.config.mjs": "export default [];\n",
    [BESTAND]: bestandsDatei([]),
    "src/a.js": quelle([CODE, ZWEITER_CODE]),
    ".github/workflows/probe.yml": quelle(["name: Probe", "on: push"]),
    "tasks/lessons.md": quelle(["# Lehren", "", "- erste Lehre"]),
    ...dateien,
  });
}

function nachher(repo, dateien) {
  return nachCommitPruefen(repo, TOOL, dateien);
}

test("neue-kommentare: ein neuer Kommentar ist rot, auch wenn sein Schlüssel im selben PR in die Basislinie kommt", (context) => {
  const lauf = nachher(basisRepo(context), {
    "src/a.js": quelle(["// neue Begründung", CODE, ZWEITER_CODE]),
    [BESTAND]: bestandsDatei([befundSchluessel("src/a.js", " neue Begründung")]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/a\.js:1 neuer Kommentar/);
});

test("neue-kommentare: ein früher entfernter Kommentar ist beim Wiedereinfügen rot, solange sein Schlüssel noch in der Basislinie steht", (context) => {
  const repo = basisRepo(context, { [BESTAND]: bestandsDatei([befundSchluessel("src/a.js", " alte Begründung")]) });
  const lauf = nachher(repo, { "src/a.js": quelle([CODE, "/* alte Begründung */", ZWEITER_CODE]) });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/a\.js:2 neuer Kommentar/);
});

test("neue-kommentare: ein neuer YAML-Kommentar ist rot", (context) => {
  const lauf = nachher(basisRepo(context), {
    ".github/workflows/probe.yml": quelle(["name: Probe", "on: push # nur auf master"]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /\.github\/workflows\/probe\.yml:2 neuer Kommentar/);
});

test("neue-kommentare: eine neue Zeile in tasks/lessons.md ist rot", (context) => {
  const lauf = nachher(basisRepo(context), {
    "tasks/lessons.md": quelle(["# Lehren", "", "- erste Lehre", "- zweite Lehre"]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /tasks\/lessons\.md:4 neue Zeile in tasks\/lessons\.md/);
});

test("neue-kommentare: Direktive und unerlaubte Startzeile in einer neuen Datei sind rot, #!/usr/bin/env node nicht", (context) => {
  const lauf = nachher(basisRepo(context), {
    "src/b.js": quelle(["#!/usr/bin/node", '"weil es so sein muss";', CODE]),
    "src/c.js": quelle(["#!/usr/bin/env node", '"use strict";', CODE]),
  });
  assert.equal(lauf.status, EXIT_FINDING, lauf.output);
  assert.match(lauf.output, /src\/b\.js:1 neuer Kommentar/);
  assert.match(lauf.output, /src\/b\.js:2 neuer Kommentar/);
  assert.doesNotMatch(lauf.output, /src\/c\.js/);
});

test("neue-kommentare: nur löschen und Code umstellen bleibt grün", (context) => {
  const repo = basisRepo(context, {
    "src/a.js": quelle(["// alte Begründung", CODE, ZWEITER_CODE]),
    ".github/workflows/probe.yml": quelle(["name: Probe", "# alter Hinweis", "on: push"]),
    "tasks/lessons.md": quelle(["# Lehren", "", "- erste Lehre", "- zweite Lehre"]),
  });
  const lauf = nachher(repo, {
    "src/a.js": quelle([ZWEITER_CODE, CODE]),
    ".github/workflows/probe.yml": quelle(["name: Probe", "on: push"]),
    "tasks/lessons.md": quelle(["# Lehren", "", "- zweite Lehre"]),
  });
  assert.equal(lauf.status, EXIT_OK, lauf.output);
  assert.match(lauf.output, /0 hinzugefügte Zeilen mit Kommentar/);
});

test("neue-kommentare: ohne, mit leerer oder unbekannter Basis bricht es mit Exit 2 ab", (context) => {
  brichtOhneBasisAb(basisRepo(context).directory, TOOL);
});
