# Luecken und Ende-zu-Ende-Ketten (Vollstaendigkeits-Kritik)

Rolle dieses Dokuments: nicht Bestaetigung des Bestehenden, sondern die **Luecke**. Alle 68
Ausfallmodi aus den fuenf Pre-Mortem-Linsen wurden gegen die 258 bereits formulierten Tests
gehalten. Ein Test zaehlt nur dann als Deckung, wenn seine **Schritte und Assertions** den
Ausfallmodus tatsaechlich ausloesen wuerden - ein passend klingender Titel zaehlt nicht.

Stichprobenverifikation in dieser Session (alles am echten Code, kein Netz):

- `normalizeDialTarget("011441234567", "+49")` liefert **`+4911441234567`** und diese Nummer
  **besteht** `E164` (`node -e`-Lauf in dieser Session). Die Aussage in
  `05-auslandstelefonie.md:34` ("`011`-US-Auslandspraefix bleibt unveraendert und faellt am
  E.164-Regex durch (400)") gilt NUR fuer `homeCountry=null`; mit ableitbarem DE-Heimatland
  ist das Ergebnis eine gueltige, vom Land-Gate erlaubte **falsche deutsche Nummer**.
  Beleg: `src/store/defaults.js:517-532`, `src/store/defaults.js:476`. -> GAP-25.
- `EMERGENCY_SHORT_CODES = ["110","112","911","999"]` (`src/telephony/outbound-gates.js:51`) -
  bestaetigt; `PREMIUM_PREFIXES` (`:58-88`) enthaelt **keinen einzigen `+1`-Eintrag**.
- `SUBSCRIPTION_EVENT` kennt genau vier Typen (`src/billing/webhook.js:18-23`), jeder andere
  Typ faellt auf `WEBHOOK_ACTION.IGNORE` (`:139`) - kein `dispute`/`refund` im Repo.
- `allow_promotion_codes: "true"` fest (`src/billing/stripe.js:279`); `automatic_tax`/
  `tax_id`/`billing_address`/`customer_update` kommen in `src/billing/stripe.js` nicht vor.
- `gateUsageCents` liest bei `budgetMonthEnabled=false` den **Lebenszeit**-Wert
  `bucket.costCents` (`src/store/state-ops.js:1959-1961`); `render.yaml:310-311` setzt das
  Flag auf `false`. Kein Codepfad setzt den Verbrauchs-Bucket bei Perioden-Verlaengerung
  zurueck (grep bestaetigt).
- `globalHourReached()` zaehlt **ohne Tenant-Filter** (`src/telephony/outbound-gates.js:191-192`,
  Kommentar dort: "Tenant-unabhaengig (ohne Filter = alle Calls)").
- `usdToEur: 0.93` ist eine nackte Zahl **ohne `process.env`-Anbindung**
  (`src/config.js:990`); `providerToBucketRateMicro` Default `920000` = 0,92
  (`src/config.js:386-389`). Zwei divergente Kurse fuer dasselbe Paar.
- `machine_detection`/`MachineDetection`/`answering_machine`/`AnsweredBy`: **0 Treffer** in
  `src/**/*.js`. `shaken`/`cnam`/`caller_id_name`: **0 Treffer**.
- `src/metrics.js` exportiert `createMetrics` mit sechs Ereignissen (`:35,56,64,75,86,95`) -
  **kein** Feld `country`/`language`; `METRICS_ENABLED` steht in `render.yaml:338-339`.
- `test/helpers.js` `BASE_ENV` neutralisiert genau die Launch-kritischen Achsen:
  `ALLOWED_COUNTRY_CODES: "*"` (`:84`), `MAX_CALLS_PER_HOUR: "100"` (`:85`),
  `VOICE_TARIFF_DOMESTIC_CENTS/DEFAULT_CENTS: "0"` (`:263-264`),
  `DEFAULT_TENANT_BUDGET_CENTS: "0"` (`:268`), `PLATFORM_SPEND_WARN_PERCENT: "0"` (`:272`),
  `BUDGET_MONTH_ENABLED: "false"` (`:277`), `PER_TARGET_CALL_CAP: "1000"` (`:293`).
- `render.yaml`: `plan: free` (`:13`) und `preDeployCommand` (`:31`) am selben Service;
  `buildCommand` baut `apps/web` (`:22`), `WEB_DIST_DIR="apps/web/dist"` (`:406-407`),
  aber `buildFilter.ignoredPaths` enthaelt `apps/web/**` (`:42-44`).
- `SELF_SERVICE_FREE_FIELDS = ["agentName","language","agentStyle"]`
  (`src/self-service.js:20`) gegen `SETTINGS_FREE_FIELDS = ["agentName","allowCalendar",
  "allowBooking","language"]` (`apps/web/src/lib/api.js:442-447`) - die UI bietet zwei
  Felder an, die der Server nicht mehr kennt, und laesst eines aus, das er kennt.
- `call.language` ist `TEXT NOT NULL DEFAULT 'de'` (`src/db/schema.sql:135`) und wird genau
  **einmal** bei Call-Anlage aufgeloest (`src/routes/api-calls.js:91`,
  `src/routes/voice.js:237,255`); alle spaeteren Turns lesen `call.language`
  (`src/routes/voice.js:105,111,287,354`, `src/telephony/voice-render.js:41,49`). Ein
  Sprachwechsel waehrend eines laufenden Anrufs ist damit **strukturell wirkungslos** -
  eine positive Invariante, die heute von keinem Test gepinnt ist. -> E2E-03.
- LLM-Turn-Budget-Kommentar (`src/config.js:144-147`): "3*3500 + (<=250+500) = <=11250 ms <
  12000 ms < Twilio-15s". Die ElevenLabs-Synthese laeuft **synchron im selben Webhook**
  (`src/tts/directive-synth.js:31,38,44` - `await` je Direktive in einer Schleife) mit bis zu
  `synthTimeoutMs=4000` (`src/config.js:247-251`). Der Rechenweg enthaelt weder diesen Posten
  noch eine Netzreserve fuer eine transatlantische Strecke. -> GAP-22.

---

## Deckungsmatrix

| Ausfallmodus | Linse | Schwere | gedeckt durch | Urteil |
| --- | --- | --- | --- | --- |
| PM-GELD-01 US-Outbound 402 (Reserve > Plan-Decke) | GELD | S1 | PAY-04, PAY-05, PAY-07, PAY-13, PAY-14, PAY-23, OUT-01 | gedeckt |
| PM-GELD-02 Lebenszeit-Topf gegen Monatsabo, kein Reset | GELD | S1 | - | **UNGEDECKT** (GAP-01) |
| PM-GELD-03 EUR-Produkt im Dollar-Markt | GELD | S1 | PAY-01, PAY-02, PAY-03, PAY-11, PAY-12, WEB-16, WEB-17, MCP-08, MCP-19, DID-12, DID-13, FMT-16, FMT-17 | gedeckt |
| PM-GELD-04 Keine Sales Tax / VAT | GELD | S1 | PAY-18 (nur grep auf Abwesenheit) | teilweise (GAP-02) |
| PM-GELD-05 Chargebacks sind ein Nicht-Ereignis | GELD | S1 | - | **UNGEDECKT** (GAP-03) |
| PM-GELD-06 Abo bezahlt, keine Nummer geliefert | GELD | S1 | DID-06, DID-14, DID-17 | teilweise (GAP-04) |
| PM-GELD-07 100-Prozent-Gutschein kauft DID umsonst | GELD | S1 | - | **UNGEDECKT** (GAP-05) |
| PM-GELD-08 DID-Miete laeuft nach Kuendigung ewig | GELD | S1 | DID-17 (Observe-Only + Cap) | teilweise (GAP-06) |
| PM-GELD-09 Ein Vielnutzer schaltet die Plattform ab | GELD | S1 | PAY-21 | teilweise (GAP-01, GAP-07) |
| PM-GELD-10 Zwei handgepflegte USD/EUR-Kurse | GELD | S2 | PAY-20 (nur Drift-Alarm-Abwesenheit) | teilweise (GAP-08) |
| PM-GELD-11 ElevenLabs-Kontingent global, nicht zurechenbar | GELD | S2 | - | **UNGEDECKT** (GAP-09) |
| PM-GELD-12 Inbound-Minute mit 300 ct/min im Ledger | GELD | S2 | PAY-09, PAY-10 | gedeckt |
| PM-GELD-13 6 Outbound/h plattformweit | GELD | S1 | - (LAW-08/FMT-19 grenzen nur Rate- gegen Zeitfenster ab) | **UNGEDECKT** (GAP-10) |
| PM-GELD-14 Setup-Hold laenderblind | GELD | S2 | DID-11, PAY-17 (pinnen die Gleichheit als Ist) | teilweise (GAP-11) |
| PM-RECHT-01 TCPA: KI-Stimme ohne prior express consent | RECHT | S1 | LAW-05, LAW-06, LAW-09, LAW-10 | gedeckt |
| PM-RECHT-02 Kein Anrufzeitfenster in Zielortszeit | RECHT | S1 | LAW-07, LAW-08, OUT-11, FMT-18, FMT-19 | gedeckt |
| PM-RECHT-03 Deutsche Offenlegung im US-Anruf | RECHT | S1 | LANG-01, LANG-07, LANG-10, LANG-25, VOICE-04, OUT-08, DID-01, DID-02, WEB-22, WEB-23, LAW-01, LAW-02, FMT-07, FMT-08 | gedeckt |
| PM-RECHT-04 Offenlegung ohne Rueckrufnummer/Opt-out | RECHT | S1 | OUT-24 (nur Byte-Stabilitaet des Satzes) | teilweise (GAP-12, GAP-13) |
| PM-RECHT-05 Inbound ohne KI-/Transkriptionshinweis | RECHT | S1 | LAW-06, WEB-04, WEB-05, PROMPT-03 (alle nur "Text ist deutsch", nicht "Pflichthinweis fehlt") | teilweise (GAP-14) |
| PM-RECHT-06 Rechtstexte deutscher Platzhalter | RECHT | S1 | LAW-11, LAW-12 (beide manuell) | teilweise (GAP-15) |
| PM-RECHT-07 audit_log speichert Rufnummern unbefristet | RECHT | S2 | LAW-13, LAW-14, LAW-15 (Calls/Transkripte, nicht audit_log) | teilweise (GAP-16) |
| PM-RECHT-08 Angerufener ohne Information/Betroffenenrechte | RECHT | S2 | LAW-11, LAW-13, LAW-21 | teilweise (GAP-17) |
| PM-RECHT-09 "+1" oeffnet den NANP-Premium-Raum | RECHT | S2 | OUT-09, OUT-19 (nur 900/976/Toll-Free) | teilweise (GAP-18) |
| PM-RECHT-10 privateNumber-Gate fest auf +49 | RECHT | S2 | FMT-10, FMT-11 | gedeckt |
| PM-RECHT-11 CLI-Herkunft frei entkoppelbar | RECHT | S2 | DID-10, DID-20, LAW-20, LANG-05 | teilweise (GAP-19) |
| PM-RECHT-12 Notruf-Liste DE/UK-zentriert (988/711/101/111) | RECHT | S3 | OUT-10, OUT-15 (nur die vier gelisteten Codes) | teilweise (GAP-20) |
| PM-TEL-01 Land-Gate laesst +1 nie durch | TEL | S1 | OUT-01, OUT-02, OUT-13, OUT-28, LANG-08, PAY-13, LAW-04 | gedeckt |
| PM-TEL-02 US-Nummer begruesst auf Deutsch | TEL | S1 | siehe PM-RECHT-03 | gedeckt |
| PM-TEL-03 Tarif-Tabelle kennt +1 nicht | TEL | S1 | PAY-04, PAY-05, PAY-07, PAY-22 | gedeckt |
| PM-TEL-04 Registrierung weist US-Handynummern ab | TEL | S1 | FMT-10, FMT-11 | gedeckt |
| PM-TEL-05 Kein Zeitzonen-/Nachtruhe-Gate | TEL | S1 | OUT-11, LAW-07, FMT-18 | gedeckt |
| PM-TEL-06 Keine Anrufbeantworter-/IVR-Erkennung | TEL | S1 | OUT-20 (nur DTMF-Abwesenheit) | teilweise (GAP-21) |
| PM-TEL-07 Kein en-US (britische Stimme + STT) | TEL | S1 | VOICE-01, VOICE-02, VOICE-03, VOICE-26, VOICE-27, VOICE-28, LAW-17, FMT-09 | gedeckt |
| PM-TEL-08 Latenzbudget transatlantisch gesprengt | TEL | S1 | - | **UNGEDECKT** (GAP-22) |
| PM-TEL-09 Eine globale ElevenLabs-Stimme | TEL | S1 | VOICE-12, VOICE-13 | gedeckt |
| PM-TEL-10 NANP-Premium-Ziele unter "+1" | TEL | S1 | OUT-09 | teilweise (GAP-18) |
| PM-TEL-11 "Scam Likely" - kein STIR/SHAKEN/CNAM | TEL | S1 | - | **UNGEDECKT** (GAP-23) |
| PM-TEL-12 EIN globaler Telnyx-Assistant | TEL | S2 | VOICE-14, VOICE-17, VOICE-18, VOICE-19 (Stimme/STT-Hint, nicht die Assistant-ID) | teilweise (GAP-24) |
| PM-TEL-13 Kein Barge-in im Budget-Pfad | TEL | S2 | VOICE-23, VOICE-24 | gedeckt |
| PM-TEL-14 Wahl-Normalisierung kennt nur DE/FR/UK | TEL | S1 | OUT-05, OUT-05b, OUT-06, OUT-16, OUT-17, FMT-20, FMT-21 (alle ohne den Fall `011...` + DE-Heimatland) | teilweise (GAP-25) |
| PM-TEL-15 Dauer-Cap ohne Warteschleifen-Kompetenz | TEL | S2 | OUT-20 (nur DTMF) | teilweise (GAP-26) |
| PM-SPRACHE-01 US ist kein Sprach-Land | SPRACHE | S1 | LANG-01, DID-01, DID-05, PROMPT-04, FMT-08 | gedeckt |
| PM-SPRACHE-02 Inbound-Begruessung nicht auf EN stellbar | SPRACHE | S1 | LANG-11, LANG-12, LANG-13, WEB-04, WEB-05, WEB-06, PROMPT-03, PROMPT-19, PROMPT-20 | gedeckt |
| PM-SPRACHE-03 Prompt-Geruest komplett deutsch | SPRACHE | S1 | PROMPT-01, PROMPT-08, PROMPT-22 | gedeckt |
| PM-SPRACHE-04 Testsuite zementiert den deutschen EN-Prompt | SPRACHE | S1 | - (DID-15 benennt nur EINEN solchen Fall) | **UNGEDECKT** (GAP-27) |
| PM-SPRACHE-05 Deutsche Steuertexte in der messages-Kette | SPRACHE | S1 | - (`02-llm-prompts.md:33-34` nennt die vier Konstanten nur im Ist-Stand, kein Test) | **UNGEDECKT** (GAP-28) |
| PM-SPRACHE-06 Summary-SMS als Mischtext | SPRACHE | S1 | PROMPT-12, PROMPT-13, WEB-14, WEB-15, FMT-12, FMT-13, FMT-32 | gedeckt |
| PM-SPRACHE-07 Ablehnungen auf Deutsch | SPRACHE | S1 | PAY-12, MCP-04, MCP-05, WEB-09, LANG-16 | gedeckt |
| PM-SPRACHE-08 MCP-Beschreibungen primen deutsches objective | SPRACHE | S1 | MCP-01, MCP-02, PROMPT-09, OUT-07 (Beschreibungen ja, gesprochenes objective nein) | teilweise (GAP-29) |
| PM-SPRACHE-09 Keine Zeitzone im Prompt | SPRACHE | S1 | FMT-01, FMT-02, FMT-28 | gedeckt |
| PM-SPRACHE-10 tenant.html komplett deutsch | SPRACHE | S1 | WEB-01, WEB-08, WEB-17, PAY-11, VOICE-10, FMT-14, FMT-15 | gedeckt; Frontend-Drift zusaetzlich (GAP-30) |
| PM-SPRACHE-11 Englisch ist ausschliesslich britisch | SPRACHE | S2 | VOICE-01, LAW-17, FMT-09 | gedeckt; `sttLocale` als toter Code (GAP-31) |
| PM-SPRACHE-12 Play-TTS haengt den Sprach-Seam ab | SPRACHE | S1 | VOICE-12, VOICE-13 | gedeckt |
| PM-OPS-01 ALLOWED_COUNTRY_CODES ohne +1 | OPS | S1 | OUT-01, LANG-08, PAY-13, LAW-04 | gedeckt |
| PM-OPS-02 MAX_CALLS_PER_HOUR ist Plattform-Limit | OPS | S1 | - | **UNGEDECKT** (GAP-10) |
| PM-OPS-03 languageForCountry('US')='de', Test zementiert | OPS | S1 | LANG-01, DID-01, DID-15, VOICE-04 | gedeckt |
| PM-OPS-04 Inlands-Praefixe hartkodiert | OPS | S1 | PAY-04, PAY-07, PAY-25 | teilweise (GAP-32) |
| PM-OPS-05 Plattform-Topf lebenslang + Alarmkanal leer | OPS | S1 | PAY-21 | teilweise (GAP-01, GAP-07) |
| PM-OPS-06 Testsuite neutralisiert die Produktions-Gates | OPS | S1 | - (alle 258 Tests laufen gegen BASE_ENV bzw. explizite Test-Env) | **UNGEDECKT** (GAP-33) |
| PM-OPS-07 GEO_ENABLED fehlt in render.yaml | OPS | S1 | LANG-05, VOICE-05, VOICE-07 | gedeckt |
| PM-OPS-08 Kein Backfill fuer country/language | OPS | S1 | LANG-14, LANG-24, DID-16, OUT-21, WEB-26 (pinnen den Nicht-Backfill) | teilweise (GAP-34) |
| PM-OPS-09 Keine Metrik traegt Land/Sprache | OPS | S1 | - | **UNGEDECKT** (GAP-35) |
| PM-OPS-10 render.yaml ist Doku, nicht Wahrheit | OPS | S1 | MCP-19, DID-13, WEB-02 (drei Einzelwerte manuell) | teilweise (GAP-36) |
| PM-OPS-11 buildFilter schliesst apps/web aus | OPS | S2 | - | **UNGEDECKT** (GAP-37) |
| PM-OPS-12 Ein globaler Assistant, nur en-GB | OPS | S2 | VOICE-01, VOICE-14 | teilweise (GAP-24) |
| PM-OPS-13 preDeployCommand auf plan:free | OPS | S1 | - | **UNGEDECKT** (GAP-38) |
| PM-OPS-14 Summary-SMS nur an +49-Nummern | OPS | S2 | FMT-10, FMT-11 | gedeckt |
| PM-OPS-15 Agenten-Uhr ist die Serveruhr | OPS | S2 | FMT-01, FMT-02, VOICE-26 | gedeckt |

**Bilanz**: 32 gedeckt, 24 teilweise, 12 ungedeckt. Von den 12 ungedeckten sind **10 als S1
klassifiziert**. Die schwerwiegendste Einzelluecke ist PM-OPS-06 (GAP-33): sie erklaert,
warum die anderen ungedeckt bleiben konnten - die Suite faehrt nie die ausgelieferte
Konfiguration.

### Fehlende Modalitaeten (Zustaende, die kein Einzelbereich besitzt)

| Modalitaet | Status im Katalog | neuer Test |
| --- | --- | --- |
| Tenant wechselt das Land (DE -> US) nach der Registrierung | nirgends; `setTenantGeo` hat ausserhalb `POST /api/onboard` keinen Aufrufer (`src/routes/api-onboard.js:161,168`) | E2E-01 |
| Zwei Tenants mit verschiedenen Sprachen gleichzeitig durch die VOLLE Kette | nur schichtweise (PROMPT-18 Prompt, VOICE-25 Render, MCP-16 MCP) - keine Kette Onboard->Anruf->SMS | E2E-02 |
| Sprachumstellung waehrend eines laufenden Anrufs | nirgends; `call.language` ist eingefroren (`src/db/schema.sql:135`) - positive Invariante ungepinnt | E2E-03 |
| Bestandsdaten ohne `country`/`language` durch die volle Kette | nur Einzelpins (LANG-14/24, OUT-21, WEB-26) | E2E-04 |
| Vollstaendige US-Kette unter Produktionswerten | OUT-25 deckt nur die Outbound-Gate-Kette, und zwar unter neutralisierter Test-Env | E2E-05, GAP-33 |
| Sprach-Reinheit ueber ALLE nutzersichtbaren Kanaele in einer Zahl | PROMPT-14 aggregiert nur 5 Kanaele (Greeting, Prompt, toolDefs, SMS, Notification) | E2E-06 |

---

## Neue Tests

### GAP-01 - Abrechnungsperiode und Budget-Fenster sind dieselbe Achse
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: `BUDGET_MONTH_ENABLED=false` (wie `render.yaml:310-311` UND
  `test/helpers.js:277`), Tenant mit `planSlug="starter"`, abgeleiteter Decke
  (`deriveTenantBudgetFromPlan`)
- **Schritte**:
  1. Tenant abonnieren, Verbrauch bis exakt `planCapCents("starter")` buchen
  2. `budgetExceeded`/`gateUsageCents` pruefen -> heute `true`
  3. Stripe-Webhook `customer.subscription.updated` mit neuem
     `currentPeriodStart`/`currentPeriodEnd` einspielen (Muster
     `test/bill-period-anchor*.test.js`)
  4. `gateUsageCents(s, tenantId, cfg, nowIso)` und `quotaView(...)` erneut lesen
- **Erwartetes Ergebnis (Soll)**: nach dem Perioden-Wechsel ist `budgetExceeded === false`
  UND `quotaView.remainingMinutes === includedMinutes` - beide Achsen zeigen dieselbe Periode
- **Verifikation**: neuer Test neben `test/plan-cap-derivation.test.js`; Assertion
  `assert.equal(gateUsageCents(...), 0)` nach dem Webhook
- **Heute erwartbar**: **rot** - `gateUsageCents` liefert bei `budgetMonthEnabled=false` den
  Lebenszeit-Wert `bucket.costCents`, den kein Codepfad zuruecksetzt; die Minuten-Achse
  (`planMinutesExceeded`) rechnet dagegen gegen den Stripe-Anker
- **Belegt durch**: src/store/state-ops.js:1959-1961 (`gateUsageCents`), :1095-1107
  (`deriveTenantBudgetFromPlan` setzt nur die DECKE), :2154-2157 (`planMinutesExceeded`);
  src/billing/meter.js:83-88 (der Divergenz-Kommentar); render.yaml:310-311

### GAP-02 - Stripe-Checkout erhebt Steuer und erfasst das Kundenland
- **Prioritaet**: P0
- **Modus**: offline (Vertragstest gegen den Stripe-Adapter mit gemocktem `fetch`)
- **Vorbedingung**: `PAYMENT_ENABLED=true`, Fake-Fetch, der den Request-Body einsammelt
- **Schritte**:
  1. `createSubscriptionCheckoutSession(...)` mit dem Fake-Fetch aufrufen
  2. den gesendeten `application/x-www-form-urlencoded`-Body parsen
  3. Katalog `PLAN_CATALOG` auf ein explizites `tax_behavior` je Plan pruefen
- **Erwartetes Ergebnis (Soll)**: der Body traegt `automatic_tax[enabled]=true` UND eine
  Adresserfassung (`billing_address_collection` oder `customer_update[address]`); jeder
  Katalog-Eintrag traegt ein explizites `tax_behavior`
- **Verifikation**: neue Datei `test/stripe-tax-contract.test.js`
- **Heute erwartbar**: **rot** - der Body setzt ausschliesslich
  `mode/customer/success_url/cancel_url/line_items/allow_promotion_codes/metadata`; grep nach
  `automatic_tax|tax_id|billing_address|customer_update` in `src/billing/stripe.js` -> 0
- **Belegt durch**: src/billing/stripe.js:262-284, :197-205 (`createCustomer` ohne Adresse);
  src/plans.js:16-49 (kein `tax_behavior`); PAY-18 belegt heute nur die Abwesenheit

### GAP-03 - Jedes zahlungsrelevante Stripe-Ereignis hat eine getestete Wirkung
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: Webhook-Route erreichbar (Muster `test/bill-webhook*.test.js`), gueltige
  Signatur bzw. Signatur-Skip wie in den Bestandstests
- **Schritte**: fuer jeden Typ aus `["charge.dispute.created", "charge.refunded",
  "customer.subscription.paused", "invoice.payment_action_required"]` ein Event an
  `/api/stripe/webhook` senden und Store + Audit-Log danach lesen
- **Erwartetes Ergebnis (Soll)**: jedes Ereignis erzeugt eine EXPLIZITE, assertierte Wirkung
  (Statuswechsel ODER Audit-Eintrag); `IGNORE` ist nur mit begruendendem Code-Kommentar UND
  eigener Assertion zulaessig
- **Verifikation**: neue Datei `test/stripe-money-events-contract.test.js`
- **Heute erwartbar**: **rot** - `interpretWebhook` kennt nur die vier Typen in
  `SUBSCRIPTION_EVENT`; alles andere faellt in den `default`-Zweig mit
  `WEBHOOK_ACTION.IGNORE`, ohne Store-Aenderung und ohne Audit-Eintrag
- **Belegt durch**: src/billing/webhook.js:18-23, :96-140 (`default` -> IGNORE), :200;
  kein `refund`/`dispute` in `src/billing/stripe.js` (grep 0)

### GAP-04 - Aktivierung und Nummern-Lieferung sind eine Transaktion
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: `MAX_NUMBERS` exakt auf die Zahl bereits vergebener Nummern gesetzt
  (globaler Cap erschoepft); zweiter Durchlauf mit `PROVISIONING_ENABLED=false`
- **Schritte**:
  1. Store so seeden, dass `requestNumber` mit `global_cap` scheitert
  2. `activatePaidTenant(...)` fuer einen neuen zahlenden Tenant fahren
  3. Tenant-Status, KYC-Level und Nummern-Bestand danach lesen
  4. Wiederholung mit `PROVISIONING_ENABLED=false` (Dry-Run-Zweig)
- **Erwartetes Ergebnis (Soll)**: der Tenant ist danach NICHT `active`, ODER es existiert ein
  kompensierender Effekt (Storno/Refund/Alarm-Audit mit eigenem Grund)
- **Verifikation**: neuer Test neben `test/bill-activation*.test.js`
- **Heute erwartbar**: **rot** - `activatePaidTenant` setzt KYC und Status VOR `provision()`
  und wertet dessen Rueckgabe nicht aus; der Dry-Run verlaesst den Orchestrator mit
  `ok:true, reason:"dry_run"`
- **Belegt durch**: src/billing/activation.js:61-74; src/worker/provisioning-orchestrator.js:
  112-120; src/store/state-ops.js:1265-1268 (globaler Cap); render.yaml:153-154,158-159

### GAP-05 - Kein Nummernkauf ohne Hold (Gutschein-Missbrauch)
- **Prioritaet**: P0
- **Modus**: offline (npm test, Fake-Stripe)
- **Vorbedingung**: `retrieveSubscription` liefert `invoiceTotal: 0` (100-Prozent-Coupon)
- **Schritte**:
  1. Abo-Aktivierung mit `numberSetupFeeExempt=true` durchlaufen
  2. pruefen, ob `placeHold`/`captureHold` aufgerufen wurden
  3. pruefen, ob eine Nummer bestellt wurde
  4. zusaetzlich: Konfigurationstest auf `allow_promotion_codes`
- **Erwartetes Ergebnis (Soll)**: entweder wird KEINE Nummer bestellt, ODER es wird ein Hold
  ueber die Setup-Gebuehr platziert; `allow_promotion_codes` nur zusammen mit einer expliziten
  Coupon-Allowlist
- **Verifikation**: neuer Test neben `test/onboarding-hold*.test.js`
- **Heute erwartbar**: **rot** - `placeHoldUnlessExempt` springt bei gesetztem Flag direkt zu
  `beginProvisioning` und gibt `null` zurueck (womit auch `captureHold` entfaellt), die
  Kaufkette laeuft unveraendert weiter; `allow_promotion_codes: "true"` ist bedingungslos
- **Belegt durch**: src/billing/stripe.js:279, :368-372; src/onboarding.js:74-112, :93,
  :134-138

### GAP-06 - Monatliche DID-Miete wird gebucht, gekuendigte DIDs werden freigegeben
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: `RELEASE_GRACE_DAYS > 0` (Soll-Konfiguration; heute `0` laut
  `render.yaml:170-171`), Tenant mit aktiver Nummer und einem Abo
- **Schritte**:
  1. Abo anlegen, Nummer aktivieren, `customer.subscription.deleted` einspielen
  2. Uhr um die konfigurierte Gnadenfrist vorstellen, `runReleaseReconcile` fahren
  3. getrennt davon: die Uhr um zwei Kalendermonate vorstellen und die `usage_event`-Zeilen
     der Art `number_month` fuer diese Nummer zaehlen
- **Erwartetes Ergebnis (Soll)**: (a) die Nummer ist `released` ODER es existiert ein
  Alarm-Audit mit Anzahl und Monatskosten der nicht freigegebenen Nummern; (b) pro
  angebrochenem Kalendermonat einer aktiven Nummer existiert GENAU EIN `number_month`-Event
- **Verifikation**: Erweiterung von `test/tenant-prolif-d-reconcile.test.js` plus ein neuer
  Ledger-Test
- **Heute erwartbar**: **rot** fuer (b) - `recordNumberMonthMeter` feuert ausschliesslich beim
  Aktivieren einer NEUEN Nummer; ein monatlicher Scheduler existiert nicht. Fuer (a) heute
  gruen nur im Observe-Only-Sinn (DID-17 pinnt das)
- **Belegt durch**: src/billing/metering.js:73-88; src/worker/provisioning-orchestrator.js:
  170-173; src/release-reconcile.js:111-122; src/config.js:730-731; render.yaml:170-171

### GAP-07 - Eine Fruehwarnung ohne Empfaenger ist keine Sicherung
- **Prioritaet**: P0
- **Modus**: offline (npm test, Boot-Guard)
- **Vorbedingung**: `PAYMENT_ENABLED=true`, `PLATFORM_SPEND_WARN_PERCENT > 0`,
  `PLATFORM_ALERT_SMS_TO=""` (exakt der Deployment-Zustand)
- **Schritte**: `assertConfig`/Boot-Guard-Kette mit dieser Env fahren
- **Erwartetes Ergebnis (Soll)**: FATAL-Befund (Boot bricht ab), nicht nur eine WARN-Zeile
- **Verifikation**: neuer Fall in `test/boot-guard*.test.js`, Muster `spendCapCoherence`
- **Heute erwartbar**: **rot** - `warnAlertChannelUnset` ist bewusst nur eine Warnung; der
  Kanal ist im Deployment leer, die 80-Prozent-Warnung feuert damit einmal ins Audit-Log
- **Belegt durch**: src/boot.js:162-165; src/config.js:534; render.yaml:299-300,304-305;
  src/telephony/outbound-gates.js:395-400

### GAP-08 - Es gibt genau EINE Quelle fuer den USD/EUR-Kurs
- **Prioritaet**: P1
- **Modus**: offline (npm test, reiner Config-Vergleich)
- **Vorbedingung**: keine
- **Schritte**:
  1. `config.llm.usdToEur` lesen
  2. `config.billing.providerToBucketRateMicro / 1_000_000` lesen
  3. beide vergleichen; zusaetzlich pruefen, ob `usdToEur` ueber die Umgebung setzbar ist
- **Erwartetes Ergebnis (Soll)**: beide Werte sind identisch UND beide stammen aus derselben,
  env-setzbaren Quelle
- **Verifikation**: neue Datei `test/fx-single-source.test.js`
- **Heute erwartbar**: **rot** - `0.93` gegen `0.92`, und `usdToEur` ist eine nackte Zahl ohne
  `process.env`-Anbindung (ein Deployment noetig, um sie zu korrigieren)
- **Belegt durch**: src/config.js:990 (`usdToEur: 0.93`, kein `numEnv`); src/config.js:386-389
  (`providerToBucketRateMicro`, fallback 920000); src/store/state-ops.js:1808, :2085
  (Verbraucher von `usdToEur`); PAY-20 prueft heute nur die Abwesenheit eines Drift-Alarms

### GAP-09 - TTS-Zeichen sind je Tenant zurechenbar, und ein erschoepftes Kontingent hat einen definierten Zustand
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: Play-TTS aktiv, zwei Tenants mit je einem Call
- **Schritte**:
  1. je Tenant einen Call mit bekannter Zeichenzahl synthetisieren lassen (Fake-Synth)
  2. die TTS-Zeichen je Tenant aus dem Ledger rekonstruieren
  3. Kontingent auf 0 setzen und einen weiteren Call fahren
- **Erwartetes Ergebnis (Soll)**: (a) die Summe der tenant-gekeyten Zeilen entspricht dem
  Plattform-Zaehler; (b) bei erschoepftem Kontingent tritt ein definierter, assertierter
  Zustand ein (Degradation auf Azure-`<Say>` ODER Sperre), nicht stille Overage
- **Verifikation**: neue Datei `test/tts-quota-attribution.test.js`
- **Heute erwartbar**: **rot** fuer (a) - `recordTtsCharacters` zaehlt plattformweit ohne
  `tenantId`; `USAGE_EVENT_KIND` kennt nur `voice_minute/ai_token/number_month/sms`. Die
  Auswertung ist im Code ausdruecklich "REINE ANZEIGE: kein Gate/keine Reserve/keine Buchung"
- **Belegt durch**: src/tts/directive-synth.js:64; src/store/defaults.js:123-130
  (`USAGE_EVENT_KIND`); src/routes/api-billing.js:99-121; src/config.js:548-556;
  render.yaml:313-316

### GAP-10 - Das Stundenlimit greift pro Tenant, nicht plattformweit
- **Prioritaet**: P0
- **Modus**: offline (npm test, Server-Kindprozess mit `FAKE_ORIGINATE`)
- **Vorbedingung**: `MAX_CALLS_PER_HOUR=6` (der Deployment-Wert aus `render.yaml:143-145`,
  NICHT der BASE_ENV-Wert 100), zwei vollstaendig freigeschaltete Tenants
- **Schritte**:
  1. Tenant A setzt 6 Outbound-Calls innerhalb einer Stunde ab
  2. Tenant B setzt EINEN Outbound-Call ab
  3. zusaetzlich: den Ablehnungstext auf interne Env-Namen pruefen
- **Erwartetes Ergebnis (Soll)**: Tenant B bekommt 2xx - kein Tenant darf wegen des Verhaltens
  ANDERER Tenants abgelehnt werden; keine Ablehnungsnachricht nennt einen Env-Variablennamen
- **Verifikation**: neue Datei `test/hour-limit-per-tenant.test.js`
- **Heute erwartbar**: **rot** - `globalHourReached()` zaehlt `countOutboundCallsSince(...)`
  ohne Tenant-Filter (Kommentar im Code: "Tenant-unabhaengig (ohne Filter = alle Calls)");
  das bezahlte Plan-Profil setzt `maxCallsPerHour: null` und faellt damit auf genau diesen
  globalen Wert zurueck. Der Ablehnungstext gibt `MAX_CALLS_PER_HOUR=` nach aussen preis
- **Belegt durch**: src/telephony/outbound-gates.js:190-192, :194-201, :292; src/plans.js:89-90,
  :106; render.yaml:143-145; test/helpers.js:85 (die Neutralisierung, die es verdeckt)

### GAP-11 - Hold, Capture und gebuchte Nummernkosten stimmen je Kaufland ueberein
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: eine gepflegte Laenderpreis-Tabelle (heute nicht vorhanden - Teil des
  Soll-Zustands)
- **Schritte**:
  1. fuer JEDES Land in `COUNTRY_SEARCH_PARAMS` und fuer das Kauf-Land aus
     `FORCE_NUMBER_COUNTRY` einen expliziten `holdAmountCents` verlangen
  2. eine Provisionierung durchlaufen und `holdAmountForCountry` === Capture-Betrag ===
     `number_month`-`costCents` assertieren
- **Erwartetes Ergebnis (Soll)**: kein Rueckfall auf den globalen Default fuer ein aktiv
  bespieltes Kauf-Land; die drei Betraege sind identisch
- **Verifikation**: neuer Test neben `test/provisioning-geo*.test.js`
- **Heute erwartbar**: **rot** fuer (1) - der US-Eintrag traegt ausschliesslich
  `telnyxCountryCode`, kein `holdAmountCents`, und `FORCE_NUMBER_COUNTRY="US"` macht US zum
  Kauf-Land ALLER Maerkte. DID-11/PAY-17 pinnen die heutige Gleichheit als Ist, nicht die
  Preis-Invariante
- **Belegt durch**: src/telephony/provisioning-geo.js:34-38, :69-77;
  src/worker/provisioning-orchestrator.js:146,159-161; src/onboarding.js:96;
  render.yaml:175-176

### GAP-12 - Der erste gesprochene Satz nennt eine Rueckrufnummer und einen Opt-out
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: Tenant mit `ownerName` und aktiver DID; Calls in de/fr/en
- **Schritte**:
  1. `openingText(call)` fuer jede Sprache in `SUPPORTED_LANGUAGES` rendern
  2. auf eine E.164-Nummer pruefen (Regex `/\+[1-9]\d{6,14}/`)
  3. auf einen Opt-out-Hinweis pruefen (kuratierte Marker je Sprache)
- **Erwartetes Ergebnis (Soll)**: jeder Erst-Turn enthaelt eine E.164-Rueckrufnummer UND einen
  Opt-out-Hinweis - in JEDER Sprache
- **Verifikation**: neue Datei `test/disclosure-callback-optout.test.js`
- **Heute erwartbar**: **rot** - der Offenlegungssatz ist in allen drei Sprachen rein
  namensbasiert; `openingText` haengt nur `bridgePhrase` + gekapptes Anliegen an
- **Belegt durch**: src/i18n/locales.js:130-131 (de), :188-189 (fr), :237-238 (en);
  src/claude.js:254-259, :264-278; OUT-24 pinnt heute nur die Byte-Stabilitaet des Satzes

### GAP-13 - Ein Opt-out ueberdauert das Wiederhol-Fenster
- **Prioritaet**: P0
- **Modus**: offline (npm test, Server-Kindprozess)
- **Vorbedingung**: Suppression-Liste im Store (Soll-Zustand, heute nicht vorhanden)
- **Schritte**:
  1. Ziel in die Suppression-Liste eintragen
  2. `POST /api/calls` auf dieses Ziel -> erwartet 403 `grund=optout`
  3. Uhr um mehr als `PER_TARGET_WINDOW_MS` vorstellen, Schritt 2 wiederholen
- **Erwartetes Ergebnis (Soll)**: beide Male 403; das Ablaufen von `perTargetWindowMs` hebt die
  Sperre NICHT auf
- **Verifikation**: neue Datei `test/optout-suppression.test.js`
- **Heute erwartbar**: **rot** - es existiert keine Suppression-Liste; die einzige
  zielbezogene Bremse ist `perTargetCapReached` gegen ein 24-Stunden-Fenster, also
  selbstheilend. `profile.allowedNumbers` ist eine Erlaubnis-, keine Sperrliste; die einzige
  echte Sperrliste ist statisch und kennt kein Laufzeit-Schreiben
- **Belegt durch**: src/telephony/outbound-gates.js:205-210, :241, :51-90;
  src/config.js:685-688

### GAP-14 - Inbound-Pflichtsatz (KI + Transkription) ist fest verdrahtet und nicht abschaltbar
- **Prioritaet**: P0
- **Modus**: offline (npm test)
- **Vorbedingung**: Tenant mit Default-Settings; zusaetzlich ein Admin-Schreibversuch auf
  `settings.greeting`
- **Schritte**:
  1. `/voice/incoming` fuer jede Sprache fahren und den ERSTEN gesprochenen Text erfassen
  2. auf einen kuratierten Pflicht-Marker pruefen (KI-Hinweis + Transkriptions-/
     Aufzeichnungshinweis), byte-genau gepinnt wie in `test/de-umlaut-orthography.test.js`
  3. `updateSettings(s, tenantId, { greeting: "Hallo." })` (ohne Pflicht-Marker) aufrufen
- **Erwartetes Ergebnis (Soll)**: (a) der erste Inbound-Satz enthaelt den Pflicht-Marker in
  jeder Sprache; (b) `updateSettings` VERWIRFT ein Greeting ohne Marker fail-closed
- **Verifikation**: neue Datei `test/inbound-disclosure-mandatory.test.js`
- **Heute erwartbar**: **rot** - `/voice/incoming` spricht `ctx.settings.greeting` als ersten
  und einzigen Satz; weder `DEFAULT_GREETING` noch eine der drei `GREETING_TEMPLATES` erwaehnt
  KI-Transkription; `updateSettings` prueft `greeting` nur per `typeof`, also passiert jeder
  String. Der Outbound-Satz sagt "zusammengefasst", nicht "transkribiert", waehrend das Audio
  live an einen Dritten geht
- **Belegt durch**: src/routes/voice.js:265,278-279; src/store/defaults.js:320-321,336;
  src/self-service.js:26-33; src/store/state-ops.js:2507-2524;
  src/telephony/adapters/telnyx/render.js:115 (`transcriptionEngine`);
  src/i18n/locales.js:130-131,188-189,237-238

### GAP-15 - Kein Build mit Platzhalter-Rechtstexten, EN-Routen vorhanden
- **Prioritaet**: P0
- **Modus**: offline (Build-Zeit-Gate in `apps/web`)
- **Vorbedingung**: `npm --prefix apps/web run build` erzeugt `apps/web/dist`
- **Schritte**:
  1. Build-Output nach `Platzhalter`, `ergaenzt der finale`, `liefert der Owner` greppen
  2. pruefen, ob fuer jede Rechtsseite eine EN-Route existiert und im Layout `lang="en"` traegt
  3. pruefen, ob die Registrierungs-/Checkout-Seite auf die sprachlich passende Fassung verlinkt
- **Erwartetes Ergebnis (Soll)**: 0 Platzhalter-Treffer in `/agb`, `/datenschutz`,
  `/impressum`; EN-Routen (`/legal/privacy`, `/legal/terms`) vorhanden
- **Verifikation**: neuer Test in `apps/web` bzw. ein Repo-Test, der `apps/web/src/pages`
  liest (kein Build noetig fuer die Routen-Paritaet)
- **Heute erwartbar**: **rot** - `apps/web/src/pages` enthaelt genau `404/agb/datenschutz/
  impressum/index/preise/registrieren/so-funktionierts`, keine EN-Rechtsseite; die Inhalte
  bezeichnen sich selbst als Platzhalter
- **Belegt durch**: apps/web/src/pages/datenschutz.astro:2-4,23; agb.astro:33;
  impressum.astro:9; LAW-11/LAW-12 sind heute rein manuell

### GAP-16 - audit_log faellt unter Retention und Loeschung
- **Prioritaet**: P1
- **Modus**: offline (npm test, pg/pglite-Backend)
- **Vorbedingung**: pg-Backend (Muster der bestehenden Migrations-/RLS-Tests)
- **Schritte**:
  1. Tenant anlegen, zwei abgelehnte Outbounds erzeugen (Audit-Eintraege mit `to=`)
  2. `eraseTenantData(tenantId)` ausfuehren, danach `audit_log` auf E.164-Muster pruefen
  3. `pruneOldData` mit `retentionDays` fahren, Zeilen aelter als die Frist zaehlen
- **Erwartetes Ergebnis (Soll)**: nach (2) enthaelt kein `audit_log`-Datensatz mehr eine
  E.164-Zeichenkette dieses Tenants; nach (3) sind Zeilen jenseits der Retention geloescht
  oder pseudonymisiert
- **Verifikation**: neue Datei `test/audit-retention.test.js`
- **Heute erwartbar**: **rot** - `audit_log` ist ausdruecklich immutable append-only und soll
  die Tenant-Loeschung ueberdauern; der Schreiber kennt nur INSERT; `pruneOldData` fasst
  ausschliesslich Calls/Notifications und Diagnose-Transkripte an. Die Detail-Strings tragen
  die Zielrufnummer im Klartext
- **Belegt durch**: src/db/schema.sql:495-506; src/audit-store.js:5-11;
  src/store/state-ops.js:2457-2467; src/telephony/outbound-gates.js:434,458,499,514,544,602,
  624,630,692,701

### GAP-17 - Jeder externe Empfaenger steht im Subprozessor-Verzeichnis
- **Prioritaet**: P1
- **Modus**: offline (npm test + Astro-Build-Gate)
- **Vorbedingung**: eine versionierte `subprocessors.json` als EINE Quelle (Soll-Zustand)
- **Schritte**:
  1. jeden im Code konfigurierten externen Empfaenger aus `src/config.js` ableiten
     (Anthropic, OpenAI, ElevenLabs, Telnyx inkl. Deepgram, Twilio, Stripe, WorkOS)
  2. gegen `subprocessors.json` pruefen
  3. die Datenschutzseite aus dieser Liste generieren lassen
- **Erwartetes Ergebnis (Soll)**: kein nicht gelisteter Empfaenger; ein neuer Verarbeiter ohne
  Datenschutz-Update bricht den Build
- **Verifikation**: neue Datei `test/subprocessors-coverage.test.js`
- **Heute erwartbar**: **rot** - es existiert kein Verzeichnis; die Datenschutzseite nennt
  weder Empfaenger noch Drittlandtransfer, und der Gespraechsinhalt verlaesst das System
  zusaetzlich als SMS
- **Belegt durch**: apps/web/src/pages/datenschutz.astro (drei Platzhalter-Abschnitte);
  src/telephony/adapters/telnyx/render.js:115; src/telephony/adapters/telnyx/voice.js:293-296;
  src/tts/directive-synth.js:28; src/sms-summary.js:26-58; render.yaml:11

### GAP-18 - NANP-Sub-Ranges bleiben gesperrt, auch wenn "+1" erlaubt ist
- **Prioritaet**: P0
- **Modus**: offline (npm test, Tabellentest)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES` enthaelt `+1`
- **Schritte**: fuer `+1900`, `+1976`, `+1809`, `+1829`, `+1849`, `+1876`, `+1268`, `+1284`,
  `+1473`, `+1649`, `+1664`, `+1767` je ein `POST /api/calls`
- **Erwartetes Ergebnis (Soll)**: jedes Mal 403 mit `grund=denylist` (Denylist hat Praezedenz
  vor dem Land-Gate - diese Reihenfolge ist bereits so gebaut); zusaetzlich ein Boot-Guard,
  der `+1` ohne begleitende NANP-Denylist ablehnt
- **Verifikation**: Erweiterung von `test/number-gate.test.js`, Muster des bestehenden
  IRSF-Blocks
- **Heute erwartbar**: **rot** fuer alle zwoelf - `PREMIUM_PREFIXES` enthaelt keinen einzigen
  `+1`-Eintrag; `matchesPrefix` mit `startsWith` laesst `+1` den kompletten NANP durch. OUT-09
  deckt heute nur `+1900`/`+1976` ab und erwartet dort ausdruecklich 500 statt 403
- **Belegt durch**: src/telephony/outbound-gates.js:58-88, :127, :179-183, :273-281;
  src/config.js:666

### GAP-19 - Absender-Land und Kauf-Land duerfen nicht unbemerkt auseinanderlaufen
- **Prioritaet**: P1
- **Modus**: offline (npm test, Boot-Guard)
- **Vorbedingung**: `FORCE_NUMBER_COUNTRY="US"` bei `PROVISIONING_COUNTRY="DE"` (exakt der
  Deployment-Zustand)
- **Schritte**:
  1. Boot-Guard-Kette mit dieser Env fahren
  2. zusaetzlich einen Outbound eines DE-Tenants mit US-DID auf ein DE-Ziel fahren
- **Erwartetes Ergebnis (Soll)**: (a) der Start bricht ab ODER verlangt ein explizites
  Betriebs-Ack per Env; (b) ein Gate `cli_plausibility` auditiert die Konstellation
- **Verifikation**: neuer Fall in `test/boot-guard*.test.js`
- **Heute erwartbar**: **rot** - `forceNumberCountry` ueberschreibt das Kauf-Land ausdruecklich
  entkoppelt vom Herkunftsland; `outboundFrom` nimmt die aktive Nummer ohne jeden Bezug zur
  Zielvorwahl; `stir`/`shaken`/`attestation` kommen im Code nicht vor. DID-10/LAW-20 pinnen
  die Entkopplung als Ist, ohne sie zu problematisieren
- **Belegt durch**: src/config.js:780-787; src/geo/resolve.js:33-37;
  src/telephony/outbound-gates.js:315-318; render.yaml:160-161,175-176

### GAP-20 - Notruf-/Krisen-Kurzwahlen sind eine bewusste Sperre, kein Formatfehler
- **Prioritaet**: P1
- **Modus**: offline (npm test, Tabellentest)
- **Vorbedingung**: `ALLOWED_COUNTRY_CODES="*"`
- **Schritte**: `POST /api/calls` fuer `988`, `711`, `211`, `311`, `511`, `101`, `111`
  (zusaetzlich zu `110`, `112`, `911`, `999`)
- **Erwartetes Ergebnis (Soll)**: exakt 403 `grund=denylist` MIT Audit-Eintrag - nicht 400
  `grund=format`
- **Verifikation**: Erweiterung von `test/number-gate.test.js`
- **Heute erwartbar**: **rot** fuer die sieben neuen Codes - `EMERGENCY_SHORT_CODES` hat vier
  Eintraege; alles andere Nicht-E.164 faellt auf 400 `grund=format`, und dieser Zweig wird
  ausdruecklich NICHT auditiert. Die Sperrwirkung haengt damit am E.164-Regex, nicht an einer
  benannten Sicherheitsregel
- **Belegt durch**: src/telephony/outbound-gates.js:51, :126-127, :266-281, :541

### GAP-21 - Anrufbeantworter/IVR werden erkannt und beenden den Anruf kontrolliert
- **Prioritaet**: P0
- **Modus**: offline (npm test, Adapter-Snapshot + Webhook-Simulation)
- **Vorbedingung**: Fake-Provider-Client, der den Origination-Body einsammelt
- **Schritte**:
  1. `originateCall` (TeXML) und `originateViaCallControl` aufrufen, Bodys pinnen
  2. `/voice/status` bzw. den Call-Control-Webhook mit `AnsweredBy=machine_start` fahren
  3. das Call-Ergebnis und die Summary-SMS pruefen
- **Erwartetes Ergebnis (Soll)**: beide Bodys tragen ein Machine-Detection-Feld; bei
  `machine_start` folgt ein sofortiger kontrollierter Hangup mit
  `failureReason="voicemail"`, KEIN gesprochener Offenlegungssatz, keine Summary-SMS; ein Call
  mit 0 substanziellen Gegenueber-Turns gilt nie als `objective_achieved`
- **Verifikation**: neue Datei `test/machine-detection.test.js`
- **Heute erwartbar**: **rot** - grep nach `machine_detection|MachineDetection|
  answering_machine|AnsweredBy` in `src/**/*.js` liefert **0 Treffer**; die einzige Reaktion
  auf Stille ist die generische Eskalation nach drei Turns, die den Anruf trotzdem bezahlt
- **Belegt durch**: src/telephony/adapters/telnyx/voice.js:638-665, :697-718;
  src/no-speech-escalation.js:16-21; src/telephony/directives.js:17-23 (kein DTMF-Verb)

### GAP-22 - Das Turn-Budget enthaelt TTS-Synthese und eine Netzreserve
- **Prioritaet**: P0
- **Modus**: offline (npm test, reine Rechnung + ein Integrationstest)
- **Vorbedingung**: keine (Teil 1); Fake-Synth mit kuenstlicher Verzoegerung (Teil 2)
- **Schritte**:
  1. Rechnung: `(llmMaxRetries+1)*llmRequestTimeoutMs + 2*llmBackoffMs +
     elevenLabsPlayTts.synthTimeoutMs + NETZ_RESERVE_MS` gegen eine benannte Konstante
     `PROVIDER_WEBHOOK_HARDCUT_MS` (15000) assertieren
  2. Integration: den Synth-Aufruf `synthTimeoutMs` lang haengen lassen und pruefen, dass
     `/voice/turn` trotzdem innerhalb des Hardcuts antwortet
- **Erwartetes Ergebnis (Soll)**: die Summe bleibt unter dem Hardcut; die Synthese blockiert
  den Turn nicht
- **Verifikation**: neue Datei `test/turn-latency-budget.test.js`
- **Heute erwartbar**: **rot** - der dokumentierte Rechenweg endet bei 11250 ms und enthaelt
  weder die Synthese noch eine Netzreserve; die Synthese laeuft `await`-sequenziell im selben
  Webhook, bei einer GATHER+SAY-Antwort sogar mehrfach. 11250 + 4000 = 15250 ms liegt bereits
  ohne Netz ueber dem 15-s-Hardcut
- **Belegt durch**: src/config.js:144-147 (der Rechenweg), :247-251 (`synthTimeoutMs` bis
  4000, max 10000); src/tts/directive-synth.js:31,38,44 (`await` je Direktive in der Schleife);
  render.yaml:11 (`region: frankfurt`)

### GAP-23 - Rufnummern-Reputation wird gemessen und stoppt den Nachschub
- **Prioritaet**: P1
- **Modus**: offline (Kennzahl-Test) + manuell (Display-Probe je Carrier)
- **Vorbedingung**: Call-Records mit `failureReason` (bereits vorhanden)
- **Schritte**:
  1. Kennzahl "no-answer-Quote je Absender-DID, je Land" ueber die ersten N Anrufe berechnen
  2. Schwelle definieren, ab der der Provisioning-Nachschub stoppt
  3. Struktur: pruefen, ob eine US-Nummer ohne abgeschlossene Registrierung den Status
     `active` erreichen kann
  4. manuell: je Ziel-Carrier ein Testanruf von einer frischen DID auf ein reales Endgeraet,
     Display fotografieren
- **Erwartetes Ergebnis (Soll)**: die Kennzahl existiert und ist auswertbar; eine Nummer ohne
  Registrierungsschritt erreicht `active` NICHT (fail-closed, wie das KYC-Gate)
- **Verifikation**: neue Datei `test/did-reputation-metric.test.js` + manueller Punkt in der
  Launch-Checkliste
- **Heute erwartbar**: **rot** - grep nach `shaken|cnam|caller_id_name` in `src/` liefert 0;
  die Nummernbeschaffung sucht ausschliesslich nach `filter[country_code]` +
  `filter[features][]=voice` und bestellt; `failureReason` wird klassifiziert, aber nirgends
  je DID aggregiert
- **Belegt durch**: src/telephony/adapters/telnyx/numbers.js:68-95;
  src/telephony/provisioning-geo.js:34-38; src/telephony/failure-reason.js:11-23

### GAP-24 - Assistant-Bindung und STT-Hint haengen an der Sprache des Calls
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: zwei Calls verschiedener Tenants mit `language="de"` bzw. `"en"`
- **Schritte**:
  1. `bindAssistantToCall` fuer beide Calls aufrufen und die Assistant-Referenz vergleichen
  2. den Inbound-Pfad `startAssistant(...)` fahren und den gesendeten Body pruefen
  3. Guard: das Provisioner-Skript ohne gesetzte Stimm-/Assistant-Env laufen lassen
- **Erwartetes Ergebnis (Soll)**: unterschiedliche Assistant-Referenzen je Sprache; jeder
  `startAssistant`-Aufruf traegt ein `transcription`-Feld mit dem Sprach-Hint; das
  Provisioner-Skript bricht ohne gesetzte Env ab statt Live-Konfiguration zu schreiben
- **Verifikation**: neue Datei `test/assistant-language-binding.test.js`
- **Heute erwartbar**: **rot** - `bindAssistantToCall` schreibt eine einzige globale
  `assistantId` an jeden Call; der Inbound-Pfad reicht gar keine Sprache durch und
  `transcriptionFields` liefert bei fehlender Sprache `{}`. VOICE-14/17/18/19 decken Stimme
  und STT-Hint, nicht die Assistant-Identitaet
- **Belegt durch**: src/config.js:276; src/telnyx-origination.js:13-15; src/telnyx-inbound.js:41;
  src/telephony/adapters/telnyx/voice.js:293-297, :201 (`STT_FLUX_HINTS` ohne Regionalvariante);
  scripts/telnyx-assistant-provision.mjs:175-203

### GAP-25 - Kein stiller Landeswechsel bei der Wahl-Normalisierung
- **Prioritaet**: P0
- **Modus**: offline (npm test, Tabellentest)
- **Vorbedingung**: keine (reine Funktion)
- **Schritte**:
  1. `normalizeDialTarget("011441234567", "+49")` aufrufen
  2. `normalizeDialTarget("0114155501234", "+49")` aufrufen
  3. `normalizeDialTarget("2125550123", "+1")` und `normalizeDialTarget("1-415-555-0123", "+1")`
  4. Invariante: jede Eingabe, deren normalisierte Form eine ANDERE Laendervorwahl traegt als
     die Eingabe erkennbar meinte, wird abgelehnt
- **Erwartetes Ergebnis (Soll)**: (1) und (2) werden ABGELEHNT (nicht in `+49...` verwandelt);
  (3) ergibt `+14155550123`; der E.164-Fehlertext ist lokalisiert statt eine deutsche
  Beispielnummer zu zeigen
- **Verifikation**: Erweiterung von `test/dial-target-normalization.test.js`
- **Heute erwartbar**: **rot** - in dieser Session gemessen: `"011441234567"` + `"+49"` ->
  **`+4911441234567`**, und diese Nummer besteht die `E164`-Regex UND das Land-Gate (`+49`
  steht in der Default-Allowlist). Das ist eine gueltige, echte deutsche Nummer, die der Agent
  anruft, obwohl der Nutzer ein UK-Ziel in US-Schreibweise meinte. `INTERNATIONAL_CALL_PREFIX`
  ist `"00"`, im NANP ist es `"011"`. OUT-06 testet diesen Fall nur mit `homeCountry=null`
- **Belegt durch**: src/store/defaults.js:517 (`INTERNATIONAL_CALL_PREFIX = "00"`), :525-532
  (`normalizeDialTarget`), :476 (`E164`), :506-513 (`homeCountryCode`);
  src/telephony/outbound-gates.js:141 (`E164_FORMAT_ERROR` mit deutscher Beispielnummer),
  :466-478; `05-auslandstelefonie.md:34` (die zu praezisierende Behauptung)

### GAP-26 - Ein am Dauer-Cap gestorbener Anruf ist maschinenlesbar als solcher erkennbar
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: Fake-Gather, der wiederholt Ansage-/Musik-Text liefert
- **Schritte**:
  1. einen Call bis an `maxCallDurationS` laufen lassen, ohne dass je ein substanzieller
     Gegenueber-Turn kam
  2. einen Warteschleifen-Call simulieren (Gather liefert wiederholt Ansagetext)
- **Erwartetes Ergebnis (Soll)**: (a) der Call traegt ein eigenes Ergebnis (z.B.
  `failureReason="capped_no_contact"`) statt eines normal beendeten Calls mit
  `objective_achieved=false`; (b) der Agent laeuft nicht in die no-speech-Eskalation und legt
  nicht auf
- **Verifikation**: neue Datei `test/call-cap-no-contact.test.js`
- **Heute erwartbar**: **rot** - `resolveMaxDurationS` klemmt kompromisslos auf 300 s; es gibt
  keine Hold-/Musik-Erkennung, keine DTMF-Ausgabe, und die Stille-Eskalation legt nach drei
  leeren Turns von sich aus auf, also deutlich VOR dem Cap
- **Belegt durch**: src/store/defaults.js:252-253; src/config.js:803-807;
  src/telephony/outbound-gates.js:132-138; src/no-speech-escalation.js:16-21;
  src/telephony/directives.js:17-23

### GAP-27 - Charakterisierungs-Tests sind als solche gekennzeichnet und nie allein
- **Prioritaet**: P1
- **Modus**: offline (Meta-Test ueber `test/`)
- **Vorbedingung**: keine
- **Schritte**:
  1. jeden Test finden, der einen Nicht-DE-Sprachwert byte-genau pinnt
  2. pruefen, ob sein Name/Datei ihn als CHARAKTERISIERUNG markiert
  3. pruefen, ob daneben ein Eigenschafts-Test steht (Sprachreinheit statt Byte-Gleichheit)
- **Erwartetes Ergebnis (Soll)**: jeder Nicht-DE-Byte-Pin traegt die Kennzeichnung UND hat
  einen begleitenden Eigenschafts-Test; ohne beides schlaegt der Meta-Test an
- **Verifikation**: neue Datei `test/characterization-marking.test.js`
- **Heute erwartbar**: **rot** - `test/personal-assistant-characterization.test.js:333-346`
  ("SP5 systemPrompt outbound en byte-identisch") pinnt einen EN-Prompt, dessen erwartete
  Konstante woertlich mit `Du bist "Hermes", der persoenliche KI-Telefonassistent von Jonas.`
  beginnt; `test/f1-geo-port.test.js:61` pinnt `languageForCountry("US") === DEFAULT_LANGUAGE`;
  `test/f1-i18n-locale.test.js:133-153` pinnt `en.greetingDefault`, ein Feld ohne
  Produktionskonsumenten. Alle drei lesen sich wie Abnahme-Tests
- **Belegt durch**: test/personal-assistant-characterization.test.js:215-221,333-346;
  test/f1-geo-port.test.js:61; test/f1-i18n-locale.test.js:133-153; DID-15 benennt heute
  genau EINEN dieser Faelle

### GAP-28 - Kein deutscher Text in der messages-/tool_result-Kette eines EN-Calls
- **Prioritaet**: P0
- **Modus**: offline (npm test, Fake-LLM-Client)
- **Vorbedingung**: Fake-`llm.complete`, der die uebergebenen `messages` und die
  `tool_result`-Inhalte einsammelt; Call mit `language="en"`
- **Schritte**:
  1. Outbound-Turn ohne Vorgeschichte fahren (Bootstrap-Marker)
  2. einen Turn mit leerem `SpeechResult` fahren (Silent-Marker)
  3. `take_message` ausloesen (tool_result)
  4. `end_call` im Erst-Turn ausloesen (unterdrueckt -> `END_CALL_WAIT_INSTRUCTION`)
- **Erwartetes Ergebnis (Soll)**: kein Element der `messages`-Kette und kein `tool_result`
  enthaelt deutschen Text (Stoppwort-Assertion)
- **Verifikation**: neue Datei `test/llm-message-chain-language.test.js`
- **Heute erwartbar**: **rot** - vier sprachlose deutsche Konstanten werden unabhaengig von
  `call.language` in die Konversation geschrieben:
  `OUTBOUND_OPENING_BOOTSTRAP`, `INBOUND_OPENING_BOOTSTRAP`, `SILENT_TURN_MARKER`,
  `END_CALL_WAIT_INSTRUCTION`; dazu die `execTool`-Rueckgabe `"Nachricht ist notiert."`.
  Keine davon laeuft durch `localeFor`
- **Belegt durch**: src/claude.js:385, :407-408, :413, :418-419, :552-562, :611-615;
  `02-llm-prompts.md:33-34` nennt sie im Ist-Stand, ohne Test

### GAP-29 - Das gesprochene Anliegen passt zur Sprache des Calls
- **Prioritaet**: P1
- **Modus**: offline (npm test)
- **Vorbedingung**: Call mit `language="en"` und einem deutschsprachigen `goal`
- **Schritte**:
  1. `openingText(call({language:"en", goal:"Ich moechte einen Termin vereinbaren."}))` rendern
  2. das Ergebnis auf gemischtsprachige Rahmung pruefen
  3. statisch: kein `description`-Feld in `mcp-tools.js` enthaelt deutschen Text
- **Erwartetes Ergebnis (Soll)**: der Erst-Turn scheitert erkennbar oder normalisiert; die
  Tool-Beschreibungen sind einsprachig englisch (der MCP-Kanal hat keine Tenant-Sprache)
- **Verifikation**: neue Datei `test/opening-goal-language.test.js`
- **Heute erwartbar**: **rot** - die EN-`bridgePhrase` prueft nur `/^i\b/i` und wickelt sonst
  in "Here's what I'm calling about: <deutscher Satz>." - englischer Rahmen um deutschen
  Inhalt, gesprochen direkt nach der Offenlegung. Die `objective`-Beschreibung gibt als
  einziges Beispiel einen deutschen Satz vor, das Mandats-Feld nennt Euro-Betraege.
  MCP-01/02 pinnen die deutschen Beschreibungen, testen aber nicht die Folge im Anruf
- **Belegt durch**: src/mcp-tools.js:376, :400; src/i18n/locales.js:233-234;
  src/claude.js:264-278, :66

### GAP-30 - Self-Service-Feldkatalog ist zwischen Frontend und Server identisch
- **Prioritaet**: P1
- **Modus**: offline (npm test, statischer Vergleich)
- **Vorbedingung**: keine
- **Schritte**: `SELF_SERVICE_FREE_FIELDS` aus `src/self-service.js` und
  `SETTINGS_FREE_FIELDS` aus `apps/web/src/lib/api.js` einlesen und als Mengen vergleichen
- **Erwartetes Ergebnis (Soll)**: identische Mengen (der Kommentar in `api.js:441` behauptet
  bereits "1:1")
- **Verifikation**: neue Datei `test/self-service-field-parity.test.js`
- **Heute erwartbar**: **rot** - Server: `["agentName","language","agentStyle"]`; Frontend:
  `["agentName","allowCalendar","allowBooking","language"]`. Die UI bietet zwei Felder an, die
  der Server nicht mehr als Self-Service-Felder kennt, und laesst `agentStyle` aus (WEB-07
  benennt nur die fehlende agentStyle-Bindung, nicht die zwei ueberzaehligen Felder)
- **Belegt durch**: src/self-service.js:20; apps/web/src/lib/api.js:441-447

### GAP-31 - Jedes Locale-Feld hat einen Produktionskonsumenten
- **Prioritaet**: P1
- **Modus**: offline (npm test, statischer grep ueber `src/`)
- **Vorbedingung**: keine
- **Schritte**: fuer jedes Feld des DE-Locale-Bundles pruefen, ob ausserhalb von `src/i18n/`
  mindestens eine Referenz existiert
- **Erwartetes Ergebnis (Soll)**: 0 Felder ohne Konsumenten
- **Verifikation**: neue Datei `test/locale-field-consumers.test.js`
- **Heute erwartbar**: **rot** - mindestens zwei Felder sind tot: `greetingDefault` (grep
  liefert nur `locales.js` selbst und Tests; der Inbound-Pfad liest `ctx.settings.greeting`)
  und `sttLocale` (die echte STT-Locale kommt aus den Adapter-Maps). Beide haben gruene Tests,
  die Abdeckung suggerieren
- **Belegt durch**: src/i18n/locales.js:156,206,250 (`greetingDefault`), :99,219-221
  (`sttLocale`); src/routes/voice.js:265; src/telephony/adapters/telnyx/render.js:24,111-119;
  test/f1-i18n-locale.test.js:48-50,133-153; LANG-13 benennt heute nur `greetingDefault`

### GAP-32 - Ein unbezahlbarer Worst-Case-Tarif bricht den Start, statt nur zu warnen
- **Prioritaet**: P0
- **Modus**: offline (npm test, Boot-Guard)
- **Vorbedingung**: die Werte aus `render.yaml` (`VOICE_TARIFF_DEFAULT_CENTS`,
  `MAX_CALL_DURATION_S`, `DEFAULT_TENANT_BUDGET_CENTS`)
- **Schritte**:
  1. `render.yaml` parsen (Muster `test/env-docs-spend-cap-coherence.test.js`)
  2. `worstCaseReserveCents = maxTariffCents * ceil(maxCallDurationS/60)` rechnen
  3. gegen `DEFAULT_TENANT_BUDGET_CENTS` und gegen die kleinste Plan-Decke pruefen
- **Erwartetes Ergebnis (Soll)**: der Befund `WORST_CASE_UNAFFORDABLE` ist `fatal: true`; ein
  Land im Gate ohne Tarif-Eintrag, dessen Worst-Case die kleinste Plan-Decke sprengt, bricht
  den Start
- **Verifikation**: neuer Fall in `test/boot-guard*.test.js` + Datei-Test gegen `render.yaml`
- **Heute erwartbar**: **rot** - der Guard existiert, ist aber ausdruecklich `fatal: false`;
  die Warnzeile steht damit seit dem ersten Deploy folgenlos im Log
- **Belegt durch**: src/boot-guard.js:114-127 (`fatal: false`); render.yaml:280-281,294-295,
  340-341; PAY-04/PAY-07 pruefen die Rechnung, nicht die Guard-Schaerfe

### GAP-33 - Produktionskonfigurations-Smoke (die Suite faehrt die ausgelieferte Env)
- **Prioritaet**: P0
- **Modus**: offline (npm test, Server-Kindprozess) - **wichtigster Einzeltest dieses Katalogs**
- **Vorbedingung**: ein Start-Helfer, der die Env NICHT neutralisiert, sondern die Werte aus
  `render.yaml` parst (`readRenderValue`-Muster aus
  `test/env-docs-spend-cap-coherence.test.js`) und nur Secrets durch Dummies ersetzt
- **Schritte**:
  1. Server mit den geparsten `render.yaml`-Werten starten
  2. je einen Outbound-Versuch pro Launch-Land absetzen: `+49...`, `+44...`, `+1...`
  3. Meta-Test: keine Env-Var darf gleichzeitig in `BASE_ENV` neutralisiert UND in
     `render.yaml` scharf gestellt sein, ohne dass mindestens ein Test sie explizit auf den
     `render.yaml`-Wert setzt
- **Erwartetes Ergebnis (Soll)**: jedes Launch-Land kommt bis zum Provider-Aufruf durch
- **Verifikation**: neue Datei `test/prod-config-smoke.test.js`
- **Heute erwartbar**: **rot** an mindestens vier Stellen (Land-Gate `+49,+33,+44`,
  Stundenlimit 6, Tarif-Default 300 ct gegen Tenant-Decke, Plattform-Topf 8 EUR lebenslang)
- **Belegt durch**: test/helpers.js:84-85,263-268,272,277,293 (die Neutralisierung);
  render.yaml:141-145,275-276,280-281,294-295,310-311,340-341;
  grep `ALLOWED_COUNTRY_CODES` in `test/` findet nur `"*"` und `"+49"`, nie `"+1"`.
  **Konsequenz fuer den Katalog**: OUT-25 ("Happy-Path US") wuerde unter BASE_ENV gruen
  erscheinen und unter Produktionswerten rot - der Test ist ohne GAP-33 nicht aussagekraeftig

### GAP-34 - Backfill-Migration fuer country/language ist idempotent und kollisionsfrei
- **Prioritaet**: P1
- **Modus**: offline (npm test, pglite)
- **Vorbedingung**: DB mit Bestandsdaten vorbelegt: Nummer `country="US", language="de"`,
  zusaetzlich `country="AT", language="de"`
- **Schritte**:
  1. Migration laufen lassen
  2. Werte pruefen
  3. Migration ein zweites Mal laufen lassen
- **Erwartetes Ergebnis (Soll)**: US-Nummer traegt danach `language="en"`; AT bleibt `"de"`
  (kein Kollateralschaden); zweiter Lauf aendert nichts
- **Verifikation**: neuer Test neben den bestehenden `migrate`-Tests
- **Heute erwartbar**: **rot** - `migrate()` ruft nur `backfillPeriodStart`,
  `rekeyProfilesToTenant`, `backfillAccountEmailCase`, `seedDefaults`; fuer
  `country`/`language` existiert kein Backfill. LANG-14/DID-16/OUT-21/WEB-26 pinnen genau
  diesen Nicht-Backfill als Ist - dieser Test verlangt den Soll-Zustand
- **Belegt durch**: src/db/migrate.js:160-166; src/db/schema.sql:63-64,402-403;
  src/store/state-ops.js:648-651

### GAP-35 - Telemetrie traegt Land und Sprache
- **Prioritaet**: P0
- **Modus**: offline (npm test + Datei-Test gegen `render.yaml`)
- **Vorbedingung**: keine
- **Schritte**:
  1. `createMetrics` fuer ein Ablehnungs-Ereignis aufrufen und die Dimensionen pruefen
  2. `render.yaml` lesen: `METRICS_ENABLED` muss `"true"` sein, sobald mehr als ein Land in
     `ALLOWED_COUNTRY_CODES` steht
  3. Pruefkriterium formulieren: "Wenn ab morgen 100 Prozent der Anrufe aus Land X scheitern -
     welche Log-Zeile sagt das?"
- **Erwartetes Ergebnis (Soll)**: Ablehnungs-Ereignisse tragen `country`/`language`;
  `METRICS_ENABLED="true"` im Mehr-Laender-Betrieb
- **Verifikation**: neue Datei `test/metrics-country-dimension.test.js`
- **Heute erwartbar**: **rot** - `src/metrics.js` kennt sechs Ereignisse und kein Feld
  `country`/`language`; `METRICS_ENABLED` steht im Blueprint auf `"false"`; das Audit-Detail
  der Ablehnungen ist bewusst PII-arm und enthaelt keine Zielvorwahl, aus der man das Land
  rekonstruieren koennte
- **Belegt durch**: src/metrics.js:18,35,56,64,75,86,95; src/config.js:191;
  render.yaml:338-339; src/telephony/outbound-gates.js:120-124

### GAP-36 - /healthz weist Commit und Konfigurations-Fingerabdruck aus
- **Prioritaet**: P0
- **Modus**: offline (npm test) + manuell (Rollback-Drill)
- **Vorbedingung**: keine
- **Schritte**:
  1. `GET /healthz` aufrufen
  2. `commit` und einen secret-/PII-freien Hash der sicherheitsrelevanten Konfiguration
     (`allowedCountryCodes`, `maxCallsPerHour`, `budgetMonthEnabled`, `multiTenant`,
     `paymentCurrency`) erwarten
  3. manuell: Post-Deploy-Smoke, der diesen Hash gegen den Erwartungswert prueft; einmal
     Deploy N-1 zuruecknehmen (Rollback-Drill)
- **Erwartetes Ergebnis (Soll)**: `/healthz` liefert `{ok:true, commit, configHash}`; der
  Rollback-Drill ist einmal erfolgreich durchgespielt
- **Verifikation**: neuer Test neben den bestehenden `/healthz`-Tests
- **Heute erwartbar**: **rot** - `/healthz` liefert nur `{ok:true}`; die einzige
  Live-Versionsanzeige ist eine als TEMP-DIAGNOSE markierte `console.log`-Zeile.
  `render.yaml:15-17` sagt selbst, dass die Datei nur Referenz ist und die Wahrheit im
  Dashboard steht (`MULTI_TENANT="false"`/`SELF_SERVICE_ENABLED="false"` im Blueprint sind
  Werte, unter denen ein Self-Service-Launch gar nicht existieren koennte)
- **Belegt durch**: src/app.js:107; src/boot.js:265-268; render.yaml:15-17,394-401;
  MCP-19/DID-13/WEB-02 pruefen heute je EINEN Env-Wert manuell

### GAP-37 - buildFilter und WEB_DIST_DIR widersprechen sich nicht
- **Prioritaet**: P1
- **Modus**: offline (Datei-Test gegen `render.yaml`)
- **Vorbedingung**: keine
- **Schritte**:
  1. `WEB_DIST_DIR` und `buildCommand` des Gateway-Service lesen
  2. `buildFilter.ignoredPaths` desselben Service lesen
- **Erwartetes Ergebnis (Soll)**: zeigt `WEB_DIST_DIR` in ein Verzeichnis unter `apps/web` UND
  baut der `buildCommand` `apps/web`, dann darf `apps/web/**` NICHT in `ignoredPaths` desselben
  Service stehen
- **Verifikation**: Erweiterung von `test/render-buildfilter.test.js` (existiert bereits)
- **Heute erwartbar**: **rot** - `buildCommand` baut `apps/web` (`:22`), `WEB_DIST_DIR` serviert
  `apps/web/dist` (`:406-407`), und `ignoredPaths` enthaelt `apps/web/**` (`:42-44`). Eine
  reine Frontend-Aenderung ist damit am Gateway strukturell nicht deploybar - genau der
  Prozess, der die englische Preisseite ausliefert
- **Belegt durch**: render.yaml:22,42-44,406-407

### GAP-38 - plan:free und preDeployCommand stehen nicht am selben Service
- **Prioritaet**: P0
- **Modus**: offline (Datei-Test gegen `render.yaml`) + Boot-Test
- **Vorbedingung**: keine
- **Schritte**:
  1. `render.yaml` parsen: kein Service mit `plan: free` darf ein `preDeployCommand` tragen
  2. Boot-Test: Server mit leerem Store und gesetzten `BOOTSTRAP_*`-Variablen starten
- **Erwartetes Ergebnis (Soll)**: (1) kein solcher Service; (2) erfolgreicher Boot statt
  `exit(1)` - der In-Prozess-Pfad kann ohne preDeploy heilen
- **Verifikation**: neuer Test nach dem Muster von `test/render-region.test.js` /
  `test/render-buildfilter.test.js`
- **Heute erwartbar**: **rot** - `plan: free` (`:13`) und `preDeployCommand` (`:31`) stehen am
  selben Service; der Boot ist fail-closed und beendet den Prozess ohne aktive Nummer.
  Nebenbefund: `scripts/bootstrap-tenant.js` seedet ohne `country`/`language`, die geseedete
  Nummer erbt also DE/de
- **Belegt durch**: render.yaml:13,31; src/boot.js:228-234; src/store/state-ops.js:673-677

### E2E-01 - Landwechsel eines Bestandstenants (DE -> US)
- **Prioritaet**: P0
- **Modus**: offline (npm test, Server-Kindprozess)
- **Vorbedingung**: ein bestehender Tenant mit `country="DE"`, `defaultLanguage="de"`,
  aktiver `+49`-DID, laufendem Abo
- **Schritte**:
  1. den dokumentierten Weg suchen, ueber den ein Kunde sein Land aendert (Self-Service, API,
     Dashboard)
  2. falls vorhanden: Land auf `US` aendern und danach `resolveCallLanguage`, `number.country`,
     `number.language`, den Kauf-Land-Pfad und die Summary-SMS-Zielpruefung erneut lesen
  3. einen Inbound- und einen Outbound-Call fahren
- **Erwartetes Ergebnis (Soll)**: ein definierter, getesteter Uebergang - entweder aendert sich
  die Sprache konsistent ueber alle Achsen, oder der Wechsel wird mit begruendetem Fehler
  abgelehnt
- **Verifikation**: neue Datei `test/tenant-country-change.test.js`
- **Heute erwartbar**: **rot (Feature fehlt)** - `setTenantGeo` hat ausserhalb von
  `POST /api/onboard` keinen einzigen Aufrufer; `POST /api/onboard` ist ueber eine
  Self-Service-Session nicht erreichbar (WEB-20). Es gibt damit keinen Produktweg, das Land
  eines Bestandstenants zu aendern - und keinen Test, der diese Abwesenheit festhaelt
- **Belegt durch**: src/routes/api-onboard.js:161,168; src/store/state-ops.js:1187 ff.;
  src/wiring/web-login.js:98,102,148; WEB-20/WEB-21 (die Einzelbelege)

### E2E-02 - Zwei Tenants, zwei Sprachen, volle Kette parallel
- **Prioritaet**: P0
- **Modus**: offline (npm test, Server-Kindprozess)
- **Vorbedingung**: Tenant A (`language="de"`, `+49`-DID), Tenant B (`language="en"`,
  `+1`-DID), beide vollstaendig freigeschaltet
- **Schritte**:
  1. beide Tenants parallel onboarden (bzw. seeden)
  2. je einen Inbound-Call gleichzeitig starten, Greeting + Gather-Attribute erfassen
  3. je einen Outbound-Call gleichzeitig starten, `openingText` erfassen
  4. beide Calls beenden, Summary-SMS-Body und Notification-Titel erfassen
  5. parallel je einen `/mcp`-`tools/call` (`list_calls`) absetzen
- **Erwartetes Ergebnis (Soll)**: keine einzige Kreuzkontamination ueber alle fuenf Schichten -
  Tenant A ausschliesslich DE-Artefakte, Tenant B ausschliesslich EN-Artefakte
- **Verifikation**: neue Datei `test/two-tenant-two-language-e2e.test.js`
- **Heute erwartbar**: **rot** - Schritt 2 und 4 tragen fuer beide Tenants dieselben deutschen
  Rahmentexte (Greeting aus `DEFAULT_GREETING`, SMS-Praefix `"Anruf von ..."`), Schritt 5
  liefert fuer beide dieselben deutschen MCP-Texte. Die Schichten sind einzeln gepinnt
  (PROMPT-18, VOICE-25, MCP-16), aber nie als Kette
- **Belegt durch**: src/routes/voice.js:265; src/telephony/call-finish.js:80-96;
  src/mcp-tools.js:108-110; src/store/state-ops.js:648-651

### E2E-03 - Sprachumstellung waehrend eines laufenden Anrufs bleibt wirkungslos
- **Prioritaet**: P1
- **Modus**: offline (npm test, Server-Kindprozess)
- **Vorbedingung**: laufender Inbound-Call eines Tenants mit `language="de"`
- **Schritte**:
  1. Call starten, ersten Turn fahren, gerenderte Voice-/STT-Attribute erfassen
  2. **waehrend** des Calls `POST /api/self-service/settings` mit `language="en"` absetzen
  3. zweiten und dritten Turn fahren, Attribute erneut erfassen
  4. Call beenden, Summary-Sprache pruefen
  5. danach einen NEUEN Call starten und dessen Sprache pruefen
- **Erwartetes Ergebnis (Soll)**: der laufende Call bleibt vollstaendig auf `de` (Voice, STT,
  Farewell, Summary); erst der neue Call ist `en`
- **Verifikation**: neue Datei `test/language-switch-midcall.test.js`
- **Heute erwartbar**: **gruen** - `call.language` ist `NOT NULL DEFAULT 'de'` und wird genau
  einmal bei Call-Anlage aufgeloest; alle Turn-Pfade lesen `call.language` statt neu
  aufzuloesen. Das ist eine **positive Invariante**, die heute von keinem Test gepinnt ist -
  ein spaeteres "Sprache pro Turn neu aufloesen" wuerde mitten im Gespraech die Stimme
  wechseln, ohne dass etwas anschlaegt
- **Belegt durch**: src/db/schema.sql:135; src/routes/api-calls.js:91;
  src/routes/voice.js:237,255,105,111,287,354; src/telephony/voice-render.js:41,49

### E2E-04 - Bestandstenant ohne country/language durch die volle Kette
- **Prioritaet**: P0
- **Modus**: offline (npm test, Server-Kindprozess)
- **Vorbedingung**: Tenant ueber den REALEN Web-Login-Pfad angelegt (`POST /auth/dev-login`),
  also mit `country=null`, `defaultLanguage=null`, danach Abo + automatischer Nummernkauf
- **Schritte**:
  1. Tenant per Dev-Login anlegen, `tenantGeo` pruefen
  2. Abo-Webhook einspielen -> `requestNumberForPaidTenant`
  3. `number.country`/`number.language` lesen
  4. Inbound-Call fahren: Greeting, Voice, Gather-`language` erfassen
  5. Outbound-Call fahren: `openingText` erfassen
  6. Summary-SMS-Body erfassen
- **Erwartetes Ergebnis (Soll)**: die Kette liefert fuer einen US-Nutzer ein durchgehend
  englisches Produkt
- **Verifikation**: neue Datei `test/no-geo-tenant-full-chain.test.js`
- **Heute erwartbar**: **rot** - `tenantGeo` liefert `{country:null, defaultLanguage:null}`;
  `requestNumberForPaidTenant` faellt auf `provisioningCountry="DE"` zurueck, waehrend
  `FORCE_NUMBER_COUNTRY="US"` eine US-DID kauft; Ergebnis US-DID mit `language="de"`, deutsche
  Begruessung, deutsche Offenlegung, deutscher SMS-Rahmen. Die Einzelglieder sind gepinnt
  (LANG-02/04, LANG-06, WEB-21), die KETTE ist es nicht
- **Belegt durch**: src/wiring/web-login.js:98,102,148; src/store/state-ops.js:1198-1200;
  src/billing/provision-trigger.js:33-42; render.yaml:160-161,175-176

### E2E-05 - US-Launch-Vollkette unter Produktionswerten
- **Prioritaet**: P0
- **Modus**: offline (npm test, Server-Kindprozess) - haengt an GAP-33
- **Vorbedingung**: Env aus `render.yaml` geparst (GAP-33), Secrets als Dummies,
  `FAKE_ORIGINATE`
- **Schritte**:
  1. `POST /api/onboard` mit `country="US"`, `privateNumber="+14155550123"`
  2. Abo aktivieren, DID beschaffen
  3. Inbound-Call auf die US-DID
  4. Outbound-Call auf `+12025550123`
  5. Summary-SMS an die US-Privatnummer
  6. `/mcp`-`tools/call` `get_agent_status`
- **Erwartetes Ergebnis (Soll)**: jeder der sechs Schritte gelingt und liefert englische,
  US-korrekte Artefakte (Sprache, Waehrung, Datumsformat)
- **Verifikation**: neue Datei `test/us-launch-full-chain.test.js`
- **Heute erwartbar**: **rot ab Schritt 1** - `normalizePrivateNumber` wird ohne
  `allowedCountryCodes` aufgerufen und erbt den `['+49']`-Default -> 400. Danach reihum:
  `language="de"` (Schritt 1), Land-Gate `+1` (Schritt 4), Reserve 900 gegen Decke 300
  (Schritt 4), deutscher SMS-Rahmen (Schritt 5), EUR-Kosten und deutsche Feldnamen (Schritt 6)
- **Belegt durch**: src/routes/api-onboard.js:125,147; src/store/defaults.js:541;
  src/i18n/locales.js:268-280; src/telephony/outbound-gates.js:179-183,664-672;
  src/telephony/call-finish.js:80-96; src/mcp-tools.js:49 (`fmt` hart `de-DE`)

### E2E-06 - Sprach-Reinheits-Aggregat ueber ALLE nutzersichtbaren Kanaele
- **Prioritaet**: P0
- **Modus**: offline (npm test, Aggregation) - erweitert PROMPT-14
- **Vorbedingung**: ein Tenant mit `language="en"`, Server lokal, LLM-Stub
- **Schritte**: fuer jeden der folgenden Kanaele den ausgegebenen Text einsammeln und gegen
  eine Stoppwortliste deutscher Funktionswoerter pruefen:
  1. Inbound-Greeting (`/voice/incoming`)
  2. `systemPrompt` + `toolDefs`
  3. die `messages`-/`tool_result`-Kette (GAP-28)
  4. `openingText` inkl. `goal`-Rahmung (GAP-29)
  5. Summary-SMS + Notification-Titel
  6. Gate-Ablehnungstexte (`numberGateError`, Budget-402)
  7. MCP-Tool-Beschreibungen und -Fehlermeldungen (`requireFields`, `wrapHandler`)
  8. Self-Service-/Auth-Fehlerseiten (CSRF, Session abgelaufen, Anmeldung fehlgeschlagen)
  9. `tenant.html`-Labels und Zahlenformate
- **Erwartetes Ergebnis (Soll)**: `germanLeakCount === 0` ueber alle neun Kanaele - EIN
  Launch-Gate-Indikator statt vieler Einzelbefunde
- **Verifikation**: neue Datei `test/en-purity-aggregate.test.js`
- **Heute erwartbar**: **rot** mit einem zweistelligen Zaehler; PROMPT-14 aggregiert heute nur
  die Kanaele 1, 2 und 5
- **Belegt durch**: src/routes/voice.js:231,265; src/claude.js:56-247,385,407-419;
  src/telephony/call-finish.js:56-60,80-96; src/telephony/outbound-gates.js:278-297,329-351;
  src/mcp-tools.js:65-67,77-79,108-110,339-342; src/web-auth.js (CSRF-/Session-Seiten);
  public/tenant.html:215,319

---

## Nicht testbar - Produktentscheidung noetig

Die folgenden Punkte lassen sich nicht durch einen Test entscheiden, sondern nur durch eine
Owner-Entscheidung. Ohne sie bleibt jeder darauf aufbauende Test willkuerlich.

1. **Waehrung des US-Markts (PM-GELD-03, PAY-02).** Der Code-Katalog traegt `currency:"eur"`
   (`src/plans.js:21,29`), die Marketing-Bindung im Projektgedaechtnis lautet USD. Entweder
   EUR-Cutover oder USD-bindend - beides ist testbar, aber erst NACH der Entscheidung.
   Betroffen: PAY-01/02/03, WEB-16/17, MCP-08, DID-12/13, FMT-16/17.

2. **Steuerpflicht und Registrierungen (PM-GELD-04).** Ob Hermes US Sales Tax und EU-OSS
   selbst erhebt (Stripe Tax) oder ueber einen Merchant-of-Record verkauft, ist eine
   Geschaefts- und keine Codeentscheidung. GAP-02 testet nur, dass die getroffene Entscheidung
   im Checkout ankommt.

3. **Rechtsgrundlage fuer die Verarbeitung des ANGERUFENEN (PM-RECHT-08).** Art. 6 DSGVO,
   Art. 14 (Information), Kap. V (Drittlandtransfer) - dafuer braucht es ein Dokument, keinen
   Test. GAP-17 automatisiert nur die Vollstaendigkeit der Offenlegung, nicht ihre
   Rechtmaessigkeit.

4. **Einwilligungsmodell fuer US-Outbound (PM-RECHT-01, PM-RECHT-04).** Ob Hermes ueberhaupt
   Fremde in den USA anrufen darf und wie eine "prior express consent" im Produkt aussieht
   (Nutzer bestaetigt? Ziel bestaetigt? Nur Geschaeftsnummern?), entscheidet, welches Gate
   GAP-12/GAP-13 ueberhaupt bauen. Ohne Entscheidung ist der US-Outbound-Launch nicht
   startbar - unabhaengig vom Land-Gate.

5. **en-US als eigenes Locale-Bundle oder akzeptiertes Risiko (PM-TEL-07, PM-SPRACHE-11).**
   `SUPPORTED_LANGUAGES` kennt drei Werte ohne Regionalvarianten
   (`src/i18n/locales.js:260`); `en` ist an drei Stellen hart britisch
   (`locales.js:219-221`, `adapters/telnyx/render.js:24`, `adapters/twilio/render.js:17`).
   Ein en-US-Bundle ist ein Datenmodell-Eingriff, kein Test.

6. **Zeitzone im Datenmodell (PM-SPRACHE-09, PM-RECHT-02, PM-OPS-15).** Weder `tenant` noch
   `number` noch `settings` tragen eine Zeitzone (`src/db/schema.sql:63-64,98,402-403`). Erst
   wenn entschieden ist, WO die Zeitzone haengt (Tenant, Nummer, Ziel-NPA), koennen FMT-01/02,
   OUT-11 und ein Ruhezeiten-Gate ueberhaupt eine Assertion formulieren.

7. **Ist das Stundenlimit eine Plattform-Notbremse oder ein Nutzerlimit? (PM-GELD-13,
   PM-OPS-02).** GAP-10 verlangt ein Pro-Tenant-Limit mit einem sehr viel hoeheren globalen
   Notaus. Die konkreten Zahlen (Tenant/h, Plattform/h) sind eine Risiko-Abwaegung des Owners -
   Absolute Regel 1 verbietet ein blosses Hochsetzen ohne Ersatz.

8. **Lebenszeit-Topf gegen Perioden-Topf (PM-GELD-02, PM-OPS-05).** `BUDGET_MONTH_ENABLED`
   steht auf `false` und macht `MAX_BUDGET_EUR` zu einem geteilten LEBENSZEIT-Topf ueber alle
   Tenants (`src/store/state-ops.js:1959-1975`, `render.yaml:275-276,310-311`). Ob das Flag zum
   Launch umgelegt wird - und mit welchem Wert - ist eine Kosten-/Risikoentscheidung; GAP-01
   und GAP-07 testen danach nur die Konsistenz.

9. **DID-Lebenszyklus nach Kuendigung (PM-GELD-08).** `RELEASE_GRACE_DAYS=0` ist ausdruecklich
   Observe-Only (`src/release-reconcile.js:119`). Die Gnadenfrist ist eine Produkt-/
   Rechtsentscheidung (Nummernportabilitaet, Rueckkehrer, Kuendigungs-Leak); GAP-06 kann sie
   nur nachvollziehen, nicht setzen.

10. **Deploy-Wahrheit und Rollback (PM-OPS-10).** Dass `render.yaml` nur Referenz ist und die
    Live-Konfiguration im Dashboard steht (`render.yaml:15-17`), ist eine Betriebsentscheidung
    mit Konsequenzen fuer jeden Test in diesem Katalog: solange sie gilt, beweist ein gruener
    `render.yaml`-Test nichts ueber Live. GAP-36 macht die Divergenz messbar, beseitigt sie
    aber nicht.
