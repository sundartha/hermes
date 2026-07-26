# 19 - W2-B0: Re-Baseline der Bloecke B1-B7 + GAP-27-Befund

Stand: 2026-07-26 | Basis: `master` = `1b90e78` | Scope-Quelle: [`18-w2-scope.md`](18-w2-scope.md) §W2-B0
(autoritativ, schlaegt `PLAN-I18N-TESTS.md` §5)

Diese Datei ist das Ergebnis von **Auftrag 2** (Re-Baseline) und zugleich der **Blockreport**
der Phase W2-B0 - bewusst EINE Datei statt zweier (G5).

---

## 1. Methode

Pro ID: die in der Blocktabelle genannte Sektionsdatei (`Beleglage`-Spalte) gelesen, die dort
notierte Erwartung entnommen, die **dort genannten Symbole** in `src/`/`public/`/`apps/web/`
gegriffen und die heutige Lage notiert.

- **Keine Zeilennummern uebernommen** (C2) - sie verrotten. Die Belegspalte fuehrt Symbol- und
  Dateinamen.
- **Kein Testbau, kein Fix.** W2-B0 baut genau EINEN Test (GAP-27, §4); alles andere ist Lektuere.
- **R-G angewendet:** die Spalte "Katalog-Erwartung" der Blocktabellen ist vom 2026-07-22 und
  damit aelter als die 15 Fix-Phasen. Sie ist ein Hinweis, kein Sollwert. Verbindlich ist die
  hier gemessene Lage. Wo die Erwartung nicht mehr traegt, steht das in §3 mit Begruendung -
  nicht stillschweigend gedreht.

**Lesart der Spalte "Katalog-Erwartung"**: `gruen` = der Katalog erwartet, dass ein Test den
beschriebenen (meist defekthaften) Ist-Zustand BESTAETIGT; `rot` = der Katalog erwartet, dass
der Test faellt, weil die Sollzustands-Eigenschaft fehlt; `unbekannt` = nicht vorab bewertet.

**Lesart der Spalte "Abweichung?"**: `-` = Katalog-Erwartung traegt unveraendert.
`JA` = die Erwartung ist ueberholt, Details in §3. `TEIL` = der Sachverhalt ist teilweise
geschlossen, der Test muss enger formuliert werden als der Katalogtext.

### 1.1 Querschnitts-Befund, der halb B1-B7 beruehrt: der Weltdefault-Flip (P10)

`DEFAULT_LANGUAGE` ist heute **`"en"`**, nicht `"de"`:

- deklariert in `src/store/defaults.js` als `export let DEFAULT_LANGUAGE = "en"`,
- umschaltbar ueber `setWorldDefaultLanguageEnabled(enabled)` (`enabled ? "en" : "de"`),
- verdrahtet in `src/config.js` aus `config.provisioning.worldDefaultLanguageEnabled`
  (Env `WORLD_DEFAULT_LANGUAGE_ENABLED`).

`DEFAULT_COUNTRY` bleibt `"DE"`.

**Konsequenz fuer den Testbau in B1-B7:** jede ID, deren Katalog-Erwartung einen Fallback auf
`"de"` voraussetzt, ist **gegen den Flip** zu formulieren, nicht gegen den Katalogtext -
betroffen sind mindestens LANG-09, LANG-17, LANG-21, LAW-18, FMT-22, FMT-27, WEB-25, DID-05.
Ein Test, der `"de"` als Fallback festnagelt, pinnt den Vor-P10-Zustand und wird beim naechsten
Env-Flip falsch-rot.

---

## 2. Vollstaendige Tabelle (102 IDs)

### 2.1 W2-B1 - Sprach-Aufloesung und Prompt-Schicht (16)

| ID | Block | Katalog-Erwartung (07-22) | gemessene Lage | Abweichung? | Ursache / Fix-Phase | Beleg (Symbol/Datei) |
| --- | --- | --- | --- | --- | --- | --- |
| LANG-09 | B1 | gruen: case-insensitiv, US unveraenderlich `"de"` | case-insensitiv bestaetigt (`String(country\|\|"").toUpperCase()`); US ist NICHT in der Tabelle -> Fallback = `DEFAULT_LANGUAGE` = **`"en"`** | **JA** | Weltdefault-Flip P10 | `languageForCountry`, `LANGUAGE_FOR_COUNTRY` (`src/i18n/locales.js`) |
| LANG-15 | B1 | gruen: `place_call.language` serverseitig ignoriert | Feld existiert weiter im Zod-Schema und wird serverseitig ignoriert (Sprache kommt aus `resolveCallLanguage`). Der Scope-Doc-Hinweis "E3: entfernt" traegt NICHT | **TEIL** | E3 hat das Feld nicht entfernt | `place_call`-Schema + Kommentar "b.language wird serverseitig ueber store.resolveCallLanguage ... aufgeloest" (`src/mcp-tools.js`) |
| LANG-16 | B1 | gruen: Inbound-Ablehnung hart Deutsch | bestaetigt: fester deutscher Satz im Hangup-Zweig fuer unbekannte/nicht-aktive Zielnummer, keine Locale-Anbindung | - | - | `sayD(...)`/`hangupD()` im Inbound-Handler (`src/routes/voice.js`) |
| LANG-17 | B1 | gruen: Praezedenz-Matrix | Praezedenz unveraendert `settings.language -> numberRecord.language -> tenant.defaultLanguage -> DEFAULT_LANGUAGE`; jede Stufe greift nur bei truthy | **TEIL** | letzte Stufe ist seit P10 `"en"` | `resolveCallLanguage` (`src/store/state-ops.js`) |
| LANG-19 | B1 | gruen: `language="EN"` still verworfen | bestaetigt: `language` steht in `OPTIONAL_ENUM_FIELDS` gegen `SUPPORTED_LANGUAGES` (`de`/`fr`/`en`); `"EN"` faellt durch `isOptionalEnumOverride` -> `continue`, kein Fehler, kein `changed`-Eintrag | - | - | `OPTIONAL_ENUM_FIELDS`, `isOptionalEnumOverride`, `updateSettings` (`src/store/state-ops.js`) |
| LANG-21 | B1 | gruen: `localeFor()` Fail-Safe | Fail-Safe-Mechanismus unveraendert (`LOCALES[language] \|\| LOCALES[DEFAULT_LANGUAGE]`), das ZIEL ist heute das EN-Bundle | **TEIL** | Weltdefault-Flip P10 | `localeFor` (`src/i18n/locales.js`) |
| LANG-23 | B1 | gruen: Onboard-Abschnitt atomar | bestaetigt: `registerTenant -> setTenantGeo -> requestNumber -> save` laufen in `store.withStoreLock` ohne fremdes `await` dazwischen; Save-Fehler -> behandelter 503 | - | - | `withStoreLock` (`src/store.js`), Onboard-Handler (`src/routes/api-onboard.js`) |
| LANG-26 | B1 | gruen: Inbound/Outbound teilen den Geo-Anker | bestaetigt: beide Pfade rufen `store.resolveCallLanguage({tenantId, numberRecord})`; Outbound holt den Anker ueber `findActiveNumber`, Inbound ueber die gewaehlte Nummer. Keine zweite Aufloesungsregel, kein Call-Parameter-Override | - | - | `resolveCallLanguage`-Aufrufe in `src/routes/voice.js` + `src/routes/api-calls.js`; `tenantLanguage` (`src/store/views.js`) |
| PROMPT-06 | B1 | gruen: `call.language` nicht durchgereicht | bestaetigt: Signatur ist `{objective, ownerNotes, constraints, to, tenantId}` - **kein** `language` | - | - | `fetchPrecallBriefing` (`src/precall-briefing.js`) |
| PROMPT-07 | B1 | gruen: keine Sprachvorgabe fuer Freitextfelder | bestaetigt: der System-Prompt ist ein fester deutscher Text ohne Sprachdirektive fuer die erzeugten Felder | - | - | `briefingSystem` (`src/precall-briefing.js`) |
| PROMPT-08 | B1 | gruen: Labels bleiben deutsch fuer EN-Call | **ueberholt**: die Labels kommen aus `loc.prompt.background` (Locale-Bundle), nicht mehr aus deutschen Literalen | **JA** | Fix-Phase P11 (Sprach-Bausteine) | `assistantContextSection` (`src/claude.js`), `prompt.background` (`src/i18n/locales.js`) |
| PROMPT-17 | B1 | gruen: Legacy-Nummer ohne `language` | bestaetigt: `numberRecord?.language` faellt bei fehlendem Feld durch (additiv NULLABLE, Backfill-frei) auf `tenant.defaultLanguage`, dann Weltdefault | **TEIL** | Endstufe seit P10 `"en"` | `resolveCallLanguage` (`src/store/state-ops.js`) |
| PROMPT-18 | B1 | gruen: paralleler EN-/DE-Call faerbt nicht ab | bestaetigt strukturell: `promptInputs(call)` liest ausschliesslich aus dem uebergebenen `call` + `store.tenantContext(call.tenantId)`; kein modulweiter Sprach-State in `claude.js` | - | - | `promptInputs`, `systemPrompt` (`src/claude.js`) |
| PROMPT-21 | B1 | gruen: Kalibrierung nur fuer `de` | bestaetigt: `FAREWELL_CALIBRATION_BY_LANGUAGE` traegt genau EINEN Eintrag (`de`); jede andere Sprache faellt auf `FAREWELL_FALLBACK_CALIBRATION`. Der Modul-Kommentar weist das ausdruecklich als bewusste Entscheidung aus (Messung statt Analogieschluss), nicht als Versehen | - | bewusst getragen | `FAREWELL_CALIBRATION_BY_LANGUAGE`, `farewellDelayMs` (`src/telnyx-conversation-watchdog.js`) |
| PROMPT-22 | B1 | gruen: `mandateSection` bleibt deutsch | **ueberholt**: die Mandats-Texte kommen aus `loc.prompt.mandate` | **JA** | Fix-Phase P11 | `mandateSection` (`src/claude.js`), `prompt.mandate` (`src/i18n/locales.js`) |
| E2E-03 | B1 | gruen: Sprachumstellung im laufenden Anruf wirkungslos | bestaetigt strukturell: `call.language` wird beim Anlegen des Calls festgeschrieben; alle Prompt-/Render-Pfade lesen `call.language`, nicht die Settings. Eine `updateSettings`-Aenderung wirkt erst auf den naechsten Call | - | - | `promptInputs`/`disclosureSentence` lesen `call.language` (`src/claude.js`) |

### 2.2 W2-B2 - Telefonie-Render, STT/TTS, Assistant-Pfad (11)

| ID | Block | Katalog-Erwartung (07-22) | gemessene Lage | Abweichung? | Ursache / Fix-Phase | Beleg (Symbol/Datei) |
| --- | --- | --- | --- | --- | --- | --- |
| VOICE-05 | B2 | gruen: `proposedCountry` ohne Flag immer null | bestaetigt: `geoEnabled` hat `fallback: false`; der Lookup steht hinter einem Ternaer, der ohne Flag `null` liefert | - | - | `geoEnabled` (`src/config.js`), `proposedCountry` (`src/routes/api-onboard.js`) |
| VOICE-09 | B2 | unbekannt | `language` ist im Self-Service-Patch ein fail-closed validiertes Enum-Feld (`SUPPORTED_LANGUAGES`); `"en"` wird gesetzt und in `changed` gemeldet | - | - | `OPTIONAL_ENUM_FIELDS`/`updateSettings` (`src/store/state-ops.js`), Settings-Route (`src/self-service-routes.js`) |
| VOICE-12 | B2 | gruen: eine Voice-ID fuer alle drei Sprachen | bestaetigt: die ElevenLabs-Stimme ist EIN Env-Wert (`ELEVENLABS_VOICE_ID` bzw. `TELNYX_ELEVENLABS_VOICE_ID`), nicht pro Sprache aufgeloest; kein `language`-Attribut im Synthese-Pfad | - | ElevenLabs pro Tenant/Sprache ist eine bekannte Luecke | `elevenlabs.voiceId` (`src/config.js`) |
| VOICE-18 | B2 | rot | **ueberholt**: das Verhalten ist gebaut - Sprache ausserhalb `STT_FLUX_HINTS` (auch `"multi"`) -> `STT_LANGUAGE_AUTO` | **JA** | Assistant-Fix-Kette (R2) | `transcriptionFields`, `STT_FLUX_HINTS`, `STT_LANGUAGE_AUTO` (`src/telephony/adapters/telnyx/voice.js`) |
| VOICE-19 | B2 | rot | **ueberholt**: `if (!language) return {}` ist explizit implementiert und kommentiert ("Body byte-identisch zum Bestand") | **JA** | Assistant-Fix-Kette | `transcriptionFields` (`src/telephony/adapters/telnyx/voice.js`) |
| VOICE-22 | B2 | gruen: Twilio-STT-Modell sprachunabhaengig | bestaetigt: `speechModel: "deepgram_nova-2-general"` ist ein Literal in `gatherOpts`, nur `language` kommt aus dem `voiceProfile` | - | - | `gatherOpts` (`src/telephony/adapters/twilio/render.js`) |
| VOICE-23 | B2 | gruen: kein Barge-in in der Budget-Engine | bestaetigt: weder `gatherOpts` (Twilio) noch `gatherAttrs` (Telnyx) setzen ein Barge-in-/Interrupt-Attribut fuer irgendeine Sprache | - | Telnyx-TeXML-Grenze (bekannt) | `gatherOpts` (twilio/render.js), `gatherAttrs` (telnyx/render.js) |
| VOICE-24 | B2 | gruen: Assistant-Pfad hat Barge-in AN | bestaetigt als Kontrast: der Assistant-Pfad laeuft ueber `startAssistant` (Streaming), nicht ueber `<Gather>` - die Budget-Engine-Grenze gilt dort nicht | - | - | `startAssistant` (`src/telephony/adapters/telnyx/voice.js`) |
| VOICE-25 | B2 | gruen: keine Voice-/STT-Leaks bei Parallelitaet | bestaetigt strukturell: `voiceAttrs(d.voiceProfile)` und `transcriptionFields(language)` sind reine Funktionen ueber ihre Argumente; kein modulweiter veraenderlicher Zustand in beiden Renderern | - | - | `voiceAttrs` (beide `render.js`), `transcriptionFields` (telnyx/voice.js) |
| VOICE-29 | B2 | gruen: Fail-closed in BEIDEN Adaptern | bestaetigt: beide `voiceAttrs` werfen `unbekanntes voiceProfile: ...`, kein stiller Fallback | - | - | `voiceAttrs` (`twilio/render.js` UND `telnyx/render.js`) |
| GAP-24 | B2 | rot | **ueberholt**: die Assistant-Bindung reicht `transcriptionFields(language)` in den `startAssistant`-Body; der STT-Hint haengt damit an der Call-Sprache. Offen bleibt nur, dass der INBOUND-Zweig `startAssistant` ohne `language` ruft (byte-identisch gehalten) | **TEIL** | Assistant-Fix-Kette | `startAssistant` + `transcriptionFields` (`src/telephony/adapters/telnyx/voice.js`) |

### 2.3 W2-B3 - Wahlziel-Normalisierung und Gate-Kette (14)

| ID | Block | Katalog-Erwartung (07-22) | gemessene Lage | Abweichung? | Ursache / Fix-Phase | Beleg (Symbol/Datei) |
| --- | --- | --- | --- | --- | --- | --- |
| OUT-03 | B3 | unbekannt | bestaetigt: das Profil kann nur einschraenken - erst `matchesPrefix(to, config.safety.allowedCountryCodes)`, dann optional `profile.allowedCountryCodes`; leeres Profil = keine Zusatz-Einschraenkung | - | - | `countryGateAllowed` (`src/telephony/outbound-gates.js`) |
| OUT-12 | B3 | gruen: Toll-Free zum Worst-Case-Tarif | bestaetigt strukturell: Inlands-Tarif greift NUR bei den drei Vorwahlen aus `VOICE_TARIFF_DOMESTIC_PREFIXES` an Ziel UND Absender; alles andere faellt auf `voiceTariffDefaultCents` | - | - | `VOICE_TARIFF_DOMESTIC_PREFIXES` (`src/config.js`), `tariffCentsPerMin`/`callTariffCentsPerMin` (`src/billing/metering.js`) |
| OUT-14 | B3 | gruen: Kommentar "16 Glieder" vs. 17er-Kette | **bestaetigt** (Zaehlung heute): der Kommentar sagt "16 Glieder", das `gates`-Array traegt **17** `name:`-Eintraege (`outbound_frozen`, `resolve_identity`, `tenant_reject`, `normalize_target`, `trunk_zero_normalized`, `kyc`, `owner_name`, `resolve_profile`, `number_gate`, `valid_text`, `valid_mandate`, `assistant_context`, `resolve_outbound`, `budget`, `minutes`, `compute_reserve`, `reserve_budget`) | - | - | `gates`-Array + Modul-Kommentar (`src/telephony/outbound-gates.js`) |
| OUT-15 | B3 | gruen: Notruf-Denylist gewinnt | bestaetigt: die Denylist-Pruefung liegt im `number_gate` VOR der Land-/Allowlist-Lockerung; `allowlistError` hebt ausdruecklich "NUR dieses Gate" auf, "alle harten Gates davor (Denylist/Land/Limit) liefen schon" | - | - | `numberGateError`/`allowlistError`, `isDenied` (`src/telephony/outbound-gates.js`, `src/telephony/number-denylist.js`) |
| OUT-16 | B3 | unbekannt | bestaetigt: `isTrunkZeroFormatError` delegiert an `hasTrunkZeroAfterCountryCode`, das nur ueber `TRUNK_ZERO_COUNTRY_CODES = ["+49","+33","+44"]` laeuft - `+1` ist dort nicht enthalten, der Pre-Check ist fuer NANP nie einschlaegig | - | - | `isTrunkZeroFormatError` (`src/telephony/outbound-gates.js`), `TRUNK_ZERO_COUNTRY_CODES` (`src/store/defaults.js`) |
| OUT-17 | B3 | gruen: `normNum` bereinigt US-Trennzeichen | bestaetigt: `normNum` ist die EINE Normalisierungsquelle und idempotent; der NANP-Zweig von `normalizeDialTarget` ruft sie ausdruecklich vorweg, weil NANP-Schreibweisen "ueblicherweise Trennzeichen tragen" | - | - | `normNum`, NANP-Zweig (`src/store/defaults.js`) |
| OUT-18 | B3 | gruen: US-Testnummer einziger Negativfall | Testsuiten-Aussage, nicht Produktionscode. Produktionsseitig bestaetigt: `OWNER_TEST_NUMBER = +15005550006` ist die einzige NANP-Nummer im Test-Fixture-Satz | - | - | `OWNER_TEST_NUMBER`/`DOMESTIC_TEST_NUMBER` (`test/helpers.js`) |
| OUT-22 | B3 | gruen: leeres `allowedCountryCodes` = keine Einschraenkung | bestaetigt: `return !p \|\| !p.length \|\| matchesPrefix(to, p)`; das Default-Profil traegt `allowedCountryCodes: []` | - | - | `countryGateAllowed` (`src/telephony/outbound-gates.js`), Default-Profil (`src/store/defaults.js`, `src/plans.js`) |
| OUT-23 | B3 | gruen: Casing irrelevant | bestaetigt: Praefix-Vergleiche laufen ausschliesslich ueber E.164-Ziffernstrings (`+49`...), es gibt keinen Buchstaben, der ein Casing tragen koennte | - | - | `matchesPrefix`, `TRUNK_ZERO_COUNTRY_CODES` |
| OUT-27 | B3 | gruen: Assistant-Origination reicht `to` durch | bestaetigt: `startAssistant`/der Telnyx-Origination-Body traegt keine eigene Land-Logik; normalisiert wird ausschliesslich im Gate `normalize_target` | - | - | `normalize_target`-Gate (`src/telephony/outbound-gates.js`), telnyx `voice.js` |
| OUT-28 | B3 | gruen: Gate-Reihenfolge deterministisch | bestaetigt: die Reihenfolge ist EXPLIZIT ein geordnetes Array und per Snapshot-Test festgenagelt (`test/outbound-gates-order.test.js`); erste Verletzung gewinnt (`for`-Schleife, erstes Denial bricht ab) | - | - | `gates`-Array (`src/telephony/outbound-gates.js`) |
| FMT-20 | B3 | gruen: E.164 akzeptiert NANP | bestaetigt: `E164` ist ein generischer E.164-Regex ohne Landfilter; die NANP-Sonderbehandlung liegt separat in `normalizeDialTarget` | - | - | `E164` (`src/store/defaults.js` via `src/routes/_validation.js`) |
| FMT-21 | B3 | gruen: `TRUNK_ZERO_COUNTRY_CODES` betrifft `+1` nicht | **bestaetigt woertlich**: `["+49","+33","+44"]`; `+1` liegt in der separaten `NANP_COUNTRY_CODE`-Achse mit eigener Konvention ("dort gilt die 'fuehrende 0'-Regel, hier gilt sie NIE") | - | - | `TRUNK_ZERO_COUNTRY_CODES`, `NANP_COUNTRY_CODE` (`src/store/defaults.js`) |
| FMT-22 | B3 | gruen: reiner US-Tenant -> `homeCountryCode()` null | bestaetigt mit Praezisierung: `homeCountryCode` liefert `+1` NUR, wenn `tenantCountryIso` ein NANP-Land ist (`isNanpCountry`); ein Tenant mit `country="US"` bekommt also `+1`, ein NICHT-NANP-Tenant mit US-DID bekommt `null` | **TEIL** | GAP-25-Review-Fix (NANP-Zweig) | `homeCountryCode`, `NANP_ISO_COUNTRIES` (`src/store/defaults.js`) |

### 2.4 W2-B4 - Geld: Tarif, Metering, Plan-Decken (19)

| ID | Block | Katalog-Erwartung (07-22) | gemessene Lage | Abweichung? | Ursache / Fix-Phase | Beleg (Symbol/Datei) |
| --- | --- | --- | --- | --- | --- | --- |
| PAY-01 | B4 | gruen: Katalog bleibt EUR + Cross-Package-identisch | bestaetigt serverseitig: beide Plaene tragen `currency: "eur"`. Die Cross-Package-Haelfte (`apps/web`) ist beim Testbau gegen die dortige Preisdarstellung zu pruefen - der Scope-Doc-Kandidat "Entscheidung 7.1: EUR ueberall" ist damit serverseitig eingeloest | **TEIL** | Entscheidung 7.1 | `PLAN_CATALOG` (`src/plans.js`) |
| PAY-06 | B4 | unbekannt | Mechanismus vorhanden: `costTruingDelayMinutes` (Default 30) steuert die Verzoegerung, der Sweep laeuft ueber `src/billing/cost-truing.js`. Die Decken-Befreiung ist gegen den Reserve-/Cap-Pfad zu messen | - | LCT-Kette + LCT-FIX-1 | `costTruingDelayMinutes` (`src/config.js`), `src/billing/cost-truing.js` |
| PAY-08 | B4 | gruen: Inbound zieht nie Tenant-Budget | **bestaetigt woertlich**: `reconcileOutboundVoiceBudget` beginnt mit `if (call.direction !== "outbound") return;` | - | - | `reconcileOutboundVoiceBudget` (`src/billing/metering.js`) |
| PAY-09 | B4 | gruen: Inbound rechnet mit Auslandstarif, wenn `call.to` US-DID | bestaetigt: `callTariffCentsPerMin` ruft fuer Inbound `tariffCentsPerMin(call.to, call.to)` - beide Achsen sind die eigene DID. Eine US-DID liegt nicht in `VOICE_TARIFF_DOMESTIC_PREFIXES` -> `voiceTariffDefaultCents` | - | - | `callTariffCentsPerMin` (`src/billing/metering.js`) |
| PAY-10 | B4 | gruen: `costCents` geht nicht an Stripe | bestaetigt: `recordVoiceMinuteMeter` schreibt `costCents` in das lokale `usage_event`-Ledger; der Stripe-Meter-Pfad meldet `quantity` | - | - | `recordVoiceMinuteMeter` (`src/billing/metering.js`), `src/billing/meter.js` |
| PAY-12 | B4 | gruen: 402-Text hartkodiertes Deutsch | **ueberholt**: die Ablehnungstexte kommen aus `localeFor(store.tenantLanguage(tenantId)).gates` | **JA** | Fix-Phase P15/T2 | `gateTexts` (`src/telephony/outbound-gates.js`), `gates`-Bundle (`src/i18n/locales.js`) |
| PAY-15 | B4 | gruen: `planCapCents` fail-closed bei unbekanntem Slug | **bestaetigt woertlich**: `throw new Error("planCapCents: unbekannter Plan-Slug ...")` bei fehlendem Katalog- ODER Kopffreiheit-Eintrag | - | - | `planCapCents` (`src/billing/plan-caps.js`) |
| PAY-16 | B4 | gruen: neuer Plan ohne `PLAN_CAP_HEADROOM` blockiert sofort | bestaetigt: derselbe `throw` greift, sobald `PLAN_CAP_HEADROOM[planSlug]` fehlt - auch wenn der Plan im `PLAN_CATALOG` steht | - | - | `PLAN_CAP_HEADROOM`, `planCapCents` (`src/billing/plan-caps.js`) |
| PAY-17 | B4 | gruen: US-Hold identisch zum DE-Default | bestaetigt: `COUNTRY_SEARCH_PARAMS.US` traegt **kein** `holdAmountCents`; `holdAmountForCountry` liefert deshalb den `defaultHoldCents` des Aufrufers | - | - | `holdAmountForCountry`, `COUNTRY_SEARCH_PARAMS` (`src/telephony/provisioning-geo.js`) |
| PAY-20 | B4 | gruen: `providerToBucketRateMicro` ohne Drift-Alarm | **ueberholt**: es gibt einen Drift-/Kalibrierungspfad (`providerRateOutOfBand` im Boot-Guard, `src/billing/cost-calibration.js` mit `warnPercent`/`minSamples`) | **JA** | LCT-Kette (Kosten-Kalibrierung) | `providerRateOutOfBand` (`src/boot.js`), `src/billing/cost-calibration.js` |
| PAY-22 | B4 | gruen: unbekannte Vorwahl -> teurer Default | bestaetigt: Inlands-Tarif nur bei Treffer in `VOICE_TARIFF_DOMESTIC_PREFIXES` an BEIDEN Achsen, sonst `voiceTariffDefaultCents` (300 vs. 20 ct) | - | - | `tariffCentsPerMin` (`src/billing/metering.js`), `.env.example` |
| PAY-23 | B4 | gruen: Reserve exakt gleich Cap ist erlaubt | **bestaetigt woertlich**: `spent + reservationFor(...) + reserveCents > effectiveCapCents(...)` - strikt `>`, Gleichstand passiert | - | - | `reserveExceedsBudget` (`src/store/state-ops.js`) |
| PAY-24 | B4 | unbekannt | Mechanismus vorhanden: `effectiveCapCents` liest die Decke bei JEDER Pruefung neu (keine Zwischenspeicherung), ein Plan-Downgrade wirkt daher sofort auf die naechste Reserve-Pruefung | - | - | `effectiveCapCents`, `reserveExceedsBudget` (`src/store/state-ops.js`) |
| PAY-25 | B4 | unbekannt | **Praemisse traegt nicht**: `VOICE_TARIFF_DOMESTIC_PREFIXES` ist eine **Code-Konstante**, keine Env-Variable - `config.billing.voiceTariffDomesticPrefixes` wird direkt daraus gesetzt. `.env.example` dokumentiert `VOICE_TARIFF_DOMESTIC_CENTS`/`_DEFAULT_CENTS`/`_FULL_COST_FLOOR_CENTS`, aber kein `_PREFIXES` - korrekt, weil es keins gibt | **JA** | ID beruht auf einer nicht existierenden Env-Var | `VOICE_TARIFF_DOMESTIC_PREFIXES` (`src/config.js`), `.env.example` |
| PAY-26 | B4 | gruen: negative/NaN `max_duration_s` kann Reserve nicht senken | bestaetigt: `resolveMaxDurationS` filtert ueber eine `find`-Kette auf brauchbare Werte und klemmt hart auf `MAX_CALL_DURATION_CAP_S`; der Zod-Schema-Guard ist ausdruecklich nur Defense-in-depth ("der eigentliche Wurzelfix sitzt in outbound-gates.js") | - | S1-6 DiD | `resolveMaxDurationS` (`src/telephony/outbound-gates.js`) |
| GAP-06 | B4 | rot | **teilweise geschlossen**: `recordNumberMonthMeter` bucht die Nummern-Kosten, `numberMonthlyCostCents` speist die DID-Miet-Anzeige, und der Release-Reconciler (`tenant-prolif-d`) gibt gekuendigte DIDs frei (mit `RELEASE_GRACE_DAYS`). Offen ist die MONATLICHE Wiederholung der Miet-Buchung | **TEIL** | tenant-prolif-d + P6b3 | `recordNumberMonthMeter` (`src/billing/metering.js`), `numberMonthlyCostCents` (`src/config.js`), `releaseGraceMs` |
| GAP-08 | B4 | rot | **bestaetigt offen**: der USD/EUR-Kurs steht als nackte Zahl `usdToEur: 0.93` im `llm`-Namespace, waehrend die Provider-Achse ihre eigene Umrechnung ueber `providerToBucketRateMicro` fuehrt - **zwei** Quellen, nicht eine | - | - | `usdToEur` + `providerToBucketRateMicro` (`src/config.js`) |
| GAP-09 | B4 | rot | **teilweise geschlossen**: es gibt ein TTS-Zeichen-Kontingent mit Zyklus und Warnschwelle (`ttsCharacterQuota`, `ttsCharacterQuotaWarnPercent`, `ttsQuotaCycleAnchorDay`) und eine Schwellen-Erkennung. Offen ist die TENANT-Zurechenbarkeit (die ElevenLabs-Konfiguration ist global, nicht pro Tenant) und der definierte Zustand bei Erschoepfung | **TEIL** | - | `ttsCharacterQuota`-Kette (`src/config.js`, `src/store/state-ops.js`) |
| GAP-11 | B4 | rot | **teilweise geschlossen**: Hold und `usage_event`-Buchung nutzen ausdruecklich DIESELBE Quelle (`holdAmountForCountry(number.country, numberSetupFeeCents)`), damit "das Ledger nicht vom real gehaltenen/gecaptureten Betrag driftet". Offen bleibt der Abgleich gegen den REALEN Telnyx-Laenderpreis (die Tabelle traegt bewusst noch keinen Land-Wert) | **TEIL** | Fix-Phase P9 | `recordNumberMonthMeter` (`src/billing/metering.js`), `holdAmountForCountry` (`src/telephony/provisioning-geo.js`) |

### 2.5 W2-B5 - Provisioning und DID-Lebenszyklus (9)

| ID | Block | Katalog-Erwartung (07-22) | gemessene Lage | Abweichung? | Ursache / Fix-Phase | Beleg (Symbol/Datei) |
| --- | --- | --- | --- | --- | --- | --- |
| DID-05 | B5 | rot: Nicht-Tabellen-Laender kaufen unmarkiert DE | **bestaetigt offen**: `COUNTRY_SEARCH_PARAMS` traegt genau `FR`, `GB`, `US`. CA/IE/AU/CH/AT/ES/IT fallen in den Nicht-Treffer-Zweig -> `countryCode = config.provisioning.provisioningCountry` (Default `"DE"`), ohne Markierung | - | - | `COUNTRY_SEARCH_PARAMS`, `searchParamsForCountry` (`src/telephony/provisioning-geo.js`) |
| DID-08 | B5 | gruen: Order-Body ohne Regulatory-Differenzierung | **bestaetigt**: der Body ist `{phone_numbers:[{phone_number}]}` plus optional `connection_id` - kein Regulatory-/Dokumenten-Feld; der Fehlerpfad ist der generische `assertTelnyxOk` | - | - | `orderNumber` (`src/telephony/adapters/telnyx/numbers.js`) |
| DID-09 | B5 | rot: `phone_number_type` wird nie gesetzt | **bestaetigt offen**: `filter[phone_number_type]` wird in `searchNumbers` nur gesetzt, wenn `type` uebergeben wird; `type` entsteht nur aus `entry.phoneNumberType` - **kein** Tabelleneintrag traegt das Feld. Im Order-Body kommt es gar nicht vor | - | - | `searchNumbers`/`orderNumber` (`telnyx/numbers.js`), `COUNTRY_SEARCH_PARAMS` (`provisioning-geo.js`) |
| DID-11 | B5 | gruen: identischer Betrag fuer US/FR/GB/DE | **bestaetigt**: kein Tabelleneintrag traegt `holdAmountCents` -> alle vier Laender bekommen `defaultHoldCents` | - | - | `holdAmountForCountry` (`src/telephony/provisioning-geo.js`) |
| DID-17 | B5 | gruen: `RELEASE_GRACE_DAYS=0` + knapper Cap blockiert Signup | bestaetigt: `releaseGraceMs` hat `fallback: 0` (Observe-Only-Sentinel bleibt erhalten); die Cap-Pruefung laeuft ueber `maxNumbers`/`maxNumbersPerTenant` in `requestNumber` | - | tenant-prolif-d | `releaseGraceMs` (`src/config.js`), `requestNumber` (`src/store/state-ops.js`) |
| DID-19 | B5 | gruen: Idempotency-Key number-id-gebunden | bestaetigt: der Key ist number-id-basiert (`'hold_'+numberId`, dokumentiert im Billing-Port) und wird als `Idempotency-Key`-Header durchgereicht - keine Land-Dimension, damit keine Land-Kollision | - | - | `orderNumber` (`telnyx/numbers.js`), `idempotencyKey`-Vertrag (`src/billing/ports.js`) |
| GAP-19 | B5 | rot | **bestaetigt offen**: `forceNumberCountry` ueberschreibt ausdruecklich NUR das Kauf-Land, waehrend `tenant.country` das Herkunftsland bleibt. Die Divergenz ist im Code dokumentiert, aber es gibt keinen Waechter, der sie meldet | - | - | `forceNumberCountry` (`src/config.js`), `resolveNumberCountry` (`src/geo/resolve.js`, `src/self-service-routes.js`) |
| GAP-23 | B5 | rot | **bestaetigt offen**: keine Reputations-Messung im Repo; kein Symbol, das eine Rufnummern-Reputation liest oder den Nachschub daran stoppt | - | - | Negativbefund ueber `src/worker/provisioning*.js`, `src/telephony/adapters/telnyx/numbers.js` |
| GAP-34 | B5 | rot | **bestaetigt offen**: `runMigrations` ruft `backfillPeriodStart` und `backfillAccountEmailCase` - **keinen** Backfill fuer `country`/`language` | - | - | `backfillPeriodStart`, `backfillAccountEmailCase` (`src/db/migrate.js`) |

### 2.6 W2-B6 - Web, Dashboard, Widget-Oberflaechen (21)

| ID | Block | Katalog-Erwartung (07-22) | gemessene Lage | Abweichung? | Ursache / Fix-Phase | Beleg (Symbol/Datei) |
| --- | --- | --- | --- | --- | --- | --- |
| WEB-03 | B6 | gruen: Redirect erhaelt Query, EN-App-Shell | bestaetigt strukturell: der `/tenant.html`-Altpfad-Redirect haengt an `WEB_DIST_DIR`; die App-Shell wird aus `<webDistDir>/app/index.html` ausgeliefert (Astro-Build, EN-Marketing-Vorgabe) | - | Single-Origin P1 | `webDistDir` (`src/config.js`), Redirect + `/app/*`-Fallback (`src/app.js`, `src/wiring/web-login.js`) |
| WEB-07 | B6 | rot: `apps/web` bindet `agentStyle` nicht | **bestaetigt offen**: `grep` ueber `apps/web/src/` liefert **0** Treffer fuer `agentStyle` und `personaStyleIds` | - | - | Negativbefund `apps/web/src/`; Gegenbeleg `public/tenant.html` (Stil-Dropdown vorhanden) |
| WEB-08 | B6 | rot: Persona-Label deutsch trotz EN-Uebersetzung | **teilweise geschlossen**: die Optionen kommen serverseitig aus `s.personaStyleIds`, die Seiten-Formatlocale kommt vom Server (`formatLocale`). Ob das LABEL (`styleLabel`) uebersetzt ist, ist beim Testbau am `styleLabel`-Symbol zu messen | **TEIL** | P4 (Stil-Dropdown), P15b/C2 | `styleLabel`, `personaStyleIds` (`public/tenant.html`) |
| WEB-10 | B6 | gruen: `api-onboard.js` PUBLIC_URL-Fehler deutscher Klartext | **Praemisse fraglich**: in `apps/web/src/` gibt es heute **keine** `api/onboard`-Route und keinen `PUBLIC_URL`-Treffer; der Onboard-Endpunkt liegt serverseitig (`src/routes/api-onboard.js`) und seine Fehlertexte sind deutsch (z.B. der `privateNumber ungueltig`-Text) | **JA** | Single-Origin-Umbau | Negativbefund `apps/web/src/`; `src/routes/api-onboard.js` |
| WEB-13 | B6 | rot | **bestaetigt offen**: `SESSION_EXPIRED_PAGE` beginnt mit `<!doctype html><html lang="de">` und traegt deutschen Fliesstext | - | - | `SESSION_EXPIRED_PAGE` (`src/web-auth.js`) |
| WEB-18 | B6 | gruen: `apps/web` durchgaengig `en-US` | beim Testbau gegen die Datumsformatierung in `apps/web/src/` zu messen; die Marketing-Vorgabe (EN-Marketing/DE-Legal) stuetzt die Erwartung | - | W1-W4 Web-Overhaul | `apps/web/src/pages/` |
| WEB-19 | B6 | rot: keine UI fuer die private Rufnummer | **teilweise geschlossen**: `privateNumber` ist serverseitig ein gefuehrtes Feld (Onboard-Validierung `normalizePrivateNumber`, eigener Setter im Self-Service). Ob ein Dashboard sie ANZEIGT/aendern laesst, ist an `public/tenant.html`/`public/index.html` zu messen | **TEIL** | F2 (private Summary-Nummer) | `normalizePrivateNumber` (`src/routes/api-onboard.js`), Setter (`src/self-service-routes.js`) |
| WEB-25 | B6 | gruen: GB und IE mappen auf Englisch | **bestaetigt woertlich**: `LANGUAGE_FOR_COUNTRY` traegt `GB: "en"` und `IE: "en"`. Kontrast-Wirkung abgeschwaecht, weil unbekannte Laender seit P10 ebenfalls `"en"` liefern | **TEIL** | Weltdefault-Flip P10 | `LANGUAGE_FOR_COUNTRY` (`src/i18n/locales.js`) |
| UI-01 | B6 | Dict-Key-Paritaet ueber alle `WIDGET_DICT`-Sprachen | traegt unveraendert: `WIDGET_DICT` fuehrt `de`+`fr`, `DEFAULT_LOCALE = "en"` (die Keys SIND die englischen Texte) | - | - | `WIDGET_DICT`, `DEFAULT_LOCALE` (`src/ui/widget-i18n.js`) |
| UI-02 | B6 | EN-Fallback: unbekannter Key/Sprache -> Key selbst | **bestaetigt woertlich**: `translate` liefert bei `locale === DEFAULT_LOCALE` und bei fehlendem Tabelleneintrag den Key zurueck | - | - | `translate` (`src/ui/widget-i18n.js`) |
| UI-03 | B6 | Fallback-Kette bei fehlendem `navigator.language` | **ueberholt**: `navigator.language` ist als Sprachquelle entfallen - die Locale wird SERVERSEITIG aus der Agentensprache entschieden und als Literal ins Iframe-Script eingesetzt | **JA** | Fix-Phase P13/E4 | `resolveWidgetLocale`, `buildI18nScript` (`src/ui/widget-i18n.js`), `withI18nScript` (`src/ui/widget-catalog.js`) |
| UI-04 | B6 | `documentElement.lang` auf die aufgeloeste Locale | Mechanismus vorhanden, Quelle aber serverseitig (s. UI-03) - beim Testbau gegen die servergerenderte Locale formulieren, nicht gegen ein Browser-Signal | **TEIL** | P13/E4 | `buildI18nScript` (`src/ui/widget-i18n.js`) |
| UI-05 | B6 | `I18N_SCRIPT` in allen 5 Widgets im head | traegt unveraendert: `withI18nScript` ersetzt den `I18N_PLACEHOLDER` in jeder Basis-HTML; die Matrix wird ueber `WIDGET_LOCALES` vorgebaut | - | - | `withI18nScript`, `WIDGET_BASE_HTML`, `WIDGET_HTML_BY_LOCALE` (`src/ui/widget-catalog.js`) |
| UI-06 | B6 | statische `data-i18n`-Defaults byte-identisch zum Key | traegt unveraendert: `localizeStaticLabels` setzt `textContent = t(key)`; ohne Script bleibt das Markup = Key = englischer Text | - | - | `localizeStaticLabels` (`src/ui/widget-i18n.js`) |
| UI-07 | B6 | OCP: neue Sprache = EIN `WIDGET_DICT`-Eintrag | traegt unveraendert: `WIDGET_LOCALES` und `WIDGET_HTML_BY_LOCALE` leiten sich beide aus `WIDGET_DICT` ab | - | - | `WIDGET_LOCALES`, `widgetDictFor` (`src/ui/widget-i18n.js`) |
| UI-13 | B6 | XSS-Disziplin: nur `textContent` | traegt unveraendert: `localizeStaticLabels` nutzt `textContent`, der Kommentar pinnt die Regel ("NIE innerHTML") - gilt fuer den Bind-Pfad gleichermassen | - | - | `localizeStaticLabels` (`src/ui/widget-i18n.js`), `src/ui/widget-bind.js` |
| UI-15 | B6 | fehlende Dict-Sprache -> Englisch, Agentensprache unberuehrt | traegt unveraendert und ist seit P13/E4 SCHAERFER: `resolveWidgetLocale` ist im Produktivpfad die Identitaet auf der bereits aufgeloesten Agentensprache, ein unbekannter Wert faellt fail-safe auf `DEFAULT_LOCALE` | - | P13/E4 | `resolveWidgetLocale` (`src/ui/widget-i18n.js`) |
| UI-19 | B6 | zwei Betrachter sehen unterschiedliche Chrome-Sprache | **ueberholt**: die Locale steht servergerendert fest, ist also fuer alle Betrachter derselben Karte identisch - genau die Divergenz, die UI-19 beschreibt, existiert nicht mehr | **JA** | Fix-Phase P13/E4 | `WIDGET_HTML_BY_LOCALE` (`src/ui/widget-catalog.js`) |
| FMT-15 | B6 | rot: `tenant.html` formatiert immer `de-DE` | **ueberholt**: `formatLocale` kommt vom SERVER (`formatLocale: localeFor(language).dateLocale`) und wird per `setFormatLocale(s.formatLocale)` gesetzt; `STATIC_FORMAT_LOCALE = "de-DE"` ist nur noch der Vor-`/state`-Fallback (401/403-Pfad) | **JA** | Fix-Phase P15b/C2 | `formatLocale`/`setFormatLocale`/`STATIC_FORMAT_LOCALE` (`public/tenant.html`), `formatLocale`-Feld (`src/self-service-routes.js`) |
| GAP-30 | B6 | rot | offen zu messen: der Server validiert gegen `defaultSettings()` + `OPTIONAL_ENUM_FIELDS`; der Frontend-Feldkatalog liegt in `public/tenant.html`. Es gibt keine gemeinsame Quelle beider Kataloge -> Erwartung "rot" plausibel, beim Testbau gegen beide Symbole zu pruefen | - | - | `updateSettings`/`defaultSettings` (`src/store/state-ops.js`), Formularfelder (`public/tenant.html`) |
| GAP-37 | B6 | rot | **Praemisse traegt nicht**: `buildFilter` existiert im Repo nicht (0 Treffer ausserhalb `node_modules`). Zu pruefen ist stattdessen der `WEB_DIST_DIR`-Mount gegen die Auth-Gate-Reihenfolge | **JA** | Symbol umbenannt/entfallen | Negativbefund `buildFilter`; `webDistDir`-Mount (`src/app.js`) |

### 2.7 W2-B7 - Rest: MCP, Sicherungs-Vertraege, Formate (12)

| ID | Block | Katalog-Erwartung (07-22) | gemessene Lage | Abweichung? | Ursache / Fix-Phase | Beleg (Symbol/Datei) |
| --- | --- | --- | --- | --- | --- | --- |
| MCP-14 | B7 | gruen: deutsche Text-Artefakte auch ohne Widget-Host | **teilweise geschlossen**: die Stufe-0-Textbloecke laufen ueber `text()`/`errText()`; die Tool-Beschreibungen sind seit P15 englisch und per `EXPECTED_MARKERS` gepinnt. Verbleibende deutsche Artefakte sind einzeln zu messen, nicht pauschal anzunehmen | **TEIL** | Fix-Phase P15 (O14) | `text`/`errText` (`src/mcp-tools.js`), `test/p15-mcp-tool-descriptions-en.test.js` |
| MCP-16 | B7 | gruen: kein Sprach-Leak bei parallelen `/mcp`-Requests | bestaetigt strukturell: `/mcp` ist stateless; die Sprache wird PRO REQUEST am Transport aufgeloest (`views.tenantLanguage -> resolveCallLanguage`) und als `language` in `registerTools` gereicht - kein modulweiter Sprach-State | - | P12 | `registerTools`-Signatur (`src/mcp-tools.js`), `src/routes/mcp.js` |
| LAW-14 | B7 | gruen: `tenantId` UND `--confirm` | **bestaetigt woertlich**: `if (!tenantId \|\| !confirmed)` -> Usage + Abbruch | - | - | `scripts/erase-tenant.js` |
| LAW-15 | B7 | gruen: 30/7 Tage, fail-closed bei 0 | Defaults bestaetigt (`retentionDays` fallback 30, `diagnosticRetentionDays` eigener Wert). **Achtung beim Testbau**: `retentionDays` hat `min: 0` - der Wert 0 ist konfigurierbar; die "fail-closed bei 0"-Haelfte ist am Konsumenten zu messen, nicht am `numEnv`-Guard | **TEIL** | - | `retentionDays`, `diagnosticRetentionDays` (`src/config.js`) |
| LAW-18 | B7 | gruen: Fallback auf `DEFAULT_COUNTRY`/`DEFAULT_LANGUAGE` | Mechanismus bestaetigt: `resolveOnboardCountry` endet auf `fallbackCountry \|\| DEFAULT_COUNTRY`; die Sprache leitet sich daraus ueber `languageForCountry` ab. **Der Sprach-Endwert ist seit P10 `"en"`**, nicht `"de"` | **TEIL** | Weltdefault-Flip P10 | `resolveOnboardCountry` (`src/geo/resolve.js`), `languageForCountry` (`src/i18n/locales.js`) |
| LAW-22 | B7 | unbekannt | Mechanismus vorhanden: der Onboard-Abschnitt laeuft im prozess-lokalen Single-Writer-Guard `withStoreLock` (vgl. LANG-23), damit sind zwei parallele Onboardings serialisiert. **Sprach-Erwartung im Katalogtext ("je isoliert DE-Sprache") ist seit P10 falsch** - fuer US ist es `"en"` | **JA** | Weltdefault-Flip P10 | `withStoreLock` (`src/store.js`), Onboard-Handler (`src/routes/api-onboard.js`) |
| FMT-23 | B7 | unbekannt | `firstNameOf` ist eine modul-private Funktion in `state-ops.js`, genutzt von `tenantContext`. Verhalten bei CJK-Namen ohne Leerzeichen ist am Symbol zu messen (Split-Strategie) | - | - | `firstNameOf` (`src/store/state-ops.js`) |
| FMT-24 | B7 | unbekannt | **bestaetigt**: `escapeXml` ersetzt ausschliesslich `& < > " '` - CJK-Zeichen laufen unveraendert durch | - | - | `escapeXml` (`src/telephony/adapters/telnyx/render.js`) |
| FMT-27 | B7 | gruen: `number.language="en"` uebersteuert `tenant.defaultLanguage="de"` | **bestaetigt**: `numberRecord?.language` steht in der Praezedenz VOR `tenant?.defaultLanguage` | - | - | `resolveCallLanguage` (`src/store/state-ops.js`) |
| FMT-30 | B7 | gruen: Spend-Monat-Achse UTC-verankert | **bestaetigt**: `spendMonthEndDate` rechnet ausschliesslich mit `Date.UTC`/`getUTC*` und schneidet die ISO-Zeichenkette; `nowMs` kommt vom Aufrufer (Modul bleibt zeit-frei) | - | - | `spendMonthEndDate`, `spendMonthKeyOf` (`src/store/defaults.js`) |
| GAP-26 | B7 | rot | **bestaetigt offen**: ein am Dauer-Cap terminalisierter Call wird mit `terminateCappedCall(call.id, call.twilioSid, "failed")` beendet - er traegt denselben Status wie jeder andere Fehlschlag, kein maschinenlesbares Cap-Merkmal | - | - | `terminateCappedCall`, `rearmActiveCallTimers` (`src/telephony/call-lifecycle.js`) |
| GAP-31 | B7 | rot: Locale-Feld ohne Produktionskonsument | **teilweise geschlossen**: der im Katalog benannte Beispielfall `greetingDefault` HAT heute einen Konsumenten (`greetingTemplatesFor` speist das Self-Service-Dropdown). Die allgemeine Aussage bleibt zu messen - feldweise, nicht am Beispiel | **TEIL** | Fix-Phase P15 | `greetingDefault` (`src/i18n/locales.js`), `greetingTemplatesFor` (`src/i18n/greeting-catalog.js`), `greetingTemplates` (`src/self-service-routes.js`) |

---

## 3. Abweichungen (nur die gekippten Erwartungen)

Alle nach **R-G** festgehalten: die gemessene Lage schlaegt die Katalog-Erwartung vom 07-22.

### 3.1 FMT-01 - erledigt, Buchhaltung statt Testbau

Die Katalog-Erwartung "der `now`-Zeitstempel traegt keine `timeZone`-Option" ist **ueberholt**.
`promptInputs` (`src/claude.js`) loest `resolveTimezone(store.tenantTimezone(call.tenantId))` auf
und uebergibt `timeZone` an `toLocaleString`. Getragen von `test/p8-prompt-timezone.test.js`
(3 Tests). FMT-01 wurde deshalb schon in `18-w2-scope.md` §2 aus dem Testvorrat gestrichen;
umgesetzt ist hier nur der Referenz-Kommentar (Auftrag 3, §5).

### 3.2 Weltdefault-Flip (P10) - der breiteste Treffer

Siehe §1.1. Betrifft LANG-09 (echte Polaritaets-Umkehr: US liefert `"en"`, nicht `"de"`),
LANG-17, LANG-21, PROMPT-17, FMT-22, WEB-25, LAW-18, LAW-22 und DID-05.

**LANG-09 ist die einzige davon, deren Katalog-Aussage inhaltlich FALSCH geworden ist** ("US
unveraenderlich `de`"); die uebrigen behalten ihren Mechanismus und aendern nur den Endwert.

### 3.3 Sprach-Bausteine P11/P15/T2 - drei Defekt-IDs sind geschlossen

| ID | war | ist |
| --- | --- | --- |
| PROMPT-08 | `assistantContextSection`-Labels hart deutsch | Labels aus `loc.prompt.background` |
| PROMPT-22 | `mandateSection` hart deutsch | Texte aus `loc.prompt.mandate` |
| PAY-12 | Budget-402-Text hartkodiertes Deutsch | `localeFor(store.tenantLanguage(tenantId)).gates` |

Diese drei duerfen NICHT mehr als "hart deutsch" gepinnt werden - ein solcher Test waere genau
der Mischsprach-/Defekt-Pin, gegen den GAP-27 antritt.

### 3.4 Assistant-Fix-Kette - zwei "rot" erwartete Verhalten sind gebaut

VOICE-18 (`"multi"`/unbekannt -> `"auto"`) und VOICE-19 (`transcriptionFields(null)` -> `{}`)
sind in `transcriptionFields` explizit implementiert UND kommentiert. GAP-24 ist teilweise
geschlossen (Ingest-Pfad reicht `language` durch, Inbound-Pfad bewusst noch nicht).

### 3.5 P13/E4 - die Widget-Sprache kommt vom Server, nicht vom Browser

Der gesamte `navigator.language`-Strang in `12-sprachachsen-ui.md` (Achse A) ist ueberholt:
`resolveWidgetLocale(language)` bekommt die servergerenderte Agentensprache, `buildI18nScript`
setzt die Locale als Literal ins Iframe. Betrifft UI-03 (Praemisse entfaellt), UI-04
(Mechanismus bleibt, Quelle wechselt) und UI-19 (die beschriebene Divergenz existiert nicht mehr).

### 3.6 P15b/C2 - FMT-15 ist auf den Fallback zusammengeschrumpft

`tenant.html` bezieht `formatLocale` vom Server. `STATIC_FORMAT_LOCALE = "de-DE"` bleibt nur als
Vor-`/state`-Ausgangswert stehen (401/403-Pfad, gefuehrte Aktivierung). Ein Test darf FMT-15
deshalb nur noch fuer den Fallback-Zweig formulieren, nicht mehr fuer die Seite insgesamt.

### 3.7 Praemissen, die gar nicht (mehr) tragen

| ID | Befund |
| --- | --- |
| **LANG-15** | Der Scope-Doc-Hinweis "E3: `place_call.language` entfernt" ist **nicht** haltbar. Das Feld steht weiter im Zod-Schema und `test/p15-mcp-tool-descriptions-en.test.js` pinnt es in `EXPECTED_MARKERS`. Zu messen bleibt nur, dass es serverseitig ignoriert wird. **Nebenbefund:** die Beschreibung sagt weiterhin `default 'de'`, der Code-Default ist seit P10 `en` - eine echte, kleine Inkonsistenz in einer nutzersichtbaren Tool-Beschreibung. |
| **PAY-25** | "Env-Doku-Kohaerenz `VOICE_TARIFF_DOMESTIC_PREFIXES`" laeuft ins Leere: die Vorwahlliste ist eine **Code-Konstante**, keine Env-Variable. Es gibt nichts zu dokumentieren. |
| **PAY-20** | "ohne automatisierten Drift-Alarm" ist ueberholt: `providerRateOutOfBand` (Boot-Guard) und `src/billing/cost-calibration.js` (p95-Vergleich gegen `warnPercent`/`minSamples`) sind der Alarm. |
| **WEB-10** | `apps/web/src/` enthaelt heute weder eine `api/onboard`-Route noch einen `PUBLIC_URL`-Treffer - die ID beschreibt einen Stand vor dem Single-Origin-Umbau. |
| **GAP-37** | `buildFilter` existiert im Repo nicht (0 Treffer ausserhalb `node_modules`). Die ID braucht ein neues Subjekt oder faellt weg. |
| **OUT-18** | Ist eine Aussage ueber die TESTSUITE, nicht ueber `src/` - sie altert mit jedem neuen Test in W2 selbst. Beim Bau als Momentaufnahme kennzeichnen. |

### 3.8 GAP-34 - bestaetigt offen

`src/db/migrate.js` fuehrt `backfillPeriodStart` und `backfillAccountEmailCase`, **keinen**
Backfill fuer `country`/`language`. Die Erwartung "rot" traegt unveraendert.

---

## 4. GAP-27 - Befund, Abgrenzung und Abbruchpunkt-Urteil

### 4.1 Die Katalog-Belegstellen sind teilweise verschwunden

| Katalog-Beleg (GAP-27, `11-luecken-und-e2e.md`) | heute gemessen |
| --- | --- |
| `personal-assistant-characterization.test.js` SP5: `EXPECTED_SP_EN_OUT_FULL` beginnt mit `Du bist "Hermes"` | **weg.** Der Kommentar an derselben Stelle sagt: "SP4/SP5 (outbound fr/en byte-Pin) GELOESCHT (P11) ... Ersatz: `test/p11-agent-language-contract.test.js` (Sprach-Reinheit je Sprache)". Nur noch `EXPECTED_SP_DE_*` existiert. |
| `f1-geo-port.test.js` pinnt `languageForCountry("US") === DEFAULT_LANGUAGE` (= `de`) | **umgekehrt.** `DEFAULT_LANGUAGE` ist `"en"` (§1.1). Der Test heisst heute "`languageForCountry('US')` liefert `'en'` ... (ex DID-01)" - ein legitimer Pin, kein Defekt-Pin. |
| `f1-i18n-locale.test.js` pinnt `en.greetingDefault` (Feld ohne Konsumenten) | Der Test prueft dort heute **Eigenschaften** (`typeof`, `length > 0`, `includes("{owner}")`), keine Byte-Gleichheit. Der Sachverhalt "Feld ohne Konsument" traegt GAP-31 separat - und ist fuer `greetingDefault` inzwischen geschlossen (§2.7). |

### 4.2 Das Subjekt des Waechters ist eingegrenzt - bewusst, mit Messung belegt

Ein Waechter ueber *alle* Nicht-DE-Byte-Pins waere falsch. Gemessen sind heute **7** byte-genaue
Pins mit Nicht-DE-Sprachzuordnung, und sie zerfallen in zwei Gruppen:

1. der **Offenlegungssatz** in EN/FR (`f1-i18n-locale` OUT-24, `personal-assistant-characterization`
   D2/D3) - eine **absolute Regel** aus CLAUDE.md, deren Byte-Pin ausdruecklich *erwuenscht* ist;
2. kuratierte Bundle-/Direktiven-Werte (`personal-assistant-characterization` O3/O4/O7/O8).

Diese als "CHARAKTERISIERUNG" (= vorlaeufiger, zu behebender Ist-Zustand) zu etikettieren waere
**aktiv schaedlich**: es erklaerte eine Sicherheits-Invariante zum Provisorium.

Der Defekt, den GAP-27 wirklich meint, ist der **Mischsprach-Pin**: eine Erwartung, die als
*nicht-deutsch* ausgewiesen ist, aber deutschen Wortlaut traegt - genau der historische SP5-Fall.
Die verbindliche Regel steht im Kopf von `test/helpers/characterization-scan.mjs`:

> Ein byte-genauer Pin, dessen **Ist-Operand** eine Nicht-DE-Sprache ausweist und dessen
> **Erwartungs-Operand** deutschen Text enthaelt, ist nur zulaessig, wenn (a) Testname **oder**
> Dateiname ihn als CHARAKTERISIERUNG kennzeichnet **UND** (b) dieselbe Datei einen
> Sprachreinheits-Eigenschaftstest gegen `GERMAN_STOPWORDS` traegt. Fehlt eines von beiden, ist
> es ein Befund.

Das ist die Soll-Formulierung aus `11-luecken-und-e2e.md` GAP-27 ("traegt die Kennzeichnung UND
hat einen begleitenden Eigenschafts-Test") - angewandt dort, wo sie beisst. Die Abweichung vom
woertlichen "jeden Test finden, der einen Nicht-DE-Sprachwert byte-genau pinnt" ist nach **R-G**
hiermit festgehalten, nicht stillschweigend gedreht.

### 4.3 Messergebnis: GAP-27 ist GRUEN

- **7** Nicht-DE-Byte-Pins in der Suite,
- **0** davon mit deutschem Text im Erwartungswert,
- also **0 Befunde**.

Gegenprobe gegen synthetische Fixtures (Selbsttests 2-6 in `test/characterization-marking.test.js`):
der historische SP5-Fall wird **erkannt**; ein sprachreiner EN-Pin und deutsches Rauschen in
Kommentar/Testname/Assertions-Meldung werden **nicht** als Befund gemeldet.

### 4.4 Bewusste Grenzen (Ratschen-Mechanismus, kein Beweis)

Der Waechter sieht **nicht**:

1. Pins, deren Ist-Operand gar keine Sprachmarkierung traegt (z.B. LANG-16, die Inbound-Ablehnung
   ohne `language`-Argument);
2. berechnete Erwartungswerte (Funktionsaufruf statt Literal/Konstante);
3. Template-Literale, deren deutscher Anteil aus einer Substitution stammt, die **nicht** modulweit
   als `const NAME = "..."` deklariert ist.

Gegen das lautlose Stumpfwerden stehen vier Sicherungen im Test: die Erkennungs-Selbsttests,
die Laengentreue-Invariante ueber alle echten Testdateien, die Lebendigkeits-Untergrenze
(`MIN_EXPECTED_NON_DE_PINS`) und die Assertion, dass genau eine Testdatei keinen Testblock liefert.

### 4.5 Abbruchpunkt-Urteil

**GAP-27 ist gruen -> der Abbruchpunkt aus `PLAN-I18N-TESTS.md` §5 greift nicht -> B1-B7 duerfen
starten.**

Wuerde GAP-27 kuenftig rot, ist **nicht** die Regel zu entschaerfen, sondern der gefundene
Mischsprach-Pin zu melden und W2 anzuhalten.

---

## 5. Auftrag 3 - Buchhaltung FMT-01

Referenz-Kommentar an `test/p8-prompt-timezone.test.js` nachgetragen (Muster: die vier W1-Faelle
VOICE-02/03/08 und LANG-06). Kein neuer Test, kein Duplikat (G5). Kein Testname geaendert -> die
drei Tests bleiben im Regressionslauf. Die Ausnahme-Aufzaehlung in `package.json`
(`_comment_i18nCatalogPattern`) wurde entsprechend von `VOICE-02/03/08/17` auf
`VOICE-02/03/08/17, LANG-06, FMT-01` erweitert.

---

## 6. Gemessene Lauf-Zahlen (dieser Branch)

| Lauf | Ergebnis |
| --- | --- |
| `node --test test/characterization-marking.test.js` | 9 / 9 pass / 0 fail |
| `npm run test:gates` | **korrigiert: 33 / 30 pass / 3 fail** (vorher 24/21/3; +9 GAP-27, alle gruen). Rot bleiben unveraendert GAP-05 und GAP-15 x2. |
| `npm test` | **korrigiert: 3295 / 3295 pass / 0 fail** (zweiter Lauf). Der erste Lauf hatte 1 Fehlschlag in `test/request-tenant.test.js` (V4) - isoliert gruen (4/4) und im Wiederholungslauf gruen, also ein Voll-Last-Flake derselben Klasse wie der dokumentierte `p5-gate-proof`-Spawn-Race; nach R-F kein echtes Rot. |

**Zahlen-Klarstellung (wichtig fuer Folgebloecke):** `18-w2-scope.md` §1 nennt "3307" fuer
`npm test`. Das ist die **rohe** `# tests`-Zahl von node:test, nicht die korrigierte. Roh misst
dieser Branch **3308** - die neue Datei steuert genau EINEN Datei-Wrapper bei, der von
`countPhantomWrapperEntries` wieder abgezogen wird. Die **korrigierte** Zahl ist vorher wie
nachher **3295**; der Testbestand des Regressionslaufs aendert sich durch W2-B0 nicht.

---

## 7. Getragene Risiken

Unveraendert aus [`18-w2-scope.md`](18-w2-scope.md) §2 uebernommen, hier nur verwiesen:

- **Kalender-Achse hart deutsch**: `public/calendar.html` und `public/calls.html` formatieren
  dauerhaft deutsch, auch fuer EN-Tenants. Kein Launch-Gate, weil der Agent nicht bucht
  (FMT-29/FMT-06/FMT-31/UI-12 gestrichen).
- **LAW-13, GAP-16, GAP-17**: Loeschendpunkt, `audit_log`-Retention und Subprozessor-Verzeichnis
  sind Policy-Entscheidungen, die kein Test entscheidet.
- **PROMPT-21**: die Farewell-Kalibrierung bleibt fuer EN/FR ungemessen (bewusst - ein
  Tabelleneintrag entsteht erst nach einer echten Messung in der jeweiligen Sprache).
- **VOICE-12 / GAP-09**: die ElevenLabs-Stimme und das TTS-Kontingent sind global konfiguriert,
  nicht pro Tenant/Sprache.
