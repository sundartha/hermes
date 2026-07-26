# Phasenreport P15 — Sprachreinheits-Rest (E2E-06)

**Gate: PASS** | finalBranch: `phase/i18n-p15-sprachreinheit` | headCommit: `b540ac591781a5deb92bf8a56faef1624f6414ee`

## Ziel

Die drei verbleibenden Deutsch-Lecks des Sprachreinheits-Katalogtests E2E-06 schliessen, ohne Safety-Gates, Offenlegungssatz oder Gate-Reihenfolge/-Gruende zu beruehren: T1 (Datums-/Zeitformat im Tenant-Dashboard), T2 (Ablehnungstexte der Outbound-Gate-Kette), T3a/T3b (MCP-Leer-/Statustexte und Tool-/Feld-Beschreibungen, letztere gemaess O14 einsprachig Englisch fuer das Client-Modell). Zusaetzlich T4: Korrektur des Testkanals selbst (R5, s.u.).

## Plan (gekuerzt)

- **Kernregel:** genau EIN Sprach-Resolver bleibt bestehen (`views.tenantLanguage` -> `resolveCallLanguage`), keine zweite Aufloesung. Neue Store-Fassaden-Methode `store.tenantLanguage(tenantId)` (json.js/pg.js, Muster `resolveCallLanguage`) liefert die Sprache **erst im Moment einer feststehenden Gate-Ablehnung** — kein Gate-Praedikat liest die Sprache, der erlaubte Anruf zahlt keinen Lookup.
- **T2:** neues Bundle `src/i18n/gate-texts.js` (13 Schluessel, de/en/fr, DE byte-identisch zum Bestand, ASCII-Transliteration wie `mcp-texts.js`), eingehaengt als `LOCALES.<lang>.gates`. `outbound-gates.js` ersetzt jedes `message:`-Literal durch `gateTexts(tenantId).<key>`. Unveraendert: Gate-Reihenfolge, Bedingungen, Schwellen, `grund`-Schluessel, HTTP-Status, Audit-Details.
- **T3a:** `emptyCalls`, `emptyCalendar`, `callStillRunning` sowie die Feldnamen des `get_agent_status`-Textblocks wandern nach `mcp-texts.js`, je Sprache; DE-Ausgabe byte-identisch gepinnt.
- **T3b (O14):** alle Tool-/Feld-Beschreibungen in `mcp-tools.js` einsprachig Englisch (Modellsprache != Nutzersprache), Emphase-Marker (Grossschreibung, Negativ-Beispiele) 1:1 positionsgleich uebersetzt, mit Kopfkommentar zur Systemgrenze.
- **T1:** `/api/self-service/state` liefert zusaetzlich `dateLocale` aus derselben Aufloesung wie `language`; `tenant.html` konsumiert es fail-soft ueber eine Schreibstelle (`setDateLocale`), kein `navigator.language`.
- **T4 (Testkanal):** Stopwortliste nach `test/helpers.js` zentralisieren; Kanal `mcpErrorLiterals` in E2E-06 auf ausgelieferten (tenant-sichtbaren) Text statt der ganzen Quelldatei eingrenzen; Test per Umbenennung (A3) in den Regressionslauf ueberfuehren, nicht loeschen.
- Bewusst nicht gefixt (explizit im Plan benannt): `E164_FORMAT_ERROR` bleibt deutsch (400 vor Tenant-Aufloesung), die `error:`-Literale in Gate-Bodies (`outbound_frozen`, `tenant_reject`, `owner_name`, `resolve_outbound`, `minutes`, `reserve_error`), drei weitere deutsche mcp-tools.js-Texte ausserhalb der T3a-Liste, `Intl.NumberFormat("de-DE")` in `tenant.html` (Geld-Achse), `public/calls.html`/`calendar.html`.

## Implementierungs-Zusammenfassung

- `nodeCheckPass: true`, `testsPass: true`, 3300/3300/0 (Regressionslauf), `test:gates` = 3 rot (`GAP-05`, `GAP-15`×2) — E2E-06 taucht nicht mehr auf, Abnahmekriterium erfuellt.
- Neue Dateien: `src/i18n/gate-texts.js`, `test/p15-gate-denial-language.test.js` (16 Tests, alle Gate-Gruende × 3 Sprachen), `test/p15-mcp-tool-descriptions-en.test.js` (5 Tests, Emphase/Negativbeispiele/Stopwortliste gepinnt), `test/p15-tenant-html-date-locale.test.js` (3 Tests).
- Geaenderte Kern-Dateien: `src/i18n/locales.js`, `src/i18n/mcp-texts.js`, `src/mcp-tools.js`, `src/self-service-routes.js`, `src/store.js`, `src/store/json.js`, `src/store/pg.js`, `src/store/defaults.js`, `src/telephony/outbound-gates.js`, `public/tenant.html`.
- 20 Testdateien mechanisch nachgezogen (deutsche Regex-Anker -> englischer Weltdefault-Wortlaut bzw. `tenantLanguage: () => "de"` explizit in Fake-Stores) — jeweils erst rot gesehen, Ursache benannt (Weltdefault=en seit P10), keine Assertion abgeschwaecht.
- Smoke (echter Server-Kindprozess, `MULTI_TENANT=true`): DE-Tenant "Verifikation unzureichend (KYC) ..." / EN-Tenant "Verification insufficient (KYC) ..." bei identischem HTTP 403 und identischer Audit-Zeile `grund=kyc`.

### Deviations

- Basis-Divergenz `18556df` vs. lokaler master-Tip `7c8a329`: Geschwister-Commits mit leerem `diff -- src test public package.json`; auf `7c8a329` implementiert.
- Setup-Fehler (selbstreferenzieller `node_modules`-Symlink) korrigiert, nicht committet.
- Scope-Zusatz gegenueber Spec T3a (bereits im Plan vorgesehen): `"Anruf laeuft noch. ..."` musste zusaetzlich lokalisiert werden, sonst waere Abnahmekriterium #4 (leaks leer) unerreichbar.
- Mehr Bestandstests betroffen als im Plan aufgezaehlt (11 statt 4 Dateien mit Text-Regexen, 3 zusaetzliche Fake-Store-Dateien) — jeweils mit Root-Cause-Nachweis (Weltdefault en), keine Statuscode-/Grund-Aenderung.
- `outbound-reserve-concurrency-http.test.js` (OUT-05, Katalog-Test) tauchte erst im ersten Gates-Lauf als 4. Rot auf — war dieselbe Regex-Klasse, kein Budget-Race; nach Fix wieder 3 Rot wie erwartet.
- Vorbestehender Voll-Last-Flake (spawn-bedingt, in unbeteiligten Dateien, isoliert gruen) dokumentiert, keine Regression.
- **Noch rote/offene Gate-IDs (nach `test:gates`):** `GAP-05` (allow_promotion_codes) und `GAP-15` (Platzhalter-Treffer + EN-Rechtstext) — beide ausserhalb des P15-Scopes, unveraendert gegenueber Vorphasen.

## Safety-Urteil (final)

**approved: true.** Alle Kern-Invarianten geprueft und bestaetigt: Gate-Reihenfolge (17 Glieder), Bedingungen, Schwellen, HTTP-Status und `grund`-Schluessel byte-identisch zu master (maschinell verglichen); 13 DE-Gate-Texte woertlich aus dem Bestand uebernommen; Stopwortliste byte-identisch und jetzt zusaetzlich byte-gepinnt; kein Kanal entfernt, `TOTAL_CHECKED_LABELS` unveraendert (10), `expected: []` steht. Offenlegungssatz, Auth-Flaeche, Secrets, Audio-ueber-MCP, neue Endpunkte/Dependencies/Env-Variablen — alle unberuehrt. `testWeakened: false`.

**Concerns (report-pflichtig, kein Blocker):**
1. Drei tenant-sichtbare deutsche Literale bleiben hart in `src/mcp-tools.js` (Zeilen 158, 688, 691: Summary-Fallback, "Keine offenen Action Items.", Inline-Praefix "(Termin) "). Treffen die Stopwortliste nicht, sind von T3a nicht beauftragt — korrekt im Scope gehalten, aber der Phasenname "Sprachreinheits-REST" ist damit zu grosszuegig.
2. `public/tenant.html:215` formatiert Geldbetraege weiterhin hart per `Intl.NumberFormat("de-DE", ...)`. Der E2E-06-Kanal `tenantHtmlFormat` greift das nicht (Regex verlangt schliessende Klammer direkt hinter dem Locale, das Komma rettet die Stelle) — vorbestehender blinder Fleck, kein Aufweichen. Folge: EN-Dashboard zeigt englisches Datumsformat neben deutscher Waehrungsformatierung.
3. `E164_FORMAT_ERROR` bleibt bewusst in allen Sprachen deutsch; der zugehoerige Test verweist auf einen in der Spec nicht existierenden Abschnitt "6.1" (Doku-Referenz-Drift).
4. Der Land-Gate-Text nennt in allen drei Sprachen den internen Env-Namen `ALLOWED_COUNTRY_CODES`, obwohl ein Kommentar zwei Zeilen darunter genau das verbietet — woertlich aus dem deutschen Bestand uebernommen, jetzt verdreifacht statt bereinigt.
5. Kein `tasks/p15-report.md` auf dem Branch zum Zeitpunkt der Safety-Pruefung — dieser Bericht schliesst die Auflage.

## Clean-Code-Audit

**Verdikt: PASS — keine S1/S2-Befunde.**

- **S1:** keine.
- **S2:** keine.
- **S3** (kosmetisch, keine Handlung noetig): redundante Mehrfach-Erklaerung von `PLATFORM_DENIAL_REASON` in `outbound-gates.js`; `STATIC_DATE_LOCALE` in `tenant.html` benennt nur einen einzelnen Fallback-Wert, Name suggeriert mehr Bedeutung als er traegt.
- **S4:** keine.

Kernpruefung: EIN Sprach-Resolver (kein Duplikat von `resolveCallLanguage`/`localeFor`), `gate-texts.js`/`mcp-texts.js` fuer de/en/fr vollstaendig und testgesichert, Ziffernfreiheit von `platformHalt`/`budgetUnreadable` und Byte-Identitaet von `grund`/`status`/Audit ueber alle drei Sprachen per Test bewiesen (nicht nur behauptet).

## R5-Korrektur am E2E-06-Testkanal (T4) — ausdruecklich als solche benannt

Der Kanal `mcpErrorLiterals` im Testkatalog-Test E2E-06 wurde bisher gegen den **kompletten Quelltext** von `src/mcp-tools.js` gefahren — inklusive der deutschen Kommentarzeilen, die die Repo-Konvention (`.claude/refs`: Kommentare auf Deutsch) ausdruecklich verlangt. Dadurch konnte der Kanal **strukturell nie gruen werden**: jede Konvention-treue Kommentarzeile mit einem Stopwort haette ihn faelschlich rot gefaerbt, unabhaengig vom tatsaechlich an den Tenant ausgelieferten Text.

**Begruendung der Korrektur:** der Kanal soll tenant-sichtbaren, ausgelieferten Text messen — analog zum Nachbarkanal `gateRejectionLiterals`, der gezielt das `message:`-Muster prueft, nicht die ganze Datei. Die Korrektur (`deliveredTextOf`) zieht deshalb genau zwei, jeweils separat abgedeckte Klassen ab, bevor die Stopwortliste angewendet wird:

1. Zeilenkommentare (`^\s*//...`) — Konvention, kein Nutzertext.
2. Die nach O14 bewusst einsprachig englischen Tool-/Feld-Beschreibungen (`description:`, `.describe(...)`) — Modellsprache != Nutzersprache, mit eigenem, schaerferem Waechter `test/p15-mcp-tool-descriptions-en.test.js` gegen **dieselbe** (jetzt in `test/helpers.js` zentralisierte und dort zusaetzlich byte-gepinnte) Stopwortliste.

**Nicht angetastet:** die Stopwortliste selbst (byte-identisch, jetzt zusaetzlich gegen Aufweichung gepinnt), die Kanalzahl (weiterhin 8 Kanaele / `TOTAL_CHECKED_LABELS = 10`), die erwartete leere `leaks`-Liste. Der Test selbst wurde **nicht geloescht**, sondern per Umbenennung (A3-Konvention: Katalog-ID `(ex E2E-06)` ans Namensende statt an den Anfang) in den regulären Regressionslauf (`npm test`) ueberfuehrt.

**Verifikation, dass nichts versteckt wurde:** sowohl die unabhaengige Safety-Pruefung als auch das Clean-Code-Audit haben `deliveredTextOf` selbst nachgebaut und auf `mcp-tools.js` angewandt — der Filter zieht 16.262 Zeichen Kommentare und 6.417 Zeichen O14-Beschreibungen ab; die verbleibenden 109 String-Literale enthalten weiterhin die drei oben unter Safety-Concern 1 gemeldeten deutschen Reste. Das belegt: der Filter versteckt nichts, was der alte (kaputte) Test je erkannt haette — er macht den Kanal lediglich messbar, ohne seine Aussagekraft zu verringern.

**Restrisiko (dokumentiert, bewusst belassen):** `deliveredTextOf` strippt nur Zeilenkommentare, keine nachgestellten Inline-Kommentare am Zeilenende. Aktuell treffen keine der acht vorhandenen Inline-Kommentare die Stopwortliste. Ein kuenftiger nachgestellter deutscher Kommentar mit Stopwort wuerde den Kanal falsch-rot faerben — bewusst in Kauf genommen, weil ein anfuehrungszeichen-bewusstes Parsen echten String-Inhalt korrumpieren koennte; der Fehlerfall waere laut und eindeutig ueber den Assertion-Text diagnostizierbar.

## Fix-Runden

Keine separate Fix-Runde noetig: Safety-Review und Clean-Code-Audit kamen beide direkt zu PASS/FREIGABE ohne Blocker. Die im Safety-Review genannten Auflagen ("vor Merge nachziehen") sind nicht-blockierende Report-Pflichten, mit diesem Dokument erfuellt:
1. Phasenreport geschrieben, R5-Korrektur benannt und begruendet (dieser Abschnitt).
2. Die zwei Residual-Befunde (drei deutsche Rest-Literale in `mcp-tools.js`, hartes `Intl.NumberFormat("de-DE")` in `tenant.html:215`) sind oben unter Safety-Urteil festgehalten.
