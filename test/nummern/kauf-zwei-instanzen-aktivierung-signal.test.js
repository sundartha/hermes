import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { postgresVorhanden, zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { starteAnbieterServer } from "../gemeinsam/anbieter-attrappe.mjs";
import { mitVerbindung, POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import {
  OIDC_KAUF_ECHT_GEHEIMNIS,
  STRIPE_REGISTER_SCHLUESSEL,
  STRIPE_ROUTEN_GEHEIMNIS,
  TELNYX_KAUF_ECHT_SCHLUESSEL,
  WEB_SITZUNGS_GEHEIMNIS,
} from "../gemeinsam/erfundene-geheimnisse.js";
import { gemeinsameUmgebung } from "../gemeinsam/zwei-prozesse.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import {
  PLAN_PRICE_BOOT_ENV,
  startServer,
  startTelnyxProvisioningMock,
  waitUntil,
} from "../helpers.js";

const ZEITGRENZE_MS = 240_000;
const HTTP_OK = 200;
const MS_JE_SEKUNDE = 1_000;
const BESTELL_FRIST_MS = 120_000;
const ANZAHL_SPUREN = 2;
const MANDANT = "t_kauf_echt";
const ABO = "sub_kauf_echt";
const STRIPE_PFAD = "/webhooks/stripe";
const BESTELL_PFAD = "/v2/number_orders";
const ANZAHL_SQL = `SELECT
  (SELECT count(*)::int FROM number WHERE tenant_id = $1) AS nummern,
  (SELECT count(*)::int FROM provisioning_job WHERE tenant_id = $1) AS auftraege,
  (SELECT count(*)::int FROM provisioning_job WHERE tenant_id = $1 AND status = 'done') AS erledigt`;
const SPUR = /stripe_webhook_activate [^\n]*provision=(\w+)/g;
const ANDERE_SPUR = ["already_provisioned", "redrive"];
const UMGEBUNG = {
  PAYMENT_ENABLED: "true",
  PROVISIONING_ENABLED: "true",
  PROVISIONING_COUNTRY: "US",
  GEO_ENABLED: "false",
  MAX_NUMBERS: "10",
  MAX_NUMBERS_PER_TENANT: "1",
  NUMBER_SETUP_FEE_CENTS: "100",
  STRIPE_SECRET_KEY: STRIPE_REGISTER_SCHLUESSEL,
  STRIPE_WEBHOOK_SECRET: STRIPE_ROUTEN_GEHEIMNIS,
  TELNYX_API_KEY: TELNYX_KAUF_ECHT_SCHLUESSEL,
  TELNYX_CONNECTION_ID: "conn_kauf_echt",
  SESSION_SECRET: WEB_SITZUNGS_GEHEIMNIS,
  OIDC_CLIENT_ID: "kauf-echt-client",
  OIDC_CLIENT_SECRET: OIDC_KAUF_ECHT_GEHEIMNIS,
  ...PLAN_PRICE_BOOT_ENV,
};

function stripeAntwort({ req, res, vermerke }) {
  vermerke({ methode: req.method, pfad: req.url });
  res.writeHead(HTTP_OK, { "content-type": "application/json" });
  if (req.method === "POST" && req.url === "/v1/payment_intents")
    return res.end(JSON.stringify({ id: "pi_kauf_echt" }));
  if (req.url.startsWith("/v1/subscriptions/"))
    return res.end(
      JSON.stringify({
        latest_invoice: { total: 0 },
        cancel_at_period_end: false,
        status: "active",
      }),
    );
  res.end("{}");
}

async function serverSekunden(prozess) {
  const antwort = await abrufMitFrist(`${prozess.localUrl}/healthz`);
  return Math.floor(Date.parse(antwort.headers.get("date")) / MS_JE_SEKUNDE);
}

function ereignis({ id, abo, zeit }) {
  return JSON.stringify({
    id,
    type: "customer.subscription.updated",
    created: zeit,
    data: {
      object: {
        ...(abo ? { id: abo } : {}),
        status: "active",
        cancel_at_period_end: false,
        metadata: { tenant_ref: MANDANT },
      },
    },
  });
}

function senden(prozess, koerper, zeit) {
  const mac = createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS)
    .update(`${zeit}.${koerper}`)
    .digest("hex");
  return abrufMitFrist(`${prozess.localUrl}${STRIPE_PFAD}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": `t=${zeit},v1=${mac}` },
    body: koerper,
  });
}

function verwaltungsAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

const WEBHOOK_ZEILE = /^.*stripe_webhook_(?:activate|ignored).*$/gm;
const protokoll = (...prozesse) =>
  prozesse.flatMap((prozess) => prozess.stdout.match(WEBHOOK_ZEILE) ?? []).join("\n");

async function mitProtokoll(prozesse, schritt) {
  try {
    return await schritt();
  } catch (fehler) {
    throw new Error(
      `${fehler.message}\nWebhook-Spuren der beiden Server:\n${protokoll(...prozesse) || "(keine)"}`,
      { cause: fehler },
    );
  }
}

const bestellungen = (telnyx) =>
  telnyx.requests.filter((anfrage) => anfrage.method === "POST" && anfrage.path === BESTELL_PFAD);

const spuren = (prozess) => [...prozess.stdout.matchAll(SPUR)].map((treffer) => treffer[1]);

async function aufbau(t) {
  const db = await echteDatenbankMitRolle(t);
  const [telnyx, stripe] = [
    await startTelnyxProvisioningMock(),
    await starteAnbieterServer(stripeAntwort),
  ];
  const gestartet = [];
  t.after(() =>
    Promise.all([...gestartet.map((prozess) => prozess.stop()), telnyx.close(), stripe.close()]),
  );
  const env = gemeinsameUmgebung(db.adresse, {
    ...UMGEBUNG,
    TELNYX_API_BASE: telnyx.url,
    STRIPE_API_BASE: stripe.url,
  });
  const starten = async () => {
    const prozess = await startServer({ env });
    gestartet.push(prozess);
    return prozess;
  };
  await (await starten()).stop();
  gestartet.length = 0;
  const sql = (text, parameter) =>
    mitVerbindung(
      verwaltungsAdresse(db.adresse),
      async (verbindung) => (await verbindung.query(text, parameter)).rows,
    );
  await sql(
    `INSERT INTO tenant (id, status, owner_name, first_name, kyc_level, country, stripe_customer_id,
       stripe_payment_method_id, stripe_payment_method_type)
     VALUES ($1, 'active', 'Mandant Test', 'Mandant', 'card', 'US', 'cus_kauf_echt', 'pm_kauf_echt', 'card')`,
    [MANDANT],
  );
  await sql(
    "INSERT INTO account (sub, email, tenant_id) VALUES ('sub-kauf-echt', 'kauf-echt@test.invalid', $1)",
    [MANDANT],
  );
  return { telnyx, sql, a: await starten(), b: await starten() };
}

test(
  "Zwei Instanzen, Aktivierung per Signal abgewartet: gleichzeitig bezahltes Abo kauft genau eine Nummer",
  { timeout: ZEITGRENZE_MS },
  async (t) => {
    if (!postgresVorhanden()) return;
    const { telnyx, sql, a, b } = await aufbau(t);
    const zeit = await serverSekunden(a);
    const antworten = await Promise.all([
      senden(a, ereignis({ id: "evt_kauf_echt_1", abo: ABO, zeit }), zeit),
      senden(b, ereignis({ id: "evt_kauf_echt_2", abo: null, zeit }), zeit),
    ]);
    for (const antwort of antworten) assert.equal(antwort.status, HTTP_OK);
    await mitProtokoll([a, b], async () => {
      await waitUntil(
        () =>
          spuren(a).length + spuren(b).length === ANZAHL_SPUREN && bestellungen(telnyx).length > 0,
        { timeoutMs: BESTELL_FRIST_MS },
      );
      await zeilenBis(
        async () => (await sql(ANZAHL_SQL, [MANDANT]))[0],
        (zeile) => zeile.erledigt === 1,
      );
    });
    assert.deepEqual((await sql(ANZAHL_SQL, [MANDANT]))[0], {
      nummern: 1,
      auftraege: 1,
      erledigt: 1,
    });
    assert.equal(bestellungen(telnyx).length, 1);
    const alle = [...spuren(a), ...spuren(b)].sort();
    assert.equal(alle.filter((spur) => spur === "queued").length, 1);
    assert.ok(ANDERE_SPUR.includes(alle.find((spur) => spur !== "queued")), alle.join(","));
  },
);
