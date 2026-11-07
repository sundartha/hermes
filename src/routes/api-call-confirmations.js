import { Router } from "express";

import { normNum } from "../store/defaults.js";
import { E164_FORMAT_ERROR, isTrunkZeroFormatError, resolveDialTarget } from "../telephony/outbound-gates.js";
import { supportedLanguageOf } from "../i18n/locales.js";
import { unsupportedLanguageBody, languageUnavailableBody } from "./_call-request.js";
import { TENANT_REJECT, internalTenant } from "../request-tenant.js";
import { createRateLimiter } from "../middleware.js";
import { internalOnly } from "../wiring/internal-only.js";
import { HTTP_BAD_REQUEST, HTTP_FORBIDDEN, HTTP_OK, HTTP_SERVICE_UNAVAILABLE } from "../utils/http.js";
import {
  CONFIRMATION_ALREADY_USED_REASON,
  CONFIRMATION_WINDOW_MS,
  MAX_FAILED_CONFIRMATIONS_PER_WINDOW,
  acceptanceEndMs,
  acceptedWindowIndices,
  deriveConfirmationKey,
  canonicalCallRequest,
  issueConfirmationCode,
  matchedWindowIndex,
  normalizeConfirmationCode,
  slotDigest,
  usedCodeDigest,
  windowIndexFor,
} from "../call-confirmation.js";

const CONFIRMATION_UNAVAILABLE_BODY = Object.freeze({ reason: "confirmation_unavailable" });
const CONFIRMATIONS_PER_TENANT_PER_MIN = 600;

function confirmationLimiterKey(req) {
  const tenantId = internalTenant(req);
  return tenantId ? `tenant:${tenantId}` : `ip:${req.ip}`;
}
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

function makeFailedAttemptLedger() {
  const failuresByTenant = new Map();
  function failureCount({ tenantKey, windowIdx }) {
    const entry = failuresByTenant.get(tenantKey);
    return entry?.windowIdx === windowIdx ? entry.count : 0;
  }
  return {
    failureCount,
    recordFailure({ tenantKey, windowIdx }) {
      for (const [key, entry] of failuresByTenant) if (entry.windowIdx < windowIdx) failuresByTenant.delete(key);
      failuresByTenant.set(tenantKey, { windowIdx, count: failureCount({ tenantKey, windowIdx }) + 1 });
    },
  };
}

function makeMemoryCodeRegister() {
  const ledgers = {
    usedCodes: makeOneTimeCodeLedger(),
    freshSlots: makeFreshSlotLedger(),
    failedAttempts: makeFailedAttemptLedger(),
  };
  return { transaktion: ({ arbeit }) => arbeit(ledgers) };
}

async function consumeIfCurrent({ key, tenantId, canonical, code, nowMs, ledgers }) {
  const slotDigestFor = (windowIdx) => slotDigest({ key, tenantId, windowIdx, canonical });
  const slots = new Map();
  for (const idx of acceptedWindowIndices(nowMs)) {
    slots.set(idx, await ledgers.freshSlots.currentSlot({ digest: slotDigestFor(idx), nowMs }));
  }
  const windowIdx = matchedWindowIndex({
    key,
    tenantId,
    canonical,
    code,
    nowMs,
    slotForWindow: (idx) => slots.get(idx),
  });
  if (windowIdx === null) return false;
  const acceptedUntilMs = acceptanceEndMs(windowIdx);
  const digest = usedCodeDigest({
    key,
    tenantId,
    windowIdx,
    normalizedCode: normalizeConfirmationCode(code),
  });
  if (!(await ledgers.usedCodes.markIfUnused({ digest, acceptedUntilMs, nowMs }))) return false;
  await ledgers.freshSlots.advance({ digest: slotDigestFor(windowIdx), acceptedUntilMs, nowMs });
  return true;
}

async function wasCodeUsed({ key, tenantId, code, nowMs, ledgers }) {
  const normalizedCode = normalizeConfirmationCode(code);
  if (!normalizedCode) return false;
  for (const windowIdx of acceptedWindowIndices(nowMs)) {
    const digest = usedCodeDigest({ key, tenantId, windowIdx, normalizedCode });
    if (await ledgers.usedCodes.wasUsed({ digest, nowMs })) return true;
  }
  return false;
}

const CONFIRM_OUTCOME = Object.freeze({
  CONFIRMED: "confirmed",
  ALREADY_USED: "already_used",
  REJECTED: "rejected",
});

function brakeKeyFor({ tenantId, nowMs }) {
  const windowIdx = windowIndexFor(nowMs);
  return {
    tenantKey: String(tenantId),
    windowIdx,
    nowMs,
    windowEndMs: (windowIdx + 1) * CONFIRMATION_WINDOW_MS,
  };
}

function confirmCode({ key, tenantId, canonical, code, nowMs, register }) {
  return register.transaktion({
    tenantId,
    nowMs,
    arbeit: async (ledgers) => {
      if (await wasCodeUsed({ key, tenantId, code, nowMs, ledgers }))
        return CONFIRM_OUTCOME.ALREADY_USED;
      const brakeKey = brakeKeyFor({ tenantId, nowMs });
      const failures = await ledgers.failedAttempts.failureCount(brakeKey);
      if (failures >= MAX_FAILED_CONFIRMATIONS_PER_WINDOW) return CONFIRM_OUTCOME.REJECTED;
      const confirmed = await consumeIfCurrent({ key, tenantId, canonical, code, nowMs, ledgers });
      if (confirmed) return CONFIRM_OUTCOME.CONFIRMED;
      if (normalizeConfirmationCode(code)) await ledgers.failedAttempts.recordFailure(brakeKey);
      return CONFIRM_OUTCOME.REJECTED;
    },
  });
}

const CONFIRMATION_RESPONSE_FIELDS = Object.freeze({
  [CONFIRM_OUTCOME.CONFIRMED]: Object.freeze({ confirmed: true }),
  [CONFIRM_OUTCOME.ALREADY_USED]: Object.freeze({
    confirmed: false,
    reason: CONFIRMATION_ALREADY_USED_REASON,
  }),
  [CONFIRM_OUTCOME.REJECTED]: Object.freeze({ confirmed: false }),
});

function confirmationResponseBody({ preview, outcome }) {
  if (!Object.hasOwn(CONFIRMATION_RESPONSE_FIELDS, outcome))
    throw new Error("unbekanntes Bestaetigungsergebnis");
  return { preview, ...CONFIRMATION_RESPONSE_FIELDS[outcome] };
}

async function confirmedBody({ preview, ...confirmation }) {
  return confirmationResponseBody({ preview, outcome: await confirmCode(confirmation) });
}

async function issuedBody({ key, tenantId, canonical, nowMs, preview, register }) {
  const digest = slotDigest({ key, tenantId, windowIdx: windowIndexFor(nowMs), canonical });
  const slot = await register.transaktion({
    tenantId,
    nowMs,
    arbeit: (ledgers) => ledgers.freshSlots.currentSlot({ digest, nowMs }),
  });
  const { code, expiresAtMs } = issueConfirmationCode({ key, tenantId, canonical, nowMs, slot });
  return { preview, confirmation: { code, expires_at: new Date(expiresAtMs).toISOString() } };
}

function respondUnavailable(res, err) {
  console.error(`[call-confirmation] Register nicht erreichbar: ${err?.message || "unbekannt"}`);
  return res.status(HTTP_SERVICE_UNAVAILABLE).json(CONFIRMATION_UNAVAILABLE_BODY);
}

export function makeCallConfirmationRoutes({ store, config, tenant: { requestTenant }, now = Date.now }) {
  const router = Router();
  const register = store.bestaetigungsRegister ?? makeMemoryCodeRegister();
  const confirmationLimiter = createRateLimiter(CONFIRMATIONS_PER_TENANT_PER_MIN, {
    schluessel: confirmationLimiterKey,
  });

  router.post("/api/call-confirmations", confirmationLimiter, internalOnly, (req, res, next) => {
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
    const request = { key, tenantId, canonical, nowMs, preview, register };
    const responseBody =
      typeof body.confirmation_code === "string"
        ? confirmedBody({ ...request, code: body.confirmation_code })
        : issuedBody(request);
    return responseBody
      .then(
        (responded) => res.status(HTTP_OK).json(responded),
        (err) => respondUnavailable(res, err),
      )
      .catch(next);
  });

  return router;
}
