import { USAGE_EVENT_KIND } from "../store/defaults.js";

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

for (const [name, row] of Object.entries(COST_LEDGER_MAP)) assertRow(name, row);
