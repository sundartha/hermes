import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { neuerTempOrdner } from "../gemeinsam/temp-ordner.mjs";

const WURZEL = fileURLToPath(new URL("../..", import.meta.url));
const LISTE = "tools/geheimnisse.json";
const SKRIPTE = /\.(mjs|js|sh)$/;
const NAME = "[A-Z][A-Z0-9_]*";

function dateien(wurzel, ordner, endung) {
  let eintraege;
  try {
    eintraege = readdirSync(join(wurzel, ordner), { withFileTypes: true, recursive: true });
  } catch {
    return [];
  }
  return eintraege
    .filter((e) => e.isFile() && endung.test(e.name))
    .map((e) => relative(wurzel, join(e.parentPath, e.name)));
}

function namen(text, muster) {
  return [...text.matchAll(muster)].map((treffer) => treffer[1]);
}

function listeLesen(wurzel) {
  try {
    return JSON.parse(readFileSync(join(wurzel, LISTE), "utf8"));
  } catch {
    return null;
  }
}

function workflowNamen(text) {
  return [
    ["secrets", namen(text, new RegExp(`\\bsecrets\\.(${NAME})`, "g"))],
    ["vars", namen(text, new RegExp(`\\bvars\\.(${NAME})`, "g"))],
    ["umgebung", namen(text, /^\s+(STAGING_[A-Z0-9_]+):/gm)],
  ];
}

function skriptNamen(text, datei) {
  const gefunden = [
    ["umgebung", namen(text, /\benv\.(STAGING_[A-Z0-9_]+)/g)],
    ["umgebung", namen(text, /["'](STAGING_[A-Z0-9_]+)["']/g)],
  ];
  if (datei.startsWith("scripts/anruf-probe/"))
    gefunden.push(["anrufprobe", namen(text, new RegExp(`\\benv\\.(${NAME})`, "g"))]);
  return gefunden;
}

function erlaubt(liste, art) {
  if (art !== "umgebung") return new Set(liste[art]);
  return new Set([...liste.secrets, ...liste.vars, ...liste.umgebung]);
}

function pruefe(wurzel) {
  const liste = listeLesen(wurzel);
  if (liste === null) return [`${LISTE}: Namensliste fehlt oder ist nicht lesbar`];
  const quellen = [
    ...dateien(wurzel, ".github/workflows", /\.ya?ml$/).map((datei) => [datei, workflowNamen]),
    ...dateien(wurzel, "scripts", SKRIPTE).map((datei) => [datei, skriptNamen]),
  ];
  return quellen.flatMap(([datei, lesen]) => {
    const gefunden = lesen(readFileSync(join(wurzel, datei), "utf8"), datei);
    return gefunden.flatMap(([art, treffer]) =>
      treffer
        .filter((name) => !erlaubt(liste, art).has(name))
        .map((name) => `${datei}: ${name} steht nicht in ${LISTE}`),
    );
  });
}

function probeRepo(dateiInhalte) {
  const wurzel = neuerTempOrdner();
  const alle = { [LISTE]: readFileSync(join(WURZEL, LISTE), "utf8"), ...dateiInhalte };
  for (const [pfad, inhalt] of Object.entries(alle)) {
    if (inhalt === null) continue;
    mkdirSync(dirname(join(wurzel, pfad)), { recursive: true });
    writeFileSync(join(wurzel, pfad), inhalt);
  }
  return wurzel;
}

test("Alle Geheimnis-Namen in Workflows und Skripten stehen in tools/geheimnisse.json", () => {
  assert.deepEqual(pruefe(WURZEL), []);
});

test("Fehlt tools/geheimnisse.json, meldet die Prüfung die Datei", () => {
  const wurzel = probeRepo({ [LISTE]: null });
  assert.deepEqual(pruefe(wurzel), [`${LISTE}: Namensliste fehlt oder ist nicht lesbar`]);
});

test("Ein unbekanntes secrets.X im Workflow nennt Datei und Namen", () => {
  const wurzel = probeRepo({
    ".github/workflows/a.yml": "env:\n  X: ${{ secrets.UNBEKANNT_TOKEN }}\n",
  });
  assert.deepEqual(pruefe(wurzel), [
    `.github/workflows/a.yml: UNBEKANNT_TOKEN steht nicht in ${LISTE}`,
  ]);
});

test("Ein secrets.X, das nur als Variable gelistet ist, wird gemeldet", () => {
  const wurzel = probeRepo({
    ".github/workflows/a.yml": "env:\n  X: ${{ secrets.STAGING_PROBE_ZIEL }}\n",
  });
  assert.deepEqual(pruefe(wurzel), [
    `.github/workflows/a.yml: STAGING_PROBE_ZIEL steht nicht in ${LISTE}`,
  ]);
});

test("Ein unbekanntes vars.X im Workflow nennt Datei und Namen", () => {
  const wurzel = probeRepo({
    ".github/workflows/a.yml": "env:\n  X: ${{ vars.STAGING_PROBE_TOKEN }}\n",
  });
  assert.deepEqual(pruefe(wurzel), [
    `.github/workflows/a.yml: STAGING_PROBE_TOKEN steht nicht in ${LISTE}`,
  ]);
});

test("Ein unbekannter STAGING_-Schlüssel im Workflow-Schritt wird gemeldet", () => {
  const wurzel = probeRepo({ ".github/workflows/a.yml": "    env:\n      STAGING_VERALTET: ok\n" });
  assert.deepEqual(pruefe(wurzel), [
    `.github/workflows/a.yml: STAGING_VERALTET steht nicht in ${LISTE}`,
  ]);
});

test("Rotprobe: Alter Name STAGING_TEST_TOKEN in probe.mjs wird gemeldet", () => {
  const wurzel = probeRepo({
    "scripts/anruf-probe/probe.mjs": "const t = env.STAGING_TEST_TOKEN;\n",
  });
  assert.deepEqual(pruefe(wurzel), [
    `scripts/anruf-probe/probe.mjs: STAGING_TEST_TOKEN steht nicht in ${LISTE}`,
  ]);
});

test("Ein unbekannter env.X der Anrufprobe wird gemeldet, ein bekannter nicht", () => {
  const wurzel = probeRepo({
    "scripts/anruf-probe/anrufer.mjs": "const a = env.STAGING_URL;\nconst b = env.ZUFALL_NAME;\n",
  });
  assert.deepEqual(pruefe(wurzel), [
    `scripts/anruf-probe/anrufer.mjs: ZUFALL_NAME steht nicht in ${LISTE}`,
  ]);
});

test("Ein env.X außerhalb der Anrufprobe ohne STAGING_-Vorsilbe bleibt unbeachtet", () => {
  const wurzel = probeRepo({ "scripts/anderes.mjs": "const a = env.ZUFALL_NAME;\n" });
  assert.deepEqual(pruefe(wurzel), []);
});

test("Ein in Anführungszeichen genannter STAGING_-Name im Skript wird geprüft", () => {
  const wurzel = probeRepo({
    "scripts/last/x.mjs":
      'const a = { t: "STAGING_VERALTET_TOKEN" };\nconst b = "STAGING_TEST_TOKEN";\n',
  });
  assert.deepEqual(pruefe(wurzel), [
    `scripts/last/x.mjs: STAGING_VERALTET_TOKEN steht nicht in ${LISTE}`,
  ]);
});
