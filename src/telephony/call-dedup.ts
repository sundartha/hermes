export const DEDUP_WINDOW_MS = 180000;

interface AktiverAnruf {
  direction: string;
  to: string;
  startedAt: string;
}

function imFenster(call: AktiverAnruf, nowMs: number) {
  return Date.parse(call.startedAt) >= nowMs - DEDUP_WINDOW_MS;
}

export function findDuplicateOutboundCall<T extends AktiverAnruf>(
  activeCalls: T[] | null | undefined,
  { to, nowMs }: { to: string | null | undefined; nowMs: number },
): T | null {
  if (!Array.isArray(activeCalls) || typeof to !== "string" || to === "") return null;
  return activeCalls
    .filter((call) => call.direction === "outbound" && call.to === to && imFenster(call, nowMs))
    .reduce<T | null>((neuster, call) => (!neuster || call.startedAt >= neuster.startedAt ? call : neuster), null);
}
