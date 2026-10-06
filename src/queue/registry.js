import { config } from "../config.js";
import { makeMemoryQueue } from "./adapters/memory/queue.js";
import { makePgBossQueue } from "./adapters/pgboss/queue.js";

// Begründung, die eingefroren werden soll
export function createQueue() {
  if (config.store.queueBackend === "pgboss") return makePgBossQueue();
  if (config.store.queueBackend === "memory") return makeMemoryQueue();
  throw new Error(`Unbekanntes QUEUE_BACKEND "${config.store.queueBackend}" (erlaubt: memory)`);
}
