// Queue-Backend-Wahl hinter config.store.queueBackend (Default "memory", fail-closed).
// Konstruktion an EINER Stelle (P15: keine Lazy-Init im Fachcode); server.js bekommt
// die fertige Instanz. "pgboss" -> Stub wirft (deferred). Unbekannt -> fail-closed wirf.
import { config } from "../config.js";
import { makeMemoryQueue } from "./adapters/memory/queue.js";
import { makePgBossQueue } from "./adapters/pgboss/queue.js";

export function createQueue() {
  if (config.store.queueBackend === "pgboss") return makePgBossQueue();
  if (config.store.queueBackend === "memory") return makeMemoryQueue();
  throw new Error(`Unbekanntes QUEUE_BACKEND "${config.store.queueBackend}" (erlaubt: memory)`);
}
