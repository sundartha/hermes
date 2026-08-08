// KV-P1 (PLAN-KOSTEN-VOLLSTAENDIGKEIT.md): die Kosten-Landkarte als STRUKTUR statt
// Konvention. Wurzel des Plans: es gibt ZWEI Kostenbuecher ohne Kante zwischen ihnen -
// Buch A ist der Verbrauchs-Ledger (usage_event, Schreiber recordUsageEvent), Buch B ist
// die Gate-Achse (usage.costCents/usage.spendMonthCostCents, Schreiber bookCents ueber
// trackUsage/addVoiceUsageCostCents/addResearchFeeCostCents/applyCreditCents, gelesen von
// budgetExceeded). Weil es keine Kante gibt, wird heute jede Kosten-Art ZWEIMAL von Hand
// verdrahtet, und Vollstaendigkeit ist eine Eigenschaft der Sorgfalt, nicht der Struktur.
//
// Diese Tabelle macht die Vollstaendigkeit zu einer Eigenschaft der Struktur (G27): sie
// deklariert je Kosten-Art GENAU EINE Zeile mit drei Pflichtfeldern OHNE DEFAULT (ledger,
// gate, preisquelle) plus dem Enum-Anker `kind`. test/kv-p1-cost-ledger-map.test.js faehrt
// jede Zeile gegen den ECHTEN Buchungspfad (kein Test gegen eine zweite Konstante) und
// haelt zusaetzlich fest, dass jeder USAGE_EVENT_KIND-Wert genau eine Zeile hat.
//
// ORT (bewusst src/, nicht test/): dieselbe Begruendung wie src/route-policy.js - eine
// deklarative, Object.freeze'd Tabelle ist Produkt-Vertrag ("wer eine Kosten-Art bucht,
// muss sie HIER eintragen"), keine Test-Fixture. Sie liegt in src/billing/, weil das der
// konzeptionelle Ort der zwei Buecher ist (metering.js, cost-truing.js).
//
// KERNREGEL (Pflicht fuer jede folgende Bau-Phase): eine Phase, die eine Luecke schliesst,
// kippt GENAU EINE Zeile von false auf true (ledger ODER gate) - nie mehr, nie eine neue
// Zeile ohne neue Kosten-Art. Diese Datei bildet den IST-Zustand ab, LUECKEN INKLUSIVE.
import { USAGE_EVENT_KIND } from "../store/defaults.js";

// Pflichtfeld-Riegel: ein fehlendes Feld ist ein FEHLER, kein stiller Default - genau
// der Unterschied zwischen Struktur und Konvention (Teil (b) des Plans). typeof x !==
// "boolean" laesst undefined (fehlendes Feld), null, 0/1 (Zahlen-Stellvertreter) und
// leere Strings gleichermassen durchfallen; es gibt keinen impliziten Fallback, der
// einen dieser Faelle in true/false verwandelt. Laeuft beim MODUL-IMPORT (s.u.), nicht
// erst in einem dedizierten Testlauf - jeder Import dieses Moduls reisst ab, wenn eine
// Zeile verstuemmelt ist.
function assertRow(name, row) {
  if (typeof row.ledger !== "boolean")
    throw new Error(`cost-ledger-map: '${name}'.ledger fehlt oder ist kein Boolean`);
  if (typeof row.gate !== "boolean")
    throw new Error(`cost-ledger-map: '${name}'.gate fehlt oder ist kein Boolean`);
  if (typeof row.preisquelle !== "string" || !row.preisquelle.trim())
    throw new Error(`cost-ledger-map: '${name}'.preisquelle fehlt oder ist leer`);
  if (row.kind !== null && !Object.values(USAGE_EVENT_KIND).includes(row.kind))
    throw new Error(`cost-ledger-map: '${name}'.kind ist weder null noch ein USAGE_EVENT_KIND`);
}

// Die Landkarte selbst - sieben Zeilen, bewusst kurz genug fuer ein vollstaendiges
// Review. Jede Zeile entspricht einem Testfall in test/kv-p1-cost-ledger-map.test.js,
// der genau diese Zeile gegen einen echten Buchungsaufruf faehrt.
export const COST_LEDGER_MAP = Object.freeze({
  voice_minute_outbound: {
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    ledger: true,
    gate: true,
    preisquelle:
      "callTariffCentsPerMin (metering.js) ueber tariffCentsPerMin (outbound-gates.js); " +
      "unbekannte Herkunft faellt fail-closed auf den teuersten Satz. Ledger nur unter " +
      "PAYMENT_ENABLED (call-finish.js), Gate (reconcileVoiceBudget) IMMER.",
  },
  voice_minute_inbound: {
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    ledger: true,
    gate: true,
    preisquelle:
      "callTariffCentsPerMin (metering.js), Inbound-Zweig: config.billing." +
      "voiceTariffInboundCents - ein eigener, an KV-M1 kalibrierter Satz (6 ct/min gegen " +
      "1,87 US-ct/min gemessenes Ist), NICHT der Outbound-Worst-Case. Fehlt der Wert, " +
      "greift der Code-Fallback 6, nie 0; Muell verweigert den Boot. Ledger nur unter " +
      "PAYMENT_ENABLED (call-finish.js), Gate (reconcileVoiceBudget) IMMER - seit KV-P2 " +
      "ohne Richtungsfilter, die Hauptluecke des Plans ist damit geschlossen. Seit KV-P3 " +
      "korrigiert der Ist-Abgleich (cost-truing.js, ebenfalls richtungsoffen) diese " +
      "Schaetzung gegen die Provider-Belege; die Korrektur ist bei Inbound typischerweise " +
      "NEGATIV (6 ct Schaetzung gegen 1,72 EUR-Cent Ist). Sie erreicht die Spend-Monat- " +
      "und Perioden-Achse nur, wenn sie DIESELBE Periode trifft wie die Belastung " +
      "(applyCreditCents, KS-P5) - sonst wirkt sie nur auf der Lebenszeit-Achse.",
  },
  ai_token: {
    kind: USAGE_EVENT_KIND.AI_TOKEN,
    ledger: true,
    gate: true,
    preisquelle:
      "tokenCostUsd (state-ops.js) ueber config.llm.modelPricesUsd; unbekannte Modell-ID " +
      "faellt fail-closed auf die punktweise Obergrenze ueber alle Staffeln " +
      "(priceForModel/worstCasePrice, B4a); der Preis entsteht seit B4a je Token-Sorte " +
      "(vier Raten). " +
      "Ledger rundet pro Buchung auf volle EUR-Cent (aiCostCents, Math.round) - ein " +
      "einzelner kleiner Turn kann als 0-Cent-Event erscheinen. Gate (trackUsage) " +
      "akkumuliert denselben Betrag in Mikro-Cent (costMicroCentsRem) und verliert den " +
      "Rest NIE - die zwei Achsen divergieren dadurch schon bei GLEICHER Preisquelle. " +
      "Seit KV-P6 traegt derselbe Ledger-Beleg zusaetzlich cost_micro_cents (ungerundet, " +
      "tokenCostMicroCents - dieselbe Formel wie das Gate-Carry); cost_cents selbst " +
      "bleibt gerundet und damit bei kleinen Turns weiterhin 0 (kein Backfill).",
  },
  research_fee: {
    kind: null,
    ledger: false,
    gate: true,
    preisquelle:
      "config.research.researchSearchFeeCents (Vorab-Recherche) bzw. " +
      "lookupSearchFeeCents (In-Call-Suche), feste ENV-Werte. usage_event kennt kein " +
      "research-kind - der Ledger-Pfad existiert fuer diese Kosten-Art STRUKTURELL " +
      "nicht (bewusste Entscheidung AL-P10, s. Kommentar in llm-usage.js).",
  },
  sms: {
    kind: USAGE_EVENT_KIND.SMS,
    ledger: true,
    gate: false,
    preisquelle:
      "config.billing.smsCostCents, Default 0 (kein Fail-closed, min:0 in config.js) - " +
      "ein fehlender Preis ist hier lautlos 0, nicht 'nicht erfasst'. Gate: kein " +
      "addUsageCostCents/trackUsage-Aufruf im SMS-Pfad, strukturell nie vorgesehen.",
  },
  number_month: {
    kind: USAGE_EVENT_KIND.NUMBER_MONTH,
    ledger: true,
    gate: false,
    preisquelle:
      "number.monthlyCostCents, NUR der beim Kauf gelernte Provider-Preis (Owner- " +
      "Entscheidung 2026-07-27, KEIN Fallback). Fehlt er, bucht recordNumberMonthMeter " +
      "fail-closed NICHTS (monthlyRentCents liefert null). Heute (KV-M2) hat KEINE " +
      "reale Nummer einen gelernten Preis - die Zeile beschreibt die STRUKTUR (mit " +
      "Preis-Fixture feuert der Ledger), nicht den aktuellen Bestand. Gate: kein " +
      "addUsageCostCents-Aufruf, unabhaengig vom Preis - strukturell nie vorgesehen.",
  },
  play_tts_characters: {
    kind: null,
    ledger: false,
    gate: false,
    preisquelle:
      "KEIN Preis-Parameter existiert repo-weit fuer die vom PLAY-TTS-PFAD selbst " +
      "synthetisierten Zeichen (recordTtsCharacters/recordTenantTtsCharacters zaehlen NUR " +
      "Zeichen, nie Cents) - unser Server erzeugt die Audiodatei selbst, Telnyx stellt " +
      "dafuer keinen Beleg aus. Weder Ledger noch Gate sind fuer DIESEN Pfad erreichbar; " +
      "gedeckt ist nur die ElevenLabs-Monatsgebuehr als Fixkosten-ANZEIGE " +
      "(PLATFORM_FIXED_COST_CENTS_PER_MONTH), kein Betrag pro Anruf (KV-P7-Klaerung, " +
      "tasks/kv-p7-tts-klaerung.md). KORREKTUR (KV-P7, C2): das gilt NUR fuer diese Zeile - " +
      "von TELNYX selbst berechnetes TTS-Geld ist eine ANDERE Kostenart und erreicht die " +
      "Gate-Achse sehr wohl, weil text-to-speech ein ASSIGNABLE_COST_RECORD_TYPES-Beleg ist " +
      "(sumRecordMicroCents ist typ-blind) und ueber den Ist-Abgleich (cost-truing.js, " +
      "richtungsoffen seit KV-P3) in applyCostCorrectionCents gebucht wird.",
  },
});

// Top-Level-Validierung: laeuft bei JEDEM Import dieses Moduls (nicht erst in einem
// Testlauf). Eine verstuemmelte Zeile reisst den Import ab, bevor irgendein Aufrufer
// die Tabelle je zu Gesicht bekommt.
for (const [name, row] of Object.entries(COST_LEDGER_MAP)) assertRow(name, row);
