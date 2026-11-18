import { test } from "node:test";
import assert from "node:assert/strict";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const KUNDE_A = "cus_A";
const ZAHLART_B = "pm_B";
const ZAHLART_TYP = "sepa_debit";
const SCHREIBFEHLER_LOG = "[pg] mandant-sperre schreiben fehlgeschlagen:";
const STRIPE_ZEILE_SQL = `SELECT stripe_customer_id, stripe_payment_method_id, stripe_payment_method_type FROM tenant WHERE id = $1`;

function runnerFuer(db, vorQuery = () => {}) {
  const client = {
    query: async (text, params) => {
      await vorQuery(text);
      return db.query(text, params);
    },
    exec: (sql) => db.exec(sql),
  };
  return { withClient: (fn) => fn(client) };
}

async function instanz(runner) {
  const speicher = makePgStore(runner);
  await speicher.init();
  return speicher;
}

const gemeinsam = await pgliteAlsRolleOhneSuperuser();
await instanz(runnerFuer(gemeinsam));
let laufendeNummer = 0;

async function zweiInstanzen(vorQuery) {
  laufendeNummer += 1;
  const tenant = `t_stripe_${laufendeNummer}`;
  await gemeinsam.query(
    `INSERT INTO tenant (id, status, owner_name, first_name) VALUES ($1, 'active', 'Mandant Test', 'Mandant')`,
    [tenant],
  );
  const a = await instanz(runnerFuer(gemeinsam));
  const b = await instanz(runnerFuer(gemeinsam, vorQuery));
  return { a, b, tenant };
}

const stripeZeile = async (tenantId) => (await gemeinsam.query(STRIPE_ZEILE_SQL, [tenantId])).rows[0];

test("Kriterium 1: Kundennummer von A und Zahlart von B stehen beide in der Zeile und bei einer neuen Instanz", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  a.setTenantStripe(tenant, { customerId: KUNDE_A });
  await a.drainFlushes();
  b.setTenantStripe(tenant, { paymentMethodId: ZAHLART_B });
  await b.drainFlushes();
  a.save();
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  const zeile = await stripeZeile(tenant);
  assert.equal(zeile.stripe_customer_id, KUNDE_A);
  assert.equal(zeile.stripe_payment_method_id, ZAHLART_B);
  const neu = await instanz(runnerFuer(gemeinsam));
  assert.deepEqual(neu.tenantStripe(tenant), {
    customerId: KUNDE_A,
    paymentMethodId: ZAHLART_B,
    paymentMethodType: null,
  });
});

test("Kriterium 1: der Zahlart-Typ wird gezielt geschrieben", async () => {
  const { a, tenant } = await zweiInstanzen();

  a.setTenantStripe(tenant, { paymentMethodType: ZAHLART_TYP });
  await a.drainFlushes();

  assert.equal((await stripeZeile(tenant)).stripe_payment_method_type, ZAHLART_TYP);
});

test("Kriterium 2: der letzte Flush einer veralteten Instanz setzt die Kundennummer nicht auf NULL", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  a.setTenantStripe(tenant, { customerId: KUNDE_A });
  await a.drainFlushes();

  b.save();
  await b.drainFlushes();

  assert.equal((await stripeZeile(tenant)).stripe_customer_id, KUNDE_A);
});

test("Kriterium 1: ein Setzen auf null loescht die Kundennummer in der Zeile", async () => {
  const { a, tenant } = await zweiInstanzen();
  a.setTenantStripe(tenant, { customerId: KUNDE_A });
  await a.drainFlushes();

  a.setTenantStripe(tenant, { customerId: null });
  await a.drainFlushes();

  assert.equal((await stripeZeile(tenant)).stripe_customer_id, null);
});

test("Kriterium 1: ein leeres Setzen schreibt nichts und die Kopie bleibt unveraendert", async (t) => {
  const { a, tenant } = await zweiInstanzen();
  const fehlerausgabe = t.mock.method(console, "error", () => {});
  a.setTenantStripe(tenant, { customerId: KUNDE_A });
  await a.drainFlushes();

  a.setTenantStripe(tenant, {});
  a.setTenantStripe(tenant);
  await a.drainFlushes();

  assert.equal(fehlerausgabe.mock.calls.length, 0, "kein Schreibversuch, kein Fehler im Log");
  assert.equal((await stripeZeile(tenant)).stripe_customer_id, KUNDE_A);
  assert.equal(a.tenantStripe(tenant).customerId, KUNDE_A);
});

test("Kriterium 3: scheitert das Schreiben, steht der Fehler im Log und der Flush schreibt die Spalte nicht", async (t) => {
  const zustand = { kaputt: false };
  const { b, tenant } = await zweiInstanzen((text) => {
    if (zustand.kaputt && /^UPDATE tenant SET stripe_customer_id = /.test(text)) throw new Error("Datenbank weg");
  });
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  zustand.kaputt = true;
  const ergebnis = b.setTenantStripe(tenant, { customerId: KUNDE_A });
  await b.drainFlushes();
  zustand.kaputt = false;
  b.save();
  await b.drainFlushes();

  assert.equal(ergebnis.stripeCustomerId, KUNDE_A, "der Aufrufer bekommt keinen Fehler");
  assert.equal((await stripeZeile(tenant)).stripe_customer_id, null);
  assert.ok(
    fehlerausgabe.mock.calls.some(
      (aufruf) => aufruf.arguments[0] === SCHREIBFEHLER_LOG && aufruf.arguments[1] === "Datenbank weg",
    ),
  );
});
