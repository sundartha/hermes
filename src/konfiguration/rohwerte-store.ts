import { MS_PER_MINUTE } from "../utils/timer.ts";
import type { umgebungMit } from "./umgebung.ts";

const WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MAX_MS = MS_PER_MINUTE;
const WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MIN_MS = 100;

export function rohwerteStore(
  env: {
    STORE_BACKEND?: string | undefined;
    DATABASE_URL?: string | undefined;
    KENNZAHLEN_DATABASE_URL?: string | undefined;
    QUEUE_BACKEND?: string | undefined;
    WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS?: string | undefined;
  },
  { numEnv, textEnv }: Pick<ReturnType<typeof umgebungMit>, "numEnv" | "textEnv">,
) {
  return {
    storeBackend: textEnv(env.STORE_BACKEND, "json").toLowerCase(),
    databaseUrl: env.DATABASE_URL ?? "",
    kennzahlenDatabaseUrl: env.KENNZAHLEN_DATABASE_URL ?? "",
    queueBackend: textEnv(env.QUEUE_BACKEND, "memory").toLowerCase(),
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
