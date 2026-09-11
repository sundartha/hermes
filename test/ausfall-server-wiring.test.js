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
  assert.match(bootSrc, /runSweepTick\({\s*costTruing,\s*provisioning,\s*costCrossCheck,\s*outageWatch,\s*driftWatch,\s*paidWithoutNumberWatch,\s*provisionRetryWatch\s*}\)/,
    "der Sweep-Timer muss outageWatch, driftWatch, paidWithoutNumberWatch UND provisionRetryWatch an runSweepTick durchreichen");
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

// Review-Blocker (BLOCKER 1 / G9/C2): der ANI-Riegel (outbound-gates.js#ani_ownership)
// kann OHNE diese Verdrahtung NIE ablehnen - makeOutboundGates() faellt sonst auf ihren
// Default-No-op (`async () => null`) zurueck, egal wie scharf OUTBOUND_ANI_GATE_ENABLED
// steht. test/outbound-ani-gate.test.js deckt NUR die Gate-Logik selbst (injizierte
// Attrappe) - dieser Test schliesst die Luecke, dass server.js den ECHTEN Recheck
// UEBERHAUPT baut und an makeOutboundGates uebergibt.
test("OUTBOUND-E4: server.js baut den echten aniOwnershipRecheck ueber providerConfigRead() und uebergibt ihn an makeOutboundGates", () => {
  assert.match(
    serverSrc,
    /import\s*{\s*makeAniOwnershipRecheck\s*}\s*from\s*"\.\/telephony\/ani-ownership-recheck\.js"/,
    "makeAniOwnershipRecheck muss importiert sein",
  );
  const gatesStart = serverSrc.indexOf("const { gates: outboundGates } = makeOutboundGates({");
  assert.notEqual(gatesStart, -1, "makeOutboundGates(...)-Aufruf nicht gefunden");
  const gatesEnd = serverSrc.indexOf("});", gatesStart);
  const gatesBlock = serverSrc.slice(gatesStart, gatesEnd);
  assert.match(
    gatesBlock,
    /aniOwnershipRecheck:\s*makeAniOwnershipRecheck\(\s*{\s*telnyxRead\s*}\s*\)/,
    "aniOwnershipRecheck muss ueber makeAniOwnershipRecheck({ telnyxRead }) an makeOutboundGates uebergeben werden",
  );
  // telnyxRead muss VOR diesem Aufruf existieren, sonst wirft server.js beim Boot auf
  // ein undefiniertes Symbol (TDZ) statt den Recheck zu bauen.
  const telnyxReadDefIndex = serverSrc.indexOf("const telnyxRead = providerConfigRead();");
  assert.notEqual(telnyxReadDefIndex, -1, "telnyxRead muss ueber providerConfigRead() gebaut werden");
  assert.ok(telnyxReadDefIndex < gatesStart, "telnyxRead muss VOR makeOutboundGates(...) definiert sein");
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

test("GP-P0: server.js baut makePaidWithoutNumberWatch und reicht paidWithoutNumberWatch ins deps-Buendel durch", () => {
  assert.match(
    serverSrc,
    /import\s*{\s*makePaidWithoutNumberWatch\s*}\s*from\s*"\.\/billing\/paid-without-number-watch\.js"/,
    "makePaidWithoutNumberWatch muss importiert sein",
  );
  assert.match(serverSrc, /const paidWithoutNumberWatch = makePaidWithoutNumberWatch\(/,
    "paidWithoutNumberWatch muss EINMAL beim Boot konstruiert werden (Muster outageWatch/driftWatch)");
  const depsStart = serverSrc.indexOf("const deps = {");
  assert.notEqual(depsStart, -1, "deps-Buendel nicht gefunden");
  const depsEnd = serverSrc.indexOf("};", depsStart);
  const depsBlock = serverSrc.slice(depsStart, depsEnd);
  assert.match(depsBlock, /\bpaidWithoutNumberWatch,/, "paidWithoutNumberWatch fehlt im deps-Buendel");
});

test("GP-P0: boot.js destrukturiert paidWithoutNumberWatch und ruft runPaidWithoutNumberSweep() (achter Zweig)", () => {
  assert.match(bootSrc, /function runSweepTick\({[^}]*\bpaidWithoutNumberWatch\b[^}]*}\)/,
    "runSweepTick muss paidWithoutNumberWatch destrukturieren");
  assert.match(bootSrc, /paidWithoutNumberWatch\s*\n\s*\.runPaidWithoutNumberSweep\(\)/,
    "runSweepTick muss paidWithoutNumberWatch.runPaidWithoutNumberSweep() tatsaechlich aufrufen (achter Zweig)");
  assert.match(bootSrc, /export async function bootServer\({[^]*?\bpaidWithoutNumberWatch,[^]*?}\)/,
    "bootServer muss paidWithoutNumberWatch aus dem deps-Buendel destrukturieren");
});

// GP-P4: dritter Verdrahtungspunkt, identisches Muster (GP-P0 oben) - der zeitgesteuerte
// Wiederanlauf ist der NEUNTE Sweep-Zweig. Er wird NACH dem Provisioning-Orchestrator
// konstruiert (er braucht triggerTenantProvisioning); faellt eine der Zeilen weg, wirft
// runSweepTick beim naechsten Boot synchron auf undefined.
test("GP-P4: server.js baut makeProvisionRetryWatch und reicht provisionRetryWatch ins deps-Buendel durch", () => {
  assert.match(
    serverSrc,
    /import\s*{\s*makeProvisionRetryWatch\s*}\s*from\s*"\.\/billing\/provision-retry-sweep\.js"/,
    "makeProvisionRetryWatch muss importiert sein",
  );
  assert.match(serverSrc, /const provisionRetryWatch = makeProvisionRetryWatch\(/,
    "provisionRetryWatch muss EINMAL beim Boot konstruiert werden (Muster paidWithoutNumberWatch)");
  const depsStart = serverSrc.indexOf("const deps = {");
  assert.notEqual(depsStart, -1, "deps-Buendel nicht gefunden");
  const depsEnd = serverSrc.indexOf("};", depsStart);
  const depsBlock = serverSrc.slice(depsStart, depsEnd);
  assert.match(depsBlock, /\bprovisionRetryWatch,/, "provisionRetryWatch fehlt im deps-Buendel");
});

test("GP-P4: boot.js destrukturiert provisionRetryWatch und ruft runProvisionRetrySweep() (neunter Zweig)", () => {
  assert.match(bootSrc, /function runSweepTick\({[^}]*\bprovisionRetryWatch\b[^}]*}\)/,
    "runSweepTick muss provisionRetryWatch destrukturieren");
  assert.match(bootSrc, /provisionRetryWatch\s*\n\s*\.runProvisionRetrySweep\(\)/,
    "runSweepTick muss provisionRetryWatch.runProvisionRetrySweep() tatsaechlich aufrufen (neunter Zweig)");
  assert.match(bootSrc, /export async function bootServer\({[^]*?\bprovisionRetryWatch,[^]*?}\)/,
    "bootServer muss provisionRetryWatch aus dem deps-Buendel destrukturieren");
});
