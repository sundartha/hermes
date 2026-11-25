import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { PROBE_STAGING_TEST_TOKEN } from "../gemeinsam/erfundene-geheimnisse.js";

const MODUL = fileURLToPath(new URL("../helpers/anruf-probe-anrufer-wirft.mjs", import.meta.url));
const ZIEL = "+12722205602";
const COMMIT = "d".repeat(40);

function stubStarten(empfangen) {
  const dienst = createServer((anfrage, rueckgabe) => {
    const teile = [];
    anfrage.on("data", (stueck) => teile.push(stueck));
    anfrage.on("end", () => {
      if (anfrage.method === "GET") {
        rueckgabe.writeHead(200, { "content-type": "application/json" });
        return rueckgabe.end("[]");
      }
      empfangen.push(JSON.parse(Buffer.concat(teile).toString()));
      rueckgabe.writeHead(201, { "content-type": "application/json" });
      rueckgabe.end(JSON.stringify({ number: 7 }));
    });
  });
  return new Promise((fertig) => dienst.listen(0, "127.0.0.1", () => fertig(dienst)));
}

function ausfuehren(argumente, umgebung) {
  const kind = spawn("node", argumente, { env: { PATH: process.env.PATH, ...umgebung } });
  let ausgabe = "";
  kind.stdout.on("data", (stueck) => (ausgabe += stueck));
  kind.stderr.on("data", (stueck) => (ausgabe += stueck));
  return new Promise((fertig) => kind.on("close", (code) => fertig({ code, ausgabe })));
}

async function mitStubs(zusatz, lauf) {
  const github = [];
  const dienst = await stubStarten(github);
  try {
    const umgebung = {
      GITHUB_SHA: COMMIT,
      GITHUB_EVENT_NAME: "schedule",
      STAGING_URL: "https://hermes-staging-erpv.onrender.com",
      STAGING_PROBE_ZIEL: ZIEL,
      STAGING_PROBE_TOKEN: PROBE_STAGING_TEST_TOKEN,
      STAGING_PROBE_AUFTRAGGEBER: "Probe GmbH",
      STAGING_PROBE_VORNAME: "Anna",
      SLACK_ALERT_URL: "http://127.0.0.1:1/x",
      GITHUB_TOKEN: "t",
      GITHUB_REPOSITORY: "sundartha/hermes",
      GITHUB_RUN_ID: "88",
      GITHUB_API_URL: `http://127.0.0.1:${dienst.address().port}`,
      ...zusatz,
    };
    const ergebnis = await lauf(umgebung);
    return { ...ergebnis, github };
  } finally {
    dienst.close();
  }
}

const HOERTEST = ["tools/deploy-weg.mjs", "hoertest", "--anlass", "probe", "--commit", COMMIT, "--teile", ""];

test("Probe wirft: das Probe-Issue nennt den bereinigten Grund der Messung", async () => {
  const fall = JSON.stringify({ eigeneNummer: ZIEL, stand: { erstversuche: 0, anrufe: 0 }, fehler: `Bearer ${PROBE_STAGING_TEST_TOKEN}`, felder: { code: "ECONNREFUSED" } });
  const ergebnis = await mitStubs({ PROBE_ANRUFER_MODUL: MODUL, PROBE_FALL: fall }, (umgebung) =>
    ausfuehren(["scripts/anruf-probe/probe.mjs"], umgebung),
  );
  assert.equal(ergebnis.code, 1);
  assert.equal(ergebnis.github.length, 1);
  const text = ergebnis.github[0].body;
  assert.ok(text.includes("Die Anrufprobe gegen Staging ist rot, auch die Wiederholung"));
  assert.ok(text.includes("\nMessung warf: ECONNREFUSED\n"));
  assert.ok(!text.includes(PROBE_STAGING_TEST_TOKEN));
});

test("Probe rot ohne Ausnahme: das Probe-Issue hat keine Zeile Messung warf", async () => {
  const ergebnis = await mitStubs({}, (umgebung) =>
    ausfuehren([...HOERTEST, "--seit", "2026-01-01T00:00:00Z"], umgebung),
  );
  assert.equal(ergebnis.code, 0);
  const text = ergebnis.github[0].body;
  assert.ok(!text.includes("Messung warf"));
});

test("--messung-grund mit Kurzcode steht im Issue", async () => {
  const ergebnis = await mitStubs({}, (umgebung) =>
    ausfuehren([...HOERTEST, "--seit", "2026-01-01T00:00:00Z", "--messung-grund", "mcp_http_401"], umgebung),
  );
  assert.equal(ergebnis.code, 0);
  const text = ergebnis.github[0].body;
  assert.ok(text.includes("\nMessung warf: mcp_http_401\n"));
});

const ABGEWIESEN = ["freitext mit leer", "mcp_http_4012", "a".repeat(61), "", "x\nMessung", "https://x", "Fehler42"];

for (const grund of ABGEWIESEN) {
  test(`--messung-grund ${JSON.stringify(grund)} wird als Aufruffehler abgewiesen`, async () => {
    const ergebnis = await mitStubs({}, (umgebung) =>
      ausfuehren([...HOERTEST, "--messung-grund", grund], umgebung),
    );
    assert.notEqual(ergebnis.code, 0);
    assert.match(ergebnis.ausgabe, /Aufruf:/);
    assert.equal(ergebnis.github.length, 0);
  });
}

test("--messung-grund mit genau 60 Zeichen wird angenommen", async () => {
  const grund = "a".repeat(60);
  const ergebnis = await mitStubs({}, (umgebung) =>
    ausfuehren([...HOERTEST, "--seit", "2026-01-01T00:00:00Z", "--messung-grund", grund], umgebung),
  );
  assert.equal(ergebnis.code, 0);
  const text = ergebnis.github[0].body;
  assert.ok(text.includes(`Messung warf: ${grund}\n`));
});
