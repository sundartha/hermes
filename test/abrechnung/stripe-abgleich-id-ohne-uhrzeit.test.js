import assert from "node:assert/strict";
import { test } from "node:test";

import { fakeProvisioner } from "../helpers.js";
import { POSTGRES_VARIABLE, mitVerbindung } from "../gemeinsam/echtes-postgres.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";

const ERSTER_LAUF_MS = 1_765_000_000_000;
const ZWEITER_LAUF_MS = ERSTER_LAUF_MS + 1_000;
const MS_JE_SEKUNDE = 1_000;
const ZEITGRENZE_MS = 120_000;
const EINMAL = 1;
const KEIN = 0;
const SPERR_AKTION = "stripe_webhook_suspend";

process.env.STORE_BACKEND = "pg";
process.env.BOOTSTRAP_E164 = "+15005550006";
process.env.BOOTSTRAP_PROVIDER = "telnyx";
const { runStripeSubscriptionReconcile, syntheticSubscriptionDeletedEvent } = await import(
  "../../src/billing/stripe-reconcile.js"
);

test("Abgleich-Ereignis: gleiche id bei anderer Uhrzeit, andere id bei anderem Abo oder Tenant", () => {
  const erste = syntheticSubscriptionDeletedEvent({ tenantId: "t_a", subscriptionId: "sub_a", nowMs: ERSTER_LAUF_MS });
  const spaeter = syntheticSubscriptionDeletedEvent({ tenantId: "t_a", subscriptionId: "sub_a", nowMs: ZWEITER_LAUF_MS });
  const anderesAbo = syntheticSubscriptionDeletedEvent({ tenantId: "t_a", subscriptionId: "sub_b", nowMs: ERSTER_LAUF_MS });
  const andererTenant = syntheticSubscriptionDeletedEvent({ tenantId: "t_b", subscriptionId: "sub_a", nowMs: ERSTER_LAUF_MS });

  assert.equal(spaeter.id, erste.id);
  assert.notEqual(anderesAbo.id, erste.id);
  assert.notEqual(andererTenant.id, erste.id);
  assert.equal(erste.created, Math.floor(ERSTER_LAUF_MS / MS_JE_SEKUNDE));
  assert.equal(spaeter.created, Math.floor(ZWEITER_LAUF_MS / MS_JE_SEKUNDE));
});

function alsVerwaltung(db, arbeit) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(db.adresse).pathname;
  return mitVerbindung(url.href, arbeit);
}

const MANDANTEN = [
  { id: "t_abgleich", abo: "sub_abgleich", nummer: "+15005550177", extern: "ext_abgleich" },
  { id: "t_heilung", abo: "sub_heilung", nummer: "+15005550178", extern: "ext_heilung" },
];

async function anlegen(verbindung, { id, abo, nummer, extern }) {
  await verbindung.query(
    `INSERT INTO tenant (id, status, owner_name, first_name, kyc_level, stripe_subscription_id, stripe_cancel_at_period_end)
     VALUES ($1, 'active', 'Mandant Test', 'Mandant', 'card', $2, true)`,
    [id, abo],
  );
  await verbindung.query(
    `INSERT INTO number (id, tenant_id, e164, provider, status, provider_number_id)
     VALUES ($1, $2, $3, 'telnyx', 'active', $4)`,
    [`n_${id}`, id, nummer, extern],
  );
  await verbindung.query(
    `INSERT INTO number_assignment (id, number_id, tenant_id, assigned_at) VALUES ($1, $2, $3, 'x')`,
    [`a_${id}`, `n_${id}`, id],
  );
}

async function zweiSpeicher(t) {
  const db = await echteDatenbankMitRolle(t);
  if (!db) return null;
  process.env.DATABASE_URL = db.adresse;
  await import("../../src/store.js?anlegen");
  await alsVerwaltung(db, async (verbindung) => {
    for (const mandant of MANDANTEN) await anlegen(verbindung, mandant);
  });
  return { a: await import("../../src/store.js?a"), b: await import("../../src/store.js?b") };
}

function lauf(store, beobachtung, { mandant, werfen = false }) {
  const abo = MANDANTEN.find(({ id }) => id === mandant).abo;
  return {
    store,
    billing: { retrieveSubscription: async (kennung) => ({ planSlug: null, status: kennung === abo ? "canceled" : "active" }) },
    logger: { log: () => {}, warn: () => {} },
    webhookDeps: {
      store,
      accounts: {
        setStatus: async (tenant) => {
          if (werfen) throw new Error("Statuswechsel scheitert");
          beobachtung.sperren.push(tenant);
        },
      },
      sessions: { invalidateByTenant: async () => {} },
      audit: (aktion, _req, detail) => {
        if (aktion === SPERR_AKTION) beobachtung.sperrzeilen.push(detail);
      },
      req: null,
      provision: async () => ({ ok: true, reason: "queued" }),
      billing: {},
      numberProvisioner: beobachtung.prov,
      workos: null,
      auditStore: { record: async () => {} },
    },
  };
}

test("Abgleich über zwei Speicher derselben Datenbank", { timeout: ZEITGRENZE_MS }, async (t) => {
  const speicher = await zweiSpeicher(t);
  if (!speicher) return;
  const beobachtung = { sperren: [], sperrzeilen: [], prov: fakeProvisioner() };
  const ausfuehren = (store, nowMs, optionen) =>
    runStripeSubscriptionReconcile({ ...lauf(store, beobachtung, optionen), nowMs });

  await t.test("zwei Läufe sperren den Mandanten genau einmal", async () => {
    const erster = await ausfuehren(speicher.a, ERSTER_LAUF_MS, { mandant: "t_abgleich" });
    const zweiter = await ausfuehren(speicher.b, ZWEITER_LAUF_MS, { mandant: "t_abgleich" });

    assert.equal(erster.errors, KEIN);
    assert.equal(zweiter.errors, KEIN);
    assert.deepEqual(beobachtung.sperren, ["t_abgleich"]);
    assert.equal(beobachtung.sperrzeilen.length, EINMAL);
    assert.deepEqual(beobachtung.prov.log, ["release:ext_abgleich"]);
  });

  await t.test("scheitert die Heilung im ersten Lauf, heilt der zweite Lauf", async () => {
    const erster = await ausfuehren(speicher.a, ERSTER_LAUF_MS, { mandant: "t_heilung", werfen: true });
    const zweiter = await ausfuehren(speicher.b, ZWEITER_LAUF_MS, { mandant: "t_heilung" });

    assert.equal(erster.errors, EINMAL);
    assert.equal(erster.healed, KEIN);
    assert.equal(zweiter.healed, EINMAL);
    assert.deepEqual(beobachtung.sperren, ["t_abgleich", "t_heilung"]);
    assert.deepEqual(beobachtung.prov.log, ["release:ext_abgleich", "release:ext_heilung"]);
  });
});
