// KV2-1: die Alarm-Naht des Kostenpfads scharf gemacht. Gemessener Befund (AUFTRAG B3):
// 11 Tage 0 % Deckung, emitFinding feuerte korrekt, audit_log blieb LEER (util.js#audit
// ist ausschliesslich ein console.log). Diese Datei belegt die Naht selbst - nicht den
// Meldeweg (test/ausfall-meldeweg.test.js) und nicht den Drift-Waechter
// (test/outbound-drift-watch.test.js), die BEIDE unveraendert gruen bleiben (Beweis des
// Umzugs). Testnamen tragen KEIN Katalog-Praefix (Lehre catalog-id-prefix-misroutes-tests)
// und landen damit im Regressionslauf `npm test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeDurableAudit } from "../src/durable-audit.js";
import { makeCostTruing, SWEEP_TRIGGER } from "../src/billing/cost-truing.js";
import { kostenAlarmFindings, betreiberAlarmKanaele, alarmKanalZeile } from "../src/boot-guard.js";
import { makeDefaultState, openOutageAlert } from "../src/store/state-ops.js";
import { COST_TRUING_SOURCE, PLATFORM_NUMBER_PURPOSE } from "../src/store/defaults.js";
import { makeStubStore, fakeConfig, makeDueOutboundCall } from "./cost-truing-harness.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SENDER_E164 = "+15005550006";

function boundAlertSender() {
  return [{
    id: "pnu_kv2_1", e164: SENDER_E164, purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER,
    provider: "telnyx", tenantId: null, providerNumberId: null,
    boundAt: "2026-08-01T00:00:00Z", releasedAt: null, note: null,
  }];
}

// Ein beendeter, BELEGBARER (isBookableCents) aber NIE bewiesener Call - deckungspflichtig
// (eligible), 0% Deckung. Bereits abgeschlossen (costTruedAt gesetzt) -> KEIN Kandidat
// mehr, isoliert den Deckungs-Befund vom Sweep-Verarbeitungspfad (Muster (j1)).
function makeUnprovenCoverageCall(state, nowMs) {
  const call = makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20 });
  call.costTruedSource = COST_TRUING_SOURCE.UNAVAILABLE;
  call.costTruedAt = new Date(nowMs).toISOString();
  return call;
}

function fakeSpies() {
  const mailCalls = [];
  const smsCalls = [];
  const mailer = { async sendMail(args) { mailCalls.push(args); } };
  const messaging = () => ({ async sendSms(args) { smsCalls.push(args); } });
  return { mailCalls, smsCalls, mailer, messaging };
}

function collectWarns() {
  const warns = [];
  const original = console.warn;
  console.warn = (...args) => warns.push(args.join(" "));
  return { warns, restore: () => { console.warn = original; } };
}

// ---- (a) makeDurableAudit: Naht selbst, fail-soft, PII-frei ----------------------------

test("KV2-1 (a1): durableAudit ruft die Konsolen-Audit-Funktion UND den durablen Sink", async () => {
  const auditCalls = [];
  const recordCalls = [];
  const sink = { record: (row) => { recordCalls.push(row); return Promise.resolve(); } };
  const durableAudit = makeDurableAudit({
    audit: (action, req, detail) => auditCalls.push({ action, req, detail }),
    auditStoreRef: { current: sink },
  });

  durableAudit("x", null, "y");
  assert.deepEqual(auditCalls, [{ action: "x", req: null, detail: "y" }]);
  await Promise.resolve().then(() => {}); // dem .then()/.catch() der Sink-Promise Zeit geben
  assert.deepEqual(recordCalls, [{ action: "x", detail: "y" }]);
});

test("KV2-1 (a2): fail-soft - null-Sink, synchroner Wurf, rejectete Promise brechen NIE", async () => {
  const auditCalls = [];
  const audit = (action, req, detail) => auditCalls.push({ action, req, detail });
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  try {
    // Sink null (STORE_BACKEND=json oder pg-gated Block nie durchgelaufen).
    const auditStoreRef1 = { current: null };
    assert.doesNotThrow(() => makeDurableAudit({ audit, auditStoreRef: auditStoreRef1 })("a", null, "1"));

    // Sink wirft SYNCHRON.
    const auditStoreRef2 = { current: { record: () => { throw new Error("sync-boom"); } } };
    assert.doesNotThrow(() => makeDurableAudit({ audit, auditStoreRef: auditStoreRef2 })("b", null, "2"));

    // Sink liefert eine REJECTETE Promise.
    const auditStoreRef3 = { current: { record: () => Promise.reject(new Error("async-boom")) } };
    assert.doesNotThrow(() => makeDurableAudit({ audit, auditStoreRef: auditStoreRef3 })("c", null, "3"));
    await Promise.resolve().then(() => {}).then(() => {}); // dem .catch() Zeit geben

    const WERFENDE_SINKS = 2; // auditStoreRef2 (sync) + auditStoreRef3 (async) - nicht auditStoreRef1 (null)
    assert.deepEqual(auditCalls.map((entry) => entry.action), ["a", "b", "c"], "audit lief in JEDEM Fall");
    assert.equal(errors.filter((zeile) => zeile.includes("durabler Eintrag fehlgeschlagen")).length, WERFENDE_SINKS,
      "genau die zwei werfenden Sinks hinterlassen eine Fehlerzeile - der null-Sink keine");
  } finally {
    console.error = originalError;
  }
});

test("KV2-1 (a3): ein voller Sweep schreibt GENAU EINEN durablen Eintrag - und KEINEN bei gesunder Deckung", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  makeUnprovenCoverageCall(state, nowMs);
  const store = makeStubStore(state);
  const recordCalls = [];
  const sink = { record: (row) => { recordCalls.push(row); return Promise.resolve(); } };
  const durableAudit = makeDurableAudit({ audit: () => {}, auditStoreRef: { current: sink } });
  const config = fakeConfig({ costTruingMinCoveragePercent: 80 });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: () => { throw new Error("kein Provider noetig"); }, audit: durableAudit, now: () => nowMs,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  await Promise.resolve().then(() => {});

  const befunde = recordCalls.filter((row) => row.action === "cost_truing_befund");
  assert.equal(befunde.length, 1, "genau ein durabler Eintrag");
  assert.match(befunde[0].detail, /^grund=coverage_below_threshold/);
  assert.doesNotMatch(befunde[0].detail, /\+\d{6,}/, "keine Rufnummer im durablen Detail");
});

test("KV2-1 (a3-negativ): Deckung ueber der Schwelle -> der durable Sink bleibt LEER", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState(); // keine Calls -> Nenner 0, aber Schwelle 0 -> gesund
  const store = makeStubStore(state);
  const recordCalls = [];
  const sink = { record: (row) => { recordCalls.push(row); return Promise.resolve(); } };
  const durableAudit = makeDurableAudit({ audit: () => {}, auditStoreRef: { current: sink } });
  const config = fakeConfig({ costTruingMinCoveragePercent: 0 });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: () => { throw new Error("kein Provider noetig"); }, audit: durableAudit, now: () => nowMs,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  await Promise.resolve().then(() => {});
  assert.equal(recordCalls.length, 0, "keine Meldung -> kein Sink-Eintrag");
});

// ---- (b) VOLL-Stufe sendet wirklich Mail+SMS, entprellt am durablen Marker -------------

test("KV2-1 (b1): beide Kanaele gesetzt -> erster Sweep sendet GENAU EINE Mail und EINE SMS", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  state.platformNumberUse = boundAlertSender();
  makeUnprovenCoverageCall(state, nowMs);
  const store = makeStubStore(state);
  const { mailCalls, smsCalls, mailer, messaging } = fakeSpies();
  const config = fakeConfig({
    costTruingMinCoveragePercent: 80, platformAlertSmsTo: "+12025550143", platformAlertMailTo: "ops@example.test",
    brevoApiKey: "k",
  });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: () => { throw new Error("kein Provider noetig"); }, audit: () => {}, messaging, mailer, now: () => nowMs,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  assert.equal(mailCalls.length, 1);
  assert.equal(smsCalls.length, 1);
});

test("KV2-1 (b2): zweiter Sweep INNERHALB des Entprellfensters -> keine zweite Mail/SMS, aber eine _entprellt-Audit-Zeile, lastSeenAt fortgeschrieben", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  state.platformNumberUse = boundAlertSender();
  makeUnprovenCoverageCall(state, nowMs);
  const store = makeStubStore(state);
  const { mailCalls, smsCalls, mailer, messaging } = fakeSpies();
  const auditCalls = [];
  const audit = (action, req, detail) => auditCalls.push({ action, detail });
  let clock = nowMs;
  const config = fakeConfig({
    costTruingMinCoveragePercent: 80, platformAlertSmsTo: "+12025550143", platformAlertMailTo: "ops@example.test",
    brevoApiKey: "k", outageAlertDebounceMs: 21600000, outageAlertRetryMs: 900000,
  });
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: () => { throw new Error("kein Provider noetig"); }, audit, messaging, mailer, now: () => clock,
  });

  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  const markerBucket = "kosten:coverage_below_threshold";
  // String-KOPIEN, nicht die live-mutierte Objektreferenz - openOutageAlert liefert
  // dieselbe Objektinstanz zurueck, die claimOutageAlert im naechsten Sweep weiter mutiert.
  const { firstSeenAt, lastSeenAt: lastSeenAtNachSweep1 } = openOutageAlert(state, markerBucket);

  const INNERHALB_DEBOUNCE_MS = 1000; // weit innerhalb outageAlertDebounceMs (21600000)
  clock += INNERHALB_DEBOUNCE_MS;
  await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });

  assert.equal(mailCalls.length, 1, "kein zweiter Mail-Versand");
  assert.equal(smsCalls.length, 1, "kein zweiter SMS-Versand");
  assert.equal(auditCalls.filter((entry) => entry.action === "cost_truing_befund_entprellt").length, 1,
    "der entprellte Lauf hinterlaesst trotzdem eine Audit-Zeile (nie stumm)");
  const nachSweep2 = openOutageAlert(state, markerBucket);
  assert.equal(nachSweep2.firstSeenAt, firstSeenAt, "firstSeenAt unveraendert");
  assert.ok(Date.parse(nachSweep2.lastSeenAt) > Date.parse(lastSeenAtNachSweep1), "lastSeenAt fortgeschrieben");
});

// ---- (c) der Marker ueberlebt einen simulierten Prozess-Neustart -----------------------

test("KV2-1 (c): neue Store-Instanz UND neue makeCostTruing-Instanz ueber DENSELBEN Zustand -> firstSeenAt bleibt, coverage_stalled kommt erst nach der Zeitschwelle", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  makeUnprovenCoverageCall(state, nowMs);
  const SWEEP_INTERVAL_MS = 1000;
  const STALL_SWEEPS = 3;
  const config = fakeConfig({
    costTruingMinCoveragePercent: 80, costTruingCoverageStallSweeps: STALL_SWEEPS, costTruingSweepIntervalMs: SWEEP_INTERVAL_MS,
  });

  // "Prozess" A.
  const storeA = makeStubStore(state);
  const auditA = [];
  const { runCostTruingSweep: sweepA } = makeCostTruing({
    store: storeA, config, voiceControl: () => { throw new Error("kein Provider noetig"); },
    audit: (action, req, detail) => auditA.push({ action, detail }), now: () => nowMs,
  });
  await sweepA({ trigger: SWEEP_TRIGGER.MANUAL });
  const markerNachA = openOutageAlert(state, "kosten:coverage_below_threshold");
  assert.ok(markerNachA, "Marker existiert nach Sweep A");
  assert.equal(auditA.some((entry) => entry.detail.includes("coverage_stalled")), false, "noch nicht stalled (Sweep A)");

  // Simulierter Neustart: NEUE Store-Instanz, NEUE makeCostTruing-Fabrik, DERSELBE state
  // (== "neue Prozess-Instanz, gleiche Datenbank"). Uhr auf firstSeenAt + Stall-Schwelle.
  const storeB = makeStubStore(state);
  const auditB = [];
  const restartClock = Date.parse(markerNachA.firstSeenAt) + STALL_SWEEPS * SWEEP_INTERVAL_MS;
  const { runCostTruingSweep: sweepB } = makeCostTruing({
    store: storeB, config, voiceControl: () => { throw new Error("kein Provider noetig"); },
    audit: (action, req, detail) => auditB.push({ action, detail }), now: () => restartClock,
  });
  await sweepB({ trigger: SWEEP_TRIGGER.MANUAL });

  const markerNachB = openOutageAlert(state, "kosten:coverage_below_threshold");
  assert.equal(markerNachB.firstSeenAt, markerNachA.firstSeenAt, "firstSeenAt ueberlebt den Neustart byte-identisch");
  assert.equal(auditB.some((entry) => entry.detail.includes("coverage_stalled")), true,
    "die NEUE Instanz erkennt den Stillstand SOFORT beim ersten Lauf - ein prozesslokaler Zaehler haette das nie gekonnt (AUFTRAG B3)");
});

// ---- (d) kostenAlarmFindings + Sweep-Zeile: reine Kanal-Diagnose -----------------------

test("KV2-1 (d1): kostenAlarmFindings - beide Ziele leer meldet, ein vollstaendiger Kanal nicht", () => {
  const leer = kostenAlarmFindings({ billing: { platformAlertSmsTo: "" }, mail: { platformAlertMailTo: "" } });
  assert.equal(leer.length, 1);
  assert.equal(leer[0].code, "kosten_alarm_ohne_ziel");
  assert.equal(leer[0].fatal, false);

  assert.deepEqual(
    kostenAlarmFindings({ billing: { platformAlertSmsTo: "+12025550143" }, mail: { platformAlertMailTo: "" } }),
    [],
    "SMS allein reicht",
  );

  assert.equal(
    kostenAlarmFindings({
      billing: { platformAlertSmsTo: "" },
      mail: { platformAlertMailTo: "ops@example.test" }, // OHNE brevoApiKey/smtpHost
    }).length,
    1,
    "eine Mail-Adresse OHNE konstruierbaren Mailer zaehlt NICHT als Kanal (G26)",
  );

  assert.deepEqual(
    kostenAlarmFindings({
      billing: { platformAlertSmsTo: "" },
      mail: { platformAlertMailTo: "ops@example.test", smtpHost: "smtp.example.test" },
    }),
    [],
    "Mail-Adresse MIT smtpHost zaehlt als Kanal",
  );
});

test("KV2-1 (d2): die Sweep-Zeile traegt kanaele= - NUR Kanal-Arten, NIE die Ziele", async () => {
  const nowMs = Date.now();

  const zeileOhneZiel = alarmKanalZeile(betreiberAlarmKanaele({ billing: { platformAlertSmsTo: "" }, mail: { platformAlertMailTo: "" } }));
  assert.equal(zeileOhneZiel, "keine");

  const zeileMitBeiden = alarmKanalZeile(betreiberAlarmKanaele({
    billing: { platformAlertSmsTo: "+12025550143" },
    mail: { platformAlertMailTo: "ops@example.test", brevoApiKey: "k" },
  }));
  assert.equal(zeileMitBeiden, "mail,sms");

  // Gegenprobe auf dem ECHTEN Sweep-Log (kein Ziel -> kanaele=keine, nie die Adresse/Nummer).
  const state = makeDefaultState();
  const store = makeStubStore(state);
  const config = fakeConfig();
  const { runCostTruingSweep } = makeCostTruing({
    store, config, voiceControl: () => { throw new Error("kein Provider noetig"); }, audit: () => {}, now: () => nowMs,
  });
  const logs = collectWarns();
  const originalLog = console.log;
  const lines = [];
  console.log = (...args) => lines.push(args.join(" "));
  try {
    await runCostTruingSweep({ trigger: SWEEP_TRIGGER.MANUAL });
  } finally {
    console.log = originalLog;
    logs.restore();
  }
  const sweepLine = lines.find((line) => line.startsWith("[cost-truing] sweep "));
  assert.ok(sweepLine.endsWith("kanaele=keine"), "kanaele=keine steht am Zeilenende");
  assert.doesNotMatch(sweepLine, /ops@|\+\d{6,}/, "kein Ziel in der Sweep-Zeile");
});

// ---- (e) Quelltext-Verdrahtungs-Guard (Muster test/ausfall-server-wiring.test.js) ------

test("KV2-1 (e): server.js/app.js/wiring/web-login.js verdrahten die durable Audit-Zelle korrekt", () => {
  const serverSrc = fs.readFileSync(path.join(ROOT, "src", "server.js"), "utf8");
  const appSrc = fs.readFileSync(path.join(ROOT, "src", "app.js"), "utf8");
  const webLoginSrc = fs.readFileSync(path.join(ROOT, "src", "wiring", "web-login.js"), "utf8");

  assert.match(serverSrc, /const durableAudit = makeDurableAudit\(/, "server.js muss durableAudit bauen");

  const mailerIndex = serverSrc.indexOf("const mailer = selectMailer(config);");
  const costTruingIndex = serverSrc.indexOf("const costTruing = makeCostTruing(");
  assert.notEqual(mailerIndex, -1, "mailer-Konstruktion nicht gefunden");
  assert.notEqual(costTruingIndex, -1, "costTruing-Konstruktion nicht gefunden");
  assert.ok(mailerIndex < costTruingIndex, "costTruing muss NACH mailer verdrahtet werden (KV2-1)");

  const costTruingEnd = serverSrc.indexOf(");", costTruingIndex);
  const costTruingCall = serverSrc.slice(costTruingIndex, costTruingEnd);
  assert.match(costTruingCall, /mailer/, "makeCostTruing muss mailer erhalten");
  assert.match(costTruingCall, /audit:\s*durableAudit/, "makeCostTruing muss die durable Audit-Funktion erhalten");

  const depsStart = serverSrc.indexOf("const deps = {");
  const depsEnd = serverSrc.indexOf("};", depsStart);
  const depsBlock = serverSrc.slice(depsStart, depsEnd);
  assert.match(depsBlock, /\bauditStoreRef,/, "auditStoreRef fehlt im deps-Buendel");
  assert.match(depsBlock, /\bdurableAudit,/, "durableAudit fehlt im deps-Buendel");

  assert.match(appSrc, /auditStoreRef,/, "app.js muss auditStoreRef an wireWebLogin durchreichen");
  // Object.assign statt direkter Property-Zuweisung (G25/Clean-Code-Ratsche dieser Datei) -
  // dieselbe Wirkung, ohne den bestehenden no-param-reassign-Fund zu vermehren.
  assert.match(webLoginSrc, /Object\.assign\(auditStoreRef, \{ current: auditStore \}\)/,
    "wireWebLogin muss auditStoreRef.current befuellen");
});
