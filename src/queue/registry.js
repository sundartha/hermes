import { z } from "zod";
import { config } from "../config.ts";
import { makeMemoryQueue } from "./adapters/memory/queue.ts";
import { makePgBossQueue } from "./adapters/pgboss/queue.ts";

const QUEUE_KONFIG = z.object({
  store: z.object({ queueBackend: z.string(), databaseUrl: z.string() }),
});

function queueKonfig() {
  return QUEUE_KONFIG.parse(config);
}

export function createQueue(options = {}) {
  const { store: speicher } = queueKonfig();
  if (speicher.queueBackend === "pgboss")
    return makePgBossQueue({ connectionString: speicher.databaseUrl, ...options });
  if (speicher.queueBackend === "memory") return makeMemoryQueue();
  throw new Error(`Unbekanntes QUEUE_BACKEND "${speicher.queueBackend}" (erlaubt: memory, pgboss)`);
}
