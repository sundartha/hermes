import crypto from "crypto";

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const MASK_VISIBLE_TAIL = 4;
const MASK_HASH_LEN = 6;
const EMAIL_HASH_LEN = 8;

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function maskNumber(value) {
  const s = String(value ?? "").trim();
  if (!s) return "-";
  return `***${s.slice(-MASK_VISIBLE_TAIL)}#${sha256Hex(s).slice(0, MASK_HASH_LEN)}`;
}

const SEVEN_OR_MORE_DIGITS_WITH_SEPARATORS = /(?:\+|%2b|\\u002b)\d(?:(?:[ /-]|%20)?\d){6,}|(?<![a-z\d]-?)(?![12]\d{3}-\d\d-\d\d(?!-))\d(?:(?:[ /-]|%20)?\d){6,}(?![a-z\d])/gi;

export function maskNumbersInText(text) {
  return String(text).replace(SEVEN_OR_MORE_DIGITS_WITH_SEPARATORS, (number) => maskNumber(number));
}

export function hashEmail(value) {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s) return "-";
  return sha256Hex(s).slice(0, EMAIL_HASH_LEN);
}

export function audit(action, req, details = "") {
  console.log(`[audit] ${action} ip=${req?.ip ?? "system"}${details ? " " + details : ""}`);
}

export const AUTH_FAILED_GRUND = Object.freeze({
  NO_SESSION: "no_session",
  NOT_ACTIVE: "not_active",
  NOT_ADMIN: "not_admin",
  NOT_LOCAL: "not_local",
  CROSS_ORIGIN: "cross_origin",
  MCP_CROSS_ORIGIN: "mcp_cross_origin",
});

export function auditAuthFailed(req, grund, detail = "") {
  audit("auth_failed", req, `path=${req.path} grund=${grund}${detail ? ` ${detail}` : ""}`);
}
