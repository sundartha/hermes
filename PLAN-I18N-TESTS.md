# PLAN-I18N-TESTS.md - Internationalisierungs-Testkatalog vor dem Launch

Stand: 2026-07-22 | Basis-Commit: `566ccd6` (master) | Quelle: elf Bereichs-Kataloge unter
`tasks/i18n-tests/`, fuenf Pre-Mortem-Linsen mit 68 Ausfallmodi, alle Befunde am Code belegt.

**Dieses Dokument ist ein Testplan, kein Umsetzungsplan.** Es beschreibt, was VOR dem Launch
bewiesen werden muss - nicht, wie die gefundenen Defekte behoben werden.

---

## 1. Zweck und Geltungsbereich

### 1.1 Zweck

Der Katalog soll VOR dem Start beweisen, dass ein Nutzer AUSSERHALB Deutschlands ein
funktionierendes Produkt bekommt: englischer Agent, englisches Widget, englische
Zusammenfassungen, kein durchschlagendes Deutsch, funktionierende Auslandstelefonie,
korrektes Geld und korrektes Recht. Jeder Test hat eine ID, eine Prioritaet, einen Modus,
eine erwartbare Farbe fuer den HEUTIGEN Code-Stand und mindestens einen Beleg
`datei.js:ZEILE`.

### 1.2 Marktreihenfolge (bindend fuer die Prioritaeten)

> **UEBERHOLT durch die Owner-Entscheidung 7.11 (2026-07-25): weltweiter Start ohne
> Reihenfolge, Inbound und Outbound gleichzeitig.** Die Rangfolge unten gilt nicht mehr als
> Prioritaets-Massstab. Der Absatz bleibt als Beleglage stehen; die Prioritaeten der
> Einzeltests bleiben unveraendert gueltig, weil sie an Schwere und Wurzel haengen, nicht am
> Marktrang. Neu hinzu kommt die Sprachachse fuer Laender ohne eigenes Bundle (7.12).

1. **USA** - primaerer Zielmarkt. Alles, was hier bricht, ist P0.
2. **UK / Irland** - zweiter Markt. `GB`/`IE` sind bereits auf `en` gemappt
   (`src/i18n/locales.js:273-274`), der Pfad ist aber nie live verifiziert worden.
3. **EU-englischsprachig** - Nachlauf, keine eigene Testachse in diesem Katalog.

Bestand DE/FR bleibt in jedem Test die Regressionsachse: kein Test darf einen Fix
rechtfertigen, der den deutschen oder franzoesischen Bestand veraendert.

### 1.3 Was dieser Katalog abdeckt

- Sprach-Aufloesungskette von der Registrierung bis zum gesprochenen Satz (Sektion 01)
- LLM-/Prompt-Schicht inkl. Tool-Definitionen und Pre-Call-Briefing (02)
- Telefonie-Renderschicht: TTS-Stimme, STT-Locale, Assistant-Pfad, Realtime (03)
- MCP-Schicht und die Widgets in claude.ai (04)
- Auslandstelefonie, Laender-Gate, Wahlziel-Normalisierung (05)
- Nummern-Provisioning und DID-Lebenszyklus pro Land (06)
- Geld: Waehrung, Preise, Steuern, Budget-Gates, Ist-Kosten (07)
- Web, Dashboard, Self-Service, Onboarding-Texte (08)
- Recht und Compliance pro Land (09)
- Zeitzonen, Formate, Kalender, Datenmodell (10)
- Luecken, die kein Einzelbereich besitzt, und echte Ende-zu-Ende-Ketten (11)

### 1.4 Was dieser Katalog AUSDRUECKLICH NICHT abdeckt

- **Nicht-englische Zusatzmaerkte.** FR ist Bestand und wird nur als Regressionsachse
  mitgezogen; ES/IT/PT/NL/CJK haben keine Tests. Einzige Ausnahme: FMT-23/FMT-24 pruefen,
  ob CJK-Namen den Renderpfad ueberhaupt unbeschadet passieren.
- **Rechtsgutachten.** LAW-* pinnen ausschliesslich, was im Code vorhanden bzw. abwesend
  ist. Ob eine Rechtsgrundlage traegt, ob ein Consent-Modell genuegt, ob ein Impressum
  vollstaendig ist, entscheidet kein Test (siehe Abschnitt 7).
- **Steuerberatung.** GAP-02 prueft nur, ob eine bereits getroffene Steuer-Entscheidung im
  Stripe-Checkout ankommt.
- **Sprachqualitaets-Benchmarks.** Der bestehende `npm run convo-bench` (n>=5) misst
  Gespraechsqualitaet; dieser Katalog misst Sprach-KORREKTHEIT, nicht Gespraechsguete.
- **Der Realtime-Pfad als Produktpfad.** Live laeuft die Budget-Engine
  (`src/config.js:959`). VOICE-15/16 und LAW-24 pinnen den Realtime-Zweig nur, damit ein
  spaeterer Engine-Wechsel nicht lautlos die Sprachachse verliert.
- **Der Infra-/URL-Cutover (Track B).** Repo-Verzeichnis, Render-Service und Brand-URL
  tragen weiter `vodafone-agent`; das ist kein i18n-Thema.
- **Last- und Performance-Tests.** GAP-22 rechnet das Turn-Budget nach, misst es aber nicht
  unter echter transatlantischer Latenz.
- **Der Nachweis, dass ein Fix funktioniert.** Der Katalog beschreibt Tests gegen den
  Ist-Stand. Tests mit Erwartung "rot" sind Launch-Gates, keine Regressionstests.

---

## 2. Kurzurteil

> **Korrektur nach der Live-Messung vom 2026-07-22** (Schritt 2, Beleg:
> [`tasks/i18n-tests/13-live-env-befund.md`](tasks/i18n-tests/13-live-env-befund.md)):
> Punkt 4 unten ist **falsch**. `ALLOWED_COUNTRY_CODES` steht live auf **`*`** - das Land-Gate
> ist weltweit offen, jede `+1` passiert es. Es sind **drei** geschlossene Stellen, nicht vier
> (Registrierung, Sprache, Tarif). Das Risiko waechst dadurch: weltweites Waehlen ist offen,
> waehrend Consent-Gate, Anrufzeitfenster und DNC-Pruefung weiterhin fehlen (Punkt 8). Was den
> US-Verkehr real stoppt, ist Punkt 5 - und live mit schaerferen Zahlen als hier notiert:
> **1500 ct Reserve gegen 600 ct Tenant-Decke**, jeder Nicht-Inlands-Anruf ueber 120 s Wunsch-
> dauer wird abgelehnt, bevor er beginnt. Der Dienst warnt davor in **jedem einzelnen Boot**.

1. **Nein - Hermes ist heute international NICHT startklar.** Der US-Pfad ist nicht
   unvollstaendig, er ist an vier unabhaengigen Stellen strukturell geschlossen.
2. **Ein US-Interessent kann sich nicht einmal registrieren.**
   `src/routes/api-onboard.js:125` ruft `normalizePrivateNumber(privateNumber)` einarmig auf
   und erbt damit den Default `allowedCodes = ["+49"]` aus `src/store/defaults.js:541` -
   jede `+1`-Handynummer wird mit 400 abgewiesen (FMT-10, FMT-11, E2E-05).
3. **Wer es doch ins System schafft, bekommt einen deutschen Agenten.**
   `LANGUAGE_FOR_COUNTRY` (`src/i18n/locales.js:268-275`) kennt `DE/AT/CH/FR/GB/IE` und kein
   `US`; `languageForCountry("US")` liefert `"de"` (`locales.js:278-280`,
   `src/store/defaults.js:331`). Der Wert wird beim Onboarding einmal persistiert
   (`api-onboard.js:147`) und gewinnt danach jede Praezedenz (`state-ops.js:648-651`).
4. **Er darf niemanden in den USA anrufen.** `ALLOWED_COUNTRY_CODES` steht per Code-Default
   UND per Blueprint auf `+49,+33,+44` (`src/config.js:666`, `render.yaml:141-142`); das
   Land-Gate (`src/telephony/outbound-gates.js:179-183`) lehnt jedes `+1`-Ziel mit 403 ab.
5. **Und selbst nach dieser Freischaltung waere jeder US-Anruf unbezahlbar.**
   `VOICE_TARIFF_DOMESTIC_PREFIXES` (`src/config.js:105`) kennt `+1` nicht, die Reserve
   rechnet `300 ct/min * ceil(180 s / 60 s) = 900 ct` gegen eine Starter-Decke von 300 ct -
   402 bei 0,00 EUR Verbrauch (PAY-04, PAY-05).
6. **Die Testsuite kann diese vier Defekte nicht sehen.** `test/helpers.js` `BASE_ENV`
   neutralisiert genau sie: `ALLOWED_COUNTRY_CODES="*"` (`:84`), Tarife auf `0` (`:263-264`),
   Tenant-Decke auf `0` (`:268`). Kein Test faehrt die ausgelieferte Konfiguration (GAP-33).
7. **Ein Test zementiert den Defekt sogar als Sollzustand.** `test/f1-geo-port.test.js:61`
   pinnt `languageForCountry("US") === DEFAULT_LANGUAGE`, und
   `test/personal-assistant-characterization.test.js:333-346` pinnt den deutschen EN-Prompt
   byte-genau (GAP-27, DID-15, LAW-25).
8. **Rechtlich fehlt der gesamte US-Rahmen.** Kein Consent-Gate, kein Anrufzeitfenster in
   Zielortszeit, kein Opt-out, keine Rueckrufnummer in der Offenlegung, keine englischen
   Rechtstexte - `grep` auf `consent|TCPA|do-not-call|timeZone` in `src/` liefert null
   einschlaegige Treffer (LAW-06, LAW-07, GAP-12, GAP-13, GAP-15).
9. **Geld und Recht laufen zusaetzlich gegen die Marge.** EUR-Katalog im USD-Markt
   (`src/plans.js:21,29`), keine Steuer im Checkout, kein Dispute-/Refund-Pfad,
   plattformweites Stundenlimit von 6, Lebenszeit-Budgettopf statt Perioden-Topf.
10. **Haerteste Wahrheit:** Von 302 Tests sind 114 heute rot und 156 gruen - aber ein
    grosser Teil des Gruens ist gruen, WEIL es den Defekt als Ist-Zustand pinnt. Nicht die
    Zahl der roten Tests ist das Problem, sondern dass keiner davon heute existiert.

---

## 3. Pre-Mortem - verdichtet und dedupliziert

Fuenf Linsen (GELD, RECHT, TELEFONIE, SPRACHE, OPS) haben 68 Ausfallmodi geliefert. Viele
beschreiben denselben Code-Defekt aus verschiedenen Blickwinkeln. Verdichtet bleiben
**30 Wurzeln (W1-W30)**. Jede Wurzel steht genau einmal - in der Linse, in der sie zuerst
sichtbar wird - mit den Modus-IDs aller Linsen, die auf sie zeigen.

Legende Schwere: S1 = Launch-Blocker, S2 = ernst, S3 = Politur.

### 3.1 Linse SPRACHE/UX

| Wurzel | Schwere | Ursache (Beleg) | Frueheste Erkennung | Test |
| --- | --- | --- | --- | --- |
| **W1** `US` fehlt in `LANGUAGE_FOR_COUNTRY`; jedes unbekannte Land faellt fail-safe auf `de`<br>= PM-SPRACHE-01, PM-RECHT-03, PM-TEL-02, PM-OPS-03 | S1 | `src/i18n/locales.js:268-275` (nur DE/AT/CH/FR/GB/IE), `:278-280` (Fallback), `src/store/defaults.js:331`; geschrieben in `src/routes/api-onboard.js:147` und `src/billing/provision-trigger.js:42` | Antwort von `POST /api/onboard` mit `country=US` enthaelt `language:"de"` - im Klartext, vor jedem Anruf | LANG-01, LANG-10, DID-01, DID-02, WEB-22, FMT-07, FMT-08, E2E-05 |
| **W8** Prompt-Geruest, `toolDefs()` und vier sprachlose Konstanten sind deutsch<br>= PM-SPRACHE-03, PM-SPRACHE-05, PM-SPRACHE-08 | S1 | `src/claude.js:56-247` (sechs von sieben Sektionen deutsche Literale), `:303-353` (`toolDefs` locale-frei), `:407-419` (`OUTBOUND_OPENING_BOOTSTRAP`, `INBOUND_OPENING_BOOTSTRAP`, `SILENT_TURN_MARKER`, `END_CALL_WAIT_INSTRUCTION`), `:389` (`take_message`-`tool_result`); `src/mcp-tools.js:376,400` (deutsche `objective`-Beispiele) | Ein `console.log(systemPrompt(call))` fuer `language="en"` beginnt mit `Du bist "Hermes"` | PROMPT-01, PROMPT-02, PROMPT-08, PROMPT-22, GAP-28, GAP-29, E2E-06 |
| **W7/W6-Sprachteil** Inbound-Begruessung ist strukturell nie englisch<br>= PM-SPRACHE-02 | S1 | `src/store/defaults.js:320-321,336` (`DEFAULT_GREETING` hart deutsch), `src/routes/voice.js:265` (liest `settings.greeting`), `src/self-service.js:29-33` (drei deutsche Vorlagen, fail-closed), `src/i18n/locales.js:249-250` (`greetingDefault` ohne Konsumenten) | `grep -rn greetingDefault src/` -> nur `locales.js` selbst: ein Locale-Feld ohne Leser | PROMPT-03, LANG-11, LANG-12, LANG-13, WEB-04, WEB-05, GAP-31 |
| **W9** Alle nutzersichtbaren Rahmen-, Fehler- und Ablehnungstexte sind deutsch<br>= PM-SPRACHE-06, PM-SPRACHE-07 | S1 | `src/telephony/call-finish.js:57,80-81,95` (SMS/Notification), `src/telephony/outbound-gates.js:278-297,329-351` (Gate-Ablehnungen inkl. Env-Name nach aussen), `src/mcp-tools.js:65-67,77-79,108-110,339-342`, `src/web-auth.js:31-36,115-117,223,284`, `src/routes/voice.js:231` | Ein einziger `curl -X POST /api/calls` mit `+1`-Ziel liefert deutschen Text im JSON | WEB-14, WEB-09, WEB-11, WEB-12, WEB-13, MCP-04, MCP-05, MCP-06, PAY-12, LANG-16 |
| **W29** `public/tenant.html` ist zu 100 % deutsch, ohne Sprachumschalter; das zweite Frontend driftet<br>= PM-SPRACHE-10 | S1 | `public/tenant.html:2` (`lang="de"`), `:215` (`Intl.NumberFormat("de-DE")`), `:319` (`toLocaleString("de-DE")`), `grep -c data-i18n` = 0; `apps/web/src/lib/api.js:442-448` gegen `src/self-service.js:20` | Browser mit `Accept-Language: en-US` auf `/tenant.html` | WEB-01, WEB-17, VOICE-10, FMT-14, FMT-15, PAY-11, GAP-30 |
| **W10** Englisch ist ausschliesslich britisch; Play-TTS haengt den Sprach-Seam ganz ab<br>= PM-SPRACHE-11, PM-SPRACHE-12, PM-TEL-07, PM-TEL-09, PM-OPS-12 | S1 | `src/i18n/locales.js:219-221` (`en-GB` fuer `dateLocale`/`sttLocale`), `src/telephony/adapters/telnyx/render.js:24`, `adapters/twilio/render.js:17`; `src/config.js:243` (EINE globale `voiceId`), `src/tts/directive-synth.js:45-53`, `telnyx/render.js:86` (`<Play>` verwirft `voiceProfile`) | `grep -rn "en-US" src/` -> 0 Treffer; gerendertes TeXML mit Play-TTS enthaelt kein Sprachmerkmal | VOICE-01, VOICE-02, VOICE-03, VOICE-12, VOICE-13, VOICE-26, LAW-17, FMT-09 |
| **W23-Sprachteil** Die Suite pinnt den deutschen EN-Prompt als Sollzustand<br>= PM-SPRACHE-04 | S1 | `test/personal-assistant-characterization.test.js:215-221,333-346` (`EXPECTED_SP_EN_OUT_FULL` beginnt mit `Du bist "Hermes"`), `test/f1-i18n-locale.test.js:133-153` (gruener Test fuer totes Feld) | Der Testname selbst: "byte-identisch" beschreibt ein Ist, wurde als Soll gelesen | GAP-27, DID-15, LAW-25, MCP-12 |

### 3.2 Linse TELEFONIE / ZUSTELLUNG

| Wurzel | Schwere | Ursache (Beleg) | Frueheste Erkennung | Test |
| --- | --- | --- | --- | --- |
| **W2** Land-Gate laesst `+1` nie durch<br>= PM-TEL-01, PM-OPS-01 | S1 | `src/config.js:666` (Default `+49,+33,+44`), `render.yaml:141-142`, `.env.example:126`; geprueft in `src/telephony/outbound-gates.js:179-183`; `src/plans.js:102` kann nur verengen | Boot-Banner `src/boot.js:285` nennt die Liste bei JEDEM Start; danach `place_call_denied grund=land` | OUT-01, OUT-13, LANG-08, PAY-13, LAW-04, E2E-05 |
| **W4** `privateNumber` steht fest auf `+49`<br>= PM-TEL-04, PM-RECHT-10, PM-OPS-14 | S1 | `src/store/defaults.js:541` (`allowedCodes = ["+49"]` als Default-Parameter); Aufrufer reichen nie durch: `src/routes/api-onboard.js:125`, `src/store/pg.js:446-447`, `src/store/json.js:709-710`, `src/self-service-routes.js:270`; Folge: `src/sms-summary.js:26` -> `no_private_number` | 400 auf `POST /api/onboard` mit Text "privateNumber ungueltig" - vor jedem Tenant | FMT-10, FMT-11, E2E-05 |
| **W21** `normalizeDialTarget` verwandelt `011...` still in eine gueltige falsche `+49`-Nummer<br>= PM-TEL-14 | S1 | `src/store/defaults.js:517` (`INTERNATIONAL_CALL_PREFIX="00"`, NANP nutzt `011`), `:525-532`, `:486` (`TRUNK_ZERO_COUNTRY_CODES`), `:506-513`, `:477` (E.164 laesst 13 Ziffern durch); Gate `outbound-gates.js:466-478`. In dieser Session verifiziert: `normalizeDialTarget("011441234567","+49")` -> `+4911441234567`, besteht `E164` | Diff zwischen dem im MCP uebergebenen `to` und dem im Audit stehenden `to` | GAP-25, OUT-05, OUT-05b, OUT-06, OUT-16, OUT-17, FMT-20, FMT-21 |
| **W16** Keine Anrufbeantworter-/IVR-Erkennung, kein DTMF, harte 3-Minuten-Decke<br>= PM-TEL-06, PM-TEL-15 | S1 | `grep machine_detection|answering_machine|AnsweredBy src/**/*.js` -> 0 Treffer; `telnyx/voice.js:638-665,697-718` (Origination-Body ohne AMD); `src/telephony/directives.js:17-23` (kein DTMF-Verb); `src/store/defaults.js:252-253`, `src/config.js:803-807`, `outbound-gates.js:132-138` | Erster `completed`-Call voller Dauer mit 0 substanziellen Gegenueber-Turns | GAP-21, GAP-26, OUT-20 |
| **W17** Turn-Budget sprengt den Provider-Hardcut, sobald Play-TTS an ist<br>= PM-TEL-08 | S1 | `src/config.js:145-151` (dokumentierte Rechnung 11250 ms, ohne TTS), `src/tts/directive-synth.js:31,38,44` (`await` je Direktive), `src/config.js:247-251` (`synthTimeoutMs=4000`) -> 15250 ms bei 15000 ms Hardcut, ohne Netz; `render.yaml:11` (Frankfurt) | Erster US-Anruf mit einem Anthropic-Retry: Retry-Zeile, danach Provider-Timeout ohne Terminalstatus | GAP-22 |
| **W18** Keine Nummern-Reputation: kein STIR/SHAKEN, kein CNAM, kein `phone_number_type`<br>= PM-TEL-11 | S1 | `grep cnam|stir|shaken|caller_id_name src/` -> 0 Treffer; `telnyx/numbers.js:68-95` (nur `country_code`+`features[]=voice`); `provisioning-geo.js:34-38` (kein `phoneNumberType`); `src/telephony/failure-reason.js:11-23` (klassifiziert, aggregiert nicht) | `no-answer`-Quote je DID ueber die ersten 20 Anrufe - vollstaendig aus vorhandenen `failureReason`-Werten berechenbar | GAP-23, DID-09 |
| **W19** EIN globaler Telnyx-Assistant fuer alle Tenants und Sprachen<br>= PM-TEL-12 | S2 | `src/config.js:276` (eine `assistantId`), `src/telnyx-origination.js:13-15` (bindet sie an JEDEN Call), `src/telnyx-inbound.js:41` (`startAssistant` ohne `language`), `telnyx/voice.js:293-297` (leeres Objekt ohne Sprache), `:201` (`STT_FLUX_HINTS` ohne Regionalvariante) | Zwei Calls verschiedener Sprachen tragen dieselbe `assistantId` in der DB | GAP-24, VOICE-14, VOICE-17, VOICE-18, VOICE-19 |
| **W20** Kein Barge-in im live laufenden Budget-Pfad<br>= PM-TEL-13 | S2 | `telnyx/render.js:111-119` und `twilio/render.js:29-37` (Gather ohne Barge-in-Attribut), `src/bridge.js:336-341` (nur im Realtime-Pfad), `src/config.js:959` (live = budget); mit Play-TTS zusaetzlich unteilbare mp3 (`directive-synth.js:40`) | Erstes Transkript mit woertlich wiederholtem Anrufer-Turn | VOICE-23, VOICE-24 |

### 3.3 Linse GELD / MARGE

| Wurzel | Schwere | Ursache (Beleg) | Frueheste Erkennung | Test |
| --- | --- | --- | --- | --- |
| **W3** Tarif-Tabelle kennt `+1` nicht; die Reserve sprengt jede Plan-Decke<br>= PM-GELD-01, PM-TEL-03, PM-OPS-04 | S1 | `src/config.js:105` (`VOICE_TARIFF_DOMESTIC_PREFIXES` ohne `+1`, ohne Env-Ueberschreibung), `outbound-gates.js:145-149,664-672`, `src/config.js:463-466,803-807`, `src/billing/plan-caps.js:14-32`, `src/store/state-ops.js:2039-2042`: 300 * ceil(180/60) = 900 ct gegen 300 ct Starter-Decke | Boot-Guard sagt es woertlich, aber nur als WARN: `src/boot-guard.js:110-125` `WORST_CASE_UNAFFORDABLE` | PAY-04, PAY-05, PAY-07, PAY-22, PAY-23, GAP-32 |
| **W11** Lebenszeit-Topf statt Perioden-Topf, plattformweit geteilt, mit unbesetztem Alarmkanal<br>= PM-GELD-02, PM-GELD-09, PM-OPS-05 | S1 | `state-ops.js:1959-1961` (`gateUsageCents` liest bei `budgetMonthEnabled=false` den Lebenszeitwert), `:1095-1107` (nur die DECKE wird neu gesetzt), `:2154-2157` (Minuten-Achse rechnet dagegen periodisch), `:1973-1975,2195-2199`; `render.yaml:275-276,310-311,304-305`; `src/boot.js:162-165` (Alarmkanal nur WARN) | Erster Tenant in der zweiten Abrechnungsperiode: `remainingMinutes > 0` bei gleichzeitigem `grund=budget_tenant` | GAP-01, GAP-07, PAY-21 |
| **W12** `MAX_CALLS_PER_HOUR=6` ist ein PLATTFORM-Limit<br>= PM-GELD-13, PM-OPS-02 | S1 | `outbound-gates.js:190-192` (`globalHourReached` ohne Tenant-Filter, Kommentar bestaetigt es), `src/config.js:670-673`, `render.yaml:144-145`; `outbound-gates.js:195-201` kann nur senken; `src/plans.js:89-90,106` setzt bewusst `null` | Der siebte Outbound einer Stunde ueber ALLE Tenants; abgelehnte Requests stammen von verschiedenen `tenantId` | GAP-10 |
| **W13** EUR-Produkt im USD-Markt, ohne Steuer und ohne Waehrungsaufloesung<br>= PM-GELD-03, PM-GELD-04 | S1 | `src/plans.js:21,29` (`currency:"eur"`), `apps/web/src/lib/plans.js:13,29`, `apps/web/src/pages/preise.astro:33`, `src/config.js:362` (`paymentCurrency` Default `eur`), `render.yaml:186-187`; `src/billing/stripe.js:262-284` ohne `automatic_tax`/`tax_id_collection`/`billing_address_collection`, `:197-205` (`createCustomer` ohne Adresse) | Erste Stripe-Rechnung ohne Tax-Position und mit leerem `customer.address` | PAY-01, PAY-02, PAY-03, PAY-18, GAP-02, WEB-16, DID-12, DID-13, FMT-16, FMT-17, MCP-08, MCP-19 |
| **W14** Geld ohne Gegenleistung: Aktivierung, Gutschein, Dispute, DID-Miete<br>= PM-GELD-05, -06, -07, -08 | S1 | `src/billing/activation.js:61-74` (Status VOR `provision()`, Rueckgabe ignoriert), `worker/provisioning-orchestrator.js:112-120` (`dry_run` mit `ok:true`), `state-ops.js:1265-1268` (globaler Cap); `src/billing/stripe.js:279` (`allow_promotion_codes` fest), `:368-372`, `src/onboarding.js:93,134-138`; `src/billing/webhook.js:18-23,138-140` (vier Typen, Rest `IGNORE`); `src/config.js:730-731` + `src/release-reconcile.js:119` (Observe-Only), `src/billing/metering.js:80-88` (Miete einmalig) | Erster Tenant mit `stripeSubscriptionId` und ohne Nummer; erster Dispute ohne Audit-Eintrag; erste Subscription mit `total=0` und aktiver Nummer | GAP-03, GAP-04, GAP-05, GAP-06, GAP-11, DID-06, DID-14, DID-17, PAY-17 |
| **W30** Vermessungs-Defekte: zwei USD/EUR-Kurse, globales TTS-Kontingent, laenderblinder Hold, Inbound zu 300 ct/min<br>= PM-GELD-10, -11, -12, -14 | S2 | `src/config.js:990` (`usdToEur: 0.93` ohne `process.env`) gegen `:370-388` (`providerToBucketRateMicro = 920000` = 0,92); `src/config.js:548-553` + `src/tts/directive-synth.js:64` + `src/routes/api-billing.js:99-121` (reine Anzeige); `provisioning-geo.js:34-38,69-77` (US ohne `holdAmountCents`); `src/billing/metering.js:37-47` (kein Richtungsfilter im Meter) | Statisch: `0.93` gegen `0.92` im selben Commit. Operativ: erstes `voice_minute`-`usage_event` eines US-Tenants mit `direction=inbound` und `costCents/quantity = 300` | GAP-08, GAP-09, GAP-11, PAY-09, PAY-10, PAY-20, DID-11, PAY-17 |

### 3.4 Linse RECHT / COMPLIANCE

| Wurzel | Schwere | Ursache (Beleg) | Frueheste Erkennung | Test |
| --- | --- | --- | --- | --- |
| **W6** Kein Consent-, Opt-out- oder DNC-Konzept; die Offenlegung nennt keine Rueckrufnummer<br>= PM-RECHT-01, PM-RECHT-04 | S1 | `grep consent|einwillig|TCPA|do-not-call|robocall` ueber `src/`, `apps/web/src`, `test/` -> 0 Treffer; die 17-gliedrige Kette `outbound-gates.js:423-705` hat kein Consent-Glied; Offenlegungssatz rein namensbasiert (`locales.js:130-131,188-189,237-238`); `perTargetCapReached` (`:205-210`, Fenster `src/config.js:685-688`) heilt sich nach 24 h selbst; `profile.allowedNumbers` (`:241`) ist eine Erlaubnis-, keine Sperrliste | Erste Rueckruf-Welle auf die eigene DID; ein Ziel-`from`, das bereits als `to` eines frueheren Outbounds desselben Tenants existiert | LAW-05, LAW-06, LAW-09, LAW-10, GAP-12, GAP-13 |
| **W5** Kein Zeitzonen-Begriff im gesamten Repo - weder Gate noch Datenfeld noch Prompt-Anker<br>= PM-RECHT-02, PM-TEL-05, PM-SPRACHE-09, PM-OPS-15 | S1 | `grep timeZone|getHours|Intl.DateTimeFormat|Europe/` ueber `src/` -> ein einziger, unbeteiligter Treffer (`src/store/defaults.js:313`); `src/claude.js:43-50` (`toLocaleString` ohne `timeZone`); `outbound-gates.js:129-130,187` (beide Zeitbremsen sind zeitzonenlose Mengenlimits); kein `timezone`-Feld in `src/db/schema.sql:63-64,98,402-403` | Erste Zeile im Call-Log, deren `startedAt` in der NPA-Zeitzone des `to` vor 08:00 oder nach 21:00 liegt - aus `call.startedAt` + `call.to` sofort auswertbar | OUT-11, LAW-07, LAW-08, FMT-01, FMT-02, FMT-18, FMT-19, FMT-28, FMT-29 |
| **W7** Inbound hat gar keine erzwungene KI-/Transkriptions-Offenlegung; `updateSettings` ist fail-open<br>= PM-RECHT-05 | S1 | `src/routes/voice.js:265` (nimmt `settings.greeting` unveraendert), `state-ops.js:2509-2527` (`typeof`-Vergleich: jeder String passiert), `src/self-service.js:26-33` (Kommentar: Disclosure ist NICHT Teil des Greetings); Outbound-Satz sagt "zusammengefasst", nicht "transkribiert", waehrend Audio live an Deepgram geht (`telnyx/render.js:115`, `telnyx/voice.js:293-296`); `STATUS.md:140` vertagt EU-AI-Act Art. 50(2) auf 08/2026 | Erstes Inbound-Transkriptsegment (`voice.js:278`) ohne `AI`/`recorded`/`transcribed` | GAP-14, LAW-06, WEB-04, WEB-05, PROMPT-03 |
| **W22** Rechtstexte sind deutsche Platzhalter; der ANGERUFENE hat keinen Rechte-Pfad; `audit_log` speichert Rufnummern unbefristet<br>= PM-RECHT-06, PM-RECHT-07, PM-RECHT-08 | S1 | `apps/web/src/pages/` hat keine EN-Rechtsroute; `datenschutz.astro:2-4,23`, `agb.astro:33`, `impressum.astro:9` (Platzhalter, `lang="de"`); `src/db/schema.sql:495-506` (`audit_log` append-only, ausdruecklich ohne FK, ohne RLS), `src/audit-store.js:5-11` (nur INSERT), `state-ops.js:2458-2467` (`pruneOldData` fasst `audit_log` nie an), Zielnummern im Klartext in `outbound-gates.js:434,458,499,514,544,602,624,630,692,701`; Art.-15-Export ist tenant-gescoped (`src/routes/api-read.js:128`) | Deploy-Lauf, der `Platzhalter` in einer ausgelieferten Rechtsseite belaesst; SQL auf `audit_log` mit E.164-Regex ab Betriebstag 31 | GAP-15, GAP-16, GAP-17, LAW-11, LAW-12, LAW-13, LAW-14, LAW-15, LAW-23 |
| **W15** `+1` ist ein Kippschalter fuer den ganzen NANP; Notruf-Liste ist DE/UK-zentriert<br>= PM-RECHT-09, PM-TEL-10, PM-RECHT-12 | S2/S3 | `outbound-gates.js:127-128` (reines `startsWith`), `:58-90` (`PREMIUM_PREFIXES` ohne einen einzigen `+1`-Eintrag, Kommentar `:52-57` raeumt Unvollstaendigkeit ein), `:51` (`EMERGENCY_SHORT_CODES` = 110/112/911/999 - kein 988/711/101/111), `:273-281,541` (Nicht-E.164 faellt auf 400 `grund=format`, ausdruecklich OHNE Audit) | Erster erfolgreicher Outbound an ein `+1`-Ziel, dessen NPA nicht zu den 50 Bundesstaaten gehoert | GAP-18, GAP-20, OUT-09, OUT-10, OUT-15, OUT-19 |
| **W22b/W15b** CLI-Herkunft frei entkoppelbar (`FORCE_NUMBER_COUNTRY`)<br>= PM-RECHT-11 | S2 | `src/config.js:780-787` (ausdruecklich ENTKOPPELT vom Herkunftsland), `src/geo/resolve.js:35-37`, `render.yaml:175-176` (`US` global); `outbound-gates.js:315-318` nimmt die aktive Nummer ohne Bezug zur Zielvorwahl; kein STIR/SHAKEN im Repo | `answered`-Rate der betroffenen DID gegen eine landespassende DID, ueber 50 Anrufe | GAP-19, DID-10, DID-20, LAW-20, LANG-05 |

### 3.5 Linse OPS / KONFIGURATION / DEPLOY

| Wurzel | Schwere | Ursache (Beleg) | Frueheste Erkennung | Test |
| --- | --- | --- | --- | --- |
| **W23** Die Suite faehrt nie die ausgelieferte Konfiguration<br>= PM-OPS-06 | S1 | `test/helpers.js` `BASE_ENV`: `ALLOWED_COUNTRY_CODES="*"` (`:84`), `MAX_CALLS_PER_HOUR="100"` (`:85`), `VOICE_TARIFF_DOMESTIC_CENTS`/`DEFAULT_CENTS="0"` (`:263-264`), `DEFAULT_TENANT_BUDGET_CENTS="0"` (`:268`), `PLATFORM_SPEND_WARN_PERCENT="0"` (`:272`), `PER_TARGET_CALL_CAP="1000"` (`:293`); `grep ALLOWED_COUNTRY_CODES test/` findet nirgends `+1` | Statisch, jederzeit: die `BASE_ENV`-Liste selbst | GAP-33, E2E-05 |
| **W24** `GEO_ENABLED` fehlt in `render.yaml`; kein Frontend sendet `country`; kein Backfill<br>= PM-OPS-07, PM-OPS-08 | S1 | `src/config.js:794` (Default `false`), Schluessel kommt in `render.yaml` ueberhaupt nicht vor; `src/routes/api-onboard.js:141` -> `null`; `src/geo/resolve.js:23` -> `provisioningCountry="DE"` (`render.yaml:160-161`) waehrend `FORCE_NUMBER_COUNTRY="US"` (`:175-176`) nur das Kauf-Land aendert; `src/db/migrate.js` hat drei Backfills, keinen fuer `country`/`language` | Erste DB-Zeile: `tenant.country="DE"` bei `number.country="US"` | LANG-05, VOICE-05, VOICE-07, LANG-14, LANG-24, DID-16, OUT-21, WEB-26, GAP-34, E2E-01 |
| **W27-Vorstufe** Der reale Onboarding-Pfad ruft `setTenantGeo` nie auf | S1 | `src/wiring/web-login.js:98,102,148` (Browser-Login legt Tenant ohne Geo an), `src/routes/api-onboard.js:161,168` (einzige Aufrufer von `registerTenant`/`setTenantGeo`), `grep "/api/onboard" apps/web` -> 0 | `tenantGeo()` eines frisch eingeloggten Tenants liefert `{country:null, defaultLanguage:null}` | LANG-02, LANG-03, LANG-04, WEB-20, WEB-21, E2E-01, E2E-04 |
| **W25** Keine Metrik traegt Land oder Sprache; `METRICS_ENABLED=false`<br>= PM-OPS-09 | S1 | `src/metrics.js:33,57,65,75,86,95` (sechs Ereignisse, kein `country`/`language`), `src/config.js:191`, `render.yaml:338-339`; Audit-Detail bewusst PII-arm (`outbound-gates.js:120-124`) | Es gibt kein Laufzeitsignal - genau das IST der Befund | GAP-35 |
| **W26** `render.yaml` ist Doku, nicht Wahrheit; kein Rollback-Pfad; `/healthz` ohne Commit<br>= PM-OPS-10 | S1 | `render.yaml:15-17` (Selbstkommentar), `:395-396` (`MULTI_TENANT=false`), `:400-401` (`SELF_SERVICE_ENABLED=false`) - Werte, unter denen ein Self-Service-Launch nicht existieren kann; `src/app.js:107` (`/healthz` liefert nur `{ok:true}`), `src/boot.js:265-268` (Commit nur als TEMP-DIAGNOSE); Deploy geht auf den UPSTREAM-Remote | Boot-Banner `[boot] deployed commit=...` gegen den erwarteten SHA | GAP-36, MCP-19, DID-13, WEB-02 |
| **W28** `plan: free` und `preDeployCommand` am selben Service<br>= PM-OPS-13 | S1 | `render.yaml:13` gegen `:31`; Pre-Deploy laeuft im Free-Tier nie, waehrend `src/boot.js:228-234` fail-closed mit `exit(1)` abbricht; `scripts/bootstrap-tenant.js` seedet zusaetzlich ohne `country`/`language` -> `state-ops.js:673-677` erbt DE/de | Render-Deploy-Log ohne preDeploy-Abschnitt, gefolgt von `[boot] Keine aktive Nummer im Store` und `exit(1)` | GAP-38 |
| **W27** `buildFilter` schliesst `apps/web` aus, obwohl der Gateway es baut und ausliefert<br>= PM-OPS-11 | S2 | `render.yaml:22` (`buildCommand` baut `apps/web`), `:406-407` (`WEB_DIST_DIR="apps/web/dist"`) gegen `:42-45` (`ignoredPaths: apps/web/**`) | Erster Frontend-only-Commit auf `master`, nach dem Render keinen Deploy startet | GAP-37 |

### 3.6 Deckungsbilanz

Aus `tasks/i18n-tests/11-luecken-und-e2e.md` (Deckungsmatrix, dort je Ausfallmodus belegt):

| Urteil | Anzahl Ausfallmodi | Konsequenz |
| --- | --- | --- |
| gedeckt | 32 | Ein bestehender Bereichstest loest den Ausfallmodus tatsaechlich aus |
| teilweise | 24 | Ein Test klingt passend, seine Assertions treffen den Modus aber nicht - GAP-Test noetig |
| ungedeckt | 12 (davon **10 mit S1**) | Kein Test der Bereichs-Kataloge beruehrt den Modus - GAP-01/03/05/09/10/22/23/27/28/33/35/37/38 |

Die schwerwiegendste Einzelluecke ist **W23 (GAP-33)**: sie erklaert, warum die anderen
ungedeckt bleiben konnten.

---

## 4. Testkatalog-Uebersicht

### 4.1 Kennzahlen

| Kennzahl | Wert |
| --- | --- |
| Tests gesamt | **302** |
| P0 | 115 |
| P1 | 126 |
| P2 | 61 |
| Modus offline (`node --test` / `npm test` / statischer Check) | 276 |
| Modus manuell (Browser, Render-Dashboard, Abhoeren, Doku-Sichtung) | 22 |
| Modus live (echter Anruf, echtes Geld) | 4 |
| heute erwartbar **rot** | 114 |
| heute erwartbar **gruen** | 156 |
| heute erwartbar **unbekannt** (erst durch Ausfuehrung zu klaeren) | 32 |
| als Duplikat markierte Eintraege | 110 (in 30 Clustern) |
| verbleibende eigenstaendige Sachverhalte | 192 |

> **Nachtrag (Schritt 1 abgeschlossen).** Diese Kennzahlen sind der Rohstand der Synthese und
> in zwei Punkten ueberholt:
> 1. Die 20 Tests aus [`12-sprachachsen-ui.md`](tasks/i18n-tests/12-sprachachsen-ui.md)
>    (`UI-01` bis `UI-20`) fehlen in der Tabelle 4.2 - der Gesamtbestand ist **322**, nicht 302.
> 2. Die Duplikat-Cluster sind inzwischen verbindlich aufgeloest: 108 Eintraege entfallen,
>    **214 kanonische Tests** bleiben (201 sofort implementierbar, 13 durch Produkt-
>    entscheidungen blockiert).
>
> Verbindlicher Arbeitsvorrat ist ab hier
> [`tasks/i18n-tests/00-kanonische-liste.md`](tasks/i18n-tests/00-kanonische-liste.md).
> Die Tabellen 4.2 und 4.3 bleiben als Beleglage unveraendert stehen.

**Lesehilfe zu "gruen".** Ein grosser Teil der 156 gruenen Tests pinnt einen DEFEKT als
Ist-Zustand (z.B. LANG-01: `languageForCountry("US") === "de"` ist heute wahr). Gruen heisst
hier "der Test laeuft durch", nicht "das Produkt ist in Ordnung". Sieben Tests formulieren
denselben Sachverhalt bewusst gegen den Sollzustand und sind deshalb rot - siehe 4.3.

**Lesehilfe zu "rot".** Rot heisst "der Test faellt heute, und das ist der Befund". Kein
roter Test in diesem Katalog ist ein Regressionsfang; alle sind Launch-Gates.

### 4.2 Vollstaendige Tabelle

Spalte `Dubl.`: `Dxx (Leit)` = fuehrender Test des Duplikat-Clusters; `Dxx -> ID` = derselbe
Sachverhalt, bereits vom genannten Test abgedeckt. Duplikate sind bewusst nicht geloescht -
sie stehen in ihrem Bereichskatalog mit anderer Beleglage - aber sie duerfen bei der
Ausfuehrung uebersprungen werden, sobald der Leittest gelaufen ist.

| ID | Titel | Prio | Modus | heute erwartbar | Sektionsdatei | Dubl. |
| --- | --- | --- | --- | --- | --- | --- |
| LANG-01 | LANGUAGE_FOR_COUNTRY kennt US/CA/AU/NZ nicht (Mapping-Luecke) | P0 | offline | gruen | `01-sprachaufloesung.md` | D1 (Leit) |
| LANG-02 | Web-Login-Pfad setzt tenant.country/defaultLanguage nie | P0 | offline | gruen | `01-sprachaufloesung.md` | D27 (Leit) |
| LANG-03 | apps/web ruft POST /api/onboard nirgends auf | P0 | offline | gruen | `01-sprachaufloesung.md` | D27 -> LANG-02 |
| LANG-04 | tenantGeo() liefert {country:null, defaultLanguage:null} fuer nicht-onboardeten Tenant | P0 | offline | gruen | `01-sprachaufloesung.md` | D27 -> LANG-02 |
| LANG-05 | render.yaml: FORCE_NUMBER_COUNTRY=US widerspricht PROVISIONING_COUNTRY=DE | P0 | offline | gruen | `01-sprachaufloesung.md` | D22 -> DID-10 |
| LANG-06 | US-DID + de-Sprache bleibt gepinnt (Regressions-Schutz fuer die Entkopplung) | P0 | offline | gruen | `01-sprachaufloesung.md` |  |
| LANG-07 | Offenlegungssatz (Regel 2) bleibt Deutsch fuer strukturell falsch aufgeloeste US-Tenants | P0 | offline | gruen | `01-sprachaufloesung.md` |  |
| LANG-08 | ALLOWED_COUNTRY_CODES blockiert Outbound-Ziele in die USA (+1) per Default | P0 | offline | gruen | `01-sprachaufloesung.md` | D3 -> OUT-01 |
| LANG-09 | languageForCountry ist case-insensitiv, aber fuer US unveraenderlich "de" | P1 | offline | gruen | `01-sprachaufloesung.md` | D5 (Leit) |
| LANG-10 | End-to-End Onboard mit country=US liefert dennoch language=de | P0 | offline | gruen | `01-sprachaufloesung.md` | D2 (Leit) |
| LANG-11 | GREETING_TEMPLATES enthaelt keine EN/FR-Vorlage | P1 | offline | gruen | `01-sprachaufloesung.md` | D7 (Leit) |
| LANG-12 | settings.greeting wird unabhaengig von call.language gesprochen | P1 | offline | gruen | `01-sprachaufloesung.md` | D8 -> PROMPT-03 |
| LANG-13 | greetingDefault im Locale-Bundle ist toter Code | P2 | offline | gruen | `01-sprachaufloesung.md` | D9 (Leit) |
| LANG-14 | Kein Backfill/Migration fuer tenant.country/default_language | P1 | offline | gruen | `01-sprachaufloesung.md` | D10 (Leit) |
| LANG-15 | MCP place_call.language wird serverseitig ignoriert | P1 | offline | gruen | `01-sprachaufloesung.md` | D11 (Leit) |
| LANG-16 | Inbound-Ablehnung fuer unbekannte Zielnummer ist hart Deutsch | P1 | offline | gruen | `01-sprachaufloesung.md` |  |
| LANG-17 | resolveCallLanguage-Praezedenz vollstaendige Matrix (alle Falsy-Kombinationen) | P1 | offline | gruen | `01-sprachaufloesung.md` |  |
| LANG-18 | resolveCallLanguage mit falsch-case gespeichertem Sprachwert faellt via localeFor auf de zurueck | P1 | offline | gruen | `01-sprachaufloesung.md` | D6 -> LANG-19 |
| LANG-19 | updateSettings verwirft language="EN" (Grossschreibung) still, ohne Fehler | P2 | offline | gruen | `01-sprachaufloesung.md` | D6 (Leit) |
| LANG-20 | "Automatic (by number)"-UI-Label verschleiert den faktischen DE-Fallback | P2 | manuell | gruen | `01-sprachaufloesung.md` |  |
| LANG-21 | localeFor() Fail-Safe fuer unbekannte/leere/null Sprachcodes | P1 | offline | gruen | `01-sprachaufloesung.md` | D4 (Leit) |
| LANG-22 | Onboard body.country="us" (Kleinschreibung) normalisiert zu US, Sprache bleibt de | P1 | offline | gruen | `01-sprachaufloesung.md` | D2 -> LANG-10 |
| LANG-23 | Onboard-Kritischer-Abschnitt bleibt bei parallelen Requests atomar (Nebenlaeufigkeit) | P2 | offline | gruen | `01-sprachaufloesung.md` |  |
| LANG-24 | Bestandstenant ohne Geo bleibt nach Onboarding-Fix auf DE stehen (kein rueckwirkender Effekt) | P1 | offline | gruen | `01-sprachaufloesung.md` | D10 -> LANG-14 |
| LANG-25 | Live-Beweis: US-Empfaenger hoert bei Outbound-Call zuerst Deutsch (Regel-2-Verifikation am echten Anruf) | P0 | live | rot | `01-sprachaufloesung.md` |  |
| LANG-26 | Symmetrie-Beweis: Inbound und Outbound teilen exakt denselben Geo-Anker (keine Call-Parameter-Override moeglich) | P2 | offline | gruen | `01-sprachaufloesung.md` |  |
| PROMPT-01 | systemPrompt(en) enthaelt weiterhin ein durchgaengig deutsches Geruest | P0 | offline | gruen | `02-llm-prompts.md` |  |
| PROMPT-02 | toolDefs() bleibt fuer JEDE Sprache identisch deutsch | P0 | offline | gruen | `02-llm-prompts.md` |  |
| PROMPT-03 | Inbound-Greeting fuer einen EN-Tenant ist strukturell deutsch | P0 | offline | rot | `02-llm-prompts.md` | D8 (Leit) |
| PROMPT-04 | Self-Onboarding mit country='US' liefert language='de' | P0 | offline | gruen | `02-llm-prompts.md` | D2 -> LANG-10 |
| PROMPT-05 | Kein Dashboard-Weg, settings.language selbst zu korrigieren | P1 | manuell | gruen | `02-llm-prompts.md` | D14 -> WEB-01 |
| PROMPT-06 | fetchPrecallBriefing bekommt call.language nicht durchgereicht | P1 | offline | gruen | `02-llm-prompts.md` |  |
| PROMPT-07 | Briefing-System-Prompt gibt dem Modell keine Sprachvorgabe fuer die Freitextfelder | P1 | offline | gruen | `02-llm-prompts.md` |  |
| PROMPT-08 | assistantContextSection-Labels bleiben deutsch fuer einen EN-Call | P1 | offline | gruen | `02-llm-prompts.md` |  |
| PROMPT-09 | mcp-tools.js enthaelt keine einzige loc()/language-Verzweigung | P0 | offline | gruen | `02-llm-prompts.md` | D28 (Leit) |
| PROMPT-10 | fmt() in mcp-tools.js formatiert Datumswerte immer als de-DE | P1 | offline | gruen | `02-llm-prompts.md` | D13 -> FMT-03 |
| PROMPT-11 | mcp-tools.js Text-Ausgaben bleiben deutsch, egal welche Sprache der Aufrufer nutzt | P1 | offline | gruen | `02-llm-prompts.md` | D28 -> PROMPT-09 |
| PROMPT-12 | SMS-Zusammenfassung nach einem EN-Call traegt deutsche Rahmen-Labels | P1 | offline | gruen | `02-llm-prompts.md` | D12 -> WEB-14 |
| PROMPT-13 | Dashboard-Notification-Titel bleiben deutsch fuer EN-Calls | P2 | offline | gruen | `02-llm-prompts.md` | D12 -> WEB-14 |
| PROMPT-14 | End-to-End: ein simulierter EN-Call spricht an mindestens einer Stelle nachweisbar Deutsch | P0 | offline | rot | `02-llm-prompts.md` |  |
| PROMPT-15 | Edge Case: unbekannter Sprachcode faellt fail-safe auf de zurueck (Regressionsschutz) | P2 | offline | gruen | `02-llm-prompts.md` | D4 -> LANG-21 |
| PROMPT-16 | Edge Case: Grossschreibung "EN" wird von localeFor NICHT normalisiert | P2 | offline | gruen | `02-llm-prompts.md` | D6 -> LANG-19 |
| PROMPT-17 | Edge Case: Legacy-Nummer ohne language-Feld durchlaeuft die Praezedenzkette korrekt | P1 | offline | gruen | `02-llm-prompts.md` |  |
| PROMPT-18 | Edge Case: paralleler EN- und DE-Call faerben sich nicht gegenseitig ab | P2 | offline | gruen | `02-llm-prompts.md` |  |
| PROMPT-19 | GREETING_TEMPLATES sind alle drei deutsch, keine EN/FR-Vorlage waehlbar | P1 | offline | gruen | `02-llm-prompts.md` | D7 -> LANG-11 |
| PROMPT-20 | Gemischter Zustand: settings.language="en" aendert das Greeting NICHT | P0 | offline | gruen | `02-llm-prompts.md` | D8 -> PROMPT-03 |
| PROMPT-21 | Farewell-Delay-Kalibrierung nur fuer 'de' gemessen; EN/FR nutzen die alte, ungemessene Fallback-Kalibrierung | P2 | offline | gruen | `02-llm-prompts.md` |  |
| PROMPT-22 | mandateSection bleibt deutsch, auch wenn ein EN-Call ein Mandat traegt | P1 | offline | gruen | `02-llm-prompts.md` |  |
| PROMPT-23 | Manueller Pre-Launch-Smoke-Call: echter EN-Anruf auf Deutsch-Drift abhoeren | P0 | live | unbekannt | `02-llm-prompts.md` |  |
| PROMPT-24 | Fail-closed: localeFor mit unerwartetem Typ (Zahl/Objekt) crasht nicht | P2 | offline | gruen | `02-llm-prompts.md` | D4 -> LANG-21 |
| VOICE-01 | EN-Locale-Bundle bleibt auf en-GB gepinnt (sttLocale + dateLocale) | P0 | offline | gruen | `03-telefonie-render.md` | D16 (Leit) |
| VOICE-02 | Twilio-TwiML fuer EN nutzt Polly.Amy-Neural + en-GB (TTS UND STT) | P0 | offline | gruen | `03-telefonie-render.md` |  |
| VOICE-03 | Telnyx-TeXML fuer EN nutzt Azure.en-GB-SoniaNeural + en-GB (TTS UND STT) | P0 | offline | gruen | `03-telefonie-render.md` |  |
| VOICE-04 | languageForCountry("US") liefert weiterhin "de" (dokumentierter Launch-Blocker) | P0 | offline | gruen | `03-telefonie-render.md` | D1 -> LANG-01 |
| VOICE-05 | GEO_ENABLED Default AUS: proposedCountry ist immer null ohne Env-Flag | P1 | offline | gruen | `03-telefonie-render.md` |  |
| VOICE-06 | POST /api/onboard mit explizitem body.country="US" liefert TROTZDEM language="de" | P0 | offline | unbekannt | `03-telefonie-render.md` | D2 -> LANG-10 |
| VOICE-07 | Kein Frontend im Repo sendet body.country an POST /api/onboard | P1 | offline | gruen | `03-telefonie-render.md` | D27 -> LANG-02 |
| VOICE-08 | resolveCallLanguage-Praezedenz bleibt vierstufig (settings > number > tenant > default) | P0 | offline | gruen | `03-telefonie-render.md` |  |
| VOICE-09 | Self-Service POST /api/settings mit language="en" setzt und validiert korrekt | P1 | offline | unbekannt | `03-telefonie-render.md` |  |
| VOICE-10 | public/tenant.html hat kein UI-Element zum Sprachwechsel | P1 | offline | gruen | `03-telefonie-render.md` | D14 -> WEB-01 |
| VOICE-11 | place_call MCP-Tool: language-Parameter ist dokumentiert wirkungslos | P1 | offline | unbekannt | `03-telefonie-render.md` | D11 -> LANG-15 |
| VOICE-12 | ElevenLabs-Say traegt fuer alle drei Sprachen dieselbe Voice-ID, kein language-Attribut | P1 | offline | gruen | `03-telefonie-render.md` | D20 (Leit) |
| VOICE-13 | Play-TTS-Direktiven-Synth nutzt EINEN globalen voiceId fuer jede call.language | P1 | offline | unbekannt | `03-telefonie-render.md` | D20 -> VOICE-12 |
| VOICE-14 | Telnyx-Assistant-Config hat EIN voice_settings-Feld ohne Sprach-Dimension | P2 | offline | gruen | `03-telefonie-render.md` | D20 -> VOICE-12 |
| VOICE-15 | Realtime-Engine: EN-Call setzt whisperLocale="en" + realtimeVoice=REALTIME_VOICE_EN | P1 | offline | gruen | `03-telefonie-render.md` |  |
| VOICE-16 | DE-Realtime bleibt ohne Whisper-language-Feld (Auto-Detect, Bestand) | P2 | offline | gruen | `03-telefonie-render.md` |  |
| VOICE-17 | Telnyx-Assistant STT-Hint deckt "en" explizit ab (kein Fallback auf auto) | P0 | offline | rot | `03-telefonie-render.md` |  |
| VOICE-18 | Telnyx-Assistant STT-Hint faellt fuer unbekannte Sprache (z.B. "xx", "multi") fail-open auf "auto" | P1 | offline | rot | `03-telefonie-render.md` |  |
| VOICE-19 | transcriptionFields(null/undefined) liefert leeres Objekt (Bestand byte-identisch) | P2 | offline | rot | `03-telefonie-render.md` |  |
| VOICE-20 | languageForCountry ist gross-/kleinschreibungs-unabhaengig (Edge Case) | P2 | offline | unbekannt | `03-telefonie-render.md` | D5 -> LANG-09 |
| VOICE-21 | localeFor() faellt bei unbekanntem/leerem/grossgeschriebenem language-Wert auf DE zurueck | P0 | offline | unbekannt | `03-telefonie-render.md` | D4 -> LANG-21 |
| VOICE-22 | Twilio-STT-Modell bleibt sprachunabhaengig konstant (deepgram_nova-2-general) | P2 | offline | gruen | `03-telefonie-render.md` |  |
| VOICE-23 | Budget-Engine (Twilio+Telnyx Gather) setzt fuer keine Sprache ein Barge-in-/Interrupt-Attribut | P1 | offline | gruen | `03-telefonie-render.md` |  |
| VOICE-24 | Telnyx-Assistant-Pfad hat Barge-in AN (Kontrast zur Budget-Engine) | P2 | offline | gruen | `03-telefonie-render.md` |  |
| VOICE-25 | Konkurrierende Calls mit unterschiedlicher Sprache leaken keine Voice-/STT-Werte (Nebenlaeufigkeit) | P1 | offline | gruen | `03-telefonie-render.md` |  |
| VOICE-26 | dateLocale=en-GB liefert GB-Datumsformat im claude.js-Prompt (nicht US-Format) | P2 | offline | rot | `03-telefonie-render.md` | D16 -> VOICE-01 |
| VOICE-27 | Live-Smoke: echter EN-Outbound-Call klingt hoerbar britisch, nicht US-amerikanisch | P1 | manuell | unbekannt | `03-telefonie-render.md` |  |
| VOICE-28 | Live-Smoke: US-STT-Erkennungsguete (amerikanischer Akzent) mit en-GB-Locale | P1 | manuell | unbekannt | `03-telefonie-render.md` |  |
| VOICE-29 | Fail-closed-Beweis: unbekanntes voiceProfile wirft in BEIDEN Adaptern (kein stiller Fallback) | P1 | offline | gruen | `03-telefonie-render.md` |  |
| MCP-01 | place_call Tool-Beschreibung und Parameter-Describe-Texte sind fest Deutsch | P1 | offline | rot | `04-mcp-und-widgets.md` | D28 -> PROMPT-09 |
| MCP-02 | Alle uebrigen 8 Tool-Beschreibungen sind fest Deutsch | P1 | offline | rot | `04-mcp-und-widgets.md` | D28 -> PROMPT-09 |
| MCP-03 | registerTools() hat keinen language/locale-Parameter (Regressions-/Fix-Waechter) | P1 | offline | rot | `04-mcp-und-widgets.md` | D28 -> PROMPT-09 |
| MCP-04 | requireFields-Fehlermeldungen sind fest Deutsch und laufen 1:1 in den Chat | P0 | offline | rot | `04-mcp-und-widgets.md` |  |
| MCP-05 | wrapHandler-Catch-Fallback bei Netzwerkfehler ist fest Deutsch | P0 | offline | rot | `04-mcp-und-widgets.md` |  |
| MCP-06 | "Gegenseite:"-Praefix in Transkriptzeilen ist sprachunabhaengig hart Deutsch | P0 | offline | rot | `04-mcp-und-widgets.md` |  |
| MCP-07 | Datum/Zeit in list_calls/get_calendar ignorieren das existierende dateLocale-Feld | P1 | offline | rot | `04-mcp-und-widgets.md` | D13 -> FMT-03 |
| MCP-08 | get_agent_status zeigt Kosten immer als "EUR", unabhaengig von paymentCurrency | P0 | offline | rot | `04-mcp-und-widgets.md` |  |
| MCP-09 | permissionsSummary() liefert deutsche Feldnamen, byte-gepinnt als Sollzustand | P0 | offline | rot | `04-mcp-und-widgets.md` |  |
| MCP-10 | list_action_items ist komplett unlokalisiert | P1 | offline | rot | `04-mcp-und-widgets.md` | D28 -> PROMPT-09 |
| MCP-11 | Dynamische Werte in calls.html/calendar.html laufen nicht durch widget-i18n | P2 | offline | rot | `04-mcp-und-widgets.md` |  |
| MCP-12 | Kanarien-Test: keine bestehende Testdatei prueft ein EN-/US-Szenario der MCP-Schicht | P0 | offline | rot | `04-mcp-und-widgets.md` | D21 (Leit) |
| MCP-13 | widget-i18n.js ist strukturell entkoppelt von Tenant-/Anruf-Sprache | P2 | offline | gruen | `04-mcp-und-widgets.md` |  |
| MCP-14 | Deutsche Text-Artefakte tauchen AUCH ohne Widget-Host-Faehigkeit auf (Stufe-0-Text) | P1 | offline | gruen | `04-mcp-und-widgets.md` |  |
| MCP-15 | mcp-tools.js ignoriert JEDEN Sprachwert vollstaendig (null/leer/unbekannt/Gross-Klein) | P1 | offline | gruen | `04-mcp-und-widgets.md` | D28 -> PROMPT-09 |
| MCP-16 | Parallele /mcp-Requests zweier Tenants: kein Sprach-Leak (Nebenlaeufigkeits-Waechter) | P2 | offline | gruen | `04-mcp-und-widgets.md` |  |
| MCP-17 | Claude-Tool-Nutzungsqualitaet bei rein englischer Chat-Session (deutsche Tool-Beschreibungen als Kontext) | P1 | manuell | unbekannt | `04-mcp-und-widgets.md` |  |
| MCP-18 | navigator.language-Verlaesslichkeit im claude.ai-Iframe-Sandbox | P2 | manuell | unbekannt | `04-mcp-und-widgets.md` |  |
| MCP-19 | Tatsaechlicher Live-Wert von PAYMENT_CURRENCY im Render-Dashboard | P0 | manuell | unbekannt | `04-mcp-und-widgets.md` |  |
| MCP-20 | Live-Outbound-Anruf eines EN-Tenants zeigt "Gegenseite:" in der echten Live-Karte | P0 | live | rot | `04-mcp-und-widgets.md` |  |
| MCP-21 | agent-status-Widget zeigt im echten Browser bei EN-Locale trotzdem deutsche Permission-Feldnamen | P0 | manuell | rot | `04-mcp-und-widgets.md` |  |
| OUT-01 | Default-Laender-Gate blockt jede +1-Nummer | P0 | offline | gruen | `05-auslandstelefonie.md` | D3 (Leit) |
| OUT-02 | "*" oeffnet das Laender-Gate fuer +1 | P1 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-03 | Tenant-Profil kann Laender-Gate nur einschraenken, nie erweitern | P1 | offline | unbekannt | `05-auslandstelefonie.md` |  |
| OUT-04 | homeCountryCode liefert fuer reine +1-Kandidaten immer null | P0 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-05 | homeCountryCode waehlt bei US-Privatnummer + DE-DID still die DE-Vorwahl | P0 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-05b | End-to-End-Beweis: US-Tenant mit fremder DE-DID waehlt fuehrende 0 falsch | P0 | offline | unbekannt | `05-auslandstelefonie.md` |  |
| OUT-06 | NANP-Schreibweisen werden nicht normalisiert und scheitern generisch | P0 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-07 | MCP-Tool-Prompt enthaelt keine NANP-Anleitung | P1 | offline | gruen | `05-auslandstelefonie.md` | D11 -> LANG-15 |
| OUT-08 | languageForCountry("US") faellt auf Deutsch zurueck | P0 | offline | gruen | `05-auslandstelefonie.md` | D1 -> LANG-01 |
| OUT-09 | Kein US-Premium-Schutz (1-900/1-976) in der Denylist | P1 | offline | gruen | `05-auslandstelefonie.md` | D26 (Leit) |
| OUT-10 | Notruf-Kurzwahl "911" wird unabhaengig vom Laender-Gate geblockt | P0 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-11 | Kein zeitzonenbewusstes Anrufzeiten-Gate existiert | P1 | offline | gruen | `05-auslandstelefonie.md` | D18 (Leit) |
| OUT-12 | Toll-Free-Nummern werden zum Worst-Case-Tarif abgerechnet | P2 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-13 | US-DID ist provisionierbar, aber Outbound-Gate blockt +1 per Default | P0 | offline | gruen | `05-auslandstelefonie.md` | D3 -> OUT-01 |
| OUT-14 | Modul-Kommentar "16 Glieder" widerspricht der tatsaechlichen 17er-Kette | P2 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-15 | Notruf-Denylist gewinnt auch bei explizit erlaubtem Land | P1 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-16 | Pre-Check `isTrunkZeroFormatError` ist fuer NANP-Nummern nie einschlaegig | P2 | offline | unbekannt | `05-auslandstelefonie.md` |  |
| OUT-17 | normNum bereinigt US-Trennzeichen-Schreibweisen korrekt (Positiv-Fall) | P1 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-18 | US-Testnummer bleibt der einzige Negativ-/Randfall in der Testsuite | P2 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-19 | Toll-Free-Ranges passieren die Denylist unbehelligt | P2 | offline | gruen | `05-auslandstelefonie.md` | D26 -> OUT-09 |
| OUT-20 | Kein DTMF-/IVR-Handling im gesamten Quellbaum | P2 | offline | gruen | `05-auslandstelefonie.md` | D24 (Leit) |
| OUT-21 | Bestandsdaten/Migration: Tenant ohne defaultLanguage + US-DID bleibt Deutsch | P1 | offline | gruen | `05-auslandstelefonie.md` | D10 -> LANG-14 |
| OUT-22 | Leere/undefinierte Profil-allowedCountryCodes bedeuten "keine Zusatz-Einschraenkung" | P2 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-23 | Grossschreibung/gemischte Schreibweise bei Laendercode-Praefixen ist irrelevant (E.164 hat kein Casing) | P2 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-24 | EN-Offenlegungssatz ist byte-stabil und nicht abschaltbar | P0 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-25 | Vollstaendiger Happy-Path fuer eine korrekt konfigurierte US-Freischaltung | P0 | offline | unbekannt | `05-auslandstelefonie.md` |  |
| OUT-26 | Live-Anruf DE-Origin nach US-Ziel (internationale Zustellung) | P1 | live | unbekannt | `05-auslandstelefonie.md` |  |
| OUT-27 | Assistant-Origination-Pfad reicht `to` unveraendert durch (keine eigene Laenderlogik) | P2 | offline | gruen | `05-auslandstelefonie.md` |  |
| OUT-28 | Gate-Reihenfolge bleibt bei US-relevanten Einzelverletzungen deterministisch | P1 | offline | gruen | `05-auslandstelefonie.md` |  |
| DID-01 | languageForCountry("US") liefert "en" statt "de" | P0 | offline | rot | `06-nummern-provisioning.md` | D1 -> LANG-01 |
| DID-02 | POST /api/onboard mit country=US persistiert englische Sprache | P0 | offline | rot | `06-nummern-provisioning.md` | D2 -> LANG-10 |
| DID-03 | Webhook-Aktivierungspfad (BK3) setzt fuer US-Herkunft englische Sprache | P0 | offline | rot | `06-nummern-provisioning.md` | D2 -> LANG-10 |
| DID-04 | languageForCountry ist case-insensitiv, auch fuer den kuenftigen US-Eintrag | P1 | offline | rot | `06-nummern-provisioning.md` | D5 -> LANG-09 |
| DID-05 | Reale Nicht-Tabellen-Laender (CA/IE/AU/CH/AT/ES/IT) kaufen unmarkiert eine DE-Nummer | P1 | offline | rot | `06-nummern-provisioning.md` |  |
| DID-06 | Kein Self-Service-Retry fuer fehlgeschlagenen Nummernkauf | P1 | offline | rot | `06-nummern-provisioning.md` |  |
| DID-07 | /api/onboard/retry bleibt Owner-only, auch von aussen (Regressions-Pin) | P0 | offline | gruen | `06-nummern-provisioning.md` |  |
| DID-08 | Telnyx-Order-Body und -Fehlerpfad ohne Regulatory-Differenzierung | P1 | offline | gruen | `06-nummern-provisioning.md` |  |
| DID-09 | phone_number_type wird fuer US (und alle Laender) nie gesetzt | P1 | offline | rot | `06-nummern-provisioning.md` |  |
| DID-10 | FORCE_NUMBER_COUNTRY wirkt global auf ALLE Tenants gleichzeitig | P1 | offline | gruen | `06-nummern-provisioning.md` | D22 (Leit) |
| DID-11 | holdAmountForCountry liefert fuer US/FR/GB/DE identischen Betrag | P2 | offline | gruen | `06-nummern-provisioning.md` |  |
| DID-12 | PAYMENT_CURRENCY Default ist "eur" (Code-Ebene) | P0 | offline | gruen | `06-nummern-provisioning.md` | D17 -> PAY-01 |
| DID-13 | Live-Render-Env: ist PAYMENT_CURRENCY tatsaechlich auf "usd" gesetzt? | P0 | manuell | unbekannt | `06-nummern-provisioning.md` |  |
| DID-14 | PROVISIONING_ENABLED Default false schuetzt JEDEN internationalen Kauf | P0 | offline | gruen | `06-nummern-provisioning.md` |  |
| DID-15 | bk3-Bestandstest fuer US deckt nur das Land, nicht die Sprache (Test-Luecke selbst) | P1 | offline | gruen | `06-nummern-provisioning.md` | D21 -> MCP-12 |
| DID-16 | Bestandsdaten-Migration: persistierte Sprache aendert sich nicht rueckwirkend | P1 | offline | gruen | `06-nummern-provisioning.md` | D10 -> LANG-14 |
| DID-17 | RELEASE_GRACE_DAYS=0 + knapper maxNumbers-Cap blockiert neuen Signup | P2 | offline | gruen | `06-nummern-provisioning.md` |  |
| DID-18 | Fehlermeldung "Einrichtung fehlgeschlagen." ist hart auf Deutsch codiert | P1 | manuell | gruen | `06-nummern-provisioning.md` |  |
| DID-19 | Telnyx-Idempotency-Key ist number-id-gebunden, keine Land-Kollision bei Parallelitaet | P2 | offline | gruen | `06-nummern-provisioning.md` |  |
| DID-20 | FORCE_NUMBER_COUNTRY nur Leerzeichen faellt sauber auf das Herkunftsland zurueck | P2 | offline | gruen | `06-nummern-provisioning.md` | D22 -> DID-10 |
| PAY-01 | Plan-Katalog bleibt EUR und Cross-Package-identisch (Regressionsschutz) | P1 | offline | gruen | `07-geld-und-waehrung.md` | D17 (Leit) |
| PAY-02 | Waehrungsentscheid dokumentieren: EUR-Cutover vs. "USD bindend"-Vorgabe klaeren | P0 | manuell | unbekannt | `07-geld-und-waehrung.md` |  |
| PAY-03 | Marketing-Preisseite zeigt EUR fuer JEDEN Besucher (kein Geo-Umschalter) | P0 | offline | gruen | `07-geld-und-waehrung.md` | D17 -> PAY-01 |
| PAY-04 | Starter-Tenant: Reserve fuer Nicht-Inlandsziel uebersteigt IMMER die Monatsdecke | P0 | offline | rot | `07-geld-und-waehrung.md` | D25 (Leit) |
| PAY-05 | Business-Tenant: ein Nicht-Inlands-Call sperrt die komplette Decke fuer JEDEN weiteren Call | P0 | offline | rot | `07-geld-und-waehrung.md` | D25 -> PAY-04 |
| PAY-06 | Cost-Truing-Sweep befreit die ueberreservierte Decke nach der konfigurierten Verzoegerung | P1 | offline | unbekannt | `07-geld-und-waehrung.md` |  |
| PAY-07 | tariffCentsPerMin behandelt jedes Nicht-+49/+33/+44-Ziel als Ausland, unabhaengig vom Tenant-Heimatland | P0 | offline | gruen | `07-geld-und-waehrung.md` | D25 -> PAY-04 |
| PAY-08 | Inbound-Anruf zieht das Tenant-Budget nie ab (Richtungspruefung) | P1 | offline | gruen | `07-geld-und-waehrung.md` |  |
| PAY-09 | recordVoiceMinuteMeter rechnet auch fuer INBOUND-Calls mit dem 15x-Auslandstarif, wenn call.to eine US-DID ist | P1 | offline | gruen | `07-geld-und-waehrung.md` |  |
| PAY-10 | costCents aus recordVoiceMinuteMeter geht NICHT an Stripe (nur quantity) | P2 | offline | gruen | `07-geld-und-waehrung.md` |  |
| PAY-11 | tenant.html rendert Geldbetraege hart in de-DE, unabhaengig von settings.language | P1 | manuell | gruen | `07-geld-und-waehrung.md` | D15 -> FMT-15 |
| PAY-12 | Budget-Gate-402-Ablehnungstext ist hartkodiertes Deutsch (keine Locale-Anbindung) | P1 | offline | gruen | `07-geld-und-waehrung.md` |  |
| PAY-13 | allowedCountryCodes-Default schliesst +1 (USA) aus | P0 | offline | gruen | `07-geld-und-waehrung.md` | D3 -> OUT-01 |
| PAY-14 | Land-Gate + Budget-Gate-Interaktion: +1 wird schon VOR der Reserve blockiert, solange +1 nicht erlaubt ist | P0 | offline | unbekannt | `07-geld-und-waehrung.md` | D3 -> OUT-01 |
| PAY-15 | planCapCents wirft fail-closed bei unbekanntem Plan-Slug | P2 | offline | gruen | `07-geld-und-waehrung.md` |  |
| PAY-16 | Wird ein neuer Plan (z.B. "starter_us") eingefuehrt, ohne PLAN_CAP_HEADROOM-Eintrag, blockiert er sofort JEDEN Call (fail-closed statt fail-open) | P1 | offline | gruen | `07-geld-und-waehrung.md` |  |
| PAY-17 | Nummern-Setup-Hold ist fuer US aktuell IDENTISCH zum DE-Default (kein eigener Land-Preis konfiguriert) | P2 | offline | gruen | `07-geld-und-waehrung.md` |  |
| PAY-18 | Kein Stripe-Aufruf setzt automatic_tax oder billing_address_collection | P1 | offline | gruen | `07-geld-und-waehrung.md` | D29 (Leit) |
| PAY-19 | off_session-Zahlung ohne 3DS-Redirect: SCA-Fehlschlag hat keinen Retry-Zweig | P1 | manuell | unbekannt | `07-geld-und-waehrung.md` |  |
| PAY-20 | providerToBucketRateMicro ist eine reine Konstante ohne automatisierten Drift-Alarm | P2 | offline | gruen | `07-geld-und-waehrung.md` |  |
| PAY-21 | globaler Notaus wird von Nicht-Inlands-Reservierungen ueberproportional gefuettert | P1 | offline | rot | `07-geld-und-waehrung.md` | D30 (Leit) |
| PAY-22 | Grenzfall: leere/unbekannte Zielvorwahl faellt auf den teuren Default-Tarif (fail-safe teuer, nicht fail-open billig) | P1 | offline | gruen | `07-geld-und-waehrung.md` | D25 -> PAY-04 |
| PAY-23 | Grenzfall: Reserve exakt gleich dem verbleibenden Cap ist ERLAUBT (strikt >, nicht >=) | P2 | offline | gruen | `07-geld-und-waehrung.md` |  |
| PAY-24 | Plan-Downgrade auf Starter waehrend bestehender Nicht-Inlands-Reserve wirkt sofort verschaerfend | P1 | offline | unbekannt | `07-geld-und-waehrung.md` |  |
| PAY-25 | Env-Doku-Kohaerenz: VOICE_TARIFF_DOMESTIC_PREFIXES ist in .env.example dokumentiert und deckt sich mit dem Code-Default | P2 | offline | unbekannt | `07-geld-und-waehrung.md` |  |
| PAY-26 | Grosse-Zahl-Fuzzing: negative/NaN max_duration_s im Body kann die Reserve nicht senken | P1 | offline | gruen | `07-geld-und-waehrung.md` |  |
| WEB-01 | tenant.html liefert kein sprachabhaengiges html-lang-Attribut | P0 | offline | rot | `08-web-dashboard-onboarding.md` | D14 (Leit) |
| WEB-02 | Live-Verifikation: welches Dashboard sieht ein echter US-Login heute | P0 | manuell | unbekannt | `08-web-dashboard-onboarding.md` |  |
| WEB-03 | WEB_DIST_DIR-Redirect /tenant.html -> /app erhaelt Query und liefert englische App-Shell | P1 | offline | gruen | `08-web-dashboard-onboarding.md` |  |
| WEB-04 | GREETING_TEMPLATES bieten keine englische Vorlage | P0 | offline | rot | `08-web-dashboard-onboarding.md` | D7 -> LANG-11 |
| WEB-05 | Inbound-Greeting ignoriert settings.language beim tatsaechlich gesprochenen Text | P0 | offline | rot | `08-web-dashboard-onboarding.md` | D8 -> PROMPT-03 |
| WEB-06 | apps/web SettingsIsland uebersetzt die Greeting-Vorlagen nicht | P1 | offline | rot | `08-web-dashboard-onboarding.md` | D8 -> PROMPT-03 |
| WEB-07 | apps/web bindet agentStyle/personaStyleIds ueberhaupt nicht (Feature-Luecke) | P1 | offline | rot | `08-web-dashboard-onboarding.md` |  |
| WEB-08 | Persona-Style-Label in tenant.html bleibt deutsch trotz vorhandener EN-Uebersetzung | P2 | offline | rot | `08-web-dashboard-onboarding.md` |  |
| WEB-09 | Self-Service-API-Fehlertexte sind rohes Deutsch statt Code+lokalisierbarem Text | P0 | offline | rot | `08-web-dashboard-onboarding.md` |  |
| WEB-10 | api-onboard.js PUBLIC_URL-Fehler ist deutscher Klartext | P2 | offline | gruen | `08-web-dashboard-onboarding.md` |  |
| WEB-11 | CSRF-Fehlerantwort bei fehlgeschlagenem OIDC-State ist unuebersetztes Deutsch | P0 | offline | rot | `08-web-dashboard-onboarding.md` |  |
| WEB-12 | Anmeldung-fehlgeschlagen-Fehler (500 UND 401) sind deutscher Klartext | P0 | offline | rot | `08-web-dashboard-onboarding.md` |  |
| WEB-13 | SESSION_EXPIRED_PAGE ist lang="de" mit deutschem Fliesstext | P1 | offline | rot | `08-web-dashboard-onboarding.md` |  |
| WEB-14 | Post-Call-SMS-Rahmentext ist sprachunabhaengig deutsch | P0 | offline | rot | `08-web-dashboard-onboarding.md` | D12 (Leit) |
| WEB-15 | Dashboard-Notification-Titel "Neue Call Summary" ist hartkodiert deutsch-englisch gemischt | P1 | offline | rot | `08-web-dashboard-onboarding.md` | D12 -> WEB-14 |
| WEB-16 | Englische Preisseite zeigt Euro statt Dollar | P1 | offline | rot | `08-web-dashboard-onboarding.md` | D17 -> PAY-01 |
| WEB-17 | tenant.html formatiert USD-Betraege weiterhin im de-DE-Format (Komma statt Punkt) | P1 | offline | rot | `08-web-dashboard-onboarding.md` | D15 -> FMT-15 |
| WEB-18 | apps/web nutzt durchgaengig en-US fuer Datumsformatierung (Regressions-Baseline) | P2 | offline | gruen | `08-web-dashboard-onboarding.md` |  |
| WEB-19 | Keine UI fuer die private Rufnummer in beiden Dashboards | P1 | offline | rot | `08-web-dashboard-onboarding.md` |  |
| WEB-20 | POST /api/onboard ist NICHT ueber eine Self-Service-Session erreichbar | P0 | offline | gruen | `08-web-dashboard-onboarding.md` | D27 -> LANG-02 |
| WEB-21 | Frischer Browser-Login setzt tenant.country/defaultLanguage NICHT | P0 | offline | gruen | `08-web-dashboard-onboarding.md` | D27 -> LANG-02 |
| WEB-22 | languageForCountry("US") liefert Deutsch statt Englisch | P0 | offline | rot | `08-web-dashboard-onboarding.md` | D1 -> LANG-01 |
| WEB-23 | Onboard mit body.country=US liefert language=de statt en | P0 | offline | rot | `08-web-dashboard-onboarding.md` | D2 -> LANG-10 |
| WEB-24 | Grossschreibung: settings.language="EN" faellt still auf Deutsch zurueck | P1 | offline | gruen | `08-web-dashboard-onboarding.md` | D6 -> LANG-19 |
| WEB-25 | GB und IE mappen korrekt auf Englisch (Kontrast-Baseline zu WEB-22) | P2 | offline | gruen | `08-web-dashboard-onboarding.md` |  |
| WEB-26 | Bestandstenant ohne defaultLanguage (Alt-Daten vor F1-Geo) bleibt dauerhaft Deutsch | P2 | offline | gruen | `08-web-dashboard-onboarding.md` | D10 -> LANG-14 |
| LAW-01 | US-Onboarding liefert Deutsch als Tenant-/Nummernsprache (Ist-Stand pinnen) | P0 | offline | gruen | `09-recht-und-compliance.md` | D2 -> LANG-10 |
| LAW-02 | EN-Disclosure end-to-end ueber disclosureSentence(call) mit call.language="en" | P0 | offline | gruen | `09-recht-und-compliance.md` |  |
| LAW-03 | EN-Disclosure als erster Say/Gather-Praefix im Outbound-TwiML (Wiring-Ebene) | P0 | offline | unbekannt | `09-recht-und-compliance.md` |  |
| LAW-04 | allowedCountryCodes-Default blockt US-Ziele (+1) ohne Env-Override | P0 | offline | gruen | `09-recht-und-compliance.md` | D3 -> OUT-01 |
| LAW-05 | Land-Gate ist eine reine Whitelist, keine Consent-/Zeitfenster-Kopplung | P1 | manuell | rot | `09-recht-und-compliance.md` | D23 -> LAW-06 |
| LAW-06 | Kein Consent-Feld/-Gate fuer Aufzeichnung/Transkription des Angerufenen | P0 | offline | rot | `09-recht-und-compliance.md` | D23 (Leit) |
| LAW-07 | Kein Zeitzonen-/Vorwahl-Wissen im Code (TCPA-8-21-Uhr-Fenster technisch unmoeglich) | P0 | offline | rot | `09-recht-und-compliance.md` | D18 -> OUT-11 |
| LAW-08 | "Stundenlimit"-Gate ist ein Rate-Limit, kein Tageszeit-Fenster (Doku-Pin) | P1 | offline | gruen | `09-recht-und-compliance.md` | D18 -> OUT-11 |
| LAW-09 | Kein DNC-/TCPA-Bezug im Code oder in der Sicherheits-Doku | P1 | offline | rot | `09-recht-und-compliance.md` | D23 -> LAW-06 |
| LAW-10 | Keine FCC-Feb-2024-konforme Vorab-Einwilligung fuer KI-Stimme vor US-Outbound | P1 | manuell | rot | `09-recht-und-compliance.md` | D23 -> LAW-06 |
| LAW-11 | Privacy Policy (datenschutz.astro) ist deutschsprachiger Platzhalter ohne CCPA-Sprache | P1 | manuell | rot | `09-recht-und-compliance.md` |  |
| LAW-12 | AGB (agb.astro) ist deutschsprachiger Platzhalter | P2 | manuell | gruen | `09-recht-und-compliance.md` |  |
| LAW-13 | Loeschung (Art. 17/CCPA) hat keinen authentifizierten HTTP-Endpunkt | P1 | offline | gruen | `09-recht-und-compliance.md` |  |
| LAW-14 | erase-tenant.js verlangt tenantId UND --confirm (fail-closed CLI-Gate) | P1 | offline | gruen | `09-recht-und-compliance.md` |  |
| LAW-15 | Retention-Default 30 Tage / Diagnostic-Retention 7 Tage, fail-closed bei 0 | P1 | offline | gruen | `09-recht-und-compliance.md` |  |
| LAW-16 | Datenresidenz fix Frankfurt/EU fuer alle Tenants inkl. hypothetischer US-Kunden | P2 | manuell | gruen | `09-recht-und-compliance.md` |  |
| LAW-17 | EN-Locale ist britisches, nicht US-amerikanisches Englisch | P1 | offline | gruen | `09-recht-und-compliance.md` | D16 -> VOICE-01 |
| LAW-18 | DEFAULT_COUNTRY/DEFAULT_LANGUAGE-Fallback bei komplett fehlgeschlagener Geo-Ermittlung | P1 | offline | gruen | `09-recht-und-compliance.md` |  |
| LAW-19 | languageForCountry: Gross-/Kleinschreibung, Whitespace, unbekannter 2-Buchstaben-Code | P2 | offline | gruen | `09-recht-und-compliance.md` | D5 -> LANG-09 |
| LAW-20 | FORCE_NUMBER_COUNTRY entkoppelt Kauf-Land von Sprache (US-Kauf, DE-Sprache bleibt bestehen) | P1 | offline | gruen | `09-recht-und-compliance.md` | D22 -> DID-10 |
| LAW-21 | Kein Audio, nur Text-Transkript verlaesst das System via MCP (Regel 5) | P0 | offline | gruen | `09-recht-und-compliance.md` |  |
| LAW-22 | Race: gleichzeitiges Onboarding zweier US-Interessenten liefert je isoliert DE-Sprache (keine gegenseitige Beeinflussung) | P2 | offline | unbekannt | `09-recht-und-compliance.md` |  |
| LAW-23 | PLAN-SECURITY.md hat keine LAW/Consent/TCPA-Rubrik (Doku-Luecke) | P2 | manuell | rot | `09-recht-und-compliance.md` |  |
| LAW-24 | Disclosure bleibt bei EN-Realtime-Engine (bridge.js, VOICE_ENGINE=realtime) LLM-instruiert, nicht LLM-frei | P1 | manuell | unbekannt | `09-recht-und-compliance.md` |  |
| LAW-25 | Konsistenz-Check: `test/f1-i18n-locale.test.js` und `test/f1-p8-outbound-lang.test.js` decken zusammen keine US/EN-Sprachpraezedenz ab | P1 | offline | rot | `09-recht-und-compliance.md` | D21 -> MCP-12 |
| FMT-01 | now-Zeitstempel im Systemprompt traegt keine timeZone-Option | P0 | offline | rot | `10-zeit-format-daten.md` |  |
| FMT-02 | US-Anrufer: now-Tagesname weicht bei spaeter Ortszeit vom UTC-Tag ab (Simulation) | P0 | manuell | rot | `10-zeit-format-daten.md` |  |
| FMT-03 | mcp-tools fmt() ist hart "de-DE" verdrahtet, nicht sprachabhaengig | P0 | offline | rot | `10-zeit-format-daten.md` | D13 (Leit) |
| FMT-04 | list_calls: startedAt kommt im deutschen Format, auch fuer einen EN-Tenant | P0 | offline | rot | `10-zeit-format-daten.md` | D13 -> FMT-03 |
| FMT-05 | get_calendar: start/end kommen im deutschen Format, auch fuer einen EN-Tenant | P0 | offline | rot | `10-zeit-format-daten.md` | D13 -> FMT-03 |
| FMT-06 | Widget calendar.html bindet den fmt()-String direkt (keine Client-Neuformatierung) | P1 | offline | gruen | `10-zeit-format-daten.md` |  |
| FMT-07 | US-Onboarding ohne manuelle Sprachwahl faellt auf Deutsch zurueck | P0 | offline | rot | `10-zeit-format-daten.md` | D2 -> LANG-10 |
| FMT-08 | US-Onboarding End-to-End: country=US ohne language-Override -> defaultLanguage de | P0 | offline | rot | `10-zeit-format-daten.md` | D2 -> LANG-10 |
| FMT-09 | en-GB statt en-US: dateLocale/sttLocale gepinnt, kein US-Profil | P1 | offline | gruen | `10-zeit-format-daten.md` | D16 -> VOICE-01 |
| FMT-10 | Private Summary-Nummer: US-Tenant kann +1-Nummer nicht hinterlegen (Self-Service) | P0 | offline | gruen | `10-zeit-format-daten.md` | D19 (Leit) |
| FMT-11 | Private Summary-Nummer: US-Land-Tenant bekommt beim Onboarding trotzdem nur +49-Gate | P0 | offline | rot | `10-zeit-format-daten.md` | D19 -> FMT-10 |
| FMT-12 | call-finish Notification-Texte sind hart Deutsch (cancelled/failed) | P1 | offline | rot | `10-zeit-format-daten.md` | D12 -> WEB-14 |
| FMT-13 | call-finish Summary-Notification und SMS-Praefix sind hart Deutsch | P1 | offline | rot | `10-zeit-format-daten.md` | D12 -> WEB-14 |
| FMT-14 | tenant.html ist lang="de" ohne Locale-Erkennung | P1 | offline | rot | `10-zeit-format-daten.md` | D14 -> WEB-01 |
| FMT-15 | tenant.html formatiert Preis/Datum immer als de-DE | P1 | offline | rot | `10-zeit-format-daten.md` | D15 (Leit) |
| FMT-16 | Plan-Katalog traegt EUR statt der dokumentierten USD-Entscheidung | P0 | offline | gruen | `10-zeit-format-daten.md` | D17 -> PAY-01 |
| FMT-17 | PAYMENT_CURRENCY ist ein einziger globaler Wert ohne Land-/Tenant-Bezug | P1 | offline | rot | `10-zeit-format-daten.md` | D17 -> PAY-01 |
| FMT-18 | Kein getHours/getUTCHours-basiertes Ruhezeiten-Gate im gesamten Repo | P1 | offline | gruen | `10-zeit-format-daten.md` | D18 -> OUT-11 |
| FMT-19 | Stundenlimit ist Rate-Limit, keine Tageszeit-Pruefung (Abgrenzung zu FMT-18) | P2 | offline | unbekannt | `10-zeit-format-daten.md` | D18 -> OUT-11 |
| FMT-20 | E.164 akzeptiert NANP-Nummern (+1 + 10 Ziffern) korrekt | P2 | offline | gruen | `10-zeit-format-daten.md` |  |
| FMT-21 | TRUNK_ZERO_COUNTRY_CODES betrifft +1 nicht (kein False-Positive fuer US) | P2 | offline | gruen | `10-zeit-format-daten.md` |  |
| FMT-22 | homeCountryCode() liefert fuer reinen US-Tenant null (kein Heimatland ableitbar) | P1 | offline | gruen | `10-zeit-format-daten.md` |  |
| FMT-23 | firstNameOf() mit CJK-Namen ohne Leerzeichen liefert den ganzen String | P2 | offline | unbekannt | `10-zeit-format-daten.md` |  |
| FMT-24 | escapeXml() laesst CJK-Zeichen im TeXML-Dokument unveraendert durch | P2 | offline | unbekannt | `10-zeit-format-daten.md` |  |
| FMT-25 | localeFor() faellt bei unbekannter/leerer/null Sprache fail-safe auf de zurueck | P1 | offline | gruen | `10-zeit-format-daten.md` | D4 -> LANG-21 |
| FMT-26 | languageForCountry() ist case-insensitiv, faellt aber fuer "us" (klein) ebenfalls auf de zurueck | P2 | offline | gruen | `10-zeit-format-daten.md` | D5 -> LANG-09 |
| FMT-27 | Mitigation-Pfad: number.language="en" explizit gesetzt uebersteuert tenant.defaultLanguage="de" fuer US-Nummer | P1 | offline | gruen | `10-zeit-format-daten.md` |  |
| FMT-28 | Kein Zeitzonen-Feld im Datenmodell (JSON- und Postgres-Schema) | P0 | offline | gruen | `10-zeit-format-daten.md` | D18 -> OUT-11 |
| FMT-29 | Demo-Kalender (Bootstrap-Tenant) rechnet in Server-Lokalzeit, nicht UTC/Tenant-TZ | P2 | offline | rot | `10-zeit-format-daten.md` |  |
| FMT-30 | Spend-Monat-Achse bleibt UTC-verankert (Regressionsschutz, Positivbeispiel) | P2 | offline | gruen | `10-zeit-format-daten.md` |  |
| FMT-31 | calendar_event-Sortierung ist bei UTC-Z-Suffix lexikografisch korrekt (Grenzfall gemischte Offsets) | P2 | offline | unbekannt | `10-zeit-format-daten.md` |  |
| FMT-32 | Notification-/SMS-Praefixe bleiben deutsch auch bei call.language="fr" (nicht nur EN betroffen) | P2 | offline | rot | `10-zeit-format-daten.md` | D12 -> WEB-14 |
| GAP-01 | Abrechnungsperiode und Budget-Fenster sind dieselbe Achse | P0 | offline | rot | `11-luecken-und-e2e.md` | D30 -> PAY-21 |
| GAP-02 | Stripe-Checkout erhebt Steuer und erfasst das Kundenland | P0 | offline | rot | `11-luecken-und-e2e.md` | D29 -> PAY-18 |
| GAP-03 | Jedes zahlungsrelevante Stripe-Ereignis hat eine getestete Wirkung | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-04 | Aktivierung und Nummern-Lieferung sind eine Transaktion | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-05 | Kein Nummernkauf ohne Hold (Gutschein-Missbrauch) | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-06 | Monatliche DID-Miete wird gebucht, gekuendigte DIDs werden freigegeben | P1 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-07 | Eine Fruehwarnung ohne Empfaenger ist keine Sicherung | P0 | offline | rot | `11-luecken-und-e2e.md` | D30 -> PAY-21 |
| GAP-08 | Es gibt genau EINE Quelle fuer den USD/EUR-Kurs | P1 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-09 | TTS-Zeichen sind je Tenant zurechenbar, und ein erschoepftes Kontingent hat einen definierten Zustand | P1 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-10 | Das Stundenlimit greift pro Tenant, nicht plattformweit | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-11 | Hold, Capture und gebuchte Nummernkosten stimmen je Kaufland ueberein | P1 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-12 | Der erste gesprochene Satz nennt eine Rueckrufnummer und einen Opt-out | P0 | offline | rot | `11-luecken-und-e2e.md` | D23 -> LAW-06 |
| GAP-13 | Ein Opt-out ueberdauert das Wiederhol-Fenster | P0 | offline | rot | `11-luecken-und-e2e.md` | D23 -> LAW-06 |
| GAP-14 | Inbound-Pflichtsatz (KI + Transkription) ist fest verdrahtet und nicht abschaltbar | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-15 | Kein Build mit Platzhalter-Rechtstexten, EN-Routen vorhanden | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-16 | audit_log faellt unter Retention und Loeschung | P1 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-17 | Jeder externe Empfaenger steht im Subprozessor-Verzeichnis | P1 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-18 | NANP-Sub-Ranges bleiben gesperrt, auch wenn "+1" erlaubt ist | P0 | offline | rot | `11-luecken-und-e2e.md` | D26 -> OUT-09 |
| GAP-19 | Absender-Land und Kauf-Land duerfen nicht unbemerkt auseinanderlaufen | P1 | offline | rot | `11-luecken-und-e2e.md` | D22 -> DID-10 |
| GAP-20 | Notruf-/Krisen-Kurzwahlen sind eine bewusste Sperre, kein Formatfehler | P1 | offline | rot | `11-luecken-und-e2e.md` | D26 -> OUT-09 |
| GAP-21 | Anrufbeantworter/IVR werden erkannt und beenden den Anruf kontrolliert | P0 | offline | rot | `11-luecken-und-e2e.md` | D24 -> OUT-20 |
| GAP-22 | Das Turn-Budget enthaelt TTS-Synthese und eine Netzreserve | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-23 | Rufnummern-Reputation wird gemessen und stoppt den Nachschub | P1 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-24 | Assistant-Bindung und STT-Hint haengen an der Sprache des Calls | P1 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-25 | Kein stiller Landeswechsel bei der Wahl-Normalisierung | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-26 | Ein am Dauer-Cap gestorbener Anruf ist maschinenlesbar als solcher erkennbar | P1 | offline | rot | `11-luecken-und-e2e.md` | D24 -> OUT-20 |
| GAP-27 | Charakterisierungs-Tests sind als solche gekennzeichnet und nie allein | P1 | offline | rot | `11-luecken-und-e2e.md` | D21 -> MCP-12 |
| GAP-28 | Kein deutscher Text in der messages-/tool_result-Kette eines EN-Calls | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-29 | Das gesprochene Anliegen passt zur Sprache des Calls | P1 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-30 | Self-Service-Feldkatalog ist zwischen Frontend und Server identisch | P1 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-31 | Jedes Locale-Feld hat einen Produktionskonsumenten | P1 | offline | rot | `11-luecken-und-e2e.md` | D9 -> LANG-13 |
| GAP-32 | Ein unbezahlbarer Worst-Case-Tarif bricht den Start, statt nur zu warnen | P0 | offline | rot | `11-luecken-und-e2e.md` | D25 -> PAY-04 |
| GAP-33 | Produktionskonfigurations-Smoke (die Suite faehrt die ausgelieferte Env) | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-34 | Backfill-Migration fuer country/language ist idempotent und kollisionsfrei | P1 | offline | rot | `11-luecken-und-e2e.md` | D10 -> LANG-14 |
| GAP-35 | Telemetrie traegt Land und Sprache | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-36 | /healthz weist Commit und Konfigurations-Fingerabdruck aus | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-37 | buildFilter und WEB_DIST_DIR widersprechen sich nicht | P1 | offline | rot | `11-luecken-und-e2e.md` |  |
| GAP-38 | plan:free und preDeployCommand stehen nicht am selben Service | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| E2E-01 | Landwechsel eines Bestandstenants (DE -> US) | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| E2E-02 | Zwei Tenants, zwei Sprachen, volle Kette parallel | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| E2E-03 | Sprachumstellung waehrend eines laufenden Anrufs bleibt wirkungslos | P1 | offline | gruen | `11-luecken-und-e2e.md` |  |
| E2E-04 | Bestandstenant ohne country/language durch die volle Kette | P0 | offline | rot | `11-luecken-und-e2e.md` | D27 -> LANG-02 |
| E2E-05 | US-Launch-Vollkette unter Produktionswerten | P0 | offline | rot | `11-luecken-und-e2e.md` |  |
| E2E-06 | Sprach-Reinheits-Aggregat ueber ALLE nutzersichtbaren Kanaele | P0 | offline | rot | `11-luecken-und-e2e.md` |  |

### 4.3 Duplikat-Cluster

| Cluster | Sachverhalt | Leittest | Duplikate |
| --- | --- | --- | --- |
| D1 | `languageForCountry("US")` liefert `de` | LANG-01 | VOICE-04, OUT-08, DID-01*, WEB-22* |
| D2 | Onboarding mit `country=US` persistiert `language=de` | LANG-10 | PROMPT-04, VOICE-06, LANG-22, DID-02*, DID-03*, WEB-23*, LAW-01, FMT-07*, FMT-08* |
| D3 | `ALLOWED_COUNTRY_CODES`-Default ohne `+1` | OUT-01 | LANG-08, PAY-13, LAW-04, OUT-13, PAY-14 |
| D4 | `localeFor()` faellt fail-safe auf `de` | LANG-21 | PROMPT-15, PROMPT-24, VOICE-21, FMT-25 |
| D5 | `languageForCountry` ist case-insensitiv (aendert an US nichts) | LANG-09 | VOICE-20, DID-04, LAW-19, FMT-26 |
| D6 | `language="EN"` (Grossschreibung) faellt still auf `de` | LANG-19 | PROMPT-16, WEB-24, LANG-18 |
| D7 | `GREETING_TEMPLATES` enthaelt keine EN/FR-Vorlage | LANG-11 | PROMPT-19, WEB-04 |
| D8 | Inbound-Greeting ignoriert `settings.language` | PROMPT-03 | LANG-12, PROMPT-20, WEB-05, WEB-06 |
| D9 | `greetingDefault` ist toter Code | LANG-13 | GAP-31 (erweitert um `sttLocale`) |
| D10 | Kein Backfill fuer `country`/`language` | LANG-14 | LANG-24, DID-16, OUT-21, WEB-26, GAP-34 |
| D11 | MCP-`place_call.language` ist wirkungslos | LANG-15 | VOICE-11, OUT-07 |
| D12 | SMS-/Notification-Rahmentexte sind hart deutsch | WEB-14 | PROMPT-12, PROMPT-13, WEB-15, FMT-12, FMT-13, FMT-32 |
| D13 | `mcp-tools.js` `fmt()` ist hart `de-DE` | FMT-03 | PROMPT-10, MCP-07, FMT-04, FMT-05 |
| D14 | `tenant.html` ohne Sprachumschalter, `lang="de"` | WEB-01 | VOICE-10, FMT-14, PROMPT-05 |
| D15 | `tenant.html` formatiert Geld/Datum hart `de-DE` | FMT-15 | PAY-11, WEB-17 |
| D16 | EN ist `en-GB`, kein `en-US` | VOICE-01 | LAW-17, FMT-09, VOICE-26 |
| D17 | Plan-/Preis-Waehrung ist EUR statt USD | PAY-01 | DID-12, FMT-16, PAY-03, WEB-16, FMT-17 |
| D18 | Kein zeitzonenbewusstes Anrufzeit-Gate, kein Zeitzonen-Feld | OUT-11 | LAW-07, FMT-18, FMT-28, LAW-08, FMT-19 |
| D19 | `privateNumber` faktisch auf `+49` beschraenkt | FMT-10 | FMT-11 |
| D20 | EINE globale ElevenLabs-Stimme fuer alle Sprachen | VOICE-12 | VOICE-13, VOICE-14 |
| D21 | Bestehende Tests decken kein EN-/US-Szenario ab | MCP-12 | LAW-25, DID-15, GAP-27 |
| D22 | `FORCE_NUMBER_COUNTRY` entkoppelt Kauf-Land global | DID-10 | LAW-20, LANG-05, DID-20, GAP-19 |
| D23 | Kein Consent-/Opt-out-/DNC-Konzept | LAW-06 | LAW-05, LAW-09, LAW-10, GAP-12, GAP-13 |
| D24 | Kein DTMF-/IVR-/AMD-Handling | OUT-20 | GAP-21, GAP-26 |
| D25 | Nicht-Inlands-Reserve sprengt die Plan-Decke | PAY-04 | PAY-05, PAY-07, PAY-22, GAP-32 |
| D26 | NANP-Premium und Notruf-Kurzwahlen fehlen in der Denylist | OUT-09 | OUT-19, GAP-18, GAP-20 |
| D27 | Realer Login-Pfad setzt kein Geo | LANG-02 | WEB-21, LANG-04, LANG-03, VOICE-07, WEB-20, E2E-04 |
| D28 | `mcp-tools.js` ist vollstaendig unlokalisiert | PROMPT-09 | MCP-01, MCP-02, MCP-03, MCP-15, PROMPT-11, MCP-10 |
| D29 | Kein `automatic_tax` im Stripe-Checkout | PAY-18 | GAP-02 (Soll-Formulierung) |
| D30 | Plattform-Topf ist lebenslang und ohne Alarmkanal | PAY-21 | GAP-01, GAP-07 |

**Konfliktmarkierung (`*` in D1/D2).** Diese Duplikate pruefen denselben Sachverhalt mit
UMGEKEHRTER Polaritaet: LANG-01/VOICE-04/OUT-08/LAW-01/PROMPT-04 pinnen das IST
(`"de"`, erwartbar gruen), waehrend DID-01/DID-02/DID-03/WEB-22/WEB-23/FMT-07/FMT-08 das SOLL
formulieren (`"en"`, erwartbar rot). Beides ist legitim, aber es darf nur EINE Fassung in die
Suite wandern, sonst ist die Suite nach dem Fix zwangslaeufig rot. **Empfehlung: die
Soll-Fassung (DID-01/DID-02) uebernehmen und die Ist-Pins nach dem Fix loeschen, nicht
umschreiben.** Dasselbe Muster in kleinerem Rahmen bei D8 (PROMPT-03 rot gegen LANG-12
gruen) und D19 (FMT-10 gruen gegen FMT-11 rot).

Weitere Doppeldeutigkeit: LANG-25 und PROMPT-03 formulieren ihre Erwartung im Fliesstext
ausdruecklich zweistufig ("gruen im Sinne von reproduzierbar, rot im Sinne von launch-bereit").
Die Tabelle in 4.2 fuehrt konsequent die LAUNCH-Lesart (rot), weil dieser Katalog ein
Launch-Gate ist.

> **Entschieden.** Alle 30 Cluster - plus fuenf weitere, die erst durch die Einarbeitung der
> `UI-*`-Tests entstehen - sind in
> [`tasks/i18n-tests/00-kanonische-liste.md`](tasks/i18n-tests/00-kanonische-liste.md)
> verbindlich aufgeloest. Die Empfehlung oben ist dort zur Regel R1 geworden (bei Konflikt
> gewinnt die SOLL-Fassung), mit drei Ergaenzungen: Mechanismus-Tests bleiben als
> Regressionsschutz gruen (R3), verschiedene Codepfade bleiben verschiedene Tests (R4), und die
> beiden kollidierenden Bestandstests `test/f1-geo-port.test.js:61` und
> `test/personal-assistant-characterization.test.js:215-221` werden mit dem Fix geloescht statt
> umgeschrieben (R5).

---

## 5. Ausfuehrungsreihenfolge

> **Nachtrag 2026-07-25 (Owner-Entscheidungen, Abschnitt 7.0).** Die Wellen unten sind in
> drei Punkten anzupassen:
> 1. **Fuenf Tests entfallen** und werden nicht gebaut: **GAP-02** (Welle W1, Gruppe Geld),
>    **LAW-06, LAW-07, GAP-12, GAP-13** (Welle W1, Gruppe Recht). Gruppe 5 "Recht" schrumpft
>    damit auf LAW-21, GAP-14, GAP-15.
> 2. **Drei Tests kommen hinzu**: **WORLD-01, WORLD-02, WORLD-03** (alle P0, offline,
>    Abschnitt 7.12). Sie gehoeren in Gruppe 2 "Sprache" und **vor** DID-01 - der Weltdefault
>    entscheidet, was `languageForCountry` fuer jedes nicht eingetragene Land liefert.
> 3. **Die vier "strukturellen Sperren" sind jetzt drei.** Das Land-Gate (Gruppe 3) steht live
>    auf `*` und sperrt nichts (`tasks/i18n-tests/13-live-env-befund.md`); die Gruppe bleibt
>    als Regressionsachse bestehen, verliert aber ihren Sperr-Charakter.
>
> **GAP-33 bleibt der erste auszufuehrende Test** - daran aendert keine Entscheidung etwas.

> **Nachtrag 2026-07-25 - Welle W1 ist UMGESETZT** (Beleg:
> [`tasks/i18n-tests/15-w1-bericht.md`](tasks/i18n-tests/15-w1-bericht.md)). Damit ist auch
> belegt, dass die Gruppenlisten unten **inhaltlich ueberholt** sind: die genannten "106
> Tests" sind ein Stand VOR der Duplikat-Aufloesung und VOR den Owner-Entscheidungen. Die
> Gruppen 1-5 fuehren **26 IDs**, die entfallen oder zurueckgestellt sind (OUT-01, OUT-13,
> LANG-08, PAY-13, PAY-14, LAW-04, LANG-01, LANG-10, WEB-22, WEB-23, FMT-07, FMT-08, FMT-10,
> LANG-03, LANG-04, WEB-20, WEB-21, PROMPT-04, WEB-05, PAY-05, PAY-07, GAP-02, LAW-06,
> LAW-07, GAP-12, GAP-13). Verbindlich ist die Schnittmenge aus
> [`00-kanonische-liste.md`](tasks/i18n-tests/00-kanonische-liste.md) und Abschnitt 4.2;
> tatsaechlicher W1-Umfang: **78 Tests**. Die **Gruppenreihenfolge** unten bleibt gueltig.

Drei Wellen. Jede Welle hat eine Voraussetzung, ein Kommando und einen **Abbruchpunkt** -
eine Bedingung, unter der nicht weitergemacht wird, weil jedes weitere Ergebnis wertlos waere.

### Welle W1 - offline, P0 (106 Tests)

**Voraussetzung.** Nichts ausser dem Repo. Die Suite laeuft ohne Netz und ohne `.env`
(`test/*.test.js`, `node:test`). Vorher pruefen, dass der Bestand gruen ist:

```
cd "/Users/antonio/Mein Unternehmen/MCP/vodafone-agent"
npm test                          # Bestandslauf, muss gruen sein (Suite-Flake beachten, s.u.)
node --check src/server.js
```

**Kommando pro Test.** Jeder Test ist in seiner Sektionsdatei mit einer konkreten
Verifikationszeile hinterlegt (`node --test test/<datei>.test.js`, `grep`, oder
Spawn-Integrationstest nach dem Muster `test/helpers.js`). Neue Dateien nach dem
Bestandsmuster anlegen; **`BASE_ENV` in `test/helpers.js` bei jeder neuen Config-Env
nachziehen**, sonst leakt die lokale `.env` in Spawn-Tests.

**Reihenfolge innerhalb W1.** Erst die vier strukturellen Sperren, dann der Rest:

1. **Registrierung**: FMT-10, FMT-11, LANG-02, LANG-03, LANG-04, WEB-20, WEB-21
2. **Sprache**: LANG-01, LANG-10, DID-01, DID-02, DID-03, WEB-22, WEB-23, FMT-07, FMT-08,
   PROMPT-03, PROMPT-04, WEB-04, WEB-05
3. **Land-Gate**: OUT-01, OUT-04, OUT-05, OUT-05b, OUT-06, OUT-10, OUT-13, OUT-24, OUT-25,
   LANG-08, PAY-13, PAY-14, LAW-04, GAP-18, GAP-25
4. **Geld**: PAY-04, PAY-05, PAY-07, GAP-01, GAP-02, GAP-03, GAP-04, GAP-05, GAP-07,
   GAP-10, GAP-32
5. **Recht**: LAW-06, LAW-07, LAW-21, GAP-12, GAP-13, GAP-14, GAP-15
6. **Alles uebrige P0-offline**, zuletzt die Ketten E2E-01, E2E-02, E2E-04, E2E-05, E2E-06

**Abbruchpunkt W1.**
- **Wenn GAP-33 nicht gebaut ist, ist W1 nicht abgeschlossen** - ohne einen Lauf gegen die
  ausgelieferte `render.yaml`-Env beweist jeder andere gruene Test nichts ueber Produktion
  (`test/helpers.js:84-85,263-272`).
- **Wenn E2E-05 nicht mindestens bis Schritt 4 kommt, wird W2 nicht gestartet.** Ein Produkt,
  das sich nicht registrieren, nicht sprechen und nicht anrufen laesst, muss nicht auf
  Datumsformate geprueft werden.
- **Wenn ein BESTANDSTEST rot wird, der nicht in diesem Katalog steht: sofort stoppen.**
  Ausnahme ist der dokumentierte Voll-Last-Flake (`p5-gate-proof`, ~12 %, Seed-vor-Boot-Race):
  rot gilt nur als echt, wenn die Datei ISOLIERT ebenfalls rot ist.

### Welle W2 - offline, P1 + P2 (170 Tests)

**Voraussetzung.** W1 vollstaendig gelaufen und dokumentiert. Die vier strukturellen Sperren
(W1-W4 aus Abschnitt 3) sind entweder behoben oder als bewusst akzeptiertes Risiko
schriftlich festgehalten.

```
npm test                          # Vollsuite inkl. der neuen W1+W2-Dateien
```

**Inhalt.** Formate und Zeitzonen (FMT-*), MCP-/Widget-Texte (MCP-*, PROMPT-09..13),
Dashboard und Web (WEB-*), Provisioning-Details (DID-*), Grenzfaelle und
Nebenlaeufigkeit (LANG-17/18/21/23/26, PROMPT-15..18/24, VOICE-19..25, PAY-15/16/22/23/26,
LAW-13..22, FMT-19..32), sowie die verbleibenden GAP-Tests.

**Abbruchpunkt W2.**
- **Wenn GAP-27 rot bleibt** (Charakterisierungs-Tests nicht als solche markiert), duerfen
  KEINE weiteren byte-genauen Pins fuer Nicht-DE-Sprachen angelegt werden - sonst wird der
  naechste Defekt wieder als Sollzustand zementiert.
- **Wenn D1/D2 in beiden Polaritaeten in der Suite landen** (siehe 4.3), zuerst aufloesen -
  eine Suite, die nach dem Fix zwangslaeufig rot wird, ist wertlos.
- W2 ist NICHT launch-blockierend fuer sich genommen; W2-Rot wird priorisiert, nicht gestoppt.

### Welle W3 - live und manuell (26 Tests: 4 live, 22 manuell)

**Voraussetzung.** W1 und W2 gelaufen; **ausdrueckliche Freigabe des Owners je Live-Test**;
Details und Warnungen in Abschnitt 6. Manuelle Tests brauchen zusaetzlich Zugriff auf das
Render-Dashboard (MCP-19, DID-13, WEB-02), einen echten Browser (MCP-18, MCP-21, PAY-11,
WEB-02, DID-18, LANG-20, PROMPT-05) und die Doku (LAW-11, LAW-12, LAW-16, LAW-23).

**Reihenfolge innerhalb W3.**
1. **Zuerst die Nulltarif-Manuellen** (kein Geld, keine Anrufe): MCP-19, DID-13, WEB-02,
   LAW-11, LAW-12, LAW-16, LAW-23, LAW-05, LAW-10, LAW-24, PAY-02, PAY-19, FMT-02
2. **Dann die Browser-Manuellen**: LANG-20, PROMPT-05, MCP-17, MCP-18, MCP-21, PAY-11,
   DID-18, WEB-02
3. **Zuletzt die vier Live-Anrufe**: LANG-25, PROMPT-23, MCP-20, OUT-26. Die beiden
   Abhoer-Tests VOICE-27 und VOICE-28 (Modus manuell) haengen sich an denselben Anruf an -
   sie brauchen keinen eigenen.

**Abbruchpunkt W3.**
- **Wenn MCP-19 oder DID-13 zeigt, dass der Live-Wert von `PAYMENT_CURRENCY` vom Code-Default
  abweicht, sind alle Geld-Ergebnisse aus W1/W2 neu zu bewerten** - `render.yaml` ist laut
  eigenem Kommentar (`render.yaml:15-17`) nur Referenz.
- **Kein Live-Anruf ohne geklaertes Consent-Modell** (Abschnitt 7, Punkt 4). Ein Testanruf an
  eine Nummer im eigenen Besitz ist zulaessig; ein Anruf an Dritte ist es nicht.
- **Wenn LANG-25 den deutschen Offenlegungssatz an einem US-Ziel bestaetigt, wird kein
  weiterer Live-Anruf gefahren** - der Befund ist dann erwiesen, weitere Anrufe kosten nur
  Geld und belasten fremde Anschluesse.

---

## 6. Live- und manuelle Tests gesondert

> **WARNUNG - echtes Geld, echte Menschen, echte Aufsicht.**
> Die vier Tests im Modus `live` loesen ECHTE Telefonate ueber eine reale DID aus. Sie kosten
> Telnyx-Minuten, ElevenLabs-Zeichen und Anthropic-Token, sie belasten den geteilten
> Plattform-Topf (`MAX_BUDGET_EUR`, aktuell ein LEBENSZEIT-Topf ueber alle Tenants) und sie
> erzeugen bei einem echten Gegenueber einen Anruf von einer KI. Ohne geklaertes
> Consent-Modell (Abschnitt 7.4) darf ausschliesslich eine Nummer im EIGENEN Besitz gewaehlt
> werden. Jeder Live-Test braucht die ausdrueckliche, dokumentierte Freigabe des Owners.

### 6.1 Live (4 Tests - echter Anruf)

| ID | Titel | Prio | Env / Vorbedingung | Kosten-/Risikohinweis |
| --- | --- | --- | --- | --- |
| LANG-25 | Live-Beweis: US-Empfaenger hoert bei Outbound-Call zuerst Deutsch | P0 | Test-Tenant ueber Web+Stripe (NICHT `/api/onboard`); `ALLOWED_COUNTRY_CODES` temporaer um `+1`; `OUTBOUND_FROZEN=false`; US-Zielnummer im eigenen Besitz | Ein Auslandsanruf; Reserve 900 ct gegen die Plan-Decke beachten (PAY-04 blockt ihn ggf. vorher) |
| PROMPT-23 | Pre-Launch-Smoke-Call: echter EN-Anruf auf Deutsch-Drift abhoeren | P0 | Tenant mit `settings.language="en"`; Budget-Engine (Default); Mitschnitt/Transkript sichern | Voller Gespraechspreis; mehrere Turns noetig, um Drift zu provozieren |
| MCP-20 | Live-Outbound eines EN-Tenants zeigt "Gegenseite:" in der echten Live-Karte | P0 | claude.ai-Connector aktiv, `MCP_UI_ENABLED=true`, EN-Tenant | Anruf plus Widget-Session; Screenshot als Beleg |
| OUT-26 | Live-Anruf DE-Origin nach US-Ziel (internationale Zustellung) | P1 | `ALLOWED_COUNTRY_CODES` um `+1`; DE-DID als Absender; US-Ziel im eigenen Besitz | Bekanntes Vorwissen: US-DID -> DE-Mobil ist intermittent; die Gegenrichtung ist ungemessen |

**Gemeinsame Env-Flags fuer alle vier.** `PAYMENT_ENABLED` wie live, `PROVISIONING_ENABLED`
unveraendert lassen (ein Test soll keine DID kaufen), `FAKE_ORIGINATE` **aus** (sonst ist es
kein Live-Test), `OUTBOUND_FROZEN=false`. Nach dem Testblock `ALLOWED_COUNTRY_CODES`
zurueckstellen - eine offen gelassene `+1`-Freischaltung oeffnet den gesamten NANP inklusive
der karibischen IRSF-Ziele (GAP-18, `outbound-gates.js:58-90` enthaelt keinen `+1`-Eintrag).

### 6.2 Manuell (22 Tests - kein Anruf, aber nicht automatisierbar)

| ID | Titel | Prio | Was gebraucht wird |
| --- | --- | --- | --- |
| MCP-19 | Tatsaechlicher Live-Wert von `PAYMENT_CURRENCY` im Render-Dashboard | P0 | Render-Dashboard (Service ist dashboard-managed, `render.yaml:15-17`) |
| DID-13 | Ist `PAYMENT_CURRENCY` live wirklich `usd`? | P0 | dito - Duplikat-nah zu MCP-19, aber anderer Beleg |
| WEB-02 | Welches Dashboard sieht ein echter US-Login heute | P0 | Browser + echter Login gegen die Live-Instanz |
| MCP-21 | agent-status-Widget zeigt bei EN-Locale deutsche Permission-Feldnamen | P0 | claude.ai im Browser, EN-Locale |
| PAY-02 | Waehrungsentscheid EUR-Cutover vs. "USD bindend" klaeren | P0 | Owner-Entscheidung, kein technischer Lauf (siehe 7.1) |
| FMT-02 | US-Anrufer: `now`-Tagesname weicht bei spaeter Ortszeit vom UTC-Tag ab | P0 | Prompt-Dump mit fixierter Uhr; manuelle Gegenrechnung |
| VOICE-27 | Echter EN-Outbound klingt hoerbar britisch statt US-amerikanisch | P1 | Abhoeren; kombinierbar mit PROMPT-23 |
| VOICE-28 | US-STT-Erkennungsguete (amerikanischer Akzent) bei `en-GB` | P1 | US-Sprecher, 10 diktierte Ziffern + 3 Namen, Wortfehlerrate zaehlen |
| MCP-17 | Claude-Tool-Nutzungsqualitaet bei rein englischer Chat-Session | P1 | claude.ai-Session, qualitative Bewertung |
| PROMPT-05 | Kein Dashboard-Weg, `settings.language` selbst zu korrigieren | P1 | Browser, beide Dashboards durchklicken |
| PAY-11 | `tenant.html` rendert Geldbetraege hart `de-DE` | P1 | Browser |
| PAY-19 | `off_session` ohne 3DS-Redirect bei SCA-Fehlschlag | P1 | Stripe-Testmodus, 3DS-Testkarte |
| DID-18 | Fehlermeldung "Einrichtung fehlgeschlagen." ist hart deutsch | P1 | Browser, Fehlerzustand herbeifuehren |
| LAW-05 | Land-Gate ist reine Whitelist, keine Consent-/Zeitfenster-Kopplung | P1 | Code-Review-Protokoll |
| LAW-10 | Keine FCC-Feb-2024-konforme Vorab-Einwilligung fuer KI-Stimme | P1 | Rechts-/Doku-Sichtung |
| LAW-11 | Privacy Policy ist deutschsprachiger Platzhalter ohne CCPA-Sprache | P1 | Sichtung `apps/web/src/pages/datenschutz.astro` + gerenderte Seite |
| LAW-24 | Disclosure im EN-Realtime-Pfad bleibt LLM-instruiert statt LLM-frei | P1 | Code-Review `src/bridge.js` + ggf. Realtime-Probe |
| LANG-20 | "Automatic (by number)"-Label verschleiert den DE-Fallback | P2 | Browser, `apps/web` SettingsIsland |
| MCP-18 | `navigator.language`-Verlaesslichkeit im claude.ai-Iframe | P2 | Browser-DevTools im Doppel-Iframe |
| LAW-12 | AGB ist deutschsprachiger Platzhalter | P2 | Sichtung |
| LAW-16 | Datenresidenz fix Frankfurt/EU auch fuer US-Kunden | P2 | `render.yaml:11` + Betriebsbestaetigung |
| LAW-23 | `PLAN-SECURITY.md` hat keine LAW/Consent/TCPA-Rubrik | P2 | Doku-Sichtung |

**Protokollpflicht.** Jeder Live- und Manuell-Test braucht ein schriftliches Protokoll
(Datum, Call-ID bzw. Screenshot, Ergebnis, Kosten). Ohne Protokoll gilt der Test als nicht
gelaufen - diese 26 Tests sind die einzigen, die kein Kommando wiederholen kann.

---

## 7. Offene Produktentscheidungen

Die folgenden Punkte lassen sich nicht durch einen Test entscheiden. Ohne Entscheidung bleibt
jeder darauf aufbauende Test willkuerlich - der Test kann danach nur noch pruefen, ob die
Entscheidung im Code angekommen ist.

### 7.0 Entscheidungsstand (Owner, 2026-07-25)

Alle Punkte sind entschieden oder ausdruecklich zurueckgestellt. Damit ist **kein kanonischer
Test mehr blockiert**. Die Analyse-Abschnitte 7.1-7.11 bleiben als Beleglage unveraendert
stehen; die Entscheidung steht jeweils als `**ENTSCHIEDEN**`-Zeile darunter.

| Nr. | Entscheidung | Folge fuer den Testvorrat |
| --- | --- | --- |
| **7.11** | **Kein Zuschnitt.** Launch weltweit, alle Maerkte gleichzeitig, Inbound UND Outbound. Keine Markt-Reihenfolge, keine Funktions-Verkleinerung. | Abschnitt 1.2 (Marktreihenfolge USA -> UK -> EU) ist damit **ueberholt**. Neue Achse **7.12**. |
| **7.1** | **EUR ueberall.** Website und Stripe bleiben in Euro - der heutige, in sich konsistente Zustand (`plans.js:21,29` = `apps/web/src/lib/plans.js:13,29`, Anzeige `€4.99`/`€9.99` ueber `CURRENCY_SYMBOLS`). Kein USD-Cutover. | PAY-01, FMT-15 **entblockt** (als Regressions-Pins: Anzeige = Belastung). |
| **7.2** | **Zurueckgestellt.** Steuerberater-Frage, keine Code-Frage. | GAP-02 **faellt aus dem Arbeitsvorrat**; Risiko bleibt offen dokumentiert. |
| **7.4** | **Zurueckgestellt.** Kein Consent-/TCPA-/DNC-Gate wird jetzt spezifiziert. | LAW-06, GAP-12, GAP-13 **fallen aus dem Arbeitsvorrat**; Risiko bleibt offen dokumentiert (siehe 7.13). |
| **7.5** | **`en-US` wird ein eigenes Bundle.** Regionalvarianten in `SUPPORTED_LANGUAGES`; `dateLocale`, `sttLocale` und TTS-Stimme loesen regional auf. | VOICE-01 **entblockt**. |
| **7.6** | **Geteilt.** Das *Gate* (Anrufzeitfenster) ist **abgelehnt** - der Owner will Nutzer nicht in ihren Anrufzeiten beschraenken. Die *Anzeige* wird korrigiert: **Zeitzone als Feld am Tenant**, beim Onboarding aus dem Land gesetzt. | LAW-07 **faellt aus dem Arbeitsvorrat**. FMT-28 **entblockt** (Datenmodell-Feld + `claude.js:43` bekommt `timeZone`). |
| **7.8** | **Perioden-Topf, nach Besetzung des Warnkanals.** Erst `PLATFORM_ALERT_SMS_TO` auf die vom Owner benannte Betreiber-Nummer (Wert **nur** in der Render-Env, nie im Repo), dann `BUDGET_MONTH_ENABLED=true`. Beides Env-Flips ohne Deploy. | GAP-01, GAP-07 **entblockt**. Betriebsauflage siehe 7.8. |
| **E1** | **Normalisieren** (`language="EN"` -> `en`), wie empfohlen. | LANG-19 **entblockt**. |
| **E2** | **Aus der DID-Vorwahl ableiten**, kein Raten; ohne ableitbares Land bleibt das Feld leer. | GAP-34 **entblockt**. |
| **E3** | **`place_call.language` entfernen** - wirkungsloser Parameter, der das Modell in die Irre fuehrt. | LANG-15 **entblockt**. |
| **E4** | **Agentensprache**, serverseitig ins Widget-HTML gerendert. | UI-14, UI-18 **entblockt**. |

**Bilanz.** 16 blockierte Tests (nicht 13 - die Zaehlung in `00-kanonische-liste.md`
Abschnitt 4 war um drei zu niedrig, die Tabelle dort listet 16 IDs) sind aufgeloest:
**11 entblockt, 5 zurueckgestellt**. Von 219 kanonischen Tests bleiben damit
**214 im Arbeitsvorrat**, alle sofort implementierbar. Dazu kommen die neuen Tests aus 7.12.

### 7.12 NEU - Weltweiter Sprach-Default (entsteht aus 7.11)

Der weltweite Start bringt eine Entscheidung ins Spiel, die der Katalog nicht kannte, weil er
von der Reihenfolge USA -> UK ausging: **welche Sprache bekommt ein Land ohne eigenes Bundle?**

`LANGUAGE_FOR_COUNTRY` (`src/i18n/locales.js:268-275`) kennt sechs Laender - DE/AT/CH/FR/GB/IE.
Es gibt drei Bundles (de/fr/en). Jedes andere Land faellt ueber `languageForCountry`
(`:278-280`) und `localeFor` (`:284-286`) auf `DEFAULT_LANGUAGE` = **`de`**. Ein Nutzer in
Spanien, Japan oder Brasilien bekommt heute einen deutschsprachigen Agenten.

**ENTSCHIEDEN: Englisch wird Weltdefault.** `DEFAULT_LANGUAGE` wechselt von `de` auf `en`;
DE/AT/CH bleiben `de`, FR bleibt `fr`. Der fail-safe *Mechanismus* bleibt unveraendert (R3 der
kanonischen Liste) - nur der Wert am Ende der Kette aendert sich.

**Das ist ein Eingriff in den Bestand, kein reiner Zusatz** und braucht eigene Tests:

- **WORLD-01** (P0, offline) - `languageForCountry("ES"|"JP"|"BR"|null|"")` liefert `en`.
  *Heute*: **rot** (liefert `de`).
- **WORLD-02** (P0, offline) - Regressionsachse: `languageForCountry` liefert weiterhin `de`
  fuer DE/AT/CH und `fr` fuer FR; `localeFor("de")`/`localeFor("fr")` unveraendert.
  *Heute*: **gruen** - und muss es nach dem Wechsel bleiben.
- **WORLD-03** (P0, offline) - `localeFor(null|undefined|"xx")` liefert das **en**-Locale.
  *Heute*: **rot**. Deckt zugleich den Kollisionspunkt mit `test/f1-geo-port.test.js:61` ab:
  jener Test pinnt `languageForCountry("US") === DEFAULT_LANGUAGE` und wird durch den Wechsel
  zufaellig "richtig" - bei unveraendert irrefuehrender Begruendung. Er faellt nach R5 der
  kanonischen Liste unter die Loeschpflicht, nicht unter die Anpassungspflicht.

**Damit 217 Tests im Arbeitsvorrat.**

### 7.13 Ausdruecklich getragene Risiken

Diese Punkte sind **nicht** geloest, sondern bewusst offen - sie stehen hier, damit sie nicht
als vergessen gelten:

1. **Kein Consent-/DNC-Gate bei weltweitem Outbound** (7.4 zurueckgestellt). Das Land-Gate
   steht live auf `*` (`tasks/i18n-tests/13-live-env-befund.md`), es gibt kein Consent-Glied
   in der 17-gliedrigen Gate-Kette (`outbound-gates.js:423-705`), keine DNC-Pruefung und -
   nach 7.6 - bewusst auch kein Anrufzeitfenster. TCPA (USA), PECR (UK) und die kanadischen
   Robocall-Regeln gelten ab dem ersten Anruf gleichzeitig.
2. **Keine Steuererhebung im Checkout** (7.2 zurueckgestellt). `createSubscriptionCheckoutSession`
   setzt weder `automatic_tax` noch eine Adresserfassung (`src/billing/stripe.js:262-284`).
3. **Rechtstexte nur auf Deutsch und als Platzhalter** (7.3 unveraendert offen), waehrend
   weltweit verkauft wird.
4. **Nur drei Sprachbundles** bei weltweitem Start: jeder nicht-deutsche, nicht-franzoesische
   Markt bekommt Englisch - inklusive Offenlegungssatz und Rechtstexten.

### 7.1 Waehrung des US-Markts

Der Code-Katalog traegt `currency:"eur"` (`src/plans.js:21,29`), der Marketing-Spiegel
ebenso (`apps/web/src/lib/plans.js:13,29`), `PAYMENT_CURRENCY` steht auf `eur`
(`src/config.js:362`, `render.yaml:186-187`) - waehrend die bindende Web-Vorgabe USD lautet
(Starter 4,99 / Business 9,99). Entweder EUR-Cutover oder USD-bindend; beides ist testbar,
aber erst NACH der Entscheidung. **Betroffen:** PAY-01, PAY-02, PAY-03, WEB-16, WEB-17,
MCP-08, MCP-19, DID-12, DID-13, FMT-16, FMT-17.

> **Faktenkorrektur (2026-07-25).** Die oben behauptete Divergenz zwischen Backend und
> Website existiert nicht. `apps/web/src/lib/plans.js:44` definiert
> `CURRENCY_SYMBOLS = { eur: "€", usd: "$" }`, und `formatPlanPrice` (`:49-53`) waehlt das
> Symbol aus dem Katalog-Feld `currency` - bei `"eur"` also `€`. Die Preisseite rendert
> heute **`€4.99` / `€9.99`** (`apps/web/src/pages/preise.astro:33`), nicht `$4.99`. Anzeige
> und Belastung stimmen ueberein; die "USD-Vorgabe" stammt aus der Web-Overhaul-Doku und ist
> im Code nie angekommen.
>
> **ENTSCHIEDEN (Owner, 2026-07-25): EUR ueberall, kein Cutover.** PAY-01 und FMT-15
> entblockt - sie pinnen ab jetzt die Invariante *Anzeige-Waehrung = Belastungs-Waehrung*.
> Die Kombination "`$` anzeigen, `€` abbuchen" ist ausdruecklich ausgeschlossen (falsche
> Preisangabe: FTC-relevant in den USA, PAngV-widrig in der EU).

### 7.2 Steuerpflicht und Registrierungen

Ob Hermes US Sales Tax und EU-OSS selbst erhebt (Stripe Tax) oder ueber einen
Merchant-of-Record verkauft, ist eine Geschaefts- und keine Codeentscheidung. Heute setzt
`createSubscriptionCheckoutSession` weder `automatic_tax` noch eine Adresserfassung
(`src/billing/stripe.js:262-284`). **Betroffen:** GAP-02, PAY-18.

> **ZURUECKGESTELLT (Owner, 2026-07-25).** Steuerberater-Frage, keine Code-Frage. GAP-02
> faellt aus dem Arbeitsvorrat; das Risiko steht als Punkt 2 in 7.13.

### 7.3 Rechtsgrundlage fuer die Verarbeitung des ANGERUFENEN

Art. 6 DSGVO (Rechtsgrundlage), Art. 14 (Information), Kap. V (Drittlandtransfer). Der
Angerufene ist Betroffener ohne Informations-, Widerspruchs- oder Loeschpfad; alle
vorhandenen Pfade sind auf den zahlenden Tenant zugeschnitten
(`src/routes/api-read.js:128`, `scripts/erase-tenant.js`). **Betroffen:** GAP-17, LAW-11,
LAW-13, LAW-21.

### 7.4 Einwilligungsmodell fuer US-Outbound

Ob Hermes ueberhaupt Fremde in den USA anrufen darf und wie eine "prior express consent" im
Produkt aussieht (Nutzer bestaetigt? Ziel bestaetigt? nur Geschaeftsnummern?), entscheidet,
welches Gate ueberhaupt gebaut wird. **Ohne diese Entscheidung ist der US-Outbound-Launch
nicht startbar - unabhaengig vom Land-Gate, und unabhaengig von jedem Test in diesem
Katalog.** **Betroffen:** LAW-06, LAW-10, GAP-12, GAP-13, und die Freigabe fuer W3.

> **ZURUECKGESTELLT (Owner, 2026-07-25).** Es wird jetzt kein Consent-/TCPA-/DNC-Gate
> spezifiziert. LAW-06, GAP-12 und GAP-13 fallen aus dem Arbeitsvorrat. Der Absatz oben
> bleibt woertlich gueltig: das Risiko ist damit nicht kleiner geworden, es ist getragen -
> siehe 7.13 Punkt 1. Es wiegt nach der Entscheidung 7.11 (weltweiter Start) schwerer als
> zum Zeitpunkt, an dem dieser Abschnitt geschrieben wurde.

### 7.5 `en-US` als eigenes Locale-Bundle oder akzeptiertes Risiko

`SUPPORTED_LANGUAGES` kennt drei Werte ohne Regionalvarianten (`src/i18n/locales.js:260`);
`en` ist an drei Stellen hart britisch (`locales.js:219-221`,
`adapters/telnyx/render.js:24`, `adapters/twilio/render.js:17`). Ein `en-US`-Bundle ist ein
Datenmodell-Eingriff, kein Test. **Betroffen:** VOICE-01, VOICE-02, VOICE-03, VOICE-26,
VOICE-27, VOICE-28, LAW-17, FMT-09.

> **ENTSCHIEDEN (Owner, 2026-07-25): `en-US` wird ein eigenes Bundle.** Regionalvarianten
> kommen in `SUPPORTED_LANGUAGES`; `dateLocale`, `sttLocale` und die TTS-Stimme loesen
> regional auf statt global britisch. VOICE-01 entblockt. Zusammen mit 7.12
> (Englisch als Weltdefault) ist damit zu klaeren, welche Variante der Weltdefault ist -
> die Entscheidung 7.12 nennt `en`, die Variantenwahl faellt beim Bundle-Schnitt.

### 7.6 Zeitzone im Datenmodell

Weder `tenant` noch `number` noch `settings` tragen eine Zeitzone
(`src/db/schema.sql:63-64,98,402-403`). Erst wenn entschieden ist, WO die Zeitzone haengt
(Tenant, Nummer, Ziel-NPA), koennen FMT-01/FMT-02, OUT-11 und ein Ruhezeiten-Gate ueberhaupt
eine Assertion formulieren. **Betroffen:** FMT-01, FMT-02, FMT-28, FMT-29, OUT-11, LAW-07.

> **ENTSCHIEDEN (Owner, 2026-07-25) - der Punkt zerfaellt in zwei.** Der Abschnitt oben hat
> zwei unabhaengige Sachverhalte in einer Frage gebuendelt:
>
> 1. **Anrufzeit-Gate ("nicht vor 8, nicht nach 21 Uhr") - ABGELEHNT.** Der Owner will Nutzer
>    nicht in ihren Anrufzeiten beschraenken. **LAW-07 faellt aus dem Arbeitsvorrat**, ebenso
>    das Ruhezeiten-Gate als Bauwerk. Risiko getragen, siehe 7.13 Punkt 1.
> 2. **Uhrzeit-ANZEIGE - KORRIGIERT: Zeitzone als Feld am Tenant**, beim Onboarding aus dem
>    Land gesetzt. Das ist keine Beschraenkung, sondern ein Produktfehler: `src/claude.js:43`
>    ruft `new Date().toLocaleString(loc.dateLocale, {...})` **ohne** `timeZone`-Option auf,
>    der Prozess nimmt die Server-Zeitzone, und der Server laeuft in Frankfurt
>    (`render.yaml:11`). Ein Nutzer in Kalifornien wird von seinem Agenten mit "Freitag,
>    14:30 Uhr" begruesst, waehrend es bei ihm 5:30 morgens ist; Terminabsprachen laufen in
>    deutscher Zeit. Bei weltweitem Start (7.11) trifft das jeden Nutzer ausserhalb
>    Mitteleuropas. **FMT-28 entblockt** (Schema-Feld + `timeZone` in `claude.js:43`).

### 7.7 Stundenlimit: Plattform-Notbremse oder Nutzerlimit?

GAP-10 verlangt ein Pro-Tenant-Limit mit einem sehr viel hoeheren globalen Notaus. Die
konkreten Zahlen sind eine Risiko-Abwaegung des Owners; **Absolute Regel 1 verbietet ein
blosses Hochsetzen von `MAX_CALLS_PER_HOUR` ohne Ersatz.** **Betroffen:** GAP-10.

### 7.8 Lebenszeit-Topf gegen Perioden-Topf

`BUDGET_MONTH_ENABLED=false` macht `MAX_BUDGET_EUR` zu einem geteilten LEBENSZEIT-Topf ueber
alle Tenants (`src/store/state-ops.js:1959-1975`, `render.yaml:275-276,310-311`). Ob das Flag
zum Launch umgelegt wird - und mit welchem Wert - ist eine Kosten-/Risikoentscheidung.
**Betroffen:** GAP-01, GAP-07, PAY-21.

> **Praezisierung (2026-07-25).** "Geteilter Lebenszeit-Topf" vermischt zwei Achsen. Die
> **Tenant-/Plattform-Trennung existiert** seit der Budget-Achsen-Kette P1-P7: es gibt eine
> Pro-Tenant-Decke (`effectiveCapCents`, `state-ops.js:1941-1946`) UND eine Plattform-Decke,
> und sie wirken als Schnittmenge. Offen ist allein die **Zeit-Achse**: `BUDGET_MONTH_ENABLED`
> steht auf `false` - im Code-Default (`config.js:540`) und in `render.yaml:310-311` - also
> zaehlen beide Achsen lebenslang (`state-ops.js:1961,1974`). Die Monats-Mechanik ist
> vollstaendig gebaut, nur nicht scharfgeschaltet.
>
> **ENTSCHIEDEN (Owner, 2026-07-25): Perioden-Topf, nach Besetzung des Warnkanals.**
> Reihenfolge als Betriebsauflage, beides Env-Flips ohne Deploy:
> 1. `PLATFORM_ALERT_SMS_TO` auf die vom Owner benannte Betreiber-Nummer. Der Wert gehoert
>    **ausschliesslich in die Render-Env** - eine private Rufnummer ist PII und wird nicht
>    ins Repo geschrieben (auch nicht in `render.yaml`, das im Repo liegt).
> 2. Danach `BUDGET_MONTH_ENABLED=true`.
>
> **Vorbedingung ERBRACHT (2026-07-25, Messung an der Prod-DB).** Der Code verlangt einen
> Live-Beleg, dass `spendMonthKey` einen Neustart uebersteht (`config.js:535-539`).
> `spend_month_key` und `spend_month_cost_cents` sind persistierte Postgres-Spalten
> (`schema.sql:301-302`), keine Prozess-Variablen - sie ueberleben einen Neustart per
> Konstruktion; die einzige dokumentierte Drift ist der ephemere Sub-Cent-Rest mit
> **< 1 Cent pro Neustart** (`schema.sql:296-300`). Empirisch bestaetigt:
>
> | Tenant | `spend_month_key` | Monat (ct) | Lebenszeit (ct) | Calls |
> | --- | --- | --- | --- | --- |
> | `t_user_01KX6008...` | 2026-07 | **81** | 385 | 25 |
> | `owner` | - | 0 | 3 | 14 |
> | `t_user_01KXH2B7...` | - | 0 | 0 | 2 |
>
> **AUSGEFUEHRT (2026-07-25, 09:02 UTC).** Beide Env-Werte am Live-Dienst gesetzt
> (`srv-d8m0fhflk1mc73bno570`, merge - keine andere Variable beruehrt). Ausgeloester Deploy
> `dep-d9i7nab7uimc73b3e5ig` ist live, Boot-Beleg
> `[boot] deployed commit=566ccd678842fc0d0261777ecce412e1fc71cb52`. Nebeneffekt bewusst in
> Kauf genommen: der Deploy brachte 6 zuvor ungedeployte Commits live, darunter den Codefix
> `3cb6f57` (KE-P9). Wirkung des Flips auf den aktiven Tenant: Gate-Verbrauch faellt von
> 385 ct (lebenslang) auf 81 ct (Juli), also 519 statt 215 ct Spielraum unter der 600-ct-Decke.
>
> **NEUER BEFUND - `BUDGET_MONTH_ENABLED` ist am laufenden Dienst nicht ablesbar.** Weder
> `src/boot.js` noch `src/boot-guard.js` geben das Flag aus (grep: null Treffer). Belegt ist
> nach dem Boot nur die Schwester-Variable: die frueher bei JEDEM Boot erscheinende Warnung
> zu leerem `PLATFORM_ALERT_SMS_TO` ist verschwunden - beide Werte kamen aus demselben
> API-Aufruf. Fuer die Budget-Achse selbst gibt es **keinen direkten Laufzeit-Beleg**.
> Das ist dieselbe Klasse wie GAP-36 (Deploy-Wahrheit): ein Schalter, der ein Safety-Gate
> umstellt, gehoert in den Boot-Banner. **Empfehlung: eine Boot-Zeile ergaenzen**, die die
> aktive Budget-Achse nennt - sonst ist bei jedem kuenftigen Zweifel wieder eine DB-Messung
> noetig. GAP-01 und GAP-07 sind entblockt.

### 7.9 DID-Lebenszyklus nach Kuendigung

`RELEASE_GRACE_DAYS=0` ist ausdruecklich Observe-Only (`src/release-reconcile.js:119`). Die
Gnadenfrist ist eine Produkt-/Rechtsentscheidung (Nummernportabilitaet, Rueckkehrer,
Kuendigungs-Leak). **Betroffen:** GAP-06, DID-17.

### 7.10 Deploy-Wahrheit und Rollback

Dass `render.yaml` nur Referenz ist und die Live-Konfiguration im Dashboard steht
(`render.yaml:15-17`), hat Konsequenzen fuer JEDEN Test in diesem Katalog: solange das gilt,
beweist ein gruener `render.yaml`-Test nichts ueber Live. GAP-36 macht die Divergenz
messbar, beseitigt sie aber nicht. **Betroffen:** GAP-33, GAP-36, MCP-19, DID-13, WEB-02.

### 7.11 Marktreihenfolge unter Aufwand

Vier der 30 Wurzeln (W1-W4) sind Einzeiler-nah, sechs (W5, W6, W10, W16, W18, W19) sind
Datenmodell- oder Architektureingriffe. Der Owner entscheidet, ob der Launch auf
"US mit Einschraenkungen" (nur Inbound, kein Outbound) verkleinert wird - dann faellt der
gesamte Consent-/Zeitzonen-/Tarif-Komplex zunaechst weg, und die Testmenge halbiert sich.
Diese Entscheidung ist NICHT im Katalog abgebildet.

> **ENTSCHIEDEN (Owner, 2026-07-25): kein Zuschnitt.** Launch weltweit, alle Maerkte
> gleichzeitig, Inbound UND Outbound. Keine Markt-Reihenfolge, keine Funktions-Verkleinerung.
>
> Folgen fuer diesen Katalog:
> - **Abschnitt 1.2 (Marktreihenfolge USA -> UK -> EU, "bindend fuer die Prioritaeten") ist
>   ueberholt.** Es gibt keine Reihenfolge mehr; P0 bemisst sich nicht mehr nach Marktrang.
> - Die Testmenge halbiert sich nicht, sie waechst: neue Achse **7.12** (Sprach-Default fuer
>   Laender ohne Bundle) mit drei zusaetzlichen P0-Tests.
> - Vier Rechtsrahmen gelten ab dem ersten Anruf gleichzeitig (TCPA/USA, PECR/UK,
>   Robocall-Regeln/Kanada, DSGVO) - waehrend 7.4 zurueckgestellt ist. Siehe 7.13 Punkt 1.

---

## 8. Verweise

### 8.1 Sektionsdateien

| Datei | Bereich | Tests |
| --- | --- | --- |
| [`tasks/i18n-tests/00-kanonische-liste.md`](tasks/i18n-tests/00-kanonische-liste.md) | **Aufloesung der Duplikat-Cluster - der verbindliche Arbeitsvorrat** | 214 kanonisch |
| [`tasks/i18n-tests/01-sprachaufloesung.md`](tasks/i18n-tests/01-sprachaufloesung.md) | LANG - Sprach-Aufloesungskette Ende zu Ende (Registrierung bis in den Anruf) | 26 |
| [`tasks/i18n-tests/02-llm-prompts.md`](tasks/i18n-tests/02-llm-prompts.md) | PROMPT - LLM-/Prompt-Schicht, hartkodiertes Deutsch | 24 |
| [`tasks/i18n-tests/03-telefonie-render.md`](tasks/i18n-tests/03-telefonie-render.md) | VOICE - Telefonie-Renderschicht (STT/TTS/Stimme/Assistant) | 29 |
| [`tasks/i18n-tests/04-mcp-und-widgets.md`](tasks/i18n-tests/04-mcp-und-widgets.md) | MCP - MCP-Schicht und Widgets in claude.ai | 21 |
| [`tasks/i18n-tests/05-auslandstelefonie.md`](tasks/i18n-tests/05-auslandstelefonie.md) | OUT - Auslandstelefonie, Laender-Gate, Wahlziel-Normalisierung | 29 |
| [`tasks/i18n-tests/06-nummern-provisioning.md`](tasks/i18n-tests/06-nummern-provisioning.md) | DID - Nummern-Provisioning und DID-Lebenszyklus pro Land | 20 |
| [`tasks/i18n-tests/07-geld-und-waehrung.md`](tasks/i18n-tests/07-geld-und-waehrung.md) | PAY - Waehrung, Preise, Steuern, Budget-Gates, Ist-Kosten | 26 |
| [`tasks/i18n-tests/08-web-dashboard-onboarding.md`](tasks/i18n-tests/08-web-dashboard-onboarding.md) | WEB - Web, Dashboard, Self-Service, Onboarding-Texte | 26 |
| [`tasks/i18n-tests/09-recht-und-compliance.md`](tasks/i18n-tests/09-recht-und-compliance.md) | LAW - Recht und Compliance pro Land | 25 |
| [`tasks/i18n-tests/10-zeit-format-daten.md`](tasks/i18n-tests/10-zeit-format-daten.md) | FMT - Zeitzonen, Formate, Kalender, Datenmodell | 32 |
| [`tasks/i18n-tests/11-luecken-und-e2e.md`](tasks/i18n-tests/11-luecken-und-e2e.md) | GAP + E2E - Luecken-Kritik, Deckungsmatrix, Ende-zu-Ende-Ketten | 44 (38 GAP + 6 E2E) |
| [`tasks/i18n-tests/12-sprachachsen-ui.md`](tasks/i18n-tests/12-sprachachsen-ui.md) | UI - Sprachachsen der Chat-Oberflaeche, Widget-Chrome, Host-Signal | 20 |
| [`tasks/i18n-tests/13-live-env-befund.md`](tasks/i18n-tests/13-live-env-befund.md) | **Live-Env gemessen (Schritt 2)** - korrigiert Kurzurteil Punkt 4 | - |

Jede Sektionsdatei enthaelt zusaetzlich zum Testblock einen Ist-Stand mit Stichproben-
verifikation am Code und eine Luecken-Tabelle mit Schweregrad. `11-luecken-und-e2e.md`
enthaelt ausserdem die vollstaendige Deckungsmatrix aller 68 Ausfallmodi.

### 8.2 Projekt-Referenzen

- `CLAUDE.md` - Absolute Regeln (insbesondere Regel 1 Safety-Gates und Regel 2 Offenlegung)
- `PLAN-SECURITY.md` - Sicherheits-Plan; hat heute **keine** LAW/Consent/TCPA-Rubrik (LAW-23)
- `STATUS.md:140` - EU-AI-Act Art. 50(2) ausdruecklich auf 08/2026 vertagt
- `README.md` - bewusste Vereinfachungen und Abweichungen
- `.env.example`, `render.yaml` - Env-Dokumentation bzw. Deploy-Referenz
  (`render.yaml:15-17`: Referenz, NICHT Wahrheit)
- `test/helpers.js` - `BASE_ENV`; die zentrale Ursache dafuer, dass die Suite die
  Produktionskonfiguration nicht sieht (GAP-33)
- `PLAN-LAUNCH-TESTS.md` - der vorhergehende, nicht-internationale Launch-Testplan

### 8.3 Nicht geaenderte Dateien

Bei der Erstellung dieses Dokuments wurde ausschliesslich gelesen. Geaendert bzw. angelegt
wurden nur `PLAN-I18N-TESTS.md` selbst und die Dateien unter `tasks/i18n-tests/`.
An `src/`, `test/`, `public/`, `apps/`, `scripts/` und den Konfigurationsdateien wurde
nichts veraendert.
