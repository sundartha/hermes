import { config as defaultConfig } from "../config.js";
import {
  BOOTSTRAP_TENANT_ID,
  KYC_OUTBOUND_MIN,
  countryForE164,
  hasTrunkZeroAfterCountryCode,
  homeCountryCode,
  normalizeDialTarget,
  eurText,
  spendMonthEndDate,
  outboundReserveCents,
} from "../store/defaults.js";
import { emergencyBrakeSeconds } from "../call-duration.js";
import { findActiveNumber } from "../store/views.js";
import { openOutageAlert } from "../store/state-ops.js";
import { sendFailSoftAlertSms } from "./alert-sms.js";
import { E164, invalidText, validateAssistantContext, validateMandate } from "../routes/_validation.js";
import { findPlan } from "../plans.js";
import { resolvePeriodStartIso } from "../billing/period.js";
import { includedMinutesFor } from "../billing/plan-caps.js";
import { deniedPrefix, isDenied } from "./number-denylist.js";
import { localeFor } from "../i18n/locales.js";

const HOUR_MS = 60 * 60 * 1000;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_FORBIDDEN = 403;

export const E164_FORMAT_ERROR = "'to' must be E.164, e.g. +4917212345678";

const PLATFORM_WARN_EVENT = "platform_spend_warning";
const PLATFORM_WARN_SMS_PREFIX = "[Hermes] Plattform-Warnschwelle erreicht: ";

const logWarningFailure = (e) => console.error(`[${PLATFORM_WARN_EVENT}]`, e.message);

const warningDetail = (w) => `summe_cents=${w.totalCents} monat=${w.monthKey}`;

const PLACE_CALL_DENIED_EVENT = "place_call_denied";

const denialAudit = (grund, ctx, detailSuffix = "") => ({
  event: PLACE_CALL_DENIED_EVENT,
  grund,
  detail: `to=${ctx.to} grund=${grund}${detailSuffix}`,
});

function ausgehendGesperrt(config, store) {
  if (config.safety.outboundFrozen)
    return { fehler: "Outbound-Anrufe sind derzeit gesperrt (OUTBOUND_FROZEN).", auditZusatz: "" };
  if (store.anrufpauseAktiv?.())
    return { fehler: "Ausgehende Anrufe sind pausiert (Anrufpause).", auditZusatz: " quelle=anrufpause" };
  return null;
}

const matchesPrefix = (to, codes) => codes.includes("*") || codes.some((c) => to.startsWith(c));
const hourWindowStart = () => new Date(Date.now() - HOUR_MS).toISOString();

export const isTrunkZeroFormatError = (to) => !isDenied(to) && hasTrunkZeroAfterCountryCode(to);

export const hasCountryPrefix = (number, prefix) =>
  typeof number === "string" && number.startsWith(prefix);

function domesticPrefixOf(number) {
  return defaultConfig.billing.voiceTariffDomesticPrefixes.find((p) => hasCountryPrefix(number, p)) ?? null;
}

export const numberOriginDecoupled = (provisioning) => Boolean(provisioning.forceNumberCountry);

function foreignOriginOnHomeCall({ to, fromNumber, tenantCountry }) {
  const targetCountry = countryForE164(to);
  if (!targetCountry || targetCountry !== String(tenantCountry || "").toUpperCase()) return false;
  return countryForE164(fromNumber) !== targetCountry;
}

export function isDomesticLeg(to, from) {
  const toPrefix = domesticPrefixOf(to);
  return toPrefix !== null && toPrefix === domesticPrefixOf(from);
}

export function tariffCentsPerMin(to, from) {
  return isDomesticLeg(to, from)
    ? defaultConfig.billing.voiceTariffDomesticCents
    : defaultConfig.billing.voiceTariffDefaultCents;
}

export function resolveMaxDurationS(raw, brakeSeconds) {
  const requested = parseInt(raw, 10);
  return Number.isFinite(requested) && requested > 0 ? Math.min(requested, brakeSeconds) : brakeSeconds;
}

const GATE_CHAIN_LENGTH = 18;

const ANI_OWNERSHIP_BUCKET = "drift:ownership_lost";

function frischGenug(lastSeenAtIso, maxAgeMs) {
  const ms = Date.parse(lastSeenAtIso || "");
  if (Number.isNaN(ms)) return false;
  return Date.now() - ms <= maxAgeMs;
}

function makeAniOwnershipGate({ config, store, aniOwnershipRecheck }) {
  return {
    name: "ani_ownership",
    async run(ctx) {
      if (!config.safety.outboundAniGateEnabled) return null;
      const marker = openOutageAlert(store.load(), ANI_OWNERSHIP_BUCKET);
      if (!marker || !frischGenug(marker.lastSeenAt, config.safety.outboundAniGateMaxAgeMs)) return null;
      let nochImmerVerloren;
      try {
        nochImmerVerloren = await aniOwnershipRecheck(config.provisioning.platformAniE164);
      } catch {
        nochImmerVerloren = null;
      }
      if (nochImmerVerloren !== true) return null;
      return {
        status: HTTP_SERVICE_UNAVAILABLE,
        body: { error: "Die Absendernummer der Plattform ist beim Anbieter nicht mehr verfuegbar. Der Anruf wurde nicht gestartet." },
        audit: denialAudit("ani_not_owned", ctx, ` tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`),
      };
    },
  };
}

function quotaDenialOf(fehler, ctx) {
  return {
    status: fehler.status,
    body: { error: fehler.message },
    audit: denialAudit(fehler.grund, ctx, ` requestedBy=${ctx.requestedBy}`),
  };
}

export function resolveDialTarget({ store, tenantId, to }) {
  const homeCountry = homeCountryCode(
    [store.tenantPrivateNumber(tenantId), findActiveNumber(store.load(), tenantId)?.e164],
    store.tenantGeo(tenantId).country,
  );
  return normalizeDialTarget(to, homeCountry);
}

export const GATE_ERROR_GRUND = "gate_error";
export const GATE_ERROR_MESSAGE =
  "Sicherheitspruefung derzeit nicht moeglich. Der Anruf wurde nicht gestartet.";

export async function runOutboundGates({ gates, ctx }) {
  for (const gate of gates) {
    let denial;
    try {
      denial = await gate.run(ctx);
    } catch (fehler) {
      console.error(`[place_call] Gate ${gate.name} fehlgeschlagen:`, fehler?.message);
      return {
        status: HTTP_SERVICE_UNAVAILABLE,
        body: { error: GATE_ERROR_MESSAGE },
        audit: denialAudit(GATE_ERROR_GRUND, ctx, ` gate=${gate.name}`),
      };
    }
    if (denial) return denial;
  }
  return null;
}

export function makeOutboundGates({
  store,
  config = defaultConfig,
  requestTenant,
  internalIdentity,
  OWNER_ID,
  TENANT_REJECT,
  audit,
  messaging, aniOwnershipRecheck = async () => null,
}) {
  function countryGateAllowed(to, profile) {
    if (!matchesPrefix(to, config.safety.allowedCountryCodes)) return false;
    const p = profile.allowedCountryCodes;
    return !p || !p.length || matchesPrefix(to, p);
  }

  const perTargetWindowStart = () =>
    new Date(Date.now() - config.safety.perTargetWindowMs).toISOString();
  function tenantHourReached(profile, tenantId) {
    const limit =
      profile.maxCallsPerHour == null
        ? config.safety.maxCallsPerHour
        : Math.min(config.safety.maxCallsPerHour, profile.maxCallsPerHour);
    return store.countOutboundCallsSince(hourWindowStart(), { tenantId }) >= limit;
  }
  function perTargetCapReached(tenantId, to) {
    return (
      store.countOutboundCallsSince(perTargetWindowStart(), { tenantId, to }) >=
      config.safety.perTargetCallCap
    );
  }

  const gateTexts = (tenantId) => localeFor(store.tenantLanguage(tenantId)).gates;

  function kycGateError(tenantId) {
    if (store.kycReached(tenantId, KYC_OUTBOUND_MIN)) return null;
    return {
      status: 403,
      grund: "kyc",
      message: gateTexts(tenantId).kycInsufficient,
    };
  }

  function allowlistError(to, { profile, tenantId }) {
    if (store.tenantInactive(tenantId))
      return {
        status: 403,
        grund: "abo",
        message: gateTexts(tenantId).subscriptionInactive,
      };
    const hold = store.billingHoldActive(tenantId);
    if (hold)
      return {
        status: 403,
        grund: "billing_hold",
        message: gateTexts(tenantId).billingHold,
      };
    if (profile.unrestricted) return null;
    if (profile.allowedNumbers?.includes(to)) return null;
    if (store.tenantActiveSubscriber(tenantId, KYC_OUTBOUND_MIN)) return null;
    return {
      status: 403,
      grund: "allowlist",
      message: gateTexts(tenantId).notAuthorized,
    };
  }

  function planMinutesExhausted(tenantId) {
    const sub = store.tenantSubscription(tenantId);
    const plan = sub.planSlug ? findPlan(sub.planSlug) : null;
    return store.planMinutesExceeded(tenantId, {
      includedMinutes: includedMinutesFor({ plan, subscription: sub }),
      periodStartIso: resolvePeriodStartIso(sub),
    });
  }

  function callQuotaError(to, caller) {
    const { profile, tenantId } = caller;
    if (tenantHourReached(profile, tenantId))
      return { status: 429, grund: "stundenlimit", message: gateTexts(tenantId).hourLimit };
    if (perTargetCapReached(tenantId, to))
      return { status: 429, grund: "ziel_limit", message: gateTexts(tenantId).perTargetLimit };
    return null;
  }

  function callQuotaDenial(ctx) {
    const fehler = callQuotaError(ctx.to, { profile: ctx.profile, tenantId: ctx.tenantId });
    return fehler ? quotaDenialOf(fehler, ctx) : null;
  }

  function numberGateError(to, caller) {
    const { profile, tenantId } = caller;
    const denied = deniedPrefix(to);
    if (denied)
      return {
        status: 403,
        grund: "denylist",
        praefix: denied,
        message: gateTexts(tenantId).deniedNumber(to),
      };
    if (!E164.test(to)) return { status: 400, grund: "format", message: E164_FORMAT_ERROR };
    if (!countryGateAllowed(to, profile))
      return {
        status: 403,
        grund: "land",
        message: gateTexts(tenantId).countryBlocked(to),
      };
    return callQuotaError(to, caller) ?? allowlistError(to, caller);
  }

  function outboundFrom(s, tenantId) {
    const own = findActiveNumber(s, tenantId);
    return own ? { fromNumber: own.e164, provider: own.provider, numberRecord: own } : null;
  }

  function originGateError(ctx) {
    if (numberOriginDecoupled(config.provisioning)) return null;
    const foreign = foreignOriginOnHomeCall({
      to: ctx.to,
      fromNumber: ctx.fromNumber,
      tenantCountry: store.tenantGeo(ctx.tenantId).country,
    });
    if (!foreign) return null;
    return {
      status: 403,
      grund: "herkunft",
      message:
        "Outbound blocked: the active number of this tenant is not registered in the destination country.",
    };
  }

  function tenantBudgetDenial(tenantId) {
    const snapshot = store.tenantBudgetSnapshot(tenantId, config.billing);
    const texts = gateTexts(tenantId);
    if (snapshot.spentCents === null)
      return { grund: "budget_tenant", message: texts.budgetUnreadable };
    return {
      grund: "budget_tenant",
      message: texts.budgetCapReached(eurText(snapshot.spentCents), eurText(snapshot.capCents)),
    };
  }

  const reserveUnreadableDenial = (tenantId) => ({
    grund: "reserve_erschoepft",
    message: gateTexts(tenantId).budgetUnreadable,
  });

  function tenantReserveDenial(tenantId, reserveCents) {
    const snapshot = store.tenantBudgetSnapshot(tenantId, config.billing);
    const texts = gateTexts(tenantId);
    if (snapshot.remainingCents === null) return reserveUnreadableDenial(tenantId);
    const missingEur = eurText(reserveCents - snapshot.remainingCents);
    const monthEnd = spendMonthEndDate(Date.now());
    if (snapshot.remainingCents > 0)
      return {
        grund: "reserve_ueber_rest",
        message: texts.reserveOverRemaining(missingEur, monthEnd),
      };
    return {
      grund: "reserve_erschoepft",
      message: texts.reserveExhausted(missingEur, monthEnd),
    };
  }

  function claimSpendWarning() {
    try {
      return store.claimPlatformSpendWarning(config.billing, new Date().toISOString());
    } catch (e) {
      logWarningFailure(e);
      return null;
    }
  }

  function reserveOutcome(ctx) {
    const reserved = store.tryReserveOutboundBudget(ctx.tenantId, ctx.reserveCents, config.billing);
    if (reserved) return { reserved: true, warning: claimSpendWarning() };
    if (store.reserveExceedsBudget(ctx.tenantId, ctx.reserveCents, config.billing))
      return { reserved: false, ...tenantReserveDenial(ctx.tenantId, ctx.reserveCents) };
    return { reserved: false, ...reserveUnreadableDenial(ctx.tenantId) };
  }

  function emitPlatformSpendWarning(warning, ctx) {
    let detail;
    try {
      detail = warningDetail(warning);
      audit(PLATFORM_WARN_EVENT, null, detail);
    } catch (e) {
      logWarningFailure(e);
      return;
    }
    sendFailSoftAlertSms({
      messaging,
      to: config.billing.platformAlertSmsTo,
      body: PLATFORM_WARN_SMS_PREFIX + detail,
      resolveSender: () => ({ provider: ctx.outboundProvider, e164: ctx.fromNumber }),
      onError: logWarningFailure,
    });
  }

  const deny = (status, body, audit = null) => ({ status, body, audit });

  function brakeSecondsFor(tenantId, tariffCents) {
    return emergencyBrakeSeconds({
      remainingCents: store.tenantBudgetSnapshot(tenantId, config.billing).remainingCents,
      tariffCentsPerMin: tariffCents,
    });
  }

  const gates = [
    {
      name: "outbound_frozen",
      run(ctx) {
        const sperre = ausgehendGesperrt(config, store);
        return sperre && deny(
          HTTP_FORBIDDEN,
          { error: sperre.fehler },
          denialAudit("frozen", ctx, sperre.auditZusatz),
        );
      },
    },
    {
      name: "resolve_identity",
      run(ctx) {
        const identity = internalIdentity(ctx.req);
        ctx.requestedBy = identity || OWNER_ID;
        ctx.tenantId = requestTenant(ctx.req);
        return null;
      },
    },
    {
      name: "tenant_reject",
      run(ctx) {
        if (ctx.tenantId !== TENANT_REJECT) return null;
        return deny(
          403,
          { error: "Kein Tenant fuer diese Identitaet." },
          denialAudit("tenant_unbekannt", ctx, ` requestedBy=${ctx.requestedBy}`),
        );
      },
    },
    {
      name: "normalize_target",
      run(ctx) {
        ctx.to = resolveDialTarget({
          store,
          tenantId: ctx.tenantId,
          to: ctx.to,
        });
        return null;
      },
    },
    {
      name: "trunk_zero_normalized",
      run(ctx) {
        if (!isTrunkZeroFormatError(ctx.to)) return null;
        return deny(400, { error: E164_FORMAT_ERROR });
      },
    },
    {
      name: "kyc",
      run(ctx) {
        const e = kycGateError(ctx.tenantId);
        if (!e) return null;
        return deny(
          e.status,
          { error: e.message },
          denialAudit(e.grund, ctx, ` tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`),
        );
      },
    },
    {
      name: "owner_name",
      run(ctx) {
        ctx.ownerName = store.tenantContext(ctx.tenantId).ownerName;
        if (ctx.ownerName) return null;
        return deny(
          403,
          { error: "Kein registrierter Auftraggeber-Name fuer diesen Tenant." },
          denialAudit("keine_identitaet", ctx, ` tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`),
        );
      },
    },
    {
      name: "resolve_profile",
      run(ctx) {
        ctx.profile = store.resolveProfile(ctx.tenantId);
        return null;
      },
    },
    {
      name: "number_gate",
      run(ctx) {
        const e = numberGateError(ctx.to, { profile: ctx.profile, tenantId: ctx.tenantId });
        if (!e) return null;
        if (e.status === 400) return deny(400, { error: e.message });
        const praefix = e.praefix ? ` praefix=${e.praefix}` : "";
        return deny(
          e.status,
          { error: e.message },
          denialAudit(e.grund, ctx, `${praefix} requestedBy=${ctx.requestedBy}`),
        );
      },
    },
    {
      name: "valid_text",
      run(ctx) {
        const err =
          invalidText("objective", ctx.objective) ||
          invalidText("briefing", ctx.b.briefing) ||
          invalidText("constraints", ctx.b.constraints);
        if (!err) return null;
        return deny(400, { error: err });
      },
    },
    {
      name: "valid_mandate",
      run(ctx) {
        const r = validateMandate(ctx.b.mandate);
        if (r.error) return deny(400, { error: r.error });
        ctx.mandate = r.value;
        return null;
      },
    },
    {
      name: "assistant_context",
      run(ctx) {
        ctx.context = null;
        if (!config.tenancy.assistantContextEnabled) return null;
        const r = validateAssistantContext(ctx.b.context);
        if (r.error) return deny(400, { error: r.error });
        ctx.context = r.value;
        return null;
      },
    },
    {
      name: "resolve_outbound",
      run(ctx) {
        const o = outboundFrom(store.load(), ctx.tenantId);
        if (!o) {
          return deny(
            403,
            { error: "Kein aktive Absendernummer fuer diesen Tenant." },
            denialAudit("keine_tenant_nummer", ctx, ` tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`),
          );
        }
        ctx.fromNumber = o.fromNumber;
        ctx.outboundProvider = o.provider;
        ctx.numberRecord = o.numberRecord;
        const originError = originGateError(ctx);
        if (!originError) return null;
        return deny(
          originError.status,
          { error: originError.message },
          denialAudit(originError.grund, ctx, ` tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`),
        );
      },
    }, makeAniOwnershipGate({ config, store, aniOwnershipRecheck }),
    {
      name: "budget",
      run(ctx) {
        if (!store.budgetExceeded(ctx.tenantId, config.billing)) return null;
        const { grund, message } = tenantBudgetDenial(ctx.tenantId);
        return deny(402, { error: message }, denialAudit(grund, ctx, ` tenant=${ctx.tenantId}`));
      },
    },
    {
      name: "minutes",
      run(ctx) {
        if (
          !config.billing.paymentEnabled ||
          ctx.tenantId === BOOTSTRAP_TENANT_ID ||
          !planMinutesExhausted(ctx.tenantId)
        )
          return null;
        return deny(
          402,
          {
            error:
              "Inkludierte Plan-Minuten aufgebraucht. Bitte Tarif anpassen oder neue Abrechnungsperiode abwarten.",
          },
          denialAudit("minutes", ctx, ` tenant=${ctx.tenantId}`),
        );
      },
    },
    {
      name: "compute_reserve",
      run(ctx) {
        const tariffCents = tariffCentsPerMin(ctx.to, ctx.fromNumber);
        ctx.reserveCents = outboundReserveCents(tariffCents);
        ctx.maxDur = resolveMaxDurationS(ctx.b.max_duration_s, brakeSecondsFor(ctx.tenantId, tariffCents));
        return null;
      },
    },
    {
      name: "reserve_budget",
      async run(ctx) {
        let outcome;
        try {
          outcome = await store.withStoreLock(() => reserveOutcome(ctx));
        } catch (e) {
          console.error(`[place_call] reserve fehlgeschlagen tenant=${ctx.tenantId}:`, e.message);
          return deny(
            402,
            { error: "Reservierung fehlgeschlagen. Bitte erneut versuchen." },
            denialAudit("reserve_error", ctx, ` tenant=${ctx.tenantId}`),
          );
        }
        if (outcome.reserved) {
          if (outcome.warning) emitPlatformSpendWarning(outcome.warning, ctx);
          return null;
        }
        return deny(
          402,
          { error: outcome.message },
          denialAudit(outcome.grund, ctx, ` tenant=${ctx.tenantId} requestedBy=${ctx.requestedBy}`),
        );
      },
    },
  ];

  if (gates.length !== GATE_CHAIN_LENGTH)
    throw new Error(
      `Outbound-Gate-Kette: ${gates.length} Glieder gebaut, erwartet ${GATE_CHAIN_LENGTH} - ` +
        "Kette und Sollstaerke (GATE_CHAIN_LENGTH) sind auseinandergelaufen.",
    );

  return { gates, callQuotaDenial };
}
