import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { uebernehme } from "../../scripts/elevenlabs-schluessel-uebernehmen.mjs";
import { elevenLabsSchluessel, SCHLUESSELBUND_HINWEIS } from "../../scripts/lib/schluesselbund.mjs";
import { SCHLUESSELBUND_ELEVENLABS_SCHLUESSEL as WERT } from "../gemeinsam/erfundene-geheimnisse.js";

const VARIABLE = "ELEVENLABS_API_KEY";
const HINWEIS = 'Schluesselbund (Dienst "elevenlabs")';
const UEBERNAHME = "npm run elevenlabs:uebernehmen";

function skriptLauf(skript, env) {
  return spawnSync(process.execPath, [skript, "--pruefen"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, NODE_ENV: "test", [VARIABLE]: "", ...env },
  });
}

function zaehler(antwort) {
  const aufrufe = [];
  const ausfuehren = (befehl, args) => {
    aufrufe.push([befehl, ...args]);
    if (antwort instanceof Error) throw antwort;
    return antwort;
  };
  return { aufrufe, ausfuehren };
}

test("Treffer unter darwin: der Wert ohne Zeilenumbruch ist der Schluessel", () => {
  const { aufrufe, ausfuehren } = zaehler(`${WERT}\n`);
  assert.equal(elevenLabsSchluessel("", { plattform: "darwin", ausfuehren }), WERT);
  assert.deepEqual(aufrufe, [["security", "find-generic-password", "-s", "elevenlabs", "-w"]]);
});

test("gesetzte Variable hat Vorrang und security wird nicht aufgerufen", () => {
  const { aufrufe, ausfuehren } = zaehler(WERT);
  assert.equal(elevenLabsSchluessel("aus-der-umgebung", { plattform: "darwin", ausfuehren }), "aus-der-umgebung");
  assert.equal(aufrufe.length, 0);
});

test("Wert aus Leerzeichen zaehlt als leer", () => {
  const { ausfuehren } = zaehler(WERT);
  assert.equal(elevenLabsSchluessel("   ", { plattform: "darwin", ausfuehren }), WERT);
});

test("Nicht-darwin: security wird nicht aufgerufen", () => {
  const { aufrufe, ausfuehren } = zaehler(WERT);
  assert.equal(elevenLabsSchluessel("", { plattform: "linux", ausfuehren }), "");
  assert.equal(aufrufe.length, 0);
});

test("kein Eintrag oder security fehlt: leer, kein Wurf, der Fehlertext traegt den Wert nicht", () => {
  for (const fehler of [Object.assign(new Error(`Exit 44 ${WERT}`), { status: 44 }), Object.assign(new Error("ENOENT"), { code: "ENOENT" })]) {
    const { ausfuehren } = zaehler(fehler);
    const geschrieben = [];
    const alt = [process.stdout.write, process.stderr.write];
    process.stdout.write = (text) => (geschrieben.push(String(text)), true);
    process.stderr.write = (text) => (geschrieben.push(String(text)), true);
    let wert;
    try {
      wert = elevenLabsSchluessel("", { plattform: "darwin", ausfuehren });
    } finally {
      [process.stdout.write, process.stderr.write] = alt;
    }
    assert.equal(wert, "");
    assert.equal(geschrieben.join(""), "");
  }
});

test("security wird mit Frist und ohne geerbten stderr aufgerufen", () => {
  let optionen;
  elevenLabsSchluessel("", { plattform: "darwin", ausfuehren: (_b, _a, o) => ((optionen = o), WERT) });
  assert.equal(optionen.encoding, "utf8");
  assert.equal(optionen.timeout, 5000);
  assert.deepEqual(optionen.stdio, ["ignore", "pipe", "ignore"]);
});

test("Treffer: der Hinweis nennt Quelle, Dienstnamen und Uebernahme-Befehl, keinen Wert", () => {
  assert.equal(SCHLUESSELBUND_HINWEIS.includes(HINWEIS), true);
  assert.equal(SCHLUESSELBUND_HINWEIS.includes(UEBERNAHME), true);
  assert.equal(SCHLUESSELBUND_HINWEIS.includes(WERT), false);
});

for (const skript of ["scripts/el-nummern-registrierung.mjs", "scripts/push-elevenlabs.mjs", "scripts/check-elevenlabs-drift.mjs"]) {
  test(`${skript}: ohne Schluessel nennt die Fehlermeldung Quelle, Dienstnamen und Uebernahme-Befehl`, () => {
    const lauf = skriptLauf(skript, { ELEVENLABS_AGENT_ID: "agent_x" });
    assert.notEqual(lauf.status, 0);
    const ausgabe = lauf.stderr + lauf.stdout;
    assert.equal(ausgabe.includes(HINWEIS) && ausgabe.includes(UEBERNAHME), true);
  });
}

function envDatei(inhalt) {
  const pfad = join(mkdtempSync(join(tmpdir(), "el-uebernehmen-")), ".env");
  writeFileSync(pfad, inhalt);
  return pfad;
}

function schluesselbundAttrappe({ schreibenSchlaegtFehl = false } = {}) {
  const aufrufe = [];
  let gespeichert = "";
  const ausfuehren = (befehl, args) => {
    aufrufe.push([befehl, ...args]);
    if (args[0] === "add-generic-password") {
      if (schreibenSchlaegtFehl) throw Object.assign(new Error(`Command failed: ${args.join(" ")}`), { status: 45 });
      gespeichert = args[args.indexOf("-w") + 1];
      return "";
    }
    return `${gespeichert}\n`;
  };
  return { aufrufe, ausfuehren };
}

async function ausgabeAbfangen(lauf) {
  const geschrieben = [];
  const alt = [process.stdout.write, process.stderr.write];
  process.stdout.write = (text) => (geschrieben.push(String(text)), true);
  process.stderr.write = (text) => (geschrieben.push(String(text)), true);
  try {
    return { ergebnis: await lauf(), geschrieben: geschrieben.join("") };
  } finally {
    [process.stdout.write, process.stderr.write] = alt;
  }
}

test("Uebernahme: .env-Schluessel geht per -U in den Schluesselbund, API 200, Wert nirgends in Text oder Ausgabe", async () => {
  const { aufrufe, ausfuehren } = schluesselbundAttrappe();
  const gesehen = [];
  const abruf = async (adresse, optionen) => (gesehen.push([adresse, optionen.headers["xi-api-key"]]), { status: 200 });
  const { ergebnis, geschrieben } = await ausgabeAbfangen(() =>
    uebernehme({ envPfad: envDatei(`${VARIABLE}=${WERT}\n`), plattform: "darwin", ausfuehren, abruf }),
  );
  assert.equal(ergebnis.code, 0);
  assert.equal(aufrufe[0].slice(0, 3).join(" "), "security add-generic-password -U");
  assert.deepEqual(gesehen, [["https://api.elevenlabs.io/v1/convai/agents", WERT]]);
  assert.equal(ergebnis.text.includes(WERT), false);
  assert.equal(geschrieben, "");
});

test("Uebernahme: leere .env, Schreibfehler und API-Fehler brechen ab, ohne den Wert zu nennen", async () => {
  const leer = await uebernehme({
    envPfad: envDatei(`${VARIABLE}=\n`),
    plattform: "darwin",
    ausfuehren: schluesselbundAttrappe().ausfuehren,
  });
  const schreibfehler = await uebernehme({
    envPfad: envDatei(`${VARIABLE}=${WERT}\n`),
    plattform: "darwin",
    ausfuehren: schluesselbundAttrappe({ schreibenSchlaegtFehl: true }).ausfuehren,
  });
  const abgelehnt = await uebernehme({
    envPfad: envDatei(`${VARIABLE}=${WERT}\n`),
    plattform: "darwin",
    ausfuehren: schluesselbundAttrappe().ausfuehren,
    abruf: async () => ({ status: 401 }),
  });
  for (const ergebnis of [leer, schreibfehler, abgelehnt]) {
    assert.equal(ergebnis.code, 1);
    assert.equal(ergebnis.text.includes(WERT), false);
  }
  assert.match(abgelehnt.text, /HTTP 401/);
});

test("Uebernahme ausserhalb von macOS bricht ab, ohne security aufzurufen", async () => {
  const { aufrufe, ausfuehren } = schluesselbundAttrappe();
  const ergebnis = await uebernehme({ envPfad: envDatei(`${VARIABLE}=${WERT}\n`), plattform: "linux", ausfuehren });
  assert.equal(ergebnis.code, 1);
  assert.equal(aufrufe.length, 0);
});
