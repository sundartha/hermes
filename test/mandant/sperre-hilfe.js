import crypto from "node:crypto";
import { makeStripeWebhookRoute } from "../../src/routes/stripe-webhook.js";
import { STRIPE_ROUTEN_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import * as speicherHilfe from "../pg-helpers.js";

const { BOOTSTRAP_TENANT_ID, makePgStore, pgliteAlsRolleOhneSuperuser } = speicherHilfe;

export const HTTP_OK = 200;

export const HTTP_UNAVAILABLE = 503;

export const MS_JE_SEKUNDE = 1_000;

export const PAUSIERT = "customer.subscription.paused";

export const ZAHLUNG_OFFEN = "invoice.payment_action_required";

export const FRIST_SQL = `SELECT stripe_billing_hold, stripe_billing_hold_due_at FROM tenant WHERE id = $1`;

export const TENANT = "t_sperre";

export const KYC_ZIEL = "card";

export const ZAHLUNGSSPERRE = "paused";

export const SUSPENDIERT = "2026-01-01T00:00:00.000Z";

export const SPERRE_ZEILE_SQL = `SELECT status, kyc_level, suspended_at, stripe_billing_hold FROM tenant WHERE id = $1`;

export const SPERRE_SETZEN_SQL = `UPDATE tenant SET stripe_billing_hold = $2 WHERE id = $1`;

export const SUSPENDIEREN_SQL = `UPDATE tenant SET status = 'suspended', suspended_at = $2 WHERE id = $1`;

export const KYC_SETZEN_SQL = `UPDATE tenant SET kyc_level = $2 WHERE id = $1`;

export const SCHREIBFEHLER_LOG = "[pg] mandant-sperre schreiben fehlgeschlagen:";

export const NICHT_GESCHRIEBEN = /Mandanten-Sperre nicht in die Datenbank geschrieben/;

export const SPERRE_LESEN = /^SELECT status, kyc_level/;

export const SPERRE_SCHREIBEN = /^UPDATE tenant SET stripe_billing_hold = /;

export const NEUER_MANDANT = "t_sperre_neu";

export const UNBEKANNTER_MANDANT = "t_sperre_unbekannt";

export const SPAETERE_SPERRE = "payment_action";

export const KYC_BOOTSTRAP = "id_verified";

export const KYC_ZEILE_SQL = `SELECT kyc_level FROM tenant WHERE id = $1`;

export function runnerFuer(db, vorQuery = () => {}) {
  const client = {
    query: async (text, params) => {
      await vorQuery(text);
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

export async function instanz(runner) {
  const speicher = makePgStore(runner);
  await speicher.init();
  return speicher;
}

export async function zweiInstanzen({ kyc = KYC_ZIEL } = {}, vorQuery) {
  const db = await pgliteAlsRolleOhneSuperuser();
  await instanz(runnerFuer(db));
  await db.query(
    `INSERT INTO tenant (id, status, owner_name, first_name, kyc_level)
     VALUES ($1, 'active', 'Mandant Test', 'Mandant', $2)`,
    [TENANT, kyc],
  );
  const runner = runnerFuer(db);
  const a = await instanz(runner);
  const b = await instanz(vorQuery ? runnerFuer(db, vorQuery) : runner);
  return { db, a, b };
}

const sperreAusKopie = (speicher) => ({
  kycReached: (stufe) => speicher.kycReached(TENANT, stufe),
  inactive: () => speicher.tenantInactive(TENANT),
  billingHold: () => speicher.billingHoldActive(TENANT),
});

export const sperreVon = async (speicher, tenantId = TENANT) =>
  speicherHilfe.mandantSperreGelesenVon
    ? speicherHilfe.mandantSperreGelesenVon(speicher.load(), tenantId)
    : sperreAusKopie(speicher);

export const sperreZeile = async (db) => (await db.query(SPERRE_ZEILE_SQL, [TENANT])).rows[0];

export function angehalten(muster, nummer) {
  const zustand = { gesehen: 0 };
  let freigeben;
  const halt = new Promise((weiter) => {
    freigeben = weiter;
  });
  const vorQuery = (text) => {
    if (!muster.test(text)) return undefined;
    zustand.gesehen += 1;
    return zustand.gesehen === nummer ? halt : undefined;
  };
  return { vorQuery, freigeben: () => freigeben() };
}

export function signiert(ereignis) {
  const rumpf = JSON.stringify(ereignis);
  const zeit = Math.floor(Date.now() / MS_JE_SEKUNDE);
  const pruefsumme = crypto.createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${rumpf}`).digest("hex");
  return { rumpf, signatur: `t=${zeit},v1=${pruefsumme}` };
}

export const pausiertEreignis = (id, tenantId, type = PAUSIERT) => ({
  id,
  type,
  created: Math.floor(Date.now() / MS_JE_SEKUNDE),
  data: { object: { id: `sub_${id}`, metadata: { tenant_ref: tenantId } } },
});

export async function webhookAntwort(speicher, ereignis) {
  const { rumpf, signatur } = signiert(ereignis);
  const antwort = {};
  const res = {
    status(code) {
      antwort.status = code;
      return this;
    },
    json(koerper) {
      antwort.status ??= HTTP_OK;
      antwort.koerper = koerper;
      return this;
    },
  };
  const route = makeStripeWebhookRoute({
    config: { billing: { paymentEnabled: true, stripeWebhookSecret: STRIPE_ROUTEN_GEHEIMNIS } },
    store: speicher,
    audit: () => {},
  });
  await route({ rawBody: Buffer.from(rumpf), headers: { "stripe-signature": signatur } }, res);
  return antwort;
}

export function schreibenKaputtBei(zustand) {
  return (text) => {
    if (zustand.kaputt && /UPDATE tenant SET/.test(text)) throw new Error("Datenbank weg");
  };
}

export const protokolliert = (fehlerausgabe, ...teile) =>
  fehlerausgabe.mock.calls.some(({ arguments: zeile }) => teile.every((teil) => zeile.join(" ").includes(teil)));

export async function bootstrapKyc(db) {
  const { rows } = await db.query(KYC_ZEILE_SQL, [BOOTSTRAP_TENANT_ID]);
  return rows[0].kyc_level;
}

export { BOOTSTRAP_TENANT_ID, makePgStore, pgliteAlsRolleOhneSuperuser };
