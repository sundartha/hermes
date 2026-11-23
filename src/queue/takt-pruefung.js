import { MS_PER_MINUTE } from "../utils/timer.ts";

export function loeschtaktBefund(config) {
  const taktMs = config.store.webhookZustellungLoeschtaktMs;
  if (config.store.queueBackend !== "pgboss" || Number.isInteger(taktMs / MS_PER_MINUTE)) return null;
  return (
    `WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS=${String(taktMs)} passt nicht zu QUEUE_BACKEND=pgboss: ` +
    "der Zeitplan kennt nur Takte in ganze Minuten."
  );
}
