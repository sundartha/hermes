// Review-Blocker (PLAN-FRAGILITY-REMEDIATION.md P5, Runde 1): scripts/check-setup.js
// las config.ownerNumber - einen Config-Key, den es seit P2b nicht mehr gibt (OWNER_NUMBER
// als privater SMS-Empfaenger ist durch tenant.privateNumber ersetzt). Auf master lieferte
// das lautlos undefined (nur eine Warnung); der P5-Proxy-Guard macht daraus einen TypeError,
// der das Skript mitten im Lauf abbricht - eine Regression des in CLAUDE.md dokumentierten
// Operator-Befehls "npm run check". npm test deckt das NICHT automatisch ab (kein Aufrufer
// importiert check-setup.js) -> eigener Kindprozess-Test, der das Skript real ausfuehrt.
//
// Lauf OHNE Anthropic-Credentials: die einzigen await-fetch-Bloecke im Skript sind
// per if (config.xxx) gegated und bleiben damit unbetreten -> deterministisch, kein Netz,
// keine Wartezeit (siehe CLAUDE.md "Tests ... ohne Netz und ohne .env").
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "child_process";
import { ROOT, tempDataDir, seedState } from "./helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

function runCheckSetup(env) {
  const child = spawn(process.execPath, ["scripts/check-setup.js"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, NODE_ENV: "test", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (d) => (output += d.toString()));
  child.stderr.on("data", (d) => (output += d.toString()));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`check-setup.js ist nicht rechtzeitig beendet. Output bisher:\n${output}`));
    }, 8000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });
}

test("npm run check crasht nicht mehr am toten config.ownerNumber (Proxy-Guard-Regression)", async () => {
  const dataDir = tempDataDir(); // leer -> keine aktive Owner-Nummer, das ist hier ok (bad(), kein Crash)
  const { code, output } = await runCheckSetup({ DATA_DIR: dataDir });
  // Kein unbehandelter TypeError aus dem Proxy-Guard (der alte Crash-Modus).
  assert.doesNotMatch(output, /TypeError: config\.ownerNumber existiert nicht/);
  assert.doesNotMatch(output, /Node\.js v\d/); // Crash-Banner eines unbehandelten Fehlers
  // Das Skript muss bis zum Ende durchlaufen (Ergebnis-Zeile), statt mittendrin abzubrechen.
  assert.match(output, /Ergebnis:/);
  // Ohne Credentials sind mehrere Checks erwartbar rot -> Exit 1 ist HIER normal (kein Crash-Indiz).
  assert.equal(code, 1);
});

// C-P5: der Provider-Filter ist entfallen (es gibt genau einen Anbieter). Damit dreht die
// Aussage: eine aktive Telnyx-Nummer im Store IST die Owner-Nummer und muss gemeldet werden.
// Gepinnt bleibt die Betreiber-Oberflaeche - was `npm run check` dem Betreiber ueber die
// Owner-Nummer sagt.
test("npm run check meldet die aktive Owner-Nummer aus dem Store (C-P5: kein Provider-Filter mehr)", async () => {
  const seed = seedState({
    numbers: [
      {
        id: "num_telnyx_only",
        e164: "+4915199999",
        tenantId: BOOTSTRAP_TENANT_ID,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
      },
    ],
    tenants: [{ id: BOOTSTRAP_TENANT_ID, status: "active", ownerName: "Test" }],
  });
  const dataDir = tempDataDir(seed);
  const { output } = await runCheckSetup({ DATA_DIR: dataDir });
  assert.match(output, /Owner-Nummer \(Store\): \+4915199999/);
  assert.doesNotMatch(output, /Keine aktive Owner-Nummer im Store/);
});
