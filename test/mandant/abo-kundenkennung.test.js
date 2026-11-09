import { test } from "node:test";
import assert from "node:assert/strict";

import { makePgStore, pgliteAlsRolleOhneSuperuser, mandantSperreGelesenVon } from "../pg-helpers.js";

const KUNDE = "cus_erster";
const NEUER_KUNDE = "cus_neu";
const SPERRE_GRUND = "payment_failed";
const SCHREIBFEHLER_LOG = "[pg] mandant-sperre schreiben fehlgeschlagen:";

const gemeinsam = await pgliteAlsRolleOhneSuperuser();
const zustand = { kaputt: false, schreibversuche: 0, bei: null };

async function instanz() {
  const client = {
    query: async (text, params) => {
      if (/UPDATE tenant SET/.test(text)) {
        zustand.schreibversuche += 1;
        if (zustand.kaputt) throw new Error("Datenbank weg");
      }
      const ergebnis = await gemeinsam.query(text, params);
      await zustand.bei?.(text);
      return ergebnis;
    },
    exec: (sql) => gemeinsam.exec(sql),
  };
  const speicher = makePgStore({ withClient: (fn) => fn(client) });
  const kopie = await speicher.init();
  return Object.assign(speicher, { kopie });
}

await instanz();
let laufendeNummer = 0;

async function zweiInstanzen() {
  laufendeNummer += 1;
  const tenant = `t_kunde_${laufendeNummer}`;
  await gemeinsam.query(
    `INSERT INTO tenant (id, status, owner_name, first_name, kyc_level, stripe_customer_id)
     VALUES ($1, 'active', 'Mandant Kunde', 'Mandant', 'card', 'cus_alt')`,
    [tenant],
  );
  zustand.kaputt = false;
  zustand.bei = null;
  return { a: await instanz(), b: await instanz(), tenant };
}

async function spalte(tenantId, name) {
  const { rows } = await gemeinsam.query(`SELECT ${name} AS wert FROM tenant WHERE id = $1`, [tenantId]);
  return rows[0]?.wert;
}
const kunde = (tenantId) => spalte(tenantId, "stripe_customer_id");

async function scheitern(t, speicher, aktion) {
  const fehlerausgabe = t.mock.method(console, "error", () => {});
  zustand.kaputt = true;
  await Promise.resolve(aktion(speicher)).catch(() => {});
  await speicher.drainFlushes().catch(() => {});
  zustand.kaputt = false;
  return fehlerausgabe;
}

async function nachholen(speicher) {
  speicher.save();
  await speicher.drainFlushes();
}

test("Veraltete Instanz: ihr Flush setzt die Kundenkennung, die A schrieb, nicht auf den alten Wert zurueck", async () => {
  const { a, b, tenant } = await zweiInstanzen();
  a.setTenantStripe(tenant, { customerId: KUNDE });
  await a.drainFlushes();

  await nachholen(b);

  assert.equal(await kunde(tenant), KUNDE);
});

test("Eine Kundenkennung, die ein Patch auf null stellt, wird in der Datenbank geloescht", async () => {
  const { a, tenant } = await zweiInstanzen();

  a.setTenantStripe(tenant, { customerId: null });
  await a.drainFlushes();

  assert.equal(await kunde(tenant), null);
});

test("Zahlungsmethode ohne Kundenkennung im Patch: schreibt wie bisher, ohne Schreibfehler", async (t) => {
  const { a, tenant } = await zweiInstanzen();
  const fehlerausgabe = t.mock.method(console, "error", () => {});

  a.setTenantStripe(tenant, { paymentMethodId: "pm_x" });
  a.setTenantStripe(tenant, {});
  await a.drainFlushes();

  assert.equal(await spalte(tenant, "stripe_payment_method_id"), "pm_x");
  assert.ok(!fehlerausgabe.mock.calls.some(({ arguments: zeile }) => zeile.join(" ").includes(SCHREIBFEHLER_LOG)));
});

test("Schreibfehler: der Fehler steht im Log, der naechste Flush holt die Kennung nach und danach schreibt nichts mehr", async (t) => {
  const { b, tenant } = await zweiInstanzen();
  const fehlerausgabe = await scheitern(t, b, (s) => s.setTenantStripe(tenant, { customerId: KUNDE }));
  assert.equal(await kunde(tenant), "cus_alt");
  assert.ok(fehlerausgabe.mock.calls.some(({ arguments: zeile }) => zeile.join(" ").includes(SCHREIBFEHLER_LOG)));

  await nachholen(b);
  zustand.schreibversuche = 0;
  await nachholen(b);

  assert.equal(await kunde(tenant), KUNDE);
  assert.equal(zustand.schreibversuche, 0);
});

test("Nachholen setzt die neuere Kundenkennung von A nicht zurueck", async (t) => {
  const { a, b, tenant } = await zweiInstanzen();
  await scheitern(t, b, (s) => s.setTenantStripe(tenant, { customerId: KUNDE }));
  a.setTenantStripe(tenant, { customerId: NEUER_KUNDE });
  await a.drainFlushes();

  await nachholen(b);

  assert.equal(await kunde(tenant), NEUER_KUNDE);
});

test("Nachholen: ein vorgemerktes Aufheben der Sperre setzt die neuere Sperre von A nicht zurueck", async (t) => {
  const { a, b, tenant } = await zweiInstanzen();
  await scheitern(t, b, (s) => s.clearBillingHold(tenant));
  await a.setBillingHold(tenant, { reason: SPERRE_GRUND, dueAtIso: "2020-01-01T00:00:00.000Z" });

  await nachholen(b);

  assert.equal(await spalte(tenant, "stripe_billing_hold"), SPERRE_GRUND);
  assert.equal(b.billingHoldActive(tenant), SPERRE_GRUND);
});

test("Nachholen: der Mandant uebernimmt danach den Stand der Datenbank", async (t) => {
  const { b, tenant } = await zweiInstanzen();
  await scheitern(t, b, (s) => s.setTenantStripe(tenant, { customerId: KUNDE }));
  await gemeinsam.query(
    `UPDATE tenant SET stripe_billing_hold = $2, stripe_billing_hold_due_at = '2020-01-01T00:00:00.000Z',
       stand = stand + 1 WHERE id = $1`,
    [tenant, SPERRE_GRUND],
  );

  await nachholen(b);

  assert.equal(b.billingHoldActive(tenant), SPERRE_GRUND);
});

test("Nachholen: gelungen, danach erneut gescheitert - das zweite Nachholen schreibt die neue Kennung", async (t) => {
  const { b, tenant } = await zweiInstanzen();
  b.setTenantStripe(tenant, { customerId: KUNDE });
  await b.drainFlushes();
  await scheitern(t, b, (s) => s.setTenantStripe(tenant, { customerId: NEUER_KUNDE }));

  await nachholen(b);

  assert.equal(await kunde(tenant), NEUER_KUNDE);
});

test("Nachholen: ist der Mandant in der Datenbank inzwischen geloescht, scheitert der Flush nicht", async (t) => {
  const { b, tenant } = await zweiInstanzen();
  await scheitern(t, b, (s) => s.setTenantStripe(tenant, { customerId: KUNDE }));
  await gemeinsam.query(`DELETE FROM tenant WHERE id = $1`, [tenant]);

  await assert.doesNotReject(() => nachholen(b));
});

test("Nachholen: eine verspaetet eintreffende aeltere Lesung setzt den zuletzt gesehenen Stand nicht zurueck", async (t) => {
  const { b, tenant } = await zweiInstanzen();
  t.mock.method(console, "error", () => {});
  const frei = Promise.withResolvers();
  const gelesen = Promise.withResolvers();
  zustand.bei = async (text) => {
    if (!/^SELECT status, kyc_level/.test(text)) return;
    zustand.bei = null;
    gelesen.resolve();
    await frei.promise;
  };
  const alteLesung = mandantSperreGelesenVon(b.kopie, tenant);
  await gelesen.promise;
  b.setTenantStripe(tenant, { customerId: KUNDE });
  await b.drainFlushes();
  frei.resolve();
  await alteLesung;
  await scheitern(t, b, (s) => s.setTenantStripe(tenant, { customerId: NEUER_KUNDE }));

  await nachholen(b);

  assert.equal(await kunde(tenant), NEUER_KUNDE);
});
