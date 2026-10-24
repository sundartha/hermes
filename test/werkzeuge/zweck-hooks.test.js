import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { kenntZweck, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { gelesen } from "../../tools/syntaxbaum.mjs";
import { BLOCKING_EXIT_CODE, HOOKS_DIRECTORY, REPO_ROOT, hookScript, probeDirectory, runHook } from "./probe-repo.js";

const TEXTE = JSON.parse(readFileSync(join(REPO_ROOT, "tools/zweck/hooks.json"), "utf8"));
const PRAEFIX = "hooks/";
const EINSTELLUNGEN = [".claude/settings.json", ...readdirSync(join(REPO_ROOT, ".claude/rollen")).map((name) => `.claude/rollen/${name}`)];
const GIT_HOOKS = readdirSync(join(REPO_ROOT, ".githooks")).map((name) => `.githooks/${name}`);
const ZEIGEN_AUFRUF = /zweck-zeigen\.mjs((?: [a-z]+\/[a-z-]+)+)/g;
const SPERRENDER_EXIT = /\bexit [1-9]/;
const LOKALER_IMPORT = /^\.\/[\w-]+\.mjs$/;
const MODUL = { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: {} };
const LANGE_DATEI = 1500;
const PROZESS_NAMEN = new Set(["exit", "exitCode", "abort", "kill"]);
const PROZESS_MODULE = new Set(["node:process", "process"]);
const ANTWORT_SCHLUESSEL = new Set(["decision", "permissionDecision"]);

function gelesenAlsJson(pfad) {
  return JSON.parse(readFileSync(join(REPO_ROOT, pfad), "utf8"));
}

function eingetrageneSkripte() {
  const befehle = EINSTELLUNGEN.flatMap((pfad) =>
    Object.values(gelesenAlsJson(pfad).hooks ?? {})
      .flat()
      .flatMap(({ hooks }) => hooks.map(({ command }) => command)),
  );
  return [...new Set(befehle.map(hookScript))];
}

function knoten(baum) {
  const gefunden = [];
  const offen = [baum];
  while (offen.length > 0) {
    const eintrag = offen.pop();
    if (eintrag === null || typeof eintrag !== "object") continue;
    if (typeof eintrag.type === "string") gefunden.push(eintrag);
    offen.push(...Object.values(eintrag));
  }
  return gefunden;
}

function baumVon(skript) {
  return gelesen(readFileSync(join(HOOKS_DIRECTORY, skript), "utf8"), MODUL);
}

function blockAufrufe(skript) {
  return knoten(baumVon(skript)).filter(({ type, callee }) => type === "CallExpression" && callee.type === "Identifier" && callee.name === "block");
}

function lokaleImporte(skript) {
  const quellen = baumVon(skript)
    .body.filter(({ type }) => type === "ImportDeclaration")
    .map(({ source }) => source.value);
  return quellen.filter((quelle) => LOKALER_IMPORT.test(quelle)).map((quelle) => quelle.slice("./".length));
}

function erreichbareSkripte(skript, gesehen = new Set()) {
  if (gesehen.has(skript)) return gesehen;
  gesehen.add(skript);
  for (const importiert of lokaleImporte(skript)) erreichbareSkripte(importiert, gesehen);
  return gesehen;
}

function hookSkripte() {
  return readdirSync(HOOKS_DIRECTORY).filter((name) => name.endsWith(".mjs"));
}

function blockIds(skript) {
  return blockAufrufe(skript).map(({ arguments: [erstes] }) => (erstes?.type === "Literal" ? erstes.value : undefined));
}

function idsAusGitHooks() {
  return GIT_HOOKS.flatMap((pfad) =>
    [...readFileSync(join(REPO_ROOT, pfad), "utf8").matchAll(ZEIGEN_AUFRUF)].flatMap((treffer) => treffer[1].trim().split(" ")),
  );
}

test("jeder block-Aufruf unter .claude/hooks/ nennt als erstes Argument eine feste ID mit Zweck-Text", () => {
  const ids = hookSkripte().flatMap(blockIds);
  assert.ok(ids.length > 0);
  for (const id of ids) {
    assert.equal(typeof id, "string", "block braucht als erstes Argument eine feste Zeichenkette");
    assert.ok(id.startsWith(PRAEFIX), id);
    assert.ok(kenntZweck(id), `${id} hat keinen Zweck-Text`);
  }
});

test("jeder Hook aus .claude/settings.json und .claude/rollen/ sperrt nur über block mit ID oder sperrt gar nicht", () => {
  for (const skript of eingetrageneSkripte()) {
    if (skript.endsWith(".sh")) {
      assert.doesNotMatch(readFileSync(join(HOOKS_DIRECTORY, skript), "utf8"), SPERRENDER_EXIT, skript);
      continue;
    }
    const ids = [...erreichbareSkripte(skript)].flatMap(blockIds);
    assert.ok(ids.length > 0, `${skript} sperrt ohne block mit ID`);
  }
});

function istProzess(eintrag) {
  return eintrag?.type === "Identifier" && eintrag.name === "process";
}

function schluesselName(eintrag) {
  return eintrag?.name ?? eintrag?.value;
}

function zugriffsNamen(eintrag) {
  if (eintrag.type === "MemberExpression" && istProzess(eintrag.object)) return [schluesselName(eintrag.property)];
  if (eintrag.type === "VariableDeclarator" && istProzess(eintrag.init) && eintrag.id.type === "ObjectPattern") {
    return eintrag.id.properties.map(({ key }) => schluesselName(key));
  }
  if (eintrag.type === "ImportDeclaration" && PROZESS_MODULE.has(eintrag.source.value)) {
    return eintrag.specifiers.map(({ imported }) => schluesselName(imported));
  }
  return [];
}

function sperrstellen(knotenListe) {
  return knotenListe.flatMap((eintrag) => {
    const prozess = zugriffsNamen(eintrag).filter((name) => PROZESS_NAMEN.has(name));
    const antwort = eintrag.type === "Property" && ANTWORT_SCHLUESSEL.has(schluesselName(eintrag.key));
    return antwort ? [...prozess, schluesselName(eintrag.key)] : prozess;
  });
}

function istBlockFunktion(eintrag) {
  const funktion = eintrag.type === "ExportNamedDeclaration" ? eintrag.declaration : undefined;
  return funktion?.type === "FunctionDeclaration" && funktion.id.name === "block";
}

function sperrstellenAusserhalbBlock(skript) {
  return sperrstellen(knoten(baumVon(skript).body.filter((eintrag) => !istBlockFunktion(eintrag))));
}

test("kein Hook unter .claude/hooks/ setzt einen Exit-Code oder eine Sperr-Antwort an block vorbei", () => {
  assert.ok(baumVon("lib.mjs").body.some(istBlockFunktion), "lib.mjs exportiert block");
  assert.deepEqual(sperrstellen(knoten(baumVon("lib.mjs").body.find(istBlockFunktion))), ["exit"]);
  for (const skript of hookSkripte()) {
    assert.deepEqual(sperrstellenAusserhalbBlock(skript), [], `${skript} beendet sich oder sperrt an block vorbei`);
  }
});

test("jede ID, die ein Git-Hook an zweck-zeigen gibt, hat einen Text, und tools/zweck/hooks.json hat keine ID ohne Nutzer", () => {
  const ausGit = idsAusGitHooks();
  for (const id of ausGit) assert.ok(kenntZweck(id), `${id} hat keinen Zweck-Text`);
  const genutzt = new Set([...hookSkripte().flatMap(blockIds), ...ausGit]);
  assert.deepEqual(Object.keys(TEXTE).filter((id) => !genutzt.has(id)), []);
});

test("ein sperrender Hook schreibt nach seinen Zeilen den Zweck-Block seiner ID", (context) => {
  const verzeichnis = probeDirectory(context, { "lang.txt": `${"zeile\n".repeat(LANGE_DATEI)}` });
  const datei = join(verzeichnis, "lang.txt");
  const lauf = runHook("lesesperre.mjs", { cwd: verzeichnis, input: { tool_input: { file_path: datei } } });
  assert.equal(lauf.status, BLOCKING_EXIT_CODE);
  const zeilen = lauf.stderr.trimEnd().split("\n");
  assert.match(zeilen[0], /lang\.txt hat \d+ Zeilen/);
  assert.deepEqual(zeilen.slice(-zweckBlock("hooks/lesesperre").length), zweckBlock("hooks/lesesperre"));
});

test("lint-datei zeigt nach den Befunden den Block der Regelgruppe und danach den Block des Hooks", (context) => {
  const verzeichnis = probeDirectory(context, {
    "eslint.config.js": 'export default [{ rules: { "no-debugger": "error" } }];\n',
    "fehler.js": "debugger;\ndebugger;\n",
  });
  const eslint = createRequire(join(REPO_ROOT, "package.json")).resolve("eslint/package.json");
  mkdirSync(join(verzeichnis, "node_modules"));
  symlinkSync(dirname(eslint), join(verzeichnis, "node_modules/eslint"));
  const lauf = runHook("lint-datei.mjs", { cwd: verzeichnis, input: { tool_input: { file_path: join(verzeichnis, "fehler.js") } } });
  assert.equal(lauf.status, BLOCKING_EXIT_CODE);
  const erwartet = ["Zu no-debugger (lint/fehlermuster):", ...zweckBlock("lint/fehlermuster"), ...zweckBlock("hooks/lint-datei")];
  const zeilen = lauf.stderr.trimEnd().split("\n");
  assert.match(zeilen[0], /^Lint: 2 Befunde/);
  assert.deepEqual(zeilen.slice(-erwartet.length), erwartet);
});
