import { TestClock, fromPglite } from "pg-boss";
import { config } from "../../src/config.js";
import { createQueue } from "../../src/queue/registry.js";
import { neuePglite } from "../pglite-helfer.js";
import { POSTGRES_VARIABLE, echteDatenbank } from "./echtes-postgres.js";

const TESTBEGINN_MS = Date.UTC(2026, 10, 1, 8, 0, 0);

export function withQueueBackend(value, fn) {
  const original = config.store.queueBackend;
  config.store.queueBackend = value;
  try {
    return fn();
  } finally {
    config.store.queueBackend = original;
  }
}

export function neueUhr() {
  return new TestClock(TESTBEGINN_MS);
}

async function datenbank(t) {
  if (process.env[POSTGRES_VARIABLE]) {
    const echt = await echteDatenbank(t);
    const verbindung = await echt.verbinden();
    return {
      art: "postgres",
      queueOptionen: { connectionString: echt.adresse },
      abfragen: (sql, parameter) => verbindung.query(sql, parameter),
    };
  }
  const eingebettet = await neuePglite();
  return {
    art: "pglite",
    queueOptionen: { bossOptions: { db: fromPglite(eingebettet), backend: "pglite" } },
    abfragen: (sql, parameter) => eingebettet.query(sql, parameter),
  };
}

export async function pgBossUmgebung(t, optionen = {}) {
  const queues = [];
  t.after(async () => {
    await Promise.all(queues.map((queue) => queue.stop()));
  });
  const db = await datenbank(t);
  const weitereQueue = (weitere = {}) =>
    withQueueBackend("pgboss", () => {
      const queue = createQueue({ ...db.queueOptionen, ...optionen, ...weitere });
      queues.push(queue);
      return queue;
    });
  return { db, queue: weitereQueue(), weitereQueue };
}

export async function wackeligeWarteschlange(t) {
  const queues = [];
  t.after(async () => {
    await Promise.all(queues.map((queue) => queue.stop()));
  });
  const eingebettet = await neuePglite();
  const echt = fromPglite(eingebettet);
  const zustand = { ausfall: true };
  const db = {
    ...echt,
    executeSql: (...argumente) =>
      zustand.ausfall
        ? Promise.reject(new Error("Datenbank nicht erreichbar"))
        : echt.executeSql(...argumente),
  };
  return withQueueBackend("pgboss", () => {
    const queue = createQueue({ bossOptions: { db, backend: "pglite" } });
    queues.push(queue);
    return { queue, zustand };
  });
}
