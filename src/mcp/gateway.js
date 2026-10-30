import { CONSULT_EVENT, CONSULT_POLL_ABORT_MS } from "../consult/delivery.js";
import { resolveGatewayUrl } from "../config.js";
import { MCP_ERROR_CODE } from "../i18n/mcp-texts.js";
import { ToolError } from "./fehler.js";
import { CALL_ARGS_EXEMPT_KEYS, rejectRestrictedData } from "./eingabe.js";

const BAD_REQUEST_STATUS = 400;

async function api({ method, path, body, identity, scopedTenant, timeoutMs = null }) {
  const headers = { "Content-Type": "application/json" };
  if (identity) headers["X-Internal-Identity"] = identity;
  if (scopedTenant) headers["X-Internal-Tenant"] = scopedTenant;
  const res = await fetch(resolveGatewayUrl() + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error("upstream_status");
    err.httpStatus = res.status;
    if (typeof json.reason === "string") err.reason = json.reason;
    else if (res.status === BAD_REQUEST_STATUS && typeof json.error === "string")
      err.inputHint = json.error;
    throw err;
  }
  return json;
}

export function requireFields(obj, specs) {
  if (obj == null || typeof obj !== "object") throw new ToolError(MCP_ERROR_CODE.UPSTREAM_INVALID);
  for (const [field, type] of Object.entries(specs)) {
    const value = obj[field];
    const ok =
      type === "array"
        ? Array.isArray(value)
        : type === "object"
          ? value != null && typeof value === "object"
          : typeof value === type;
    if (!ok) throw new ToolError(MCP_ERROR_CODE.UPSTREAM_INCOMPLETE);
  }
  return obj;
}

const ABORT_ERROR_NAMES = new Set(["AbortError", "TimeoutError"]);
const isAbortError = (err) => ABORT_ERROR_NAMES.has(err?.name);

export const PLACE_CALL_HOP_TIMEOUT_MS = 180000;

export const MCP_HOP_TIMEOUT_MS = 60000;

export async function boundedHop(request) {
  try {
    return await api({ ...request, timeoutMs: MCP_HOP_TIMEOUT_MS });
  } catch (err) {
    if (isAbortError(err)) throw new ToolError(MCP_ERROR_CODE.HOP_TIMEOUT);
    throw err;
  }
}

const SERVER_ERROR_STATUS_MIN = 500;
const SERVER_ERROR_STATUS_MAX = 599;
const HTTP_SERVICE_UNAVAILABLE_STATUS = 503;
const CONFIRMATION_UNAVAILABLE_REASON = "confirmation_unavailable";

function isServerErrorWithoutReason(err) {
  return (
    typeof err?.reason !== "string" &&
    typeof err?.httpStatus === "number" &&
    err.httpStatus >= SERVER_ERROR_STATUS_MIN &&
    err.httpStatus <= SERVER_ERROR_STATUS_MAX
  );
}

export async function placeCallHop({ identity, scopedTenant, body }) {
  try {
    return await api({
      method: "POST",
      path: "/api/calls",
      body,
      identity,
      scopedTenant,
      timeoutMs: PLACE_CALL_HOP_TIMEOUT_MS,
    });
  } catch (err) {
    if (isAbortError(err)) throw new ToolError(MCP_ERROR_CODE.CALL_START_UNCONFIRMED);
    if (isServerErrorWithoutReason(err)) throw new ToolError(MCP_ERROR_CODE.CALL_START_REJECTED);
    throw err;
  }
}

function isConfirmationUnavailable(err) {
  return (
    err?.httpStatus === HTTP_SERVICE_UNAVAILABLE_STATUS &&
    err?.reason === CONFIRMATION_UNAVAILABLE_REASON
  );
}

export async function confirmCallHop({ identity, scopedTenant, body }) {
  rejectRestrictedData(body, CALL_ARGS_EXEMPT_KEYS);
  try {
    return await api({
      method: "POST",
      path: "/api/call-confirmations",
      body,
      identity,
      scopedTenant,
      timeoutMs: MCP_HOP_TIMEOUT_MS,
    });
  } catch (err) {
    if (isAbortError(err)) throw new ToolError(MCP_ERROR_CODE.HOP_TIMEOUT);
    if (isConfirmationUnavailable(err))
      throw new ToolError(MCP_ERROR_CODE.CONFIRMATION_UNAVAILABLE);
    throw err;
  }
}

const NO_CONSULT_EVENT = Object.freeze({
  event: CONSULT_EVENT.NONE,
  eventId: null,
  questions: [],
});

export async function pollConsultHop({ identity, scopedTenant, path }) {
  try {
    return await api({
      method: "GET",
      path,
      identity,
      scopedTenant,
      timeoutMs: CONSULT_POLL_ABORT_MS,
    });
  } catch (err) {
    if (isAbortError(err)) return NO_CONSULT_EVENT;
    throw err;
  }
}
