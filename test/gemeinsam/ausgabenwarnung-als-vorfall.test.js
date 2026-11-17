import assert from "node:assert/strict";
import { after, test } from "node:test";

import { startServer, DOMESTIC_TEST_NUMBER, waitForLog } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { starteBetterStackAttrappe } from "./better-stack-attrappe.mjs";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { starteErfolgreicheAttrappe } from "./vorspann-fahrzeug.js";
import { starteAttrappe } from "../anrufe/attrappen-server.js";

const FRIST = { timeout: 60_000 };
const HTTP_OK = 200;
const HTTP_PAYMENT_REQUIRED = 402;
const GEHEIMER_PFAD = "geheimer-eingang-q7x9";
const SMS_ZIEL = "+491711234567";
const MAIL_ZIEL = "betreiber@waechter.invalid";
const ZIELE = ["+4915112340001", "+4915112340002"];
const MONATSSCHLUESSEL = /^spend-warning:\d{4}-\d{2}$/;
const AUDIT_ZEILE = /\[audit\] platform_spend_warning [^\n]*summe_cents=(\d+) monat=(\d{4}-\d{2})/g;

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

function umbiegeBrevo() {
  return [
    "const echtesFetch = globalThis.fetch;",
    `globalThis.fetch = (url, optionen) => echtesFetch(String(url).replace("https://api.brevo.com", process.env.TEST_BREVO_URL), optionen);`,
  ].join("\n");
}

function umgebung({ brevo, adresse }) {
  return {
    MAX_BUDGET_EUR: "11",
    VOICE_TARIFF_DOMESTIC_CENTS: "250",
    ALLOWED_COUNTRY_CODES: "*",
    PLATFORM_SPEND_WARN_PERCENT: "40",
    PLATFORM_ALERT_SMS_TO: SMS_ZIEL,
    PLATFORM_ALERT_MAIL_TO: MAIL_ZIEL,
    BETTERSTACK_ALERT_URL: adresse,
    BREVO_API_KEY: "waechter-mail-schluessel",
    MAIL_FROM: "hermes@waechter.invalid",
    NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(umbiegeBrevo())}`,
    TEST_BREVO_URL: brevo.url,
  };
}

const rufAn = (srv, ziel) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: ziel, objective: "Test" }),
  });

const auditZeilen = (srv) => [...srv.stdout.matchAll(AUDIT_ZEILE)].map(([, summe, monat]) => ({ summe, monat }));

async function warnServer({ eingangOptionen, adresse }, ablauf) {
  const [erfolg, brevo, eingang] = await Promise.all([
    starteErfolgreicheAttrappe("warnung", [BOOTSTRAP_TENANT_ID]),
    starteZaehler(),
    starteEingang(eingangOptionen),
  ]);
  geoeffnet.push(erfolg.close);
  const telnyx = { anfragen: erfolg.attrappe.pfade };
  const env = { ...erfolg.env, ...umgebung({ brevo, adresse: adresse ?? `${eingang.url}/${GEHEIMER_PFAD}` }) };
  const srv = await startServer({ ownerNumber: DOMESTIC_TEST_NUMBER, env });
  try {
    return await ablauf({ srv, telnyx, brevo, eingang });
  } catch (fehler) {
    throw new Error(`${fehler.message}\n${srv.stdout}`, { cause: fehler });
  } finally {
    await srv.stop();
  }
}

test("A1/A2/A3/A6: die erste Ueberschreitung im Monat meldet genau einen alert-Vorfall, die zweite keinen, nichts geht per SMS oder Mail", FRIST, () =>
  warnServer({}, async ({ srv, telnyx, brevo, eingang }) => {
    assert.equal((await rufAn(srv, ZIELE[0])).status, HTTP_OK);
    await eingang.aufMeldungen(1);
    assert.equal((await rufAn(srv, ZIELE[1])).status, HTTP_OK);
    await eingang.schranke();
    const [meldung] = eingang.meldungen;
    assert.equal(eingang.meldungen.length, 1);
    assert.equal(meldung.methode, "POST");
    assert.equal(meldung.status, "alert");
    assert.match(meldung.id, MONATSSCHLUESSEL);
    const [audit] = auditZeilen(srv);
    assert.equal(auditZeilen(srv).length, 1);
    assert.equal(meldung.id, `spend-warning:${audit.monat}`);
    assert.ok(meldung.text.includes(`summe_cents=${audit.summe}`), meldung.text);
    assert.ok(meldung.text.includes(`monat=${audit.monat}`), meldung.text);
    assert.ok(!meldung.text.includes(ZIELE[0]), meldung.text);
    assert.deepEqual(telnyx.anfragen.filter((pfad) => pfad === "/v2/messages"), [], "keine SMS");
    assert.deepEqual(brevo.anfragen.filter((pfad) => pfad === "/v3/smtp/email"), [], "keine Mail");
  }),
);

test("A4: lehnt der Eingang mit 500 ab, wird der Anruf trotzdem angenommen und die Adresse bleibt aus der Ausgabe", FRIST, () =>
  warnServer({ eingangOptionen: { antwortStatus: 500 } }, async ({ srv, eingang }) => {
    const antwort = await rufAn(srv, ZIELE[0]);
    assert.equal(antwort.status, HTTP_OK);
    await eingang.aufMeldungen(1);
    await waitForLog(srv, /\[spend-warning\] Better-Stack-Meldung spend-warning:\d{4}-\d{2} nicht zugestellt: HTTP 500/);
    assert.ok(!srv.stdout.includes(GEHEIMER_PFAD), srv.stdout);
    assert.ok(!srv.stdout.includes(new URL(eingang.url).host), srv.stdout);
  }),
);

test("A5: ein Eingang ohne Listener laesst place_call durch, Ausgabe nennt weder Adresse noch Pfad", FRIST, async () => {
  const stillgelegt = await starteEingang();
  const adresse = `${stillgelegt.url}/${GEHEIMER_PFAD}`;
  const host = new URL(adresse).host;
  await stillgelegt.close();
  await warnServer({ adresse }, async ({ srv }) => {
    assert.equal((await rufAn(srv, ZIELE[0])).status, HTTP_OK);
    await waitForLog(srv, /\[spend-warning\] Better-Stack-Meldung spend-warning:\d{4}-\d{2} nicht zugestellt: /);
    assert.ok(!srv.stdout.includes(GEHEIMER_PFAD), srv.stdout);
    assert.ok(!srv.stdout.includes(host), srv.stdout);
    assert.equal(auditZeilen(srv).length, 1);
  });
});

test("A5: eine leere BETTERSTACK_ALERT_URL laesst place_call ohne Fehler durch", FRIST, () =>
  warnServer({ adresse: "" }, async ({ srv }) => {
    const antwort = await rufAn(srv, ZIELE[0]);
    assert.equal(antwort.status, HTTP_OK);
    assert.equal(auditZeilen(srv).length, 1);
    assert.notEqual(antwort.status, HTTP_PAYMENT_REQUIRED);
  }),
);
