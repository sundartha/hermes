import { isSubstantialCallerText } from "./claude.js";

interface Zeile {
  role?: string;
  text: string;
}

interface Anruf {
  direction?: string;
  status?: string;
  transcript?: (Zeile | null)[];
}

interface Einstellungen {
  allowSummaries?: boolean;
}

const INBOX_MIN_CALLER_TURNS = 2;
const INBOX_MIN_CALLER_CHARS = 12;

function substantialCallerLines(call: Anruf | null | undefined): Zeile[] {
  const transcript = Array.isArray(call?.transcript) ? call.transcript : [];
  return transcript.flatMap((entry) => (entry?.role === "caller" && isSubstantialCallerText(entry.text) ? [entry] : []));
}

function hasInboxSubstance(call: Anruf): boolean {
  const lines = substantialCallerLines(call);
  if (lines.length >= INBOX_MIN_CALLER_TURNS) return true;
  const chars = lines.reduce((sum: number, entry) => sum + entry.text.trim().length, 0);
  return chars >= INBOX_MIN_CALLER_CHARS;
}

export function qualifiesAsInboxEntry(call: Anruf | null | undefined, settings: Einstellungen | null | undefined): boolean {
  if (call?.direction !== "inbound") return false;
  if (call.status !== "completed") return false;
  if (settings?.allowSummaries !== true) return false;
  return hasInboxSubstance(call);
}
