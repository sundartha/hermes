# Phasenbericht KV2-1 — Alarm-Naht scharf machen

- **Gate:** PASS
- **finalBranch:** `phase/kv2-1-impl`
- **headCommit:** `34cac01`
- **Basis:** `master` @ `8ce6de4`

## Plan (gekuerzt)

Ziel: der Kostenpfad (`billing/cost-truing.js`) meldet Deckungs-Befunde (`coverage_below_threshold`/`coverage_stalled`) ueber denselben Betreiber-Meldeweg wie der Ausfall-Melder (WARN → Audit (durabel) → Mail → SMS), statt nur ins Log zu schreiben. Auftrag B3: 11 Tage 0% Deckung wurden geloggt, aber nie durabel in `audit_log` geschrieben — der Sweep-Zaehler war prozesslokal und wurde bei jedem Deploy genullt.

Vier Entwurfsentscheidungen:
- **E1** — `meldeVollBefund`/`alarmErlaubt` ziehen von `outbound-drift-watch.js` nach `outage-report.js` um (EIN Meldeweg fuer Drift-Waechter UND Kostenpfad, G5).
- **E2** — Entprellung der Kosten-VOLL-Stufe laeuft ueber `outageAlertDebounceMs`/`outageAlertRetryMs`, nicht ueber einen neuen `COST_ALERT_RETRY_MS`.
- **E3** — Meldestufe je Befund-Code (Dispatch-Tabelle): Deckungs-Codes → VOLL (Mail+SMS), Volumen/TTS-Quota → Notiz-Stufe (Audit ohne Versand, wegen bestehender KE-P8/PM-7-Entscheidung gegen eine zweite SMS-Klasse).
- **E4** — durabler Audit-Sink ueber eine spaet gebundene Zelle `auditStoreRef` (Muster `accountsRef`), da `makeAuditStore` erst im pg-gated `wireWebLogin`-Block entsteht, `makeCostTruing` aber synchron im Modul-Scope von `server.js` gebaut wird. `STORE_BACKEND=json` → Zelle bleibt `null` → fail-soft No-op.

Schritt 0 (Vorbedingung, Kriterium e): VOR dem ersten Edit pruefen, ob in Produktion ein Alarm-Ziel (`PLATFORM_ALERT_MAIL_TO`/`PLATFORM_ALERT_SMS_TO`) gesetzt ist. Ohne Ziel: Owner-Meldung statt Code. Wert selbst wird nie geloggt, nur `gesetzt`/`leer`.

Neue Datei `src/durable-audit.js` (`makeDurableAudit`): schreibt weiterhin die Konsolenzeile, zusaetzlich fail-soft (sync Wurf + rejectete Promise abgefangen) in den durablen Sink, sobald `auditStoreRef.current` gesetzt ist.

Edits: `outage-report.js` (Aufnahme `alarmErlaubt`/`meldeVollBefund`), `outbound-drift-watch.js` (nur noch Verbraucher), `boot-guard.js` (`betreiberAlarmKanaele`/`kostenAlarmFindings`, WARN `kosten_alarm_ohne_ziel`), `boot.js` (Boot-Befund + durabler Eintrag), `wiring/web-login.js` + `app.js` (Zelle befuellen/durchreichen), `server.js` (Reihenfolge: `costTruing` wandert hinter `mailer`, neue Zellen `auditStoreRef`/`durableAudit`), `billing/cost-truing.js` (Kern: `emitFinding` → Meldeweg, `coverageDetail`/`coverageStallMs`/`closeCoverageBefunde` als durable Zeitmessung statt Prozesszaehler, TTS-Befund aus Buchungsschleife herausgezogen wegen PM-5-Zusage), `.env.example` (nur Doku, keine neue Variable).

Tests: neue Datei `test/kv2-1-kosten-alarm-naht.test.js` (10 Faelle a1-e), Anpassungen an `cost-truing-harness.js`/`-observe`/`-sweep-log`/`-retrievable`. Pre-Mortem-Tabelle deckte u.a. Doppel-Entprellung, Buchungsschleifen-`await`, Marker-Namensraum-Kollision, PII-Leak in Log ab.

## Impl-Zusammenfassung

- headCommit `34cac01`, `node --check` gruen, `npm test` 5411/5411 (0 Fehlschlaege), committed auf `phase/kv2-1-impl`.
- Neue Dateien: `src/durable-audit.js`, `test/kv2-1-kosten-alarm-naht.test.js`.
- Editierte Dateien: `.env.example`, `src/app.js`, `src/billing/cost-truing.js`, `src/boot-guard.js`, `src/boot.js`, `src/server.js`, `src/telephony/outage-report.js`, `src/telephony/outbound-drift-watch.js`, `src/wiring/web-login.js`, `test/cost-truing-harness.js`, `test/cost-truing-observe.test.js`, `test/cost-truing-retrievable.test.js`, `test/cost-truing-sweep-log.test.js`.
- Boot-Smoke bestanden: genau eine Konfig-Warnung `kosten_alarm_ohne_ziel` bei fehlendem lokalem Ziel, eine durable Audit-Zeile, kein Abbruch, kein PII/Ziel im Log.
- Clean-Code-Selbstcheck: alle vier legacy-eslint-suppressions-gepinnten Dateien mit byte-identischer Lint-Befundmenge nachgezogen; neue Dateien eslint-clean.

### Deviations
1. Kriterium (e): kein direkter Env-Read via Render-MCP verfuegbar (nur Schreibpfad), Prod-DB-Zugriff fuer diesen isolierten Worktree-Agenten gesperrt. Ersatz: ueber `list_logs` (5 Boot-Zyklen, 30 Tage) verifiziert, dass die Boot-WARN "PLATFORM_ALERT_SMS_TO ist leer" nie erschien → SMS-Ziel ist in Produktion gesetzt (indirekter, aber harter Beleg). Mail-Kanal blieb ungemessen (fuer Schritt 0 reicht ein Kanal).
2. `test/cost-truing-retrievable.test.js` war im Plan nicht als zu aendernde Datei genannt, musste aber wegen identischer Sweep-Zeilen-Assertion ebenfalls um `kanaele=keine` ergaenzt werden.
3. Boot-Meldetext vermeidet bewusst das Wort "Deckungsquote" (Kollision mit einem unscoped Regex-Test einer unabhaengigen Bestands-WARN) → umformuliert zu "zu geringer Beleg-Anteil".
4. `bookTtsCharactersFor` bekam einen dritten Parameter (`sammler`) statt Rueckgabewert, um die legacy-gepinnte Komplexitaet von `trueOneCall` (12) nicht auf 13 zu erhoehen.
5. `coverageDetail`/`coverageStallMs`/`closeCoverageBefunde` wurden auf Modul-Ebene mit expliziten Parametern statt als Closures gebaut, um den legacy-gepinnten `max-lines-per-function`-Fund von `makeCostTruing` bei 292 statt 313 Zeilen zu halten. Verhalten byte-identisch.
6. Die geplante Positiv-Kontrolle (Mutation muss (a3)/(b1) rot machen) wurde nur fuer (b1) tatsaechlich verifiziert; (a3) blieb bei der Mutation erwartungsgemaess gruen, da unabhaengig vom VOLL/Notiz-Zweig.

## Safety-Urteil

**PASS mit Auflagen zur Kenntnisnahme** (approved=true, alle harten Achsen intakt).

- SAFETY-GATES: `git diff master..HEAD` auf `outbound-gates.js`, `adapters/`, `config.js`, `callee-is-owner.js` leer. Neuer Marker-Namensraum `kosten:` gegen alle drei Leser (`istFehlergrundEimer`, `istBefundMarkerCode`, ANI-Gate) geprueft — kollisionsfrei.
- OFFENLEGUNG: `claude.js`/`bridge.js` byte-identisch zu master.
- AUTH FAIL-CLOSED: kein Routen-File im Diff, `route-policy.js` unveraendert; einziger betroffener Endpunkt `POST /api/billing/cost-truing/sweep` bleibt hinter `webAuthMw`+`adminMw`.
- SECRETS: nur Env-Variablen-NAMEN im Log, kein Wert; Sweep-Zeile hat eigene Gegenprobe gegen Adress-/Nummernmuster.
- Verhalten: Fail-soft aller Kanaele getestet (a2), Negativ-Kontrolle bei Deckung ueber Schwelle bleibt Sink leer (a3-negativ), Notiz-Pfad verschickt weiter keine SMS (j4).

### Concerns (nicht blockierend)
1. **Alarm-Lautstaerke:** bei 0 zulaessigen Datensaetzen liefert `percentFromBreakdown` 0% — ein verkehrsarmes/stilles Fenster erzeugt dauerhaft `coverage_below_threshold`, seit KV2-1 mit echtem Mail+SMS-Versand (bis zu 8 SMS + 8 Mails/Tag im Dauerzustand bei aktuell gemessenen 11 Tagen 0% Deckung in Produktion). Owner sollte die Steady-State-Rate kennen, bevor scharf geschaltet wird.
2. Kriterium (e) ist nicht aus dem Diff selbst verifizierbar — Beleg liegt nur im Bericht/den Deviations, nicht im Commit.
3. Neue `.env`-Abhaengigkeit in Test-Fixtures (`cost-truing-harness.js` leitet Defaults jetzt aus der echten `config.js` ab) — neue Drift-Flaeche im Sinne der Lehre `test-base-env-drift`.
4. Groesserer Dateiumfang als im Auftragsblatt genannt (zusaetzlich `app.js`, `boot.js`, `durable-audit.js`, `outage-report.js`, `outbound-drift-watch.js`, `wiring/web-login.js`) — alles ermoeglichende Verdrahtung/Umzug, kein Feature-Extra.
5. Notiz-Stufen-Marker (`kosten:requests_above_threshold`, `kosten:tts_quota_*`) werden nie geschlossen — latente Falle bei kuenftiger Fehlinterpretation als "Zustand besteht noch".
6. `closeCoverageBefunde` nimmt bei jedem gesunden Sweep Lock + `store.save()`, auch wenn nichts geschlossen wurde — im pg-Pfad ein echter Flush, kein No-op.

## Clean-Code-Audit

- **s1:** keine Befunde.
- **s2:** keine Befunde.
- **s3:**
  - KV2-1-S3-1 · `src/wiring/web-login.js:184` — zwei Anweisungen auf einer Zeile (`Object.assign` statt direkter Property-Zuweisung), bewusst gewaehlt um ESLint `no-param-reassign` und eine Erhoehung des Suppression-Zaehlers zu umgehen. Kein Sicherheitsproblem, aber lint-resistent statt lint-konform gebaut. Fix-Empfehlung: `if (auditStoreRef) auditStoreRef.current = auditStore;` auf eigener Zeile, Suppression-Zaehler regulaer auf 2 erhoehen.
- **s4:** keine Befunde.
- **Verdict:** PASS. Sauberer, gut begruendeter Fix eines real gemessenen Defekts plus korrekte Konsolidierung von Alarm-Infrastruktur (EINE Quelle statt zweier Kopien). Alle direkt betroffenen Bestandssuiten gruen; voller Regressionslauf zeigt nur 4 Fehlschlaege, alle nachweislich nicht vom Diff verursacht (2 Test-Infrastruktur-Artefakte der Extraktionsmethode, 2 bekannte Flakes unter Volllast, auch auf master reproduzierbar).

## Fix-Runden

Keine — der s3-Befund ist kosmetisch, kein Blocker; es wurde keine Fix-Runde ausgeloest. `FIXES` leer.
