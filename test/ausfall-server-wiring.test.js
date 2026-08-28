// OUTBOUND-E3b Review-Blocker (E3B-01): der zweite Verdrahtungspunkt des Melders -
// server.js baut makeOutageWatch EINMAL beim Boot (Muster costTruing/costCrossCheck,
// INV-7) und reicht das Ergebnis als "outageWatch" ins deps-Buendel durch, das
// runSweepTick (boot.js) am Stunden-Takt aufruft. Ein echter Boot-Test waere hier
// unverhaeltnismaessig (server.js startet beim Import den ganzen Prozess) - der
// Laufzeit-Beleg fuer runSweepTick selbst steht bereits in KV-M4-8
// (test/kv-m4-monthly-cross-check.test.js, injizierte Attrappe). Dieser Test schliesst
// die verbleibende Luecke: dass server.js outageWatch UEBERHAUPT baut und WEITERREICHT -
// faellt eine der beiden Zeilen weg, wirft runSweepTick beim naechsten Boot auf
// undefined, ohne dass ein einziger bestehender Test es merkt (Quelltext-Wiring-Guard,
// Muster test/call-termination-order.test.js "C5").
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSrc = fs.readFileSync(path.join(ROOT, "src", "server.js"), "utf8");
const bootSrc = fs.readFileSync(path.join(ROOT, "src", "boot.js"), "utf8");

test("E3B-01: server.js baut makeOutageWatch und reicht outageWatch ins deps-Buendel durch", () => {
  assert.match(serverSrc, /import\s*{\s*makeOutageWatch\s*}\s*from\s*"\.\/telephony\/outage-report\.js"/,
    "makeOutageWatch muss importiert sein");
  assert.match(serverSrc, /const outageWatch = makeOutageWatch\(/,
    "outageWatch muss EINMAL beim Boot konstruiert werden (Muster costTruing/costCrossCheck)");
  // Das deps-Buendel (const deps = {...}) muss den Schluessel "outageWatch," tragen -
  // sonst bekommt runSweepTick (boot.js) nie eine echte Instanz, sondern undefined.
  const depsStart = serverSrc.indexOf("const deps = {");
  assert.notEqual(depsStart, -1, "deps-Buendel nicht gefunden");
  const depsEnd = serverSrc.indexOf("};", depsStart);
  const depsBlock = serverSrc.slice(depsStart, depsEnd);
  assert.match(depsBlock, /\boutageWatch,/, "outageWatch fehlt im deps-Buendel");
});

test("E3B-01: boot.js reicht outageWatch aus dem deps-Buendel an runSweepTick weiter", () => {
  assert.match(bootSrc, /function runSweepTick\({[^}]*\boutageWatch\b[^}]*}\)/,
    "runSweepTick muss outageWatch destrukturieren");
  assert.match(bootSrc, /outageWatch\s*\n\s*\.runRecoverySweep\(\)/,
    "runSweepTick muss outageWatch.runRecoverySweep() tatsaechlich aufrufen");
  // Der Aufrufer von runSweepTick (der Stunden-Timer) muss outageWatch aus SEINEM
  // eigenen deps-Buendel weiterreichen, nicht selbst neu bauen (EINE Instanz, INV-7).
  assert.match(bootSrc, /runSweepTick\({\s*costTruing,\s*provisioning,\s*costCrossCheck,\s*outageWatch\s*}\)/,
    "der Sweep-Timer muss outageWatch an runSweepTick durchreichen");
});
