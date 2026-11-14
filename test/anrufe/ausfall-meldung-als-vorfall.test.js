import assert from "node:assert/strict";
import { after, test } from "node:test";

import { startServer, seedState, seedCall, waitUntil, DOMESTIC_TEST_NUMBER } from "../helpers.js";
import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteBetterStackAttrappe } from "../gemeinsam/better-stack-attrappe.mjs";
import { TELNYX_MESSZEILE_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { starteAttrappe } from "./attrappen-server.js";

const FRIST = { timeout: 60_000 };
const HTTP_OK = 200;
const KURZER_TAKT_MS = 50;
const TAG_MS = 86_400_000;
const FENSTER_MS = 3_600_000;
const WIEDERHOLUNG_MS = 1000;
const HOLD_SCHWELLE_MS = 60_000;
const GEHEIMER_PFAD = "geheimer-eingang-q7x9";
const GRUND = "not-placed:invite-403";
const HOLD_PRAEFIX = "hold:platform_number_in_use:";
const HALT_NUMMER = "+493012345000";
const ZIEL = "+4915112345678";
const SMS_ZIEL = "+491711234567";
const MAIL_ZIEL = "betreiber@waechter.invalid";

const geoeffnet = [];
after(async () => {
  await Promise.all(geoeffnet.map((schliessen) => schliessen()));
});

async function starteZaehler() {
  const anfragen = [];
  const attrappe = await starteAttrappe((req, res) => {
    req.resume();
    req.on("end", () => {
      anfragen.push(req.url);
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end("{}");
    });
  });
  geoeffnet.push(attrappe.close);
  return { ...attrappe, anfragen };
}

async function starteEingang(optionen) {
  const eingang = await starteBetterStackAttrappe(optionen);
  geoeffnet.push(eingang.close);
  return eingang;
}

function takt(brevoUrl) {
  return [
    "const takt = Number(process.env.COST_TRUING_SWEEP_INTERVAL_MS);",
    "const echtesIntervall = globalThis.setInterval;",
    `globalThis.setInterval = (fn, ms, ...rest) => echtesIntervall(fn, ms === takt ? ${KURZER_TAKT_MS} : ms, ...rest);`,
    "const echtesFetch = globalThis.fetch;",
    `globalThis.fetch = (url, optionen) => echtesFetch(String(url).replace("https://api.brevo.com", ${JSON.stringify(brevoUrl)}), optionen);`,
  ].join("\n");
}

function umgebung({ telnyx, brevo, adresse, zusatz = {} }) {
  return {
    COST_TRUING_SWEEP_INTERVAL_MS: "61000",
    PLATFORM_ANI_E164: HALT_NUMMER,
    OUTAGE_ALERT_WINDOW_MS: String(FENSTER_MS),
    OUTAGE_ALERT_MIN_FAILURES: "2",
    OUTAGE_ALERT_RETRY_MS: String(WIEDERHOLUNG_MS),
    OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: "0",
    PLATFORM_HOLD_ESCALATION_MAX_AGE_MS: "0",
    INBOUND_OUTAGE_ALERT_WINDOW_MS: "0",
    PLATFORM_ALERT_MAIL_TO: MAIL_ZIEL,
    PLATFORM_ALERT_SMS_TO: SMS_ZIEL,
    BETTERSTACK_ALERT_URL: adresse,
    BREVO_API_KEY: "waechter-mail-schluessel",
    MAIL_FROM: "hermes@waechter.invalid",
    TELNYX_API_KEY: TELNYX_MESSZEILE_SCHLUESSEL,
    TELNYX_API_BASE: telnyx.url,
    NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(takt(brevo.url))}`,
    ...zusatz,
  };
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

function ausfallStand() {
  const stand = seedState();
  const von = { from: DOMESTIC_TEST_NUMBER.e164, to: ZIEL, status: "active" };
  stand.calls = [1, 2, 3].map((nr) => seedCall({ id: `call_aus_${nr}`, ...von }));
  return stand;
}

function haltStand() {
  const seit = new Date(Date.now() - 2 * TAG_MS).toISOString();
  return seedState({
    tenants: [{ id: "t_halt", numberReleasePending: true, workosDeletePending: false, suspendedAt: seit }],
    numbers: [{ id: "n_halt", tenantId: "t_halt", status: "active", provider: "telnyx", providerNumberId: "ext_halt", e164: HALT_NUMMER }],
  });
}

const abgelehnt = { CallStatus: "failed", SipHangupCause: "403" };
const meldeEnde = (srv, id) =>
  abrufMitFrist(`${srv.localUrl}/voice/status?callId=${id}`, { method: "POST", body: new URLSearchParams(abgelehnt) }).then((antwort) =>
    assert.equal(antwort.status, HTTP_OK),
  );
const marker = (srv, code) => srv.readStore().outageAlerts.find((alert) => alert.code === code);
const nurAusfall = (eingang) => eingang.meldungen.filter(({ id }) => id === GRUND);
const nurHold = (eingang) => eingang.meldungen.filter(({ id }) => id.startsWith(HOLD_PRAEFIX));
const warteAuf = (bedingung) => waitUntil(bedingung, { timeoutMs: 30_000 });

async function ohneNebenkanaele({ telnyx, brevo }) {
  assert.deepEqual(telnyx.anfragen.filter((pfad) => pfad === "/v2/messages"), [], "keine SMS");
  assert.deepEqual(brevo.anfragen.filter((pfad) => pfad === "/v3/smtp/email"), [], "keine Mail");
}

async function ausfallServer(optionen, ablauf) {
  const [telnyx, brevo, eingang] = await Promise.all([starteZaehler(), starteZaehler(), starteEingang(optionen)]);
  const env = umgebung({ telnyx, brevo, adresse: `${eingang.url}` });
  return mitServer({ env, seed: ausfallStand() }, (srv) => ablauf({ srv, telnyx, brevo, eingang }));
}

test("S1: der zweite nicht gestartete Anruf meldet genau einen alert-Vorfall, nichts per SMS oder Mail", FRIST, () =>
  ausfallServer({}, async ({ srv, telnyx, brevo, eingang }) => {
    await meldeEnde(srv, "call_aus_1");
    await warteAuf(() => marker(srv, GRUND));
    await eingang.schranke();
    assert.deepEqual(nurAusfall(eingang), []);
    await meldeEnde(srv, "call_aus_2");
    await warteAuf(() => nurAusfall(eingang).length === 1);
    await warteAuf(() => marker(srv, GRUND).reportedAt);
    await eingang.schranke();
    const [meldung] = nurAusfall(eingang);
    assert.equal(nurAusfall(eingang).length, 1);
    assert.equal(meldung.methode, "POST");
    assert.equal(meldung.status, "alert");
    assert.equal(marker(srv, GRUND).deliveredChannels, "better-stack");
    await ohneNebenkanaele({ telnyx, brevo });
  }),
);

test("S11: lehnt der Eingang mit 500 ab, geht nach der Wiederholfrist derselbe Vorfall erneut, die Adresse bleibt aus der Ausgabe", FRIST, () =>
  ausfallServer({ antwortStatus: 500 }, async ({ srv, eingang }) => {
    await meldeEnde(srv, "call_aus_1");
    await meldeEnde(srv, "call_aus_2");
    await warteAuf(() => nurAusfall(eingang).length === 1);
    assert.equal(marker(srv, GRUND).reportedAt, null);
    await echtWarten(WIEDERHOLUNG_MS);
    await meldeEnde(srv, "call_aus_3");
    await warteAuf(() => nurAusfall(eingang).length === 2);
    assert.deepEqual(nurAusfall(eingang).map(({ id, status }) => [id, status]), [[GRUND, "alert"], [GRUND, "alert"]]);
    assert.ok(srv.stdout.includes(`Better-Stack-Meldung ${GRUND} nicht zugestellt: HTTP 500`), srv.stdout);
    assert.ok(!srv.stdout.includes(GEHEIMER_PFAD), srv.stdout);
  }),
);

test("S11: nahm der Eingang die Meldung mit 2xx an, folgt nach der Wiederholfrist keine zweite", FRIST, () =>
  ausfallServer({ antwortStatus: 204 }, async ({ srv, eingang }) => {
    await meldeEnde(srv, "call_aus_1");
    await meldeEnde(srv, "call_aus_2");
    await warteAuf(() => nurAusfall(eingang).length === 1);
    await echtWarten(WIEDERHOLUNG_MS);
    await meldeEnde(srv, "call_aus_3");
    await warteAuf(() => anrufEnde(srv, "call_aus_3"));
    await eingang.schranke();
    assert.equal(nurAusfall(eingang).length, 1);
  }),
);

const anrufEnde = (srv, id) => {
  const anruf = srv.readStore().calls.find((call) => call.id === id);
  return anruf?.endedAt;
};

test("S17: ein Eingang ohne Listener laesst place_call durch, die Ausgabe nennt weder Adresse noch Pfad", FRIST, async () => {
  const stillgelegt = await starteEingang();
  const adresse = `${stillgelegt.url}/${GEHEIMER_PFAD}`;
  const host = new URL(adresse).host;
  await stillgelegt.close();
  const [telnyx, brevo] = await Promise.all([starteZaehler(), starteZaehler()]);
  await mitServer({ env: umgebung({ telnyx, brevo, adresse }), seed: ausfallStand() }, async (srv) => {
    await meldeEnde(srv, "call_aus_1");
    await meldeEnde(srv, "call_aus_2");
    await warteAuf(() => srv.stdout.includes(`Better-Stack-Meldung ${GRUND} nicht zugestellt: `));
    assert.ok(!srv.stdout.includes(GEHEIMER_PFAD), srv.stdout);
    assert.ok(!srv.stdout.includes(host), srv.stdout);
    assert.equal(marker(srv, GRUND).reportedAt, null);
  });
});

async function holdServer(optionen, ablauf) {
  const [telnyx, brevo, eingang] = await Promise.all([starteZaehler(), starteZaehler(), starteEingang(optionen)]);
  const zusatz = { PLATFORM_HOLD_ESCALATION_MAX_AGE_MS: String(HOLD_SCHWELLE_MS) };
  const env = umgebung({ telnyx, brevo, adresse: eingang.url, zusatz });
  return mitServer({ env, seed: haltStand() }, (srv) => ablauf({ srv, telnyx, brevo, eingang }));
}

test("S19: eine zu lange haengende Rufnummern-Freigabe meldet genau einen alert-Vorfall und wiederholt ihn nach Annahme nicht", FRIST, () =>
  holdServer({}, async ({ srv, telnyx, brevo, eingang }) => {
    await warteAuf(() => nurHold(eingang).length === 1);
    await warteAuf(() => marker(srv, `${HOLD_PRAEFIX}n_halt`)?.reportedAt);
    await echtWarten(WIEDERHOLUNG_MS * 2);
    await eingang.schranke();
    const [meldung] = nurHold(eingang);
    assert.equal(nurHold(eingang).length, 1);
    assert.equal(meldung.status, "alert");
    assert.equal(meldung.id, `${HOLD_PRAEFIX}n_halt`);
    await ohneNebenkanaele({ telnyx, brevo });
  }),
);

test("S12: lehnt der Eingang die Hold-Meldung mit 500 ab, geht beim naechsten Takt nach der Wiederholfrist derselbe Vorfall erneut", FRIST, () =>
  holdServer({ antwortStatus: 500 }, async ({ eingang }) => {
    await warteAuf(() => nurHold(eingang).length >= 2);
    const [erste, zweite] = nurHold(eingang);
    assert.equal(zweite.id, erste.id);
    assert.equal(zweite.status, "alert");
  }),
);
