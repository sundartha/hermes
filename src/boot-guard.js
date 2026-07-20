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

// S1-7: Vollstaendigkeit der Stripe-Meter-Abbildung. JEDE usage_event-Sorte MUSS ein
// event_name haben; fehlt eins, wirft reportMeter zur Laufzeit 'unbekanntes kind', flushMeters
// zaehlt failed++ OHNE das Event sent zu markieren -> Endlos-Retry, Umsatz nie gemeldet.
// Reine Entscheidung (arg-injiziert, config-frei, testbar; Muster fakeOriginateBootBlocked):
// liefert die Sorten OHNE Mapping (leer = vollstaendig).
export function meterMappingGaps(usageEventKinds, meterEventNames) {
  return usageEventKinds.filter((kind) => !meterEventNames[kind]);
}

// P3: Sekunden->Minuten-Bruecke der Worst-Case-Reserve (G25: benannte Konstante statt
// nackter 60). Zeit-Einheit, kein Betriebsparameter -> gehoert NICHT nach config.js
// (G35 n.z.). Muster: MS_PER_MINUTE in src/billing/metering.js, MS_PER_DAY in src/config.js.
const SECONDS_PER_MINUTE = 60;

// P3: Befund-Codes des Kohaerenz-Guards (G25/G11: EINE Quelle statt Roh-Strings in Guard,
// Verdrahtung und Test).
export const SPEND_CAP_FINDING = Object.freeze({
  TENANT_DEFAULT_INERT: "tenant_default_inert", // Klausel A  - FATAL
  TENANT_DEFAULT_UNSET: "tenant_default_unset", // Klausel A0 - WARN
  WORST_CASE_UNAFFORDABLE: "worst_case_unaffordable", // Klausel B - WARN + Audit
});

// P3: laengste Gespraechsdauer, die unter der Tenant-Decke zum Worst-Case-Tarif noch
// bezahlbar ist. Division sicher: der Aufrufer ruft NUR, wenn
// maxTariffCents * n > tenantDefaultCents > 0 gilt - das erzwingt maxTariffCents > 0
// (kein Division-durch-0).
function affordableCallDurationS(tenantDefaultCents, maxTariffCents) {
  return Math.floor(tenantDefaultCents / maxTariffCents) * SECONDS_PER_MINUTE;
}

// P3 (Boot-Guards Konfig-Kohaerenz): prueft die Budget-Achsen GEGENEINANDER, nicht nur
// jede einzeln. Drei sich ausschliessende Klauseln (Reihenfolge ist die Spezifikation):
//
// A0 (WARN): tenantDefaultCents === 0 ist der dokumentierte Sentinel "kein Tenant-
//   Default" (src/config.js, min:0) - jeder Tenant ohne eigene tenant_budget-Zeile
//   faellt auf den geteilten Plattform-Cap zurueck. Kein Schutzverlust, nur Hinweis.
// A (FATAL): tenantDefaultCents >= platformCapCents macht die Tenant-Achse INERT - der
//   globale Cap bindet immer zuerst, die per-Tenant-Decke wirkt nie (Regel 1: eine
//   inerte Kosten-Achse ist echter Schutzverlust). >=, NICHT >: bei Gleichstand bindet
//   die Tenant-Achse ebenfalls nie.
// B (WARN + Audit): selbst wenn die Tenant-Decke wirkt, reicht sie fuer den TEURSTEN
//   Zielverkehr (maxTariffCents) ueber die laengstmoegliche Gespraechsdauer
//   (maxCallDurationS, die HARTE Klemme aus resolveMaxDurationS) nicht aus - jedes
//   Auslandsziel scheitert am Reserve-Gate, bevor die Tenant-Decke erreicht ist. Das
//   ist eine Ablehnungs-Ursache (Forensik), aber niemals fatal.
//
// Der A0-Early-Return VOR Klausel A macht "tenantDefaultCents > 0" fuer Klausel A
// strukturell wahr (G27: Struktur statt Konvention) - Klausel B erbt das ebenfalls.
// Es entsteht hoechstens EIN Befund (die Klauseln schliessen sich aus); Array-Form
// haelt die Verdrahtung trotzdem uniform (Muster meterMappingGaps: leer = in Ordnung).
//
// Voraussetzung: laeuft NACH assertConfig() - nicht-numerische Werte sind dort bereits
// fail-closed abgefangen (numEnv). Kein eigener NaN-Riegel (kein zweites
// Gueltigkeitsidiom, G5/D7-Klasse).
export function spendCapCoherence({ tenantDefaultCents, platformCapCents, maxTariffCents, maxCallDurationS }) {
  if (tenantDefaultCents === 0) {
    return [
      {
        code: SPEND_CAP_FINDING.TENANT_DEFAULT_UNSET,
        fatal: false,
        message:
          `DEFAULT_TENANT_BUDGET_CENTS=0 (Sentinel: kein Tenant-Default) - jeder Tenant ` +
          "ohne eigene tenant_budget-Zeile faellt auf den geteilten Plattform-Cap " +
          `platformSpendCapCents=${platformCapCents} zurueck.`,
      },
    ];
  }
  if (tenantDefaultCents >= platformCapCents) {
    return [
      {
        code: SPEND_CAP_FINDING.TENANT_DEFAULT_INERT,
        fatal: true,
        message:
          `DEFAULT_TENANT_BUDGET_CENTS=${tenantDefaultCents} ist >= MAX_BUDGET_EUR*100=${platformCapCents} ` +
          "- die Tenant-Budget-Achse ist damit WIRKUNGSLOS (der globale Plattform-Cap bindet " +
          "immer zuerst). Abhilfe: DEFAULT_TENANT_BUDGET_CENTS unter den Plattform-Cap senken " +
          "ODER MAX_BUDGET_EUR anheben.",
      },
    ];
  }
  const worstCaseReserveCents = maxTariffCents * Math.ceil(maxCallDurationS / SECONDS_PER_MINUTE);
  if (worstCaseReserveCents > tenantDefaultCents) {
    const maxDurationS = affordableCallDurationS(tenantDefaultCents, maxTariffCents);
    return [
      {
        code: SPEND_CAP_FINDING.WORST_CASE_UNAFFORDABLE,
        fatal: false,
        message:
          `Worst-Case-Reserve ${worstCaseReserveCents} Cent (VOICE_TARIFF_DEFAULT_CENTS=${maxTariffCents} ` +
          `* max. Gespraechsdauer) uebersteigt die Tenant-Decke DEFAULT_TENANT_BUDGET_CENTS=${tenantDefaultCents} ` +
          `- der teuerste Zielverkehr ist unter dieser Decke ab max_duration_s=${maxDurationS} nicht mehr bezahlbar.`,
      },
    ];
  }
  return [];
}

// P3 (Boot-Guards Modellpreise): Modelle OHNE Eintrag in der Preistabelle (leer = alles
// bepreist). Reine Funktion (Muster meterMappingGaps).
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
// fatal:false ist die STUFE DIESER PHASE, nicht die Regel: in P2/P3 hat der Kurs keinen
// Verbraucher, ein Boot-Refusal tauschte einen Schaden von NULL gegen den Totalausfall der
// Telefonie auf einem Free Tier mit haeufigen Restarts. Vorbild im Bestand:
// warnUnpricedModels. P4 - die Phase, in der der Kurs erstmals Geld bewegt - hebt genau
// dieses eine Feld auf true.
//
// Die EXISTENZ der Pruefung haengt an nichts, insbesondere NICHT an
// COST_TRUING_BOOKING_ENABLED: P8 entfernt dieses Flag, und eine daran gekoppelte
// Bedingung waere danach entweder weg oder als undefined falsy - lautlos tot genau in dem
// Moment, in dem die Korrekturbuchung bedingungslos aktiv wird.
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
      fatal: false,
      message:
        `PROVIDER_TO_BUCKET_RATE_MICRO=${rateMicro} liegt ausserhalb des Toleranzbandes ` +
        `${minMicro}..${maxMicro} (Anker ${PROVIDER_RATE_ANCHOR_MICRO} = 0,92 je Einheit). ` +
        "Haeufigste Ursache: Zehnerpotenz-Vertipper (920 statt 920000). Der Kurs hat in " +
        "dieser Phase noch keinen Verbraucher - ab der Korrekturbuchung verweigert dieser " +
        "Guard den Start.",
    },
  ];
}
