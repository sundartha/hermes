import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import { ohneZweck, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { REPO_ROOT, outputLines, probeDirectory, runIn, writeFiles } from "./probe-repo.js";
import { dateienMitEndung, nurGenutzteIds, quelltext } from "./zweck-quellen.js";

const BEREICH = "uebrige";
const PRUEFWERKZEUG = /^(tools\/[a-z-]+-(?:pruefen|vergleich|alter)\.mjs|scripts\/check-[a-z-]+\.m?js)$/;
const NENNT_ZWECK = /\bzweckBlock\b|\bbefundeMeldenUndScheitern\(|\bbefundeMitPraefixMeldenUndScheitern\(/;
const OHNE_BLOCK = new Map([
  ["tools/soll-vergleich.mjs", "U12: Leser ist Antonio im Issue „Soll-Vergleich oder Rot-Proben rot“, kein Agent kann Einstellungen oder Soll ändern"],
  ["scripts/check-setup.js", "Einrichtungshilfe von npm run check, kein Pflicht-Check und kein Urteil über eine Änderung"],
]);
const NPM_PRUEFSKRIPTE = ["check:tokens", "elevenlabs:check", "elevenlabs:drift"];
const SKRIPT_DATEI = /^node (\S+)$/;
const EXIT_BEFUND = 1;
const TELNYX_DATEI = "src/telephony/adapters/telnyx/voice.js";
const ROUTEN_DATEI = "src/routes/voice.js";
const DATENSCHUTZ_DATEI = "apps/web/src/data/legal/privacy.de.json";
const TSCONFIG = "tsconfig.json";
const TSCONFIG_WERKZEUG = join(REPO_ROOT, "tools/tsconfig-pruefen.mjs");
const FUNKTIONSKARTE = join(REPO_ROOT, "tools/funktionskarte.mjs");

function tsconfigMit(strict) {
  return `${JSON.stringify({ compilerOptions: { noEmit: true, allowJs: true, strict }, include: ["src"] })}\n`;
}

function blockAmEnde(text, id) {
  const block = zweckBlock(id);
  const zeilen = outputLines(text);
  assert.deepEqual(zeilen.slice(-block.length), block, text);
  return zeilen.slice(0, -block.length);
}

function nachDenBefunden(lauf, id) {
  blockAmEnde(lauf.stderr, id);
  return ohneZweck(outputLines(lauf.stderr));
}

test("tools/zweck/uebrige.json hat genau die IDs, die Werkzeuge und Workflow-Schritte nennen", () => {
  nurGenutzteIds(BEREICH);
});

test("jedes Prüfwerkzeug unter tools/ und scripts/ nennt bei Rot einen Zweck-Block oder steht mit Grund in der Liste ohne Block", () => {
  const werkzeuge = [...dateienMitEndung("tools", [".mjs"]), ...dateienMitEndung("scripts", [".js", ".mjs"])].filter((pfad) => PRUEFWERKZEUG.test(pfad));
  assert.ok(werkzeuge.length > OHNE_BLOCK.size);
  const ohne = werkzeuge.filter((pfad) => !NENNT_ZWECK.test(quelltext(pfad)) && !OHNE_BLOCK.has(pfad));
  assert.deepEqual(ohne, []);
  for (const pfad of OHNE_BLOCK.keys()) assert.ok(werkzeuge.includes(pfad) && !NENNT_ZWECK.test(quelltext(pfad)), `${pfad} steht ohne Grund in der Liste`);
});

test("jedes npm-Skript der übrigen Prüfungen ruft ein Werkzeug mit Zweck-Text aus tools/zweck/uebrige.json", () => {
  const skripte = JSON.parse(quelltext("package.json")).scripts;
  for (const name of NPM_PRUEFSKRIPTE) {
    const [, datei] = SKRIPT_DATEI.exec(skripte[name]) ?? [];
    assert.ok(datei, `${name}: ${skripte[name]}`);
    assert.match(quelltext(datei), /"uebrige\/[a-z-]+"/, name);
  }
});

test("Geheimnisse in Logs nennt nach den Befunden auf stdout den Block auf stderr", (context) => {
  const wurzel = probeDirectory(context, { [TELNYX_DATEI]: "console.error(req.headers.authorization);\n", [ROUTEN_DATEI]: 'console.log("Anruf");\n' });
  const lauf = runIn(REPO_ROOT, process.execPath, [join(REPO_ROOT, "tools/log-geheimnisse-pruefen.mjs"), "--wurzel", wurzel]);
  assert.equal(lauf.status, EXIT_BEFUND, lauf.stdout + lauf.stderr);
  assert.ok(outputLines(lauf.stdout).every((zeile) => zeile.startsWith(`${TELNYX_DATEI}:1 `)), lauf.stdout);
  assert.deepEqual(nachDenBefunden(lauf, "uebrige/log-geheimnisse"), []);
});

test("Anbieter im Datenschutz nennt nach den Befunden den Block auf stderr, ein grüner Lauf keinen", (context) => {
  const text = (name) => JSON.stringify({ sections: [{ heading: "Empfaenger", text: `Wir nutzen ${name}.` }] });
  const pruefe = (name) => {
    const wurzel = probeDirectory(context, { [DATENSCHUTZ_DATEI]: text(name), "src/llm/adapters/anthropic.js": "export const a = 1;\n", "src/research/adapters/exa-search.js": "export const b = 1;\n" });
    return runIn(REPO_ROOT, process.execPath, [join(REPO_ROOT, "tools/anbieter-datenschutz-pruefen.mjs"), "--wurzel", wurzel]);
  };
  const rot = pruefe("Anthropic");
  assert.equal(rot.status, EXIT_BEFUND, rot.stdout + rot.stderr);
  assert.match(rot.stdout, /Anbieter Exa fehlt in /);
  nachDenBefunden(rot, "uebrige/anbieter-datenschutz");
  const gruen = pruefe("Anthropic und Exa");
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
  assert.doesNotMatch(`${gruen.stdout}${gruen.stderr}`, /Wozu:/);
});

test("die TypeScript-Konfiguration nennt nach den Befunden auf stderr den Block auf stdout, ein unveränderter Stand nichts", (context) => {
  const wurzel = probeDirectory(context, { [TSCONFIG]: tsconfigMit(true), "src/a.js": "export const a = 1;\n", "tools/basis/.keep": "" });
  const pruefe = (...optionen) => runIn(wurzel, process.execPath, [TSCONFIG_WERKZEUG, ...optionen, wurzel]);
  assert.equal(pruefe("--basis-schreiben").status, 0);
  const gruen = pruefe();
  assert.equal(gruen.status, 0, gruen.stdout + gruen.stderr);
  assert.equal(`${gruen.stdout}${gruen.stderr}`, "");
  writeFiles(wurzel, { [TSCONFIG]: tsconfigMit(false) });
  const rot = pruefe();
  assert.equal(rot.status, EXIT_BEFUND, rot.stdout + rot.stderr);
  assert.deepEqual(blockAmEnde(rot.stdout, "uebrige/tsconfig"), []);
  assert.match(rot.stderr, /^tsconfig\.json: compilerOptions\.strict ist false, die Kopie sagt true$/m);
});

test("die Funktionskarte nennt bei einer Fläche ohne Karte nach der Zusammenfassung den Block auf stdout, ein sauberer Lauf keinen", (context) => {
  const wurzel = probeDirectory(context, { "ohne-karte.json": JSON.stringify([{ art: "Werkzeug", flaeche: "get_agent_number" }]), "leer.json": "[]" });
  const pruefe = (datei) => runIn(wurzel, process.execPath, [FUNKTIONSKARTE, "pruefen", "--flaechen-datei", datei]);
  const rot = pruefe("ohne-karte.json");
  assert.equal(rot.status, EXIT_BEFUND, rot.stdout + rot.stderr);
  assert.equal(blockAmEnde(rot.stdout, "uebrige/funktionskarte").at(-1), "Funktionskarte: rot, 1 Befunde.");
  assert.match(rot.stderr, /^get_agent_number hat keine Funktionskarte unter docs\/funktionen\/\.$/m);
  const sauber = pruefe("leer.json");
  assert.equal(sauber.status, 0, sauber.stdout + sauber.stderr);
  assert.doesNotMatch(sauber.stdout, /Wozu:/);
});

test("die Schritte Secret-Scan und Commit-Prüfung zeigen bei Rot ihren Block", () => {
  const ci = quelltext(".github/workflows/ci.yml");
  for (const [schritt, id, ziel] of [
    ["Secret-Scan", "secretscan", "uebrige/secret-scan"],
    ["Commit-Prüfung", "commitpruefung", "uebrige/commit-pruefung"],
  ]) {
    assert.match(ci, new RegExp(`- name: ${schritt}\\n {8}id: ${id}\\n`), schritt);
    assert.match(ci, new RegExp(`if: failure\\(\\) && steps\\.${id}\\.outcome == 'failure'\\n {8}run: node tools/zweck-zeigen\\.mjs ${ziel}\\n`), schritt);
  }
});
