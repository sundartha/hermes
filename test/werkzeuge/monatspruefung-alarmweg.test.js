import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { ausgabeAnlegen } from "../../tools/deploy-weg/ausgabe.mjs";
import { monatspruefung } from "../../tools/deploy-weg/hoertest.mjs";

const WORKFLOW = readFileSync(new URL("../../.github/workflows/staging.yml", import.meta.url), "utf8");
const MONATSERSTER = Date.parse("2026-12-01T02:17:00Z");
const SCHRITT_MS = 7;
const UHR_FESTLEGEN = new URL("../helpers/uhr-festlegen.mjs", import.meta.url).href;
const server = [];

after(() => {
  for (const eintrag of server) eintrag.close();
});

function dienstStarten(antwort) {
  const empfangen = [];
  const dienst = createServer((anfrage, rueckgabe) => {
    let koerper = "";
    anfrage.on("data", (stueck) => (koerper += stueck));
    anfrage.on("end", () => {
      empfangen.push(JSON.parse(koerper).text);
      rueckgabe.writeHead(antwort);
      rueckgabe.end();
    });
  });
  server.push(dienst);
  return new Promise((fertig) =>
    dienst.listen(0, "127.0.0.1", () => fertig({ port: dienst.address().port, empfangen })),
  );
}

function uhrBei(start) {
  let aufrufe = 0;
  return { jetzt: () => start + SCHRITT_MS * aufrufe++ };
}

async function pruefen({ start = MONATSERSTER, antwort = 200, mitSlack = true, schichten, zusammenfassung = null } = {}) {
  const { port, empfangen } = await dienstStarten(antwort);
  const zeilen = [];
  const einstellungen = {
    slackUrl: mitSlack ? `http://127.0.0.1:${port}/geheim` : null,
    serverUrl: "https://github.com",
    repository: "sundartha/hermes",
    runId: "4242",
    schrittZusammenfassung: zusammenfassung,
  };
  const ok = await monatspruefung({
    einstellungen,
    ausgabe: ausgabeAnlegen((zeile) => zeilen.push(zeile)),
    uhr: uhrBei(start),
    ...(schichten === undefined ? {} : { schichten }),
  });
  return { ok, empfangen, zeilen };
}

test("Monatserster: je Schicht 1, 2a und 3 genau eine gekennzeichnete Probe im Slack und eine Zeile Zeit bis Alarm", async () => {
  const { ok, empfangen, zeilen } = await pruefen();
  assert.equal(ok, true);
  assert.equal(empfangen.length, 3);
  const erwartet = ["1", "2a", "3"];
  erwartet.forEach((schicht, i) => {
    assert.match(empfangen[i], new RegExp(`^Probe, kein echter Fehler \\(Prüfung der Prüfung, Schicht ${schicht} `));
    assert.match(empfangen[i], /https:\/\/github\.com\/sundartha\/hermes\/actions\/runs\/4242/);
    assert.ok(zeilen.includes(`Zeit bis Alarm Schicht ${schicht}: ${SCHRITT_MS} ms`), zeilen.join("|"));
  });
});

test("Monatserster mit Schritt-Zusammenfassung: die Zeilen Zeit bis Alarm stehen auch dort", async () => {
  const datei = join(mkdtempSync(join(tmpdir(), "monatspruefung-")), "zusammenfassung.md");
  writeFileSync(datei, "Vorher\n");
  await pruefen({ zusammenfassung: datei });
  const inhalt = readFileSync(datei, "utf8");
  assert.ok(inhalt.startsWith("Vorher\n"));
  for (const schicht of ["1", "2a", "3"]) {
    assert.ok(inhalt.includes(`Zeit bis Alarm Schicht ${schicht}: ${SCHRITT_MS} ms\n`), inhalt);
  }
});

test("Slack antwortet 500: Lauf rot mit der Meldung nicht zugestellt und ohne Zeit bis Alarm", async () => {
  const { ok, zeilen } = await pruefen({ antwort: 500 });
  assert.equal(ok, false);
  assert.ok(zeilen.includes("Rot: Probe-Alarm Schicht 1 nicht zugestellt (HTTP 500)"), zeilen.join("|"));
  assert.ok(!zeilen.some((zeile) => zeile.startsWith("Zeit bis Alarm")));
});

test("Slack antwortet 299: zugestellt, Lauf grün", async () => {
  const { ok } = await pruefen({ antwort: 299 });
  assert.equal(ok, true);
});

test("Slack antwortet 300: nicht zugestellt, Lauf rot", async () => {
  const { ok, zeilen } = await pruefen({ antwort: 300 });
  assert.equal(ok, false);
  assert.ok(zeilen.includes("Rot: Probe-Alarm Schicht 1 nicht zugestellt (HTTP 300)"));
});

test("SLACK_ALERT_URL fehlt am Monatsersten: Lauf rot, nicht übersprungen", async () => {
  const { ok, zeilen, empfangen } = await pruefen({ mitSlack: false });
  assert.equal(ok, false);
  assert.deepEqual(empfangen, []);
  assert.ok(zeilen.includes("Rot: Prüfung der Prüfung ohne SLACK_ALERT_URL am Monatsersten"), zeilen.join("|"));
});

test("Nicht der Monatserste: übersprungen, grün, keine Nachricht, auch ohne Slack-Adresse", async () => {
  const tage = ["2026-11-30T23:59:59.999Z", "2026-12-02T00:00:00.000Z", "2026-12-15T02:17:00Z"];
  for (const tag of tage) {
    const { ok, empfangen, zeilen } = await pruefen({ start: Date.parse(tag), mitSlack: false });
    assert.equal(ok, true, tag);
    assert.deepEqual(empfangen, []);
    assert.deepEqual(zeilen, ["Prüfung der Prüfung: übersprungen (nicht der Monatserste)"]);
  }
});

test("Der Monatserste gilt von 00:00:00.000 bis 23:59:59.999 UTC", async () => {
  for (const tag of ["2026-12-01T00:00:00.000Z", "2026-12-01T23:59:59.000Z"]) {
    const { ok, empfangen } = await pruefen({ start: Date.parse(tag) });
    assert.equal(ok, true, tag);
    assert.equal(empfangen.length, 3, tag);
  }
});

test("Eine Schicht, die unter der roten Bedingung grün bleibt: Lauf rot mit Prüfung defekt, keine Nachricht für sie", async () => {
  const schichten = [
    { id: "1", name: "Staging-Smoke", rotErzeugen: () => false },
    { id: "3", name: "Anrufprobe", rotErzeugen: () => true },
  ];
  const { ok, empfangen, zeilen } = await pruefen({ schichten });
  assert.equal(ok, false);
  assert.ok(zeilen.includes("Rot: Prüfung defekt, Schicht 1 wird unter roter Bedingung nicht rot"), zeilen.join("|"));
  assert.equal(empfangen.length, 1);
  assert.ok(empfangen[0].includes("Schicht 3 "));
});

async function befehlLaufen(tag) {
  const { port, empfangen } = await dienstStarten(200);
  const datei = join(mkdtempSync(join(tmpdir(), "monatspruefung-")), "zusammenfassung.md");
  writeFileSync(datei, "");
  const kind = spawn("node", ["--import", UHR_FESTLEGEN, "tools/deploy-weg.mjs", "pruefung"], {
    env: {
      PATH: process.env.PATH,
      UHR_FESTGELEGT: tag,
      GITHUB_REPOSITORY: "sundartha/hermes",
      GITHUB_RUN_ID: "4242",
      GITHUB_STEP_SUMMARY: datei,
      SLACK_ALERT_URL: `http://127.0.0.1:${port}/geheim`,
    },
  });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  const code = await new Promise((fertig) => kind.on("close", fertig));
  const sichtbar = ausgabe.split("\n").filter((zeile) => !zeile.startsWith("::add-mask::")).join("\n");
  return { code, sichtbar, empfangen, zusammenfassung: readFileSync(datei, "utf8") };
}

test("Der Befehl pruefung am Monatsersten: drei Proben im Slack, Zeiten in Ausgabe und Zusammenfassung, Exit 0, Adresse unsichtbar", async () => {
  const { code, sichtbar, empfangen, zusammenfassung } = await befehlLaufen("2026-12-01T02:17:00Z");
  assert.equal(code, 0, sichtbar);
  assert.equal(empfangen.length, 3);
  for (const schicht of ["1", "2a", "3"]) {
    assert.match(sichtbar, new RegExp(`^Zeit bis Alarm Schicht ${schicht}: \\d+ ms$`, "m"));
    assert.match(zusammenfassung, new RegExp(`^Zeit bis Alarm Schicht ${schicht}: \\d+ ms$`, "m"));
  }
  assert.ok(!sichtbar.includes("geheim"));
});

test("Der Befehl pruefung an einem anderen Tag: übersprungen, Exit 0, keine Nachricht, Zusammenfassung leer", async () => {
  const { code, sichtbar, empfangen, zusammenfassung } = await befehlLaufen("2026-12-02T02:17:00Z");
  assert.equal(code, 0, sichtbar);
  assert.match(sichtbar, /^Prüfung der Prüfung: übersprungen \(nicht der Monatserste\)$/m);
  assert.deepEqual(empfangen, []);
  assert.equal(zusammenfassung, "");
});

test("Workflow: der Schritt Prüfung der Prüfung steht direkt vor dem Heartbeat Nachtlauf, nur im Zeitplan und nur mit SLACK_ALERT_URL", () => {
  const treffer = WORKFLOW.match(
    /^ {6}- name: Prüfung der Prüfung \(monatlich\)\n {8}id: monatspruefung\n {8}if: success\(\) && github\.event_name == 'schedule'\n {8}env:\n {10}SLACK_ALERT_URL: \$\{\{ secrets\.SLACK_ALERT_URL \}\}\n {8}run: node tools\/deploy-weg\.mjs pruefung\n\n {6}- name: Heartbeat Nachtlauf\n/m,
  );
  assert.ok(treffer, "Schritt fehlt oder steht an der falschen Stelle");
  assert.ok(WORKFLOW.indexOf("Lebenszeichen Anrufprobe") < WORKFLOW.indexOf("Prüfung der Prüfung (monatlich)"));
});
