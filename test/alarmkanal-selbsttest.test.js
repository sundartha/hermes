import test from "node:test";
import assert from "node:assert/strict";
import { runAlertChannelSelfTest, runOutageRecoverySweep } from "../src/telephony/outage-report.js";
import { PLATFORM_NUMBER_PURPOSE } from "../src/store/defaults.js";

const CONFIG = Object.freeze({
  billing: {
    outageAlertSelfTestIntervalMs: 2592000000,
    platformAlertSmsTo: "+12025550143",
  },
  mail: { platformAlertMailTo: "ops@example.test" },
});
const CONFIG_AUS = Object.freeze({
  billing: { ...CONFIG.billing, outageAlertSelfTestIntervalMs: 0 },
  mail: CONFIG.mail,
});
const SENDER_E164 = "+15005550006";
const NOW_ISO = "2026-08-27T16:45:00Z";
const NOW_MS = Date.parse(NOW_ISO);
const ONE_SECOND_MS = 1000;

function makeStore({ outageAlerts = [], platformNumberUse = [] } = {}) {
  const state = { calls: [], outageAlerts, platformNumberUse };
  return {
    load: () => state,
    save: () => {},
    withStoreLock: (fn) => Promise.resolve().then(fn),
  };
}

function boundSender() {
  return [{
    id: "pnu_1", e164: SENDER_E164, purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER,
    provider: "telnyx", tenantId: null, providerNumberId: null,
    boundAt: NOW_ISO, releasedAt: null, note: null,
  }];
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

test("S1: kein Marker (nie gelaufen) -> Selbsttest feuert genau einmal, Mail+SMS, Marker gesetzt", async () => {
  const spies = makeSpies();
  const store = makeStore({ platformNumberUse: boundSender() });
  await runAlertChannelSelfTest({
    store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS,
  });
  assert.equal(spies.mailCalls.length, 1);
  assert.equal(spies.smsCalls.length, 1);
  assert.equal(spies.auditCalls.length, 1);
  assert.equal(spies.auditCalls[0].action, "alert_channel_self_test");
  const marker = store.load().outageAlerts.find((alert) => alert.code === "self-test:alert-channel");
  assert.ok(marker, "Marker wurde angelegt");
  assert.ok(marker.lastAttemptAt, "lastAttemptAt gesetzt");
  assert.ok(marker.reportedAt, "reportedAt gesetzt (Mail erfolgreich)");
});

test("S2: NOCH nicht faellig (letzter Versuch vor Kurzem) -> kein zweiter Versand", async () => {
  const spies = makeSpies();
  const kuerzlich = new Date(NOW_MS - ONE_SECOND_MS).toISOString();
  const store = makeStore({
    outageAlerts: [{
      id: "otg_st", code: "self-test:alert-channel", firstSeenAt: kuerzlich, lastSeenAt: kuerzlich,
      lastAttemptAt: kuerzlich, reportedAt: kuerzlich, deliveredChannels: "mail", closedAt: null,
    }],
    platformNumberUse: boundSender(),
  });
  await runAlertChannelSelfTest({
    store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS,
  });
  assert.equal(spies.mailCalls.length, 0);
  assert.equal(spies.smsCalls.length, 0);
  assert.equal(spies.auditCalls.length, 0);
});

test("S3: Intervall abgelaufen -> feuert erneut", async () => {
  const spies = makeSpies();
  const vorLangem = new Date(NOW_MS - CONFIG.billing.outageAlertSelfTestIntervalMs - 1).toISOString();
  const store = makeStore({
    outageAlerts: [{
      id: "otg_st", code: "self-test:alert-channel", firstSeenAt: vorLangem, lastSeenAt: vorLangem,
      lastAttemptAt: vorLangem, reportedAt: vorLangem, deliveredChannels: "mail", closedAt: null,
    }],
    platformNumberUse: boundSender(),
  });
  await runAlertChannelSelfTest({
    store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS,
  });
  assert.equal(spies.mailCalls.length, 1);
  assert.equal(spies.smsCalls.length, 1);
});

test("S4: outageAlertSelfTestIntervalMs=0 (Rollback-Hebel) -> nie faellig, kein Versand, kein Wurf", async () => {
  const spies = makeSpies();
  const store = makeStore({ platformNumberUse: boundSender() });
  await assert.doesNotReject(() =>
    runAlertChannelSelfTest({
      store, config: CONFIG_AUS, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS,
    }),
  );
  assert.equal(spies.mailCalls.length, 0);
  assert.equal(spies.smsCalls.length, 0);
  assert.equal(spies.auditCalls.length, 0);
});

test("S5 (G26-Muster): zwei gleichzeitige Sweep-Ticks senden GENAU EINMAL (Reservierung vor Versand)", async () => {
  const spies = makeSpies();
  const store = makeStore({ platformNumberUse: boundSender() });
  await Promise.all([
    runAlertChannelSelfTest({ store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS }),
    runAlertChannelSelfTest({ store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS }),
  ]);
  assert.equal(spies.mailCalls.length, 1, "genau EINE Mail trotz zweier gleichzeitiger Ticks");
  assert.equal(spies.smsCalls.length, 1, "genau EINE SMS trotz zweier gleichzeitiger Ticks");
});

test("S7 (B1-Fix, Review-Blocker Runde 3): der Erholungs-Sweep und der Selbsttest laufen "
  + "MEHRFACH hintereinander gegen denselben Store - genau EIN Selbsttest-Versand ueber "
  + "5 simulierte Stunden-Ticks (30-Tage-Intervall), NIE eine outage_recovered-Zeile fuer "
  + "den Selbsttest-Marker", async () => {
  const spies = makeSpies();
  const store = makeStore({ platformNumberUse: boundSender() });
  const STUNDEN_TAKT_MS = 3600000;
  const SIMULIERTE_TICKS = 5;
  for (let tick = 0; tick < SIMULIERTE_TICKS; tick += 1) {
    const nowMs = NOW_MS + tick * STUNDEN_TAKT_MS;
    await runOutageRecoverySweep({ store, config: CONFIG, audit: spies.audit });
    await runAlertChannelSelfTest({
      store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs,
    });
  }
  assert.equal(spies.mailCalls.length, 1, "genau EIN Selbsttest-Versand ueber 5 Ticks (30-Tage-Intervall)");
  assert.equal(spies.smsCalls.length, 1, "genau EINE Selbsttest-SMS ueber 5 Ticks");
  const recoveredZeilen = spies.auditCalls.filter((call) => call.action === "outage_recovered");
  assert.equal(recoveredZeilen.length, 0, "der Selbsttest-Marker darf NIE outage_recovered ausloesen");
  const marker = store.load().outageAlerts.find((alert) => alert.code === "self-test:alert-channel");
  assert.equal(marker.closedAt, null, "der Selbsttest-Marker bleibt offen - der Sweep darf ihn nicht schliessen");
});

test("S6: PII-Regex - der Selbsttest-Body traegt keine Rufnummer/Tenant-ID", async () => {
  const spies = makeSpies();
  const store = makeStore({ platformNumberUse: boundSender() });
  await runAlertChannelSelfTest({
    store, config: CONFIG, audit: spies.audit, messaging: spies.messaging, mailer: spies.mailer, nowMs: NOW_MS,
  });
  const body = spies.mailCalls[0].text;
  assert.ok(!/\+?\d{7,}/.test(body), `keine Rufnummer im Body: ${body}`);
  assert.ok(!/t_user_/.test(body), `keine Tenant-ID im Body: ${body}`);
});
