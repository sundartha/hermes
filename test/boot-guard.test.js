// P0/AC5: Boot-Entkopplung. Ein Fehler im Web-Login/Portal-Block darf den Boot
// (und damit die Telefonie) NICHT killen. Bewiesen ueber den realen Seam:
// guardedBoot faengt den ECHTEN createPortalRunner-Fault (Superuser -> [F5]) ab.
// Reachable-pg-over-socket ist offline n.v. (pglite ist in-process), darum Fault-
// Injection in das echte createPortalRunner via DI-Pool (User-Entscheidung 2026-06-16).
import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  guardedBoot,
  fakeOriginateBootBlocked,
  meterMappingGaps,
  alertChannelFindings,
  ALERT_CHANNEL_FINDING,
} from "../src/boot-guard.js";
import { createPortalRunner } from "../src/portal-pool.js";

// Erreichbarer Fake-Pool, dessen Rolle Superuser ist -> assertNoBypassRls wirft den
// realen [F5]-Fehler (die reale Boot-Fault einer Superuser-DATABASE_URL).
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

// T-P0-05a: guardedBoot schluckt den Fault, loggt laut, wirft nicht, returnt false.
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

// T-P0-05b: erfolgreicher Block -> returnt true, kein [boot]-deaktiviert-Log.
test("T-P0-05b: guardedBoot returnt true wenn der Block durchlaeuft", async () => {
  let logged = "";
  const orig = console.error;
  console.error = (...a) => {
    logged += a.map(String).join(" ");
  };
  let result;
  try {
    result = await guardedBoot("Web-Login/Portal", async () => {
      /* ok */
    });
  } finally {
    console.error = orig;
  }
  assert.equal(result, true);
  assert.ok(!/deaktiviert/.test(logged));
});

// T-P0-05 (Kern, HTTP-Level): Portal-Fault VOR dem Route-Mount -> /auth/login wird
// nie registriert (404), aber /healthz bleibt 200 und der Server lebt weiter.
test("T-P0-05: Portal-Fault -> /healthz 200, /auth/login 404, Server lebt", async () => {
  const app = express();
  app.get("/healthz", (_q, res) => res.json({ ok: true }));

  const mounted = await guardedBoot("Web-Login/Portal", async () => {
    await createPortalRunner({ pool: superuserPool() }); // wirft [F5] VOR dem Mount
    app.get("/auth/login", (_q, res) => res.send("login")); // nie erreicht
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

// OUT-05 (F2): reine Wahrheitstabelle des Boot-Refusal-Praedikats (kein Spawn noetig).
test("OUT-05 F2: fakeOriginateBootBlocked-Wahrheitstabelle", () => {
  assert.equal(fakeOriginateBootBlocked({ fakeOriginate: true, skipTwilioSignatureCheck: false }), true);
  assert.equal(fakeOriginateBootBlocked({ fakeOriginate: true, skipTwilioSignatureCheck: true }), false);
  assert.equal(fakeOriginateBootBlocked({ fakeOriginate: false, skipTwilioSignatureCheck: false }), false);
  assert.equal(fakeOriginateBootBlocked({ fakeOriginate: false, skipTwilioSignatureCheck: true }), false);
});

// S1-7: meterMappingGaps meldet jede usage_event-Sorte OHNE Stripe-Meter-Abbildung
// (kein Spawn noetig, reine Entscheidung).
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

// LCT P5 (Drift-Waechter): alertChannelFindings ist die reine Wahrheitstabelle des
// Alarmkanal-Guards (kein Spawn noetig, Muster meterMappingGaps). Seit GAP-07 (P6) nimmt
// sie das ganze config.billing-Objekt statt nur der Nummer - die Assertions der beiden
// Bestandsfaelle bleiben unveraendert, nur die Signatur zieht nach.
test("P5-B1: alertChannelFindings('') -> genau ein Befund, UNSET, nicht fatal", () => {
  const findings = alertChannelFindings({ platformAlertSmsTo: "" });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, ALERT_CHANNEL_FINDING.UNSET);
  assert.equal(findings[0].fatal, false);
});

test("P5-B2: alertChannelFindings(nummer) -> [] (Kanal besetzt, kein Befund)", () => {
  assert.deepEqual(alertChannelFindings({ platformAlertSmsTo: "+491234567890" }), []);
});

// GAP-07 (P6): die scharfe Konjunktion ist FATAL, jede Abschwaechung faellt auf die WARN
// zurueck. Hoechstens EIN Befund je Zustand.
test("GAP-07-Wahrheitstabelle: leerer Kanal + Buchung + Warnschwelle>0 -> genau ein FATALER Befund", () => {
  const findings = alertChannelFindings({
    platformAlertSmsTo: "",
    paymentEnabled: true,
    platformSpendWarnPercent: 80,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, ALERT_CHANNEL_FINDING.UNSET_WITH_ACTIVE_WARNING);
  assert.equal(findings[0].fatal, true);
});

test("GAP-07-Wahrheitstabelle: Warnschwelle 0 bzw. keine Buchung -> WARN statt FATAL", () => {
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

test("GAP-07-Wahrheitstabelle: besetzter Kanal liefert auch bei scharfer Warnung [] (Nummer wird nie geloggt)", () => {
  assert.deepEqual(
    alertChannelFindings({
      platformAlertSmsTo: "+491234567890",
      paymentEnabled: true,
      platformSpendWarnPercent: 80,
    }),
    [],
  );
});
