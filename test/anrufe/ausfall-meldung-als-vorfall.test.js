import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { makeCallFinish } from "../../src/telephony/call-finish.js";
import { makeOutageWatch, runPlatformHoldEscalationSweep } from "../../src/telephony/outage-report.js";
import { NUMBER_STATUS } from "../../src/begriffe/nummern.js";
import { PROVIDER, PLATFORM_NUMBER_PURPOSE } from "../../src/begriffe/nummern-vergabe.js";
import { seedCall } from "../helpers.js";
import { makePgTestStore } from "../pg-helpers.js";
import { echtWarten } from "../echt-warten.js";
import { fangeVorfaelle } from "../gemeinsam/vorfall-fang.js";
import { starteBetterStackAttrappe } from "../gemeinsam/better-stack-attrappe.mjs";

const FRIST = { timeout: 10000 };
const GEHEIMER_PFAD = "geheimer-eingang-q7x9";
const FENSTER_MS = 3600000;
const WIEDERHOLUNG_MS = 1000;
const HOLD_SCHWELLE_MS = 60000;
const HOLD_ALTER_MS = 120000;
const ERSTER_ANRUF_MS = Date.parse("2026-08-27T10:00:00.000Z");
const GRUND = "not-placed:invite-403";
const HOLD_PRAEFIX = "hold:platform_number_in_use:";

const { store: echterSpeicher } = await makePgTestStore();

function konfig(adresse) {
  return {
    billing: {
      paymentEnabled: false,
      smsCostCents: 0,
      outageAlertWindowMs: FENSTER_MS,
      outageAlertMinFailures: 2,
      outageAlertMinAttempts: 50,
      outageAlertFailSharePercent: 50,
      outageAlertDebounceMs: 21600000,
      outageAlertRetryMs: WIEDERHOLUNG_MS,
      outageAlertSelfTestIntervalMs: 0,
      platformHoldEscalationMaxAgeMs: HOLD_SCHWELLE_MS,
      platformAlertSmsTo: "+12025550143",
      betterstackAlertUrl: adresse,
    },
    mail: { platformAlertMailTo: "ops@example.test" },
    privacy: {},
    server: { publicUrl: "https://hermes.example.test" },
  };
}

function speicher(zustand) {
  return {
    ...echterSpeicher,
    load: () => zustand,
    releaseOutboundReserve: async () => {},
    save: () => {},
    addNotification: () => {},
    purgeTranscript: () => {},
    tenantContext: () => ({ settings: { agentName: "Hermes" } }),
    recordUsageEvent: () => {},
    markBilled: () => {},
    markInboxEntry: () => {},
    markSummaryMailSent: () => {},
    markSummarySmsSent: () => {},
    tenantNewsletterConsent: () => ({ consent: false }),
    confirmedNewsletterRecipients: () => [],
  };
}

function nebenkanaele() {
  const mails = [];
  const smsAnfragen = [];
  return {
    mails,
    smsAnfragen,
    mailer: { sendMail: async (mail) => mails.push(mail) },
    messaging: () => ({ sendSms: async (sms) => smsAnfragen.push(sms) }),
  };
}

function anrufEnde(config, zustand, kanaele) {
  const finish = makeCallFinish({
    store: speicher(zustand),
    config,
    metering: { recordVoiceMinuteMeter: () => {}, reconcileVoiceBudget: () => {} },
    messaging: kanaele.messaging,
    summarizeCall: async () => ({ summary: "Kurz.", actionItems: [] }),
    planSummarySms: () => ({ send: false, reason: null }),
    audit: () => {},
    mailer: kanaele.mailer,
    accountsRef: { current: { accountByTenant: async () => null } },
  });
  return async (versatzMs) => {
    const anruf = seedCall({
      status: "failed",
      direction: "outbound",
      to: "+12025550143",
      endedAt: new Date(ERSTER_ANRUF_MS + versatzMs).toISOString(),
      failureReason: GRUND,
    });
    zustand.calls.push(anruf);
    await finish.finishCall(anruf);
  };
}

async function mitAusfall(t, optionen, ablauf) {
  const attrappe = await starteBetterStackAttrappe(optionen);
  t.after(async () => {
    mock.restoreAll();
    await attrappe.close();
  });
  const zustand = { calls: [], outageAlerts: [], platformNumberUse: [] };
  const kanaele = nebenkanaele();
  const placeCall = anrufEnde(konfig(attrappe.url), zustand, kanaele);
  return ablauf({ attrappe, kanaele, placeCall, zustand });
}

test("S1: die Ausfallschwelle meldet genau einen alert-Vorfall und nichts per SMS oder Mail", FRIST, async (t) => {
  await mitAusfall(t, {}, async ({ attrappe, kanaele, placeCall, zustand }) => {
    await placeCall(0);
    await attrappe.schranke();
    assert.equal(attrappe.meldungen.length, 0);
    await placeCall(1);
    await attrappe.aufMeldungen(1);
    await attrappe.schranke();
    assert.equal(attrappe.meldungen.length, 1);
    const [meldung] = attrappe.meldungen;
    assert.equal(meldung.methode, "POST");
    assert.equal(meldung.status, "alert");
    assert.equal(meldung.id, GRUND);
    const [marker] = zustand.outageAlerts;
    assert.equal(marker.deliveredChannels, "better-stack");
    assert.ok(marker.reportedAt);
    assert.equal(kanaele.smsAnfragen.length, 0);
    assert.equal(kanaele.mails.length, 0);
  });
});

test("S11: nahm der Eingang die Meldung nicht an, wiederholt sie sich nach der Wiederholfrist, vorher nicht", FRIST, async (t) => {
  await mitAusfall(t, { antwortStatus: 500 }, async ({ attrappe, placeCall }) => {
    await placeCall(0);
    await placeCall(1);
    await attrappe.aufMeldungen(1);
    await placeCall(WIEDERHOLUNG_MS - 1);
    await attrappe.schranke();
    assert.equal(attrappe.meldungen.length, 1);
    await placeCall(WIEDERHOLUNG_MS + 1);
    await attrappe.aufMeldungen(2);
    await attrappe.schranke();
    assert.deepEqual(attrappe.meldungen.map((meldung) => [meldung.id, meldung.status]), [
      [GRUND, "alert"],
      [GRUND, "alert"],
    ]);
  });
});

test("S11: nahm der Eingang die Meldung mit 2xx an, folgt auch nach der Wiederholfrist keine zweite", FRIST, async (t) => {
  await mitAusfall(t, { antwortStatus: 204 }, async ({ attrappe, placeCall }) => {
    await placeCall(0);
    await placeCall(1);
    await attrappe.aufMeldungen(1);
    await placeCall(WIEDERHOLUNG_MS * 2);
    await attrappe.schranke();
    assert.equal(attrappe.meldungen.length, 1);
  });
});

test("S17: ein Eingang ohne Listener laesst place_call durch, die Ausgabe nennt weder Adresse noch Pfad", FRIST, async (t) => {
  const attrappe = await starteBetterStackAttrappe();
  const adresse = `${attrappe.url}/${GEHEIMER_PFAD}`;
  await attrappe.close();
  const ausgabe = [];
  for (const kanal of ["log", "warn", "error"])
    mock.method(console, kanal, (...teile) => ausgabe.push(teile.join(" ")));
  t.after(() => mock.restoreAll());
  const zustand = { calls: [], outageAlerts: [], platformNumberUse: [] };
  const placeCall = anrufEnde(konfig(adresse), zustand, nebenkanaele());
  await placeCall(0);
  await assert.doesNotReject(() => placeCall(1));
  assert.ok(
    ausgabe.some((zeile) => zeile.startsWith(`[outage] Better-Stack-Meldung ${GRUND} nicht zugestellt: `)),
    ausgabe.join("\n"),
  );
  assert.equal(zustand.outageAlerts[0].reportedAt, null);
  const host = new URL(adresse).host;
  for (const zeile of ausgabe) {
    assert.ok(!zeile.includes(GEHEIMER_PFAD), zeile);
    assert.ok(!zeile.includes(host), zeile);
  }
});

function holdZustand() {
  const vorMs = new Date(Date.now() - HOLD_ALTER_MS).toISOString();
  return {
    calls: [],
    outageAlerts: [],
    tenants: [{ id: "t1", numberReleasePending: true, workosDeletePending: false, suspendedAt: vorMs }],
    numbers: [
      { id: "n1", tenantId: "t1", status: NUMBER_STATUS.ACTIVE, provider: PROVIDER.TELNYX, providerNumberId: "ext_1", e164: "+493012345000" },
    ],
    platformNumberUse: [
      {
        id: "pnu_hold", e164: "+493012345000", purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI,
        provider: "telnyx", tenantId: null, providerNumberId: null, boundAt: vorMs, releasedAt: null, note: null,
      },
    ],
  };
}

function holdWache(config, zustand, kanaele) {
  return makeOutageWatch({
    store: speicher(zustand),
    config,
    audit: () => {},
    messaging: kanaele.messaging,
    mailer: kanaele.mailer,
  });
}

test("S19: eine zu lange haengende Rufnummern-Freigabe meldet genau einen alert-Vorfall", FRIST, async (t) => {
  const attrappe = await starteBetterStackAttrappe();
  t.after(() => attrappe.close());
  const kanaele = nebenkanaele();
  const wache = holdWache(konfig(attrappe.url), holdZustand(), kanaele);
  await wache.runHoldEscalationSweep();
  await attrappe.aufMeldungen(1);
  await attrappe.schranke();
  assert.equal(attrappe.meldungen.length, 1);
  const [meldung] = attrappe.meldungen;
  assert.equal(meldung.status, "alert");
  assert.ok(meldung.id.startsWith(HOLD_PRAEFIX), meldung.id);
  assert.equal(kanaele.smsAnfragen.length, 0);
  assert.equal(kanaele.mails.length, 0);
});

test("S12: nahm der Eingang die Hold-Meldung nicht an, geht nach der Wiederholfrist dieselbe Meldung erneut", FRIST, async (t) => {
  const attrappe = await starteBetterStackAttrappe({ antwortStatus: 500 });
  t.after(() => attrappe.close());
  const wache = holdWache(konfig(attrappe.url), holdZustand(), nebenkanaele());
  await wache.runHoldEscalationSweep();
  await attrappe.aufMeldungen(1);
  await wache.runHoldEscalationSweep();
  await attrappe.schranke();
  assert.equal(attrappe.meldungen.length, 1);
  await echtWarten(WIEDERHOLUNG_MS);
  await wache.runHoldEscalationSweep();
  await attrappe.aufMeldungen(2);
  await attrappe.schranke();
  assert.equal(attrappe.meldungen[1].id, attrappe.meldungen[0].id);
  assert.equal(attrappe.meldungen[1].status, "alert");
});

test("S12: nahm der Eingang die Hold-Meldung an, folgt auch nach der Wiederholfrist keine zweite", FRIST, async (t) => {
  const attrappe = await starteBetterStackAttrappe();
  t.after(() => attrappe.close());
  const wache = holdWache(konfig(attrappe.url), holdZustand(), nebenkanaele());
  await wache.runHoldEscalationSweep();
  await attrappe.aufMeldungen(1);
  await echtWarten(WIEDERHOLUNG_MS);
  await wache.runHoldEscalationSweep();
  await attrappe.schranke();
  assert.equal(attrappe.meldungen.length, 1);
});

test("S12: die Wiederholfrist der Hold-Meldung gilt genau: eine Millisekunde davor nichts, zur Frist wieder dieselbe Meldung", async (t) => {
  t.after(() => mock.restoreAll());
  const vorfaelle = fangeVorfaelle({ status: 500 });
  const nowMs = Date.now();
  const lauf = (versatzMs) =>
    runPlatformHoldEscalationSweep({
      store: speicher(zustand),
      config: konfig("https://eingang.example.test/e"),
      audit: () => {},
      messaging: nebenkanaele().messaging,
      mailer: nebenkanaele().mailer,
      nowMs: nowMs + versatzMs,
    });
  const zustand = holdZustand();
  await lauf(0);
  assert.equal(vorfaelle.length, 1);
  await lauf(WIEDERHOLUNG_MS - 1);
  assert.equal(vorfaelle.length, 1);
  await lauf(WIEDERHOLUNG_MS);
  assert.equal(vorfaelle.length, 2);
  assert.equal(vorfaelle[1].id, vorfaelle[0].id);
  assert.ok(vorfaelle[0].id.startsWith(HOLD_PRAEFIX));
});
