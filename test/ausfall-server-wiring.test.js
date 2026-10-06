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
  assert.match(bootSrc, /runSweepTick\({\s*costTruing,\s*provisioning,\s*costCrossCheck,\s*outageWatch,\s*paidWithoutNumberWatch,\s*provisionRetryWatch,\s*priceDriftWatch\s*}\)/,
    "der Sweep-Timer muss outageWatch, paidWithoutNumberWatch, provisionRetryWatch UND priceDriftWatch an runSweepTick durchreichen");
});

test("OUTBOUND-E4: server.js baut den echten aniOwnershipRecheck ueber providerConfigRead() und uebergibt ihn an makeOutboundGates", () => {
  assert.match(
    serverSrc,
    /import\s*{\s*makeAniOwnershipRecheck\s*}\s*from\s*"\.\/telephony\/ani-ownership-recheck\.js"/,
    "makeAniOwnershipRecheck muss importiert sein",
  );
  const gatesStart = serverSrc.indexOf(
    "const { gates: outboundGates, callQuotaDenial } = makeOutboundGates({",
  );
  assert.notEqual(gatesStart, -1, "makeOutboundGates(...)-Aufruf nicht gefunden");
  const gatesEnd = serverSrc.indexOf("});", gatesStart);
  const gatesBlock = serverSrc.slice(gatesStart, gatesEnd);
  assert.match(
    gatesBlock,
    /aniOwnershipRecheck:\s*makeAniOwnershipRecheck\(\s*{\s*telnyxRead\s*}\s*\)/,
    "aniOwnershipRecheck muss ueber makeAniOwnershipRecheck({ telnyxRead }) an makeOutboundGates uebergeben werden",
  );
  const telnyxReadDefIndex = serverSrc.indexOf("const telnyxRead = providerConfigRead();");
  assert.notEqual(telnyxReadDefIndex, -1, "telnyxRead muss ueber providerConfigRead() gebaut werden");
  assert.ok(telnyxReadDefIndex < gatesStart, "telnyxRead muss VOR makeOutboundGates(...) definiert sein");
});

test("GP-P0: server.js baut makePaidWithoutNumberWatch und reicht paidWithoutNumberWatch ins deps-Buendel durch", () => {
  assert.match(
    serverSrc,
    /import\s*{\s*makePaidWithoutNumberWatch\s*}\s*from\s*"\.\/billing\/paid-without-number-watch\.js"/,
    "makePaidWithoutNumberWatch muss importiert sein",
  );
  assert.match(serverSrc, /const paidWithoutNumberWatch = makePaidWithoutNumberWatch\(/,
    "paidWithoutNumberWatch muss EINMAL beim Boot konstruiert werden (Muster outageWatch)");
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

test("GP-P6: server.js baut makePriceDriftWatch und reicht priceDriftWatch ins deps-Buendel durch", () => {
  assert.match(
    serverSrc,
    /import\s*{\s*makePriceDriftWatch\s*}\s*from\s*"\.\/billing\/price-drift-watch\.js"/,
    "makePriceDriftWatch muss importiert sein",
  );
  assert.match(serverSrc, /const priceDriftWatch = makePriceDriftWatch\(/,
    "priceDriftWatch muss EINMAL beim Boot konstruiert werden");
  assert.match(serverSrc, /lesePreis:\s*\(priceId\)\s*=>\s*stripeBilling\.retrievePriceAmount\(priceId\)/,
    "lesePreis muss der rein lesende Stripe-Abruf des bestehenden Adapters sein (kein zweiter HTTP-Client)");
  const depsStart = serverSrc.indexOf("const deps = {");
  assert.notEqual(depsStart, -1, "deps-Buendel nicht gefunden");
  const depsEnd = serverSrc.indexOf("};", depsStart);
  const depsBlock = serverSrc.slice(depsStart, depsEnd);
  assert.match(depsBlock, /\bpriceDriftWatch,/, "priceDriftWatch fehlt im deps-Buendel");
});

test("GP-P6: boot.js destrukturiert priceDriftWatch, ruft runPriceDriftSweep() (zehnter Zweig) UND runBootProbe()", () => {
  assert.match(bootSrc, /function runSweepTick\({[^}]*\bpriceDriftWatch\b[^}]*}\)/,
    "runSweepTick muss priceDriftWatch destrukturieren");
  assert.match(bootSrc, /priceDriftWatch\s*\n\s*\.runPriceDriftSweep\(\)/,
    "runSweepTick muss priceDriftWatch.runPriceDriftSweep() tatsaechlich aufrufen (zehnter Zweig)");
  assert.match(bootSrc, /export async function bootServer\({[^]*?\bpriceDriftWatch,[^]*?}\)/,
    "bootServer muss priceDriftWatch aus dem deps-Buendel destrukturieren");
  assert.match(bootSrc, /priceDriftWatch\.runBootProbe\(\)/,
    "bootServer muss priceDriftWatch.runBootProbe() im app.listen-Callback aufrufen (Boot-Lauf)");
});
