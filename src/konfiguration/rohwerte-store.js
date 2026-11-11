import { MS_PER_MINUTE } from "../utils/timer.js";

const WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MAX_MS = MS_PER_MINUTE;
const WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MIN_MS = 100;

export function rohwerteStore(env, { numEnv }) {
  return {
    storeBackend: (env.STORE_BACKEND || "json").toLowerCase(),
    databaseUrl: env.DATABASE_URL || "",
    kennzahlenDatabaseUrl: env.KENNZAHLEN_DATABASE_URL || "",
    queueBackend: (env.QUEUE_BACKEND || "memory").toLowerCase(),
    webhookZustellungLoeschtaktMs: numEnv(
      "WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS",
      env.WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS,
      {
        fallback: WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MAX_MS,
        min: WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MIN_MS,
        max: WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MAX_MS,
      },
    ),
  };
}
