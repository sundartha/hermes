// Datenkonstanten des Store-Blatt-Moduls (Format-/Provider-Wahrheit, kein IO, keine
// config) - die einzige Abhaengigkeit dieser Datei. Genutzt von bootstrapHealDecision.
import {
  E164,
  PROVIDER,
  RESERVE_LEAD_MINUTES,
  normNum,
  outboundReserveCents,
  PLATFORM_NUMBER_PURPOSE,
} from "./store/defaults.js";
import { STT_PROFILE, isSttProfile } from "./telephony/stt-profile.js";
import { usableFallbackProvider } from "./llm/provider.js";
// IEL-B1: die EINE Definition von "Zugang des EL-Inbound-Wegs vollstaendig" (rein, config-frei).
import { inboundElAccessDefects } from "./elevenlabs/inbound-path-decision.js";
import { DEFAULT_INBOUND_EL_SCOPE, INBOUND_EL_SCOPE, isInboundElScope } from "./elevenlabs/inbound-scope.js";
import { normalisierterOrigin } from "./middleware.js";

// Boot-Entkopplung (OT-1, AC5). Fuehrt einen Boot-Teilschritt aus und kappt seinen
// Blast-Radius: faengt jeden Fehler, loggt ihn laut + secret-frei (nur err.message)
// und laeuft weiter (kein throw). Damit killt ein Portal-Pool-Fehler (DB unerreichbar
// fuer das Web-Login ODER Superuser-Rolle/F5) nicht mehr den ganzen Prozess inkl.
// Telefonie - nur die Web-Login/Portal-Routen entfallen (existieren nicht -> 404).
// Bewusst eigene, testbare Einheit (DIP) statt inline-try/catch.
//
// Liefert true, wenn der Teilschritt durchlief (gemountet), sonst false (uebersprungen).
export async function guardedBoot(label, fn) {
  try {
    await fn();
    return true;
  } catch (e) {
    // secret-frei: NUR die Fehler-Message, nie config/Connection-String/Env.
    console.error(
      `[boot] ${label} deaktiviert (Portal-Pool-Fehler):`,
      e && e.message ? e.message : String(e),
    );
    return false;
  }
}

// GAP-38: darf der Boot einen leeren Store aus den Deploy-Parametern heilen?
// Vier sich ausschliessende Ausgaenge (die Reihenfolge ist die Spezifikation). Reine
// Entscheidung (arg-injiziert, config-/IO-frei, testbar; Muster spendCapCoherence);
// importiert nur Datenkonstanten aus dem Blatt-Modul store/defaults.js.
export const BOOTSTRAP_HEAL = Object.freeze({
  NOT_NEEDED: "not_needed", // aktive Nummer da -> nichts tun
  HEAL: "heal", // frischer Store + brauchbare Parameter
  BLOCKED_STORE_NOT_FRESH: "blocked_store_not_fresh", // gelebter Store -> NIE heilen
  BLOCKED_PARAMS: "blocked_params", // ohne/mit unbrauchbaren Parametern
});

// "Nachweislich frisch" heisst: KEINE Nummer (in keinem Zustand), KEIN Tenant ausser dem
// Code-Default-Bootstrap-Tenant (makeDefaultState legt ihn IMMER an - seine Existenz
// beweist also nichts) und KEINE Call-Historie. Jede weitere Zeile heisst "der Store hat
// gelebt": dann wird NICHT geheilt, sondern der bestehende fail-closed Refusal greift
// (Pre-Mortem: Nummern-Proliferation).
//
// Die E.164-Pruefung ist Pflicht und kein Stil: seedBootstrapNumber normalisiert nur, es
// validiert NICHT - ein Tippfehler in BOOTSTRAP_E164 wuerde sonst als "aktive Nummer"
// geseedet und der Boot liefe gruen mit totem Routing (Lehre seedOwnerNumberFromEnv).
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

// Boot-Haertung (OUT-05, F2): FAKE_ORIGINATE ersetzt den Provider-Transport durch einen
// Test-Fake (kein echter Dial) und DARF nur greifen, wo die Signaturpruefung ohnehin
// geskippt ist (beweisbar nicht-produktiv). In Prod ist die Signaturpruefung fail-closed AN
// (Regel 1) -> ein versehentliches FAKE_ORIGINATE=true fuehrt zum Boot-Refusal statt zu
// stillem Nicht-Waehlen. Reine Entscheidung (arg-injiziert, config-frei, testbar):
// true = Start verweigern. Praezedenz: SKIP_TWILIO_SIGNATURE_CHECK (die Test-Suite nutzt es
// prozessweit).
export function fakeOriginateBootBlocked({ fakeOriginate, skipTwilioSignatureCheck }) {
  return fakeOriginate === true && skipTwilioSignatureCheck !== true;
}

// STT-A1: ungueltiges STT_PROFILE bricht den Boot ab. PFLICHT, nicht Kuer: ohne diese
// Pruefung traefe ein Tippfehler in der Hosting-Umgebung erst den fail-closed Wurf IM
// RENDER-PFAD des laufenden Anrufs - jeder Anruf staerbe am Greeting, und zwar erst nach
// dem Deploy. Solange der Wert im Code stand, war das unmoeglich; die Env-Variable darf
// das Risiko nicht neu einfuehren. Der Wert ist ein Enum-Name, kein Secret -> er darf in
// die Diagnose (Regel 4 unberuehrt). Reine Entscheidung (arg-injiziert, config-frei,
// testbar; Findings-Form wie providerRateOutOfBand): leere Liste = gueltig.
export function sttProfileFindings(sttProfile) {
  if (isSttProfile(sttProfile)) return [];
  return [
    {
      message:
        `STT_PROFILE='${sttProfile}' ist unbekannt. Gueltig: ` +
        `${Object.values(STT_PROFILE).join("|")}.`,
      fatal: true,
    },
  ];
}

export const LLM_FALLBACK_FINDING = Object.freeze({ SAME_AS_PRIMARY: "llm_fallback_same_as_primary" });

// FW2: gesetzt, aber wirkungslos. WARN, kein exit(1) - der Fehlausgang ist der
// Bestandszustand (kein Ausweichen), ein Boot-Refusal tauschte einen Tippfehler gegen
// einen Telefonie-Totalausfall (Praezedenz warnTariffDrift/warnNumberOriginDecoupled).
// Rein, arg-injiziert, config-frei (Muster driftConfigFindings).
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

// S1-7: Vollstaendigkeit der Stripe-Meter-Abbildung. JEDE usage_event-Sorte MUSS ein
// event_name haben; fehlt eins, wirft reportMeter zur Laufzeit 'unbekanntes kind', flushMeters
// zaehlt failed++ OHNE das Event sent zu markieren -> Endlos-Retry, Umsatz nie gemeldet.
// Reine Entscheidung (arg-injiziert, config-frei, testbar; Muster fakeOriginateBootBlocked):
// liefert die Sorten OHNE Mapping (leer = vollstaendig).
export function meterMappingGaps(usageEventKinds, meterEventNames) {
  return usageEventKinds.filter((kind) => !meterEventNames[kind]);
}

// P3: Sekunden->Minuten-Bruecke (G25: benannte Konstante statt nackter 60). Zeit-Einheit,
// kein Betriebsparameter -> gehoert NICHT nach config.js (G35 n.z.). Muster: MS_PER_MINUTE
// in src/billing/metering.js, MS_PER_DAY in src/config.js.
const SECONDS_PER_MINUTE = 60;

// P3: Befund-Codes des Kohaerenz-Guards (G25/G11: EINE Quelle statt Roh-Strings in Guard,
// Verdrahtung und Test).
export const SPEND_CAP_FINDING = Object.freeze({
  TENANT_DEFAULT_UNSET: "tenant_default_unset", // Klausel A0 - WARN
  WORST_CASE_UNAFFORDABLE: "worst_case_unaffordable", // Klausel B - FATAL
});

// P3: laengste Gespraechsdauer, die unter der Tenant-Decke zum Worst-Case-Tarif noch
// bezahlbar ist. Division sicher: der Aufrufer ruft NUR, wenn
// maxTariffCents * n > tenantDefaultCents > 0 gilt - das erzwingt maxTariffCents > 0
// (kein Division-durch-0).
function affordableCallDurationS(tenantDefaultCents, maxTariffCents) {
  return Math.floor(tenantDefaultCents / maxTariffCents) * SECONDS_PER_MINUTE;
}

// P3 (Boot-Guards Konfig-Kohaerenz): prueft die Budget-Achsen GEGENEINANDER, nicht nur
// jede einzeln. Zwei sich ausschliessende Klauseln (Reihenfolge ist die Spezifikation):
//
// A0 (WARN): tenantDefaultCents === 0 ist der dokumentierte Sentinel "kein Tenant-
//   Default" (src/config.js, min:0) - jeder Tenant ohne eigene tenant_budget-Zeile
//   faellt auf den Pro-Tenant-Fallback zurueck (effectiveCapCents Stufe 3). Kein
//   Schutzverlust, nur Hinweis.
// B (FATAL, GAP-32): selbst wenn die Tenant-Decke wirkt, reicht sie fuer den TEURSTEN
//   Zielverkehr (maxTariffCents) ueber das feste VORLAUFFENSTER der Reserve
//   (RESERVE_LEAD_MINUTES) nicht aus - jedes Ziel
//   ohne gemessenen Inlandssatz scheitert am Reserve-Gate, bevor die Tenant-Decke erreicht
//   ist. Seit KS-P3 (a) haengt die Reserve NICHT mehr an der Gespraechsdauer: die waechst
//   mit dem Guthaben, das Vorlauffenster nicht - deshalb kann eine Anhebung der Zeitgrenze
//   diesen Guard nicht mehr ausloesen.
//   Bis P7 war das eine blosse WARN: die Zeile stand seit dem ersten Deploy folgenlos
//   im Log, waehrend der Dienst fuer genau diese Ziele faktisch abgeschaltet war. Eine
//   Konfiguration, unter der ein ganzer Zielbereich vor dem Dial abgewiesen wird, ist kein
//   Betriebszustand - der Start wird verweigert und die Meldung nennt den Zielwert.
//
// KS-P9/E10: die frueher hier stehende Klausel A (tenantDefaultCents >= platformCapCents
// -> FATAL "Tenant-Achse inert") ist ERSATZLOS entfallen. Sie hielt die Tenant-Decke gegen
// die Plattform-Zahl, weil der Plattform-Cap zuerst band - ohne Sperrwirkung ist die
// Aussage schlicht falsch. Nicht auf WARN abgesenkt, sondern geloescht.
//
// Der A0-Early-Return macht "tenantDefaultCents > 0" fuer Klausel B strukturell wahr
// (G27: Struktur statt Konvention) - diese Aussage traegt jetzt ALLEIN die
// Divisionssicherheit von affordableCallDurationS.
// Es entsteht hoechstens EIN Befund (die Klauseln schliessen sich aus); Array-Form
// haelt die Verdrahtung trotzdem uniform (Muster meterMappingGaps: leer = in Ordnung).
//
// Voraussetzung: laeuft NACH assertConfig() - nicht-numerische Werte sind dort bereits
// fail-closed abgefangen (numEnv). Kein eigener NaN-Riegel (kein zweites
// Gueltigkeitsidiom, G5/D7-Klasse).
export function spendCapCoherence({ tenantDefaultCents, platformCapCents, maxTariffCents }) {
  if (tenantDefaultCents === 0) {
    return [
      {
        code: SPEND_CAP_FINDING.TENANT_DEFAULT_UNSET,
        fatal: false,
        message:
          `DEFAULT_TENANT_BUDGET_CENTS=0 (Sentinel: kein Tenant-Default) - jeder Tenant ` +
          `ohne eigene tenant_budget-Zeile faellt auf MAX_BUDGET_EUR*100=${platformCapCents} ` +
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
          `Worst-Case-Reserve ${reserveCents} Cent (VOICE_TARIFF_DEFAULT_CENTS=${maxTariffCents} ` +
          `* ${RESERVE_LEAD_MINUTES} Vorlauf-Minuten) uebersteigt die Tenant-Decke DEFAULT_TENANT_BUDGET_CENTS=${tenantDefaultCents} ` +
          `- der teuerste Zielverkehr traegt unter dieser Decke nur noch ${maxDurationS}s Gespraech. ` +
          `Abhilfe: DEFAULT_TENANT_BUDGET_CENTS auf mindestens ${reserveCents} anheben.`,
      },
    ];
  }
  return [];
}

// P3 (Boot-Guards Modellpreise): Modelle OHNE Eintrag in der Preistabelle (leer = alles
// bepreist). Reine Funktion (Muster meterMappingGaps). Seit B4a ist der Befund FATAL
// (assertPricedModels, boot.js) - die Funktion selbst bleibt eine reine Praedikat-Funktion
// und entscheidet die Schwere nicht.
//
// Object.hasOwn statt modelPricesUsd[id] ist PFLICHT, kein Stil: in Produktion ist
// modelPricesUsd ein guardedConfig-PROXY, dessen get-Trap bei einem unbekannten
// Schluessel TypeError wirft (src/config.js). Ein Roh-Index wuerde ausgerechnet DIESEN
// Boot-Guard zum Boot-Killer machen. Object.hasOwn laeuft ueber [[GetOwnProperty]] -
// kein Trap definiert, damit ungefiltert ans Target durch. Praezedenz: priceForModel
// in src/store/state-ops.js nutzt dasselbe Muster fuer denselben Proxy.
export function unpricedModels(modelIds, modelPricesUsd) {
  return modelIds.filter((id) => !Object.hasOwn(modelPricesUsd, id));
}

// GP-P6 (a): Katalog-Slugs OHNE konfigurierte Stripe-Price-Id. Reines Praedikat wie
// unpricedModels - es entscheidet die Schwere NICHT (das tut assertPricedPlans in
// boot.js). priceIdOf wird INJIZIERT statt hier importiert: der Guard bleibt damit frei
// von config/subscribe und ohne Umgebung testbar (Muster unpricedModels(ids, tabelle)).
export function unpricedPlanSlugs(slugs, priceIdOf) {
  return slugs.filter((slug) => !priceIdOf(slug));
}

// B4a: Veralterung der Preisliste sichtbar machen. asOf ist unser Abrufdatum; wird es alt,
// ist die Tabelle eine ANNAHME ohne Beleg. WARN, NIE fatal - ein Kalendertag darf die
// Telefonie nicht lahmlegen. Ein Quartal ist derselbe Takt, in dem usdToEur laut
// src/config.js ohnehin von Hand gepflegt wird; bewusst KEINE Env-Var (Praezedenz
// researchMaxUses: eine Stellschraube, die niemand betrieblich dreht, zoege .env.example,
// render.yaml und BASE_ENV nach). Reine Funktion (Muster alertChannelFindings).
export const MODEL_PRICE_MAX_AGE_DAYS = 90;
const MS_PER_DAY = 86_400_000;

export function stalePriceFindings(modelPricesUsd, todayIso) {
  return Object.entries(modelPricesUsd)
    .filter(([, price]) => (Date.parse(todayIso) - Date.parse(price.asOf)) / MS_PER_DAY > MODEL_PRICE_MAX_AGE_DAYS)
    .map(([modelId, price]) => ({
      fatal: false,
      message:
        `Preisstaffel '${modelId}' wurde am ${price.asOf} abgerufen (aelter als ` +
        `${MODEL_PRICE_MAX_AGE_DAYS} Tage) - Raten gegen ${price.source} pruefen.`,
    }));
}

// LCT P4b: Vollkosten-Boot-Guard (WARN). Sichert die spaetere Owner-Tarifsenkung ab.
// Seit KV2-10 feuert er auf belowFloor ALLEIN (deckungs-unabhaengig, Kriterium (c)): bis
// KV2-9 stand hier die KONJUNKTION aus Unterschreitung UND duenner Abgleich-Deckung - das
// Ziel der ganzen Kette ist es aber, die Deckung UEBER die Schwelle zu heben, und in dem
// Moment haette der Boden-Waechter verstummt, auch bei einem Tarif unter Vollkosten. Eine
// Sicherung, die die eigene Kette abschaltet, ist keine (angriff-kritiker.md K6). Die
// Deckung bleibt als Kontext in der Nachricht stehen, ist aber NIE Ausloeser.
// WARN, kein exit(1) (Praezedenz warnUnpricedModels/warnAlertChannelUnset): ein
// Boot-Refusal tauschte ein Kostenproblem gegen einen Telefonie-Totalausfall. Dies ist
// eine Diagnose, kein Geld-Gate (Regel 1 bleibt unberuehrt).
//
// coveragePercent/minCoveragePercent werden HEREINGEREICHT, nicht hier gerechnet: die eine
// Quelle ist costTruingCoveragePercent(store) aus P3 (G5). Nenner 0 liefert dort bereits
// 0% (kein Freispruch) - ein leerer Spiegel bei gesenktem Tarif ist damit WARN, nicht
// Schweigen. KEINE Literale im Rumpf - beide Schwellen kommen als benannte Argumente herein.
export const VOICE_TARIFF_FLOOR_FINDING = Object.freeze({
  BELOW_FULL_COST: "voice_tariff_below_full_cost", // WARN
});

export function voiceTariffFloorFindings({ domesticTariffCents, fullCostFloorCents, coveragePercent, minCoveragePercent }) {
  const belowFloor = domesticTariffCents < fullCostFloorCents;
  if (!belowFloor) return [];
  return [
    {
      code: VOICE_TARIFF_FLOOR_FINDING.BELOW_FULL_COST,
      fatal: false,
      message:
        `VOICE_TARIFF_DOMESTIC_CENTS=${domesticTariffCents} liegt unter der Vollkostenschwelle ` +
        `VOICE_TARIFF_FULL_COST_FLOOR_CENTS=${fullCostFloorCents} (Abgleich-Deckung ${coveragePercent}%, ` +
        `COST_TRUING_MIN_COVERAGE_PERCENT=${minCoveragePercent}% - Kontext, seit KV2-10 kein ` +
        "Ausloeser mehr) - der gesenkte Tarif ist der Buchungswert jedes nicht abgeglichenen Calls " +
        "und wird von der Messung nicht gedeckt.",
    },
  ];
}

// LCT P2 (Kurs-Guard): der Umrechnungskurs Provider-Waehrung -> Ziel-Bucket gegen ein
// Toleranzband um einen im CODE gepinnten Anker. Anker und Bandgrenzen sind BENANNTE
// Konstanten, keine Literale im Rumpf (G25).
//
// PROVIDER_RATE_ANCHOR_MICRO traegt bewusst denselben ZAHLENWERT wie der ENV-Default in
// config.js, ist aber eine EIGENE Konstante und referenziert ihn NICHT: zoege eine
// Default-Aenderung den Anker still mit, pruefte das Band gegen sich selbst und waere ab
// diesem Moment strukturell tot.
const PROVIDER_RATE_ANCHOR_MICRO = 920000;
const PROVIDER_RATE_BAND_MIN_FACTOR = 0.5;
const PROVIDER_RATE_BAND_MAX_FACTOR = 2.0;

export const PROVIDER_RATE_FINDING = Object.freeze({
  OUT_OF_BAND: "provider_rate_out_of_band",
});

// Reine Entscheidung (arg-injiziert, config-frei, testbar; Muster meterMappingGaps/
// spendCapCoherence): leer = im Band. Hoechstens EIN Befund.
//
// fatal:true seit LCT P4: ab der Korrekturbuchung bewegt der Kurs Geld. Waere er um
// Zehnerpotenzen zu klein, laege das Ist fuer JEDEN Call bei ~1 % der Schaetzung, bei
// formal vollstaendiger Datenlage - die faktische Vollrueckerstattung jeder Schaetzung,
// die das Vollstaendigkeits-Praedikat NICHT faengt (die Records sind ja da).
//
// WEITERHIN OHNE JEDE FLAG-BEDINGUNG. Eine an die Aktivierung der Korrekturbuchung
// gekoppelte Sicherung waere entweder weg oder als undefined falsy - lautlos tot genau
// dann, wenn die Buchung Geld bewegt. Der Kurs-Guard prueft deshalb unkonditional.
//
// Voraussetzung: laeuft NACH assertConfig() - nicht-numerische Werte und die 0 sind dort
// bereits fail-closed abgefangen (numEnv, min 1). Kein zweites Gueltigkeitsidiom hier (G5).
export function providerRateOutOfBand(rateMicro) {
  const minMicro = Math.round(PROVIDER_RATE_ANCHOR_MICRO * PROVIDER_RATE_BAND_MIN_FACTOR);
  const maxMicro = Math.round(PROVIDER_RATE_ANCHOR_MICRO * PROVIDER_RATE_BAND_MAX_FACTOR);
  if (rateMicro >= minMicro && rateMicro <= maxMicro) return [];
  return [
    {
      code: PROVIDER_RATE_FINDING.OUT_OF_BAND,
      fatal: true,
      message:
        `PROVIDER_TO_BUCKET_RATE_MICRO=${rateMicro} liegt ausserhalb des Toleranzbandes ` +
        `${minMicro}..${maxMicro} (Anker ${PROVIDER_RATE_ANCHOR_MICRO} = 0,92 je Einheit). ` +
        "Haeufigste Ursache: Zehnerpotenz-Vertipper (920 statt 920000). Der Kurs bewegt " +
        "seit der Korrekturbuchung Geld - der Start wird verweigert.",
    },
  ];
}

// LCT P6: Befund-Codes der Tenant-Kostendecke-aus-Plan-Ableitung (kein Magic-String im
// Guard/in der Verdrahtung, G25/G11).
export const PLAN_CAP_FINDING = Object.freeze({
  PLAN_CAP_UNDERIVABLE: "plan_cap_underivable", // FATAL (Katalog-Slug ohne ableitbare Decke)
  PLAN_CAP_WORST_CASE_UNAFFORDABLE: "plan_cap_worst_case_unaffordable", // FATAL (Reserve > kleinste Plan-Decke)
});

// KS-P3a: EINE Stelle, an der capForSlug gerufen und sein Wurf gefangen wird - beide
// Plan-Decken-Guards bauen darauf auf und werfen dadurch selbst NIE (Begruendung, warum ein
// Wurf hier zu einem LAUTLOSEN exit(0) fuehrte, s. planCapUnderivableFindings unten).
// Liefert die ableitbaren Decken UND die Slugs, die keine haben - wer welche davon braucht,
// entscheidet der jeweilige Guard.
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

// LCT P6 (FATAL): laesst sich fuer JEDEN Katalog-Slug ueberhaupt eine Kostendecke
// ableiten? Greift OHNE jede tenant_budget-Zeile (frischer Deploy, erster Kunde noch nicht
// da) - verhindert, dass eine inkohaerente Konfiguration ueberhaupt in den Betrieb kommt.
// capForSlug wird HEREINGEREICHT (Muster: reine Entscheidung, config-frei/testbar, wie
// spendCapCoherence); der Aufrufer baut es aus planCapCents + config.billing.
//
// KS-P9/E10: der frueher hier stehende INERT-Zweig (abgeleitete Plan-Decke >= Plattform-Cap
// -> FATAL) ist ERSATZLOS entfallen - er hielt die Plan-Decke gegen die Plattform-Zahl,
// weil der Plattform-Cap zuerst band. Der Name sagt jetzt, was uebrig ist (N1/G20).
//
// S1-2 (Vertrags-Parity): capForSlug (planCapCents) WIRFT bei einem Katalog-Slug OHNE
// Kopffreiheit-Eintrag (CATALOG_SLUGS und PLAN_CAP_HEADROOM auseinandergelaufen). Diese
// Funktion faengt den Wurf und liefert stattdessen ein fatal:true-Finding - wie jede andere
// Finding-Funktion in dieser Datei gibt sie damit hoechstens ein Array zurueck, wirft NIE.
// Ohne das Fangen liefe der Wurf uncaught durch assertSpendCapCoherence -> assertBootGates ->
// bootServer bis zum top-level await ohne try/catch; das globale uncaughtException-Netz
// (process-guards, AC4 "weiterlaufen") faengt ihn und der Prozess endet LAUTLOS mit exit(0) -
// ausgerechnet dieser fatale Guard versagte still, statt laut abzulehnen (exit(1)).
export function planCapUnderivableFindings({ slugs, capForSlug }) {
  const { underivableSlugs } = derivePlanCaps({ slugs, capForSlug });
  if (!underivableSlugs.length) return [];
  return [
    {
      code: PLAN_CAP_FINDING.PLAN_CAP_UNDERIVABLE,
      fatal: true,
      message:
        `Katalog-Slug(s) ${underivableSlugs.join(",")} haben KEINE ableitbare Kostendecke ` +
        "(fehlender Kopffreiheit-Eintrag in PLAN_CAP_HEADROOM, src/billing/plan-caps.js) - " +
        "CATALOG_SLUGS und PLAN_CAP_HEADROOM sind auseinandergelaufen. Kopffreiheit ergaenzen.",
    },
  ];
}

// KS-P3a (FATAL): traegt die KLEINSTE Plan-Decke die Worst-Case-Reserve EINES Anrufs?
// Dieselbe Klausel-B-Logik wie spendCapCoherence, nur gegen MIN(planCapCents(slug)) ueber
// alle Katalog-Slugs statt gegen DEFAULT_TENANT_BUDGET_CENTS. Der Default deckt einen
// zahlenden Tenant NICHT ab: effectiveCapCents bevorzugt die aus dem Plan abgeleitete
// tenant_budget-Zeile, der Boot sah diese Decken bisher nie gegen die Reserve.
//
// Seit KS-P5a rechnen Decke und Reserve mit DEMSELBEN Satz - er kuerzt sich aus der
// Ungleichung heraus. Seit KS-P3 (a) faellt zusaetzlich die Gespraechsdauer heraus: die
// Reserve deckt nur noch ein festes Vorlauffenster. Geprueft wird damit
// RESERVE_LEAD_MINUTES > includedMinutes * num/den - Katalog-Kopffreiheit gegen ein festes
// Vorlauffenster, unabhaengig davon, wie lange ein Gespraech dauern darf.
//
// Wirft NIE: capForSlug laeuft ueber derivePlanCaps (Wurf-Fang, s.o.). Ein Slug ohne
// ableitbare Decke ist der Fall von planCapUnderivableFindings (FATAL) und wird hier
// uebersprungen - zwei Zeilen zur selben Sache sind keine zweite Sicherung.
// Hoechstens EIN Befund (Muster spendCapCoherence).
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
        `Worst-Case-Reserve ${reserveCents} Cent (VOICE_TARIFF_DEFAULT_CENTS=${maxTariffCents} ` +
        `* ${RESERVE_LEAD_MINUTES} Vorlauf-Minuten) uebersteigt die kleinste Plan-Decke ` +
        `(${smallestCap.slug}=${smallestCap.capCents} Cent) - ein Tenant mit diesem Plan faellt ` +
        "schon beim ERSTEN Anruf ins Reserve-Gate (402). Der Tarif ist KEIN Hebel: Decke und " +
        "Reserve skalieren beide mit ihm. Abhilfe: inkludierte Minuten/Kopffreiheit des Plans " +
        "anheben (src/plans.js, src/billing/plan-caps.js).",
    },
  ];
}

// LCT P5 / GAP-07: der Alarmkanal selbst. Ein Alarm ohne Empfaenger ist kein Alarm - und
// diese Vorbedingung stand bisher nur im Planungsdokument, haftete also an der Disziplin
// dessen, der die Phase umsetzt.
export const ALERT_CHANNEL_FINDING = Object.freeze({
  UNSET: "platform_alert_sms_unset", // WARN
  UNSET_WITH_ACTIVE_WARNING: "platform_alert_sms_unset_with_active_warning", // FATAL
  // OUTBOUND-E3b (PM-16): "nicht konfiguriert" darf nie wie "alles gruen" aussehen -
  // fehlen BEIDE Betreiber-Kanaele (SMS UND Mail), waehrend Outbound scharf ist UND der
  // Ausfall-Melder selbst scharf ist (windowMs>0), haette der Melder KEINEN Empfaenger.
  BOTH_UNSET_WITH_OUTBOUND: "platform_alert_channels_unset_with_outbound", // FATAL
});

// GAP-07: eine SCHARFE Spend-Warnung ohne Empfaenger ist keine Sicherung, sondern
// eine Sicherung, die niemand hoert - bei aktiver Buchung (paymentEnabled) UND
// gesetzter Warnschwelle (>0) UND leerem Kanal bricht der Boot ab (assertConfig).
// Ohne Buchung oder mit abgeschalteter Warnschwelle (0) bleibt es bei der
// bestehenden WARN: ein Dienst ohne scharfe Warnung bootet weiter - ein fehlender
// Alarmkanal macht ihn dann nicht unsicherer, nur blind, und das ist kein Grund, die
// Telefonie auf einem Free Tier abzuschalten.
// Liefert IMMER hoechstens EINEN Befund - der Boot loggt nie zwei Zeilen zur selben
// Sache. Der besetzte Kanal liefert [] -> die Nummer wird NIE geloggt (Regel 4/PII).
// Arg-injiziert (config-frei) wie fakeOriginateBootBlocked; die Aufrufer reichen
// config.billing herein (plus platformAlertMailTo aus config.mail und
// elevenLabsOutboundEnabled aus config.voice.elevenLabsOutbound - OUTBOUND-E3b).
//
// OUTBOUND-E3b: die BOTH_UNSET_WITH_OUTBOUND-Pruefung steht bewusst VOR der
// bestehenden Spend-Warnung-Pruefung darunter - ein voelliges Fehlen JEDES
// Betreiber-Kanals waehrend der Ausfall-Melder SCHARF ist (windowMs>0) und Outbound
// laeuft, ist der dringlichere Befund. Beide bestehenden Zweige (UNSET/
// UNSET_WITH_ACTIVE_WARNING) bleiben byte-identisch: die neuen Parameter sind bei
// bestehenden Aufrufern (die sie nicht reichen) undefined -> falsy -> der neue Zweig
// greift dort nie.
// G5-Fix (Review-Blocker Runde 2): die Zusammenfuehrung der DREI Config-Namespaces
// (billing/mail/voice) zu EINEM alertChannelFindings-Eingabeobjekt lag byte-identisch an
// ZWEI Stellen (boot.js#warnAlertChannelUnset fuer die WARN-Zeile, config.js#
// fatalConfigFindings fuer den Boot-Refusal) - wer eine vierte Eingabe ergaenzt und nur
// eine Stelle nachzieht, liesse Boot-Log und Boot-Refusal auseinanderlaufen, ohne dass ein
// Test das faengt. EINE exportierte Funktion, config-frei/arg-injiziert wie der Rest
// dieser Datei - beide Aufrufer reichen nur noch ihre drei Namespaces durch.
// G26/G2-Fix (Review-Blocker Runde 4): OB der Mail-Kanal als Betreiber-Kanal ZAEHLT,
// haengt an ZWEI Dingen - einer gesetzten Zieladresse UND einem tatsaechlich
// KONSTRUIERBAREN Mailer (selectMailer, wiring/web-login.js, liefert sonst null und
// sendMailChannel/outage-report.js riefe mailer.sendMail() auf null auf). Die
// Auswahlregel selbst ("Brevo-Schluessel ODER SMTP-Host") wird HIER als EINE Quelle
// formuliert (kein zweites G5): selectMailer importiert dieses Praedikat statt die
// Bedingung erneut zu schreiben. boot-guard.js bleibt dabei config-frei (Modulkopf) -
// die Funktion nimmt nur den mail-Namespace als Argument.
export function mailerKonstruierbar({ brevoApiKey, smtpHost } = {}) {
  return Boolean(brevoApiKey || smtpHost);
}

// KV2-1: WELCHE Betreiber-Kanaele tatsaechlich einsatzbereit sind. EINE Quelle (G5) fuer
// zwei Leser: den Boot-Befund unten UND die Sweep-Zeile des Kostenpfads
// (billing/cost-truing.js#logSweepLine, Feld kanaele=). Mail zaehlt nur mit Adresse UND
// konstruierbarem Mailer - dieselbe Bedingung, die alertChannelFindings anlegt (G26/G2),
// hier NICHT ein zweites Mal formuliert, sondern ueber mailerKonstruierbar gelesen.
// Arg-injiziert wie der Rest dieser Datei; die Aufrufer reichen ihre zwei Namespaces
// herein (Muster alertChannelInputs).
export const ALARM_KANAL = Object.freeze({ MAIL: "mail", SMS: "sms", KEINE: "keine" });

export function betreiberAlarmKanaele({ billing, mail }) {
  const kanaele = [];
  if (mail.platformAlertMailTo && mailerKonstruierbar(mail)) kanaele.push(ALARM_KANAL.MAIL);
  if (billing.platformAlertSmsTo) kanaele.push(ALARM_KANAL.SMS);
  return kanaele;
}

// Ihre Schreibweise in Log/Audit. Die leere Menge heisst ausdruecklich "keine" und NICHT
// "" - ein leeres Feld ist in einer Log-Zeile von einem FEHLENDEN Feld nicht zu
// unterscheiden, und genau diese Verwechslung ist der Zustand, den KV2-1 beendet.
// Die ZIELE selbst (Adresse/Nummer) stehen hier NIE - nur die Kanal-Arten.
export function alarmKanalZeile(kanaele) {
  return kanaele.length > 0 ? kanaele.join(",") : ALARM_KANAL.KEINE;
}

// KV2-1 (Plan 4.9, Kriterium (d)): der Kostenpfad meldet ab dieser Phase ueber denselben
// Betreiber-Meldeweg wie der Ausfall-Melder - haengt aber an KEINEM Schalter: der
// Kosten-Sweep laeuft unkonditional (LCT P8). Ein fehlendes Alarm-Ziel ist hier deshalb
// IMMER ein Befund, unabhaengig von ELEVENLABS_OUTBOUND_ENABLED und OUTAGE_ALERT_WINDOW_MS
// (die zusammen den fatalen BOTH_UNSET_WITH_OUTBOUND-Riegel oben gaten - der deckt diesen
// Fall also NICHT ab).
// WARN, NICHT fatal: ein Boot-Refusal tauschte ein Beobachtungsproblem gegen einen
// Telefonie-Totalausfall (Praezedenz COVERAGE_BELOW_THRESHOLD, s. dort). Die Sichtbarkeit
// kommt stattdessen aus dem DURABLEN Eintrag, den der Aufrufer schreibt (boot.js) - ein
// Boot-WARN im Log eines Free-Tier-Dynos ist genau die Spur, deren Wertlosigkeit diese
// Phase belegt hat (AUFTRAG B3).
export const KOSTEN_ALARM_FINDING = Object.freeze({
  NO_TARGET: "kosten_alarm_ohne_ziel", // WARN
});

export function kostenAlarmFindings({ billing, mail }) {
  if (betreiberAlarmKanaele({ billing, mail }).length > 0) return [];
  return [{
    code: KOSTEN_ALARM_FINDING.NO_TARGET,
    fatal: false,
    // Bewusst NICHT das Wort "Deckungsquote" (unscoped /Deckungsquote/-Assertion in
    // test/cost-truing-booking-guard.test.js (p2) prueft die ANDERE, bereits bestehende
    // Boot-Warnung costTruingBookingFindings - eine zweite Fundstelle desselben Worts
    // liesse diesen Test bei 100% Deckung faelschlich rot laufen, obwohl das Verhalten
    // korrekt ist).
    message:
      "Weder PLATFORM_ALERT_MAIL_TO (mit BREVO_API_KEY oder SMTP_HOST) noch " +
      "PLATFORM_ALERT_SMS_TO ist gesetzt - jeder Kosten-Befund (zu geringer Beleg-Anteil, " +
      "Belegausfall) landet ausschliesslich im Log und in audit_log, es sieht ihn " +
      "niemand. Mindestens einen vollstaendigen Kanal setzen.",
  }];
}

export function alertChannelInputs({ billing, mail, voice }) {
  return {
    ...billing,
    platformAlertMailTo: mail.platformAlertMailTo,
    mailerVorhanden: mailerKonstruierbar(mail),
    elevenLabsOutboundEnabled: voice.elevenLabsOutbound.enabled,
  };
}

export function alertChannelFindings({
  platformAlertSmsTo,
  paymentEnabled,
  platformSpendWarnPercent,
  platformAlertMailTo,
  mailerVorhanden,
  elevenLabsOutboundEnabled,
  outageAlertWindowMs,
} = {}) {
  if (platformAlertSmsTo) return [];
  // G26-Fix: Mail zaehlt als Kanal nur, wenn ZUSAETZLICH zur Adresse auch ein Mailer
  // konstruierbar ist (mailerVorhanden, s. mailerKonstruierbar oben) - eine gesetzte
  // Adresse OHNE Backend (kein BREVO_API_KEY, kein SMTP_HOST) waere sonst ein Kanal, der
  // beim ersten Versand mit "Cannot read properties of null" scheitert, waehrend der Boot
  // gruen bootet (PM-16-Verletzung).
  if (!(platformAlertMailTo && mailerVorhanden) && elevenLabsOutboundEnabled && outageAlertWindowMs > 0)
    return [
      {
        code: ALERT_CHANNEL_FINDING.BOTH_UNSET_WITH_OUTBOUND,
        fatal: true,
        message:
          "PLATFORM_ALERT_SMS_TO ist leer UND der Mail-Kanal ist nicht einsatzbereit " +
          "(PLATFORM_ALERT_MAIL_TO leer ODER kein Mailer konfiguriert - weder " +
          "BREVO_API_KEY noch SMTP_HOST), obwohl ELEVENLABS_OUTBOUND_ENABLED=true und " +
          "OUTAGE_ALERT_WINDOW_MS>0 - der systematische-Ausfall-Melder haette KEINEN " +
          "Betreiber-Kanal. Mindestens einen vollstaendigen Kanal setzen ODER " +
          "ELEVENLABS_OUTBOUND_ENABLED=false ODER OUTAGE_ALERT_WINDOW_MS=0.",
      },
    ];
  if (paymentEnabled && platformSpendWarnPercent > 0)
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

// OUTBOUND-E1: die Plattform-ANI. Ein leeres PLATFORM_ANI_E164 heisst "keine Bindung" -
// der dreifache Freigabe-Riegel schuetzt dann NICHTS und saehe im Log trotzdem gruen aus
// (Repo-Lehre "Pruefkommando ohne Positiv-Kontrolle"). Deshalb meldet der Guard IMMER,
// wenn der Wert leer ist - abgestuft nach Blast-Radius, aber NIE stumm.
export const PLATFORM_ANI_FINDING = Object.freeze({
  UNSET: "platform_ani_unset", // WARN
  UNSET_WITH_OUTBOUND: "platform_ani_unset_with_outbound", // WARN, dringlicher
  MALFORMED: "platform_ani_malformed", // WARN - gesetzt, aber unbrauchbar (Review-Befund E1-S1-1)
});

// NIE fatal - Begruendung im Plan (E-1): ein Boot-Refusal haette den Dienst nicht mehr
// booten lassen und damit auch den INBOUND getoetet, der vom Ausfall gar nicht betroffen
// war. Dieselbe Abwaegung hat dieses Repo schon einmal getroffen und genauso entschieden.
// Der besetzte Wert liefert [] und wird NIE geloggt (Regel 4/PII).
// Arg-injiziert (config-frei) wie fakeOriginateBootBlocked/alertChannelFindings.
//
// Review-Befund E1-S1-1: "gesetzt" allein reichte nicht - ein Tippfehler/nationales Format
// ohne '+' wuerde eine Bindung auf einer e164 anlegen, die numberBusyReason (strikte
// String-Gleichheit) mit KEINER number.e164 je gleich sieht: der Riegel liefe still leer,
// UND dieser Befund hier haette geschwiegen, weil der Wert nicht leer ist. Gleiche
// Pruef-Konstante wie die Schwester-Env BOOTSTRAP_E164 (bootstrapHealDecision oben,
// E164.test(normNum(...)) - EINE Quelle, defaults.js:700).
export function platformAniFindings({ platformAniE164, elevenLabsOutboundEnabled } = {}) {
  if (platformAniE164 && !E164.test(normNum(platformAniE164)))
    return [{
      code: PLATFORM_ANI_FINDING.MALFORMED,
      fatal: false,
      message:
        "PLATFORM_ANI_E164 ist gesetzt, aber kein gueltiges E.164-Format - die Bindung " +
        "greift NICHT (numberBusyReason vergleicht exakt), der Freigabe-Riegel schuetzt " +
        "NICHTS. Wert im Render-Dashboard korrigieren (Format +<Laendercode><Nummer>).",
    }];
  if (platformAniE164) return [];
  if (elevenLabsOutboundEnabled)
    return [{
      code: PLATFORM_ANI_FINDING.UNSET_WITH_OUTBOUND,
      fatal: false,
      message:
        "PLATFORM_ANI_E164 ist leer, obwohl ELEVENLABS_OUTBOUND_ENABLED=true - es besteht " +
        "KEINE Plattform-Nummern-Bindung. Der Freigabe-Riegel schuetzt die Absendernummer " +
        "nicht; ein Kuendigungs-/Loeschweg kann sie erneut freigeben (Ausfall 2026-08-24). " +
        "Wert im Render-Dashboard setzen.",
    }];
  return [{
    code: PLATFORM_ANI_FINDING.UNSET,
    fatal: false,
    message:
      "PLATFORM_ANI_E164 ist leer - keine Plattform-Nummern-Bindung, der Freigabe-Riegel " +
      "ist wirkungslos (Bestandsverhalten).",
  }];
}

// OUTBOUND-E3b (PM-17): die Alarm-SMS-Absenderbindung. "keine Bindung" ist ein eigener,
// gezaehlter WARN-Befund - NIE Schweigen (dieselbe Auflage wie platformAniFindings oben:
// "nicht konfiguriert" darf nicht wie "alles gruen" aussehen). NIE fatal: ein fehlender
// SMS-Absender toetet nicht den Boot, der Melder hat mit Mail einen zweiten, vom SMS-Konto
// unabhaengigen Kanal (PM-4/BA-12). openBindings ist das Rueckgabe-Array von
// derivePlatformNumberBindings (src/boot.js) - PII-frei, nur purpose/e164-Praesenz zaehlt.
export const PLATFORM_ALERT_SENDER_FINDING = Object.freeze({
  UNBOUND: "alert_sms_sender_unbound", // WARN
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

// OUTBOUND-E4 (PM-16): "leer" ergibt bei den zwei neuen Telnyx-IDs einen unbekannt-Befund
// im Drift-Waechter - unknown gated nie und alarmiert nie, jeder Log-Blick saehe gruen
// aus. Deshalb meldet der Guard bei JEDEM Start, wenn eine der beiden IDs fehlt. NIE
// fatal (gleiche Abwaegung wie platformAniFindings: ein Boot-Refusal toetete den Inbound,
// der vom Ausfall gar nicht betroffen ist).
export const DRIFT_CONFIG_FINDING = Object.freeze({
  UNSET: "drift_config_unset", // WARN
  UNSET_WITH_OUTBOUND: "drift_config_unset_with_outbound", // WARN, dringlicher
});

export function driftConfigFindings({ fqdnConnectionId, outboundVoiceProfileId, elevenLabsOutboundEnabled } = {}) {
  if (fqdnConnectionId && outboundVoiceProfileId) return [];
  const fehlend = [
    fqdnConnectionId ? null : "TELNYX_FQDN_CONNECTION_ID",
    outboundVoiceProfileId ? null : "TELNYX_OUTBOUND_VOICE_PROFILE_ID",
  ].filter(Boolean);
  const code = elevenLabsOutboundEnabled ? DRIFT_CONFIG_FINDING.UNSET_WITH_OUTBOUND : DRIFT_CONFIG_FINDING.UNSET;
  return [{
    code,
    fatal: false,
    message:
      `${fehlend.join(", ")} leer - der Drift-Waechter meldet die zugehoerigen Pruefungen ` +
      "als unbekannt statt sie zu fahren (kein Fehlalarm, aber auch kein Schutz). Wert im " +
      "Render-Dashboard setzen.",
  }];
}

// LCT P4: die Riegel des Flips. FATAL = leere Pflicht-Menge bei aktiver Buchung ("Ein
// Dienst, der Geld zurueckerstattet, ohne zu wissen, wogegen er Vollstaendigkeit prueft,
// darf nicht starten"). FATAL = Pflicht-Typ, den der Adapter nie zuordnen KANN (LCT-FIX-1)
// - derselbe Sachverhalt wie die leere Menge, nur andersherum unerfuellbar: beide nehmen
// der Vollstaendigkeits-Aussage jeden Sinn, bevor Geld bewegt wird. WARN =
// Deckungsquote unter der Schwelle (ablesbar, kein exit(1) - ein Boot-Refusal tauschte ein
// Kostenproblem gegen einen Telefonie-Totalausfall).
export const COST_TRUING_BOOKING_FINDING = Object.freeze({
  REQUIRED_TYPES_EMPTY: "cost_truing_required_types_empty", // FATAL
  REQUIRED_TYPES_UNASSIGNABLE: "cost_truing_required_types_unassignable", // FATAL
  COVERAGE_BELOW_THRESHOLD: "cost_truing_coverage_below_threshold", // WARN
});

// Reine Entscheidung (arg-injiziert, config-frei, testbar; Muster spendCapCoherence).
// Unkonditional seit P8: die Korrekturbuchung ist bedingungslos aktiv, also laeuft auch
// diese Pruefung immer (kein Flag-Kurzschluss mehr, der sie auslassen koennte).
// coveragePercent wird HEREINGEREICHT, nicht hier gerechnet: die eine Quelle ist
// costTruingCoveragePercent(store) aus P3 - zwei Rechnungen derselben Groesse waeren
// zwei Zahlen, die auseinanderlaufen. Genauso assignableRecordTypes: welche Belegtypen es
// gibt und welche davon zuordenbar sind, gehoert dem Adapter, der die Belege liest, nicht
// diesem Guard - hier waere es eine zweite Quelle, die stillschweigend veralten kann. Der
// Aufrufer reicht sie herein. Der Parameter ist PFLICHT (kein []-Default: ein vergessenes
// Argument soll laut scheitern, nicht die Pruefung lautlos abschalten).
// Befunde koennen GEMEINSAM auftreten; der Aufrufer behandelt fatal zuerst (Muster
// assertSpendCapCoherence).
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
  // Gegen die ALLOWLIST der zuordenbaren Typen, NICHT gegen eine Deny-Liste - Begruendung
  // s. ASSIGNABLE_COST_RECORD_TYPES (telephony/adapters/telnyx/voice.js), die EINE Quelle
  // dieser Aussage. Hier lokal: der Vergleich ist exakt und case-sensitiv wie der spaetere
  // Vollstaendigkeits-Vergleich in cost-truing.js; nur so meldet der Guard genau das, was
  // dort dauerhaft unerfuellbar bliebe.
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
        `Deckungsquote ${coveragePercent}% liegt unter COST_TRUING_MIN_COVERAGE_PERCENT=${minCoveragePercent}% ` +
        "- Korrekturbuchungen laufen auf einer duennen Datenlage.",
    });
  }
  return findings;
}

// KV-P7/IE3: ZWEI latente Kosten-Pfade. PLAY_TTS_UNPRICED bleibt WARN (kein exit(1) - ein
// Guard, der den Boot in einer Konfiguration verweigert, an die niemand gedacht hat, waere
// ein selbst verursachter Telefonie-Totalausfall, Praezedenz warnUnpricedModels).
// EL_INBOUND_CARRIER_UNCOLLECTED ist FATAL: ein Anrufweg, dessen Kostenpfad keinen
// Einsammler hat, darf nicht scharf sein (Muster REQUIRED_TYPES_EMPTY).
export const LATENT_COST_PATH_FINDING = Object.freeze({
  PLAY_TTS_UNPRICED: "play_tts_unpriced", // WARN
  EL_INBOUND_CARRIER_UNCOLLECTED: "el_inbound_carrier_uncollected", // FATAL (IE3)
});

// Reine Entscheidung (arg-injiziert, config-frei, testbar; Muster alertChannelFindings).
// elInboundCarrierHasCollector OHNE Default (kein "= false"): ein vergessenes Argument
// soll einen UEBERFLUESSIGEN Befund erzeugen, nie ein stilles Verstummen der Pruefung -
// die richtige Fehlrichtung fuer einen Sicherheits-Guard.
export function latentCostPathFindings({
  playTtsEnabled,
  elInboundEnabled,
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
  // IE3: ein Anrufweg, dessen Kostenpfad keinen Einsammler hat, darf nicht scharf sein.
  // Riegel fuer den neuen Inbound-Weg (unser Bein, Gespraech beim EL-Agenten). Er haengt
  // am KOSTENPFAD, nicht am Schalternamen: sobald das Profil telnyx_inbound_el_convai
  // mindestens einen Pflicht-Traeger MIT Einsammler fuehrt, verschwindet er von selbst -
  // und wenn jemand die Katalogzeile entfernt oder ihre Traeger auf nicht_belegpflichtig
  // setzt, startet der Prozess mit scharfem Schalter nicht mehr.
  if (elInboundEnabled && !elInboundCarrierHasCollector) {
    findings.push({
      code: LATENT_COST_PATH_FINDING.EL_INBOUND_CARRIER_UNCOLLECTED,
      fatal: true,
      message:
        "ELEVENLABS_INBOUND_ENABLED=true, aber das Kostenprofil telnyx_inbound_el_convai " +
        "fuehrt keinen Kostentraeger mit Beleg-Einsammler (src/billing/kostenarten.js) - " +
        "jeder eingehende Anruf auf diesem Weg erzeugt Anbieterkosten (das " +
        "ElevenLabs-Gespraech UND unser Telnyx-Bein), die in keinem Buch und auf keiner " +
        "Gate-Achse landen. Handlung: ELEVENLABS_INBOUND_ENABLED=false setzen, oder erst " +
        "die Katalogzeile mit Einsammler bauen.",
    });
  }
  return findings;
}

// IEL-B1: Schalter an, aber der Weg kann nie zustande kommen (SIP-Digest ohne Benutzer/
// Passwort, Init-Webhook ohne tragfaehiges Geheimnis) -> FATAL. Ein Schalter, der "an"
// meldet und still immer den Budget-Pfad faehrt, waere genau die Blindheit, die der
// Owner-Testanruf sonst erst am Telefon entdeckt. Der Befund nennt NUR Schluesselnamen
// und Mangel, nie einen Wert und keine Laenge (Regel 4). Alle Maengel in EINER Meldung:
// applyBootFindings druckt nur den ersten fatalen Befund.
export const EL_INBOUND_ACCESS_FINDING = Object.freeze({
  INCOMPLETE: "el_inbound_access_incomplete", // FATAL (IEL-B1)
});

function zugangsMangelText(defekt) {
  return `${defekt.envKey} ${defekt.mangel}`;
}

export function elInboundAccessFindings(inbound) {
  if (inbound.enabled !== true) return [];
  const defekte = inboundElAccessDefects(inbound);
  if (defekte.length === 0) return [];
  return [
    {
      code: EL_INBOUND_ACCESS_FINDING.INCOMPLETE,
      fatal: true,
      message:
        "ELEVENLABS_INBOUND_ENABLED=true, aber der Zugang des EL-Inbound-Wegs ist " +
        `unvollstaendig: ${defekte.map(zugangsMangelText).join(", ")}. Handlung: ` +
        "ELEVENLABS_INBOUND_ENABLED=false setzen oder die Geheimnisse per Skript-Lauf neu setzen.",
    },
  ];
}

// IEX-A9 (E9/A5): unbekannter ELEVENLABS_INBOUND_SCOPE -> FATAL, unabhaengig vom Schalter (Muster
// sttProfileFindings): ein Tippfehler faellt beim Deploy auf, nicht erst beim Einschalten. Die Meldung
// nennt NIE den eingegebenen Wert (Log-Injection), nur Schluessel und gueltige Werte.
export const EL_INBOUND_SCOPE_FINDING = Object.freeze({
  UNKNOWN: "el_inbound_scope_unknown", // FATAL (IEX-A9)
});

export function elInboundScopeFindings(scope) {
  if (isInboundElScope(scope)) return [];
  return [
    {
      code: EL_INBOUND_SCOPE_FINDING.UNKNOWN,
      fatal: true,
      message:
        `ELEVENLABS_INBOUND_SCOPE ist unbekannt. Gueltig: ${Object.values(INBOUND_EL_SCOPE).join("|")}. ` +
        `Handlung: Wert korrigieren oder leeren (Default ${DEFAULT_INBOUND_EL_SCOPE}).`,
    },
  ];
}

// ---- E5/S2-A6: Eindeutigkeit des ANGEKUENDIGTEN Origins ---------------------------
// Warum FATAL und nicht WARN (die Praezedenz llmFallbackFindings oben waehlt WARN,
// ausdruecklich weil "ein Boot-Refusal einen Tippfehler gegen einen Telefonie-
// Totalausfall tauschte" - der Fall ist hier benannt, nicht uebersehen): die vier
// Befunde beschreiben nicht einen wirkungslosen Schalter, sondern eine
// SICHERHEITSRELEVANTE Uneindeutigkeit. Laufen aud-Erwartung (src/auth.js audience())
// und Metadaten-Verweis auseinander, prueft der Server eine andere Audience als die, die
// er dem Client ankuendigt - der Client kann sich nie erfolgreich autorisieren, und
// niemand merkt es. Ein PUBLIC_URL mit Pfad erzeugt eine "Audience", die kein Origin
// ist (T-32 friert scheme/host/port ein). Gegen den Telefonie-Totalausfall ist der
// Schutz die REIHENFOLGE, nicht die Abschwaechung: Live-Werte lesen BEVOR deployed wird
// (F-b/F-e); am 2026-09-18 belegen zwei oeffentliche Reads, dass PRM.resource ===
// publicUrl + "/mcp" gilt, dieser Riegel beim ersten Deploy also nicht fatal werden kann.
export const ANGEKUENDIGTER_ORIGIN_FINDING = Object.freeze({
  AUDIENCE_DIVERGENT: "angekuendigte_audience_divergent",
  PUBLIC_URL_UNPARSBAR: "public_url_unparsbar",
  PUBLIC_URL_MIT_PFAD: "public_url_mit_pfad",
  PUBLIC_URL_UNSICHER: "public_url_unsicher",
  ALLOWLIST_UNPARSBAR: "mcp_allowlist_unparsbar",
});

// Pfad, den die kanonische MCP-Audience an den angekuendigten Origin anhaengt (G25).
const MCP_AUDIENCE_PFAD = "/mcp";
const HTTPS_PROTOKOLL = "https:";
const RAND_SCHRAEGSTRICHE = /\/+$/;

// Vergleichsform beider Audience-Seiten: getrimmt, ohne abschliessende Schraegstriche.
// BEWUSST NICHT stripTrailingSlash (src/config.js): das entfernt GENAU EINEN Slash und
// lebt in dem config-Modul, das diese Datei absichtlich nicht importiert. Ein live
// gemeintes ".../mcp/" darf keinen Boot-Abbruch ausloesen (Nachbesserung PM-8).
function fuerAudienceVergleich(wert) {
  return String(wert ?? "").trim().replace(RAND_SCHRAEGSTRICHE, "");
}

// Die kanonische Audience aus dem angekuendigten Origin. MUSS identisch bleiben zu
// audience() in src/auth.js (dort `oauthAudience || ${publicUrl}/mcp`). Diese Gleichheit
// ist NICHT per Konvention gesichert: test/s2-mcp-origin.test.js vergleicht den Wert
// gegen die resource-Angabe, die der laufende Server unter
// /.well-known/oauth-protected-resource ausliefert.
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

// publicUrl LEER liefert bewusst [] - dafuer gibt es schon einen Eigentuemer
// (assertConfig, config.js: leer oder CHANGE-ME -> Boot-Refusal). Zwei Riegel auf
// dieselbe Aussage waeren zwei Orte, die auseinanderlaufen koennen.
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

// Meldung nennt die POSITION, nie den Wert (Muster elInboundScopeFindings: kein Echo
// eines eingegebenen Strings ins Log).
function allowlistFindings(allowedOrigins) {
  return allowedOrigins
    .map((eintrag, index) => ({ eintrag, position: index + 1 }))
    .filter(({ eintrag }) => !normalisierterOrigin(eintrag))
    .map(({ position }) => ({
      code: ANGEKUENDIGTER_ORIGIN_FINDING.ALLOWLIST_UNPARSBAR,
      fatal: true,
      message:
        `MCP_ALLOWED_ORIGINS: Eintrag ${position} ist kein absoluter http(s)-Origin ` +
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
