import { test } from "node:test";
import assert from "node:assert/strict";

import { makePgStore, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const SCHREIBFEHLER_LOG = "[pg] mandant-sperre schreiben fehlgeschlagen:";
const ABO_ZEILE_SQL = `SELECT stripe_subscription_id, stripe_plan_slug, stripe_current_period_end, stripe_current_period_start, stripe_number_setup_fee_exempt, stripe_period_credit_revoked, stripe_cancel_at_period_end, stripe_activation_pending FROM tenant WHERE id = $1`;
const PERIODE_ENDE = 1_900_000_000;
const PERIODE_START = 1_897_000_000;
const NEUER_START = 1_898_000_000;

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
  const tenant = `t_abo_${laufendeNummer}`;
  await gemeinsam.query(
    `INSERT INTO tenant (id, status, owner_name, first_name) VALUES ($1, 'active', 'Mandant Test', 'Mandant')`,
    [tenant],
  );
  const a = await instanz(runnerFuer(gemeinsam));
  const b = await instanz(runnerFuer(gemeinsam, vorQuery));
  return { a, b, tenant };
}

const aboZeile = async (tenantId) => (await gemeinsam.query(ABO_ZEILE_SQL, [tenantId])).rows[0];

test("Kriterium 19: der neuere Plan von A bleibt nach dem letzten Flush einer veralteten Instanz B", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  a.setTenantSubscription(tenant, { planSlug: "starter" });
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  assert.equal((await aboZeile(tenant)).stripe_plan_slug, "starter");
  const neu = await instanz(runnerFuer(gemeinsam));
  assert.equal(neu.tenantSubscription(tenant).planSlug, "starter");
});

test("Kriterium 19: Abo-Kennung, Periode, Befreiung und Widerruf werden gezielt geschrieben", async () => {
  const { a, tenant } = await zweiInstanzen();

  a.setTenantSubscription(tenant, {
    subscriptionId: "sub_A",
    currentPeriodEnd: PERIODE_ENDE,
    currentPeriodStart: PERIODE_START,
    numberSetupFeeExempt: true,
    periodCreditRevoked: true,
    cancelAtPeriodEnd: true,
  });
  await a.drainFlushes();

  const zeile = await aboZeile(tenant);
  assert.equal(zeile.stripe_subscription_id, "sub_A");
  assert.equal(Number(zeile.stripe_current_period_end), PERIODE_ENDE);
  assert.equal(Number(zeile.stripe_current_period_start), PERIODE_START);
  assert.equal(zeile.stripe_number_setup_fee_exempt, true);
  assert.equal(zeile.stripe_period_credit_revoked, true);
  assert.equal(zeile.stripe_cancel_at_period_end, true);
});

test("Kriterium 19: die Rücknahme des Kündigungsvermerks auf false überlebt den letzten Flush von B", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  a.setTenantSubscription(tenant, { cancelAtPeriodEnd: true });
  await a.drainFlushes();

  a.setTenantSubscription(tenant, { cancelAtPeriodEnd: false });
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  assert.equal((await aboZeile(tenant)).stripe_cancel_at_period_end, false);
});

test("Kriterium 19: die Abo-Kennung auf null löscht sie und der Flush von B bringt sie nicht zurück", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  a.setTenantSubscription(tenant, { subscriptionId: "sub_A" });
  await a.drainFlushes();

  a.setTenantSubscription(tenant, { subscriptionId: null });
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  assert.equal((await aboZeile(tenant)).stripe_subscription_id, null);
});

test("Kriterium 19: verschiedene Felder von A und B stehen beide in der Zeile", async () => {
  const { a, b, tenant } = await zweiInstanzen();

  a.setTenantSubscription(tenant, { planSlug: "business" });
  await a.drainFlushes();
  b.setTenantSubscription(tenant, { currentPeriodStart: NEUER_START });
  await b.drainFlushes();
  a.save();
  await a.drainFlushes();
  b.save();
  await b.drainFlushes();

  const zeile = await aboZeile(tenant);
  assert.equal(zeile.stripe_plan_slug, "business");
  assert.equal(Number(zeile.stripe_current_period_start), NEUER_START);
});

test("Kriterium 19: Plan und Aktivierungsvermerk in einem Aufruf stehen beide in der Zeile", async () => {
  const { a, tenant } = await zweiInstanzen();

  a.setTenantSubscription(tenant, { planSlug: "starter", activationPending: true });
  await a.drainFlushes();

  const zeile = await aboZeile(tenant);
  assert.equal(zeile.stripe_plan_slug, "starter");
  assert.equal(zeile.stripe_activation_pending, true);
});

test("Kriterium 19: ein leeres Setzen schreibt nichts und die Kopie bleibt unverändert", async (t) => {
  const { a, tenant } = await zweiInstanzen();
  const fehlerausgabe = t.mock.method(console, "error", () => {});
  a.setTenantSubscription(tenant, { planSlug: "starter" });
  await a.drainFlushes();

  a.setTenantSubscription(tenant, {});
  await a.drainFlushes();

  assert.equal(fehlerausgabe.mock.calls.length, 0);
  assert.equal((await aboZeile(tenant)).stripe_plan_slug, "starter");
  assert.equal(a.tenantSubscription(tenant).planSlug, "starter");
});

test("Kriterium 19: scheitert das Schreiben, steht der Fehler im Log und der Flush schreibt die Spalte nicht", async (t) => {
  const zustand = { kaputt: false };
  const { b, tenant } = await zweiInstanzen((text) => {
    if (zustand.kaputt && /^UPDATE tenant SET stripe_plan_slug = /.test(text)) throw new Error("Datenbank weg");
  });
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  zustand.kaputt = true;
  b.setTenantSubscription(tenant, { planSlug: "starter" });
  await b.drainFlushes();
  zustand.kaputt = false;
  b.save();
  await b.drainFlushes();

  assert.equal((await aboZeile(tenant)).stripe_plan_slug, null);
  assert.ok(
    fehlerausgabe.mock.calls.some(
      (aufruf) => aufruf.arguments[0] === SCHREIBFEHLER_LOG && aufruf.arguments[1] === "Datenbank weg",
    ),
  );
});
