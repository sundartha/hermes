import { config } from "../config.js";
import * as store from "../store.js";
import { localeFor } from "../i18n/locales.js";
import { bookLookupSearchFee } from "../llm-usage.js";
import { callLookups } from "../store/state-ops.js";
import { LOOKUP_MAX_PER_CALL, inCallSearchProvider } from "./registry.js";
import { lookupFactsFrom, sanitizeLookupQuery } from "./lookup-guard.js";

export const LOOK_UP_TOOL_NAME = "look_up";

export { LOOKUP_MAX_PER_CALL } from "./registry.js";

export const LOOKUP_TIMEOUT_MS = 2500;

export function lookupProviderFor(call) {
  if (config.research.lookupEnabled !== true) return null;
  if (config.tenancy.assistantContextEnabled !== true) return null;
  if (call.direction !== "outbound") return null;
  if (call.status !== "active") return null;
  if (callLookups(call) >= LOOKUP_MAX_PER_CALL) return null;
  return inCallSearchProvider({
    tenantAllows: store.resolveProfile(call.tenantId)?.allowLookup === true,
  });
}

export const lookupAvailableFor = (call) => lookupProviderFor(call) !== null;

function logLookupBlocked(callId) {
  console.warn(`[lookup] verworfen grund=egress call=${callId}`);
}

function logLookupDone({ callId, ok, dauerMs, fakten }) {
  console.log(`[lookup] fertig call=${callId} ok=${ok} dauer_ms=${dauerMs} fakten=${fakten}`);
}

export async function performLookupRequest({ call, toolUses, loopContinues }) {
  const requested = toolUses.find((tu) => tu.name === LOOK_UP_TOOL_NAME);
  if (!requested) return null;
  const tc = localeFor(call.language).prompt.turnControl;
  const declined = { toolResult: tc.lookUpDeclined };
  if (!loopContinues) return declined;
  const provider = lookupProviderFor(call);
  if (!provider) return declined;
  const query = sanitizeLookupQuery(requested.input?.query, call);
  if (!query) {
    logLookupBlocked(call.id);
    return declined;
  }
  store.countCallLookup(call.id);
  bookLookupSearchFee({ tenantId: call.tenantId });
  const startedAt = Date.now();
  const res = await provider.searchFacts({ query, timeoutMs: LOOKUP_TIMEOUT_MS });
  const facts = res.ok ? lookupFactsFrom(res.facts) : [];
  logLookupDone({
    callId: call.id,
    ok: res.ok === true,
    dauerMs: Date.now() - startedAt,
    fakten: facts.length,
  });
  if (!facts.length) return { toolResult: tc.lookUpUnavailable };
  const added = store.addLookupFacts(call.id, facts);
  return { toolResult: added > 0 ? tc.lookUpResult : tc.lookUpUnavailable };
}
