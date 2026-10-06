import { Router } from "express";
import { createHash } from "node:crypto";

import { normNum } from "../store/defaults.js";
import { E164_FORMAT_ERROR, isTrunkZeroFormatError, resolveDialTarget } from "../telephony/outbound-gates.js";
import { supportedLanguageOf } from "../i18n/locales.js";
import { unsupportedLanguageBody, languageUnavailableBody } from "./_call-request.js";
import { TENANT_REJECT } from "../request-tenant.js";
import { internalOnly } from "../wiring/internal-only.js";
import {
  CONFIRMATION_ALREADY_USED_REASON,
  MAX_FAILED_CONFIRMATIONS_PER_WINDOW,
  acceptanceEndMs,
  acceptedWindowIndices,
  deriveConfirmationKey,
  canonicalCallRequest,
  issueConfirmationCode,
  matchedWindowIndex,
  normalizeConfirmationCode,
  windowIndexFor,
} from "../call-confirmation.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_OK = 200;
const HTTP_SERVICE_UNAVAILABLE = 503;
const CONFIRMATION_UNAVAILABLE_BODY = Object.freeze({ reason: "confirmation_unavailable" });
const PREVIEW_STATUS = "awaiting_confirmation";
const PREVIEW_OPTIONAL_FIELDS = ["language", "max_duration_s", "briefing", "constraints", "mandate", "context", "diagnostic"];

function buildPreview({ to, objective, body }) {
  const preview = { status: PREVIEW_STATUS, to, objective };
  for (const field of PREVIEW_OPTIONAL_FIELDS) {
    if (body[field] !== undefined) preview[field] = body[field];
  }
  return preview;
}

function missingFieldsDenial({ to, objective }) {
  if (to && objective) return null;
  return { status: HTTP_BAD_REQUEST, body: { error: "to und objective sind Pflicht" } };
}

function trunkZeroDenial(to) {
  if (!isTrunkZeroFormatError(to)) return null;
  return { status: HTTP_BAD_REQUEST, body: { error: E164_FORMAT_ERROR } };
}

function languageDenial({ body, config }) {
  if (!body.language) return null;
  const requested = supportedLanguageOf(body.language);
  if (!requested) return { status: HTTP_BAD_REQUEST, body: unsupportedLanguageBody() };
  if (!config.voice.elevenLabsOutbound.enabled)
    return { status: HTTP_BAD_REQUEST, body: languageUnavailableBody() };
  return null;
}

function tenantDenial(tenantId) {
  if (tenantId !== TENANT_REJECT) return null;
  return { status: HTTP_FORBIDDEN, body: { error: "Kein Tenant fuer diese Identitaet." } };
}

function usedCodeDigest({ tenantId, windowIdx, normalizedCode }) {
  return createHash("sha256").update(`${tenantId}|${windowIdx}|${normalizedCode}`).digest("hex");
}

function makeOneTimeCodeLedger() {
  const usedUntilMs = new Map();
  function prune(nowMs) {
    for (const [key, expiresAtMs] of usedUntilMs) if (expiresAtMs <= nowMs) usedUntilMs.delete(key);
  }
  return {
    wasUsed({ digest, nowMs }) {
      prune(nowMs);
      return usedUntilMs.has(digest);
    },
    markIfUnused({ digest, acceptedUntilMs, nowMs }) {
      prune(nowMs);
      if (usedUntilMs.has(digest)) return false;
      usedUntilMs.set(digest, acceptedUntilMs);
      return true;
    },
  };
}

function slotLedgerDigest({ tenantId, windowIdx, canonical }) {
  return createHash("sha256").update(`slot|${tenantId}|${windowIdx}|${canonical}`).digest("hex");
}

function makeFreshSlotLedger() {
  const slotByDigest = new Map();
  function prune(nowMs) {
    for (const [key, entry] of slotByDigest) if (entry.expiresAtMs <= nowMs) slotByDigest.delete(key);
  }
  return {
    currentSlot({ digest, nowMs }) {
      prune(nowMs);
      return slotByDigest.get(digest)?.slot ?? 0;
    },
    advance({ digest, acceptedUntilMs, nowMs }) {
      prune(nowMs);
      const next = (slotByDigest.get(digest)?.slot ?? 0) + 1;
      slotByDigest.set(digest, { slot: next, expiresAtMs: acceptedUntilMs });
    },
  };
}

function makeFailedAttemptBrake() {
  const failuresByTenant = new Map();
  function countFor({ tenantKey, windowIdx }) {
    const entry = failuresByTenant.get(tenantKey);
    return entry?.windowIdx === windowIdx ? entry.count : 0;
  }
  return {
    isLocked({ tenantKey, windowIdx }) {
      return countFor({ tenantKey, windowIdx }) >= MAX_FAILED_CONFIRMATIONS_PER_WINDOW;
    },
    recordFailure({ tenantKey, windowIdx }) {
      for (const [key, entry] of failuresByTenant) if (entry.windowIdx < windowIdx) failuresByTenant.delete(key);
      failuresByTenant.set(tenantKey, { windowIdx, count: countFor({ tenantKey, windowIdx }) + 1 });
    },
  };
}

function consumeIfCurrent({ key, tenantId, canonical, code, nowMs, registers }) {
  const slotDigestFor = (windowIdx) => slotLedgerDigest({ tenantId, windowIdx, canonical });
  const windowIdx = matchedWindowIndex({
    key,
    tenantId,
    canonical,
    code,
    nowMs,
    slotForWindow: (idx) => registers.freshSlots.currentSlot({ digest: slotDigestFor(idx), nowMs }),
  });
  if (windowIdx === null) return false;
  const acceptedUntilMs = acceptanceEndMs(windowIdx);
  const digest = usedCodeDigest({ tenantId, windowIdx, normalizedCode: normalizeConfirmationCode(code) });
  if (!registers.usedCodes.markIfUnused({ digest, acceptedUntilMs, nowMs })) return false;
  registers.freshSlots.advance({ digest: slotDigestFor(windowIdx), acceptedUntilMs, nowMs });
  return true;
}

function wasCodeUsed({ tenantId, code, nowMs, registers }) {
  const normalizedCode = normalizeConfirmationCode(code);
  if (!normalizedCode) return false;
  for (const windowIdx of acceptedWindowIndices(nowMs)) {
    const digest = usedCodeDigest({ tenantId, windowIdx, normalizedCode });
    if (registers.usedCodes.wasUsed({ digest, nowMs })) return true;
  }
  return false;
}

const CONFIRM_OUTCOME = Object.freeze({
  CONFIRMED: "confirmed",
  ALREADY_USED: "already_used",
  REJECTED: "rejected",
});

function confirmCode({ key, tenantId, canonical, code, nowMs, registers }) {
  if (wasCodeUsed({ tenantId, code, nowMs, registers })) return CONFIRM_OUTCOME.ALREADY_USED;
  const brakeKey = { tenantKey: String(tenantId), windowIdx: windowIndexFor(nowMs) };
  if (registers.brake.isLocked(brakeKey)) return CONFIRM_OUTCOME.REJECTED;
  const confirmed = consumeIfCurrent({ key, tenantId, canonical, code, nowMs, registers });
  if (confirmed) return CONFIRM_OUTCOME.CONFIRMED;
  if (normalizeConfirmationCode(code)) registers.brake.recordFailure(brakeKey);
  return CONFIRM_OUTCOME.REJECTED;
}

function confirmationResponseBody({ preview, outcome }) {
  const body = { preview, confirmed: outcome === CONFIRM_OUTCOME.CONFIRMED };
  if (outcome === CONFIRM_OUTCOME.ALREADY_USED) body.reason = CONFIRMATION_ALREADY_USED_REASON;
  return body;
}

export function makeCallConfirmationRoutes({ store, config, tenant: { requestTenant }, now = Date.now }) {
  const router = Router();
  const registers = {
    usedCodes: makeOneTimeCodeLedger(),
    freshSlots: makeFreshSlotLedger(),
    brake: makeFailedAttemptBrake(),
  };

  router.post("/api/call-confirmations", internalOnly, (req, res) => {
    const body = req.body || {};
    const to = normNum(body.to);
    const objective = body.objective || body.goal;

    const preDenial =
      missingFieldsDenial({ to, objective }) || trunkZeroDenial(to) || languageDenial({ body, config });
    if (preDenial) return res.status(preDenial.status).json(preDenial.body);

    const tenantId = requestTenant(req);
    const tenantErr = tenantDenial(tenantId);
    if (tenantErr) return res.status(tenantErr.status).json(tenantErr.body);

    const normalizedTo = resolveDialTarget({ store, tenantId, to });
    const normalizedDenial = trunkZeroDenial(normalizedTo);
    if (normalizedDenial) return res.status(normalizedDenial.status).json(normalizedDenial.body);

    const preview = buildPreview({ to: normalizedTo, objective, body });
    const key = deriveConfirmationKey(config.auth.callConfirmationSecret);
    if (!key) return res.status(HTTP_SERVICE_UNAVAILABLE).json(CONFIRMATION_UNAVAILABLE_BODY);

    const canonical = canonicalCallRequest({ to: normalizedTo, args: body });
    const nowMs = now();

    if (typeof body.confirmation_code === "string") {
      const outcome = confirmCode({
        key,
        tenantId,
        canonical,
        code: body.confirmation_code,
        nowMs,
        registers,
      });
      return res.status(HTTP_OK).json(confirmationResponseBody({ preview, outcome }));
    }

    const windowIdx = windowIndexFor(nowMs);
    const slot = registers.freshSlots.currentSlot({
      digest: slotLedgerDigest({ tenantId, windowIdx, canonical }),
      nowMs,
    });
    const { code, expiresAtMs } = issueConfirmationCode({ key, tenantId, canonical, nowMs, slot });
    return res.status(HTTP_OK).json({
      preview,
      confirmation: { code, expires_at: new Date(expiresAtMs).toISOString() },
    });
  });

  return router;
}
