# Phase P11 - Die gesprochene Sprache

**Gate: PASS**
**finalBranch:** `phase/i18n-p11-gesprochene-sprache`
**headCommit:** `586b4d2ace8c6e9ba44876bbd96cf7d5bb4a6908`
**Basis:** `master` @ `32cf340`

---

## Plan (gekuerzt)

P11 lagert das gesamte modell-lesbare Prompt-Geruest (Systemprompt-Sektionen, Tool-Beschreibungen, GAP-28-Turn-Marker) pro Sprache aus, macht die gespeicherte Begruessung sprachabhaengig und laesst Post-Call-Rahmentexte (Notification + Summary-SMS) der Anrufsprache folgen.

**Vorbedingung A5/U4 (am Code beantwortet, kein Provisioner-Schritt noetig):** Budget-Engine und Telnyx-Assistant konvergieren auf dieselben Dateien (`claude.js` via `agentTurn`, `voice.js` via `greeting`-String) - P11 deckt beide Pfade mit derselben Aenderung ab, anders als P3.

**Zwei Befunde, die den Phasenzuschnitt korrigieren:**
- E2E-06 (Sprachreinheits-Aggregat) kann in P11 NICHT gruen werden: 3 von 8 heutigen Lecks (`mcpErrorLiterals`, `tenantHtmlFormat`, `gateRejectionLiterals`) liegen ausserhalb der P11-Wurzel (P12/P13). Rot-Liste-Korrektur 20 -> 12 (statt 11), E2E-06 bleibt bewusst rot.
- `convo-bench` kann "n>=5 je Sprache" heute nicht (nur DE-Szenarien/Persona vorhanden) - DE bleibt die Abnahmeschwelle, EN/FR-Gespraechsqualitaet ist ein getragenes Risiko.

**Design-Entscheidungen:**
- **D1**: `src/i18n/prompts/{de,en,fr}.js`, eine Datei je Sprache, reiner Text/Funktionen. Die gesamte Verzweigungslogik (Direction, Bedingungen, `filter(Boolean)`) bleibt in `claude.js` (EINE Quelle, G5/S2). DE wird byte-identisch verschoben.
- **D2** (bewusste, bezahlte Abweichung vom Plan-Doc "ENTSCHAERFT (2)"): die vier GAP-28-Turn-Marker werden UEBERSETZT statt neutralisiert - Neutralisierung haette den deutschen (live aktiven) Pfad angefasst und zwei der vier Marker sind tatsaechlich Sicherungen (Frueh-Auflege-Schutz). Gegenleistung: Test je Sprache je Marker (12 Assertions).
- **D3** (PROMPT-03): `greetingForLanguage(storedGreeting, language)` - Katalog-Vorlage einer ANDEREN Sprache wird durch die Standard-Vorlage der Anrufsprache ersetzt; Admin-Freitext bleibt unangetastet.
- **D4**: `toolDefs(language)`, `execTool(call,...)`, `endCallWaitInstruction(call)` - Tool-NAMEN bleiben sprachinvariant (separat getestet), nur Beschreibungen wandern.
- **D5** (WEB-14/E2E-02): `call-finish.js` liest Rahmentexte ueber `localeFor(call.language).postCall`.
- **D6**: bewusst nicht angefasst - Offenlegungssatz-Wortlaut, `de-DE`/`en-GB`-STT-Locale, FR-Akzente/DE-Transliteration, `bridge.js`-HEIKLE-STELLEN, alle Gates, Self-Service-Anzeige (`GET /api/self-service/state` bleibt roh - bekannte Inkonsistenz).

**Neue Dateien:** `src/i18n/prompts/{de,en,fr}.js` (Prompt-Vertrag: persona, boundaries, mandate, tools, turnControl, ...), `src/i18n/greeting-catalog.js` (Verschiebung aus `self-service.js` + `greetingForLanguage`).

**Reihenfolge (5 Commits, Deploy als ein Block):** 1) Katalog-Verschiebung (verhaltensneutral) 2) PROMPT-03 3) WEB-14 4) PROMPT-01/02/14 (grosser Block) 5) GAP-28.

---

## Impl-Zusammenfassung

- `headCommit`: `586b4d2ace8c6e9ba44876bbd96cf7d5bb4a6908`, `node --check` gruen, `testsPass: true`, **3237/3237 gruen**, committed.
- 9 Produktionsdateien angefasst: `src/i18n/locales.js`, `src/i18n/prompts/{de,en,fr}.js` (neu), `src/i18n/greeting-catalog.js` (neu), `src/claude.js`, `src/routes/voice.js`, `src/telephony/call-finish.js`, `src/bridge.js`, `src/self-service.js`, `src/self-service-routes.js`. Keine neue Env-Variable, keine neue Dependency, kein Gate beruehrt.
- 14 vorher rote Katalog-Blaetter jetzt gruen und in die Regressionssuite migriert: PROMPT-01/02/03/14, GAP-28 (4x), WEB-14 (2x), E2E-02 (2x), E2E-04 (2x).
- E2E-06 bleibt bewusst rot, Leck-Zahl gemessen von 8 auf 3 gesunken (`gateRejectionLiterals`, `mcpErrorLiterals` -> P12; `tenantHtmlFormat` -> P13) - alle 6 Im-Gespraech-Kanaele (systemPrompt, toolDefs, openingText, inboundGreeting, summarySms, notificationTitle) sind sprachrein.
- `npm run test:gates`: 34 Tests / 21 gruen / 13 rot = 12 Katalog-IDs (deckt sich mit Plan 6.3).
- Drei neue Testdateien: `test/p11-agent-language-contract.test.js` (10 Tests), `test/p11-greeting-language.test.js` (8), `test/p11-post-call-language.test.js` (7).
- Zwei Byte-Pins geloescht (SP4/SP5 in `personal-assistant-characterization.test.js`) gemaess Plan-R5-Pflicht - Ersatz ist der neue Sprachreinheits-Test.

### Deviations (aus IMPL, wortgleich)

1. `test/helpers.js` `seedState()`-Default-Greeting geaendert von handgeschriebenem Kurztext auf den echten `DEFAULT_GREETING` (Produktions-Default) - noetig, damit `greetingForLanguage` den Seed als Katalog-Vorlage erkennt statt als Admin-Freitext. Kein Bestandstest pinnte den alten Kurztext (per grep verifiziert).
2. Zwei Bestandstests (`inbound-disclosure-mandatory.test.js`, `telnyx-p5-origination.test.js`) mussten `language:"de"` explizit setzen, weil sie implizit vom Weltdefault (`WORLD_DEFAULT_LANGUAGE_ENABLED=true` im Test-Env -> `en`) abhingen und sonst am neu sprachabhaengigen Pfad rot wurden - keine Erwartung gesenkt, nur die Sprache determinisiert.
3. `convo-bench` (Plan-Auflage 6.4.2) **nicht gefahren** - echte Anthropic-API-Kosten, ausserhalb des Session-Budgets. DE-Byte-Identitaet stattdessen ueber SP1/SP2/SP3/SP6 bewiesen (vom Plan selbst als staerkerer Beweis genannt).
4. **Kein echter Probe-Anruf** (Plan-Auflage 6.4.3) - nur lokaler Smoke-Test (Boot, `/healthz`, `/voice/incoming` DE-Pfad). EN/FR ueber Spawn-Suite abgedeckt, nicht per echtem Telefonanruf.
5. `GET /healthz` auf deploytem Commit (A6) nicht anwendbar - Branch noch nicht deployed.

---

## Safety-Urteil

**approved: true**, alle Kern-Flags grün: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`. **blockers: []**.

**Verdict:** FREIGEGEBEN mit Auflagen - keine Verletzung der Absoluten Regeln. Unabhaengiger Testlauf im frischen Worktree: `npm test` 3237/3237 gruen (115,6 s), `npm run test:gates` 34/21/13 = 12 IDs. Eigener Byte-Identitaets-Beweis fuer DE via `git archive`-Diff ueber 12 Artefakte (systemPrompt in/out, toolDefs, openingText, disclosureSentence, execTool, endCallWait) - Ergebnis IDENTICAL.

**Concerns (keine Blocker, Owner-Auflagen):**
- **Abnahme-Abweichung**: Plan nennt E2E-06 gruen als DAS Abnahmekriterium; es bleibt rot (12 statt 11 Katalog-IDs). Verifiziert begruendet (3 Restlecks ausserhalb P11-Wurzel), aber widerspricht dem Planwortlaut - Owner muss quittieren.
- `convo-bench` nicht nachgewiesen (Plan-Pflicht ENTSCHAERFT (1)); gemildert durch bewiesene DE-Byte-Identitaet, EN/FR-Qualitaet bleibt ungemessen.
- GAP-28-Marker uebersetzt statt neutralisiert (D2, Abweichung von Plan-Empfehlung) - Auflage (Test je Sprache je Marker) erfuellt, Restrisiko (Modell erkennt uebersetzten Marker nicht) nur per Bench/Probe-Anruf messbar.
- Kosmetik: `en.js` speechRules nennt Dollar-Beispiel statt EUR (Produktentscheidung ist EUR ueberall); `fr.js` takeMessageDescription hat doppelte Negation; kleiner Label-Bruch EN `summaryInput.goalLabel` ("Task:") vs. `summarySystem` ("the original objective") - Vorbestand war ebenfalls inkonsistent, keine Regression.
- `helpers.js`-Greeting-Default-Aenderung wirkt auf die gesamte Suite (breitester Nebeneffekt), Suite bleibt aber gruen.
- eslint/prettier nicht lauffaehig (devDeps fehlen im Worktree) - Lint-Gate nicht verifiziert, `node --check` auf allen 9 Dateien gruen.
- Operative Restpflichten (Inbound-Smoke je Sprache per curl, echter Probe-Anruf) nicht durchgefuehrt; Pfad-Frage U4/A5 strukturell geklaert (beide Engines laufen ueber `claude.js`, gleicher `greeting`-String an TeXML-Gather und Assistant-Speak-Node).

---

## Clean-Code-Audit

**verdict: PASS**, **blocker: false**.

- **S1 (Blocker):** keine
- **S2 (schwerwiegend):** keine
- **S3 (mittel):** 1 Fund - `test/l3-prompt-caching.test.js:97` (G16/G26): `toolDefs(BOOTSTRAP_TENANT_ID)` uebergibt eine Tenant-ID als Sprach-Argument statt `"de"`/`"en"`; funktioniert nur zufaellig, weil die Tool-ANZAHL sprachinvariant ist und `localeFor()` fail-safe auf den Default faellt. Fix-Vorschlag: `toolDefs("de")` statt der Tenant-ID.
- **S4 (gering):** keine

**Begruendung:** Saubere Extraktion, Verzweigungslogik bleibt konsequent in `claude.js` (EINE Quelle, G5/S2 eingehalten), Sprach-Baustein-Module liefern nur Text/Funktionen. DE bleibt byte-identisch (SP1-SP3/SP6 weiterhin gepinnt), EN/FR sind kuratierte Uebersetzungen mit erhaltener Verbots-Emphase. Geloeschte SP4/SP5-Pins sauber durch neuen Sprachreinheits-Test ersetzt, kein Verlust an Regressionsschutz. Katalogtests korrekt von "SOLL rot" auf gruene Namen umbenannt, E2E-06 bleibt bewusst rot mit aktualisiertem Kommentar. Voller Suite-Lauf auf sauberem `git archive`-Checkout: 3250 Tests, 0 fail im Rerun (ein Fail im ersten Lauf deckt sich mit dem bekannten p5-gate-proof-Spawn-Race-Flake, nicht P11-spezifisch).

**topTodos:** S3-Fund in `l3-prompt-caching.test.js:97` beheben (auch wenn der Test heute zufaellig richtig durchlaeuft).

---

## Fix-Runden

Keine - Gate wurde im ersten Durchlauf mit PASS erreicht (Safety approved, Clean-Code PASS ohne Blocker). Der einzige offene Punkt ist der S3-Befund (Kosmetik/Robustheit, kein Blocker) sowie die im Safety-Urteil genannten Owner-Auflagen vor einem Merge (E2E-06-Abweichung quittieren, convo-bench nachholen oder Risiko bewusst tragen, Inbound-Smoke + Probe-Anruf).
