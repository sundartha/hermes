import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { config } from "../../src/config.js";
import { makeStripeWebhookRoute } from "../../src/routes/stripe-webhook.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { startServer, seedState, seedCall, waitUntil, DOMESTIC_TEST_NUMBER } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAttrappe } from "./attrappen-server.js";
import { STRIPE_ALARM_GEHEIMNIS, TELNYX_MESSZEILE_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_ANI_ABGELEHNT = 503;
const KURZER_TAKT_MS = 50;
const TAG_MS = 86_400_000;
const FRIST = { timeout: 60_000 };
const ANI_ZEITGRENZE_MS = 3_500;
const ANI_TIMEOUT_MS = 4_000;
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
function serverUmgebung({ telnyx, mail, zusatz = {} }) {
  return {
    COST_TRUING_SWEEP_INTERVAL_MS: "61000",
    PLATFORM_ANI_E164: HALT_NUMMER,
    OUTAGE_ALERT_WINDOW_MS: String(TAG_MS),
    OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: String(TAG_MS),
    PLATFORM_HOLD_ESCALATION_MAX_AGE_MS: String(TAG_MS),
    PLATFORM_ALERT_MAIL_TO: MAIL_ZIEL,
    PLATFORM_ALERT_SMS_TO: SMS_ZIEL,
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
const warteAuf = (bedingung) => waitUntil(bedingung, { timeoutMs: 30_000 });

test("Wachtakt: Selbsttest und Halte-Eskalation melden ueber Mail und SMS, der Sendeplatz ist vor der Zustellung gespeichert", FRIST, async () => {
  const [telnyx, mail] = await Promise.all([starteTelnyx(), starteMail({ halten: true })]);
  const env = serverUmgebung({ telnyx, mail });
  await mitServer({ env, seed: haltStand() }, async (srv) => {
    await warteAuf(() => [HALT_TEXT, SELBSTTEST_TEXT].every((text) => mail.mails.some((mail) => mail.text === text)));
    for (const code of [EIMER_SELBSTTEST, EIMER_HALT]) {
      await warteAuf(() => marker(srv, code));
      assert.equal(marker(srv, code).reportedAt, null, `${code}: vor der Zustellung nichts als gemeldet`);
      assert.equal(marker(srv, code).deliveredChannels, null, code);
    }
    mail.freigeben();
    for (const code of [EIMER_SELBSTTEST, EIMER_HALT]) await warteAuf(() => marker(srv, code).deliveredChannels === "mail");
    await warteAuf(() => smsKoerper(telnyx).length >= 2);
    const eigene = mailsMit(mail, KOPF);
    const texte = eigene.map(({ text }) => text).sort();
    assert.deepEqual(texte, [HALT_TEXT, SELBSTTEST_TEXT].sort());
    assert.deepEqual([...new Set(eigene.map(({ betreff, an }) => `${betreff}|${an}`))], [`${KOPF.trim()}|${MAIL_ZIEL}`]);
    const sms = smsKoerper(telnyx).filter(({ text }) => text.startsWith(KOPF));
    assert.deepEqual(sms.map(({ text }) => text).sort(), [HALT_TEXT, SELBSTTEST_TEXT].sort());
    assert.ok(sms.every(({ from, to }) => from === SENDER && to === SMS_ZIEL), JSON.stringify(sms));
    for (const zeile of ["[outage] alert_channel_self_test", "[outage] platform_hold_escalation klasse=" + EIMER_HALT])
      assert.ok(srv.stdout.includes(zeile), `${zeile}\n${srv.stdout}`);
    assert.ok(!srv.stdout.includes(SMS_FEHLER), srv.stdout);
  });
});

test("Wachtakt: ohne gebundene Absendernummer keine SMS, nur die Warnung; ein noch nicht faelliger Selbsttest bleibt unberuehrt", FRIST, async () => {
  const [telnyx, mail] = await Promise.all([starteTelnyx(), starteMail()]);
  const zuletzt = vorTagen(0);
  const gesetzt = { id: "otg_selbst", code: EIMER_SELBSTTEST, firstSeenAt: zuletzt, lastSeenAt: zuletzt, lastAttemptAt: zuletzt, reportedAt: zuletzt, deliveredChannels: "mail", closedAt: null };
  const env = serverUmgebung({ telnyx, mail });
  await mitServer({ env, seed: haltStand({ selbsttestMarker: gesetzt }), ownerNumber: null }, async (srv) => {
    await warteAuf(() => mailsMit(mail, "kuendigungen").length >= 1);
    await warteAuf(() => srv.stdout.includes(WARNUNG_OHNE_ABSENDER));
    assert.deepEqual(mailsMit(mail, "kuendigungen").map(({ text }) => text), [HALT_TEXT]);
    assert.ok(!srv.stdout.includes(SMS_FEHLER), srv.stdout);
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

test("Anrufende: nicht gestartete Anrufe melden genau einmal, andere Enden und Eingangsanrufe loesen keinen Befund aus", FRIST, async () => {
  const [telnyx, mail] = await Promise.all([starteTelnyx(), starteMail()]);
  const zusatz = { OUTAGE_ALERT_MIN_FAILURES: "2", OUTAGE_ALERT_RETRY_MS: "0", INBOUND_OUTAGE_ALERT_WINDOW_MS: String(TAG_MS), OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: "0", PLATFORM_HOLD_ESCALATION_MAX_AGE_MS: "0" };
  const env = serverUmgebung({ telnyx, mail, zusatz });
  await mitServer({ env, seed: ausfallStand() }, async (srv) => {
    const abgelehnt = { CallStatus: "failed", SipHangupCause: "403" };
    await meldeEnde(srv, "call_besetzt", { CallStatus: "busy" });
    await meldeEnde(srv, "call_ein", { CallStatus: "completed" });
    await meldeEnde(srv, "call_aus_1", abgelehnt);
    await warteAuf(() => marker(srv, "not-placed:invite-403"));
    assert.deepEqual(mailsMit(mail, "not-placed"), [], "der Erstbefund meldet nichts");
    await meldeEnde(srv, "call_aus_2", abgelehnt);
    await warteAuf(() => mailsMit(mail, "not-placed").length === 1);
    await warteAuf(() => smsKoerper(telnyx).length > 0);
    await meldeEnde(srv, "call_aus_3", abgelehnt);
    await warteAuf(() => srv.stdout.includes("outage_detected"));
    await warteAuf(() => anruf(srv, "call_aus_3").endedAt);
    const alarm = `${KOPF}klasse=not-placed:invite-403 fehler=2 versuche=3 erfolge=0 tenants=1 fenster_min=1440 regel=alarm`;
    assert.deepEqual(mailsMit(mail, "not-placed").map(({ text }) => text), [alarm]);
    assert.equal(marker(srv, "not-placed:invite-403").deliveredChannels, "mail");
    const sms = smsKoerper(telnyx).filter(({ text }) => text.startsWith(KOPF));
    assert.deepEqual(sms, [{ from: SENDER, to: SMS_ZIEL, text: alarm }]);
    const codes = srv.readStore().outageAlerts.map((alert) => alert.code);
    assert.deepEqual(codes.filter((code) => !code.startsWith("kosten:")), ["not-placed:invite-403"]);
    assert.ok(!srv.stdout.includes(MELDER_FEHLER), srv.stdout);
  });
});

test("Wachtakt ohne Mailziel: der Alarm gilt ueber den Kanal ohne Ziel als zugestellt", FRIST, async () => {
  const [telnyx, mail] = await Promise.all([starteTelnyx(), starteMail()]);
  const env = serverUmgebung({ telnyx, mail, zusatz: { PLATFORM_ALERT_MAIL_TO: "" } });
  await mitServer({ env, seed: haltStand() }, async (srv) => {
    await warteAuf(() => marker(srv, EIMER_HALT)?.deliveredChannels === "mail");
    assert.equal(marker(srv, EIMER_SELBSTTEST).deliveredChannels, "mail");
    assert.deepEqual(mail.mails, []);
  });
});
function aniAufruf(telnyxHandler) {
  return async () => {
    const telnyx = await new Promise((fertig) => {
      const server = http.createServer(telnyxHandler);
      server.listen(0, "127.0.0.1", () => fertig(server));
    });
    const stand = seedState();
    stand.outageAlerts = [{ code: "drift:ownership_lost", closedAt: null, lastSeenAt: new Date().toISOString() }];
    const env = {
      OUTBOUND_ANI_GATE_ENABLED: "true",
      PLATFORM_ANI_E164: "+13125550111",
      ALLOWED_NUMBERS: ZIEL,
      TELNYX_API_KEY: TELNYX_MESSZEILE_SCHLUESSEL,
      TELNYX_CONNECTION_ID: "conn_test",
      TELNYX_ACCOUNT_SID: "acct_test",
      TELNYX_API_BASE: `http://127.0.0.1:${telnyx.address().port}`,
    };
    try {
      return await mitServer({ seed: stand, env }, async (srv) => {
        const beginn = Date.now();
        const antwort = await abrufMitFrist(
          `${srv.localUrl}/api/calls`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: ZIEL, objective: "Termin vereinbaren" }) },
          { wartezeitMs: ANI_TIMEOUT_MS },
        );
        return { status: antwort.status, dauerMs: Date.now() - beginn };
      });
    } finally {
      telnyx.closeAllConnections();
      await new Promise((fertig) => telnyx.close(fertig));
    }
  };
}

test("Absender-Nachmessung: scheitert die Abfrage beim Anbieter, geht der Anruf sofort weiter", FRIST, async () => {
  const ergebnis = await aniAufruf((req, res) => antworte(res, 500))();
  assert.notEqual(ergebnis.status, HTTP_ANI_ABGELEHNT);
  assert.ok(ergebnis.dauerMs < ANI_ZEITGRENZE_MS, `Dauer ${ergebnis.dauerMs} ms`);
});

test("Absender-Nachmessung: antwortet der Anbieter nicht, geht der Anruf nach dem Timeout weiter", FRIST, async () => {
  const ergebnis = await aniAufruf((req, res) => (req.url.startsWith("/v2/phone_numbers") ? undefined : antworte(res, 404)))();
  assert.notEqual(ergebnis.status, HTTP_ANI_ABGELEHNT);
  assert.ok(ergebnis.dauerMs >= ANI_TIMEOUT_MS - 200, `Dauer ${ergebnis.dauerMs} ms`);
});
const GELD_WARNUNG = "[stripe-money-event] Alarm-SMS fehlgeschlagen: sms kaputt";
config.server.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-waechter-"));
const speicher = await import("../../src/store.js");
speicher.load().tenants.push({ id: "t_waechter", stripeCustomerId: "cus_waechter", status: "active" });
let ereignisNr = 0;
async function sendeRueckbuchung(messaging) {
  ereignisNr += 1;
  const koerper = JSON.stringify({ id: `evt_waechter_${ereignisNr}`, type: "charge.dispute.created", data: { object: { customer: "cus_waechter" } } });
  const zeit = Math.floor(Date.now() / 1000);
  const mac = crypto.createHmac("sha256", STRIPE_ALARM_GEHEIMNIS).update(`${zeit}.${koerper}`).digest("hex");
  const route = makeStripeWebhookRoute({
    config: withConfigNamespaces({ paymentEnabled: true, stripeWebhookSecret: STRIPE_ALARM_GEHEIMNIS, platformAlertSmsTo: SMS_ZIEL }),
    store: speicher, audit: () => {}, accounts: {}, sessions: {}, billing: {}, provision: async () => {}, messaging,
  });
  const res = { json: (antwort) => antwort, status: () => res };
  await route({ rawBody: Buffer.from(koerper), headers: { "stripe-signature": `t=${zeit},v1=${mac}` } }, res);
}
async function mitMeldungen(ablauf) {
  const zeilen = [];
  const original = { warn: console.warn, error: console.error };
  console.warn = (...teile) => zeilen.push(teile.map(String).join(" "));
  console.error = console.warn;
  try {
    await ablauf(zeilen);
  } finally {
    Object.assign(console, original);
  }
}

test("Alarm-SMS an den Betreiber: ohne Bootstrap-Nummer nur die Warnung, mit Nummer eine Fehlermeldung bei abgelehntem Versand", async () => {
  await mitMeldungen(async (zeilen) => {
    const versendet = [];
    await sendeRueckbuchung(() => ({ sendSms: async (sms) => versendet.push(sms) }));
    assert.ok(zeilen.includes(WARNUNG_OHNE_BOOTSTRAP), zeilen.join("\n"));
    assert.deepEqual(versendet, []);
    speicher.load().numbers.push({ id: "num_boot", e164: SENDER, tenantId: BOOTSTRAP_TENANT_ID, provider: "telnyx", status: "active" });
    await sendeRueckbuchung(() => ({ sendSms: async () => Promise.reject(new Error("sms kaputt")) }));
    await warteAuf(() => zeilen.includes(GELD_WARNUNG));
  });
});
