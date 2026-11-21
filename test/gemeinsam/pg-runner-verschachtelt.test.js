import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import pg from "pg";

const abfragen = [];
let verbindungen = 0;

pg.Pool = class AttrappenPool extends EventEmitter {
  waitingCount = 0;
  totalCount = 0;

  async connect() {
    verbindungen += 1;
    return { query: async (text) => abfragen.push(text), release() {} };
  }
};

const { createPgPoolRunner } = await import("../../src/store/pg-runner.js");

test("Abfrage innerhalb einer Abfrage auf der gehaltenen Verbindung laeuft sofort mit, ohne sich hinter die aeussere zu stellen", async () => {
  const { runner } = await createPgPoolRunner("postgres://attrappe.invalid/hermes");
  abfragen.length = 0;
  verbindungen = 0;
  let innenAngelaufen = false;
  await runner.halten(async () => {
    await runner.withClient(async () => {
      const innen = runner.withClient(async (sicht) => {
        innenAngelaufen = true;
        await sicht.query("innen");
      });
      for (let runde = 0; runde < 20; runde += 1) await Promise.resolve();
      assert.equal(innenAngelaufen, true);
      await innen;
    });
  });
  assert.deepEqual(abfragen, ["innen"]);
  assert.equal(verbindungen, 1);
});
