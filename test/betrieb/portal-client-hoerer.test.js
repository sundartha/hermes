import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import pg from "pg";
import { fehlerausgabeVonAsync } from "../gemeinsam/fehlerausgabe.js";
import { createPortalRunner } from "../../src/portal-pool.js";

function installierePoolMitClients(t, clients) {
  const echterPool = pg.Pool;
  t.after(() => {
    pg.Pool = echterPool;
  });
  pg.Pool = class PoolMitClients extends EventEmitter {
    async connect() {
      const client = clients.shift();
      this.emit("acquire", client);
      client.release = () => this.emit("release", undefined, client);
      return client;
    }
  };
}

function neuerClient(abfrage) {
  const client = new EventEmitter();
  client.query = abfrage;
  return client;
}

const PRUEFUNG = async () => ({ rows: [{ is_su: "off", rolbypassrls: false }] });

test("Portal-Client: Verbindungsabbruch waehrend withClient meldet den Verlust und beendet nur die Abfrage", async (t) => {
  const arbeitsClient = neuerClient(() => {
    arbeitsClient.emit("error", new Error("terminating connection"));
    return Promise.reject(new Error("Connection terminated"));
  });
  installierePoolMitClients(t, [neuerClient(PRUEFUNG), arbeitsClient]);
  const runner = await createPortalRunner();
  let abfrageFehler;
  const zeilen = await fehlerausgabeVonAsync(async () => {
    await runner.withClient((c) => c.query("SELECT 1", [])).catch((fehler) => (abfrageFehler = fehler));
  });
  assert.equal(abfrageFehler?.message, "Connection terminated");
  assert.deepEqual(zeilen, ["[pool:portal] Verbindungsfehler: terminating connection"]);
});

test("Portal-Client: nach dem Release haengt kein Fehlerhoerer mehr am Client", async (t) => {
  const arbeitsClient = neuerClient(async () => ({ rows: [] }));
  installierePoolMitClients(t, [neuerClient(PRUEFUNG), arbeitsClient]);
  const runner = await createPortalRunner();
  let waehrend;
  await runner.withClient(async (c) => {
    waehrend = arbeitsClient.listenerCount("error");
    return c.query("SELECT 1", []);
  });
  assert.equal(waehrend, 1);
  assert.equal(arbeitsClient.listenerCount("error"), 0);
});
