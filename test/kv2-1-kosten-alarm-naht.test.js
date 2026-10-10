import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDurableAudit } from "../src/durable-audit.js";
import { makeCostTruing, SWEEP_TRIGGER } from "../src/billing/cost-truing.js";
import { kostenAlarmFindings, betreiberAlarmKanaele, alarmKanalZeile } from "../src/boot-guard.js";
import { makeDefaultState, openOutageAlert } from "../src/store/state-ops.js";
import { COST_TRUING_SOURCE, PLATFORM_NUMBER_PURPOSE } from "../src/store/defaults.js";
import { makeStubStore, fakeConfig, fakeSpies, makeDueOutboundCall } from "./cost-truing-harness.js";

const SENDER_E164 = "+15005550006";

function boundAlertSender() {
  return [{
    id: "pnu_kv2_1", e164: SENDER_E164, purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER,
    provider: "telnyx", tenantId: null, providerNumberId: null,
    boundAt: "2026-08-01T00:00:00Z", releasedAt: null, note: null,
  }];
}

function makeUnprovenCoverageCall(state, nowMs) {
  const call = makeDueOutboundCall(state, { nowMs, estimatedCostCents: 20 });
  call.costTruedSource = COST_TRUING_SOURCE.UNAVAILABLE;
  call.costTruedAt = new Date(nowMs).toISOString();
  return call;
}

function collectWarns() {
  const warns = [];
  const original = console.warn;
  console.warn = (...args) => warns.push(args.join(" "));
  return { warns, restore: () => { console.warn = original; } };
}

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
  await Promise.resolve().then(() => {});
  assert.deepEqual(recordCalls, [{ action: "x", tenantId: null, detail: "y" }]);
});

test("KV2-1 (a2): fail-soft - null-Sink, synchroner Wurf, rejectete Promise brechen NIE", async () => {
  const auditCalls = [];
  const audit = (action, req, detail) => auditCalls.push({ action, req, detail });
  const errors = [];
  const originalError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(" "));
  try {
    const auditStoreRef1 = { current: null };
    assert.doesNotThrow(() => makeDurableAudit({ audit, auditStoreRef: auditStoreRef1 })("a", null, "1"));

    const auditStoreRef2 = { current: { record: () => { throw new Error("sync-boom"); } } };
    assert.doesNotThrow(() => makeDurableAudit({ audit, auditStoreRef: auditStoreRef2 })("b", null, "2"));

    const auditStoreRef3 = { current: { record: () => Promise.reject(new Error("async-boom")) } };
    assert.doesNotThrow(() => makeDurableAudit({ audit, auditStoreRef: auditStoreRef3 })("c", null, "3"));
    await Promise.resolve().then(() => {}).then(() => {});

    const WERFENDE_SINKS = 2;
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
  const state = makeDefaultState();
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
  const { firstSeenAt, lastSeenAt: lastSeenAtNachSweep1 } = openOutageAlert(state, markerBucket);

  const INNERHALB_DEBOUNCE_MS = 1000;
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

test("KV2-1 (c): neue Store-Instanz UND neue makeCostTruing-Instanz ueber DENSELBEN Zustand -> firstSeenAt bleibt, coverage_stalled kommt erst nach der Zeitschwelle", async () => {
  const nowMs = Date.now();
  const state = makeDefaultState();
  makeUnprovenCoverageCall(state, nowMs);
  const SWEEP_INTERVAL_MS = 1000;
  const STALL_SWEEPS = 3;
  const config = fakeConfig({
    costTruingMinCoveragePercent: 80, costTruingCoverageStallSweeps: STALL_SWEEPS, costTruingSweepIntervalMs: SWEEP_INTERVAL_MS,
  });

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
      mail: { platformAlertMailTo: "ops@example.test" },
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
  assert.match(sweepLine, /kanaele=keine buch=/, "kanaele=keine steht unmittelbar vor dem Kosten-Buch");
  assert.doesNotMatch(sweepLine, /ops@|\+\d{6,}/, "kein Ziel in der Sweep-Zeile");
});
