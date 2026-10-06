import { tPair, tDyn } from "./i18n.js";

export const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NO_CONTENT = 204;
export const HTTP_CONFLICT = 409;

export const AUTH_STATE = Object.freeze({
  AUTHENTICATED: "authenticated",
  ANONYMOUS: "anonymous",
  PENDING: "pending",
  ERROR: "error",
});

export const AUTH_EVENT = "hermes:authstate";

export const SESSION_EXPIRED_EVENT = "hermes:session-expired";

export function notifySessionExpired() {
  if (typeof document === "undefined") return;
  document.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
}

export class ApiError extends Error {
  constructor(status, message, { code, next } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.next = next;
  }
}

async function readErrorInfo(res) {
  try {
    const body = await res.json();
    if (!body || typeof body !== "object") return {};
    return {
      code: typeof body.error === "string" ? body.error : undefined,
      next: typeof body.next === "string" ? body.next : undefined,
    };
  } catch {
    return {};
  }
}

async function apiRequest(path, { method = "GET", parseJson = true, body } = {}) {
  const headers = { Accept: "application/json" };
  const options = { method, credentials: "same-origin", headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch(path, options);
  if (!res.ok) {
    if (res.status === HTTP_UNAUTHORIZED) notifySessionExpired();
    const info = await readErrorInfo(res);
    throw new ApiError(res.status, `${method} ${path} -> ${res.status}`, info);
  }
  if (!parseJson) return null;
  return res.status === HTTP_NO_CONTENT ? null : res.json();
}

export function fetchTenantState() {
  return apiRequest("/api/self-service/state");
}

export async function logout() {
  const result = await apiRequest("/auth/logout", { method: "POST" });
  return result && typeof result.logoutUrl === "string" ? result.logoutUrl : null;
}

export const BILLING_SETUP_CHECKOUT_PATH = "/api/self-service/billing/setup-checkout";

export async function startBillingSetupCheckout(plan) {
  const options = { method: "POST" };
  if (plan !== undefined) options.body = { plan };
  const { url } = await apiRequest(BILLING_SETUP_CHECKOUT_PATH, options);
  if (typeof url !== "string" || url === "")
    throw new ApiError(0, "billing setup-checkout: Antwort ohne url");
  return url;
}

export function startBillingCancel() {
  return apiRequest("/api/self-service/billing/cancel", { method: "POST" });
}
export function startBillingResume() {
  return apiRequest("/api/self-service/billing/resume", { method: "POST" });
}

export function fetchBillingStatus() {
  return apiRequest("/api/self-service/billing/status");
}

export function addNewsletterRecipient(email) {
  return apiRequest("/api/self-service/newsletter-recipients", { method: "POST", body: { email } });
}
export function removeNewsletterRecipient(email) {
  return apiRequest("/api/self-service/newsletter-recipients", { method: "DELETE", body: { email } });
}

export function agentInfo(data) {
  const agent = (data && data.agent) || {};
  return {
    number: agent.number || "",
    owner: agent.owner || "",
    numberStatus: agent.numberStatus || "",
    numberStatusReason: agent.numberStatusReason || "",
  };
}

export const NUMBER_STATUS = Object.freeze({
  ACTIVE: "active",
  PROVISIONING: "provisioning",
  REQUESTED: "requested",
  FAILED: "failed",
  BLOCKED: "blocked",
  NONE: "none",
});

export function isNumberProvisioning(data) {
  const { numberStatus } = agentInfo(data);
  return numberStatus === NUMBER_STATUS.PROVISIONING || numberStatus === NUMBER_STATUS.REQUESTED;
}

export const NUMBER_POLL_INTERVAL_MS = 4000;
export const NUMBER_POLL_MAX_ATTEMPTS = 90;

export function shouldPollNumberStatus(result, attemptCount) {
  if (!result || result.state !== AUTH_STATE.AUTHENTICATED) return false;
  if (!isNumberProvisioning(result.data)) return false;
  return attemptCount < NUMBER_POLL_MAX_ATTEMPTS;
}

const NUMBER_TEXT_NO_NUMBER = "No number assigned yet";
const NUMBER_TEXT_NO_NUMBER_DE = "Noch keine Nummer zugewiesen";
const NUMBER_TEXT_SETTING_UP = "Setting up your number…";
const NUMBER_TEXT_SETTING_UP_DE = "Deine Nummer wird eingerichtet…";
const NUMBER_TEXT_SETUP_FAILED = "Number setup failed";
const NUMBER_TEXT_SETUP_FAILED_DE = "Einrichtung fehlgeschlagen";
const NUMBER_TEXT_SETUP_BLOCKED = "Number setup delayed — capacity limit reached";
const NUMBER_TEXT_SETUP_BLOCKED_DE = "Einrichtung verzögert — Kapazitätsgrenze erreicht";

export function numberPlaceholderText(data) {
  if (isNumberProvisioning(data)) return tPair(NUMBER_TEXT_SETTING_UP, NUMBER_TEXT_SETTING_UP_DE);
  const { numberStatus } = agentInfo(data);
  if (numberStatus === NUMBER_STATUS.FAILED) return tPair(NUMBER_TEXT_SETUP_FAILED, NUMBER_TEXT_SETUP_FAILED_DE);
  if (numberStatus === NUMBER_STATUS.BLOCKED) return tPair(NUMBER_TEXT_SETUP_BLOCKED, NUMBER_TEXT_SETUP_BLOCKED_DE);
  return tPair(NUMBER_TEXT_NO_NUMBER, NUMBER_TEXT_NO_NUMBER_DE);
}

const NUMBER_ACTION_FIX_PAYMENT = "Update";
const NUMBER_ACTION_FIX_PAYMENT_DE = "Aktualisieren";

export const NUMBER_REASON = Object.freeze({
  PAYMENT_METHOD: "payment_method_unsuitable",
  RETRY_PENDING: "retry_pending",
  MANUAL: "manual_review",
});
export function numberStatusReason(data) {
  const reason = agentInfo(data).numberStatusReason;
  return typeof reason === "string" ? reason : "";
}

export function numberPlaceholderAction(data) {
  const { numberStatus } = agentInfo(data);
  if (numberStatus !== NUMBER_STATUS.FAILED) return null;
  const reason = numberStatusReason(data);
  if (reason && reason !== NUMBER_REASON.PAYMENT_METHOD) return null;
  return {
    label: tPair(NUMBER_ACTION_FIX_PAYMENT, NUMBER_ACTION_FIX_PAYMENT_DE),
    href: BILLING_SETUP_CHECKOUT_PATH,
  };
}

const NUMBER_HINT_PAYMENT =
  "Your card doesn't cover the setup fee. Add a new one under Billing - setup then continues.";
const NUMBER_HINT_PAYMENT_DE =
  "Deine Karte deckt die Einrichtungsgebühr nicht. Neue Karte unter Abrechnung — dann geht es weiter.";
const NUMBER_HINT_RETRY = "We're automatically trying again - no action needed.";
const NUMBER_HINT_RETRY_DE = "Wir versuchen es automatisch erneut — du musst nichts tun.";
const NUMBER_HINT_MANUAL = "We couldn't set up your number. Please get in touch and we'll sort it out.";
const NUMBER_HINT_MANUAL_DE =
  "Wir konnten deine Nummer nicht einrichten. Melde dich bei uns, wir bringen das in Ordnung.";
const NUMBER_HINTS = Object.freeze({
  [NUMBER_REASON.PAYMENT_METHOD]: () => tPair(NUMBER_HINT_PAYMENT, NUMBER_HINT_PAYMENT_DE),
  [NUMBER_REASON.RETRY_PENDING]: () => tPair(NUMBER_HINT_RETRY, NUMBER_HINT_RETRY_DE),
  [NUMBER_REASON.MANUAL]: () => tPair(NUMBER_HINT_MANUAL, NUMBER_HINT_MANUAL_DE),
});
export function numberPlaceholderHint(data) {
  const hint = NUMBER_HINTS[numberStatusReason(data)];
  return hint ? hint() : "";
}

export function cardStatus(data) {
  const present = typeof (data && data.hasCard) === "boolean";
  return { present, hasCard: present ? data.hasCard : false };
}

export function subscriptionFrom(data) {
  const sub = (data && data.subscription) || {};
  return {
    planSlug: sub.planSlug || "",
    currentPeriodEnd: sub.currentPeriodEnd || 0,
    cancelAtPeriodEnd: !!sub.cancelAtPeriodEnd,
  };
}

export function quotaFrom(data) {
  const quota = data && data.quota;
  if (
    !quota ||
    typeof quota.includedMinutes !== "number" ||
    typeof quota.remainingMinutes !== "number"
  ) {
    return null;
  }
  return { includedMinutes: quota.includedMinutes, remainingMinutes: quota.remainingMinutes };
}

export function numberSetupFeeFrom(data) {
  const cents = data && data.numberSetupFeeCents;
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) return null;
  return { amountCents: cents, currency: (data && data.currency) || "eur" };
}

export const CALL_DIRECTION = Object.freeze({ INBOUND: "inbound", OUTBOUND: "outbound" });

function listFrom(data, key) {
  const value = data && data[key];
  return Array.isArray(value) ? value : [];
}
export const callsFrom = (data) => listFrom(data, "calls");

export function isAgentLive(data) {
  return callsFrom(data).some((c) => c && c.status === "active");
}

export function callCounterparty(call) {
  const c = call || {};
  const value = c.direction === CALL_DIRECTION.OUTBOUND ? c.to : c.from;
  return value || "";
}

const CALL_SUBTITLE_INBOUND = "Inbound call";
const CALL_SUBTITLE_INBOUND_DE = "Eingehender Anruf";
const CALL_SUBTITLE_OUTBOUND = "Outbound call";
const CALL_SUBTITLE_OUTBOUND_DE = "Ausgehender Anruf";
export function callSubtitle(call) {
  const c = call || {};
  if (c.goal) return c.goal;
  return c.direction === CALL_DIRECTION.INBOUND
    ? tPair(CALL_SUBTITLE_INBOUND, CALL_SUBTITLE_INBOUND_DE)
    : tPair(CALL_SUBTITLE_OUTBOUND, CALL_SUBTITLE_OUTBOUND_DE);
}

export const CALL_STATUS_LABELS = Object.freeze({
  active: "Live",
  completed: "Completed",
  cancelled: "Cancelled",
  failed: "Failed",
});
export const CALL_STATUS_LABELS_DE = Object.freeze({
  active: "Live",
  completed: "Abgeschlossen",
  cancelled: "Abgebrochen",
  failed: "Fehlgeschlagen",
});
export function callStatusLabel(call) {
  return tDyn({ en: CALL_STATUS_LABELS, de: CALL_STATUS_LABELS_DE }, callStatusKind(call));
}

export function callStatusKind(call) {
  const status = (call && call.status) || "";
  return Object.prototype.hasOwnProperty.call(CALL_STATUS_LABELS, status) ? status : "failed";
}

export const TRANSCRIPT_ROLE_AGENT = "agent";

export function transcriptFrom(call) {
  const t = call && call.transcript;
  return Array.isArray(t) ? t : [];
}

export function isAgentTurn(turn) {
  return Boolean(turn) && turn.role === TRANSCRIPT_ROLE_AGENT;
}

export const TURN_ROLE_LABELS = Object.freeze({ agent: "Agent", caller: "Counterparty" });
export const TURN_ROLE_LABELS_DE = Object.freeze({ agent: "Agent", caller: "Gegenstelle" });
export function turnRoleLabel(turn) {
  const role = (turn && turn.role) || "";
  const key = Object.prototype.hasOwnProperty.call(TURN_ROLE_LABELS, role) ? role : "caller";
  return tDyn({ en: TURN_ROLE_LABELS, de: TURN_ROLE_LABELS_DE }, key);
}

export function turnTimeLabel(turn) {
  const at = turn && turn.at;
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function callSummary(call) {
  const summary = call && call.summary;
  return typeof summary === "string" ? summary : "";
}

export const SETTINGS_FREE_FIELDS = Object.freeze(["agentName", "language", "agentStyle"]);

export const SETTINGS_RESTRICT_ONLY_FIELDS = Object.freeze(["allowPersonalData", "allowBankData"]);

export const SETTINGS_LANGUAGES = Object.freeze([
  { value: "", label: "Automatic" },
  { value: "de", label: "German" },
  { value: "fr", label: "French" },
  { value: "en", label: "English" },
]);

export const SETTINGS_LANGUAGE_LABELS_DE = Object.freeze({
  "": "Automatisch",
  de: "Deutsch",
  fr: "Französisch",
  en: "Englisch",
});
export const SETTINGS_LANGUAGE_LABELS_EN = Object.freeze(
  Object.fromEntries(SETTINGS_LANGUAGES.map((l) => [l.value, l.label])),
);

export function settingsLanguageLabel(value) {
  return tDyn({ en: SETTINGS_LANGUAGE_LABELS_EN, de: SETTINGS_LANGUAGE_LABELS_DE }, value) || value;
}

const SETTINGS_LANGUAGE_QUALIFIERS_EN = Object.freeze({ "": "(by number)" });
const SETTINGS_LANGUAGE_QUALIFIERS_DE = Object.freeze({ "": "(nach Nummer)" });
export function settingsLanguageQualifier(value) {
  return (
    tDyn({ en: SETTINGS_LANGUAGE_QUALIFIERS_EN, de: SETTINGS_LANGUAGE_QUALIFIERS_DE }, value) || ""
  );
}

export const SETTINGS_PERMISSION_TOGGLES = Object.freeze([
  { key: "allowPersonalData", label: "Personal data", hint: "Share address, email, etc." },
  { key: "allowBankData", label: "Bank details", hint: "Share payment data (not recommended)" },
]);

export const SETTINGS_PERMISSION_LABELS_EN = Object.freeze(
  Object.fromEntries(SETTINGS_PERMISSION_TOGGLES.map((t) => [t.key, t.label])),
);
export const SETTINGS_PERMISSION_LABELS_DE = Object.freeze({
  allowPersonalData: "Persönliche Daten",
  allowBankData: "Bankdaten",
});
export const SETTINGS_PERMISSION_HINTS_EN = Object.freeze(
  Object.fromEntries(SETTINGS_PERMISSION_TOGGLES.map((t) => [t.key, t.hint])),
);
export const SETTINGS_PERMISSION_HINTS_DE = Object.freeze({
  allowPersonalData: "Adresse, E-Mail usw. weitergeben.",
  allowBankData: "Zahlungsdaten weitergeben (nicht empfohlen).",
});

export function settingsPermissionLabel(key) {
  return tDyn({ en: SETTINGS_PERMISSION_LABELS_EN, de: SETTINGS_PERMISSION_LABELS_DE }, key) || key;
}
export function settingsPermissionHint(key) {
  return tDyn({ en: SETTINGS_PERMISSION_HINTS_EN, de: SETTINGS_PERMISSION_HINTS_DE }, key) || "";
}

export const PERSONA_STYLE_LABELS = Object.freeze({
  "warm-persoenlich": "Warm and personal",
  "formell-professionell": "Formal and professional",
});

const PERSONA_STYLE_DEFAULT_OPTION = Object.freeze({ value: "", label: "Default (neutral)" });

function personaStyleLabel(id) {
  return Object.prototype.hasOwnProperty.call(PERSONA_STYLE_LABELS, id)
    ? PERSONA_STYLE_LABELS[id]
    : id;
}

export function personaStyleOptions(data) {
  const ids = data && data.personaStyleIds;
  if (!Array.isArray(ids)) return null;
  return [
    PERSONA_STYLE_DEFAULT_OPTION,
    ...ids.map((id) => ({ value: id, label: personaStyleLabel(id) })),
  ];
}

export function settingsFrom(data) {
  const settings = (data && data.settings) || {};
  const templates = data && data.greetingTemplates;
  return { settings, greetingTemplates: Array.isArray(templates) ? templates : [] };
}

export function buildSettingsPatch(form) {
  const src = form || {};
  const patch = {};
  if (src.greeting !== undefined) patch.greeting = String(src.greeting ?? "");
  for (const key of SETTINGS_FREE_FIELDS) {
    if (src[key] === undefined) continue;
    patch[key] = String(src[key] ?? "");
  }
  for (const { key } of SETTINGS_PERMISSION_TOGGLES) {
    if (src[key] === undefined) continue;
    patch[key] = Boolean(src[key]);
  }
  return patch;
}

function isSavedAsRequested(savedValue, requestedValue) {
  return savedValue === requestedValue || (savedValue === null && requestedValue === "");
}

export function settingsOutcome(patch, savedSettings) {
  const saved = savedSettings || {};
  const changed = [];
  const rejected = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (isSavedAsRequested(saved[key], value)) changed.push(key);
    else rejected.push(key);
  }
  return { changed, rejected };
}

export function saveSettings(patch) {
  return apiRequest("/api/self-service/settings", { method: "POST", body: patch });
}

function maskedPrivateNumberFrom(data) {
  const value = data && data.privateNumber;
  return typeof value === "string" ? value : "";
}

const PRIVATE_NUMBER_TEXT_NONE = "No number saved yet.";
const PRIVATE_NUMBER_TEXT_NONE_DE = "Noch keine Nummer gespeichert.";
const PRIVATE_NUMBER_TEXT_PREFIX = "Currently saved: ";
const PRIVATE_NUMBER_TEXT_PREFIX_DE = "Aktuell gespeichert: ";
export function privateNumberStatusText(data) {
  const masked = maskedPrivateNumberFrom(data);
  return masked
    ? `${tPair(PRIVATE_NUMBER_TEXT_PREFIX, PRIVATE_NUMBER_TEXT_PREFIX_DE)}${masked}`
    : tPair(PRIVATE_NUMBER_TEXT_NONE, PRIVATE_NUMBER_TEXT_NONE_DE);
}

export const ERROR_INVALID_PRIVATE_NUMBER = "invalid_private_number";

export const PRIVATE_NUMBER_MESSAGES = Object.freeze({
  saved: "Number saved.",
  removed: "Number removed.",
  missing: "Enter a number first, or use Remove.",
  invalid: "That number isn't valid or isn't allowed. Use the international format, for example +49 151 23456789.",
});
export const PRIVATE_NUMBER_MESSAGES_DE = Object.freeze({
  saved: "Nummer gespeichert.",
  removed: "Nummer entfernt.",
  missing: "Gib zuerst eine Nummer ein, oder nutze Entfernen.",
  invalid:
    "Diese Nummer ist ungültig oder gesperrt. Nutze das internationale Format, zum Beispiel +49 151 23456789.",
});
export function privateNumberMessage(key) {
  return tDyn({ en: PRIVATE_NUMBER_MESSAGES, de: PRIVATE_NUMBER_MESSAGES_DE }, key);
}

export function savePrivateNumber(privateNumber) {
  return apiRequest("/api/self-service/private-number", {
    method: "POST",
    body: { privateNumber: String(privateNumber ?? "") },
  });
}

export async function loadAuthState() {
  try {
    const data = await fetchTenantState();
    return { state: AUTH_STATE.AUTHENTICATED, data };
  } catch (err) {
    if (err instanceof ApiError && err.status === HTTP_UNAUTHORIZED) {
      return { state: AUTH_STATE.ANONYMOUS, data: null };
    }
    if (err instanceof ApiError && err.status === HTTP_FORBIDDEN) {
      return { state: AUTH_STATE.PENDING, data: null };
    }
    return { state: AUTH_STATE.ERROR, data: null };
  }
}
