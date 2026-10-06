import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { kommentareImText } from "../../tools/kommentare-yaml-shell.mjs";
import {
  REPO_ROOT,
  commitAll,
  isolatedEnvironment,
  probeDirectory,
  probeRepository,
  writeFiles,
} from "./probe-repo.js";

const SCRIPT = join(REPO_ROOT, "tools/kommentare-yaml-shell.mjs");
const EXIT_OK = 0;
const EXIT_FINDING = 1;

function gefunden(pfad, zeilen) {
  return kommentareImText(pfad, zeilen.join("\n")).map(({ zeile, text }) => [
    zeilen[zeile - 1].trim(),
    text.trim(),
  ]);
}

test("kommentare-yaml-shell: YAML-Kommentare am Zeilenanfang und am Zeilenende sind Befunde", () => {
  const zeilen = ["# ganze Zeile", "name: Probe", "on: push # am Ende", "jobs: {}"];
  assert.deepEqual(gefunden(".github/workflows/probe.yml", zeilen), [
    ["# ganze Zeile", "ganze Zeile"],
    ["on: push # am Ende", "am Ende"],
  ]);
});

test("kommentare-yaml-shell: Shell-Kommentare sind Befunde, die Startzeile #! nicht", () => {
  const zeilen = ["#!/bin/sh", "# erklärt", 'echo "a" # hinten', "exit 0"];
  const erwartet = [
    ["# erklärt", "erklärt"],
    ['echo "a" # hinten', "hinten"],
  ];
  assert.deepEqual(gefunden("scripts/probe.sh", zeilen), erwartet);
  assert.deepEqual(gefunden(".githooks/pre-commit", zeilen), erwartet);
});

test("kommentare-yaml-shell: nur #!/bin/bash, #!/bin/sh und #!/usr/bin/env bash sind als Startzeile frei", () => {
  for (const startzeile of ["#!/bin/bash", "#!/bin/sh", "#!/usr/bin/env bash"]) {
    assert.deepEqual(gefunden("scripts/probe.sh", [startzeile, "echo hallo"]), []);
  }
  for (const startzeile of ["#!/usr/bin/env zsh", "#!/bin/bash -e # weil sonst nichts abbricht"]) {
    assert.deepEqual(gefunden("scripts/probe.sh", [startzeile, "echo hallo"]).length, 1, startzeile);
  }
});

test("kommentare-yaml-shell: eine andere Startzeile in einem Heredoc ist ein Befund", () => {
  const zeilen = [
    "jobs:",
    "  probe:",
    "    steps:",
    "      - name: Lauf",
    "        run: |",
    "          cat > lauf.py <<EOF",
    "          #!/usr/bin/env python3",
    "          print(1)",
    "          EOF",
  ];
  assert.deepEqual(gefunden(".github/workflows/probe.yml", zeilen), [
    ["#!/usr/bin/env python3", "!/usr/bin/env python3"],
  ]);
});

test("kommentare-yaml-shell: # in Zeichenketten, ${{ }}, URL-Ankern und Parametern ist kein Befund", () => {
  const yaml = [
    'titel: "eins # zwei"',
    "zweiter: 'drei # vier'",
    "wenn: ${{ github.event.issue.title == '# Fehler' }}",
    "seite: https://example.invalid/#anker",
    "kanal: '#allgemein'",
  ];
  assert.deepEqual(gefunden("render.yaml", yaml), []);
  const shell = [
    'echo "Wert # kein Kommentar"',
    "echo 'auch # keiner'",
    'echo "${#LISTE[@]} $# ${WERT##*/}"',
    'ZIEL="$(printf \'%s\' "$EINGABE" | sed -n \'s/.*"a":"\\([^"]*\\)".*/\\1/p\')"',
    "# danach wieder ein Kommentar",
  ];
  assert.deepEqual(gefunden("scripts/probe.sh", shell), [
    ["# danach wieder ein Kommentar", "danach wieder ein Kommentar"],
  ]);
});

test("kommentare-yaml-shell: der Inhalt von run-Blöcken wird als Shell geprüft, andere Blöcke nicht", () => {
  const zeilen = [
    "jobs:",
    "  probe:",
    "    steps:",
    "      - name: Lauf",
    "        run: |",
    "          set -eu",
    "          # im run-Block",
    '          cat > datei.sh <<EOF',
    "          #!/bin/sh",
    "          echo hallo",
    "          EOF",
    "      - name: Text",
    "        with:",
    "          body: |",
    "            # Überschrift im Text",
  ];
  assert.deepEqual(gefunden(".github/workflows/probe.yml", zeilen), [
    ["# im run-Block", "im run-Block"],
  ]);
});

function pruefen(directory, werkzeug = SCRIPT) {
  const run = spawnSync(process.execPath, [werkzeug], {
    cwd: directory,
    encoding: "utf8",
    env: isolatedEnvironment(),
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

test("kommentare-yaml-shell: von der Kommandozeile ist jeder Kommentar rot und ohne Kommentar ist es grün", (context) => {
  const directory = probeRepository(context, {
    ".github/workflows/probe.yml": "name: Probe\non: push\n",
    "scripts/lauf.sh": "#!/bin/sh\necho hallo\n",
    "notizen.txt": "# kein Shell\n",
  });
  const gruen = pruefen(directory);
  assert.equal(gruen.status, EXIT_OK, gruen.output);
  assert.match(gruen.output, /^0 neue Befunde von kommentare-yaml-shell\.$/m);
  writeFiles(directory, {
    ".github/workflows/probe.yml": "name: Probe\non: push # neuer Kommentar\n",
    "scripts/lauf.sh": "#!/bin/sh\n# Begründung\necho hallo\n",
  });
  commitAll(directory, "Kommentar");
  const rot = pruefen(directory);
  assert.equal(rot.status, EXIT_FINDING, rot.output);
  assert.match(rot.output, /^\.github\/workflows\/probe\.yml:2$/m);
  assert.match(rot.output, /^scripts\/lauf\.sh:2$/m);
  assert.match(rot.output, /^2 neue Befunde von kommentare-yaml-shell\.$/m);
  assert.doesNotMatch(rot.output, /Begründung|neuer Kommentar/);
});

test("kommentare-yaml-shell: über einen Symlink gestartet prüft das Werkzeug genauso", (context) => {
  const directory = probeRepository(context, {
    ".github/workflows/probe.yml": "name: Probe\n# Kommentar\non: push\n",
  });
  const verweis = join(probeDirectory(context, {}), "kommentare-yaml-shell.mjs");
  symlinkSync(SCRIPT, verweis);
  const rot = pruefen(directory, verweis);
  assert.equal(rot.status, EXIT_FINDING, rot.output);
  assert.match(rot.output, /^\.github\/workflows\/probe\.yml:2$/m);
});
