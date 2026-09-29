// OUTBOUND-E5 Review-Blocker Runde 2 (E5-01): der komplette CLI-Einstieg von
// scripts/el-nummern-registrierung.mjs (runCli/modusAusArgv/pruefen) war UNGETESTET -
// getestet war ausschliesslich die exportierte anlegen()-Funktion
// (test/el-nummern-registrierung-anlegen-script.test.js). Genau die Riegel, die einen
// kostenpflichtigen Anbieter-Schreibzugriff schuetzen, liefen ohne Regressionsfang.
// eines LOKALEN Stub-Servers.
//
// (a) --anlegen ohne --ja-wirklich -> Exit 1, 0 Netzzugriffe.
// (b) ohne ELEVENLABS_API_KEY -> Exit 1, 0 Netzzugriffe.
// (c) --anlegen mit ELEVENLABS_NUMBER_REGISTRATION_ENABLED=false -> Exit 1, 0 Netzzugriffe.
// (d) --pruefen gegen einen lokalen Stub -> Exit 0 mit Zaehlzeile (gesunder Fall, 0 DIDs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./helpers.js";

const SPAWN_TIMEOUT_MS = 8000;
const HTTP_NOT_FOUND = 404;

function runElNummern(args, env) {
  const child = spawn(process.execPath, ["scripts/el-nummern-registrierung.mjs", ...args], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: "test", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`el-nummern-registrierung.mjs ist nicht rechtzeitig beendet. Output bisher:\n${output}`));
    }, SPAWN_TIMEOUT_MS);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

// Lokaler Stub NUR fuer die ElevenLabs-Basis (/v1/convai/phone-numbers). Zaehlt Treffer,
// damit (a)/(b)/(c) belegen koennen, dass wirklich KEIN Netzzugriff stattfand.
function startStubServer() {
  const treffer = [];
  const server = http.createServer((req, res) => {
    treffer.push(req.url);
    res.setHeader("content-type", "application/json");
    if (req.url.startsWith("/v1/convai/phone-numbers")) {
      res.end(JSON.stringify([]));
      return;
    }
    res.writeHead(HTTP_NOT_FOUND);
    res.end(JSON.stringify({ errors: [{ detail: `Stub kennt ${req.url} nicht` }] }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, treffer }));
  });
}

function stopStubServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

function tempDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "el-nummern-cli-"));
}

test("el-nummern-registrierung.mjs: --anlegen ohne --ja-wirklich -> Exit 1, KEIN Netzzugriff", async () => {
  const { server, treffer } = await startStubServer();
  try {
    const { port } = server.address();
    const { code, output } = await runElNummern(["--anlegen"], {
      ELEVENLABS_API_KEY: "stub-key",
      ELEVENLABS_API_BASE: `http://127.0.0.1:${port}`,
      DATA_DIR: tempDataDir(),
    });
    assert.equal(code, 1, `Output:\n${output}`);
    assert.match(output, /Fehler \(fail-closed\)/);
    assert.match(output, /--anlegen verlangt zusaetzlich --ja-wirklich/);
    assert.equal(treffer.length, 0, "es darf kein einziger Anbieter-Request gestellt worden sein");
  } finally {
    await stopStubServer(server);
  }
});

test("el-nummern-registrierung.mjs: ohne ELEVENLABS_API_KEY -> Exit 1, KEIN Netzzugriff", async () => {
  const { server, treffer } = await startStubServer();
  try {
    const { port } = server.address();
    const { code, output } = await runElNummern(["--pruefen"], {
      ELEVENLABS_API_BASE: `http://127.0.0.1:${port}`,
      DATA_DIR: tempDataDir(),
    });
    assert.equal(code, 1, `Output:\n${output}`);
    assert.match(output, /Fehler \(fail-closed\)/);
    assert.match(output, /ELEVENLABS_API_KEY fehlt/);
    assert.equal(treffer.length, 0, "es darf kein einziger Anbieter-Request gestellt worden sein");
  } finally {
    await stopStubServer(server);
  }
});

test("el-nummern-registrierung.mjs: --anlegen mit ELEVENLABS_NUMBER_REGISTRATION_ENABLED=false -> Exit 1, KEIN Netzzugriff", async () => {
  const { server, treffer } = await startStubServer();
  try {
    const { port } = server.address();
    const { code, output } = await runElNummern(["--anlegen", "--ja-wirklich"], {
      ELEVENLABS_API_KEY: "stub-key",
      ELEVENLABS_API_BASE: `http://127.0.0.1:${port}`,
      ELEVENLABS_NUMBER_REGISTRATION_ENABLED: "false",
      TELNYX_SIP_TRUNK_USERNAME: "sip_user",
      TELNYX_SIP_TRUNK_PASSWORD: "sip_pass",
      DATA_DIR: tempDataDir(),
    });
    assert.equal(code, 1, `Output:\n${output}`);
    assert.match(output, /Fehler \(fail-closed\)/);
    assert.match(output, /ELEVENLABS_NUMBER_REGISTRATION_ENABLED ist nicht "true"/);
    assert.equal(treffer.length, 0, "es darf kein einziger Anbieter-Request gestellt worden sein");
  } finally {
    await stopStubServer(server);
  }
});

// E5-03 (G5-Fix, Review Runde 2): --anlegen mit fehlender ELEVENLABS_AGENT_ID -> Exit 1,
// KEIN Netzzugriff. VOR dem Fix hatte das Skript hier eine EIGENE, kuerzere Liste (nur
// SIP-Zugang, OHNE agentId) - fehlte nur die Agent-ID, meldete runCli faelschlich "alles
// gut" und baute die DB-Verbindung auf, statt fail-closed abzubrechen. Jetzt nutzt das
// Skript dieselbe Quelle wie ensureRegistration (fehlendeZugangsdaten aus
// nummern-registrierung.js).
test("el-nummern-registrierung.mjs: --anlegen ohne ELEVENLABS_AGENT_ID -> Exit 1, KEIN Netzzugriff (E5-03)", async () => {
  const { server, treffer } = await startStubServer();
  try {
    const { port } = server.address();
    const { code, output } = await runElNummern(["--anlegen", "--ja-wirklich"], {
      ELEVENLABS_API_KEY: "stub-key",
      ELEVENLABS_API_BASE: `http://127.0.0.1:${port}`,
      ELEVENLABS_NUMBER_REGISTRATION_ENABLED: "true",
      TELNYX_SIP_TRUNK_USERNAME: "sip_user",
      TELNYX_SIP_TRUNK_PASSWORD: "sip_pass",
      DATA_DIR: tempDataDir(),
    });
    assert.equal(code, 1, `Output:\n${output}`);
    assert.match(output, /Fehler \(fail-closed\)/);
    assert.match(output, /ELEVENLABS_AGENT_ID fehlt/);
    assert.equal(treffer.length, 0, "es darf kein einziger Anbieter-Request gestellt worden sein");
  } finally {
    await stopStubServer(server);
  }
});

// Positiv-Kontrolle (Vermeidungsliste 2): der gesunde Fall - --pruefen gegen einen Stub, der
// eine leere Nummernliste liefert, bei leerem lokalen Store (keine aktiven DIDs) -> Exit 0.
test("el-nummern-registrierung.mjs: --pruefen gegen lokalen Stub (leerer Store) -> Exit 0, Zaehlzeile", async () => {
  const { server, treffer } = await startStubServer();
  try {
    const { port } = server.address();
    const { code, output } = await runElNummern(["--pruefen"], {
      ELEVENLABS_API_KEY: "stub-key",
      ELEVENLABS_API_BASE: `http://127.0.0.1:${port}`,
      DATA_DIR: tempDataDir(),
    });
    assert.equal(code, 0, `Output:\n${output}`);
    assert.match(output, /0 von 0 aktiven DIDs ohne Registrierung, 0 abweichend, 0 Waise\(n\) beim Anbieter\./);
    assert.ok(treffer.some((url) => url.startsWith("/v1/convai/phone-numbers")), "die Nummernliste muss abgerufen worden sein");
  } finally {
    await stopStubServer(server);
  }
});
