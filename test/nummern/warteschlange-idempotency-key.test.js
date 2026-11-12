import { test } from "node:test";
import assert from "node:assert/strict";
import { createQueue } from "../../src/queue/registry.js";
import { config } from "../../src/config.js";
import { makeConfigOverrides } from "../helpers.js";

const { withConfigOverrides } = makeConfigOverrides(config);
const MELDUNG = "enqueue: idempotencyKey muss ein nicht-leerer String sein";
const UNGUELTIG = ["", undefined, null, 123];

test("memory: ungültiger idempotencyKey wirft synchron TypeError", () => {
  withConfigOverrides({ queueBackend: "memory" }, () => {
    const queue = createQueue();
    for (const idempotencyKey of UNGUELTIG)
      assert.throws(() => queue.enqueue({ kind: "k", payload: {}, idempotencyKey }), {
        name: "TypeError",
        message: MELDUNG,
      });
    assert.equal(queue.enqueue({ kind: "k", payload: {}, idempotencyKey: "a" }), queue.enqueue({ kind: "k", payload: {}, idempotencyKey: "a" }));
  });
});

test("pgboss: ungültiger idempotencyKey lehnt ab, ohne Verbindung", async () => {
  await withConfigOverrides({ queueBackend: "pgboss" }, async () => {
    const queue = createQueue({ connectionString: "postgres://hermes@127.0.0.1:1/hermes" });
    for (const idempotencyKey of UNGUELTIG)
      await assert.rejects(queue.enqueue({ kind: "k", payload: {}, idempotencyKey }), {
        name: "TypeError",
        message: MELDUNG,
      });
  });
});
