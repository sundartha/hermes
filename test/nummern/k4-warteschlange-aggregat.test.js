import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { fromPglite } from "pg-boss";
import { config } from "../../src/config.ts";
import { createQueue } from "../../src/queue/registry.ts";
import { makeConfigOverrides } from "../helpers.js";
import { neuePglite } from "../pglite-helfer.js";
import { neueUhr } from "../gemeinsam/pgboss-umgebung.js";

const { withConfigOverrides } = makeConfigOverrides(config);
const KIND = "provision_number";
const SEKUNDE_MS = 1000;
const MEHR_ALS_EINE_SEITE = 2500;
const ALTER_S = 90;

const auftrag = (nummer) => ({
  kind: KIND,
  payload: { numberId: `num_${nummer}`, to: "+4915112345678", tenantId: "tenant_geheim" },
  idempotencyKey: `agg_${nummer}`,
});

async function messbareQueue(t, { vorAbfrage = async () => {}, uhr } = {}) {
  const queues = [];
  t.after(() => Promise.all(queues.map((queue) => queue.stop())));
  const eingebettet = await neuePglite();
  const echt = fromPglite(eingebettet);
  const mitschnitt = { sql: [], aktiv: false };
  const db = {
    ...echt,
    executeSql: async (sql, parameter) => {
      if (mitschnitt.aktiv) mitschnitt.sql.push(sql);
      await vorAbfrage(sql, parameter, eingebettet);
      return echt.executeSql(sql, parameter);
    },
  };
  const queue = withConfigOverrides({ queueBackend: "pgboss" }, () =>
    createQueue({ clock: uhr, bossOptions: { db, backend: "pglite" } }),
  );
  queues.push(queue);
  return { queue, eingebettet, mitschnitt };
}

test("AGG-1: 2500 wartende Aufträge werden ohne findJobs gezählt, das Alter kommt vom ältesten", async (t) => {
  const uhr = neueUhr();
  const { queue } = await messbareQueue(t, { uhr });
  const start = uhr.now();
  await queue.enqueue(auftrag(0));
  await uhr.setTime(start + ALTER_S * SEKUNDE_MS);
  const nummern = Array.from({ length: MEHR_ALS_EINE_SEITE - 1 }, (_, i) => i + 1);
  await Promise.all(nummern.map((n) => queue.enqueue(auftrag(n))));
  const instanz = await queue.start();
  const findJobs = mock.method(instanz, "findJobs");
  const zustand = await queue.warteschlangeZustand();
  assert.equal(findJobs.mock.callCount(), 0);
  assert.deepEqual(zustand, [{ art: KIND, laenge: MEHR_ALS_EINE_SEITE, aeltesteSekunden: ALTER_S }]);
});

test("AGG-2: ein zwischen den Abfragen gelöschter Auftrag bricht die Messung nicht ab", async (t) => {
  const { queue } = await messbareQueue(t, {
    vorAbfrage: async (sql, parameter, eingebettet) => {
      if (sql.includes('AS "createdOn"') && parameter.length === 2)
        await eingebettet.query("DELETE FROM pgboss.job WHERE id = $1::uuid", [parameter[1]]);
    },
  });
  const nummern = Array.from({ length: 1001 }, (_, i) => i);
  await Promise.all(nummern.map((n) => queue.enqueue(auftrag(n))));
  const zustand = await queue.warteschlangeZustand();
  assert.equal(zustand.length, 1);
  assert.equal(zustand[0].art, KIND);
  assert.ok(zustand[0].laenge >= 1000);
});

test("AGG-3: nur created und retry zählen als wartend, das Alter kommt vom ältesten wartenden", async (t) => {
  const uhr = neueUhr();
  const { queue, eingebettet } = await messbareQueue(t, { uhr });
  const start = uhr.now();
  const ids = [];
  for (const nummer of [0, 1, 2, 3, 4, 5, 6]) {
    await uhr.setTime(start + nummer * SEKUNDE_MS * ALTER_S);
    ids.push(await queue.enqueue(auftrag(nummer)));
  }
  const zustaende = ["completed", "active", "failed", "cancelled", "retry", "created", "created"];
  for (const [i, zustand] of zustaende.entries())
    await eingebettet.query("UPDATE pgboss.job SET state = $1::pgboss.job_state WHERE id = $2::uuid", [zustand, ids[i].split("/")[1]]);
  await uhr.setTime(start + 10 * SEKUNDE_MS * ALTER_S);
  const [zustand] = await queue.warteschlangeZustand();
  assert.equal(zustand.laenge, 3);
  assert.equal(zustand.aeltesteSekunden, 6 * ALTER_S);
});

test("AGG-4: eine Art ohne wartende Aufträge meldet Länge 0 und Alter 0", async (t) => {
  const uhr = neueUhr();
  const { queue } = await messbareQueue(t, { uhr });
  await queue.enqueue(auftrag(1));
  await uhr.setTime(uhr.now() + ALTER_S * SEKUNDE_MS);
  await queue.drain(async () => undefined);
  assert.deepEqual(await queue.warteschlangeZustand(), [{ art: KIND, laenge: 0, aeltesteSekunden: 0 }]);
});

test("AGG-5: die Messung liest keine Nutzlast", async (t) => {
  const { queue, mitschnitt } = await messbareQueue(t);
  await queue.enqueue(auftrag(1));
  mitschnitt.aktiv = true;
  await queue.warteschlangeZustand();
  mitschnitt.aktiv = false;
  const jobAbfragen = mitschnitt.sql.filter((sql) => /\bjob\b/.test(sql));
  assert.ok(jobAbfragen.length > 0);
  for (const sql of jobAbfragen) assert.ok(!/\bdata\b/.test(sql));
});

test("AGG-6: ein eigener Schemaname wird für die Messung übernommen", async (t) => {
  const queues = [];
  t.after(() => Promise.all(queues.map((queue) => queue.stop())));
  const eingebettet = await neuePglite();
  const queue = withConfigOverrides({ queueBackend: "pgboss" }, () =>
    createQueue({ schema: "eigenes_schema", bossOptions: { db: fromPglite(eingebettet), backend: "pglite" } }),
  );
  queues.push(queue);
  await queue.enqueue(auftrag(1));
  const [zustand] = await queue.warteschlangeZustand();
  assert.equal(zustand.laenge, 1);
});
