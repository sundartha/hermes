import assert from "node:assert/strict";
import { test } from "node:test";

import { EIGENE_KENNUNG } from "../../src/store/instanz-besitz.js";
import { makePgStoreMitSperre, pgliteAlsRolleOhneSuperuser } from "../pg-helpers.js";

const MANDANT = "t_auftrag_instanz";
const NUMMER_ID = "num_auftrag_instanz";
const KENNUNG_A = "a-host:00000000-0000-4000-8000-0000000000a1";
const SCHLUESSEL = "schluessel-auftrag-instanz";

function einzelverbindung(db) {
  let kette = Promise.resolve();
  return {
    withClient(arbeit) {
      const lauf = kette.then(() => arbeit({ query: (text, werte) => db.query(text, werte), exec: (sql) => db.exec(sql) }));
      kette = lauf.catch(() => {});
      return lauf;
    },
  };
}

async function besitzerDesAuftrags(db) {
  await db.query("SELECT set_config('app.current_tenant', $1, false)", [MANDANT]);
  const { rows } = await db.query("SELECT instanz FROM provisioning_job");
  return rows.map((zeile) => zeile.instanz);
}

async function aufbau(optionen = { kennung: KENNUNG_A }) {
  const db = await pgliteAlsRolleOhneSuperuser();
  const runner = einzelverbindung(db);
  await makePgStoreMitSperre(runner).init();
  await db.query("SELECT set_config('app.current_tenant', $1, false)", [MANDANT]);
  await db.query("INSERT INTO tenant (id, status, idp_subject, country, kyc_level) VALUES ($1, 'active', $1, 'US', 'card')", [MANDANT]);
  const store = makePgStoreMitSperre(runner, optionen);
  await store.init();
  return { db, store };
}

const NUMMER = { id: NUMMER_ID, provider: "telnyx", status: "requested", country: "US", language: "en" };
const ANLEGEN = { tenantId: MANDANT, numberId: NUMMER_ID, idempotencyKey: SCHLUESSEL, number: NUMMER, jetztIso: "2026-11-22T10:00:00.000Z" };

test("Nummernkauf: ein Speicher ohne eigene Kennung legt den Auftrag mit der Kennung dieses Prozesses an", async () => {
  const { db, store } = await aufbau({});
  await store.nummernSql().auftragAnlegen(ANLEGEN);
  assert.deepEqual(await besitzerDesAuftrags(db), [EIGENE_KENNUNG]);
});

test("Nummernkauf: ein neuer Auftrag traegt die Kennung der anlegenden Instanz, der Gesamt-Flush schreibt sie nicht", async () => {
  const { db, store } = await aufbau();
  const auftrag = await store.nummernSql().auftragAnlegen(ANLEGEN);
  assert.deepEqual(await besitzerDesAuftrags(db), [KENNUNG_A]);

  await store.ensureTenant(MANDANT);
  store.load().provisioningJobs.push({ ...auftrag, instanz: "fremd-gesetzt", attempts: 3 });
  store.save();
  await store.drainFlushes();
  const { rows } = await db.query("SELECT instanz, attempts FROM provisioning_job");
  assert.deepEqual(rows, [{ instanz: KENNUNG_A, attempts: 3 }]);
});
