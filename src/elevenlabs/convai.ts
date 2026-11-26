import { kiHinweisRahmenFor } from "../i18n/eroeffnung.ts";
import { disclosurePrefixFor } from "../i18n/locales.ts";

const CONVERSATION_PATH = "/v1/convai/conversations/";
const PHONE_NUMBER_PATH = "/v1/convai/phone-numbers/";
const PHONE_NUMBERS_PATH = "/v1/convai/phone-numbers";
const CONVAI_SETTINGS_PATH = "/v1/convai/settings";
const CONVAI_SECRETS_PATH = "/v1/convai/secrets";
const CONVERSATIONS_PATH = "/v1/convai/conversations";
const AGENT_PATH = "/v1/convai/agents/";
const SECRET_TYP_NEU = "new";
const SECRET_TYP_UPDATE = "update";
const praefixFuer: (language: string) => string = disclosurePrefixFor;
const rahmenFuer: (language: string) => { pre: string } = kiHinweisRahmenFor;
const API_KEY_HEADER = "xi-api-key";

export interface ConvaiKonto {
  apiBase: string;
  apiKey: string;
}

interface ConvaiDaten {
  conversation_id?: unknown;
  phone_number_id?: unknown;
  [schluessel: string]: unknown;
}

export interface ConvaiNummer {
  phone_number?: unknown;
  phone_number_id?: unknown;
  [schluessel: string]: unknown;
}

interface ConvaiAntwort {
  ok: boolean;
  status: number;
  json: () => Promise<ConvaiDaten | null>;
}

type ConvaiFetchImpl = (
  url: string,
  init: { method?: string; body?: string; headers: Record<string, string>; fristMs: number },
) => Promise<ConvaiAntwort>;

interface Verbindung {
  fetchImpl: ConvaiFetchImpl;
  account: ConvaiKonto;
}

type MitFrist = Verbindung & { timeoutMs?: number };

interface Pfadbaum {
  readonly [schluessel: string]: Pfadbaum | undefined;
}

interface Eroeffnungskontext {
  calleeIsOwner?: unknown;
  disclosureLanguage?: string | null;
}

interface Pflichtkontext {
  calleeIsOwner: unknown;
  disclosureLanguage: string | null;
}

interface Override {
  agent?: { language?: unknown; first_message?: unknown };
}

interface Anrufkoerper {
  conversation_initiation_client_data?: {
    conversation_config_override?: Override | null;
    dynamic_variables?: { eroeffnung?: unknown; opening_line?: unknown };
  };
}

type ProviderFehler = Error & { providerStatus?: number };

export const REQUEST_TIMEOUT_MS = 120000;

function assertConvaiOk(res: ConvaiAntwort, op: string): void {
  if (res.ok) return;
  const err: ProviderFehler = new Error(`ElevenLabs ${op} fehlgeschlagen: HTTP ${String(res.status)}`);
  err.providerStatus = res.status;
  throw err;
}

export const OVERRIDE_ALLOWED_LEAF_PATHS = Object.freeze(["agent.language", "tts.voice_id"]);
export const OVERRIDE_FIRST_MESSAGE_LEAF_PATHS = Object.freeze(["agent.first_message"]);
export const OVERRIDE_ALL_LEAF_PATHS = Object.freeze([...OVERRIDE_ALLOWED_LEAF_PATHS, ...OVERRIDE_FIRST_MESSAGE_LEAF_PATHS]);
const OVERRIDE_PATH_SEPARATOR = ".";

function overrideOf(body: Anrufkoerper | undefined): Override | null | undefined {
  return body?.conversation_initiation_client_data?.conversation_config_override;
}

export function isPlainObject(wert: unknown): boolean {
  return wert !== null && typeof wert === "object" && !Array.isArray(wert);
}

export function overrideLeafPaths(wert: unknown, prefix: string[]): string[] {
  if (wert === null || typeof wert !== "object" || Array.isArray(wert)) {
    return prefix.length ? [prefix.join(OVERRIDE_PATH_SEPARATOR)] : [];
  }
  return Object.entries(wert).flatMap(([schluessel, kind]) =>
    overrideLeafPaths(kind, [...prefix, schluessel]),
  );
}

export function overrideValueAtPath(override: Pfadbaum | undefined, pfad: string): Pfadbaum | undefined {
  return pfad.split(OVERRIDE_PATH_SEPARATOR).reduce((knoten, schluessel) => knoten?.[schluessel], override);
}

function erlaubtePfadeFuer(override: Override, { calleeIsOwner, disclosureLanguage }: Pflichtkontext): readonly string[] {
  const firstMessageErlaubt = calleeIsOwner === true || spracheWeichtAb(override, disclosureLanguage);
  return firstMessageErlaubt ? OVERRIDE_ALL_LEAF_PATHS : OVERRIDE_ALLOWED_LEAF_PATHS;
}

export function verboteneOverridePfade(override: unknown, erlaubt: readonly string[]): string[] {
  if (!isPlainObject(override)) return ["(conversation_config_override ist kein Objekt)"];
  return overrideLeafPaths(override, []).filter((pfad) => !erlaubt.includes(pfad));
}

function assertOverrideWhitelisted(
  body: Anrufkoerper | undefined,
  callId: string,
  { calleeIsOwner = false, disclosureLanguage = null }: Eroeffnungskontext = {},
): void {
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

const spracheWeichtAb = (override: Override | null | undefined, disclosureLanguage: string | null): boolean =>
  disclosureLanguage !== null && override?.agent?.language !== disclosureLanguage;

const eroeffnungOderNull = (eroeffnung: unknown): string | null =>
  typeof eroeffnung === "string" && eroeffnung ? eroeffnung : null;

function fehlendeEroeffnungFehler(callId: string, override: Override | null | undefined, disclosureLanguage: string): Error {
  return new Error(
    `Anrufstart abgebrochen (call=${callId}): agent.language=${String(override?.agent?.language)} weicht von ` +
      `der Offenlegungssprache ${disclosureLanguage} ab, aber der Anruf bringt keine eigene ` +
      "agent.first_message mit - der Anbieter spraeche den Pflichtsatz seines Presets.",
  );
}

function falscherPflichtsatzFehler(callId: string, disclosureLanguage: string): Error {
  return new Error(
    `Anrufstart abgebrochen (call=${callId}): agent.first_message enthaelt nicht den ` +
      `Offenlegungssatz der Sprache ${disclosureLanguage} (Artikel 50 EU AI Act).`,
  );
}

function kiSatzNachAnlass(eroeffnung: string, pre: string): boolean {
  const stelle = eroeffnung.indexOf(pre);
  return (
    stelle !== -1 &&
    stelle === eroeffnung.lastIndexOf(pre) &&
    stelle + pre.length < eroeffnung.length &&
    !eroeffnung.slice(0, stelle).includes("?")
  );
}

function fehlenderKiSatz(eroeffnung: string, disclosureLanguage: string, pre: string): boolean {
  return !eroeffnung.startsWith(praefixFuer(disclosureLanguage)) && !kiSatzNachAnlass(eroeffnung, pre);
}

function pflichtsatzFehlt(eroeffnung: string, disclosureLanguage: string, calleeIsOwner: unknown): boolean {
  if (calleeIsOwner === true) return false;
  return fehlenderKiSatz(eroeffnung, disclosureLanguage, rahmenFuer(disclosureLanguage).pre);
}

function keineEroeffnungFehler(callId: string): Error {
  return new Error(
    `Anrufstart abgebrochen (call=${callId}): dynamic_variables.eroeffnung oder opening_line fehlt oder traegt ` +
      "nicht den KI-Satz vor der ersten Frage (Artikel 50 EU AI Act).",
  );
}

function assertEroeffnungVariable(body: Anrufkoerper | undefined, callId: string, disclosureLanguage: string): void {
  const variablen = body?.conversation_initiation_client_data?.dynamic_variables;
  const eroeffnung = eroeffnungOderNull(variablen?.eroeffnung);
  if (
    eroeffnung === null ||
    eroeffnungOderNull(variablen?.opening_line) === null ||
    fehlenderKiSatz(eroeffnung, disclosureLanguage, rahmenFuer(disclosureLanguage).pre)
  )
    throw keineEroeffnungFehler(callId);
}

function assertAndereSpracheGetragen(
  override: Override | null | undefined,
  callId: string,
  { calleeIsOwner, disclosureLanguage }: { calleeIsOwner: unknown; disclosureLanguage: string },
): void {
  const eroeffnung = eroeffnungOderNull(override?.agent?.first_message);
  if (eroeffnung === null) throw fehlendeEroeffnungFehler(callId, override, disclosureLanguage);
  if (pflichtsatzFehlt(eroeffnung, disclosureLanguage, calleeIsOwner))
    throw falscherPflichtsatzFehler(callId, disclosureLanguage);
}

function assertDisclosureCarried(
  body: Anrufkoerper | undefined,
  callId: string,
  { calleeIsOwner, disclosureLanguage = null }: Eroeffnungskontext = {},
): void {
  const override = overrideOf(body);
  if (disclosureLanguage === null) return;
  if (spracheWeichtAb(override, disclosureLanguage)) {
    assertAndereSpracheGetragen(override, callId, { calleeIsOwner, disclosureLanguage });
    return;
  }
  if (!override?.agent?.first_message) assertEroeffnungVariable(body, callId, disclosureLanguage);
}

async function convaiFetch({
  fetchImpl,
  account,
  path,
  op,
  init,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: MitFrist & { path: string; op: string; init: { method: string; body?: string } }): Promise<ConvaiDaten | null> {
  const res = await fetchImpl(`${account.apiBase}${path}`, {
    ...init,
    headers: { [API_KEY_HEADER]: account.apiKey, "content-type": "application/json" },
    fristMs: timeoutMs,
  });
  assertConvaiOk(res, op);
  return res.json();
}

function wahrOderNull(wert: unknown): unknown {
  if (wert) return wert;
  return null;
}

export function assertEroeffnungGeprueft(body: Anrufkoerper | undefined, callId: string, kontext: Eroeffnungskontext): void {
  assertOverrideWhitelisted(body, callId, kontext);
  assertDisclosureCarried(body, callId, kontext);
}

export function fetchConversation({
  fetchImpl,
  account,
  conversationId,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: MitFrist & { conversationId: string }): Promise<ConvaiDaten | null> {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVERSATION_PATH + encodeURIComponent(conversationId),
    op: "Gespraechsabruf",
    init: { method: "GET" },
    timeoutMs,
  });
}

async function fireAndForgetDelete({
  fetchImpl,
  account,
  path,
  timeoutMs,
}: Verbindung & { path: string; timeoutMs: number }): Promise<{ accepted: boolean; status: number | null }> {
  try {
    const res = await fetchImpl(`${account.apiBase}${path}`, {
      method: "DELETE",
      headers: { [API_KEY_HEADER]: account.apiKey, "content-type": "application/json" },
      fristMs: timeoutMs,
    });
    return { accepted: res.ok, status: res.status };
  } catch {
    return { accepted: false, status: null };
  }
}

export function endConversation({
  fetchImpl,
  account,
  conversationId,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: MitFrist & { conversationId: string }): ReturnType<typeof fireAndForgetDelete> {
  return fireAndForgetDelete({
    fetchImpl,
    account,
    path: CONVERSATION_PATH + encodeURIComponent(conversationId),
    timeoutMs,
  });
}

export function fetchPhoneNumber({
  fetchImpl,
  account,
  phoneNumberId,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: MitFrist & { phoneNumberId: string }): Promise<ConvaiDaten | null> {
  return convaiFetch({
    fetchImpl,
    account,
    path: PHONE_NUMBER_PATH + encodeURIComponent(phoneNumberId),
    op: "Nummernabruf",
    init: { method: "GET" },
    timeoutMs,
  });
}

export async function listPhoneNumbers({ fetchImpl, account, timeoutMs = REQUEST_TIMEOUT_MS }: MitFrist): Promise<ConvaiNummer[]> {
  const antwort = await convaiFetch({
    fetchImpl,
    account,
    path: PHONE_NUMBERS_PATH,
    op: "Nummernliste",
    init: { method: "GET" },
    timeoutMs,
  });
  if (!Array.isArray(antwort)) throw new Error("ElevenLabs Nummernliste: Antwort ohne Liste");
  return antwort;
}

export async function createPhoneNumber({
  fetchImpl,
  account,
  body,
}: Verbindung & { body: unknown }): Promise<{ phoneNumberId: unknown }> {
  const antwort = await convaiFetch({
    fetchImpl,
    account,
    path: PHONE_NUMBERS_PATH,
    op: "Nummernregistrierung",
    init: { method: "POST", body: JSON.stringify(body) },
  });
  return { phoneNumberId: wahrOderNull(antwort?.phone_number_id) };
}

export function deletePhoneNumber({
  fetchImpl,
  account,
  phoneNumberId,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: MitFrist & { phoneNumberId: string }): ReturnType<typeof fireAndForgetDelete> {
  return fireAndForgetDelete({
    fetchImpl,
    account,
    path: PHONE_NUMBER_PATH + encodeURIComponent(phoneNumberId),
    timeoutMs,
  });
}

export function fetchConvaiSettings({ fetchImpl, account, timeoutMs = REQUEST_TIMEOUT_MS }: MitFrist): Promise<ConvaiDaten | null> {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVAI_SETTINGS_PATH,
    op: "Workspace-Settings-Abruf",
    init: { method: "GET" },
    timeoutMs,
  });
}

export function patchConvaiSettings({ fetchImpl, account, body }: Verbindung & { body: unknown }): Promise<ConvaiDaten | null> {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVAI_SETTINGS_PATH,
    op: "Workspace-Settings-Schreiben",
    init: { method: "PATCH", body: JSON.stringify(body) },
  });
}

export function listConvaiSecrets({
  fetchImpl,
  account,
  search,
  pageSize,
}: Verbindung & { search: string; pageSize: number }): Promise<ConvaiDaten | null> {
  const query = new URLSearchParams({ search, page_size: String(pageSize) });
  return convaiFetch({
    fetchImpl,
    account,
    path: `${CONVAI_SECRETS_PATH}?${query.toString()}`,
    op: "Secret-Liste",
    init: { method: "GET" },
  });
}

export function createConvaiSecret({
  fetchImpl,
  account,
  name,
  value,
}: Verbindung & { name: string; value: string }): Promise<ConvaiDaten | null> {
  return convaiFetch({
    fetchImpl,
    account,
    path: CONVAI_SECRETS_PATH,
    op: "Secret-Anlegen",
    init: { method: "POST", body: JSON.stringify({ type: SECRET_TYP_NEU, name, value }) },
  });
}

export function updateConvaiSecret({
  fetchImpl,
  account,
  secretId,
  name,
  value,
}: Verbindung & { secretId: string; name: string; value: string }): Promise<ConvaiDaten | null> {
  return convaiFetch({
    fetchImpl,
    account,
    path: `${CONVAI_SECRETS_PATH}/${encodeURIComponent(secretId)}`,
    op: "Secret-Aktualisieren",
    init: { method: "PATCH", body: JSON.stringify({ type: SECRET_TYP_UPDATE, name, value }) },
  });
}

export function patchPhoneNumber({
  fetchImpl,
  account,
  phoneNumberId,
  body,
}: Verbindung & { phoneNumberId: string; body: unknown }): Promise<ConvaiDaten | null> {
  return convaiFetch({
    fetchImpl,
    account,
    path: PHONE_NUMBER_PATH + encodeURIComponent(phoneNumberId),
    op: "Nummernregistrierung-Aendern",
    init: { method: "PATCH", body: JSON.stringify(body) },
  });
}

export function listConversations({
  fetchImpl,
  account,
  query,
}: Verbindung & { query: Record<string, string> }): Promise<ConvaiDaten | null> {
  return convaiFetch({
    fetchImpl,
    account,
    path: `${CONVERSATIONS_PATH}?${new URLSearchParams(query).toString()}`,
    op: "Gespraechsliste",
    init: { method: "GET" },
  });
}

export function fetchAgent({
  fetchImpl,
  account,
  agentId,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: MitFrist & { agentId: string }): Promise<ConvaiDaten | null> {
  return convaiFetch({
    fetchImpl,
    account,
    path: AGENT_PATH + encodeURIComponent(agentId),
    op: "Agent-Abruf",
    init: { method: "GET" },
    timeoutMs,
  });
}
