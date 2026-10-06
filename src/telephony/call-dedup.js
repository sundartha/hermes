export const DEDUP_WINDOW_MS = 180000;

function imFenster(call, nowMs) {
  return Date.parse(call.startedAt) >= nowMs - DEDUP_WINDOW_MS;
}

export function findDuplicateOutboundCall(activeCalls, { to, nowMs }) {
  if (!Array.isArray(activeCalls) || typeof to !== "string" || to === "") return null;
  return activeCalls
    .filter((call) => call.direction === "outbound" && call.to === to && imFenster(call, nowMs))
    .reduce((neuster, call) => (!neuster || call.startedAt >= neuster.startedAt ? call : neuster), null);
}
