import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { mitZweiHermesAufPostgres, neueAnrufe, postgresVorhanden } from "../anrufe/hermes-mit-postgres.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { STRIPE_ROUTEN_GEHEIMNIS, WEB_SITZUNGS_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import { PLAN_PRICE_BOOT_ENV } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const HTTP_UNAVAILABLE = 503;
const MS_JE_SEKUNDE = 1_000;
const WEBHOOK_PFAD = "/webhooks/stripe";
const ZAHLUNG_AN = Object.freeze({
  SESSION_SECRET: WEB_SITZUNGS_GEHEIMNIS,
  PAYMENT_ENABLED: "true",
  STRIPE_SECRET_KEY: "sk_test_sperre",
  STRIPE_WEBHOOK_SECRET: STRIPE_ROUTEN_GEHEIMNIS,
  STRIPE_API_BASE: "http://127.0.0.1:9",
  NUMBER_SETUP_FEE_CENTS: "500",
  ...PLAN_PRICE_BOOT_ENV,
});
const ZAHLUNGSSPERRE = "paused";
const SUSPENDIERT = "2026-01-01T00:00:00.000Z";
const SPERRE_ZEILE_SQL = `SELECT status, kyc_level, suspended_at, stripe_billing_hold FROM tenant WHERE id = $1`;
const SPERRE_SETZEN_SQL = `UPDATE tenant SET stripe_billing_hold = $2 WHERE id = $1`;
const SUSPENDIEREN_SQL = `UPDATE tenant SET status = 'suspended', suspended_at = $2 WHERE id = $1`;
const KYC_SETZEN_SQL = `UPDATE tenant SET kyc_level = $2 WHERE id = $1`;
const SPALTE_VERSTECKT = "stripe_billing_hold_versteckt";
const GATE_FEHLER_AUDIT = "grund=gate_error gate=kyc";

function signiert(ereignis) {
  const rumpf = JSON.stringify(ereignis);
  const zeit = Math.floor(Date.now() / MS_JE_SEKUNDE);
  const pruefsumme = crypto.createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${rumpf}`).digest("hex");
  return { rumpf, signatur: `t=${zeit},v1=${pruefsumme}` };
}

const pausiertEreignis = (id, tenantId) => ({
  id,
  type: "customer.subscription.paused",
  created: Math.floor(Date.now() / MS_JE_SEKUNDE),
  data: { object: { id: `sub_${id}`, metadata: { tenant_ref: tenantId } } },
});

async function abgelehntMit(instanz, { rufeAn, anbieter }, { status, audit }) {
  const vorher = anbieter.starts().length;
  const res = await rufeAn(instanz);
  assert.equal(res.status, status);
  assert.equal(anbieter.starts().length, vorher, "die Attrappe zaehlt keinen Anrufstart");
  assert.match(instanz.stdout, new RegExp(`place_call_denied.*${audit}`));
}

test("Kriterium 15 und 17: eine Zahlungssperre in der Datenbank lehnt B ab, aufgehoben startet B wieder", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiHermesAufPostgres(t, {}, async ({ b, anbieter, sql }) => {
    const { rufeAn } = neueAnrufe();
    assert.equal((await rufeAn(b)).status, HTTP_OK, "Ausgangslage: ohne Sperre startet B den Anruf");
    assert.equal(anbieter.starts().length, 1);

    await sql(SPERRE_SETZEN_SQL, [BOOTSTRAP_TENANT_ID, ZAHLUNGSSPERRE]);
    await abgelehntMit(b, { rufeAn, anbieter }, { status: HTTP_FORBIDDEN, audit: "grund=billing_hold" });

    await sql(SPERRE_SETZEN_SQL, [BOOTSTRAP_TENANT_ID, null]);
    assert.equal((await rufeAn(b)).status, HTTP_OK, "aufgehoben, dieselbe Instanz startet wieder");
    assert.equal(anbieter.starts().length, 2);
  });
});

test("Kriterium 15: ein signiertes Stripe-Ereignis setzt auf A die Zahlungssperre, B lehnt place_call ab", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiHermesAufPostgres(t, { env: ZAHLUNG_AN }, async ({ a, b, anbieter }) => {
    const { rufeAn } = neueAnrufe();
    const { rumpf, signatur } = signiert(pausiertEreignis("evt_sperre_zwei", BOOTSTRAP_TENANT_ID));

    const eingang = await abrufMitFrist(`${a.localUrl}${WEBHOOK_PFAD}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "stripe-signature": signatur },
      body: rumpf,
    });
    assert.equal(eingang.status, HTTP_OK, "A nimmt das Ereignis an");

    await abgelehntMit(b, { rufeAn, anbieter }, { status: HTTP_FORBIDDEN, audit: "grund=billing_hold" });
    assert.equal(anbieter.starts().length, 0);
  });
});

test("Kriterium 15: ein suspendierter Mandant in der Datenbank lehnt B ab", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiHermesAufPostgres(t, {}, async ({ b, anbieter, sql }) => {
    const { rufeAn } = neueAnrufe();
    await sql(SUSPENDIEREN_SQL, [BOOTSTRAP_TENANT_ID, SUSPENDIERT]);

    await abgelehntMit(b, { rufeAn, anbieter }, { status: HTTP_FORBIDDEN, audit: "grund=abo" });
  });
});

test("Kriterium 15: eine KYC-Stufe, die in der Datenbank sinkt, lehnt B ab", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiHermesAufPostgres(t, {}, async ({ b, anbieter, sql }) => {
    const { rufeAn } = neueAnrufe();
    await sql(KYC_SETZEN_SQL, [BOOTSTRAP_TENANT_ID, "none"]);

    await abgelehntMit(b, { rufeAn, anbieter }, { status: HTTP_FORBIDDEN, audit: "grund=kyc" });
  });
});

test("Kriterium 16: der letzte Flush von B hebt Sperre, Suspendierung und KYC-Stufe nicht auf", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiHermesAufPostgres(t, {}, async ({ b, starte, sql }) => {
    await sql(SPERRE_SETZEN_SQL, [BOOTSTRAP_TENANT_ID, ZAHLUNGSSPERRE]);
    await sql(SUSPENDIEREN_SQL, [BOOTSTRAP_TENANT_ID, SUSPENDIERT]);
    await sql(KYC_SETZEN_SQL, [BOOTSTRAP_TENANT_ID, "none"]);

    await b.stop();
    await starte();

    const { rows } = await sql(SPERRE_ZEILE_SQL, [BOOTSTRAP_TENANT_ID]);
    assert.equal(rows[0].stripe_billing_hold, ZAHLUNGSSPERRE);
    assert.equal(rows[0].status, "suspended");
    assert.equal(rows[0].suspended_at, SUSPENDIERT);
    assert.equal(rows[0].kyc_level, "none");
  });
});

test("Kriterium 18: sind die Sperr-Spalten nicht lesbar, lehnt B ab und der Grund steht im Audit", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  await mitZweiHermesAufPostgres(t, {}, async ({ b, anbieter, sql }) => {
    const { rufeAn } = neueAnrufe();
    await sql(`ALTER TABLE tenant RENAME COLUMN stripe_billing_hold TO ${SPALTE_VERSTECKT}`);
    try {
      await abgelehntMit(b, { rufeAn, anbieter }, { status: HTTP_UNAVAILABLE, audit: GATE_FEHLER_AUDIT });
    } finally {
      await sql(`ALTER TABLE tenant RENAME COLUMN ${SPALTE_VERSTECKT} TO stripe_billing_hold`);
    }

    assert.equal((await rufeAn(b)).status, HTTP_OK, "wieder lesbar, startet B wieder");
    assert.equal(anbieter.starts().length, 1);
  });
});
