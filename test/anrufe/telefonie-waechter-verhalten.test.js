import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../../src/config.ts";
import { makeStripeWebhookRoute } from "../../src/routes/stripe-webhook.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { startServer, seedState, seedCall, warteAufEreignis, DOMESTIC_TEST_NUMBER } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAttrappe } from "./attrappen-server.js";
import { starteBetterStackAttrappe } from "../gemeinsam/better-stack-attrappe.mjs";
import { STRIPE_ALARM_GEHEIMNIS, TELNYX_MESSZEILE_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const KURZER_TAKT_MS = 50;
const TAG_MS = 86_400_000;
const FRIST = { timeout: 60_000 };
const SENDER = "+15005550006";
const SMS_ZIEL = "+491711234567";
const MAIL_ZIEL = "betreiber@waechter.invalid";
const HALT_NUMMER = "+493012345000";
const EIMER_SELBSTTEST = "self-test:alert-channel";
const EIMER_HALT = "hold:platform_number_in_use:n_halt";
const KOPF = "Hermes Betriebsmeldung\n";
const SELBSTTEST_TEXT = `${KOPF}Alarmkanal funktioniert (Selbsttest)`;
const HALT_TEXT = `${KOPF}klasse=platform_number_in_use kuendigungen=1 nummern=1 warten seit ueber der Eskalations-Schwelle auf die Freigabe einer Rufnummer`;
const WARNUNG_OHNE_ABSENDER = "[alert-sms] Ausfall-Melder: keine gebundene Alarm-Absendernummer, KEINE SMS";
const WARNUNG_OHNE_BOOTSTRAP = "[alert-sms] Plattform-Alarm: keine aktive Bootstrap-Nummer, KEINE SMS";
const SMS_FEHLER = "Kanal sms fehlgeschlagen";
const MELDER_FEHLER = "Ausfall-Melder fehlgeschlagen";
const ZIEL = "+4915112345678";
const geoeffnet = [];
after(async () => {
  await Promise.all(geoeffnet.map((schliessen) => schliessen()));
});
async function starteAnbieter(behandle) {
  const anfragen = [];
  const attrappe = await starteAttrappe((req, res) => {
    let koerper = "";
    req.on("data", (stueck) => (koerper += stueck));
    req.on("end", () => behandle({ req, res, koerper, anfragen }));
  });
  geoeffnet.push(attrappe.close);
  return { ...attrappe, anfragen };
}
const antworte = (res, status) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end("{}");
};
async function starteTelnyx() {
  return starteAnbieter(({ req, res, koerper, anfragen }) => {
    anfragen.push({ pfad: req.url, koerper: koerper ? JSON.parse(koerper) : null });
    antworte(res, HTTP_OK);
  });
}
async function starteMail({ halten = false } = {}) {
  const wartende = [];
  const mails = [];
  const anbieter = await starteAnbieter(({ req, res, koerper }) => {
    if (req.method !== "POST" || req.url !== "/v3/smtp/email") return antworte(res, HTTP_OK);
    const mail = JSON.parse(koerper);
    mails.push({ an: mail.to[0].email, betreff: mail.subject, text: mail.textContent });
    if (halten) wartende.push(res);
    else antworte(res, HTTP_CREATED);
  });
  return { ...anbieter, mails, freigeben: () => wartende.splice(0).forEach((res) => antworte(res, HTTP_CREATED)) };
}
function taktUndMailUmleitung(mailUrl) {
  return [
    "const takt = Number(process.env.COST_TRUING_SWEEP_INTERVAL_MS);",
    "const echtesIntervall = globalThis.setInterval;",
    `globalThis.setInterval = (fn, ms, ...rest) => echtesIntervall(fn, ms === takt ? ${KURZER_TAKT_MS} : ms, ...rest);`,
    "const echtesFetch = globalThis.fetch;",
    `globalThis.fetch = (url, optionen) => echtesFetch(String(url).replace("https://api.brevo.com", ${JSON.stringify(mailUrl)}), optionen);`,
  ].join("\n");
}
function serverUmgebung({ telnyx, mail, eingang, zusatz = {} }) {
  return {
    COST_TRUING_SWEEP_INTERVAL_MS: "61000",
    OUTAGE_ALERT_WINDOW_MS: String(TAG_MS),
    OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: String(TAG_MS),
    PLATFORM_HOLD_ESCALATION_MAX_AGE_MS: String(TAG_MS),
    PLATFORM_ALERT_MAIL_TO: MAIL_ZIEL,
    PLATFORM_ALERT_SMS_TO: SMS_ZIEL,
    BETTERSTACK_ALERT_URL: eingang.url,
    BREVO_API_KEY: "waechter-mail-schluessel",
    MAIL_FROM: "hermes@waechter.invalid",
    TELNYX_API_KEY: TELNYX_MESSZEILE_SCHLUESSEL,
    TELNYX_API_BASE: telnyx.url,
    NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(taktUndMailUmleitung(mail.url))}`,
    ...zusatz,
  };
}
const vorTagen = (tage) => new Date(Date.now() - tage * TAG_MS).toISOString();
function haltStand({ selbsttestMarker } = {}) {
  const stand = seedState({
    tenants: [{ id: "t_halt", numberReleasePending: true, workosDeletePending: false, suspendedAt: vorTagen(2) }],
    numbers: [{ id: "n_halt", tenantId: "t_halt", status: "active", provider: "telnyx", providerNumberId: "ext_halt", e164: HALT_NUMMER }],
  });
  stand.outageAlerts = selbsttestMarker ? [selbsttestMarker] : [];
  stand.platformNumberUse = [
    { id: "pnu_halt", e164: HALT_NUMMER, purpose: "outbound_ani", provider: "telnyx", tenantId: null, providerNumberId: null, boundAt: new Date().toISOString(), releasedAt: null, note: null },
  ];
  return stand;
}
async function mitServer(optionen, ablauf) {
  const srv = await startServer(optionen);
  try {
    return await ablauf(srv);
  } catch (fehler) {
    throw new Error(`${fehler.message}\n${srv.stdout}`, { cause: fehler });
  } finally {
    await srv.stop();
  }
}
const anruf = (srv, id) => srv.readStore().calls.find((call) => call.id === id);
const marker = (srv, code) => srv.readStore().outageAlerts.find((alert) => alert.code === code);
const mailsMit = (mail, teil) => mail.mails.filter(({ text }) => text.includes(teil));
const smsKoerper = (telnyx) => telnyx.anfragen.filter(({ pfad }) => pfad === "/v2/messages").map(({ koerper }) => koerper);
const gleich = (ist, soll, text = "") => assert.ok(JSON.stringify(ist) === JSON.stringify(soll), `${text} ist=${JSON.stringify(ist)} soll=${JSON.stringify(soll)}`.slice(0, 1500));
const alarmSms = (telnyx) => smsKoerper(telnyx).filter(({ text }) => text.startsWith(KOPF));
const warteAuf = (quellen, bedingung) => warteAufEreignis(quellen, bedingung, { timeoutMs: 30_000 });

async function starteEingang(optionen) {
  const eingang = await starteBetterStackAttrappe(optionen);
  geoeffnet.push(eingang.close);
  return eingang;
}
const eigeneMails = (mail) => mailsMit(mail, KOPF);
const ohneKosten = (eingang) => eingang.meldungen.filter(({ id }) => !id.startsWith("kosten:"));

test("Wachtakt: Selbsttest und Halte-Eskalation melden als Vorfall an den Eingang, der Sendeplatz ist vor der Zustellung gespeichert", FRIST, async () => {
  const [telnyx, mail, eingang] = await Promise.all([starteTelnyx(), starteMail(), starteEingang({ halten: true })]);
  const env = serverUmgebung({ telnyx, mail, eingang });
  await mitServer({ env, seed: haltStand() }, async (srv) => {
    await warteAuf([srv.ereignisse, eingang.ereignisse], () => ohneKosten(eingang).length === 2);
    for (const code of [EIMER_SELBSTTEST, EIMER_HALT]) {
      await warteAuf([srv.ereignisse, eingang.ereignisse], () => marker(srv, code));
      assert.equal(marker(srv, code).reportedAt, null, `${code}: vor der Zustellung nichts als gemeldet`);
      assert.equal(marker(srv, code).deliveredChannels, null, code);
    }
    eingang.freigeben();
    for (const code of [EIMER_SELBSTTEST, EIMER_HALT]) await warteAuf([srv.ereignisse, eingang.ereignisse], () => marker(srv, code).deliveredChannels === "better-stack");
    for (const code of [EIMER_SELBSTTEST, EIMER_HALT]) await warteAuf([srv.ereignisse, eingang.ereignisse], () => marker(srv, code).reportedAt);
    await warteAuf([srv.ereignisse, eingang.ereignisse], () => ["[outage] alert_channel_self_test", "[outage] platform_hold_escalation klasse=" + EIMER_HALT].every((zeile) => srv.stdout.includes(zeile)));
    gleich(ohneKosten(eingang).map(({ id, status, text }) => [id, status, text]).sort(), [
      [EIMER_HALT, "alert", HALT_TEXT],
      [EIMER_SELBSTTEST, "alert", SELBSTTEST_TEXT],
    ]);
    gleich(eigeneMails(mail), [], "keine Mail");
    gleich(alarmSms(telnyx), [], "keine SMS");
    assert.ok(!srv.stdout.includes(SMS_FEHLER), srv.stdout);
  });
});

test("Wachtakt: ohne gebundene Absendernummer meldet die Halte-Eskalation trotzdem als Vorfall; ein noch nicht faelliger Selbsttest bleibt unberuehrt", FRIST, async () => {
  const [telnyx, mail, eingang] = await Promise.all([starteTelnyx(), starteMail(), starteEingang()]);
  const zuletzt = vorTagen(0);
  const gesetzt = { id: "otg_selbst", code: EIMER_SELBSTTEST, firstSeenAt: zuletzt, lastSeenAt: zuletzt, lastAttemptAt: zuletzt, reportedAt: zuletzt, deliveredChannels: "mail", closedAt: null };
  const env = serverUmgebung({ telnyx, mail, eingang });
  await mitServer({ env, seed: haltStand({ selbsttestMarker: gesetzt }), ownerNumber: null }, async (srv) => {
    await warteAuf([srv.ereignisse, eingang.ereignisse], () => marker(srv, EIMER_HALT)?.reportedAt);
    await eingang.schranke();
    gleich(ohneKosten(eingang).map(({ id, text }) => [id, text]), [[EIMER_HALT, HALT_TEXT]]);
    assert.ok(!srv.stdout.includes(WARNUNG_OHNE_ABSENDER), srv.stdout);
    gleich(eigeneMails(mail), [], "keine Mail");
    assert.deepEqual(smsKoerper(telnyx), []);
    assert.deepEqual(marker(srv, EIMER_SELBSTTEST), gesetzt);
    assert.ok(!srv.stdout.includes("alert_channel_self_test"), srv.stdout);
  });
});
function ausfallStand() {
  const stand = seedState();
  const von = { from: DOMESTIC_TEST_NUMBER.e164, to: ZIEL, status: "active" };
  stand.calls = [
    ...[1, 2, 3].map((nr) => seedCall({ id: `call_aus_${nr}`, ...von })),
    seedCall({ id: "call_besetzt", ...von }),
    seedCall({ id: "call_ein", direction: "inbound", from: ZIEL, to: DOMESTIC_TEST_NUMBER.e164, answeredAt: vorTagen(0), transcript: [] }),
  ];
  return stand;
}
const meldeEnde = (srv, id, felder) =>
  abrufMitFrist(`${srv.localUrl}/voice/status?callId=${id}`, { method: "POST", body: new URLSearchParams(felder) }).then((antwort) =>
    assert.equal(antwort.status, HTTP_OK),
  );

test("Anrufende: nicht gestartete Anrufe melden genau einmal als Vorfall, andere Enden und Eingangsanrufe loesen keinen Befund aus", FRIST, async () => {
  const [telnyx, mail, eingang] = await Promise.all([starteTelnyx(), starteMail(), starteEingang()]);
  const zusatz = { OUTAGE_ALERT_MIN_FAILURES: "2", OUTAGE_ALERT_RETRY_MS: "0", INBOUND_OUTAGE_ALERT_WINDOW_MS: String(TAG_MS), OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: "0", PLATFORM_HOLD_ESCALATION_MAX_AGE_MS: "0" };
  const env = serverUmgebung({ telnyx, mail, eingang, zusatz });
  const ausfallMeldungen = () => eingang.meldungen.filter(({ id }) => id === "not-placed:invite-403");
  await mitServer({ env, seed: ausfallStand() }, async (srv) => {
    const abgelehnt = { CallStatus: "failed", SipHangupCause: "403" };
    await meldeEnde(srv, "call_besetzt", { CallStatus: "busy" });
    await meldeEnde(srv, "call_ein", { CallStatus: "completed" });
    await meldeEnde(srv, "call_aus_1", abgelehnt);
    await warteAuf([srv.ereignisse, eingang.ereignisse], () => marker(srv, "not-placed:invite-403"));
    await eingang.schranke();
    gleich(ausfallMeldungen(), [], "der Erstbefund meldet nichts");
    await meldeEnde(srv, "call_aus_2", abgelehnt);
    await warteAuf([srv.ereignisse, eingang.ereignisse], () => ausfallMeldungen().length === 1);
    await warteAuf([srv.ereignisse, eingang.ereignisse], () => marker(srv, "not-placed:invite-403").reportedAt);
    await warteAuf([srv.ereignisse, eingang.ereignisse], () => srv.stdout.includes("outage_detected"));
    await meldeEnde(srv, "call_aus_3", abgelehnt);
    await warteAuf([srv.ereignisse, eingang.ereignisse], () => anruf(srv, "call_aus_3").endedAt);
    await eingang.schranke();
    const alarm = `${KOPF}klasse=not-placed:invite-403 fehler=2 versuche=3 erfolge=0 tenants=1 fenster_min=1440 regel=alarm`;
    gleich(ausfallMeldungen().map(({ status, text }) => [status, text]), [["alert", alarm]]);
    assert.equal(marker(srv, "not-placed:invite-403").deliveredChannels, "better-stack");
    gleich(eigeneMails(mail), [], "keine Mail");
    gleich(alarmSms(telnyx), [], "keine SMS");
    const codes = srv.readStore().outageAlerts.map((alert) => alert.code);
    gleich(codes.filter((code) => !code.startsWith("kosten:")), ["not-placed:invite-403"]);
    assert.ok(!srv.stdout.includes(MELDER_FEHLER), srv.stdout);
  });
});

test("Wachtakt ohne Eingang: der Alarm gilt nicht als zugestellt und wird weder per Mail noch per SMS ersetzt", FRIST, async () => {
  const [telnyx, mail, eingang] = await Promise.all([starteTelnyx(), starteMail(), starteEingang()]);
  const env = { ...serverUmgebung({ telnyx, mail, eingang }), BETTERSTACK_ALERT_URL: "" };
  await mitServer({ env, seed: haltStand() }, async (srv) => {
    await warteAuf([srv.ereignisse, eingang.ereignisse], () => marker(srv, EIMER_HALT)?.lastAttemptAt && marker(srv, EIMER_SELBSTTEST)?.lastAttemptAt);
    for (const code of [EIMER_HALT, EIMER_SELBSTTEST]) {
      assert.equal(marker(srv, code).reportedAt, null, code);
      assert.equal(marker(srv, code).deliveredChannels, null, code);
    }
    gleich(eingang.meldungen, []);
    assert.deepEqual(mail.mails, []);
    assert.deepEqual(smsKoerper(telnyx), []);
  });
});
const GELD_WARNUNG = "[stripe-money-event] Alarm-SMS fehlgeschlagen: sms kaputt";
config.server.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-waechter-"));
const speicher = await import("../../src/store.js");
speicher.load().tenants.push({ id: "t_waechter", stripeCustomerId: "cus_waechter", status: "active" });
let ereignisNr = 0;
async function sendeRueckbuchung(messaging, betterstackAlertUrl) {
  ereignisNr += 1;
  const koerper = JSON.stringify({ id: `evt_waechter_${ereignisNr}`, type: "charge.dispute.created", data: { object: { customer: "cus_waechter" } } });
  const zeit = Math.floor(Date.now() / 1000);
  const mac = crypto.createHmac("sha256", STRIPE_ALARM_GEHEIMNIS).update(`${zeit}.${koerper}`).digest("hex");
  const route = makeStripeWebhookRoute({
    config: withConfigNamespaces({ paymentEnabled: true, stripeWebhookSecret: STRIPE_ALARM_GEHEIMNIS, platformAlertSmsTo: SMS_ZIEL, betterstackAlertUrl }),
    store: speicher, audit: () => {}, accounts: {}, sessions: {}, billing: {}, provision: async () => {}, messaging,
  });
  const res = { json: (antwort) => antwort, status: () => res };
  await route({ rawBody: Buffer.from(koerper), headers: { "stripe-signature": `t=${zeit},v1=${mac}` } }, res);
}
async function mitMeldungen(ablauf) {
  const zeilen = [];
  const ereignisse = new EventEmitter();
  const original = { warn: console.warn, error: console.error };
  console.warn = (...teile) => {
    zeilen.push(teile.map(String).join(" "));
    ereignisse.emit("aenderung");
  };
  console.error = console.warn;
  try {
    await ablauf(zeilen, ereignisse);
  } finally {
    Object.assign(console, original);
  }
}

test("Alarm-SMS an den Betreiber: ohne Bootstrap-Nummer nur die Warnung, mit Nummer eine Fehlermeldung bei abgelehntem Versand", async () => {
  await mitMeldungen(async (zeilen, ereignisse) => {
    const betterStack = await starteBetterStackAttrappe({ antwortStatus: 500 });
    const versendet = [];
    try {
      await sendeRueckbuchung(() => ({ sendSms: async (sms) => versendet.push(sms) }), betterStack.url);
      await betterStack.aufMeldungen(1);
      assert.deepEqual(versendet, []);
      await warteAuf([ereignisse], () => zeilen.some((zeile) => /^\[stripe-money-event\] Better-Stack-Meldung stripe-money-event:\S+ nicht zugestellt: HTTP 500$/.test(zeile)));
      speicher.load().numbers.push({ id: "num_boot", e164: SENDER, tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx", status: "active" });
      await sendeRueckbuchung(() => ({ sendSms: async () => Promise.reject(new Error("sms kaputt")) }), betterStack.url);
      await betterStack.aufMeldungen(2);
      assert.ok(!zeilen.includes(WARNUNG_OHNE_BOOTSTRAP), "kein SMS-Weg mehr");
      assert.ok(!zeilen.includes(GELD_WARNUNG), "kein SMS-Weg mehr");
    } finally {
      await betterStack.close();
    }
  });
});
