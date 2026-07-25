# 16 - Befund-Klassifikation (i18n-Launch-Testkatalog)

Synthese aus sechs Buendel-Agenten (B1-B6). Keine Datei ausser dieser wurde angefasst.

## 1. Kopf

- **Stand**: Basis-Commit `9a5e9a6`
- **Suite**: 3044 Tests gesamt, 2958 gruen, 86 rot
- **85 rote Blaetter** entfallen auf **53 Katalog-IDs** (GAP-18 buendelt 12 Subtests unter einem
  Elterntest: 85 Blaetter = 53 IDs + 11 zusaetzliche GAP-18-Subtest-Zeilen + ... rechnerisch: 53
  Katalog-IDs decken 85 der 86 roten Tests ab)
- **Ein Nicht-Katalog-Rot**: `test/voice-status-lifecycle.test.js:137` ist ein Voll-Last-Flake
  (isoliert 2/2 gruen in 689ms), kein Befund, keine Katalog-ID, nicht Teil dieser Klassifikation.
- Alle 53 IDs sind unten vollstaendig erfasst (Nachzaehlung siehe Abschnitt-Ende).

## 2. Haupttabelle (sortiert nach Buendel)

### B1 - Sprach-Kern und Geo-Kette

| ID | Sachverhalt (knapp) | art | aufwand | brennt heute | abhaengt von | beruehrt |
| --- | --- | --- | --- | --- | --- | --- |
| WORLD-01 | languageForCountry() faellt fuer Laender ohne Bundle auf 'de' statt Weltdefault 'en' | einzeiler | halber Tag | nein | - | defaults.js:331 |
| WORLD-03 | localeFor(null/unbekannt) liefert 'de'-Locale statt EN-Weltdefault | einzeiler | <1h | nein | WORLD-01 | defaults.js:331 |
| DID-01 | languageForCountry('US') liefert 'de' (US fehlt in Tabelle) | einzeiler | <1h | nein | WORLD-01 | locales.js:268-280 (kein eigener Fix) |
| DID-02 | Onboard country=US liefert language='de' | einzeiler | <1h | nein | WORLD-01 | kein eigener Fix noetig |
| DID-03 | BK3-Webhook fallbackCountry=US liefert number.language='de' | einzeiler | <1h | nein | WORLD-01 | kein eigener Fix noetig |
| LANG-02 | Web-Login setzt tenant.country/defaultLanguage nie | umbau | halber Tag | nein | - (siehe Graph, Soft-Order vor WORLD-01) | web-auth.js:503-518 |
| E2E-01 | Land-Wechsel DE->US: 200-OK-No-Op statt Uebernahme/Ablehnung | produktentscheidung | mehrere Tage | nein | - | self-service.js:20, self-service-routes.js |
| E2E-04 | Web-Login-Tenant ohne Geo: US-DID, aber deutsches Greeting/SMS | umbau | mehrere Tage | nein | LANG-02, WORLD-01 | web-auth.js, provision-trigger.js:29-42, config.js:779 |
| E2E-05 | Onboard country=US scheitert am +49-Gate (1a=FMT-11) UND language bleibt 'de' (1b) | umbau | halber Tag | nein | WORLD-01 (+ FMT-11, cross-bundle) | api-onboard.js:120-129 |

### B2 - Prompts, Gespraech, Offenlegung

| ID | Sachverhalt (knapp) | art | aufwand | brennt heute | abhaengt von | beruehrt |
| --- | --- | --- | --- | --- | --- | --- |
| PROMPT-01 | systemPrompt()-Sektionsueberschriften hart deutsch | umbau | mehrere Tage | nein | - | claude.js:56-247 |
| PROMPT-02 | toolDefs()-Beschreibungen hart deutsch | umbau | halber Tag | nein | PROMPT-01 | claude.js:317,334 |
| PROMPT-03 | Inbound-Greeting fuer EN-Tenant bleibt deutsch | umbau | halber Tag | nein | - (migrationsrisiko-Kopplung an WORLD-01/03) | voice.js:265, defaults.js:320, locales.js:249 |
| PROMPT-14 | Aggregat: EN-Call bleibt in Greeting+Prompt+toolDefs deutsch | umbau | mehrere Tage | nein | PROMPT-01, PROMPT-02, PROMPT-03 | claude.js, voice.js:265, defaults.js |
| GAP-28 | 4 Kontroll-Marker (Bootstrap/Silent/take_message/end_call) bleiben deutsch im Modell-Kontext | umbau | halber Tag | nein | PROMPT-01 | claude.js:385,407,413,419 |
| GAP-14 | Inbound-Pflichtsatz (KI+Aufzeichnung) fehlt und ist nicht fail-closed geschuetzt | produktentscheidung | halber Tag | **ja** | WEB-04 | defaults.js:320, self-service.js:29-33, state-ops.js:2509-2527 |
| WEB-04 | GREETING_TEMPLATES komplett deutsch, keine EN/FR-Vorlage | umbau | <1h | nein | - | self-service.js:29-33 |
| E2E-02 | Zwei-Tenant-Beweis: Greeting + Summary-SMS fuer EN-Tenant deutsch | umbau | mehrere Tage | nein | PROMPT-03 | voice.js:265, call-finish.js:57,80-81 |
| E2E-06 | Aggregat: germanLeakCount ueber 8 Kanaele ist 0 fuer EN-Tenant | umbau | mehrere Tage | nein | PROMPT-01, PROMPT-02, PROMPT-03, WEB-04 | claude.js, voice.js:265, call-finish.js, web-auth.js |

### B3 - MCP-Tools und Widgets

| ID | Sachverhalt (knapp) | art | aufwand | brennt heute | abhaengt von | beruehrt |
| --- | --- | --- | --- | --- | --- | --- |
| PROMPT-09 | mcp-tools.js hat keine Sprach-/Locale-Verzweigung ueberhaupt | umbau | mehrere Tage | nein | - | mcp-tools.js |
| FMT-03 | fmt() nutzt hart 'de-DE' statt dateLocale/localeFor | einzeiler | <1h | nein | PROMPT-09 | mcp-tools.js:49 |
| MCP-04 | requireFields()-Fehlermeldungen hart deutsch | einzeiler | <1h | nein | PROMPT-09 | mcp-tools.js:63-82 |
| MCP-06 | last_transcript_lines-Praefix hart 'Gegenseite:' | einzeiler | <1h | nein | PROMPT-09 | mcp-tools.js:103-115 |
| MCP-08 | get_agent_status zeigt hart 'EUR', ignoriert paymentCurrency=usd | produktentscheidung | <1h | nein | - | mcp-tools.js:707-710 |
| MCP-09 | permissionsSummary() nutzt deutsche Feldnamen, maschinenlesbar (Widget) | umbau | halber Tag | nein | PROMPT-09 | mcp-tools.js:194-199 (+ mcp-ui.test.js:682 mitzuziehen) |
| MCP-12 | 0 EN-Faelle in 3 Bestandstestdateien (Meta-/Kanarien-Test) | test-falsch | <1h | nein | MCP-04, MCP-06, MCP-08, MCP-09 | test/mcp-tools.test.js, test/mcp-ui.test.js, test/mcp-ui-widget-i18n.test.js |
| UI-14 | widgetHtml() liefert byte-identisches HTML unabhaengig von Sprache | umbau | halber Tag | nein | - | ui/widget-catalog.js:126-154, ui/registry.js |
| UI-18 | tenant.country=FR aendert servergerenderte Widget-Sprache nicht | umbau | halber Tag | nein | UI-14 | state-ops.js:1187-1201, ui/widget-catalog.js |

### B4 - Telefonie/Wahl-Sicherheit, Latenz, Deploy-Startfaehigkeit

| ID | Sachverhalt (knapp) | art | aufwand | brennt heute | abhaengt von | beruehrt |
| --- | --- | --- | --- | --- | --- | --- |
| GAP-18 | NANP-Premium/Karibik-Sperren fehlen fuer +1 (12 Subtests) | einzeiler | <1h | nein | - | outbound-gates.js:58-90 |
| GAP-21 | Kein Machine-Detection-Feld bei Telnyx-Origination | umbau | halber Tag | **ja** | - | adapters/telnyx/voice.js |
| GAP-22 | Turn-Budget + Play-TTS-Synthese erreicht 15s-Provider-Hardcut | einzeiler | <1h | **ja** | - | config.js:143-160,245-252 |
| GAP-25 | '011'-NANP-Auslandsvorwahl wird als '0'-Inlandsvorwahl fehlinterpretiert | einzeiler | <1h | nein | - | defaults.js:525-531 |
| GAP-10 | Stundenlimit ist plattformweit statt pro-Tenant, Fehlertext leakt Env-Namen | produktentscheidung | mehrere Tage | **ja** | - | outbound-gates.js:188-201,292, plans.js:106 |
| FMT-11 | Onboard ignoriert country beim normalizePrivateNumber-Gate (+49-Default) | einzeiler | <1h | nein | - | api-onboard.js:121-129, state-ops.js:1144 |
| GAP-33 | Sammel-Gate: Auslands-Outbound vermutlich 402 (a) + render.yaml nicht startfaehig (b) | produktentscheidung | mehrere Tage | nein | (a) ORIG-01/02/03; (b) GAP-38 | render.yaml:212-213 |

### B5 - Geld-/Budget-Gates, Stripe, Herkunfts-Tarifierung

| ID | Sachverhalt (knapp) | art | aufwand | brennt heute | abhaengt von | beruehrt |
| --- | --- | --- | --- | --- | --- | --- |
| GAP-01 | Budget-Gate rechnet gegen Lebenszeit-Verbrauch, kein Periodenreset bei BUDGET_MONTH_ENABLED=false | env-flip | <1h | **ja** | GAP-07 (unklar, s. Graph) | state-ops.js:1959, render.yaml:305-311 |
| GAP-03 | 4 Stripe-Event-Typen (Dispute/Refund/Pause/payment_action_required) werden ignoriert | umbau | halber Tag | **ja** | - | billing/webhook.js:16-21,130-141,195-205 |
| GAP-04 | Tenant-Aktivierung erfolgt VOR Provisioning-Check, Fehlschlag folgenlos | umbau | halber Tag | **ja** | - | billing/activation.js:66-73 |
| GAP-05 | 100%-Gutschein umgeht Hold UND Karten-Pflicht (allow_promotion_codes ungefiltert) | umbau | halber Tag | **ja** | - | onboarding.js:134-142, billing/stripe.js:279,354-371 |
| GAP-07 | Leerer PLATFORM_ALERT_SMS_TO + aktive Spend-Warnung fuehrt nur zu WARN, nicht Boot-Abbruch | einzeiler | <1h | nein | - | config.js:1208, boot-guard.js:317-324 |
| GAP-32 | WORST_CASE_UNAFFORDABLE ist fatal:false, obwohl heutige render.yaml-Werte ihn ausloesen | produktentscheidung | halber Tag | **ja** | ORIG-01, ORIG-02 | boot-guard.js:114-127, render.yaml, defaults.js:253 |
| ORIG-01 | tariffCentsPerMin() kennt nur Ziel, keine Herkunft (eigene DID) | umbau | mehrere Tage | **ja** | - | outbound-gates.js:145,670, metering.js:45,68 |
| ORIG-02 | DE-Ziel von US-DID wird faelschlich zum Inlandssatz gebucht | umbau | mehrere Tage | **ja** | ORIG-01 | metering.js:45, outbound-gates.js:145 |
| ORIG-03 | Inbound auf eigene US-DID wird faelschlich mit Auslands-Worst-Case gebucht | umbau | halber Tag | **ja** | - | telephony/call-finish.js:44-48 |

### B6 - Web-Dashboard, Recht, Metriken, Zeitzone

| ID | Sachverhalt (knapp) | art | aufwand | brennt heute | abhaengt von | beruehrt |
| --- | --- | --- | --- | --- | --- | --- |
| WEB-01 | tenant.html hart lang="de" statt sprachabhaengig | umbau | halber Tag | nein | - | public/tenant.html |
| WEB-09 | Ungueltige privateNumber liefert deutschen Klartext statt stabilem Code | einzeiler | <1h | nein | - | self-service-routes.js:275 |
| WEB-11 | CSRF-State-Fehlantwort ist deutscher Klartext | einzeiler | <1h | nein | - | web-auth.js:115-117 |
| WEB-12 | /auth/login und /auth/callback: deutscher Klartext bei Fehler | einzeiler | <1h | nein | - | web-auth.js:223,284 |
| WEB-14 | call-finish.js: Notification-/SMS-Rahmentexte sprachunabhaengig deutsch | umbau | halber Tag | nein | - | telephony/call-finish.js:57,80 |
| GAP-15 | Rechtstexte (AGB/Datenschutz/Impressum) sind Platzhalter, keine EN-Route | produktentscheidung | mehrere Tage | nein | - | apps/web/src/pages/{agb,datenschutz,impressum}.astro |
| GAP-35 | METRICS_ENABLED=false trotz Mehr-Laender-Gate, kein Denial-Ereignis mit country/language | umbau | halber Tag | **ja** | - | render.yaml:338, metrics.js, outbound-gates.js:120-124 |
| GAP-36 | /healthz liefert nur {ok:true}, kein Commit/Config-Fingerabdruck | einzeiler | <1h | **ja** | - | app.js:107, boot.js:264-268 |
| GAP-38 | render.yaml: plan:free + preDeployCommand (laeuft nicht) + kein In-Prozess-BOOTSTRAP_E164-Fallback | umbau | halber Tag | **ja** | - | render.yaml:4-31, boot.js:228-234, scripts/bootstrap-tenant.js |
| FMT-28 | Kein timezone-Feld am Tenant (JSON+Postgres) trotz Owner-Entscheidung 7.6 | umbau | mehrere Tage | nein | - | defaults.js, db/schema.sql, claude.js:43 |

**Art-Verteilung (real ausgezaehlt)**: env-flip 1 / einzeiler 17 / umbau 27 / produktentscheidung 7 / test-falsch 1 = 53.

## 3. `brennt_heute=ja`-Liste (nach Dringlichkeit sortiert)

Alle 15 Befunde, die den BESTAND heute treffen - nicht erst beim Weltstart.

1. **ORIG-02** - Jeder Bestandstenant mit US-DID, der ein Nicht-US-Ziel (z.B. DE) anruft, wird JETZT
   systematisch zum guenstigen Inlandssatz statt zum korrekten Auslandssatz abgerechnet. Aktiver,
   sich mit jedem Anruf summierender Geldverlust fuer Sundartha. Belegt (Bestand hat laut Memory
   bereits US-DIDs).
2. **ORIG-03** - Jeder Inbound-Anruf auf eine eigene US-DID eines Tenants wird JETZT faelschlich mit
   dem Auslands-Worst-Case-Satz gebucht, verbraucht Budget-Decke fuer Ereignisse, die der Tenant
   nicht ausloest. Kombiniert mit GAP-32 kann das allein die Outbound-Faehigkeit einfrieren.
3. **ORIG-01** - Strukturelle Wurzel von ORIG-02/03: tariffCentsPerMin() kennt bis heute keine
   Herkunfts-Achse, jede Abrechnung fuer Tenants mit Nicht-Heimatland-DID ist heute schon verzerrt.
4. **GAP-05** - Jeder gueltige Stripe-Coupon (auch versehentlich geleakte interne Testcodes) loest
   HEUTE eine kostenlose DID ohne Hold und ohne Kartenpruefung aus, solange PAYMENT_ENABLED aktiv
   ist - allow_promotion_codes steht bereits unbedingt auf true.
5. **GAP-03** - Stripe sendet Dispute-/Refund-/Pause-/payment_action_required-Events bei jedem Live-
   Abo unabhaengig vom i18n-Thema; sie werden HEUTE folgenlos ignoriert (IGNORE-Default), ein Kunde
   telefoniert nach einem Chargeback unveraendert weiter.
6. **GAP-01** - Jeder Bestandstenant, der seine Lebenszeit-Budget-Decke einmal erreicht, bleibt HEUTE
   dauerhaft gesperrt, auch nach einer neuen bezahlten Periode - kein Codepfad setzt den Wert zurueck.
7. **GAP-32** - Mit den live gemessenen render.yaml-Zahlen (Reserve 1500 Ct gegen Tenant-Decke
   600 Ct) triggert der WORST_CASE_UNAFFORDABLE-Befund HEUTE schon (praeventiv geblockter Outbound zu
   teuren/internationalen Zielen) - nur eben nicht fatal fuer den Boot. **Einschraenkung**: diese
   Begruendung setzt voraus, dass render.yaml tatsaechlich die LIVE-Werte sind; genau diese Annahme
   ist bei GAP-01 (selbes Buendel) ausdruecklich als ungeprueft markiert (Render-Services sind teils
   Dashboard-managed). Die "ja"-Einstufung bleibt plausibel, ist aber nicht durch eine echte
   Config-Abfrage gegen das Live-System belegt.
8. **GAP-04** - Der Aktivierungspfad setzt Status/KYC schon HEUTE unbedingt vor dem Provisioning-
   Ergebnis; faellt provision() fehl (z.B. MAX_NUMBERS erschoepft), bleibt ein zahlender Tenant ohne
   Nummer aktiv. Abgeschwaecht: die Buendel-Formulierung "kann bereits erschoepft sein" ist eine
   Vermutung, keine gemessene Tatsache - der Mechanismus-Defekt selbst ist aber unabhaengig davon
   bereits heute vorhanden (kein Rueckbau bei jedem Provisioning-Fehler, nicht nur Cap-Erschoepfung).
9. **GAP-10** - MAX_CALLS_PER_HOUR=6 gilt HEUTE plattformweit statt pro Tenant; bei mehreren aktiven
   zahlenden Tenants (laut Memory bereits Realitaet) kann ein Tenant alle anderen vom Outbound
   verdraengen.
10. **GAP-14** - Der Inbound-Pflichtsatz (KI + Aufzeichnung) fehlt HEUTE bei jedem Inbound-Call,
    unabhaengig von Sprache - Compliance-Luecke im laufenden Betrieb, kein i18n-Thema im engeren Sinn.
11. **GAP-21** - Kein Machine-Detection bei Outbound-Origination HEUTE: jeder Call, der auf einer
    Mailbox landet, wird wie ein volles Gespraech gefuehrt und abgerechnet.
12. **GAP-38** - render.yaml ist der dokumentierte Recovery-Pfad des Dienstes; scheitert der Store
    heute leer (Postgres-Reset), gibt es KEINEN funktionierenden automatischen Heilungsweg. Reales
    Bestandsrisiko fuer den JETZT laufenden Dienst im Katastrophenfall, nicht nur fuer den Weltstart.
13. **GAP-22** - Turn-Budget (LLM-Retries+Backoff) plus Play-TTS-Synthese erreicht bei den heutigen
    Defaults den 15s-Provider-Hardcut (11000ms+4000ms=15000ms) - Play-TTS ist laut Memory bereits
    live. **Abgeschwaecht**: das ist ein Worst-Case-Additionsfehler (max. Retries + langsame Synthese
    gleichzeitig), kein garantiert taeglich eintretendes Ereignis - "ja" ist gerechtfertigt, weil der
    Defekt in der heutigen Live-Konfiguration liegt, nicht in einem zukuenftigen Rollout, aber die
    Trefferhaeufigkeit im echten Betrieb ist unbelegt.
14. **GAP-35** - render.yaml oeffnet laut Test bereits mehr als ein Land im Ausgangs-Gate; ohne
    METRICS_ENABLED und Denial-Ereignis waere ein Laender-Totalausfall HEUTE unsichtbar. Reine
    Betriebsblindheit, kein aktiver Schaden - schwaechste Begruendung der Liste, aber der Zustand
    (Mehr-Laender-Gate ohne Sichtbarkeit) besteht nachweislich schon.
15. **GAP-36** - /healthz liefert nur {ok:true} ohne Commit/Fingerabdruck; bei einem Rollback/Deploy-
    Drill (laut Memory offen: DEPLOY-04) ist ein automatisierter Post-Deploy-Smoke-Test HEUTE
    erschwert. **Abgeschwaecht**: das ist eine operative Komfort-/Sichtbarkeitsluecke, kein aktiver
    Schaden am laufenden Betrieb - eher "erschwert Diagnose" als "brennt". Wird hier belassen, weil
    das Deploy-Repo-Split-Risiko (Memory: Render deployt Upstream, Live-Commit-Pruefung ist bereits
    ein bekanntes Problemfeld) real und wiederkehrend ist.

**Herabgestufte/nicht bestaetigte "ja"-Kandidaten**: keiner der sechs Buendel-Agenten hat "ja"
vergeben, wo ich es auf "nein" korrigiert haette. GAP-07 wurde von B5 korrekt als "nein" eingestuft
(Alarmkanal ist seit 2026-07-23T23:23:24Z besetzt, deckt sich mit dem Boot-Log-Beleg) - das ist keine
Herabstufung, sondern eine bereits richtige Einordnung.

## 4. Migrationsrisiken

Befunde, deren Fix das Verhalten fuer BESTANDSKUNDEN aendert, mit der Owner-Frage davor.

| ID | Was aendert sich fuer Bestandskunden | Owner-Frage |
| --- | --- | --- |
| **WORLD-01/WORLD-03** (Musterfall) | DEFAULT_LANGUAGE de->en ist eine EINZIGE Konstante, die sowohl Sprach-Fallback fuer Laender ohne Bundle als auch Fallback fuer Bestandsdatensaetze ohne explizites language-Feld ist. tenant.country/default_language und number.language sind additiv-NULLABLE ohne Backfill eingefuehrt worden. Jeder Bestandstenant/jede Bestandsnummer mit NULL in diesen Feldern bekaeme ab Deploy eine ENGLISCHE Begruessung statt der heutigen deutschen. | Backfill-Kriterium fuer Bestandsdatensaetze VOR dem Flip festlegen (z.B. alle Nummern mit Provider-Land DE/AT/CH oder alle vor Stichtag angelegten Nummern explizit auf 'de' setzen). Ist tatsaechlich NULL im Bestand vorhanden (nicht gegen echte DB verifiziert)? |
| **LANG-02** | Kein direkter Bestandsrisiko selbst, aber: wird WORLD-01 VOR LANG-02 deployed, bekommen ab dem Deploy-Zeitpunkt ALLE NEUEN Web-Login-Kunden (auch deutsche) eine englische Begruessung, weil der Login-Pfad kein Land setzt und der Fallback jetzt 'en' ist. | Reihenfolge zwischen LANG-02 und WORLD-01 festlegen (Empfehlung der Buendel-Agenten: LANG-02 zuerst oder gleichzeitig). Zusaetzlich: WIE wird beim Web-Login das Land bestimmt (IP-Geo, aktive Abfrage, Onboard-Redirect)? |
| **PROMPT-03** | Der Fix darf nicht simpel "Greeting folgt call.language" sein, sonst kippen Bestandstenants ohne explizites Sprachfeld (nach dem WORLD-01-Flip) versehentlich auf Englisch. | Muss zusammen mit dem WORLD-01/03-Backfill entschieden werden, nicht isoliert. |
| **GAP-14** | (1) Aendert man DEFAULT_GREETING, aendert sich der gesprochene Satz fuer ALLE Bestandskunden, die den Default nutzen. (2) Macht man updateSettings fail-closed, kann ein Bestandstenant mit eigenem Greeting ohne Pflicht-Marker bei der naechsten harmlosen Aenderung (z.B. agentName) am Greeting-Feld scheitern. | Exakter Pflicht-Wortlaut; Bestandsgreetings per Migration nachruesten oder nur neue Writes blocken; Total- oder Selektiv-Ablehnung des Patches (Test verlangt bereits die mildere Selektiv-Variante). |
| **E2E-01** | Kern des Befunds selbst: was bedeutet ein Land-Wechsel fuer eine BEREITS GEKAUFTE DID? | Neue DID kaufen (Kosten), alte behalten (Sprach-/Land-Mismatch), oder Wechsel schlicht verbieten? |
| **PROMPT-09 / UI-14 / UI-18** | Sobald eine Sprachverzweigung eingefuehrt wird (mcp-tools.js bzw. Widget-Rendering), muss der Default fuer Bestandstenants ohne explizites Sprachfeld weiterhin 'de' liefern - sonst kippt bestehenden Kunden die Sprache im Chat/Widget um. | Dieselbe WORLD-01-Migrationsfrage (Backfill/Default) muss buendeluebergreifend EINMAL beantwortet werden, nicht pro Fix einzeln. |
| **GAP-01** | Der Flip (Lebenszeit- auf Perioden-Reset) aendert SOFORT und global fuer JEDEN Tenant die Budget-Semantik; heute lebenszeit-gesperrte Tenants wuerden beim naechsten Boot/Sweep automatisch reaktiviert, auch bei unklarem Zahlungsstatus (z.B. laufende Dunning-Klaerung). | Werden heute gesperrte Tenants automatisch (ohne manuelle Pruefung) reaktiviert? Ist render.yaml ueberhaupt die schreibende Live-Quelle fuer BUDGET_MONTH_ENABLED? |
| **GAP-32** | Ein reiner fatal:false->true-Flip OHNE vorherige Zahlenkorrektur legt den LIVE-Dienst beim naechsten Boot sofort und dauerhaft lahm (1500 Ct Reserve > 600 Ct Tenant-Decke besteht bereits). | Ueber welchen Hebel wird Kohaerenz hergestellt: DEFAULT_TENANT_BUDGET_CENTS anheben, VOICE_TARIFF_DEFAULT_CENTS senken, oder MAX_CALL_DURATION_CAP_S senken? Jede Wahl aendert Bestandsverhalten fuer JEDEN Tenant gleichzeitig. |
| **FMT-28** | Sobald das timezone-Feld gebaut wird: Ableitungsregel fuer Bestandstenants (aus welchem Feld?) und die explizite Zusicherung, dass das Feld NUR die Anzeige beeinflusst, niemals implizit ein Anrufzeit-Gate (LAW-07 ist abgelehnt). | Ableitungsregel fuer Bestand festlegen; Zusicherung "nur Anzeige, kein Gate" schriftlich bestaetigen. |
| **MCP-09** | Ein bestehender GRUENER Pin (test/mcp-ui.test.js:682, ausserhalb des Katalogs) haengt an demselben deutschen String (permissionsSummary). Wird die Feldbenennung geaendert, ohne den Widget-Bind-Code mitzuziehen, kann das Live-Widget fuer Bestandskunden stumm leer bleiben. | Muss im selben Zug wie MCP-09 gefixt werden, sonst Regression am heutigen Widget-Vertrag. |

**Weitere Migrationsrisiken, die in den Rohdaten nicht als eigenes Feld markiert wurden, aber aus dem
Sachverhalt ableitbar sind** (Buendel-Agenten haben das Feld leer gelassen, obwohl der Fix Bestandsverhalten
aendert):

- **ORIG-01/ORIG-02/ORIG-03**: Ein korrekter Fix erhoeht die gebuchten Kosten fuer Bestandstenants
  mit Nicht-Heimatland-DID (heute werden sie zu guenstig/zu teuer falsch gebucht) und aendert, wie
  Inbound-Minuten bepreist werden. Das ist eine Abrechnungsaenderung fuer laufende Kunden, auch wenn
  sie in die "richtige" Richtung geht. Owner-Frage: wird die Korrektur rueckwirkend auf bereits
  gebuchte Perioden angewendet oder nur ab Deploy? Wird der Tenant ueber die Aenderung informiert?
- **GAP-10**: Ein Wechsel von plattformweitem auf Pro-Tenant-Stundenlimit aendert das erlaubte
  Anrufvolumen fuer JEDEN Bestandstenant gleichzeitig (Owner-Entscheidung 7.7 noch offen). Owner-
  Frage: bleibt zusaetzlich eine globale Notbremse bestehen, und auf welchem Wert?
- **GAP-03**: Eine automatische Reaktion auf Stripe-Events (z.B. Suspend bei Dispute) aendert das
  Verhalten fuer Bestandskunden, die so ein Ereignis ausloesen - ein zu scharfer Automatismus sperrt
  zahlende Kunden faelschlich, wenn Stripe die Dispute spaeter zugunsten des Haendlers entscheidet.
  Owner-Frage: welche Reaktion pro Ereignistyp (Suspend/Warn/nur Log)?

## 5. `test-falsch`-Kandidaten

| ID | Beleg | Urteil |
| --- | --- | --- |
| **MCP-12** | test/mcp-tools-i18n.test.js:250-261 greppt drei BESTEHENDE Testdateien (mcp-tools.test.js, mcp-ui.test.js, mcp-ui-widget-i18n.test.js) nach `language: "en"` - 0 Treffer. Der Test prueft Testabdeckung, nicht Produktionscode; laut eigenem Kopfkommentar "bewusst so konstruiert". | **Test nachziehen, nicht Code fixen.** Die Assertion ist formal korrekt (wahre Messung), aber es ist ein Meta-Test ueber Testdateien - er wird per Konstruktion erst gruen, wenn den drei genannten Bestandsdateien EN-Faelle hinzugefuegt werden. Kein Produktionscode-Defekt zugeordnet. |
| **MCP-08** | mcp-tools.js:707-710 haengt "EUR" literal an jeden Kostenwert, auch wenn config.paymentCurrency=usd. Der Test verlangt USD-Anzeige bei paymentCurrency=usd. Das widerspricht woertlich Owner-Entscheidung 7.1 ("EUR ueberall", kein USD-Cutover, Anzeige-Waehrung==Belastungs-Waehrung ist die Invariante). | **Mein Urteil: Code fixen, Test bleibt bestehen** - ABER unter einer Praezisierung durch den Owner. Die Test-Assertion ist keine Waehrungs-VORGABE ("USD soll erscheinen"), sondern eine Waehrungs-TREUE-Pruefung ("Anzeige folgt der konfigurierten Belastungswaehrung"). Genau das FORDERT die Owner-Invariante aus 7.1 selbst ("Anzeige-Waehrung == Belastungs-Waehrung"). Der eigentlich offene Punkt ist nicht der Test, sondern ob `paymentCurrency=usd` als legaler Config-Wert ueberhaupt bestehen bleiben soll. Bleibt er bestehen (z.B. fuer Altvertraege), muss der Code Currency-Treue umsetzen und der Test ist korrekt. Wird `paymentCurrency=usd` stattdessen als Altlast komplett abgeschafft, wird der Test gegenstandslos und muesste geloescht/umgeschrieben werden - dann waere er nachtraeglich "test-falsch" im Sinne von "testet einen nicht mehr existierenden Zustand", aber nicht heute. Owner muss 7.1 fuer diesen Spezialfall bestaetigen oder widerrufen, bevor irgendetwas hier angefasst wird. |
| **GAP-07 (Klarstellung, kein test-falsch)** | Der Task-Auftrag verlangt explizit eine Festlegung "bei GAP-07" - in den Rohdaten hat GAP-07 aber ein LEERES `test_falsch_verdacht`-Feld und `art:"einzeiler"` (kein test-falsch-Kandidat irgendeines Buendel-Agenten). Vermutlich ist das ein Verweis-Fehler im Auftrag (gemeint war wahrscheinlich MCP-08, s.o., der einzige echte Waehrungs-Konflikt mit einer Owner-Entscheidung). Zur Vollstaendigkeit trotzdem geprueft: GAP-07 testet, ob ein leerer PLATFORM_ALERT_SMS_TO + aktive Spend-Warnung den Boot fatal abbrechen soll. Der Test konstruiert den leeren Fall bewusst ueber `withConfigOverrides` (nicht den Live-Zustand, der seit 07-23 gefuellt ist). Das macht den Test nicht falsch - er pruft eine Haertung fuer den Fall, dass der Alarmkanal je wieder leerlaeuft (Dashboard-Drift), was ein legitimes Szenario bleibt, auch wenn es heute nicht aktiv ist. **Urteil: Code fixen (echter, aktuell dormanter Gap), kein test-falsch.** |

**Weitere Nicht-Katalog-Beobachtungen zu bestehenden (aelteren) Tests, die bei Fixes mitgezogen/
geloescht werden muessen** (nicht Teil der 53 Katalog-IDs, aber relevant fuer die Reihenfolge):

- `test/f1-geo-port.test.js:60-65` (Alt-Test, kollidiert mit DID-01 laut kanonischer Liste R5) - muss
  GELOESCHT werden, sobald WORLD-01 landet, sonst pinnt er weiter `languageForCountry("US")===DEFAULT_LANGUAGE`
  und verdeckt semantisch die neue Aussage.
- `test/f1-i18n-locale.test.js:34-39` (Nachtrag "D4/LANG-21" laut kanonischer Liste) - muss nach dem
  WORLD-03-Flip nachgezogen werden (pinnt `DEFAULT_LANGUAGE==="de"` woertlich).
- `test/personal-assistant-characterization.test.js:215-221,333-346` - byte-genaue IST-Pins des
  heutigen (deutschen) EN-Systemprompts; muessen GELOESCHT werden, sobald PROMPT-01/02/03/14 gefixt
  sind, sonst widersprechen sich zwei Tests dauerhaft (R5-Loeschpflicht, nicht Anpassung).

## 6. Abhaengigkeitsgraph

Harte Abhaengigkeiten (aus den `abhaengt_von`-Feldern der Rohdaten):

- `WORLD-01` -> `WORLD-03`, `DID-01`, `DID-02`, `DID-03`, `E2E-04`, `E2E-05`
- `PROMPT-01` -> `PROMPT-02`, `PROMPT-14`, `GAP-28`, `E2E-06`
- `PROMPT-02` -> `PROMPT-14`, `E2E-06`
- `PROMPT-03` -> `PROMPT-14`, `E2E-02`, `E2E-06`
- `WEB-04` -> `GAP-14`, `E2E-06`
- `PROMPT-09` -> `FMT-03`, `MCP-04`, `MCP-06`, `MCP-09`
- `MCP-04`, `MCP-06`, `MCP-08`, `MCP-09` -> `MCP-12`
- `UI-14` -> `UI-18`
- `ORIG-01` -> `ORIG-02`, `GAP-32`
- `ORIG-02` -> `GAP-32`
- `ORIG-01`, `ORIG-02`, `ORIG-03` -> `GAP-33` (Teil a)
- `GAP-38` -> `GAP-33` (Teil b)
- `FMT-11` -> `E2E-05` (cross-bundle, aus B1-Querbezug, nicht in E2E-05s eigenem Array)

Soft-Abhaengigkeiten / Reihenfolge-Empfehlungen (NICHT in den formalen `abhaengt_von`-Arrays
enthalten, aber von den Buendel-Agenten inhaltlich begruendet - hier explizit gemacht):

- **`LANG-02` VOR (oder zusammen mit) `WORLD-01`**: B1 formuliert das als "Empfehlung an den Lead",
  nicht als Array-Eintrag. Faktisch ist das eine Vorbedingung: wird WORLD-01 zuerst deployed, bricht
  der deutsche Web-Login-Neukundenpfad am Tag des Flips. Diese Kette ist im Dokument wichtiger als
  ihre formale Nicht-Erfassung suggeriert.
- **`PROMPT-09`/`UI-14`/`UI-18` teilen sich mit `WORLD-01`/`WORLD-03` dieselbe Backfill-/Default-
  Frage** (B3-Querbezug): kein Code-Abhaengigkeitspfeil, aber dieselbe Owner-Entscheidung darf nur
  EINMAL getroffen werden, nicht pro Buendel einzeln.
- **`FMT-28` teilt sich mit `WORLD-01`/`WORLD-03` denselben Migrationsmechanismus** (Land->Ableitung
  beim Onboarding fuer Bestandstenants, B6-Querbezug) - sollte nicht zweimal gebaut werden.
- **`GAP-32` und `GAP-33` teilen dieselbe render.yaml-Zahlenbasis** (DEFAULT_TENANT_BUDGET_CENTS/
  VOICE_TARIFF_DEFAULT_CENTS/MAX_CALL_DURATION_CAP_S) - ein sicherer GAP-32-Fix ist Vorbedingung fuer
  einen sauberen GAP-33-Fix (Teil a), nicht umgekehrt.
- **`GAP-38` und `GAP-35`** aendern render.yaml an unterschiedlichen Env-Bloecken - keine technische
  Reihenfolge, aber sollten im selben Deploy gefahren werden (B6-Querbezug).

**Widerspruechlicher/unbelegter Eintrag - explizit offen gelassen statt geglaettet**:

- `GAP-01` traegt in den Rohdaten `"abhaengt_von": ["GAP-07"]`. Weder GAP-01s eigener Sachverhalt
  (Budget-Achsen-Reset) noch GAP-07s Sachverhalt (Boot-Abbruch bei leerem Alarmkanal) liefern eine
  erkennbare inhaltliche Verbindung - beide aendern zwar render.yaml-nahe Config, aber an
  unterschiedlichen, unabhaengigen Werten (BUDGET_MONTH_ENABLED vs. PLATFORM_ALERT_SMS_TO). Keine der
  beiden Beleglisten nennt die jeweils andere ID. **Einschaetzung**: vermutlich ein Uebertragungsfehler
  des B5-Agenten (evtl. Verwechslung mit der gemeinsamen render.yaml-Owner-Fenster-Bindung aus dem
  B5-Querbezug "GAP-01 haengt indirekt an WORLD-01/WORLD-03"). Der Lead sollte diese Kante NICHT als
  echte technische Vorbedingung behandeln, bevor sie am Code verifiziert ist.

## 7. Detailtabellen je Befund

### B1 - Sprach-Kern und Geo-Kette

| ID | risiko (knapp) | beruehrt (mit Zeile) | beleg | migrationsrisiko |
| --- | --- | --- | --- | --- |
| WORLD-01 | DEFAULT_LANGUAGE ist Doppel-Fallback (Land ohne Bundle UND Bestandsdatensatz ohne Feld); additiv-NULLABLE ohne Backfill kippt Bestand auf Englisch | defaults.js:331 | defaults.js:331; locales.js:279; state-ops.js:651; db/schema.sql:63-64,402-403 | JA - Backfill-Kriterium vor Flip klaeren |
| WORLD-03 | identisch zu WORLD-01 (dieselbe Konstante) | defaults.js:331 | locales.js:286; defaults.js:331; f1-i18n-locale.test.js:34-39 (Altpin, mitzuziehen) | deckungsgleich mit WORLD-01 |
| DID-01 | kein eigenes Risiko, automatisch gruen mit WORLD-01; Alt-Test kollidiert (R5-Loeschpflicht) | locales.js:268-280 | locales.js:268-280; kanonische-liste Abschnitt 3 | keins ueber WORLD-01 hinaus |
| DID-02 | kein eigenes Risiko, Onboard-Handler unveraendert | api-onboard.js:141-152 | api-onboard.js:141-152,168,172-173; locales.js:268-280 | keins - expliziter User-Willensakt (country wird bewusst gesetzt) |
| DID-03 | kein eigenes Risiko, provision-trigger.js bleibt unveraendert | billing/provision-trigger.js:29-42 | provision-trigger.js:29-42; locales.js:268-280 | keins fuer neue Aktivierungen; speist E2E-04 |
| LANG-02 | jeder neue Web-Login-Kunde bekommt NULL/NULL bis WORLD-01 greift, dann englisch | web-auth.js:503-518 (resolveOrCreateTenant) | web-auth.js:503-518; self-service.js:20; tasks/i18n-tests/01:108,161 | kein Risiko fuer Bestand selbst, aber Reihenfolge-Vorbedingung fuer WORLD-01 |
| E2E-01 | halbfertiger Land-/Sprachwechsel: DID/Nummer bleibt am alten Land, Sprache/Herkunft laufen auseinander | self-service.js:20; self-service-routes.js | self-service.js:20; e2e-01-test.js:1-12 | JA - neue DID kaufen vs. behalten vs. verbieten ist ungeklaert |
| E2E-04 | Hauptfall fuer jeden neuen Weltstart-Kunde ausserhalb DE/AT/CH/FR: US-DID + deutsches Greeting | web-auth.js:503-518; provision-trigger.js:29-42; config.js:779 | provision-trigger.js:29-34; config.js:779,787; render.yaml:160,175 | kein direktes Bestandsrisiko (neue Tenants), aber struktureller Konflikt homeCountry vs. forceNumberCountry ungeklaert |
| E2E-05 | harter Onboarding-Blocker fuer US-Kunden mit eigener US-Privatnummer unter Live-Config | api-onboard.js:120-129; defaults.js:331 | api-onboard.js:120-129; e2e-05-test.js:7-18 | kein Bestandsrisiko (Neukunden-Pfad); bleibt rot bis FMT-11 UND WORLD-01 beide gefixt sind |

### B2 - Prompts, Gespraech, Offenlegung

| ID | risiko (knapp) | beruehrt (mit Zeile) | beleg | migrationsrisiko |
| --- | --- | --- | --- | --- |
| PROMPT-01 | zweisprachiges Gespraech fuer EN/FR-Tenants, kein akutes Bestandsrisiko | claude.js | claude.js:56-247; prompt-en-scaffolding.test.js:31-49 | - |
| PROMPT-02 | Qualitaets-/Konsistenzrisiko, kein Geld-/Sicherheitsrisiko; vor Rollout convo-bench pruefen | claude.js:317,334 | claude.js:317,334 | - |
| PROMPT-03 | englischsprachiger Anrufer hoert deutschen Erstsatz - senkt Vertrauen sofort | voice.js:265; defaults.js:320; locales.js:249 | voice.js:264-265; defaults.js:320-321 | JA - Fix braucht DE/AT/CH-Fallback, siehe Abschnitt 4 |
| PROMPT-14 | kumuliertes Risiko aus PROMPT-01/02/03, kein neues | claude.js; voice.js:265; defaults.js | test/personal-assistant-characterization.test.js:215-221,333-346 (Loeschpflicht) | - |
| GAP-28 | reines Qualitaetsrisiko (Modell-interner Kontext), Sprach-Bleed-Gefahr bei Haiku | claude.js:385,407,413,419 | claude.js:407,413,385,419 | - |
| GAP-14 | rechtliches Risiko (Transparenzpflicht), betrifft JEDEN heutigen Inbound-Call | defaults.js:320; self-service.js:29-33; state-ops.js:2509-2527 | defaults.js:320-321; self-service.js:29-33; state-ops.js:2509-2527 | JA, zweifach - s. Abschnitt 4 |
| WEB-04 | UX-Luecke, kein Geld-/Sicherheitsrisiko | self-service.js:29-33 | self-service.js:29-33 | - |
| E2E-02 | kombiniert PROMPT-03 mit drittem Kanal (SMS-Rahmentext), eigener Code-Pfad noetig | voice.js:265; call-finish.js:57,80-81 | voice.js:264-265; call-finish.js:56-58,79-81 | - |
| E2E-06 | reiner Aggregat-Beweis, kein neuer Mechanismus | claude.js; voice.js:265; call-finish.js; web-auth.js | e2e-06-test.js:1-13,33-34 | - |

### B3 - MCP-Tools und Widgets

| ID | risiko (knapp) | beruehrt (mit Zeile) | beleg | migrationsrisiko |
| --- | --- | --- | --- | --- |
| PROMPT-09 | ohne Verzweigung bleiben FMT-03/MCP-04/06/09 strukturell unerreichbar | mcp-tools.js | mcp-tools-i18n.test.js:90-98 (0 Treffer); claude.js:43 als Vorbild | JA - Verzweigung muss bei Bestandskunden weiterhin 'de' liefern, s. Abschnitt 4 |
| FMT-03 | gering, EN/FR-Tenant sieht deutsches Datumsformat | mcp-tools.js:49 | mcp-tools.js:49; locales.js:98,170,219 | - |
| MCP-04 | gering, kosmetischer Fehlertext im Chat | mcp-tools.js:63-82 | mcp-tools.js:63-82, Zeilen 65-67,77-79 | - |
| MCP-06 | gering, deutsches Wort im Transkript-Feed | mcp-tools.js:103-115 | mcp-tools.js:103-115, ~Zeile 110 | - |
| MCP-08 | Widerspruch zu Owner-Entscheidung 7.1, s. Abschnitt 5 | mcp-tools.js:707-710 | mcp-tools.js:707-710; config.js:362 | JA falls paymentCurrency=usd je greift - Anzeige muss Belastungswaehrung folgen |
| MCP-09 | MITTEL: eine Quelle fuer Text UND Widget, bestehender gruener Pin bricht ohne Mitzug | mcp-tools.js:194-199 | mcp-tools.js:194-199; mcp-ui.test.js:682 | JA - gruener Pin MUSS im selben Zug angepasst werden |
| MCP-12 | kein Produktionsrisiko, reine Testabdeckungsluecke | test/mcp-tools.test.js, mcp-ui.test.js, mcp-ui-widget-i18n.test.js | mcp-tools-i18n.test.js:250-261,243-249 | - |
| UI-14 | falscher Cache-Key/Default koennte DE-Tenants ein anderssprachiges Widget zeigen | ui/widget-catalog.js:126-154; ui/registry.js:43-50; ui/contract.js; ui/widget-bind.js:177-191 | widget-catalog.js:140,154 | JA - Default bei fehlendem Sprachparameter muss klar sein |
| UI-18 | zusaetzlich: falsche Tenant-Aufloesung koennte falsches Widget an falschen Tenant liefern (Kosmetik, kein Datenleak) | state-ops.js:1187-1201; ui/widget-catalog.js; ui/registry.js | state-ops.js:1187-1201; widget-catalog.js | JA - safer Default fuer Tenants ohne country/defaultLanguage |

### B4 - Telefonie/Wahl-Sicherheit, Latenz, Deploy-Startfaehigkeit

| ID | risiko (knapp) | beruehrt (mit Zeile) | beleg | migrationsrisiko |
| --- | --- | --- | --- | --- |
| GAP-18 | Toll-Fraud: One-Ring-/Premium-Rate-Nummern in NANP-Karibik passieren die Denylist sobald +1 erlaubt ist | outbound-gates.js:58-90 | outbound-gates.js:58-90 (0 Treffer "+1" in PREMIUM_PREFIXES); number-gate.test.js:143-172 | - |
| GAP-21 | Kunden zahlen fuer Mailbox-Gespraeche, die nie stattfanden; unpassende KI-Nachrichten auf fremden Mailboxen | adapters/telnyx/voice.js (originateCall, originateViaCallControl) | machine-detection.test.js:1-11; tasks/i18n-tests/11:539-541 | - |
| GAP-22 | worst-case Turn kappt bei 15s, Anruf bricht mitten im Gespraech ab | config.js:143-160,245-252 | config.js:145,148-155,247-249; turn-latency-budget.test.js:23-32 | - |
| GAP-25 | Agent ruft ungewollt einen Dritten an (US-Tenant mit '011'-Eingabe) | defaults.js:525-531 (normalizeDialTarget) | defaults.js:525-531; dial-target-normalization.test.js:110-135 (empirisch 2026-07-25) | - |
| GAP-10 | ein Tenant kann alle anderen zahlenden Tenants vom Outbound verdraengen (DoS unter Kunden) | outbound-gates.js:188-201,292; plans.js:106 | outbound-gates.js:188-192 (Kommentar "Tenant-unabhaengig"); plans.js:106; outbound-gates.js:292 | JA - Owner-Entscheidung 7.7 fehlt, globales Limit darf nicht ersatzlos entfernt werden |
| FMT-11 | Onboarding-Blocker fuer jeden Nicht-DE-Tenant mit privater Nummer beim Weltstart | api-onboard.js:121-129; state-ops.js:1144 | api-onboard.js:121-129; state-ops.js:1144-1163; fmt-11-test.js:1-38 | - |
| GAP-33 | (a) internationale Kunden koennen trotz Buchung nicht anrufen; (b) Blueprint startet nicht = Recovery-Risiko | render.yaml:212-213; Reserve-/Tarif-Rechnung (B5) | prod-config-smoke.test.js:1-19,106-118,120-140 | - (haengt an ORIG-01/02/03 und GAP-38 fuer die eigentliche Migrationsfrage) |

### B5 - Geld-/Budget-Gates, Stripe, Herkunfts-Tarifierung

| ID | risiko (knapp) | beruehrt (mit Zeile) | beleg | migrationsrisiko |
| --- | --- | --- | --- | --- |
| GAP-01 | einmal lebenszeit-gesperrte Tenants bleiben dauerhaft outbound-gesperrt, auch nach Zahlung | state-ops.js:1959; render.yaml:310-311 | state-ops.js:1959-1961; render.yaml:305-311 | JA - s. Abschnitt 4 |
| GAP-03 | Kunde telefoniert nach Chargeback/Refund unveraendert weiter, reales Geld ohne Gegenmassnahme | webhook.js:16-21,130-141,195-205 | webhook.js:16-21,130-141,195-205 | JA (implizit, s. Abschnitt 4) |
| GAP-04 | zahlender Tenant ohne funktionierende Nummer, keine Kompensations-/Alarm-Spur | billing/activation.js:66-73 | activation.js:66-73 | - |
| GAP-05 | laufende DID-Mietkosten ohne zahlenden Kunden, skaliert mit jedem geleakten Coupon | onboarding.js:134-142; stripe.js:279,354-371 | onboarding.js:134-136; stripe.js:279,354-371 | - |
| GAP-07 | zu strenger Fix (hartes fatal:true) kann den LIVE-Dienst bei Dashboard-Drift selbst lahmlegen | config.js:1208; boot-guard.js:317-324 | config.js:1208; boot-guard.js:317-324; Boot-Log-Beleg 07-23T23:23:24Z | - |
| GAP-32 | reiner Flip fatal:false->true ohne Zahlenkorrektur legt den Dienst sofort lahm | boot-guard.js:114-127; render.yaml; defaults.js:253 | boot-guard.js:114-127; render.yaml; defaults.js:253; gap-32-test.js:31-58 | JA - drei Hebel zur Wahl, s. Abschnitt 4 |
| ORIG-01 | Signaturaenderung an geldkritischer Funktion, mehrere Aufrufer koennen vergessen werden (Unter-/Ueberbuchung) | outbound-gates.js:145,670; metering.js:45,68 | outbound-gates.js:145; orig-01-05-test.js:64-70 | JA (implizit, s. Abschnitt 4) |
| ORIG-02 | laufender, sich summierender Geldverlust fuer Sundartha bei jedem Nicht-US-Ziel-Anruf | metering.js:45; outbound-gates.js:145 | orig-01-05-test.js:75-88; metering.js:45 | JA (implizit) |
| ORIG-03 | verbraucht Budget-Decke fuer Ereignisse, die der Tenant nicht kontrolliert; kombiniert mit GAP-32 sperrt es allein | telephony/call-finish.js:44-48 | orig-01-05-test.js:92-113; call-finish.js:44-48 | JA (implizit) |

### B6 - Web-Dashboard, Recht, Metriken, Zeitzone

| ID | risiko (knapp) | beruehrt (mit Zeile) | beleg | migrationsrisiko |
| --- | --- | --- | --- | --- |
| WEB-01 | rein kosmetisch/Accessibility, kein Geld-/Anrufrisiko | public/tenant.html | tenant.html (1x lang="de"); web-01-test.js:18-30 | - |
| WEB-09 | kein Geld-/Sicherheitsrisiko; Frontend-Vertrag muss mitgezogen werden falls Text geparst wird | self-service-routes.js:275; public/tenant.html | self-service-routes.js:274-275 | - |
| WEB-11 | kein neuer Angriffsvektor, reiner Textwechsel, Regel 3 unberuehrt | web-auth.js:115-117 | web-auth.js:113-117 | - |
| WEB-12 | identisch WEB-11, Statuscodes/Detail-Arm-Politik bleiben gleich | web-auth.js:223,284 | web-auth.js:219-224,279-284 | - |
| WEB-14 | Notification-/SMS-Pfad JEDES beendeten Calls; Fehler trifft ALLE Anrufe, nicht nur EN | call-finish.js:57,80 | call-finish.js:56-58,79-81 | - |
| GAP-15 | groesstes Rechtsrisiko im Buendel: Platzhalter-AGB/Datenschutz LIVE ist Compliance-Verstoss; Blocker ist der fehlende Owner-Text, nicht Technik | apps/web/src/pages/{agb,datenschutz,impressum}.astro | apps/web/src/pages/* (Platzhalter-Marker) | - (Owner muss Rechtstext liefern) |
| GAP-35 | Betriebsblindheit: Laender-Totalausfall waere unsichtbar; neues Ereignis muss PII-arm bleiben (Regel 4/5-Nachbarschaft) | render.yaml:338; metrics.js; outbound-gates.js:120-124 | render.yaml:141,337-339; metrics.js:18; outbound-gates.js:120-124 | - |
| GAP-36 | sehr gering; neues Feld darf NUR nicht-sensible Werte tragen (Regel 4 SECRETS) | app.js:107 | app.js:107; boot.js:264-268 (TEMP-DIAGNOSE) | - |
| GAP-38 | kritischer Recovery-Pfad tot; In-Prozess-Heilung muss strikt nur bei WIRKLICH leerem Store greifen | render.yaml:4-31; boot.js:228-234; scripts/bootstrap-tenant.js | render.yaml:13,31; boot.js:228-234 | - |
| FMT-28 | Datenmodell-Eingriff mit Migrationspflicht (JSON+Postgres+RLS+Onboarding) | defaults.js; db/schema.sql; claude.js:43; neue Migration | defaults.js (kein Match); db/schema.sql:13-135; PLAN-I18N-TESTS.md 7.6 | JA - s. Abschnitt 4 |

## 8. Unsicherheiten und Luecken

Was die Buendel-Agenten nicht bestimmen konnten - zur Klaerung durch Lead oder Owner:

- **DB-Realzustand fuer WORLD-01/03** (B1): ob Bestandsdatensaetze tatsaechlich NULL in
  `tenant.default_language`/`number.language` tragen, wurde NICHT gegen die echte DB geprueft
  (nur additiv-nullables Schema belegt). Traegt das gesamte Migrationsrisiko-Argument. Eine
  `psql`-Abfrage gegen `hermes-db` (Zugriff laut Memory bekannt) wuerde das klaeren.
- **LANG-02-Umsetzungsweg** (B1): IP-Geo beim Login vs. aktive Nutzerabfrage vs. Onboard-Redirect -
  bewusst offen gelassen, echte Produktentscheidung.
- **E2E-01 UI-Pruefung** (B1): nur grep gegen public/tenant.html und self-service.js gemacht; falls
  ein separater Owner-Client oder API-Doku Land-Wechsel bewirbt, waere `brennt_heute` neu zu
  bewerten.
- **GAP-14 Pflicht-Wortlaut** (B2): ob ein exakter Marker-Wortlaut bereits Owner-Entscheidung ist
  oder Platzhalter des Testautors, wurde nicht geklaert (Bereichsdatei tasks/i18n-tests/11 nur ueber
  Kopfkommentar referenziert, nicht selbst gelesen).
- **E2E-02/E2E-06 Uebersetzungsmechanismus** (B2): welche Rahmentexte in call-finish.js uebersetzt
  werden sollen und nach welchem Locale-Mechanismus, nicht verifiziert.
- **GAP-28 Zielrichtung** (B2): ob die vier Kontroll-Marker uebersetzt oder aus der Modell-Kette
  entfernt werden sollen, ist eine offene Implementierungsentscheidung.
- **MCP-08 Einordnung** (B3): setzt voraus, dass Owner-Entscheidung 7.1 auf paymentCurrency=usd
  anwendbar sein soll; denkbar ist auch komplette Abschaffung des usd-Zweigs. Siehe Abschnitt 5 fuer
  mein Urteil dazu.
- **Aufwandsschaetzungen B3** beruhen auf Funktionsgroesse laut Kopfkommentaren, nicht auf
  tatsaechlicher Implementierung (kein Code veraendert, wie vorgegeben).
- **GAP-33 HTTP-Status** (B4): der tatsaechliche Statuscode des Auslands-Calls unter Live-Env (402
  vermutet) wurde NICHT durch Testlauf verifiziert; Einschaetzung stuetzt sich auf Testkommentar und
  die Verbindung zu ORIG-01/02/03. Die render.yaml-Ursache jenseits Zeile 212-213 wurde nicht
  vollstaendig verifiziert (render.yaml selbst nicht gelesen, nur zitiert).
- **BUDGET_MONTH_ENABLED Live-Quelle** (B5): ob render.yaml tatsaechlich der Live-Wert ist, wurde
  nicht geprueft - Memory-Lehre: Render-Services sind teils Dashboard-managed, render.yaml!=Live.
  Das entwertet potenziell die "ja"-Einstufung von GAP-01 UND GAP-32 gleichermassen (beide stuetzen
  sich auf dieselbe unverifizierte Annahme) - siehe auch die Abschwaechung in Abschnitt 3.
- **GAP-32 Hebel-Plan** (B5): ob es bereits einen konkreten Owner-Plan gibt, welchen der drei Hebel
  (Tenant-Decke/Tarif/Max-Dauer) er waehlen will, wurde nicht in PLAN-I18N-TESTS.md Abschnitt
  7.0/7.12/7.13 gezielt nachgeschlagen (Quelle 1 lieferte laut B5 bereits eine vollstaendige Antwort).
- **WEB-01 Umsetzungstiefe** (B6): ob ein einfacher `document.documentElement.lang`-Write reicht oder
  ein echter i18n-Textmechanismus (data-i18n) noetig ist - als "umbau" eingestuft, aber nicht sicher.
- **GAP-35 Kostenfolgen von METRICS_ENABLED=true** (B6): ob das Aktivieren selbst produktrelevante
  Logging-Last/Kosten hat, die eine Owner-Entscheidung noetig macht, wurde nicht abschliessend
  geklaert.
- **GAP-38 Kollision mit Owner-Removal** (B6): ob eine In-Prozess-Bootstrap-Heilung mit der
  Owner-Removal-Entscheidung (kein Owner-Konzept mehr, Admin via account.role, Memory
  owner-removal-chain) kollidiert, wurde nicht gegengeprueft.
- **FMT-28 Aufwandsrealismus** (B6): ob "mehrere Tage" realistisch ist oder eine schlankere Variante
  (NULL-faehiges Feld ohne Ableitungslogik/Migration) auf "halber Tag" senkt, wurde nicht gegen die
  tatsaechliche Postgres-Migrationsmechanik dieses Repos geprueft (kein `migrations/`-Verzeichnis
  gesehen).
- **Kollidierender abhaengt_von-Eintrag GAP-01 -> GAP-07** (eigener Befund dieser Synthese, s.
  Abschnitt 6): unbelegt, sollte vor Umsetzung am Code verifiziert oder verworfen werden.
- **PROMPT-14/DID-01/WORLD-03 Alt-Test-Loeschpflichten** (uebergreifend, s. Abschnitt 5): drei
  Nicht-Katalog-Tests muessen bei den jeweiligen Fixes geloescht/nachgezogen werden (R5). Das ist
  keine offene Frage, sondern eine feststehende Nebenpflicht, die der Lead beim Einplanen nicht
  vergessen darf.

## Nachzaehlung

53 Katalog-IDs im Dokument:

B1 (9): WORLD-01, WORLD-03, DID-01, DID-02, DID-03, LANG-02, E2E-01, E2E-04, E2E-05
B2 (9): PROMPT-01, PROMPT-02, PROMPT-03, PROMPT-14, GAP-28, GAP-14, WEB-04, E2E-02, E2E-06
B3 (9): PROMPT-09, FMT-03, MCP-04, MCP-06, MCP-08, MCP-09, MCP-12, UI-14, UI-18
B4 (7): GAP-18, GAP-21, GAP-22, GAP-25, GAP-10, FMT-11, GAP-33
B5 (9): GAP-01, GAP-03, GAP-04, GAP-05, GAP-07, GAP-32, ORIG-01, ORIG-02, ORIG-03
B6 (10): WEB-01, WEB-09, WEB-11, WEB-12, WEB-14, GAP-15, GAP-35, GAP-36, GAP-38, FMT-28

9+9+9+7+9+10 = **53**. Vollstaendig.
