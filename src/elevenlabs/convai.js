import { kiHinweisRahmenFor } from "../i18n/eroeffnung.js";
import { disclosurePrefixFor } from "../i18n/locales.js";

const OUTBOUND_CALL_PATH = "/v1/convai/sip-trunk/outbound-call";
const CONVERSATION_PATH = "/v1/convai/conversations/";
const PHONE_NUMBER_PATH = "/v1/convai/phone-numbers/";
const PHONE_NUMBERS_PATH = "/v1/convai/phone-numbers";
const CONVAI_SETTINGS_PATH = "/v1/convai/settings";
const CONVAI_SECRETS_PATH = "/v1/convai/secrets";
const CONVERSATIONS_PATH = "/v1/convai/conversations";
const AGENT_PATH = "/v1/convai/agents/";
const SECRET_TYP_NEU = "new";
const SECRET_TYP_UPDATE = "update";
const API_KEY_HEADER = "xi-api-key";

export const REQUEST_TIMEOUT_MS = 120000;

function assertConvaiOk(res, op) {
  if (res.ok) return;
  const err = new Error(`ElevenLabs ${op} fehlgeschlagen: HTTP ${res.status}`);
  err.providerStatus = res.status;
  throw err;
}

export const OVERRIDE_ALLOWED_LEAF_PATHS = Object.freeze(["agent.language", "tts.voice_id"]);
export const OVERRIDE_FIRST_MESSAGE_LEAF_PATHS = Object.freeze(["agent.first_message"]);
export const OVERRIDE_ALL_LEAF_PATHS = Object.freeze([...OVERRIDE_ALLOWED_LEAF_PATHS, ...OVERRIDE_FIRST_MESSAGE_LEAF_PATHS]);
const OVERRIDE_PATH_SEPARATOR = ".";

function overrideOf(body) {
  return body?.conversation_initiation_client_data?.conversation_config_override;
}

export function isPlainObject(wert) {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert);
}

export function overrideLeafPaths(wert, prefix) {
  if (!isPlainObject(wert)) return prefix.length ? [prefix.join(OVERRIDE_PATH_SEPARATOR)] : [];
  return Object.entries(wert).flatMap(([schluessel, kind]) =>
    overrideLeafPaths(kind, [...prefix, schluessel]),
  );
}

export function overrideValueAtPath(override, pfad) {
  return pfad.split(OVERRIDE_PATH_SEPARATOR).reduce((knoten, schluessel) => knoten?.[schluessel], override);
}

function erlaubtePfadeFuer(override, { calleeIsOwner, disclosureLanguage }) {
  const firstMessageErlaubt = calleeIsOwner === true || spracheWeichtAb(override, disclosureLanguage);
  return firstMessageErlaubt ? OVERRIDE_ALL_LEAF_PATHS : OVERRIDE_ALLOWED_LEAF_PATHS;
}

export function verboteneOverridePfade(override, erlaubt) {
  if (!isPlainObject(override)) return ["(conversation_config_override ist kein Objekt)"];
  return overrideLeafPaths(override, []).filter((pfad) => !erlaubt.includes(pfad));
}

function assertOverrideWhitelisted(body, callId, { calleeIsOwner = false, disclosureLanguage = null } = {}) {
  const override = overrideOf(body);
  if (override === undefined || override === null) return;
  const erlaubt = erlaubtePfadeFuer(override, { calleeIsOwner, disclosureLanguage });
  const verboten = verboteneOverridePfade(override, erlaubt);
  if (verboten.length === 0) return;
  console.error(
    `[el-outbound] conversation_config_override abgelehnt (call=${callId}): verbotene(r) Pfad(e) ${verboten.join(", ")} - erlaubt sind ausschliesslich ${erlaubt.join(", ")}`,
  );
  throw new Error(
    `ElevenLabs-Anrufstart abgebrochen: conversation_config_override enthaelt nicht erlaubte(n) Pfad(e) (${verboten.join(", ")})`,
  );
}

const spracheWeichtAb = (override, disclosureLanguage) =>
  disclosureLanguage !== null && override?.agent?.language !== disclosureLanguage;

const fehlendeEroeffnung = (eroeffnung) => typeof eroeffnung !== "string" || !eroeffnung;

function fehlendeEroeffnungFehler(callId, override, disclosureLanguage) {
  return new Error(
    `Anrufstart abgebrochen (call=${callId}): agent.language=${override?.agent?.language} weicht von ` +
      `der Offenlegungssprache ${disclosureLanguage} ab, aber der Anruf bringt keine eigene ` +
      "agent.first_message mit - der Anbieter spraeche den Pflichtsatz seines Presets.",
  );
}

function falscherPflichtsatzFehler(callId, disclosureLanguage) {
  return new Error(
    `Anrufstart abgebrochen (call=${callId}): agent.first_message enthaelt nicht den ` +
      `Offenlegungssatz der Sprache ${disclosureLanguage} (Artikel 50 EU AI Act).`,
  );
}

function kiSatzNachAnlass(eroeffnung, pre) {
  const stelle = eroeffnung.indexOf(pre);
  return (
    stelle !== -1 &&
    stelle === eroeffnung.lastIndexOf(pre) &&
    stelle + pre.length < eroeffnung.length &&
    !eroeffnung.slice(0, stelle).includes("?")
  );
}

function fehlenderKiSatz(eroeffnung, disclosureLanguage, pre) {
  return !eroeffnung.startsWith(disclosurePrefixFor(disclosureLanguage)) && !kiSatzNachAnlass(eroeffnung, pre);
}

function pflichtsatzFehlt(eroeffnung, disclosureLanguage, calleeIsOwner) {
  if (calleeIsOwner === true) return false;
  return fehlenderKiSatz(eroeffnung, disclosureLanguage, kiHinweisRahmenFor(disclosureLanguage).pre);
}

function keineEroeffnungFehler(callId) {
  return new Error(
    `Anrufstart abgebrochen (call=${callId}): dynamic_variables.eroeffnung oder opening_line fehlt oder traegt ` +
      "nicht den KI-Satz vor der ersten Frage (Artikel 50 EU AI Act).",
  );
}

function assertEroeffnungVariable(body, callId, disclosureLanguage) {
  const variablen = body.conversation_initiation_client_data.dynamic_variables;
  const eroeffnung = variablen?.eroeffnung;
  if (
    fehlendeEroeffnung(eroeffnung) ||
    fehlendeEroeffnung(variablen.opening_line) ||
    fehlenderKiSatz(eroeffnung, disclosureLanguage, kiHinweisRahmenFor(disclosureLanguage).pre)
  )
    throw keineEroeffnungFehler(callId);
}

function assertAndereSpracheGetragen(override, callId, { calleeIsOwner, disclosureLanguage }) {
  const eroeffnung = override?.agent?.first_message;
  if (fehlendeEroeffnung(eroeffnung)) throw fehlendeEroeffnungFehler(callId, override, disclosureLanguage);
  if (pflichtsatzFehlt(eroeffnung, disclosureLanguage, calleeIsOwner))
    throw falscherPflichtsatzFehler(callId, disclosureLanguage);
}

function assertDisclosureCarried(body, callId, { calleeIsOwner, disclosureLanguage = null } = {}) {
  const override = overrideOf(body);
  if (disclosureLanguage === null) return;
  if (spracheWeichtAb(override, disclosureLanguage)) {
    assertAndereSpracheGetragen(override, callId, { calleeIsOwner, disclosureLanguage });
    return;
  }
  if (!override.agent.first_message) assertEroeffnungVariable(body, callId, disclosureLanguage);
}

async function convaiFetch({ fetchImpl, account, path, op, init, timeoutMs = REQUEST_TIMEOUT_MS }) {
  const res = await fetchImpl(`${account.apiBase}${path}`, {
    ...init,
    headers: { [API_KEY_HEADER]: account.apiKey, "content-type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  assertConvaiOk(res, op);
  return res.json();
}

export function startResultOf(antwort) {
  return { conversationId: antwort?.conversation_id || null };
}

export function assertEroeffnungGeprueft(body, callId, kontext) {
  assertOverrideWhitelisted(body, callId, kontext);
  assertDisclosureCarried(body, callId, kontext);
}

export async function startOutboundCall({
  fetchImpl,
  account,
  body,
  callId,
  calleeIsOwner = false,
  disclosureLanguage = null,
}) {
  assertEroeffnungGeprueft(body, callId, { calleeIsOwner, disclosureLanguage });
  const antwort = await convaiFetch({
    fetchImpl,
    account,
    path: OUTBOUND_CALL_PATH,
    op: "Anrufstart",
    init: { method: "POST", body: JSON.stringify(body) },
  });
  return startResultOf(antwort);
}

export function fetchConversation({ fetchImpl, account, conversationId, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVERSATION_PATH + encodeURIComponent(conversationId),
    op: "Gespraechsabruf",
    init: { method: "GET" },
    timeoutMs,
  });
}

async function fireAndForgetDelete({ fetchImpl, account, path, timeoutMs }) {
  try {
    const res = await fetchImpl(`${account.apiBase}${path}`, {
      method: "DELETE",
      headers: { [API_KEY_HEADER]: account.apiKey, "content-type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { accepted: res.ok, status: res.status };
  } catch {
    return { accepted: false, status: null };
  }
}

export function endConversation({ fetchImpl, account, conversationId, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return fireAndForgetDelete({
    fetchImpl,
    account,
    path: CONVERSATION_PATH + encodeURIComponent(conversationId),
    timeoutMs,
  });
}

export function fetchPhoneNumber({ fetchImpl, account, phoneNumberId, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: PHONE_NUMBER_PATH + encodeURIComponent(phoneNumberId),
    op: "Nummernabruf",
    init: { method: "GET" },
    timeoutMs,
  });
}

export function listPhoneNumbers({ fetchImpl, account, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: PHONE_NUMBERS_PATH,
    op: "Nummernliste",
    init: { method: "GET" },
    timeoutMs,
  });
}

export async function createPhoneNumber({ fetchImpl, account, body }) {
  const antwort = await convaiFetch({
    fetchImpl,
    account,
    path: PHONE_NUMBERS_PATH,
    op: "Nummernregistrierung",
    init: { method: "POST", body: JSON.stringify(body) },
  });
  return { phoneNumberId: antwort?.phone_number_id || null };
}

export function deletePhoneNumber({ fetchImpl, account, phoneNumberId, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return fireAndForgetDelete({
    fetchImpl,
    account,
    path: PHONE_NUMBER_PATH + encodeURIComponent(phoneNumberId),
    timeoutMs,
  });
}

export function fetchConvaiSettings({ fetchImpl, account, timeoutMs = REQUEST_TIMEOUT_MS }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVAI_SETTINGS_PATH,
    op: "Workspace-Settings-Abruf",
    init: { method: "GET" },
    timeoutMs,
  });
}

export function patchConvaiSettings({ fetchImpl, account, body }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVAI_SETTINGS_PATH,
    op: "Workspace-Settings-Schreiben",
    init: { method: "PATCH", body: JSON.stringify(body) },
  });
}

export function listConvaiSecrets({ fetchImpl, account, search, pageSize }) {
  const query = new URLSearchParams({ search, page_size: String(pageSize) });
  return convaiFetch({
    fetchImpl,
    account,
    path: `${CONVAI_SECRETS_PATH}?${query}`,
    op: "Secret-Liste",
    init: { method: "GET" },
  });
}

export function createConvaiSecret({ fetchImpl, account, name, value }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVAI_SECRETS_PATH,
    op: "Secret-Anlegen",
    init: { method: "POST", body: JSON.stringify({ type: SECRET_TYP_NEU, name, value }) },
  });
}

export function updateConvaiSecret({ fetchImpl, account, secretId, name, value }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: `${CONVAI_SECRETS_PATH}/${encodeURIComponent(secretId)}`,
    op: "Secret-Aktualisieren",
    init: { method: "PATCH", body: JSON.stringify({ type: SECRET_TYP_UPDATE, name, value }) },
  });
}

export function patchPhoneNumber({ fetchImpl, account, phoneNumberId, body }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: PHONE_NUMBER_PATH + encodeURIComponent(phoneNumberId),
    op: "Nummernregistrierung-Aendern",
    init: { method: "PATCH", body: JSON.stringify(body) },
  });
}

export function listConversations({ fetchImpl, account, query }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: `${CONVERSATIONS_PATH}?${new URLSearchParams(query)}`,
    op: "Gespraechsliste",
    init: { method: "GET" },
  });
}

export function fetchAgent({ fetchImpl, account, agentId }) {
  return convaiFetch({
    fetchImpl,
    account,
    path: AGENT_PATH + encodeURIComponent(agentId),
    op: "Agent-Abruf",
    init: { method: "GET" },
  });
}
