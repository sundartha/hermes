# 18 - Welle W2: verbindlicher Scope und Blockschnitt

Stand: 2026-07-26 | Basis: `master` = `ef16219` | Vorgaenger: [`15-w1-bericht.md`](15-w1-bericht.md)

Diese Datei ist die **autoritative Scope-Quelle fuer Welle W2** und zugleich die `specFile`
der Umsetzungs-Workflows (`.claude/workflows/phase-impl-lean.js`, `phaseId` = `W2-B0` .. `W2-B7`).
Bei Konflikt gewinnt sie gegen `PLAN-I18N-TESTS.md` Abschnitt 5 - jener Abschnitt fuehrt
nachweislich Tests, die als Duplikat entfallen oder zurueckgestellt sind (K1 aus dem W1-Bericht).

---

## 1. Ausgangslage (gemessen, nicht uebernommen)

| | |
| --- | --- |
| `npm test` (Regressionslauf) | **3307 / 0 rot** |
| `npm run test:gates` (Launch-Gates) | 24 echte Tests, **3 rot**: GAP-05 (dauerhaft getragen), GAP-15 x2 (wartet auf Rechtstext-Lieferung O13) |
| W1 umgesetzt | 79 Tests (78 + GAP-33) |
| Fix-Kette | 15 Phasen + P15b gemergt, code-seitig fertig, **nicht deployed** |

## 2. Herleitung des Vorrats

Ausgangsmenge: Tabelle 4.2 aus `PLAN-I18N-TESTS.md` (302 IDs) plus die 20 `UI-*`-Tests aus
[`12-sprachachsen-ui.md`](12-sprachachsen-ui.md), abzueglich der 109 Duplikate aus
[`00-kanonische-liste.md`](00-kanonische-liste.md), abzueglich der 5 zurueckgestellten
(GAP-02, LAW-06, LAW-07, GAP-12, GAP-13), abzueglich der bereits in `test/` gebauten IDs.

Rest: 114 offline-Tests. Davon nach den Owner-Entscheidungen unten **11 gestrichen**:

| Streichung | IDs | Begruendung |
| --- | --- | --- |
| Realtime | VOICE-15, VOICE-16 | Der Realtime-Zweig ist kein Produktpfad (`src/config.js`, live = Budget-Engine). LAW-24 derselben Achse war ohnehin W3-manuell. |
| Zeitzone erledigt | FMT-01 | Fix-Phase P8 hat den Sachverhalt umgesetzt: `src/claude.js:43` loest `store.tenantTimezone(...)` auf, `:50` gibt `timeZone` in den `now`-Zeitstempel. Abgedeckt von `test/p8-prompt-timezone.test.js`; es fehlt **nur** der Katalog-ID-Verweis -> Buchhaltung in W2-B0, kein Testbau. |
| Kalender-Achse | FMT-29, FMT-06, FMT-31, UI-12 | Owner-Entscheidung: der Agent bucht nicht im Kalender - **und tut es heute auch nicht** (`toolDefs()` in `src/claude.js` kennt genau `end_call` und `take_message`; kein `book_appointment` im gesamten `src/`; `get_calendar` ist reine Anzeige; der Mandats-Text in `src/mcp-tools.js` sagt woertlich "the agent books NOTHING and gets NO calendar access"). Damit ist die Kalender-Oberflaeche kein Launch-Gate. **Getragenes Risiko:** `public/calendar.html` und `public/calls.html` formatieren dauerhaft hart deutsch, auch fuer EN-Tenants. |
| Recht (echte Rechtsfragen) | LAW-13, GAP-16, GAP-17 | Loeschendpunkt, `audit_log`-Retention und Subprozessor-Verzeichnis sind Policy-Entscheidungen, die kein Test entscheidet (Abgrenzung 1.4 des Plans). Reiht sich in die getragenen Risiken nach 7.13 ein. |
| Modus-Korrektur | UI-20 | `navigator.language` im claude.ai-Doppel-Iframe ist Modus **manuell** (Cluster D33) -> gehoert nach W3, nicht nach W2. |

**Ausdruecklich NICHT gestrichen, obwohl `LAW-`-Praefix:** LAW-14 (fail-closed CLI-Gate von
`erase-tenant.js`), LAW-15 (Retention-Defaults), LAW-18 (Geo-Fallback auf
`DEFAULT_COUNTRY`/`DEFAULT_LANGUAGE`), LAW-22 (Isolations-Race bei parallelem Onboarding).
Das sind Code-Vertraege auf der Sprach- und Sicherungs-Achse; das Praefix stammt aus der
Sektionszuordnung, nicht aus dem Inhalt.

**Ergebnis: 103 Tests in W2.** 58 x P1, 35 x P2, 10 `UI-*` (die UI-Sektion vergibt keine Prio).

## 3. Bindende Regeln fuer jeden Block

**R-A - Kein Produktionscode.** W2 baut Tests. Jede Aenderung ausserhalb `test/` ist ein
Blocker; der Beweis ist `git diff <base> <branch> --name-only`, gegengeprueft per `--stat`,
nicht per Stichprobe. (In W1 hat ein Scoping-Agent einen `DEFAULT_LANGUAGE`-Flip
vorgeschlagen - das ist der Fix, nicht der Testbau.)

**R-B - Katalog-ID am Namensanfang.** Jeder neue Test beginnt mit seiner ID (bzw. mit
`Charakterisierung <ID>` fuer R3-Mechanismus-Tests). Das ist die **einzige** Zuordnungsregel
zwischen Regressionslauf und Gate-Lauf (`package.json` `config.i18nCatalogPattern`). Ohne sie
landet ein roter Launch-Gate-Test im Regressionslauf und macht `npm test` rot.

**R-C - `npm test` MUSS nach jedem Block gruen bleiben** (heute 3307/0). Rote Launch-Gates
gehoeren in `npm run test:gates` und sind dort das Arbeitsergebnis, kein Fehler
(`PLAN-I18N-TESTS.md` 4.1). Beide Laeufe zusammen ergeben denselben Testbestand wie ein
ungefiltertes `node --test "test/*.test.js"` - der Split darf nichts verlieren und nichts
doppeln.

**R-D - `BASE_ENV` nachziehen.** Jede neue Config-Env muss in `test/helpers.js` `BASE_ENV`
stehen, sonst leakt die lokale `.env` in Spawn-Tests.

**R-E - Regel 0 zum Worktree.** `git checkout -b <branch> master`, danach pruefen, dass
`PLAN-I18N-TESTS.md` und `tasks/i18n-tests/` im Arbeitsverzeichnis existieren. Fehlen sie,
steht der Worktree auf einem veralteten Commit -> abbrechen. (In W1 standen zwei von drei
Worktrees auf `566ccd6`, dem Commit vor der Plananlage.)

**R-F - Bestandstest rot = sofort stoppen.** Ausnahme ist der dokumentierte Voll-Last-Flake
`p5-gate-proof` (~12 %, Seed-vor-Boot-Race): rot gilt nur als echt, wenn die Datei ISOLIERT
ebenfalls rot ist.

**R-G - Die Spalte "Katalog-Erwartung" in den Blocktabellen ist vom 2026-07-22 und damit
aelter als die 15 Fix-Phasen.** Sie ist ein Hinweis, kein Sollwert. Verbindlich ist die am
heutigen `master` GEMESSENE Polaritaet. Wo eine Erwartung nicht mehr stimmt, wird die
Abweichung im Blockreport festgehalten - nicht stillschweigend die Erwartung gedreht.

## 4. Blockschnitt

Geschnitten nach Code-Oberflaeche, damit parallele Worktrees sich nicht in die Quere kommen.

| Block | Inhalt | Tests |
| --- | --- | --- |
| **W2-B0** | Re-Baseline + GAP-27 (Abbruchpunkt) | 1 + Bericht |
| W2-B1 | Sprach-Aufloesung und Prompt-Schicht | 16 |
| W2-B2 | Telefonie-Render, STT/TTS, Assistant-Pfad | 11 |
| W2-B3 | Wahlziel-Normalisierung und Gate-Kette | 14 |
| W2-B4 | Geld: Tarif, Metering, Plan-Decken | 19 |
| W2-B5 | Provisioning und DID-Lebenszyklus | 9 |
| W2-B6 | Web, Dashboard, Widget-Oberflaechen | 21 |
| W2-B7 | Rest: MCP, Sicherungs-Vertraege, Formate | 12 |

### W2-B0 - Re-Baseline und GAP-27 (laeuft ALLEIN, vor allen anderen)

**Warum zuerst.** `PLAN-I18N-TESTS.md` Abschnitt 5 macht GAP-27 zum Abbruchpunkt von W2:
solange er rot ist, duerfen keine weiteren byte-genauen Pins fuer Nicht-DE-Sprachen entstehen -
sonst zementiert der naechste Test wieder einen Defekt als Sollzustand. Alle Folgebloecke
bauen genau solche Pins.

**Auftrag 1 - GAP-27 bauen** (`11-luecken-und-e2e.md`, Zeile 652 ff.). Neue Datei
`test/characterization-marking.test.js`: ein Meta-Test ueber `test/`, der jeden Test findet,
der einen Nicht-DE-Sprachwert byte-genau pinnt, und fuer jeden pruefte, ob (a) Name oder Datei
ihn als CHARAKTERISIERUNG kennzeichnen und (b) ein begleitender Eigenschafts-Test daneben
steht (Sprachreinheit statt Byte-Gleichheit). Die drei im Katalog benannten Belegstellen sind
seit der Fix-Kette teilweise verschwunden (`f1-geo-port.test.js` pinnt `languageForCountry("US")`
nicht mehr, `EXPECTED_SP_EN_OUT_FULL` existiert nicht mehr) - **erst messen, dann formulieren**.
Der Meta-Test muss auch dann tragen, wenn er heute gruen ist: er ist der Waechter fuer die
Bloecke B1-B7.

**Auftrag 2 - Re-Baseline.** Fuer alle 102 Tests der Bloecke B1-B7 die Katalog-Erwartung gegen
den heutigen `master` pruefen und Abweichungen in `tasks/i18n-tests/19-w2-baseline.md`
festhalten: ID, Katalog-Erwartung, gemessene Lage, betroffene Fix-Phase. Das ist eine
LESE-Aufgabe (grep/Code-Lektuere), kein Testbau. Bekannte Kandidaten fuer eine gekippte
Erwartung: LANG-15 (E3: `place_call.language` entfernt), LANG-19 (E1: normalisieren statt
still verwerfen), FMT-15 (P15b: Dashboard-Datum kommt fertig vom Server), PAY-01
(Entscheidung 7.1: EUR ueberall), GAP-31 (P15: Locale-Felder haben Konsumenten bekommen),
GAP-34 (E2: gemessen - in `src/db/migrate.js` gibt es Backfills fuer `period_start` und
`account_email`, KEINEN fuer `country`/`language`; der Test bleibt also offen).

**Auftrag 3 - Buchhaltung FMT-01.** Referenz-Kommentar an `test/p8-prompt-timezone.test.js`
nachtragen (Muster: die vier W1-Faelle VOICE-02/03/08 und LANG-06). Kein neuer Test, kein
Duplikat (G5).

**Deterministisches Ergebnis.** `npm test` gruen (3307+), `npm run test:gates` faehrt
`characterization-marking` mit, `19-w2-baseline.md` existiert und deckt alle 102 IDs ab.

### Blocktabellen B1-B7

#### W2-B1 (16 Tests)

| ID | Titel | Prio | Katalog-Erwartung (STAND 07-22, zu pruefen) | Beleglage |
| --- | --- | --- | --- | --- |
| LANG-09 | languageForCountry ist case-insensitiv, aber fuer US unveraenderlich "de" | P1 | gruen | `01-sprachaufloesung.md` |
| LANG-15 | MCP place_call.language wird serverseitig ignoriert | P1 | gruen | `01-sprachaufloesung.md` |
| LANG-16 | Inbound-Ablehnung fuer unbekannte Zielnummer ist hart Deutsch | P1 | gruen | `01-sprachaufloesung.md` |
| LANG-17 | resolveCallLanguage-Praezedenz vollstaendige Matrix (alle Falsy-Kombinationen) | P1 | gruen | `01-sprachaufloesung.md` |
| LANG-19 | updateSettings verwirft language="EN" (Grossschreibung) still, ohne Fehler | P2 | gruen | `01-sprachaufloesung.md` |
| LANG-21 | localeFor() Fail-Safe fuer unbekannte/leere/null Sprachcodes | P1 | gruen | `01-sprachaufloesung.md` |
| LANG-23 | Onboard-Kritischer-Abschnitt bleibt bei parallelen Requests atomar (Nebenlaeufigkeit) | P2 | gruen | `01-sprachaufloesung.md` |
| LANG-26 | Symmetrie-Beweis: Inbound und Outbound teilen exakt denselben Geo-Anker (keine Call-Parameter-Override moeglich) | P2 | gruen | `01-sprachaufloesung.md` |
| PROMPT-06 | fetchPrecallBriefing bekommt call.language nicht durchgereicht | P1 | gruen | `02-llm-prompts.md` |
| PROMPT-07 | Briefing-System-Prompt gibt dem Modell keine Sprachvorgabe fuer die Freitextfelder | P1 | gruen | `02-llm-prompts.md` |
| PROMPT-08 | assistantContextSection-Labels bleiben deutsch fuer einen EN-Call | P1 | gruen | `02-llm-prompts.md` |
| PROMPT-17 | Edge Case: Legacy-Nummer ohne language-Feld durchlaeuft die Praezedenzkette korrekt | P1 | gruen | `02-llm-prompts.md` |
| PROMPT-18 | Edge Case: paralleler EN- und DE-Call faerben sich nicht gegenseitig ab | P2 | gruen | `02-llm-prompts.md` |
| PROMPT-21 | Farewell-Delay-Kalibrierung nur fuer 'de' gemessen; EN/FR nutzen die alte, ungemessene Fallback-Kalibrierung | P2 | gruen | `02-llm-prompts.md` |
| PROMPT-22 | mandateSection bleibt deutsch, auch wenn ein EN-Call ein Mandat traegt | P1 | gruen | `02-llm-prompts.md` |
| E2E-03 | Sprachumstellung waehrend eines laufenden Anrufs bleibt wirkungslos | P1 | gruen | `11-luecken-und-e2e.md` |

#### W2-B2 (11 Tests)

| ID | Titel | Prio | Katalog-Erwartung (STAND 07-22, zu pruefen) | Beleglage |
| --- | --- | --- | --- | --- |
| VOICE-05 | GEO_ENABLED Default AUS: proposedCountry ist immer null ohne Env-Flag | P1 | gruen | `03-telefonie-render.md` |
| VOICE-09 | Self-Service POST /api/settings mit language="en" setzt und validiert korrekt | P1 | unbekannt | `03-telefonie-render.md` |
| VOICE-12 | ElevenLabs-Say traegt fuer alle drei Sprachen dieselbe Voice-ID, kein language-Attribut | P1 | gruen | `03-telefonie-render.md` |
| VOICE-18 | Telnyx-Assistant STT-Hint faellt fuer unbekannte Sprache (z.B. "xx", "multi") fail-open auf "auto" | P1 | rot | `03-telefonie-render.md` |
| VOICE-19 | transcriptionFields(null/undefined) liefert leeres Objekt (Bestand byte-identisch) | P2 | rot | `03-telefonie-render.md` |
| VOICE-22 | Twilio-STT-Modell bleibt sprachunabhaengig konstant (deepgram_nova-2-general) | P2 | gruen | `03-telefonie-render.md` |
| VOICE-23 | Budget-Engine (Twilio+Telnyx Gather) setzt fuer keine Sprache ein Barge-in-/Interrupt-Attribut | P1 | gruen | `03-telefonie-render.md` |
| VOICE-24 | Telnyx-Assistant-Pfad hat Barge-in AN (Kontrast zur Budget-Engine) | P2 | gruen | `03-telefonie-render.md` |
| VOICE-25 | Konkurrierende Calls mit unterschiedlicher Sprache leaken keine Voice-/STT-Werte (Nebenlaeufigkeit) | P1 | gruen | `03-telefonie-render.md` |
| VOICE-29 | Fail-closed-Beweis: unbekanntes voiceProfile wirft in BEIDEN Adaptern (kein stiller Fallback) | P1 | gruen | `03-telefonie-render.md` |
| GAP-24 | Assistant-Bindung und STT-Hint haengen an der Sprache des Calls | P1 | rot | `11-luecken-und-e2e.md` |

#### W2-B3 (14 Tests)

| ID | Titel | Prio | Katalog-Erwartung (STAND 07-22, zu pruefen) | Beleglage |
| --- | --- | --- | --- | --- |
| OUT-03 | Tenant-Profil kann Laender-Gate nur einschraenken, nie erweitern | P1 | unbekannt | `05-auslandstelefonie.md` |
| OUT-12 | Toll-Free-Nummern werden zum Worst-Case-Tarif abgerechnet | P2 | gruen | `05-auslandstelefonie.md` |
| OUT-14 | Modul-Kommentar "16 Glieder" widerspricht der tatsaechlichen 17er-Kette | P2 | gruen | `05-auslandstelefonie.md` |
| OUT-15 | Notruf-Denylist gewinnt auch bei explizit erlaubtem Land | P1 | gruen | `05-auslandstelefonie.md` |
| OUT-16 | Pre-Check `isTrunkZeroFormatError` ist fuer NANP-Nummern nie einschlaegig | P2 | unbekannt | `05-auslandstelefonie.md` |
| OUT-17 | normNum bereinigt US-Trennzeichen-Schreibweisen korrekt (Positiv-Fall) | P1 | gruen | `05-auslandstelefonie.md` |
| OUT-18 | US-Testnummer bleibt der einzige Negativ-/Randfall in der Testsuite | P2 | gruen | `05-auslandstelefonie.md` |
| OUT-22 | Leere/undefinierte Profil-allowedCountryCodes bedeuten "keine Zusatz-Einschraenkung" | P2 | gruen | `05-auslandstelefonie.md` |
| OUT-23 | Grossschreibung/gemischte Schreibweise bei Laendercode-Praefixen ist irrelevant (E.164 hat kein Casing) | P2 | gruen | `05-auslandstelefonie.md` |
| OUT-27 | Assistant-Origination-Pfad reicht `to` unveraendert durch (keine eigene Laenderlogik) | P2 | gruen | `05-auslandstelefonie.md` |
| OUT-28 | Gate-Reihenfolge bleibt bei US-relevanten Einzelverletzungen deterministisch | P1 | gruen | `05-auslandstelefonie.md` |
| FMT-20 | E.164 akzeptiert NANP-Nummern (+1 + 10 Ziffern) korrekt | P2 | gruen | `10-zeit-format-daten.md` |
| FMT-21 | TRUNK_ZERO_COUNTRY_CODES betrifft +1 nicht (kein False-Positive fuer US) | P2 | gruen | `10-zeit-format-daten.md` |
| FMT-22 | homeCountryCode() liefert fuer reinen US-Tenant null (kein Heimatland ableitbar) | P1 | gruen | `10-zeit-format-daten.md` |

#### W2-B4 (19 Tests)

| ID | Titel | Prio | Katalog-Erwartung (STAND 07-22, zu pruefen) | Beleglage |
| --- | --- | --- | --- | --- |
| PAY-01 | Plan-Katalog bleibt EUR und Cross-Package-identisch (Regressionsschutz) | P1 | gruen | `07-geld-und-waehrung.md` |
| PAY-06 | Cost-Truing-Sweep befreit die ueberreservierte Decke nach der konfigurierten Verzoegerung | P1 | unbekannt | `07-geld-und-waehrung.md` |
| PAY-08 | Inbound-Anruf zieht das Tenant-Budget nie ab (Richtungspruefung) | P1 | gruen | `07-geld-und-waehrung.md` |
| PAY-09 | recordVoiceMinuteMeter rechnet auch fuer INBOUND-Calls mit dem 15x-Auslandstarif, wenn call.to eine US-DID ist | P1 | gruen | `07-geld-und-waehrung.md` |
| PAY-10 | costCents aus recordVoiceMinuteMeter geht NICHT an Stripe (nur quantity) | P2 | gruen | `07-geld-und-waehrung.md` |
| PAY-12 | Budget-Gate-402-Ablehnungstext ist hartkodiertes Deutsch (keine Locale-Anbindung) | P1 | gruen | `07-geld-und-waehrung.md` |
| PAY-15 | planCapCents wirft fail-closed bei unbekanntem Plan-Slug | P2 | gruen | `07-geld-und-waehrung.md` |
| PAY-16 | Wird ein neuer Plan (z.B. "starter_us") eingefuehrt, ohne PLAN_CAP_HEADROOM-Eintrag, blockiert er sofort JEDEN Call (fail-closed statt fail-open) | P1 | gruen | `07-geld-und-waehrung.md` |
| PAY-17 | Nummern-Setup-Hold ist fuer US aktuell IDENTISCH zum DE-Default (kein eigener Land-Preis konfiguriert) | P2 | gruen | `07-geld-und-waehrung.md` |
| PAY-20 | providerToBucketRateMicro ist eine reine Konstante ohne automatisierten Drift-Alarm | P2 | gruen | `07-geld-und-waehrung.md` |
| PAY-22 | Grenzfall: leere/unbekannte Zielvorwahl faellt auf den teuren Default-Tarif (fail-safe teuer, nicht fail-open billig) | P1 | gruen | `07-geld-und-waehrung.md` |
| PAY-23 | Grenzfall: Reserve exakt gleich dem verbleibenden Cap ist ERLAUBT (strikt >, nicht >=) | P2 | gruen | `07-geld-und-waehrung.md` |
| PAY-24 | Plan-Downgrade auf Starter waehrend bestehender Nicht-Inlands-Reserve wirkt sofort verschaerfend | P1 | unbekannt | `07-geld-und-waehrung.md` |
| PAY-25 | Env-Doku-Kohaerenz: VOICE_TARIFF_DOMESTIC_PREFIXES ist in .env.example dokumentiert und deckt sich mit dem Code-Default | P2 | unbekannt | `07-geld-und-waehrung.md` |
| PAY-26 | Grosse-Zahl-Fuzzing: negative/NaN max_duration_s im Body kann die Reserve nicht senken | P1 | gruen | `07-geld-und-waehrung.md` |
| GAP-06 | Monatliche DID-Miete wird gebucht, gekuendigte DIDs werden freigegeben | P1 | rot | `11-luecken-und-e2e.md` |
| GAP-08 | Es gibt genau EINE Quelle fuer den USD/EUR-Kurs | P1 | rot | `11-luecken-und-e2e.md` |
| GAP-09 | TTS-Zeichen sind je Tenant zurechenbar, und ein erschoepftes Kontingent hat einen definierten Zustand | P1 | rot | `11-luecken-und-e2e.md` |
| GAP-11 | Hold, Capture und gebuchte Nummernkosten stimmen je Kaufland ueberein | P1 | rot | `11-luecken-und-e2e.md` |

#### W2-B5 (9 Tests)

| ID | Titel | Prio | Katalog-Erwartung (STAND 07-22, zu pruefen) | Beleglage |
| --- | --- | --- | --- | --- |
| DID-05 | Reale Nicht-Tabellen-Laender (CA/IE/AU/CH/AT/ES/IT) kaufen unmarkiert eine DE-Nummer | P1 | rot | `06-nummern-provisioning.md` |
| DID-08 | Telnyx-Order-Body und -Fehlerpfad ohne Regulatory-Differenzierung | P1 | gruen | `06-nummern-provisioning.md` |
| DID-09 | phone_number_type wird fuer US (und alle Laender) nie gesetzt | P1 | rot | `06-nummern-provisioning.md` |
| DID-11 | holdAmountForCountry liefert fuer US/FR/GB/DE identischen Betrag | P2 | gruen | `06-nummern-provisioning.md` |
| DID-17 | RELEASE_GRACE_DAYS=0 + knapper maxNumbers-Cap blockiert neuen Signup | P2 | gruen | `06-nummern-provisioning.md` |
| DID-19 | Telnyx-Idempotency-Key ist number-id-gebunden, keine Land-Kollision bei Parallelitaet | P2 | gruen | `06-nummern-provisioning.md` |
| GAP-19 | Absender-Land und Kauf-Land duerfen nicht unbemerkt auseinanderlaufen | P1 | rot | `11-luecken-und-e2e.md` |
| GAP-23 | Rufnummern-Reputation wird gemessen und stoppt den Nachschub | P1 | rot | `11-luecken-und-e2e.md` |
| GAP-34 | Backfill-Migration fuer country/language ist idempotent und kollisionsfrei | P1 | rot | `11-luecken-und-e2e.md` |

#### W2-B6 (21 Tests)

| ID | Titel | Prio | Katalog-Erwartung (STAND 07-22, zu pruefen) | Beleglage |
| --- | --- | --- | --- | --- |
| WEB-03 | WEB_DIST_DIR-Redirect /tenant.html -> /app erhaelt Query und liefert englische App-Shell | P1 | gruen | `08-web-dashboard-onboarding.md` |
| WEB-07 | apps/web bindet agentStyle/personaStyleIds ueberhaupt nicht (Feature-Luecke) | P1 | rot | `08-web-dashboard-onboarding.md` |
| WEB-08 | Persona-Style-Label in tenant.html bleibt deutsch trotz vorhandener EN-Uebersetzung | P2 | rot | `08-web-dashboard-onboarding.md` |
| WEB-10 | api-onboard.js PUBLIC_URL-Fehler ist deutscher Klartext | P2 | gruen | `08-web-dashboard-onboarding.md` |
| WEB-13 | SESSION_EXPIRED_PAGE ist lang="de" mit deutschem Fliesstext | P1 | rot | `08-web-dashboard-onboarding.md` |
| WEB-18 | apps/web nutzt durchgaengig en-US fuer Datumsformatierung (Regressions-Baseline) | P2 | gruen | `08-web-dashboard-onboarding.md` |
| WEB-19 | Keine UI fuer die private Rufnummer in beiden Dashboards | P1 | rot | `08-web-dashboard-onboarding.md` |
| WEB-25 | GB und IE mappen korrekt auf Englisch (Kontrast-Baseline zu WEB-22) | P2 | gruen | `08-web-dashboard-onboarding.md` |
| UI-01 | (nur in 12-sprachachsen-ui.md) | - | - | `12-sprachachsen-ui.md` |
| UI-02 | (nur in 12-sprachachsen-ui.md) | - | - | `12-sprachachsen-ui.md` |
| UI-03 | (nur in 12-sprachachsen-ui.md) | - | - | `12-sprachachsen-ui.md` |
| UI-04 | (nur in 12-sprachachsen-ui.md) | - | - | `12-sprachachsen-ui.md` |
| UI-05 | (nur in 12-sprachachsen-ui.md) | - | - | `12-sprachachsen-ui.md` |
| UI-06 | (nur in 12-sprachachsen-ui.md) | - | - | `12-sprachachsen-ui.md` |
| UI-07 | (nur in 12-sprachachsen-ui.md) | - | - | `12-sprachachsen-ui.md` |
| UI-13 | (nur in 12-sprachachsen-ui.md) | - | - | `12-sprachachsen-ui.md` |
| UI-15 | (nur in 12-sprachachsen-ui.md) | - | - | `12-sprachachsen-ui.md` |
| UI-19 | (nur in 12-sprachachsen-ui.md) | - | - | `12-sprachachsen-ui.md` |
| FMT-15 | tenant.html formatiert Preis/Datum immer als de-DE | P1 | rot | `10-zeit-format-daten.md` |
| GAP-30 | Self-Service-Feldkatalog ist zwischen Frontend und Server identisch | P1 | rot | `11-luecken-und-e2e.md` |
| GAP-37 | buildFilter und WEB_DIST_DIR widersprechen sich nicht | P1 | rot | `11-luecken-und-e2e.md` |

#### W2-B7 (12 Tests)

| ID | Titel | Prio | Katalog-Erwartung (STAND 07-22, zu pruefen) | Beleglage |
| --- | --- | --- | --- | --- |
| MCP-14 | Deutsche Text-Artefakte tauchen AUCH ohne Widget-Host-Faehigkeit auf (Stufe-0-Text) | P1 | gruen | `04-mcp-und-widgets.md` |
| MCP-16 | Parallele /mcp-Requests zweier Tenants: kein Sprach-Leak (Nebenlaeufigkeits-Waechter) | P2 | gruen | `04-mcp-und-widgets.md` |
| LAW-14 | erase-tenant.js verlangt tenantId UND --confirm (fail-closed CLI-Gate) | P1 | gruen | `09-recht-und-compliance.md` |
| LAW-15 | Retention-Default 30 Tage / Diagnostic-Retention 7 Tage, fail-closed bei 0 | P1 | gruen | `09-recht-und-compliance.md` |
| LAW-18 | DEFAULT_COUNTRY/DEFAULT_LANGUAGE-Fallback bei komplett fehlgeschlagener Geo-Ermittlung | P1 | gruen | `09-recht-und-compliance.md` |
| LAW-22 | Race: gleichzeitiges Onboarding zweier US-Interessenten liefert je isoliert DE-Sprache (keine gegenseitige Beeinflussung) | P2 | unbekannt | `09-recht-und-compliance.md` |
| FMT-23 | firstNameOf() mit CJK-Namen ohne Leerzeichen liefert den ganzen String | P2 | unbekannt | `10-zeit-format-daten.md` |
| FMT-24 | escapeXml() laesst CJK-Zeichen im TeXML-Dokument unveraendert durch | P2 | unbekannt | `10-zeit-format-daten.md` |
| FMT-27 | Mitigation-Pfad: number.language="en" explizit gesetzt uebersteuert tenant.defaultLanguage="de" fuer US-Nummer | P1 | gruen | `10-zeit-format-daten.md` |
| FMT-30 | Spend-Monat-Achse bleibt UTC-verankert (Regressionsschutz, Positivbeispiel) | P2 | gruen | `10-zeit-format-daten.md` |
| GAP-26 | Ein am Dauer-Cap gestorbener Anruf ist maschinenlesbar als solcher erkennbar | P1 | rot | `11-luecken-und-e2e.md` |
| GAP-31 | Jedes Locale-Feld hat einen Produktionskonsumenten | P1 | rot | `11-luecken-und-e2e.md` |

