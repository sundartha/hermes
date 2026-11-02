import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueue } from "../../src/queue/registry.js";
import { withQueueBackend } from "../gemeinsam/pgboss-umgebung.js";

test("S1-17a: QUEUE_BACKEND=memory -> QueuePort-Form (enqueue/drain/jobStatus als Funktionen)", () => {
  withQueueBackend("memory", () => {
    let queue;
    assert.doesNotThrow(() => {
      queue = createQueue();
    });
    assert.equal(typeof queue.enqueue, "function");
    assert.equal(typeof queue.drain, "function");
    assert.equal(typeof queue.jobStatus, "function");
  });
});

test("S1-17b: QUEUE_BACKEND=pgboss ohne DATABASE_URL -> wirft fail-closed", () => {
  withQueueBackend("pgboss", () => {
    assert.throws(() => createQueue({ connectionString: "" }), /DATABASE_URL/);
  });
});

test("S1-17c: unbekanntes QUEUE_BACKEND -> wirft fail-closed", () => {
  withQueueBackend("was-anderes", () => {
    assert.throws(() => createQueue(), /Unbekanntes QUEUE_BACKEND/);
  });
});

test("S1-17d: pgboss baut mit gültiger DATABASE_URL ohne Verbindung auf, wirft aber bei fehlender oder nicht-textlicher", () => {
  withQueueBackend("pgboss", () => {
    const adresse = "postgres://hermes@127.0.0.1:1/hermes";
    assert.doesNotThrow(() => createQueue({ connectionString: adresse }));
    assert.doesNotThrow(() => createQueue({ connectionString: undefined, bossOptions: { db: {} } }));
    for (const ungueltig of [undefined, null, 42])
      assert.throws(() => createQueue({ connectionString: ungueltig }), /DATABASE_URL/);
  });
});
