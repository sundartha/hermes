import { createHmac, hkdfSync } from "node:crypto";

import { safeEqual } from "./util.js";
import { MS_PER_MINUTE } from "./utils/timer.js";

export const CONFIRMATION_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const CONFIRMATION_CODE_LENGTH = 6;
const CONFIRMATION_WINDOW_MINUTES = 5;
export const CONFIRMATION_WINDOW_MS = CONFIRMATION_WINDOW_MINUTES * MS_PER_MINUTE;
export const ACCEPTED_WINDOWS = 2;
export const MAX_FAILED_CONFIRMATIONS_PER_WINDOW = 10;
export const CONFIRMATION_ALREADY_USED_REASON = "already_used";
export const CONFIRMATION_SECRET_MIN_LENGTH = 32;
export const DERIVATION_VERSION = "v2";
const HKDF_INFO = Buffer.from("hermes-call-confirmation-v1", "utf8");
const HKDF_KEY_LENGTH = 32;

export function deriveConfirmationKey(secret) {
  if (typeof secret !== "string" || secret.length < CONFIRMATION_SECRET_MIN_LENGTH) return null;
  return Buffer.from(hkdfSync("sha256", secret, "", HKDF_INFO, HKDF_KEY_LENGTH));
}

function sortedCanonical(value) {
  if (Array.isArray(value)) return value.map(sortedCanonical);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = sortedCanonical(value[key]);
    }
    return out;
  }
  return value;
}

export function canonicalCallRequest({ to, args }) {
  const { confirmation_code: _notBound, ...bound } = args || {};
  return JSON.stringify(sortedCanonical({ ...bound, to }));
}

export function* acceptedWindowIndices(nowMs) {
  const currentWindow = windowIndexFor(nowMs);
  for (let offset = 0; offset < ACCEPTED_WINDOWS; offset++) yield currentWindow - offset;
}

export function acceptanceEndMs(windowIdx) {
  return (windowIdx + ACCEPTED_WINDOWS) * CONFIRMATION_WINDOW_MS;
}

export function windowIndexFor(nowMs) {
  return Math.floor(nowMs / CONFIRMATION_WINDOW_MS);
}

function codeForWindow({ key, tenantId, canonical, windowIdx, slot }) {
  const mac = createHmac("sha256", key)
    .update(JSON.stringify([DERIVATION_VERSION, tenantId, windowIdx, slot, canonical]))
    .digest();
  let code = "";
  for (let i = 0; i < CONFIRMATION_CODE_LENGTH; i++) {
    code += CONFIRMATION_CODE_ALPHABET[mac[i] % CONFIRMATION_CODE_ALPHABET.length];
  }
  return code;
}

export function issueConfirmationCode({ key, tenantId, canonical, nowMs, slot = 0 }) {
  const windowIdx = windowIndexFor(nowMs);
  return {
    code: codeForWindow({ key, tenantId, canonical, windowIdx, slot }),
    expiresAtMs: (windowIdx + 1) * CONFIRMATION_WINDOW_MS,
  };
}

export function normalizeConfirmationCode(code) {
  if (typeof code !== "string") return "";
  return code.toUpperCase().replace(/[\s-]/g, "");
}

const NO_SLOT_REGISTER = () => 0;

export function matchedWindowIndex({ key, tenantId, canonical, code, nowMs, slotForWindow = NO_SLOT_REGISTER }) {
  if (!key) return null;
  const normalized = normalizeConfirmationCode(code);
  if (!normalized) return null;
  for (const windowIdx of acceptedWindowIndices(nowMs)) {
    const candidate = codeForWindow({ key, tenantId, canonical, windowIdx, slot: slotForWindow(windowIdx) });
    if (safeEqual(normalized, candidate)) return windowIdx;
  }
  return null;
}

export function verifyConfirmationCode(args) {
  return matchedWindowIndex(args) !== null;
}
