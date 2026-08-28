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
  assert.match(bootSrc, /runSweepTick\({\s*costTruing,\s*provisioning,\s*costCrossCheck,\s*outageWatch,\s*driftWatch\s*}\)/,
    "der Sweep-Timer muss outageWatch UND driftWatch an runSweepTick durchreichen");
});

// OUTBOUND-E4: zweiter Verdrahtungspunkt, identisches Muster - der Drift-Waechter ist der
// SIEBTE Sweep-Zweig UND ein eigener Boot-Lauf. Dieselbe Luecke wie bei E3B-01: faellt
// eine der Zeilen weg, wirft runSweepTick beim naechsten Boot auf undefined bzw. der
// Boot-Lauf entfaellt lautlos, ohne dass ein Bestandstest es merkt.
test("OUTBOUND-E4: server.js baut makeDriftWatch und reicht driftWatch ins deps-Buendel durch", () => {
  assert.match(serverSrc, /import\s*{\s*makeDriftWatch\s*}\s*from\s*"\.\/telephony\/outbound-drift-watch\.js"/,
    "makeDriftWatch muss importiert sein");
  assert.match(serverSrc, /const driftWatch = makeDriftWatch\(/,
    "driftWatch muss EINMAL beim Boot konstruiert werden (Muster outageWatch)");
  const depsStart = serverSrc.indexOf("const deps = {");
  assert.notEqual(depsStart, -1, "deps-Buendel nicht gefunden");
  const depsEnd = serverSrc.indexOf("};", depsStart);
  const depsBlock = serverSrc.slice(depsStart, depsEnd);
  assert.match(depsBlock, /\bdriftWatch,/, "driftWatch fehlt im deps-Buendel");
});

test("OUTBOUND-E4: boot.js reicht driftWatch aus dem deps-Buendel an runSweepTick weiter UND ruft runBootProbe() im app.listen-Callback", () => {
  assert.match(bootSrc, /function runSweepTick\({[^}]*\bdriftWatch\b[^}]*}\)/,
    "runSweepTick muss driftWatch destrukturieren");
  assert.match(bootSrc, /driftWatch\s*\n\s*\.runDriftSweep\(\)/,
    "runSweepTick muss driftWatch.runDriftSweep() tatsaechlich aufrufen (siebter Zweig)");
  assert.match(bootSrc, /export async function bootServer\({[^]*?\bdriftWatch,[^]*?}\)/,
    "bootServer muss driftWatch aus dem deps-Buendel destrukturieren");
  assert.match(bootSrc, /driftWatch\.runBootProbe\(\)/,
    "bootServer muss driftWatch.runBootProbe() im app.listen-Callback aufrufen (Boot-Lauf)");
});
