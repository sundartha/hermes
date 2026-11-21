import { E164, normNum } from "./begriffe/rufnummern.js";
import { PROVIDER, PLATFORM_NUMBER_PURPOSE } from "./begriffe/nummern-vergabe.js";
import { RESERVE_LEAD_MINUTES, outboundReserveCents } from "./begriffe/abrechnung.ts";
import { STT_PROFILE, isSttProfile } from "./telephony/stt-profile.ts";
import { usableFallbackProvider } from "./llm/provider.ts";
import { inboundElAccessDefects } from "./elevenlabs/inbound-path-decision.ts";
import { normalisierterOrigin } from "./middleware.ts";
import { MS_PER_DAY } from "./utils/timer.ts";
import { fehlerText } from "./utils/fehler-text.ts";

export async function guardedBoot(label, fn) {
  try {
    await fn();
    return true;
  } catch (e) {
    console.error(
      `[boot] ${label} deaktiviert (Portal-Pool-Fehler):`,
      fehlerText(e),
    );
    return false;
  }
}

export const BOOTSTRAP_HEAL = Object.freeze({
  NOT_NEEDED: "not_needed",
  HEAL: "heal",
  BLOCKED_STORE_NOT_FRESH: "blocked_store_not_fresh",
  BLOCKED_PARAMS: "blocked_params",
});

export function bootstrapHealDecision({
  activeNumberPresent,
  numberCount,
  foreignTenantCount,
  callCount,
  e164,
  provider,
}) {
  if (activeNumberPresent) return BOOTSTRAP_HEAL.NOT_NEEDED;
  if (numberCount > 0 || foreignTenantCount > 0 || callCount > 0)
    return BOOTSTRAP_HEAL.BLOCKED_STORE_NOT_FRESH;
  if (!E164.test(normNum(e164 || "")) || !Object.values(PROVIDER).includes(provider))
    return BOOTSTRAP_HEAL.BLOCKED_PARAMS;
  return BOOTSTRAP_HEAL.HEAL;
}

export function fakeOriginateBootBlocked({ fakeOriginate, skipTwilioSignatureCheck }) {
  return fakeOriginate === true && skipTwilioSignatureCheck !== true;
}

export function sttProfileFindings(sttProfile) {
  if (isSttProfile(sttProfile)) return [];
  return [
    {
      message:
        `STT_PROFILE='${String(sttProfile)}' ist unbekannt. Gueltig: ` +
        `${Object.values(STT_PROFILE).join("|")}.`,
      fatal: true,
    },
  ];
}

export const LLM_FALLBACK_FINDING = Object.freeze({ SAME_AS_PRIMARY: "llm_fallback_same_as_primary" });

export function llmFallbackFindings({ provider, fallback } = {}) {
  if (!fallback) return [];
  if (usableFallbackProvider({ provider, fallback })) return [];
  return [
    {
      code: LLM_FALLBACK_FINDING.SAME_AS_PRIMARY,
      fatal: false,
      message:
        `LLM_PROVIDER_FALLBACK=${fallback} ist identisch mit LLM_PROVIDER - es gibt keinen Anbieter, ` +
        "auf den ausgewichen werden koennte; der Guthaben-Latch bleibt wirkungslos. Wert im " +
        "Render-Dashboard auf einen ANDEREN gueltigen Anbieter setzen oder leeren.",
    },
  ];
}

export function meterMappingGaps(usageEventKinds, meterEventNames) {
  return usageEventKinds.filter((kind) => !meterEventNames[kind]);
}

const SECONDS_PER_MINUTE = 60;

export const SPEND_CAP_FINDING = Object.freeze({
  TENANT_DEFAULT_UNSET: "tenant_default_unset",
  WORST_CASE_UNAFFORDABLE: "worst_case_unaffordable",
});

function affordableCallDurationS(tenantDefaultCents, maxTariffCents) {
  return Math.floor(tenantDefaultCents / maxTariffCents) * SECONDS_PER_MINUTE;
}

export function spendCapCoherence({ tenantDefaultCents, platformCapCents, maxTariffCents }) {
  if (tenantDefaultCents === 0) {
    return [
      {
        code: SPEND_CAP_FINDING.TENANT_DEFAULT_UNSET,
        fatal: false,
        message:
          `DEFAULT_TENANT_BUDGET_CENTS=0 (Sentinel: kein Tenant-Default) - jeder Tenant ` +
          `ohne eigene tenant_budget-Zeile faellt auf MAX_BUDGET_EUR*100=${String(platformCapCents)} ` +
          "als Pro-Tenant-Decke zurueck (effectiveCapCents Stufe 3).",
      },
    ];
  }
  const reserveCents = outboundReserveCents(maxTariffCents);
  if (reserveCents > tenantDefaultCents) {
    const maxDurationS = affordableCallDurationS(tenantDefaultCents, maxTariffCents);
    return [
      {
        code: SPEND_CAP_FINDING.WORST_CASE_UNAFFORDABLE,
        fatal: true,
        message:
          `Worst-Case-Reserve ${String(reserveCents)} Cent (VOICE_TARIFF_DEFAULT_CENTS=${String(maxTariffCents)} ` +
          `* ${String(RESERVE_LEAD_MINUTES)} Vorlauf-Minuten) uebersteigt die Tenant-Decke DEFAULT_TENANT_BUDGET_CENTS=${String(tenantDefaultCents)} ` +
          `- der teuerste Zielverkehr traegt unter dieser Decke nur noch ${String(maxDurationS)}s Gespraech. ` +
          `Abhilfe: DEFAULT_TENANT_BUDGET_CENTS auf mindestens ${String(reserveCents)} anheben.`,
      },
    ];
  }
  return [];
}

export function unpricedModels(modelIds, modelPricesUsd) {
  return modelIds.filter((id) => !Object.hasOwn(modelPricesUsd, id));
}

export function unpricedPlanSlugs(slugs, priceIdOf) {
  return slugs.filter((slug) => !priceIdOf(slug));
}

export const MODEL_PRICE_MAX_AGE_DAYS = 90;

export function stalePriceFindings(modelPricesUsd, todayIso) {
  return Object.entries(modelPricesUsd)
    .filter(([, price]) => (Date.parse(todayIso) - Date.parse(price.asOf)) / MS_PER_DAY > MODEL_PRICE_MAX_AGE_DAYS)
    .map(([modelId, price]) => ({
      fatal: false,
      message:
        `Preisstaffel '${modelId}' wurde am ${price.asOf} abgerufen (aelter als ` +
        `${String(MODEL_PRICE_MAX_AGE_DAYS)} Tage) - Raten gegen ${price.source} pruefen.`,
    }));
}

export const VOICE_TARIFF_FLOOR_FINDING = Object.freeze({
  BELOW_FULL_COST: "voice_tariff_below_full_cost",
});

export function voiceTariffFloorFindings({ domesticTariffCents, fullCostFloorCents, coveragePercent, minCoveragePercent }) {
  const belowFloor = domesticTariffCents < fullCostFloorCents;
  if (!belowFloor) return [];
  return [
    {
      code: VOICE_TARIFF_FLOOR_FINDING.BELOW_FULL_COST,
      fatal: false,
      message:
        `VOICE_TARIFF_DOMESTIC_CENTS=${String(domesticTariffCents)} liegt unter der Vollkostenschwelle ` +
        `VOICE_TARIFF_FULL_COST_FLOOR_CENTS=${String(fullCostFloorCents)} (Abgleich-Deckung ${String(coveragePercent)}%, ` +
        `COST_TRUING_MIN_COVERAGE_PERCENT=${String(minCoveragePercent)}% - Kontext, seit KV2-10 kein ` +
        "Ausloeser mehr) - der gesenkte Tarif ist der Buchungswert jedes nicht abgeglichenen Calls " +
        "und wird von der Messung nicht gedeckt.",
    },
  ];
}

const PROVIDER_RATE_ANCHOR_MICRO = 920000;
const PROVIDER_RATE_BAND_MIN_FACTOR = 0.5;
const PROVIDER_RATE_BAND_MAX_FACTOR = 2.0;

export const PROVIDER_RATE_FINDING = Object.freeze({
  OUT_OF_BAND: "provider_rate_out_of_band",
});

export function providerRateOutOfBand(rateMicro) {
  const minMicro = Math.round(PROVIDER_RATE_ANCHOR_MICRO * PROVIDER_RATE_BAND_MIN_FACTOR);
  const maxMicro = Math.round(PROVIDER_RATE_ANCHOR_MICRO * PROVIDER_RATE_BAND_MAX_FACTOR);
  if (rateMicro >= minMicro && rateMicro <= maxMicro) return [];
  return [
    {
      code: PROVIDER_RATE_FINDING.OUT_OF_BAND,
      fatal: true,
      message:
        `PROVIDER_TO_BUCKET_RATE_MICRO=${String(rateMicro)} liegt ausserhalb des Toleranzbandes ` +
        `${String(minMicro)}..${String(maxMicro)} (Anker ${String(PROVIDER_RATE_ANCHOR_MICRO)} = 0,92 je Einheit). ` +
        "Haeufigste Ursache: Zehnerpotenz-Vertipper (920 statt 920000). Der Kurs bewegt " +
        "seit der Korrekturbuchung Geld - der Start wird verweigert.",
    },
  ];
}

export const PLAN_CAP_FINDING = Object.freeze({
  PLAN_CAP_UNDERIVABLE: "plan_cap_underivable",
  PLAN_CAP_WORST_CASE_UNAFFORDABLE: "plan_cap_worst_case_unaffordable",
});

function derivePlanCaps({ slugs, capForSlug }) {
  const derived = [];
  const underivableSlugs = [];
  for (const slug of slugs) {
    let capCents;
    try {
      capCents = capForSlug(slug);
    } catch {
      underivableSlugs.push(slug);
      continue;
    }
    derived.push({ slug, capCents });
  }
  return { derived, underivableSlugs };
}

export function planCapUnderivableFindings({ slugs, capForSlug }) {
  const { underivableSlugs } = derivePlanCaps({ slugs, capForSlug });
  if (!underivableSlugs.length) return [];
  return [
    {
      code: PLAN_CAP_FINDING.PLAN_CAP_UNDERIVABLE,
      fatal: true,
      message:
        `Katalog-Slug(s) ${underivableSlugs.join(",")} haben KEINE ableitbare Kostendecke ` +
        "(fehlender Kopffreiheit-Eintrag in PLAN_CAP_HEADROOM, src/billing/plan-caps.ts) - " +
        "CATALOG_SLUGS und PLAN_CAP_HEADROOM sind auseinandergelaufen. Kopffreiheit ergaenzen.",
    },
  ];
}

export function planCapReserveFindings({ slugs, capForSlug, maxTariffCents }) {
  const { derived } = derivePlanCaps({ slugs, capForSlug });
  if (!derived.length) return [];
  const reserveCents = outboundReserveCents(maxTariffCents);
  const smallestCap = derived.reduce((min, entry) => (entry.capCents < min.capCents ? entry : min));
  if (reserveCents <= smallestCap.capCents) return [];
  return [
    {
      code: PLAN_CAP_FINDING.PLAN_CAP_WORST_CASE_UNAFFORDABLE,
      fatal: true,
      message:
        `Worst-Case-Reserve ${String(reserveCents)} Cent (VOICE_TARIFF_DEFAULT_CENTS=${String(maxTariffCents)} ` +
        `* ${String(RESERVE_LEAD_MINUTES)} Vorlauf-Minuten) uebersteigt die kleinste Plan-Decke ` +
        `(${smallestCap.slug}=${String(smallestCap.capCents)} Cent) - ein Tenant mit diesem Plan faellt ` +
        "schon beim ERSTEN Anruf ins Reserve-Gate (402). Der Tarif ist KEIN Hebel: Decke und " +
        "Reserve skalieren beide mit ihm. Abhilfe: inkludierte Minuten/Kopffreiheit des Plans " +
        "anheben (PLAN_CATALOG, PLAN_CAP_HEADROOM).",
    },
  ];
}

export const ALERT_CHANNEL_FINDING = Object.freeze({
  UNSET: "platform_alert_sms_unset",
  UNSET_WITH_ACTIVE_WARNING: "platform_alert_sms_unset_with_active_warning",
  BOTH_UNSET_WITH_OUTBOUND: "platform_alert_channels_unset_with_outbound",
});

export function mailerKonstruierbar({ brevoApiKey, smtpHost } = {}) {
  return Boolean(brevoApiKey) || Boolean(smtpHost);
}

export const ALARM_KANAL = Object.freeze({ MAIL: "mail", SMS: "sms", KEINE: "keine" });

export function betreiberAlarmKanaele({ billing, mail }) {
  const kanaele = [];
  if (mail.platformAlertMailTo && mailerKonstruierbar(mail)) kanaele.push(ALARM_KANAL.MAIL);
  if (billing.platformAlertSmsTo) kanaele.push(ALARM_KANAL.SMS);
  return kanaele;
}

export function alarmKanalZeile(kanaele) {
  return kanaele.length > 0 ? kanaele.join(",") : ALARM_KANAL.KEINE;
}

export const KOSTEN_ALARM_FINDING = Object.freeze({
  NO_TARGET: "kosten_alarm_ohne_ziel",
});

export function kostenAlarmFindings({ billing, mail }) {
  if (billing.betterstackAlertUrl || betreiberAlarmKanaele({ billing, mail }).length > 0)
    return [];
  return [{
    code: KOSTEN_ALARM_FINDING.NO_TARGET,
    fatal: false,
    message:
      "Weder PLATFORM_ALERT_MAIL_TO (mit BREVO_API_KEY oder SMTP_HOST) noch " +
      "PLATFORM_ALERT_SMS_TO ist gesetzt - jeder Kosten-Befund (zu geringer Beleg-Anteil, " +
      "Belegausfall) landet ausschliesslich im Log und in audit_log, es sieht ihn " +
      "niemand. Mindestens einen vollstaendigen Kanal setzen.",
  }];
}

export function alertChannelInputs({ billing, mail }) {
  return {
    ...billing,
    platformAlertMailTo: mail.platformAlertMailTo,
    mailerVorhanden: mailerKonstruierbar(mail),
  };
}

function istPositiv(wert) {
  return (wert ?? 0) > 0;
}

export function alertChannelFindings({
  platformAlertSmsTo,
  betterstackAlertUrl,
  paymentEnabled,
  platformSpendWarnPercent,
  platformAlertMailTo,
  mailerVorhanden,
  outageAlertWindowMs,
} = {}) {
  if (platformAlertSmsTo || betterstackAlertUrl) return [];
  if (!(platformAlertMailTo && mailerVorhanden) && istPositiv(outageAlertWindowMs))
    return [
      {
        code: ALERT_CHANNEL_FINDING.BOTH_UNSET_WITH_OUTBOUND,
        fatal: true,
        message:
          "PLATFORM_ALERT_SMS_TO ist leer UND der Mail-Kanal ist nicht einsatzbereit " +
          "(PLATFORM_ALERT_MAIL_TO leer ODER kein Mailer konfiguriert - weder " +
          "BREVO_API_KEY noch SMTP_HOST), obwohl OUTAGE_ALERT_WINDOW_MS>0 - der " +
          "systematische-Ausfall-Melder haette KEINEN Betreiber-Kanal. Mindestens einen " +
          "vollstaendigen Kanal setzen ODER OUTAGE_ALERT_WINDOW_MS=0.",
      },
    ];
  if (paymentEnabled && istPositiv(platformSpendWarnPercent))
    return [
      {
        code: ALERT_CHANNEL_FINDING.UNSET_WITH_ACTIVE_WARNING,
        fatal: true,
        message:
          "PLATFORM_ALERT_SMS_TO ist leer, obwohl PAYMENT_ENABLED=true und " +
          "PLATFORM_SPEND_WARN_PERCENT>0 - die Plattform-Spend-Warnung haette keinen " +
          "Empfaenger. Empfaenger setzen ODER PLATFORM_SPEND_WARN_PERCENT=0 (Warnung bewusst aus).",
      },
    ];
  return [
    {
      code: ALERT_CHANNEL_FINDING.UNSET,
      fatal: false,
      message:
        "PLATFORM_ALERT_SMS_TO ist leer - Plattform-Warnung und Tarif-Drift-Alarm laufen " +
        "nur ins Audit-Log, es geht KEINE SMS an einen Menschen.",
    },
  ];
}

export const PLATFORM_ALERT_SENDER_FINDING = Object.freeze({
  UNBOUND: "alert_sms_sender_unbound",
});

export function platformAlertSenderFindings({ openBindings = [] } = {}) {
  const bound = openBindings.some((binding) => binding.purpose === PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER);
  if (bound) return [];
  return [{
    code: PLATFORM_ALERT_SENDER_FINDING.UNBOUND,
    fatal: false,
    message:
      "Keine offene alert_sms_sender-Bindung - der Ausfall-Melder hat KEINEN SMS-Absender " +
      "(Mail bleibt unberuehrt, PLATFORM_ALERT_MAIL_TO). Ursache: keine aktive " +
      "Bootstrap-Nummer (resolveBootstrapAlertSender liefert null).",
  }];
}

export const COST_TRUING_BOOKING_FINDING = Object.freeze({
  REQUIRED_TYPES_EMPTY: "cost_truing_required_types_empty",
  REQUIRED_TYPES_UNASSIGNABLE: "cost_truing_required_types_unassignable",
  COVERAGE_BELOW_THRESHOLD: "cost_truing_coverage_below_threshold",
});

export function costTruingBookingFindings({
  requiredRecordTypes,
  assignableRecordTypes,
  coveragePercent,
  minCoveragePercent,
}) {
  const findings = [];
  if (requiredRecordTypes.length === 0) {
    findings.push({
      code: COST_TRUING_BOOKING_FINDING.REQUIRED_TYPES_EMPTY,
      fatal: true,
      message:
        "COST_TRUING_REQUIRED_RECORD_TYPES ist leer - ein Dienst, der Geld zurueckerstattet, " +
        "ohne zu wissen, wogegen er Vollstaendigkeit prueft, darf nicht starten. Erst die " +
        "Pflicht-Menge aus einem Live-Beleg setzen.",
    });
  }
  const unassignable = requiredRecordTypes.filter((t) => !assignableRecordTypes.includes(t));
  if (unassignable.length > 0) {
    findings.push({
      code: COST_TRUING_BOOKING_FINDING.REQUIRED_TYPES_UNASSIGNABLE,
      fatal: true,
      message:
        `COST_TRUING_REQUIRED_RECORD_TYPES fordert ${unassignable.join(",")} - kein zuordenbarer ` +
        `Belegtyp. Zuordenbar sind exakt: ${assignableRecordTypes.join(",")}.`,
    });
  }
  if (coveragePercent < minCoveragePercent) {
    findings.push({
      code: COST_TRUING_BOOKING_FINDING.COVERAGE_BELOW_THRESHOLD,
      fatal: false,
      message:
        `Deckungsquote ${String(coveragePercent)}% liegt unter COST_TRUING_MIN_COVERAGE_PERCENT=${String(minCoveragePercent)}% ` +
        "- Korrekturbuchungen laufen auf einer duennen Datenlage.",
    });
  }
  return findings;
}

export const LATENT_COST_PATH_FINDING = Object.freeze({
  PLAY_TTS_UNPRICED: "play_tts_unpriced",
  EL_INBOUND_CARRIER_UNCOLLECTED: "el_inbound_carrier_uncollected",
});

export function latentCostPathFindings({
  playTtsEnabled,
  elInboundCarrierHasCollector,
}) {
  const findings = [];
  if (playTtsEnabled) {
    findings.push({
      code: LATENT_COST_PATH_FINDING.PLAY_TTS_UNPRICED,
      fatal: false,
      message:
        "ELEVENLABS_PLAY_TTS_ENABLED=true - die von diesem Pfad selbst synthetisierten " +
        "Zeichen erzeugen KEINEN Telnyx-Beleg und erreichen deshalb weder den Stripe-Ledger " +
        "noch die Gate-Achse (der Ist-Abgleich sieht nur, was der Provider abrechnet). " +
        "Gedeckt sind nur die ElevenLabs-Monatsgebuehr als Fixkosten-ANZEIGE " +
        "(PLATFORM_FIXED_COST_CENTS_PER_MONTH) und der Zeichenzaehler TTS_CHARACTER_QUOTA. " +
        "Handlung: ELEVENLABS_PLAY_TTS_ENABLED=false lassen, bis entschieden ist, wie diese " +
        "Monatsgebuehr auf Anrufe umgelegt wird (Preisfrage, tasks/kv-p7-tts-klaerung.md).",
    });
  }
  if (!elInboundCarrierHasCollector) {
    findings.push({
      code: LATENT_COST_PATH_FINDING.EL_INBOUND_CARRIER_UNCOLLECTED,
      fatal: true,
      message:
        "Das Kostenprofil telnyx_inbound_el_convai " +
        "fuehrt keinen Kostentraeger mit Beleg-Einsammler (src/billing/kostenarten.ts) - " +
        "jeder eingehende Anruf auf diesem Weg erzeugt Anbieterkosten (das " +
        "ElevenLabs-Gespraech UND unser Telnyx-Bein), die in keinem Buch und auf keiner " +
        "Gate-Achse landen. Handlung: erst " +
        "die Katalogzeile mit Einsammler bauen.",
    });
  }
  return findings;
}

export const EL_INBOUND_ACCESS_FINDING = Object.freeze({
  INCOMPLETE: "el_inbound_access_incomplete",
});

function zugangsMangelText(defekt) {
  return `${defekt.envKey} ${String(defekt.mangel)}`;
}

export function elInboundAccessFindings(inbound) {
  const defekte = inboundElAccessDefects(inbound);
  if (defekte.length === 0) return [];
  return [
    {
      code: EL_INBOUND_ACCESS_FINDING.INCOMPLETE,
      fatal: true,
      message:
        "Der Zugang des EL-Inbound-Wegs ist " +
        `unvollstaendig: ${defekte.map(zugangsMangelText).join(", ")}. Handlung: ` +
        "die Geheimnisse per Skript-Lauf neu setzen.",
    },
  ];
}

export const ANGEKUENDIGTER_ORIGIN_FINDING = Object.freeze({
  AUDIENCE_DIVERGENT: "angekuendigte_audience_divergent",
  PUBLIC_URL_UNPARSBAR: "public_url_unparsbar",
  PUBLIC_URL_MIT_PFAD: "public_url_mit_pfad",
  PUBLIC_URL_UNSICHER: "public_url_unsicher",
  ALLOWLIST_UNPARSBAR: "mcp_allowlist_unparsbar",
});

const MCP_AUDIENCE_PFAD = "/mcp";
const HTTPS_PROTOKOLL = "https:";
const RAND_SCHRAEGSTRICHE = /\/+$/;

export function fuerAudienceVergleich(wert) {
  return String(wert ?? "").trim().replace(RAND_SCHRAEGSTRICHE, "");
}

export function kanonischeAudience(publicUrl) {
  return `${fuerAudienceVergleich(publicUrl)}${MCP_AUDIENCE_PFAD}`;
}

function audienceFindings({ publicUrl, oauthAudience }) {
  if (!oauthAudience) return [];
  const erwartet = kanonischeAudience(publicUrl);
  if (fuerAudienceVergleich(oauthAudience) === erwartet) return [];
  return [
    {
      code: ANGEKUENDIGTER_ORIGIN_FINDING.AUDIENCE_DIVERGENT,
      fatal: true,
      message:
        `OAUTH_AUDIENCE weicht von der kanonischen MCP-Audience ab (erwartet: ${erwartet}). ` +
        "Handlung: Wert leeren (dann gilt der kanonische Default) oder exakt darauf setzen.",
    },
  ];
}

function publicUrlFindings({ publicUrl, isProduction }) {
  const wert = fuerAudienceVergleich(publicUrl);
  if (!wert) return [];
  let url;
  try {
    url = new URL(wert);
  } catch {
    return [
      {
        code: ANGEKUENDIGTER_ORIGIN_FINDING.PUBLIC_URL_UNPARSBAR,
        fatal: true,
        message:
          "PUBLIC_URL ist keine absolute URL (erwartet z.B. https://app.example.com, ohne Pfad).",
      },
    ];
  }
  const findings = [];
  if (url.pathname !== "/" || url.search || url.hash)
    findings.push({
      code: ANGEKUENDIGTER_ORIGIN_FINDING.PUBLIC_URL_MIT_PFAD,
      fatal: true,
      message:
        "PUBLIC_URL traegt Pfad, Query oder Fragment. Der angekuendigte Origin ist nur " +
        "scheme://host[:port] - alles danach entfernen.",
    });
  if (isProduction && url.protocol !== HTTPS_PROTOKOLL)
    findings.push({
      code: ANGEKUENDIGTER_ORIGIN_FINDING.PUBLIC_URL_UNSICHER,
      fatal: true,
      message: "PUBLIC_URL ist im Hosting nicht https (gleiche Linie wie isInsecureHttpIssuer).",
    });
  return findings;
}

function allowlistFindings(allowedOrigins) {
  return allowedOrigins
    .map((eintrag, index) => ({ eintrag, position: index + 1 }))
    .filter(({ eintrag }) => !normalisierterOrigin(eintrag))
    .map(({ position }) => ({
      code: ANGEKUENDIGTER_ORIGIN_FINDING.ALLOWLIST_UNPARSBAR,
      fatal: true,
      message:
        `MCP_ALLOWED_ORIGINS: Eintrag ${String(position)} ist kein absoluter http(s)-Origin ` +
        "(erwartet z.B. https://chatgpt.com, ohne Pfad). Der Wert wird bewusst nicht geloggt.",
    }));
}

export function angekuendigterOriginFindings({
  publicUrl,
  oauthAudience,
  allowedOrigins = [],
  isProduction = false,
} = {}) {
  return [
    ...audienceFindings({ publicUrl, oauthAudience }),
    ...publicUrlFindings({ publicUrl, isProduction }),
    ...allowlistFindings(allowedOrigins),
  ];
}
