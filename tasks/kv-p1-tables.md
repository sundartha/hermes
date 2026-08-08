# KV-P1 - Verifikation: Die Kosten-Landkarte

Branch `phase/kv-p1-kosten-landkarte`, Commit `049bacd`. Diese Datei ist der Beweis, dass
`test/kv-p1-cost-ledger-map.test.js` echte Buchungspfade ausloest, keine Tautologie ist.

## (A) Die Landkarte - woertlich aus `src/billing/cost-ledger-map.js`

| Kosten-Art | USAGE_EVENT_KIND | ledger | gate | preisquelle |
|---|---|---|---|---|
| voice_minute_outbound | VOICE_MINUTE | true | true | callTariffCentsPerMin (metering.js) ueber tariffCentsPerMin (outbound-gates.js); unbekannte Herkunft faellt fail-closed auf den teuersten Satz. Ledger nur unter PAYMENT_ENABLED (call-finish.js), Gate (reconcileOutboundVoiceBudget) IMMER. |
| voice_minute_inbound | VOICE_MINUTE | true | false | dieselbe Quelle wie outbound (callTariffCentsPerMin). Ledger nur unter PAYMENT_ENABLED. Gate: reconcileOutboundVoiceBudget filtert call.direction!=='outbound' -> return, das ist die Hauptluecke (KV-P2 kippt sie). |
| ai_token | AI_TOKEN | true | true | tokenCostUsd (state-ops.js) ueber config.llm.modelPricesUsd; unbekannte Modell-ID faellt fail-closed auf die teuerste Rate (priceForModel/mostExpensivePrice). Ledger rundet pro Buchung auf volle EUR-Cent (aiCostCents, Math.round) - ein einzelner kleiner Turn kann als 0-Cent-Event erscheinen. Gate (trackUsage) akkumuliert denselben Betrag in Mikro-Cent (costMicroCentsRem) und verliert den Rest NIE - die zwei Achsen divergieren dadurch schon bei GLEICHER Preisquelle. |
| research_fee | null | false | true | config.research.researchSearchFeeCents (Vorab-Recherche) bzw. lookupSearchFeeCents (In-Call-Suche), feste ENV-Werte. usage_event kennt kein research-kind - der Ledger-Pfad existiert fuer diese Kosten-Art STRUKTURELL nicht (bewusste Entscheidung AL-P10, s. Kommentar in llm-usage.js). |
| sms | SMS | true | false | config.billing.smsCostCents, Default 0 (kein Fail-closed, min:0 in config.js) - ein fehlender Preis ist hier lautlos 0, nicht 'nicht erfasst'. Gate: kein addUsageCostCents/trackUsage-Aufruf im SMS-Pfad, strukturell nie vorgesehen. |
| number_month | NUMBER_MONTH | true | false | number.monthlyCostCents, NUR der beim Kauf gelernte Provider-Preis (Owner-Entscheidung 2026-07-27, KEIN Fallback). Fehlt er, bucht recordNumberMonthMeter fail-closed NICHTS (monthlyRentCents liefert null). Heute (KV-M2) hat KEINE reale Nummer einen gelernten Preis - die Zeile beschreibt die STRUKTUR (mit Preis-Fixture feuert der Ledger), nicht den aktuellen Bestand. Gate: kein addUsageCostCents-Aufruf, unabhaengig vom Preis - strukturell nie vorgesehen. |
| play_tts_characters | null | false | false | KEIN Preis-Parameter existiert repo-weit fuer Play-TTS-Zeichen (recordTtsCharacters/recordTenantTtsCharacters zaehlen NUR Zeichen, nie Cents). Weder Ledger noch Gate sind erreichbar, weil es nichts zu buchen gibt, das einen Betrag traegt. |

Vollstaendigkeits-Riegel: `USAGE_EVENT_KIND` hat genau 4 Werte (VOICE_MINUTE, AI_TOKEN, SMS,
NUMBER_MONTH), alle 4 sind oben durch mind. eine Zeile gedeckt (KV-P1-8/9). Die zwei
`kind: null`-Zeilen (research_fee, play_tts_characters) sind bewusst enum-lose Kosten-Arten,
keine Luecke im Enum.

## (B) Die Ausloeser-Tabelle - Test gegen echten Buchungspfad

| Kosten-Art | Echter Ausloeser im Test | Assertion Buch A (Ledger/usage_event) | Assertion Buch B (Gate/costCents bzw. costMicroCentsRem) |
|---|---|---|---|
| voice_minute_outbound | `recordVoiceMinuteMeter(call)` + `reconcileOutboundVoiceBudget(call)` aus echtem `makeMetering()`, Test KV-P1-1 | `events.length === 1`, `events[0].costCents === tariffCentsPerMin(...)` | `usageOf(s, tenant).costCents === tariffCentsPerMin(...)` |
| voice_minute_inbound | dieselben zwei echten Metering-Funktionen, Call mit `direction:'inbound'`, Test KV-P1-2 | `events.length === 1` (Ledger kennt keine Richtung) | `gateCents === 0` (Filter in reconcileOutboundVoiceBudget) |
| ai_token | `bookTokenUsage({...})` aus echtem `src/llm-usage.js` gegen echten `src/store.js`-Singleton, 3x hintereinander, Test KV-P1-3 | `ledgerEvents.length === 3`, jede Buchung `costCents === 0` | `costMicroCentsRem` monoton wachsend ueber 3 Turns, `>0` nach Turn 1 |
| research_fee | `bookResearchSearchFee(...)` + `bookLookupSearchFee(...)`, echte Funktionen aus llm-usage.js, Test KV-P1-4 | `eventsNachher === eventsVorher` (kein neuer Event) | `gateNachher - gateVorher === researchSearchFeeCents + lookupSearchFeeCents` |
| sms | `finishCall(call)` aus echtem `makeCallFinish()` (nur Metering-Aufrufe gemockt, SMS-Pfad echt), Test KV-P1-5 | `events.length === 1`, `events[0].costCents === SMS_COST_CENTS_FIXTURE` | `gateCents === 0` |
| number_month | `recordNumberMonthMeter(number, ...)` aus echtem `makeMetering()`, Nummer-Fixture mit `monthlyCostCents`, Test KV-P1-6 | `events.length === 1`, `events[0].costCents === MONTHLY_RENT_CENTS` | `gateCents === 0` |
| play_tts_characters | `recordTenantTtsCharacters(s, tenant, 42)`, echte state-ops-Funktion, Test KV-P1-7 | `s.usageEvents.length === 0` | `usage.costCents === 0`; einziger Effekt `usage.ttsCharacters === 42` |

Jede der 7 Zeilen hat einen echten Ausloeser - keine Zeile ist als "KEIN echter Ausloeser"
markiert. Zusaetzlich zwei Riegel-Tests ohne Buchungspfad-Ausloesung (Struktur-Pruefung, kein
Verhaltenstest): KV-P1-8 (Enum-Deckung) und KV-P1-9 (verwaiste ledger:true-Zeilen), sowie
KV-P1-10 (Ein-Aufrufer-Riegel per Datei-Scan `grep store\.addVoiceUsageCostCents\(` gegen alle
`src/*.js`).

## Mutationsproben (durchgefuehrt und zurueckgenommen)

Details in der StructuredOutput-Antwort dieser Verifikation (`mutationLie`, `mutationNewKind`,
`mutationRemoveRow`, `mutationSecondCaller`). Alle vier Proben zurueckgenommen, `git diff`
gegen `049bacd` nach der Verifikation leer.
