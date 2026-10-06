import { isSubstantialCallerText } from "./claude.js";

const INBOX_MIN_CALLER_TURNS = 2;
const INBOX_MIN_CALLER_CHARS = 12;

function substantialCallerLines(call) {
  const transcript = Array.isArray(call?.transcript) ? call.transcript : [];
  return transcript.filter((entry) => entry?.role === "caller" && isSubstantialCallerText(entry.text));
}

function hasInboxSubstance(call) {
  const lines = substantialCallerLines(call);
  if (lines.length >= INBOX_MIN_CALLER_TURNS) return true;
  const chars = lines.reduce((sum, entry) => sum + entry.text.trim().length, 0);
  return chars >= INBOX_MIN_CALLER_CHARS;
}

export function qualifiesAsInboxEntry(call, settings) {
  if (!call || call.direction !== "inbound") return false;
  if (call.status !== "completed") return false;
  if (settings?.allowSummaries !== true) return false;
  return hasInboxSubstance(call);
}
