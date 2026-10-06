import test from "node:test";
import assert from "node:assert/strict";
import { platformHoldEscalationCandidates } from "../src/store/state-ops.js";
import { runPlatformHoldEscalationSweep, runOutageRecoverySweep } from "../src/telephony/outage-report.js";
import { NUMBER_STATUS, PROVIDER, PLATFORM_NUMBER_PURPOSE, NUMBER_HOLD_REASON } from "../src/store/defaults.js";

const SCHWELLE_MS = 86400000;
const ZWEI_MELDUNGEN = 2;
const EINE_STUNDE_MS = 3600000;
const WEIT_UEBER_JEDE_FRIST_VIELFACHES = 30;
const NOW_ISO = "2026-08-27T16:45:00Z";
const NOW_MS = Date.parse(NOW_ISO);
const ALT_SUSPENDED_AT = "2026-08-26T15:45:00Z";
const JUNG_SUSPENDED_AT = "2026-08-27T15:45:00Z";
const NUMMER_E164 = "+493012345000";
const SENDER_E164 = "+15005550006";

const CONFIG = Object.freeze({
  billing: {
    platformHoldEscalationMaxAgeMs: SCHWELLE_MS,
    platformAlertSmsTo: "+12025550143",
  },
  mail: { platformAlertMailTo: "ops@example.test" },
});

function seed({ suspendedAt, holdReason = NUMBER_HOLD_REASON.PLATFORM_IN_USE, numberReleasePending = true } = {}) {
  const foreignBindingPurpose =
    holdReason === NUMBER_HOLD_REASON.PLATFORM_IN_USE ? PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI : null;
  return {
    tenants: [{ id: "t1", numberReleasePending, workosDeletePending: false, suspendedAt }],
    numbers: [
      {
        id: "n1", tenantId: "t1", status: NUMBER_STATUS.ACTIVE,
        provider: holdReason === NUMBER_HOLD_REASON.NON_TELNYX ? "twilio" : PROVIDER.TELNYX,
        providerNumberId: "ext_1", e164: NUMMER_E164,
      },
    ],
    calls: [],
    platformNumberUse: [
      {
        id: "pnu_sender", e164: SENDER_E164, purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER,
        provider: "telnyx", tenantId: null, providerNumberId: null,
        boundAt: NOW_ISO, releasedAt: null, note: null,
      },
      ...(foreignBindingPurpose
        ? [
            {
              id: "pnu_hold", e164: NUMMER_E164, purpose: foreignBindingPurpose,
              provider: "telnyx", tenantId: null, providerNumberId: null,
              boundAt: ALT_SUSPENDED_AT, releasedAt: null, note: null,
            },
          ]
        : []),
    ],
    outageAlerts: [],
  };
}

function seedMehrere(nummern) {
  const tenantIds = [...new Set(nummern.map((nummer) => nummer.tenantId))];
  return {
    tenants: tenantIds.map((id) => ({ id, numberReleasePending: true, workosDeletePending: false, suspendedAt: ALT_SUSPENDED_AT })),
    numbers: nummern.map((nummer) => ({
      id: nummer.id, tenantId: nummer.tenantId, status: NUMBER_STATUS.ACTIVE,
      provider: PROVIDER.TELNYX, providerNumberId: `ext_${nummer.id}`, e164: nummer.e164,
    })),
    calls: [],
    platformNumberUse: [
      {
        id: "pnu_sender", e164: SENDER_E164, purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER,
        provider: "telnyx", tenantId: null, providerNumberId: null,
        boundAt: NOW_ISO, releasedAt: null, note: null,
      },
      ...nummern.map((nummer) => ({
        id: `pnu_hold_${nummer.id}`, e164: nummer.e164, purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI,
        provider: "telnyx", tenantId: null, providerNumberId: null,
        boundAt: ALT_SUSPENDED_AT, releasedAt: null, note: null,
      })),
    ],
    outageAlerts: [],
  };
}

function makeStore(state) {
  return {
    load: () => state,
    save: () => {},
    withStoreLock: (fn) => Promise.resolve().then(fn),
  };
}

function makeSpies() {
  const auditCalls = [];
  const mailCalls = [];
  const smsCalls = [];
  const audit = (action, req, detail) => auditCalls.push({ action, detail });
  const mailer = { async sendMail(args) { mailCalls.push(args); } };
  const messaging = () => ({ async sendSms(args) { smsCalls.push(args); } });
  return { auditCalls, mailCalls, smsCalls, audit, mailer, messaging };
}

test("Selektor: HOLD juenger als die Schwelle -> KEIN Kandidat (Positiv-Kontrolle der Gegenrichtung)", () => {
  const state = seed({ suspendedAt: JUNG_SUSPENDED_AT });
  const candidates = platformHoldEscalationCandidates(state, { nowMs: NOW_MS, maxAgeMs: SCHWELLE_MS });
  assert.deepEqual(candidates, []);
});

test("Selektor: HOLD aelter als die Schwelle -> GENAU EIN Kandidat", () => {
  const state = seed({ suspendedAt: ALT_SUSPENDED_AT });
  const candidates = platformHoldEscalationCandidates(state, { nowMs: NOW_MS, maxAgeMs: SCHWELLE_MS });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, "n1");
});

test("Selektor-Gegenprobe: HOLD-Grund NON_TELNYX (nicht platform_number_in_use) -> KEIN Kandidat, obwohl alt", () => {
  const state = seed({ suspendedAt: ALT_SUSPENDED_AT, holdReason: NUMBER_HOLD_REASON.NON_TELNYX });
  const candidates = platformHoldEscalationCandidates(state, { nowMs: NOW_MS, maxAgeMs: SCHWELLE_MS });
  assert.deepEqual(candidates, [], "nur platform_number_in_use eskaliert - kein anderer HOLD-Grund");
});

test("Selektor-Gegenprobe: numberReleasePending=false -> KEIN Kandidat (nichts haengt)", () => {
  const state = seed({ suspendedAt: ALT_SUSPENDED_AT, numberReleasePending: false });
  const candidates = platformHoldEscalationCandidates(state, { nowMs: NOW_MS, maxAgeMs: SCHWELLE_MS });
  assert.deepEqual(candidates, []);
});

test("Selektor: kein Zeitanker (suspendedAt fehlt) -> fail-closed KEIN Kandidat", () => {
  const state = seed({ suspendedAt: null });
  const candidates = platformHoldEscalationCandidates(state, { nowMs: NOW_MS, maxAgeMs: SCHWELLE_MS });
  assert.deepEqual(candidates, []);
});

test("C8 (a) HOLD juenger als die Schwelle -> KEIN Befund", async () => {
  const state = seed({ suspendedAt: JUNG_SUSPENDED_AT });
  const store = makeStore(state);
  const spies = makeSpies();
  await runPlatformHoldEscalationSweep({ store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS });
  assert.equal(spies.auditCalls.length, 0);
  assert.equal(spies.mailCalls.length, 0);
  assert.equal(spies.smsCalls.length, 0);
  assert.equal(state.outageAlerts.length, 0, "kein Marker angelegt, solange die Schwelle nicht ueberschritten ist");
});

test("C8 (b) HOLD aelter als die Schwelle -> GENAU EIN Befund ueber denselben Meldeweg", async () => {
  const state = seed({ suspendedAt: ALT_SUSPENDED_AT });
  const store = makeStore(state);
  const spies = makeSpies();
  await runPlatformHoldEscalationSweep({ store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS });
  assert.equal(spies.auditCalls.length, 1);
  assert.equal(spies.auditCalls[0].action, "platform_hold_escalation");
  assert.equal(spies.mailCalls.length, 1, "Mail lief - PRIMAERER Kanal");
  assert.equal(spies.smsCalls.length, 1, "SMS lief - zweiter, unabhaengiger Kanal");
  const [marker] = state.outageAlerts;
  assert.equal(marker.code, `hold:${NUMBER_HOLD_REASON.PLATFORM_IN_USE}:n1`);
  assert.equal(marker.closedAt, null, "der Marker schliesst sich nicht selbst (dauerhaft entprellt, kein Erholungs-Uebergang)");
  assert.ok(marker.reportedAt, "reportedAt gesetzt (Zustellung nachgewiesen)");
});

test("C8 (c) zweiter Sweep unmittelbar danach -> KEIN weiterer Befund (permanent entprellt, nicht nur eine Frist)", async () => {
  const state = seed({ suspendedAt: ALT_SUSPENDED_AT });
  const store = makeStore(state);
  const spies = makeSpies();
  await runPlatformHoldEscalationSweep({ store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS });
  assert.equal(spies.auditCalls.length, 1, "erster Sweep meldet");
  const vielSpaeter = NOW_MS + WEIT_UEBER_JEDE_FRIST_VIELFACHES * SCHWELLE_MS;
  await runPlatformHoldEscalationSweep({ store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: vielSpaeter });
  assert.equal(spies.auditCalls.length, 1, "kein zweiter Befund im selben Prozess");
  assert.equal(spies.mailCalls.length, 1);
  assert.equal(spies.smsCalls.length, 1);
  assert.equal(state.outageAlerts.length, 1, "kein zweiter Marker angelegt");
});

test("C8 (d) Neustart zwischen den Sweeps -> immer noch KEIN zweiter Befund (Marker ueberlebt den Prozess-Neustart)", async () => {
  const stateVorNeustart = seed({ suspendedAt: ALT_SUSPENDED_AT });
  const storeVorNeustart = makeStore(stateVorNeustart);
  const spiesVorNeustart = makeSpies();
  await runPlatformHoldEscalationSweep({
    store: storeVorNeustart, config: CONFIG, audit: spiesVorNeustart.audit,
    messaging: spiesVorNeustart.messaging, mailer: spiesVorNeustart.mailer, nowMs: NOW_MS,
  });
  assert.equal(spiesVorNeustart.auditCalls.length, 1);

  const stateNachNeustart = JSON.parse(JSON.stringify(stateVorNeustart));
  const storeNachNeustart = makeStore(stateNachNeustart);
  const spiesNachNeustart = makeSpies();
  await runPlatformHoldEscalationSweep({
    store: storeNachNeustart, config: CONFIG, audit: spiesNachNeustart.audit,
    messaging: spiesNachNeustart.messaging, mailer: spiesNachNeustart.mailer, nowMs: NOW_MS,
  });
  assert.equal(spiesNachNeustart.auditCalls.length, 0, "der ueberlebende Marker verhindert einen zweiten Befund nach dem Neustart");
  assert.equal(spiesNachNeustart.mailCalls.length, 0);
  assert.equal(spiesNachNeustart.smsCalls.length, 0);
  assert.equal(stateNachNeustart.outageAlerts.length, 1, "kein zweiter Marker nach dem Neustart");
});

test("C8-PII: der Betreiber-Befund traegt keine Rufnummer/Tenant-ID/Nummern-ID", async () => {
  const state = seed({ suspendedAt: ALT_SUSPENDED_AT });
  const store = makeStore(state);
  const spies = makeSpies();
  await runPlatformHoldEscalationSweep({ store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS });
  const body = spies.mailCalls[0].text;
  assert.ok(!/\+?\d{7,}/.test(body), `keine Rufnummer im Body: ${body}`);
  assert.ok(!/\bt1\b/.test(body), `keine Tenant-ID im Body: ${body}`);
  assert.ok(!/\bn1\b/.test(body), `keine Nummern-ID im Body: ${body}`);
  assert.ok(body.includes("platform_number_in_use"), body);
});

test("C8-Aus: platformHoldEscalationMaxAgeMs=0 haelt die Eskalation komplett aus (Rollback-Hebel)", async () => {
  const state = seed({ suspendedAt: ALT_SUSPENDED_AT });
  const store = makeStore(state);
  const spies = makeSpies();
  const configAus = { ...CONFIG, billing: { ...CONFIG.billing, platformHoldEscalationMaxAgeMs: 0 } };
  await runPlatformHoldEscalationSweep({ store, config: configAus, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS });
  assert.equal(spies.auditCalls.length, 0);
  assert.equal(state.outageAlerts.length, 0);
});

test("C8-Regression (Review Runde 2): alter HOLD + erfolgreicher Anruf im Fenster -> ueber zwei Sweep-Ticks GENAU EIN Befund, KEINE outage_recovered-Zeile auf dem HOLD-Code", async () => {
  const state = seed({ suspendedAt: ALT_SUSPENDED_AT });
  state.calls = [
    {
      id: "call_ok", tenantId: "t_andere", direction: "outbound",
      endedAt: "2026-08-27T16:44:00Z", answeredAt: "2026-08-27T16:43:50Z",
      failureReason: null, to: "+12025550199",
    },
  ];
  const store = makeStore(state);
  const spies = makeSpies();
  const configVoll = {
    ...CONFIG,
    billing: {
      ...CONFIG.billing,
      outageAlertWindowMs: EINE_STUNDE_MS,
      outageAlertMinFailures: 3,
      outageAlertMinAttempts: 20,
      outageAlertFailSharePercent: 20,
      outageAlertDebounceMs: 21600000,
      outageAlertRetryMs: 900000,
    },
  };

  await runPlatformHoldEscalationSweep({ store, config: configVoll, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS });
  await runOutageRecoverySweep({ store, config: configVoll, audit: spies.audit, nowMs: NOW_MS });
  assert.equal(spies.auditCalls.length, 1, "genau ein Befund nach Tick 1 (Regression: der Erholungs-Sweep schloss den HOLD-Marker im selben Tick faelschlich)");
  assert.equal(spies.auditCalls[0].action, "platform_hold_escalation");

  const tick2 = NOW_MS + EINE_STUNDE_MS;
  await runOutageRecoverySweep({ store, config: configVoll, audit: spies.audit, nowMs: tick2 });
  await runPlatformHoldEscalationSweep({ store, config: configVoll, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: tick2 });
  assert.equal(spies.auditCalls.length, 1, "kein zweiter Befund nach Tick 2 (Regression: outage_recovered schloss den Marker, die Eskalation wiederholte sich)");
  assert.ok(!spies.auditCalls.some((eintrag) => eintrag.action === "outage_recovered"), "keine outage_recovered-Zeile auf einem hold:-Code");
  const [marker] = state.outageAlerts;
  assert.equal(marker.code, `hold:${NUMBER_HOLD_REASON.PLATFORM_IN_USE}:n1`);
  assert.equal(marker.closedAt, null, "der HOLD-Marker bleibt dauerhaft offen - kein Erholungs-Uebergang fuer HOLD-Codes");
});

test("B-1: zwei Tenants mit je einem alten HOLD -> Mail-Body enthaelt kuendigungen=2 nummern=2", async () => {
  const state = seedMehrere([
    { id: "n1", tenantId: "t1", e164: "+493012345001" },
    { id: "n2", tenantId: "t2", e164: "+493012345002" },
  ]);
  const store = makeStore(state);
  const spies = makeSpies();
  await runPlatformHoldEscalationSweep({ store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS });
  assert.equal(spies.mailCalls.length, ZWEI_MELDUNGEN, "zwei Nummern -> zwei Meldungen (je Nummer eine, s. Modul-Kommentar)");
  for (const mail of spies.mailCalls) {
    assert.match(mail.text, /kuendigungen=2 nummern=2/, `Body traegt die GESAMTzahlen: ${mail.text}`);
  }
});

test("B-2: ein Tenant mit zwei gehaltenen Nummern -> kuendigungen=1 nummern=2", async () => {
  const state = seedMehrere([
    { id: "n1", tenantId: "t1", e164: "+493012345001" },
    { id: "n2", tenantId: "t1", e164: "+493012345002" },
  ]);
  const store = makeStore(state);
  const spies = makeSpies();
  await runPlatformHoldEscalationSweep({ store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS });
  assert.equal(spies.mailCalls.length, ZWEI_MELDUNGEN);
  for (const mail of spies.mailCalls) {
    assert.match(mail.text, /kuendigungen=1 nummern=2/, `EIN Tenant, zwei Nummern: ${mail.text}`);
  }
});

test("B-3: PII-Nachweis fuer die neue Zaehler-Zeile - keine Rufnummer, keine Tenant-/Nummern-ID", async () => {
  const state = seedMehrere([
    { id: "n1", tenantId: "t1", e164: "+493012345001" },
    { id: "n2", tenantId: "t2", e164: "+493012345002" },
  ]);
  const store = makeStore(state);
  const spies = makeSpies();
  await runPlatformHoldEscalationSweep({ store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS });
  for (const mail of spies.mailCalls) {
    assert.ok(!/\+?\d{7,}/.test(mail.text), `keine Rufnummer im Body: ${mail.text}`);
    assert.ok(!/\bt1\b/.test(mail.text) && !/\bt2\b/.test(mail.text), `keine Tenant-ID im Body: ${mail.text}`);
    assert.ok(!/\bn1\b/.test(mail.text) && !/\bn2\b/.test(mail.text), `keine Nummern-ID im Body: ${mail.text}`);
  }
});
