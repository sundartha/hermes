import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";

import { freigabeBefunde } from "../../tools/freigabe.mjs";

const WURZEL = resolve(import.meta.dirname, "../..");
const FREIGABE = join(WURZEL, "tools/freigabe.mjs");

const KOPF = "a".repeat(40);
const ALTER_STAND = "b".repeat(40);
const BAU_AGENT = { login: "sundartha-agent[bot]" };
const MENSCH = { login: "Antonio20045" };
const PRUEFUNGSDATEI = [{ status: "M", pfad: ".github/workflows/ci.yml" }];
const PRODUKTCODE = [{ status: "M", pfad: "src/server.js" }];

function pull(autor) {
  return { head: { sha: KOPF }, user: autor };
}

function approve(stand) {
  return { user: MENSCH, state: "APPROVED", commit_id: stand };
}

test("SG-21 Änderung an einer Prüfung ohne Freigabe wird gestoppt", () => {
  const ohneUrteil = freigabeBefunde(pull(BAU_AGENT), [], PRUEFUNGSDATEI);
  assert.equal(ohneUrteil.length, 1);
  assert.match(ohneUrteil[0], /Es fehlt das KI-Urteil/);
  const veraltet = freigabeBefunde(pull(BAU_AGENT), [approve(ALTER_STAND)], PRUEFUNGSDATEI);
  assert.equal(veraltet.length, 1);
  assert.deepEqual(freigabeBefunde(pull(BAU_AGENT), [approve(KOPF)], PRUEFUNGSDATEI), []);
});

test("SG-21 Code unter src/ von jemand anderem als dem Bau-Agenten wird gestoppt, auch mit Freigabe", () => {
  const vomMenschen = freigabeBefunde(pull(MENSCH), [approve(KOPF)], PRODUKTCODE);
  assert.equal(vomMenschen.length, 1);
  assert.match(vomMenschen[0], /nur vom Bau-Agenten/);
  assert.deepEqual(freigabeBefunde(pull(BAU_AGENT), [approve(KOPF)], PRODUKTCODE), []);
});

test("SG-21 eine spätere Ablehnung hebt eine frühere Freigabe auf", () => {
  const abgelehnt = { user: MENSCH, state: "CHANGES_REQUESTED", commit_id: KOPF };
  assert.equal(freigabeBefunde(pull(BAU_AGENT), [approve(KOPF), abgelehnt], PRUEFUNGSDATEI).length, 1);
});

function gitUmgebung() {
  const umgebung = { ...process.env };
  for (const name of Object.keys(umgebung)) if (name.startsWith("GIT_")) delete umgebung[name];
  return umgebung;
}

function git(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: gitUmgebung(), encoding: "utf8" }).trim();
}

function schreibe(ordner, dateien) {
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
    writeFileSync(join(ordner, pfad), inhalt);
  }
}

function schrankeLauf(branch, vorher, { nachher, neu = [] }) {
  const ordner = mkdtempSync(join(tmpdir(), "schranke-"));
  try {
    git(ordner, "init", "-q");
    schreibe(ordner, { ".gitignore": "\n", ...vorher });
    git(ordner, "add", "--", ".");
    git(ordner, "commit", "-q", "-m", "basis");
    const basis = git(ordner, "rev-parse", "HEAD");
    schreibe(ordner, nachher);
    if (neu.length > 0) git(ordner, "add", "--", ...neu);
    const ergebnis = spawnSync("node", [FREIGABE, "schranke", branch, basis], { cwd: ordner, env: gitUmgebung(), encoding: "utf8" });
    return { gruen: ergebnis.status === 0, text: ergebnis.stdout };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

test("SG-26 Schranke für Prüfregeln: paket/* mit neuer Datei und passendem Eintrag in tools/bausteine.json bleibt grün", () => {
  const bausteine = (quellenB) => JSON.stringify({ bausteine: [{ baustein: "kern", quellen: ["src/a.js", ...quellenB] }] });
  const lauf = schrankeLauf(
    "paket/neue-datei",
    { "tools/bausteine.json": bausteine([]), "src/a.js": "module.exports = {};\n" },
    { nachher: { "tools/bausteine.json": bausteine(["src/b.js"]), "src/b.js": "module.exports = {};\n" }, neu: ["src/b.js"] },
  );
  assert.equal(lauf.gruen, true, lauf.text);
});

test("SG-26 Schranke für Prüfregeln: paket/* mit geändertem Bestand in tools/bausteine.json wird rot", () => {
  const lauf = schrankeLauf(
    "paket/bestand-geaendert",
    { "tools/bausteine.json": JSON.stringify({ bausteine: [{ baustein: "kern", quellen: ["src/a.js"] }] }), "src/a.js": "module.exports = {};\n" },
    { nachher: { "tools/bausteine.json": JSON.stringify({ bausteine: [{ baustein: "anderer", quellen: ["src/a.js"] }] }) } },
  );
  assert.equal(lauf.gruen, false);
  assert.match(lauf.text, /tools\/bausteine\.json/);
});

test("SG-27 Schranke für Prüfregeln: paket/* darf tools/bereiche.json nicht ändern", () => {
  const lauf = schrankeLauf(
    "paket/lockerung-versuch",
    { "tools/bereiche.json": JSON.stringify([{ bereich: "anrufe", eingaenge: [], fachlogik: [] }]) },
    { nachher: { "tools/bereiche.json": JSON.stringify([{ bereich: "anrufe", eingaenge: [], fachlogik: ["store"] }]) } },
  );
  assert.equal(lauf.gruen, false);
  assert.match(lauf.text, /tools\/bereiche\.json/);
});

test("SG-27 Schranke für Prüfregeln gilt nicht auf system/*", () => {
  const lauf = schrankeLauf(
    "system/absichtlich",
    { "tools/bereiche.json": JSON.stringify([{ bereich: "anrufe", eingaenge: [], fachlogik: [] }]) },
    { nachher: { "tools/bereiche.json": JSON.stringify([{ bereich: "anrufe", eingaenge: [], fachlogik: ["store"] }]) } },
  );
  assert.equal(lauf.gruen, true, lauf.text);
});

test("SG-27 Schranke für Prüfregeln: paket/* darf eslint-suppressions.json nur verkleinern", () => {
  const suppressions = (anzahl) => JSON.stringify({ "src/a.js": { "no-x": { count: anzahl } } });
  const sinkt = schrankeLauf(
    "paket/suppressions-sinken",
    { "eslint-suppressions.json": suppressions(2) },
    { nachher: { "eslint-suppressions.json": suppressions(1) } },
  );
  assert.equal(sinkt.gruen, true, sinkt.text);
  const waechst = schrankeLauf(
    "paket/suppressions-wachsen",
    { "eslint-suppressions.json": suppressions(1) },
    { nachher: { "eslint-suppressions.json": suppressions(2) } },
  );
  assert.equal(waechst.gruen, false);
  assert.match(waechst.text, /eslint-suppressions\.json/);
});
