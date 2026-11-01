import { test } from "node:test";
import assert from "node:assert/strict";
import { neueUhr, pgBossUmgebung } from "../gemeinsam/pgboss-umgebung.js";

const KIND = "provision_number";
const FEHLVERSUCHE = 4;
const ABLAUF_MS = 30 * 60 * 1000;

const auftrag = (nummer) => ({
  kind: KIND,
  payload: { numberId: nummer },
  idempotencyKey: `provision_${nummer}`,
});

async function mitAbsturz(t, nummer) {
  const clock = neueUhr();
  const umgebung = await pgBossUmgebung(t, { clock });
  const id = await umgebung.queue.enqueue(auftrag(nummer));
  return { ...umgebung, clock, id };
}

test("K1-1: pg-boss stellt einen Auftrag zu, drain führt ihn aus, jobStatus meldet done", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const { queue } = umgebung;
  const id = await queue.enqueue(auftrag("num_1"));
  assert.equal(await queue.jobStatus(id), "queued");
  const gesehen = [];
  assert.equal(await queue.drain(async (job) => gesehen.push(job)), 1);
  const [job] = gesehen;
  assert.deepEqual(
    [job.kind, job.payload, job.idempotencyKey],
    [KIND, { numberId: "num_1" }, "provision_num_1"],
  );
  assert.equal(await queue.jobStatus(id), "done");
});

test("K1-2: derselbe idempotencyKey legt keinen zweiten wartenden Auftrag an", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const { queue } = umgebung;
  const erster = await queue.enqueue(auftrag("num_2"));
  assert.equal(await queue.enqueue(auftrag("num_2")), erster);
  assert.equal(await queue.drain(async () => undefined), 1);
});

test("K1-3: enqueue ohne idempotencyKey wird abgelehnt", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  await assert.rejects(
    umgebung.queue.enqueue({ kind: KIND, payload: {}, idempotencyKey: "" }),
    TypeError,
  );
});

test("K1-4: ein Fehlschlag setzt den Auftrag zurück in die Warteschlange, er ist nicht verloren", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  const { queue } = umgebung;
  const id = await queue.enqueue(auftrag("num_4"));
  const scheitern = async () => {
    throw new Error("Anbieter nicht erreichbar");
  };
  assert.equal(await queue.drain(scheitern), 1);
  assert.equal(await queue.jobStatus(id), "queued");
});

test("K1-5: nach Absturz mitten im Auftrag wird er nach Ablauf erneut zugestellt", async (t) => {
  const umgebung = await mitAbsturz(t, "num_5");
  const { db, queue, clock, id } = umgebung;
  await db.abfragen(
    "UPDATE pgboss.job SET state = 'active', started_on = to_timestamp($1 / 1000.0) WHERE name = $2",
    [clock.now(), KIND],
  );
  assert.equal(
    await queue.drain(async () => assert.fail("Auftrag darf noch nicht fällig sein")),
    0,
  );
  await clock.tick(ABLAUF_MS);
  const gesehen = [];
  assert.equal(await queue.drain(async (job) => gesehen.push(job.idempotencyKey)), 1);
  assert.deepEqual(gesehen, ["provision_num_5"]);
  assert.equal(await queue.jobStatus(id), "done");
});

test("K1-6: nach dem vierten Fehlversuch landet der Auftrag in der Totpost-Ablage und kommt nicht wieder", async (t) => {
  const umgebung = await mitAbsturz(t, "num_6");
  const { db, queue, clock, id } = umgebung;
  let versuche = 0;
  const scheitern = async () => {
    versuche += 1;
    throw new Error("Anbieter nicht erreichbar");
  };
  for (let runde = 1; runde <= FEHLVERSUCHE; runde += 1) {
    assert.equal(await queue.drain(scheitern), 1, `Versuch ${runde} wird zugestellt`);
    await clock.tick(ABLAUF_MS);
  }
  assert.equal(versuche, FEHLVERSUCHE);
  assert.equal(await queue.drain(scheitern), 0);
  assert.equal(await queue.jobStatus(id), "failed");
  const { rows } = await db.abfragen("SELECT data FROM pgboss.job WHERE name = $1", [
    `${KIND}_totpost`,
  ]);
  assert.deepEqual(
    rows.map((zeile) => zeile.data.idempotencyKey),
    ["provision_num_6"],
  );
});

test("K1-9: ein neuer Prozess findet die Aufträge des alten, auch ohne eigenes enqueue", async (t) => {
  const umgebung = await pgBossUmgebung(t);
  await umgebung.queue.enqueue(auftrag("num_9"));
  await umgebung.queue.stop();
  const gesehen = [];
  const verarbeitet = await umgebung
    .weitereQueue()
    .drain(async (job) => gesehen.push(job.idempotencyKey));
  assert.equal(verarbeitet, 1);
  assert.deepEqual(gesehen, ["provision_num_9"]);
});
