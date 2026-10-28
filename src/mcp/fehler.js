import { MCP_ERROR_CODE, MCP_TEXTS } from "../i18n/mcp-texts.js";

export class ToolError extends Error {
  constructor(code, field) {
    super(code);
    this.code = code;
    this.field = field;
  }
}

const NOT_FOUND_STATUS = 404;
const NOT_PERMITTED_STATUS = 403;
const CLIENT_ERROR_STATUS_MIN = 400;
const CLIENT_ERROR_STATUS_MAX = 499;

const DENIAL_WARN_MAX_LEN = 40;

function sanitizedDenialReason(reason) {
  return String(reason)
    .toLowerCase()
    .replace(/[^a-z_]/g, "")
    .slice(0, DENIAL_WARN_MAX_LEN);
}

function knownToolErrorCodeText(err, texts) {
  const entry = err?.code ? texts.errors[err.code] : undefined;
  return typeof entry === "function" ? entry(err.field) : entry;
}

function denialReasonText(err, texts) {
  if (typeof err?.reason !== "string") return undefined;
  const denialText = texts.denials[err.reason];
  if (denialText) return denialText;
  console.warn("[mcp] unbekannter Ablehnungsgrund:", sanitizedDenialReason(err.reason));
  return texts.errors[MCP_ERROR_CODE.DENIAL_UNKNOWN];
}

function httpStatusClassText(httpStatus, texts) {
  if (httpStatus === NOT_FOUND_STATUS) return texts.errors[MCP_ERROR_CODE.NOT_FOUND];
  if (httpStatus === NOT_PERMITTED_STATUS) return texts.errors[MCP_ERROR_CODE.NOT_PERMITTED];
  const isClientError =
    typeof httpStatus === "number" &&
    httpStatus >= CLIENT_ERROR_STATUS_MIN &&
    httpStatus <= CLIENT_ERROR_STATUS_MAX;
  return isClientError ? texts.errors[MCP_ERROR_CODE.REQUEST_REJECTED] : undefined;
}

function resolvedToolErrorText(err, texts) {
  const known = knownToolErrorCodeText(err, texts);
  if (known) return known;
  const denial = denialReasonText(err, texts);
  if (denial) return denial;
  if (typeof err?.inputHint === "string") return err.inputHint;
  const statusText = httpStatusClassText(err?.httpStatus, texts);
  if (statusText) return statusText;
  console.error("[mcp] Tool-Fehler ohne bekannte Kennung:", err?.name, err?.message);
  return texts.errors[MCP_ERROR_CODE.UPSTREAM_UNREACHABLE];
}

const LAST_RESORT_ERROR_TEXT = MCP_TEXTS.en.errors[MCP_ERROR_CODE.UPSTREAM_UNREACHABLE];

function withTextTables(texts) {
  return { errors: texts?.errors ?? {}, denials: texts?.denials ?? {} };
}

function isNonEmptyText(text) {
  return typeof text === "string" && text.trim() !== "";
}

export function toolErrorText(err, texts) {
  const text = resolvedToolErrorText(err, withTextTables(texts));
  return isNonEmptyText(text) ? text : LAST_RESORT_ERROR_TEXT;
}
