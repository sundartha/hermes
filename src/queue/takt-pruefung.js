import { MS_PER_MINUTE } from "../utils/timer.js";

export function loeschtaktBefund(config) {
  const taktMs = config.store.webhookZustellungLoeschtaktMs;
  if (config.store.queueBackend !== "pgboss" || taktMs % MS_PER_MINUTE === 0) return null;
  return (
    `WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS=${taktMs} passt nicht zu QUEUE_BACKEND=pgboss: ` +
    "der Zeitplan kennt nur Takte in ganze Minuten."
  );
}
