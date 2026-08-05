# Phase GQ-P4 — Stummes Scheitern

**Gate: PASS**
**finalBranch:** `phase/gq-p4-stummes-scheitern`
**headCommit:** `367c124` (Basis `master` @ `4ad1ed3`)

---

## 1. Plan (gekuerzt)

Zwei disjunkte Teile, keine Ueberschneidung, keine Safety-Gate-Aenderung, keine neue Dependency:

- **Teil A** (`src/telnyx-llm-shim.js` + `src/llm.js` + neu `src/telnyx-turn-failures.js`):
  - **A1** — Bezahl-/Guthaben-Fehler erkennen: Telnyx meldet 402, Anthropic verpackt ein leeres Guthaben stattdessen als HTTP 400 mit `error.type: "invalid_request_error"` (identisch zu jedem Formfehler). Neue Funktion `isProviderBillingError(err)` in `llm.js` prueft 402 ODER `err.type === "billing_error"` ODER Textmarker `"credit balance is too low"` im `message` — bewusst eng, ohne Gate-Wirkung (nur Logzeile).
  - **A2** — konsekutiver Fehlschlags-Zaehler je Call (`makeConsecutiveFailureCounter`, Fabrik statt Modul-Zustand, TTL 30 min ohne Timer). Erreicht er `TELNYX_MAX_CONSECUTIVE_FAILED_TURNS` (Default 3, min 2, max 10), spricht der Agent einen Abschiedssatz (`llmGiveUpFarewell`, sprachabhaengig, per Env ueberschreibbar) und beendet ueber denselben `scheduleFarewellHangup`-Pfad wie ein Modell-`end_call` — kein zweiter Terminierungspfad. Jeder erfolgreiche Turn setzt zurueck; ein `modelAnswered`-Riegel schuetzt das T1-Szenario (Turn ok, nur der Schreibweg dahinter kaputt).
  - **A3** — Sendepfad-Messung: welcher der drei Degradations-Zweige lief (`stream_tail` / `fresh_completion` / `wire_lost`) und wie viele Zeichen wirklich rausgingen (bei `wire_lost` NULL) — reiner Messpunkt, der Sendepfad selbst bleibt unangetastet.
  - **A4** — eigener Alarm-Kanal `ALARM_LLM_BILLING` mit fester Handlungsanweisung, PII-frei, bewusst ohne Alarm-SMS.
- **Teil B** (`src/store/state-ops.js` + `src/claude.js`):
  - **B1** — `addActionItem` dedupliziert inhaltsgleiche Nachrichten desselben Calls (normalisierte Gleichheit: Whitespace/Case/Endsatzzeichen, bewusst KEINE Praefix-/Aehnlichkeitsregel — Datenverlust waere schlimmer als ein Duplikat). Rueckgabe neu `{ item, duplicate }`.
  - **B2** — `execTool` gibt bei Dublette `takeMessageDuplicateResult` statt der bisher immer gleichen `takeMessageResult` zurueck, damit das Modell die Wahrheit kennt.

Zusaetzlich: neue Config-Keys `TELNYX_MAX_CONSECUTIVE_FAILED_TURNS` / `TELNYX_FAILED_TURN_FAREWELL_TEXT`, neue Locale-Strings in de/fr/en, `.env.example`, Test-Helper (`BASE_ENV`, `config-namespaces-helper.js`), 17 neue Tests in zwei neuen Dateien.

Ausdruecklich kein Anfassen von `src/routes/voice.js` (dort ist `endCall:true` im Catch bereits Bestand), `isTransient` unveraendert, kein Prompt-Umbau ausser den zwei genannten Strings.

Anlass war Befund B-10 (52-Sekunden-Outbound-Anruf mit 7 aufeinanderfolgenden stillen Turn-Fehlschlaegen bei laufenden Carrier-Minuten) sowie Befund B-6 (acht identische `take_message`-Aufrufe im selben Beleg-Call).

---

## 2. Impl-Zusammenfassung

- **headCommit:** `367c124`, `nodeCheckPass: true`, `testsPass: true`, **3922/3922 gruen**, committed.
- **Neue Dateien:** `src/telnyx-turn-failures.js`, `test/gq-p4-shim-failure-streak.test.js` (9 Tests), `test/gq-p4-action-item-dedup.test.js` (7 Tests).
- **Editierte Dateien:** `.env.example`, `src/claude.js`, `src/config.js`, `src/i18n/locales.js`, `src/i18n/prompts/{de,en,fr}.js`, `src/llm.js`, `src/store/{json,pg,state-ops}.js`, `src/telnyx-llm-shim.js`, `test/config-namespaces-helper.js`, `test/config-shape.test.js`, `test/helpers.js`, `test/store-pg.test.js`, `test/telnyx-llm-shim.test.js`.
- **Smoke:** Server lokal (PORT=3999, SKIP_TWILIO_SIGNATURE_CHECK=true), `/healthz` 200, Config-Kontrakt `maxConsecutiveFailedTurns=3` / `failedTurnFarewellText=""` bestaetigt. Kein echter Anruf gegen `/voice/turn` bzw. den Telnyx-Shim getestet — abgedeckt durch die 17 neuen Unit-Tests + Bestandssuite.

### Deviations
1. `test/config-shape.test.js` musste zusaetzlich zum Plan angepasst werden (JSON.stringify-Snapshot + 13→15-Keys-Test) — mechanisch zwingend fuer gruene Bestandssuite, keine Verhaltensaenderung.
2. `test:gates` zeigte 4 rote Tests (`auth-p9a-cache-headers.test.js` Datei-Fehler, GAP-05/GAP-15 SOLL-rot) — alle vier vorbestehende Launch-Gate-Befunde ohne Bezug zum GQ-P4-Diff, Bilanz-Invariante haelt.

---

## 3. Safety-Urteil

**approved: true** — alle absoluten Regeln eingehalten, keine Blocker.

- Safety-Gates unangetastet: kein Gate-File im Diff (`outbound-gates`/`activation`/`budget-gate`/`signature`/`route-policy`); das neue Lebensende ist **additiv**, laeuft ueber den bestehenden Farewell-Hangup-Pfad; Max-Dauer, Dead-Air-Watchdog, Budget-Kill bleiben unveraendert und liegen weiterhin vor dem Turn.
- Kein Fail-open: Zaehler erhoeht nur bei echtem `agentTurn`-Wurf (`modelAnswered`-Riegel), jeder Erfolg loescht ihn. Adversarial gegen GQ-P1-Supersede geprueft: abortSignal geht nicht ans SDK, ein verdraengter Turn kehrt regulaer zurueck und loescht den Zaehler — ein B-1-Doppel-Turn kann kein gesundes Gespraech beenden.
- Offenlegung: 0 Treffer auf `disclosure` im `claude.js`/`bridge.js`-Diff.
- Auth fail-closed: kein neuer Endpunkt, keine Route im Diff.
- Secrets/PII: neue Logkanaele (`ALARM_LLM_BILLING`, `degraded`) tragen nur callId/turnSeq/Enum/Zaehler/Booleans + festen Text, eigener Sentinel-Test gruen.
- Scope: keine neue Dependency, kein Test geloescht (nur umbenannt/Assert getauscht).
- Unabhaengige Laeufe des Reviewers: 3922/3922 (JSON-Store), 496/496 (PG-Backend), neue Dateien standalone gruen, keine Flakes.

**Verdict:** PASS mit Auflagen (nicht blockierend fuer den Merge, aber vor Merge einzusammeln):
1. `test/gq-p4-shim-failure-streak.test.js:157` enthaelt den **einzigen** `eslint-disable`-Marker im gesamten `src/`+`test/` — verstoesst gegen das CLAUDE.md-Verbot neuer abgeschalteter Sicherungen und ist zusaetzlich wirkungslos (`no-await-in-loop` ist in `eslint.config.js` gar nicht aktiviert).
2. `render.yaml` wurde nicht um die zwei neuen Env-Keys ergaenzt (Vorgaengerphasen GQ-P1/P3 hatten ihre Keys dort nachgetragen) — keine Funktionswirkung (Fallbacks greifen), aber Bruch der dokumentierten Konvention.

Weitere Concerns (nicht blockierend, dokumentiert): Off-by-one im `.env.example`-Wortlaut ("unmittelbar nacheinander scheitern" vs. tatsaechlich `>=`-Vergleich, toleriert de facto zwei); kein vollstaendiger Aus-Schalter mehr moeglich (min 2 erzwungen — bewusst sicherheits-positiv, da die Budget-Engine ohnehin schon beim ersten Fehler auflegt); `providerStatusOf` exportiert ohne externen Konsumenten; Dedup wirkt auch auf den Summary-Pfad (konsequent, aber ueber den Werkzeugpfad hinaus); `wire_lost`+`giveUp` plant Sprechdauer eines nie gesendeten Satzes (Kosten-minor); ein Unit-Test nutzt `maxConsecutiveFailedTurns:1`, was in Prod durch `min:2` unerreichbar ist; `test:gates` blieb wegen eines umgebungsbedingten Haengers auf `auth-p9a-cache-headers.test.js` offen (isoliert 5/5 gruen, als Umgebungsproblem nachgewiesen).

---

## 4. Clean-Code-Audit (S1-S4)

**S1: []** — keine Blocker.
**S2: []** — keine Blocker.
**S3: []**
**S4: []**

**blocker: false** — **verdict: PASS**.

Wesentliche Punkte:
- G5 (eine Quelle) vorbildlich: `vendorStatusOf` aus dem Shim entfernt, als `providerStatusOf`/`isProviderBillingError` nach `llm.js` verschoben, dort auch die Klassifikation.
- Fabrik statt Modul-Zustand (P15) konsequent uebernommen (`makeConsecutiveFailureCounter`), analog `makeTurnTextProbe`/`makeInFlightTurnRegistry`.
- T1-Sonderfall (Fehler aus `writeCompletion` nach erfolgreichem `agentTurn`) bewusst nicht in den Zaehler eingespeist (`modelAnswered`-Flag), mit explizitem Gegenbeweis-Test.
- Abschiedspfad kapert keinen neuen Terminierungsmechanismus, sondern den bestehenden Watchdog/Schritt-8-Pfad — Notaus-Pfade bleiben unberuehrt, in Code und Test belegt.
- Boundary-/Gegenbeweis-Tests vollstaendig (leer/null/undefined, verschiedene vs. gleiche Nachrichten, ein Ausrutscher vs. N in Folge).
- Rueckgabewert-Aenderung von `addActionItem` (Objekt statt Item) konsistent an allen Aufrufstellen nachgezogen (`json.js`, `pg.js`, `claude.js`, `store-pg.test.js`), inkl. `execTool`, das sowohl von der Budget-Engine als auch ueber `bridge.js` von der Realtime-Engine genutzt wird.
- PII-Sorgfalt: neue Logkanaele tragen nie Wortlaut/Rufnummer/Secret, eigener gruener Test.
- Zwei fremde Testdateien (`tenant-erasure-pg.test.js`, `store-pg-multitenant.test.js`) rufen `addActionItem` weiter ohne Destrukturierung — keine Regression, nur ausserhalb des Phasen-Scopes.

**topTodos (optional, kein Muss):** `isProviderBillingError`/`providerStatusOf` in `llm.js` koennten einen eigenen Unit-Test bekommen statt nur indirekt ueber den Shim getestet zu werden.

---

## 5. Fix-Runden

Keine — der finale Review-Stand ist der erste und einzige durchlaufene Zyklus in dieser Uebergabe; es liegen keine FIXES-Daten vor (Abschnitt `=== FIXES ===` der Quelle ist leer). Die beiden Safety-Auflagen (eslint-disable entfernen, `render.yaml` nachtragen) sind vor dem Merge noch einzusammeln, nicht als bereits erfolgte Fix-Runde zu verstehen.
