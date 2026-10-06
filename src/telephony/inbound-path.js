const INBOUND_PATH_LOG_PREFIX = "[inbound-path]";

export const INBOUND_PATH = Object.freeze({
  BUDGET: "budget",
  ELEVENLABS: "elevenlabs",
  ABGEWIESEN: "abgewiesen",
});

export function logInboundPath({ callId, path }) {
  console.log(`${INBOUND_PATH_LOG_PREFIX} inbound_path ${JSON.stringify({ callId, path })}`);
}
