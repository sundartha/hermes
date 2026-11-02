import { config } from "../config.js";
import { makeMemoryQueue } from "./adapters/memory/queue.js";
import { makePgBossQueue } from "./adapters/pgboss/queue.js";

export function createQueue(options = {}) {
  if (config.store.queueBackend === "pgboss")
    return makePgBossQueue({ connectionString: config.store.databaseUrl, ...options });
  if (config.store.queueBackend === "memory") return makeMemoryQueue();
  throw new Error(
    `Unbekanntes QUEUE_BACKEND "${config.store.queueBackend}" (erlaubt: memory, pgboss)`,
  );
}
