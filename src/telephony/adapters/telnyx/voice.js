import { config } from "../../../config.js";
import { assertTelnyxOk } from "./errors.js";
import { parseDecimalToMicroCents, parseNonNegativeInteger } from "./cost-parse.js";
import { createMinuteWindowThrottle } from "./rate-limit.js";

const TEXML_BASE = "/v2/texml";
const CALL_CONTROL_BASE = "/v2/calls";
const FORM_HEADERS_TYPE = "application/x-www-form-urlencoded";
const JSON_HEADERS_TYPE = "application/json";
const HANGUP_ACTION = "hangup";

const TEXML_STATUS_COMPLETED = "completed";
const REDIRECT_URL_METHOD = "POST";

const TEXML_AMD_FIELD = "AnsweringMachineDetection";
const TEXML_AMD_TIMEOUT_FIELD = "MachineDetectionTimeout";
const AMD_MODE_DETECT = "detect";

const DETAIL_RECORDS_BASE = "/v2/detail_records";
export const COST_RECORD_TYPES = Object.freeze([
  "sip-trunking", "call-control", "speech-to-text",
  "text-to-speech", "recording", "inference", "ai-voice-assistant",
]);
const COST_RECORDS_PAGE_SIZE = 50;
const FIRST_PAGE_NUMBER = 1;
const MAX_PAGES_PER_RECORD_TYPE = 10;
export const DETAIL_RECORDS_LIMIT_PER_MINUTE = 40;
export const DETAIL_RECORDS_RESERVE_PER_MINUTE = 10;
export const DETAIL_RECORDS_BUDGET_PER_MINUTE =
  DETAIL_RECORDS_LIMIT_PER_MINUTE - DETAIL_RECORDS_RESERVE_PER_MINUTE;
const RATE_LIMITED_STATUS = 429;
const RATE_LIMIT_RESET_HEADER = "x-ratelimit-reset";
const MS_PER_SECOND = 1000;
const detailRecordsThrottle = createMinuteWindowThrottle({
  budget: DETAIL_RECORDS_BUDGET_PER_MINUTE,
});

const INVOICES_BASE = "/v2/invoices";
const INVOICE_LOOKBACK_PAGE_SIZE = 12;
const INVOICE_SORT_NEWEST_FIRST = "-period_start";

function logInvoiceFetchFailure(err) {
  const status = err?.providerStatus ?? MISSING_PROVIDER_FIELD;
  const code = err?.providerCode ?? MISSING_PROVIDER_FIELD;
  console.warn(`[telnyx/voice] fetchMonthlyInvoiceTotal fehler status=${status} code=${code}`);
}

const ANCHOR_ID_FIELDS = Object.freeze(["call_control_id", "sip_call_id"]);
const SESSION_ID_FIELDS = Object.freeze(["telnyx_session_id", "call_session_id"]);
const ANCHOR_ROUTE = "anchor";
const ASSIGNMENT_ROUTES = Object.freeze([ANCHOR_ROUTE, ...SESSION_ID_FIELDS]);
export const UNASSIGNABLE_COST_RECORD_TYPES = Object.freeze(["inference"]);
export const ASSIGNABLE_COST_RECORD_TYPES = Object.freeze(
  COST_RECORD_TYPES.filter((t) => !UNASSIGNABLE_COST_RECORD_TYPES.includes(t)),
);
export const COST_RECORD_TIME_FIELDS = Object.freeze({
  "sip-trunking": Object.freeze(["started_at", "finished_at"]),
  "call-control": Object.freeze(["started_at"]),
  recording: Object.freeze(["started_at"]),
  "speech-to-text": Object.freeze(["start_time", "end_time"]),
  "text-to-speech": Object.freeze(["created_at"]),
  "ai-voice-assistant": Object.freeze(["created_at", "completed_at"]),
});
const RECORD_TIMESTAMP_FIELDS = Object.freeze(["recorded_at", "created_at"]);
const TTS_RECORD_TYPE = "text-to-speech";
const ELEVENLABS_COST_RECORD_PROVIDER = "elevenlabs";

const ATTACH_STATUS = { attachStatus: true };

function headers(contentType = FORM_HEADERS_TYPE) {
  return { Authorization: `Bearer ${config.telephony.telnyxApiKey}`, "Content-Type": contentType };
}

function logCallControlOk(op, status, ccidPresent) {
  console.log(`[telnyx/voice] ${op} ok status=${status} ccid=${ccidPresent}`);
}

async function parseTelnyxBody(res) {
  const json = await res.json().catch(() => ({}));
  return { data: json.data || json, meta: json.meta };
}

async function parseTelnyxResource(res) {
  return (await parseTelnyxBody(res)).data;
}

async function postCallControlAction(callControlId, { action, body, op }) {
  const res = await fetch(
    `${config.telephony.telnyxApiBase}${CALL_CONTROL_BASE}/${callControlId}/actions/${action}`,
    { method: "POST", headers: headers(JSON_HEADERS_TYPE), body: JSON.stringify(body) },
  );
  await assertTelnyxOk(res, op, ATTACH_STATUS);
  logCallControlOk(op, res.status, Boolean(callControlId));
}

async function updateTexmlCall(callSid, { form, op }) {
  if (!config.telephony.telnyxApiKey) throw new Error(`Telnyx ${op}: TELNYX_API_KEY fehlt`);
  if (!config.telephony.telnyxAccountSid)
    throw new Error(`Telnyx ${op}: TELNYX_ACCOUNT_SID fehlt`);
  const res = await fetch(
    `${config.telephony.telnyxApiBase}${TEXML_BASE}/Accounts/${config.telephony.telnyxAccountSid}/Calls/${callSid}`,
    { method: "POST", headers: headers(), body: form },
  );
  await assertTelnyxOk(res, op, ATTACH_STATUS);
}

function recordSessionRefs(raw) {
  const refs = [];
  for (const field of SESSION_ID_FIELDS) {
    if (raw[field]) refs.push({ field, id: String(raw[field]) });
  }
  return refs;
}

function matchesAnchor(raw, legId) {
  return ANCHOR_ID_FIELDS.some((feld) => Boolean(raw[feld]) && String(raw[feld]) === legId);
}

function anchoredSessionIds(rawRecords, legId) {
  const sessionIds = new Set();
  for (const raw of rawRecords) {
    if (!matchesAnchor(raw, legId)) continue;
    for (const ref of recordSessionRefs(raw)) sessionIds.add(ref.id);
  }
  return sessionIds;
}

function assignmentOutcome(raw, { legId, sessionIds }) {
  if (matchesAnchor(raw, legId)) return { via: ANCHOR_ROUTE };
  const refs = recordSessionRefs(raw);
  if (refs.length === 0) return { reason: "session_unresolved" };
  const hit = refs.find((ref) => sessionIds.has(ref.id));
  return hit ? { via: hit.field } : { reason: "session_mismatch" };
}

function withinRecordWindow(raw, startedAt, endedAt) {
  const rawTimestamp = RECORD_TIMESTAMP_FIELDS.map((field) => raw[field]).find(Boolean);
  if (!rawTimestamp) return true;
  const t = Date.parse(rawTimestamp);
  if (Number.isNaN(t)) return true;
  return t >= Date.parse(startedAt) && t <= Date.parse(endedAt);
}

function elevenLabsCharactersOf(raw) {
  if (raw.record_type !== TTS_RECORD_TYPE) return null;
  if (String(raw.provider || "").trim().toLowerCase() !== ELEVENLABS_COST_RECORD_PROVIDER) return null;
  return parseNonNegativeInteger(raw.number_of_characters);
}

function toCostRecord(raw, { legId, sessionIds, startedAt, endedAt }) {
  const currency = String(raw.currency || "").trim().toUpperCase();
  const expectedCurrency = String(config.billing.providerCurrency).trim().toUpperCase();
  if (!currency || currency !== expectedCurrency) return { reason: "currency_mismatch" };

  const assignment = assignmentOutcome(raw, { legId, sessionIds });
  if (assignment.reason) return { reason: assignment.reason };

  if (!withinRecordWindow(raw, startedAt, endedAt)) return { reason: "out_of_window" };

  const costMicroCents = parseDecimalToMicroCents(raw.cost);
  if (costMicroCents === null) return { reason: "cost_unparsable" };

  return {
    via: assignment.via,
    record: {
      recordType: raw.record_type,
      costMicroCents,
      currency,
      billedSec: parseNonNegativeInteger(raw.billed_sec),
      ttsCharacters: elevenLabsCharactersOf(raw),
      legId,
    },
  };
}

const MISSING_PROVIDER_FIELD = "none";

function logCostRecordsFailure(recordType, err) {
  const status = err?.providerStatus ?? MISSING_PROVIDER_FIELD;
  const code = err?.providerCode ?? MISSING_PROVIDER_FIELD;
  console.warn(
    `[telnyx/voice] getVoiceCostRecords fehler typ=${recordType} status=${status} code=${code}`,
  );
}

function isLastPage(records, meta, pageNumber) {
  const totalPages = parseNonNegativeInteger(meta?.total_pages);
  if (totalPages !== null) return pageNumber >= totalPages;
  return records.length < COST_RECORDS_PAGE_SIZE;
}

function rateLimitResetHintMs(res) {
  const seconds = parseNonNegativeInteger(res?.headers?.get?.(RATE_LIMIT_RESET_HEADER));
  return seconds === null ? null : seconds * MS_PER_SECOND;
}

function createPoolFetchRun(throttle) {
  return { throttle, requests: 0, pages: 0 };
}

async function attemptCostRecordPage(recordType, pageNumber, poolRun) {
  const q = new URLSearchParams();
  q.set("filter[record_type]", recordType);
  q.set("page[size]", String(COST_RECORDS_PAGE_SIZE));
  q.set("page[number]", String(pageNumber));
  let rateLimit = null;
  try {
    await poolRun.throttle.reserveSlot();
    poolRun.requests++;
    const res = await fetch(`${config.telephony.telnyxApiBase}${DETAIL_RECORDS_BASE}?${q}`, {
      headers: headers(),
    });
    if (res.status === RATE_LIMITED_STATUS) rateLimit = { hintMs: rateLimitResetHintMs(res) };
    await assertTelnyxOk(res, "getVoiceCostRecords", ATTACH_STATUS);
    const { data, meta } = await parseTelnyxBody(res);
    if (!Array.isArray(data)) return { page: { ok: false, reason: "shape_unexpected" }, rateLimit: null };
    return { page: { ok: true, raw: data, lastPage: isLastPage(data, meta, pageNumber) }, rateLimit: null };
  } catch (err) {
    logCostRecordsFailure(recordType, err);
    return { page: { ok: false, reason: "provider_error" }, rateLimit };
  }
}

async function fetchCostRecordPage(recordType, pageNumber, poolRun) {
  const attempt = await attemptCostRecordPage(recordType, pageNumber, poolRun);
  if (!attempt.rateLimit) return attempt.page;
  await poolRun.throttle.waitForWindowReset(attempt.rateLimit.hintMs);
  return (await attemptCostRecordPage(recordType, pageNumber, poolRun)).page;
}

function newestRecordTimestampMs(raw, recordType) {
  let newest = null;
  for (const field of COST_RECORD_TIME_FIELDS[recordType] || []) {
    if (typeof raw[field] !== "string") continue;
    const ms = Date.parse(raw[field]);
    if (Number.isNaN(ms)) continue;
    if (newest === null || ms > newest) newest = ms;
  }
  return newest;
}

function isPageBeforeSince(rawPage, recordType, sinceMs) {
  if (sinceMs === null || rawPage.length === 0) return false;
  return rawPage.every((raw) => {
    const ms = newestRecordTimestampMs(raw, recordType);
    return ms !== null && ms < sinceMs;
  });
}

async function fetchRecordTypePages(recordType, sinceMs, poolRun) {
  const raw = [];
  const lastAllowedPage = FIRST_PAGE_NUMBER + MAX_PAGES_PER_RECORD_TYPE - 1;
  for (let pageNumber = FIRST_PAGE_NUMBER; pageNumber <= lastAllowedPage; pageNumber++) {
    const page = await fetchCostRecordPage(recordType, pageNumber, poolRun);
    if (!page.ok) return page;
    poolRun.pages++;
    raw.push(...page.raw);
    if (page.lastPage || isPageBeforeSince(page.raw, recordType, sinceMs))
      return { ok: true, raw, complete: true };
  }
  return { ok: true, raw, complete: false };
}

async function fetchAllCostRecords(sinceMs, poolRun) {
  const rawRecords = [];
  for (const recordType of ASSIGNABLE_COST_RECORD_TYPES) {
    const pages = await fetchRecordTypePages(recordType, sinceMs, poolRun);
    if (!pages.ok) return pages;
    rawRecords.push(...pages.raw);
    if (!pages.complete) return { ok: true, raw: rawRecords, complete: false };
  }
  return { ok: true, raw: rawRecords, complete: true };
}

function formatAssignmentRoutes(acceptedByRoute) {
  return ASSIGNMENT_ROUTES.map((route) => `via_${route}=${acceptedByRoute[route] || 0}`).join(" ");
}

function logCostRecordsOk({ recordCount, acceptedByRoute, rejectedByReason }) {
  console.log(
    `[telnyx/voice] getVoiceCostRecords ok records=${recordCount} ${formatAssignmentRoutes(acceptedByRoute)} rejected=${JSON.stringify(rejectedByReason)}`,
  );
}

function parseSinceMs(since) {
  if (typeof since !== "string") return null;
  const ms = Date.parse(since);
  return Number.isNaN(ms) ? null : ms;
}

export const telnyxVoice = {
  async originateCall({ from, to, url, statusCallback, statusCallbackEvent, method, timeLimit }) {
    if (!config.telephony.telnyxApiKey)
      throw new Error("Telnyx originateCall: TELNYX_API_KEY fehlt");
    if (!config.telephony.telnyxConnectionId)
      throw new Error("Telnyx originateCall: TELNYX_CONNECTION_ID fehlt");
    const form = new URLSearchParams({ From: from, To: to, Url: url });
    if (statusCallback) form.set("StatusCallback", statusCallback);
    if (method) {
      form.set("UrlMethod", method);
      form.set("StatusCallbackMethod", method);
    }
    for (const ev of statusCallbackEvent || []) form.append("StatusCallbackEvent", ev);
    if (timeLimit) form.set("TimeLimit", String(timeLimit));
    if (config.telephony.machineDetection.enabled) {
      form.set(TEXML_AMD_FIELD, AMD_MODE_DETECT);
      form.set(TEXML_AMD_TIMEOUT_FIELD, String(config.telephony.machineDetection.timeoutS));
    }
    const res = await fetch(
      `${config.telephony.telnyxApiBase}${TEXML_BASE}/calls/${config.telephony.telnyxConnectionId}`,
      {
        method: "POST",
        headers: headers(),
        body: form,
      },
    );
    await assertTelnyxOk(res, "originateCall", ATTACH_STATUS);
    const data = await parseTelnyxResource(res);
    return { sid: data.sid || data.call_sid };
  },

  async endCall(callSid) {
    await updateTexmlCall(callSid, {
      form: new URLSearchParams({ Status: TEXML_STATUS_COMPLETED }),
      op: "endCall",
    });
  },

  async redirectCall(callSid, url) {
    if (!callSid) throw new Error("Telnyx redirectCall: callSid fehlt");
    await updateTexmlCall(callSid, {
      form: new URLSearchParams({ Url: url, Method: REDIRECT_URL_METHOD }),
      op: "redirectCall",
    });
  },

  async endCallViaCallControl(callControlId) {
    if (!config.telephony.telnyxApiKey)
      throw new Error("Telnyx endCallViaCallControl: TELNYX_API_KEY fehlt");
    if (!callControlId) throw new Error("Telnyx endCallViaCallControl: callControlId fehlt");
    await postCallControlAction(callControlId, {
      action: HANGUP_ACTION,
      body: {},
      op: "endCallViaCallControl",
    });
  },

  async fetchCostRecordPool({ since, throttle = detailRecordsThrottle } = {}) {
    const poolRun = createPoolFetchRun(throttle);
    const result = config.telephony.telnyxApiKey
      ? await fetchAllCostRecords(parseSinceMs(since), poolRun)
      : { ok: false, reason: "config_missing" };
    return { ...result, requests: poolRun.requests, pages: poolRun.pages };
  },

  assignCostRecords(pool, { legId, startedAt, endedAt } = {}) {
    if (!legId || !startedAt || !endedAt) return { ok: false, reason: "params_missing" };
    if (!Array.isArray(pool?.raw)) return { ok: false, reason: "pool_missing" };

    const sessionIds = anchoredSessionIds(pool.raw, legId);
    const records = [];
    const acceptedByRoute = {};
    const rejectedByReason = {};
    for (const raw of pool.raw) {
      const outcome = toCostRecord(raw, { legId, sessionIds, startedAt, endedAt });
      if (outcome.record) {
        records.push(outcome.record);
        acceptedByRoute[outcome.via] = (acceptedByRoute[outcome.via] || 0) + 1;
      } else {
        rejectedByReason[outcome.reason] = (rejectedByReason[outcome.reason] || 0) + 1;
      }
    }
    logCostRecordsOk({ recordCount: records.length, acceptedByRoute, rejectedByReason });
    return { ok: true, records };
  },

  async fetchMonthlyInvoiceTotal({ month }) {
    if (!config.telephony.telnyxApiKey) return { ok: false, reason: "config_missing" };
    try {
      const q = new URLSearchParams({
        sort: INVOICE_SORT_NEWEST_FIRST,
        "page[size]": String(INVOICE_LOOKBACK_PAGE_SIZE),
      });
      const res = await fetch(`${config.telephony.telnyxApiBase}${INVOICES_BASE}?${q}`, {
        headers: headers(),
      });
      await assertTelnyxOk(res, "fetchMonthlyInvoiceTotal", ATTACH_STATUS);
      const { data } = await parseTelnyxBody(res);
      if (!Array.isArray(data)) return { ok: false, reason: "shape_unexpected" };
      const invoiceOfMonth = data.some(
        (row) => typeof row.period_start === "string" && row.period_start.slice(0, 7) === month,
      );
      return { ok: false, reason: invoiceOfMonth ? "amount_not_exposed_by_provider" : "invoice_not_found" };
    } catch (err) {
      logInvoiceFetchFailure(err);
      return { ok: false, reason: "provider_error" };
    }
  },
};
