// OUTBOUND-E3b (PM-16): "nicht konfiguriert" darf nie wie "alles gruen" aussehen. Die
// alertChannelFindings-Erweiterung um BOTH_UNSET_WITH_OUTBOUND + platformAlertSenderFindings
// (PM-17). Reine Units gegen boot-guard.js, kein Boot, kein Netz.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  alertChannelFindings,
  alertChannelInputs,
  ALERT_CHANNEL_FINDING,
  platformAlertSenderFindings,
  PLATFORM_ALERT_SENDER_FINDING,
  mailerKonstruierbar,
  driftConfigFindings,
  DRIFT_CONFIG_FINDING,
} from "../src/boot-guard.js";
import { PLATFORM_NUMBER_PURPOSE } from "../src/store/defaults.js";

const WARN_PERCENT_AUS = 0;
const WARN_PERCENT_AN = 80;

test("beide Kanaele leer + EL-Outbound an + Fenster > 0 -> fatal, neuer Code", () => {
  const findings = alertChannelFindings({
    platformAlertSmsTo: "",
    platformAlertMailTo: "",
    elevenLabsOutboundEnabled: true,
    outageAlertWindowMs: 3600000,
    paymentEnabled: false,
    platformSpendWarnPercent: WARN_PERCENT_AUS,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, ALERT_CHANNEL_FINDING.BOTH_UNSET_WITH_OUTBOUND);
  assert.equal(findings[0].fatal, true);
});

test("nur SMS gesetzt -> []", () => {
  const findings = alertChannelFindings({
    platformAlertSmsTo: "+12025550143",
    platformAlertMailTo: "",
    elevenLabsOutboundEnabled: true,
    outageAlertWindowMs: 3600000,
  });
  assert.deepEqual(findings, []);
});

test("Mail-Adresse gesetzt UND Mailer konstruierbar -> die neue FATALE Pruefung greift NICHT mehr (mind. ein VOLLSTAENDIGER Kanal da); die bestehende SMS-spezifische WARN (Spend-Warnung/Tarif-Drift, kein Mail-Alternativkanal) bleibt unveraendert bestehen", () => {
  const findings = alertChannelFindings({
    platformAlertSmsTo: "",
    platformAlertMailTo: "ops@example.test",
    mailerVorhanden: true,
    elevenLabsOutboundEnabled: true,
    outageAlertWindowMs: 3600000,
    paymentEnabled: false,
    platformSpendWarnPercent: WARN_PERCENT_AUS,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, ALERT_CHANNEL_FINDING.UNSET);
  assert.equal(findings[0].fatal, false);
});

// G26/G2-Fix (Review-Blocker Runde 4): Mail-Adresse gesetzt, aber KEIN Mailer
// konstruierbar (weder BREVO_API_KEY noch SMTP_HOST) - genau der Zustand, der am
// laufenden Code "[outage] Kanal mail fehlgeschlagen: Cannot read properties of null"
// erzeugte, waehrend der Boot gruen durchlief. Muss jetzt FATAL sein.
test("Mail-Adresse gesetzt, aber KEIN Mailer konstruierbar -> weiterhin fatal (PM-16, kein stilles Gruen)", () => {
  const findings = alertChannelFindings({
    platformAlertSmsTo: "",
    platformAlertMailTo: "ops@example.test",
    mailerVorhanden: false,
    elevenLabsOutboundEnabled: true,
    outageAlertWindowMs: 3600000,
    paymentEnabled: false,
    platformSpendWarnPercent: WARN_PERCENT_AUS,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, ALERT_CHANNEL_FINDING.BOTH_UNSET_WITH_OUTBOUND);
  assert.equal(findings[0].fatal, true);
});

test("beide leer, aber EL-Outbound AUS -> WARN, nicht fatal", () => {
  const findings = alertChannelFindings({
    platformAlertSmsTo: "",
    platformAlertMailTo: "",
    elevenLabsOutboundEnabled: false,
    outageAlertWindowMs: 3600000,
    paymentEnabled: false,
    platformSpendWarnPercent: WARN_PERCENT_AUS,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, ALERT_CHANNEL_FINDING.UNSET);
  assert.equal(findings[0].fatal, false);
});

test("beide leer, aber OUTAGE_ALERT_WINDOW_MS=0 -> WARN, nicht fatal", () => {
  const findings = alertChannelFindings({
    platformAlertSmsTo: "",
    platformAlertMailTo: "",
    elevenLabsOutboundEnabled: true,
    outageAlertWindowMs: 0,
    paymentEnabled: false,
    platformSpendWarnPercent: WARN_PERCENT_AUS,
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, ALERT_CHANNEL_FINDING.UNSET);
  assert.equal(findings[0].fatal, false);
});

test("die zwei Bestandsbefunde bleiben BYTE-IDENTISCH (Zeichenkettenvergleich)", () => {
  // Bestandsverhalten (LCT P5/GAP-07), unveraendert durch die neuen Parameter: alle drei
  // neuen Parameter fehlen hier komplett (Bestandsaufrufer wie warnAlertChannelUnset).
  const unsetOnly = alertChannelFindings({ platformAlertSmsTo: "", paymentEnabled: false, platformSpendWarnPercent: WARN_PERCENT_AUS });
  assert.equal(unsetOnly.length, 1);
  assert.equal(unsetOnly[0].code, ALERT_CHANNEL_FINDING.UNSET);
  assert.equal(unsetOnly[0].fatal, false);
  assert.equal(
    unsetOnly[0].message,
    "PLATFORM_ALERT_SMS_TO ist leer - Plattform-Warnung und Tarif-Drift-Alarm laufen " +
      "nur ins Audit-Log, es geht KEINE SMS an einen Menschen.",
  );

  const unsetWithWarning = alertChannelFindings({
    platformAlertSmsTo: "",
    paymentEnabled: true,
    platformSpendWarnPercent: WARN_PERCENT_AN,
  });
  assert.equal(unsetWithWarning.length, 1);
  assert.equal(unsetWithWarning[0].code, ALERT_CHANNEL_FINDING.UNSET_WITH_ACTIVE_WARNING);
  assert.equal(unsetWithWarning[0].fatal, true);
  assert.equal(
    unsetWithWarning[0].message,
    "PLATFORM_ALERT_SMS_TO ist leer, obwohl PAYMENT_ENABLED=true und " +
      "PLATFORM_SPEND_WARN_PERCENT>0 - die Plattform-Spend-Warnung haette keinen " +
      "Empfaenger. Empfaenger setzen ODER PLATFORM_SPEND_WARN_PERCENT=0 (Warnung bewusst aus).",
  );
});

test("gesetzte SMS-Nummer -> [] wie bisher, unabhaengig von den neuen Parametern", () => {
  const findings = alertChannelFindings({
    platformAlertSmsTo: "+12025550143",
    paymentEnabled: true,
    platformSpendWarnPercent: WARN_PERCENT_AN,
  });
  assert.deepEqual(findings, []);
});

// ---- PM-17: platformAlertSenderFindings ----

test("PM-17: keine offene alert_sms_sender-Bindung -> WARN, nicht fatal", () => {
  const findings = platformAlertSenderFindings({ openBindings: [] });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, PLATFORM_ALERT_SENDER_FINDING.UNBOUND);
  assert.equal(findings[0].fatal, false);
});

test("PM-17: eine offene alert_sms_sender-Bindung -> []", () => {
  const findings = platformAlertSenderFindings({
    openBindings: [{ purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER, e164: "+15005550006" }],
  });
  assert.deepEqual(findings, []);
});

test("PM-17: nur eine outbound_ani-Bindung (falsche Rolle) -> WARN", () => {
  const findings = platformAlertSenderFindings({
    openBindings: [{ purpose: PLATFORM_NUMBER_PURPOSE.OUTBOUND_ANI, e164: "+15005550006" }],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, PLATFORM_ALERT_SENDER_FINDING.UNBOUND);
});

test("PM-17: openBindings undefined -> WARN (Default leer), kein Wurf", () => {
  assert.doesNotThrow(() => platformAlertSenderFindings({}));
  const findings = platformAlertSenderFindings({});
  assert.equal(findings.length, 1);
});

// G5-Fix (Review-Blocker Runde 2): alertChannelInputs war byte-identisch in boot.js und
// config.js dupliziert (die Zusammenfuehrung der drei Namespaces zu EINEM
// alertChannelFindings-Eingabeobjekt) - jetzt EINE exportierte Quelle, beide Aufrufer
// reichen nur noch ihre Namespaces durch.
test("G5: alertChannelInputs fuehrt billing/mail/voice zu EINEM Eingabeobjekt zusammen (inkl. mailerVorhanden, G26-Fix)", () => {
  const merged = alertChannelInputs({
    billing: { platformAlertSmsTo: "+12025550143", paymentEnabled: true },
    mail: { platformAlertMailTo: "ops@example.test", brevoApiKey: "key-123" },
    voice: { elevenLabsOutbound: { enabled: true } },
  });
  assert.equal(merged.platformAlertSmsTo, "+12025550143");
  assert.equal(merged.paymentEnabled, true);
  assert.equal(merged.platformAlertMailTo, "ops@example.test");
  assert.equal(merged.mailerVorhanden, true);
  assert.equal(merged.elevenLabsOutboundEnabled, true);
});

test("G5: alertChannelInputs-Ergebnis ist direkt an alertChannelFindings uebergebbar", () => {
  const merged = alertChannelInputs({
    billing: { platformAlertSmsTo: "" },
    mail: { platformAlertMailTo: "" },
    voice: { elevenLabsOutbound: { enabled: true } },
  });
  const findings = alertChannelFindings({ ...merged, outageAlertWindowMs: 3600000 });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, ALERT_CHANNEL_FINDING.BOTH_UNSET_WITH_OUTBOUND);
});

// G26-Fix: Mail-Adresse gesetzt, aber WEDER BREVO_API_KEY NOCH SMTP_HOST -> mailerVorhanden
// ist false und der BOTH_UNSET_WITH_OUTBOUND-Riegel greift trotz gesetzter Adresse.
test("G5/G26: alertChannelInputs liest mailerVorhanden aus mail.brevoApiKey/mail.smtpHost - Adresse ALLEIN reicht nicht", () => {
  const merged = alertChannelInputs({
    billing: { platformAlertSmsTo: "" },
    mail: { platformAlertMailTo: "ops@example.test" },
    voice: { elevenLabsOutbound: { enabled: true } },
  });
  assert.equal(merged.mailerVorhanden, false);
  const findings = alertChannelFindings({ ...merged, outageAlertWindowMs: 3600000 });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, ALERT_CHANNEL_FINDING.BOTH_UNSET_WITH_OUTBOUND);
});

// ---- G26/G2-Fix (Review-Blocker Runde 4): mailerKonstruierbar - EINE Quelle, gemeinsam
// gelesen von selectMailer (wiring/web-login.js) und alertChannelFindings hier. ----

test("mailerKonstruierbar: weder Brevo-Schluessel noch SMTP-Host -> false", () => {
  assert.equal(mailerKonstruierbar({ brevoApiKey: "", smtpHost: "" }), false);
});

test("mailerKonstruierbar: nur Brevo-Schluessel -> true", () => {
  assert.equal(mailerKonstruierbar({ brevoApiKey: "key-123", smtpHost: "" }), true);
});

test("mailerKonstruierbar: nur SMTP-Host -> true", () => {
  assert.equal(mailerKonstruierbar({ brevoApiKey: "", smtpHost: "smtp.zoho.eu" }), true);
});

test("mailerKonstruierbar: kein Argument -> false, kein Wurf", () => {
  assert.doesNotThrow(() => mailerKonstruierbar());
  assert.equal(mailerKonstruierbar(), false);
});

// ---- OUTBOUND-E4 (PM-16): driftConfigFindings - "leer" darf nie wie "alles gruen"
// aussehen. NIE fatal (Muster platformAniFindings: ein Boot-Refusal toetete den Inbound,
// der vom Ausfall gar nicht betroffen ist). ----

test("driftConfigFindings: beide IDs gesetzt -> []", () => {
  const findings = driftConfigFindings({
    fqdnConnectionId: "3026479542865757220",
    outboundVoiceProfileId: "ovp_1",
    elevenLabsOutboundEnabled: true,
  });
  assert.deepEqual(findings, []);
});

test("driftConfigFindings: beide leer, EL-Outbound AUS -> WARN, nie fatal", () => {
  const findings = driftConfigFindings({ fqdnConnectionId: "", outboundVoiceProfileId: "", elevenLabsOutboundEnabled: false });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, DRIFT_CONFIG_FINDING.UNSET);
  assert.equal(findings[0].fatal, false);
  assert.match(findings[0].message, /TELNYX_FQDN_CONNECTION_ID/);
  assert.match(findings[0].message, /TELNYX_OUTBOUND_VOICE_PROFILE_ID/);
});

test("driftConfigFindings: beide leer, EL-Outbound AN -> WARN dringlicher (UNSET_WITH_OUTBOUND), nie fatal", () => {
  const findings = driftConfigFindings({ fqdnConnectionId: "", outboundVoiceProfileId: "", elevenLabsOutboundEnabled: true });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].code, DRIFT_CONFIG_FINDING.UNSET_WITH_OUTBOUND);
  assert.equal(findings[0].fatal, false);
});

test("driftConfigFindings: nur EINE der beiden IDs gesetzt -> Befund nennt NUR die fehlende", () => {
  const findings = driftConfigFindings({
    fqdnConnectionId: "3026479542865757220",
    outboundVoiceProfileId: "",
    elevenLabsOutboundEnabled: false,
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0].message, /TELNYX_OUTBOUND_VOICE_PROFILE_ID/);
  assert.doesNotMatch(findings[0].message, /TELNYX_FQDN_CONNECTION_ID/);
});
