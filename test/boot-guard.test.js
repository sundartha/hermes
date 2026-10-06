import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  guardedBoot,
  fakeOriginateBootBlocked,
  meterMappingGaps,
  alertChannelFindings,
  bootstrapHealDecision,
  ALERT_CHANNEL_FINDING,
  BOOTSTRAP_HEAL,
} from "../src/boot-guard.js";
import { createPortalRunner } from "../src/portal-pool.js";

const superuserPool = () => ({
  connect: async () => ({
    query: async () => ({ rows: [{ is_su: "on", rolbypassrls: false }] }),
    release() {},
  }),
  end: async () => {},
});

async function captureErrAsync(fn) {
  const logs = [];
  const orig = console.error;
  console.error = (...a) => logs.push(a.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.error = orig;
  }
  return logs.join("\n");
}

test("T-P0-05a: guardedBoot faengt Portal-Fault, loggt [boot] deaktiviert, returnt false", async () => {
  let result;
  const out = await captureErrAsync(async () => {
    result = await guardedBoot("Web-Login/Portal", () =>
      createPortalRunner({ pool: superuserPool() }),
    );
  });
  assert.equal(result, false);
  assert.match(out, /\[boot\] Web-Login\/Portal deaktiviert/);
});

test("T-P0-05b: guardedBoot returnt true wenn der Block durchlaeuft", async () => {
  let logged = "";
  const orig = console.error;
  console.error = (...a) => {
    logged += a.map(String).join(" ");
  };
  let result;
  try {
    result = await guardedBoot("Web-Login/Portal", async () => {
    });
  } finally {
    console.error = orig;
  }
  assert.equal(result, true);
  assert.ok(!/deaktiviert/.test(logged));
});

test("T-P0-05: Portal-Fault -> /healthz 200, /auth/login 404, Server lebt", async () => {
  const app = express();
  app.get("/healthz", (_q, res) => res.json({ ok: true }));

  const mounted = await guardedBoot("Web-Login/Portal", async () => {
    await createPortalRunner({ pool: superuserPool() });
    app.get("/auth/login", (_q, res) => res.send("login"));
  });
  assert.equal(mounted, false);

  const srv = app.listen(0);
  try {
    await new Promise((r) => srv.once("listening", r));
    const port = srv.address().port;
    const health = await fetch(`http://127.0.0.1:${port}/healthz`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });
    const login = await fetch(`http://127.0.0.1:${port}/auth/login`);
    assert.equal(login.status, 404, "Web-Login darf nicht gemountet sein");
  } finally {
    srv.close();
  }
});

test("OUT-05 F2: fakeOriginateBootBlocked-Wahrheitstabelle", () => {
  assert.equal(fakeOriginateBootBlocked({ fakeOriginate: true, skipTwilioSignatureCheck: false }), true);
  assert.equal(fakeOriginateBootBlocked({ fakeOriginate: true, skipTwilioSignatureCheck: true }), false);
  assert.equal(fakeOriginateBootBlocked({ fakeOriginate: false, skipTwilioSignatureCheck: false }), false);
  assert.equal(fakeOriginateBootBlocked({ fakeOriginate: false, skipTwilioSignatureCheck: true }), false);
});

test("S1-7: meterMappingGaps meldet fehlende Meter-Abbildungen (Boot-Assertion)", () => {
  const kinds = ["voice_minute", "ai_token", "sms", "number_month"];
  assert.deepEqual(
    meterMappingGaps(kinds, { voice_minute: "x", ai_token: "y", sms: "z", number_month: "w" }),
    [],
    "vollstaendige Abbildung -> keine Luecke",
  );
  assert.deepEqual(
    meterMappingGaps(kinds, { voice_minute: "x", ai_token: "y", number_month: "w" }),
    ["sms"],
    "kuenstlich unvollstaendige Map -> Luecke gemeldet",
  );
});

test("P5-B1: alertChannelFindings('') -> genau ein Befund, UNSET, nicht fatal", () => {
  const findings = alertChannelFindings({ platformAlertSmsTo: "" });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, ALERT_CHANNEL_FINDING.UNSET);
  assert.equal(findings[0].fatal, false);
});

test("P5-B2: alertChannelFindings(nummer) -> [] (Kanal besetzt, kein Befund)", () => {
  assert.deepEqual(alertChannelFindings({ platformAlertSmsTo: "+491234567890" }), []);
});

test("Alarmkanal-Wahrheitstabelle (GAP-07): leerer Kanal + Buchung + Warnschwelle>0 -> genau ein FATALER Befund", () => {
  const findings = alertChannelFindings({
    platformAlertSmsTo: "",
    paymentEnabled: true,
    platformSpendWarnPercent: 80,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, ALERT_CHANNEL_FINDING.UNSET_WITH_ACTIVE_WARNING);
  assert.equal(findings[0].fatal, true);
});

test("Alarmkanal-Wahrheitstabelle (GAP-07): Warnschwelle 0 bzw. keine Buchung -> WARN statt FATAL", () => {
  const warnOff = alertChannelFindings({
    platformAlertSmsTo: "",
    paymentEnabled: true,
    platformSpendWarnPercent: 0,
  });
  assert.equal(warnOff.length, 1);
  assert.equal(warnOff[0].fatal, false, "abgeschaltete Warnschwelle braucht keinen Empfaenger");

  const noPayment = alertChannelFindings({
    platformAlertSmsTo: "",
    paymentEnabled: false,
    platformSpendWarnPercent: 80,
  });
  assert.equal(noPayment.length, 1);
  assert.equal(noPayment[0].fatal, false, "ohne Buchung ist der Dienst blind, nicht unsicher");
});

test("Alarmkanal-Wahrheitstabelle (GAP-07): besetzter Kanal liefert auch bei scharfer Warnung [] (Nummer wird nie geloggt)", () => {
  assert.deepEqual(
    alertChannelFindings({
      platformAlertSmsTo: "+491234567890",
      paymentEnabled: true,
      platformSpendWarnPercent: 80,
    }),
    [],
  );
});

const FRESH_STORE = Object.freeze({
  activeNumberPresent: false,
  numberCount: 0,
  foreignTenantCount: 0,
  callCount: 0,
  e164: "+15005550006",
  provider: "telnyx",
});

test("Boot-Heilung (GAP-38): aktive Nummer vorhanden -> NOT_NEEDED (Parameter egal)", () => {
  assert.equal(
    bootstrapHealDecision({ ...FRESH_STORE, activeNumberPresent: true }),
    BOOTSTRAP_HEAL.NOT_NEEDED,
  );
  assert.equal(
    bootstrapHealDecision({ ...FRESH_STORE, activeNumberPresent: true, e164: "", provider: "" }),
    BOOTSTRAP_HEAL.NOT_NEEDED,
  );
});

test("Boot-Heilung (GAP-38): jede Spur eines gelebten Stores -> BLOCKED_STORE_NOT_FRESH", () => {
  for (const spur of [{ numberCount: 1 }, { foreignTenantCount: 1 }, { callCount: 1 }]) {
    assert.equal(
      bootstrapHealDecision({ ...FRESH_STORE, ...spur }),
      BOOTSTRAP_HEAL.BLOCKED_STORE_NOT_FRESH,
      `${JSON.stringify(spur)} beweist einen gelebten Store - hier wird NIE geheilt`,
    );
  }
});

test("Boot-Heilung (GAP-38): fehlende/unbrauchbare Parameter -> BLOCKED_PARAMS (kein stiller Fehl-Seed)", () => {
  for (const params of [{ e164: "" }, { e164: "hallo" }, { provider: "twillio" }, { provider: "" }]) {
    assert.equal(
      bootstrapHealDecision({ ...FRESH_STORE, ...params }),
      BOOTSTRAP_HEAL.BLOCKED_PARAMS,
      `${JSON.stringify(params)} darf keine Nummer seeden (sonst gruener Boot mit totem Routing)`,
    );
  }
});

test("Boot-Heilung (GAP-38): frischer Store + brauchbare Parameter -> HEAL", () => {
  assert.equal(bootstrapHealDecision(FRESH_STORE), BOOTSTRAP_HEAL.HEAL);
});
