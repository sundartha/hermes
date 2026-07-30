# Phase KS-AUF — Detailbericht

**Aufgabe:** SSE-Spike-Schalter (`af4a66e`, AL-P2) ersatzlos aus `master` entfernen.
**Ergebnis:** Gate = **PASS**
**finalBranch:** `phase/ks-auf-spike-entfernen`
**headCommit:** `643f8dce0cf768da32f6c48b9c279d1628e6f263`
**Basis:** `master` = `c83ff73` (Arbeitsbaum deckungsgleich geprüft)

---

## 1. Plan (gekürzt)

Reine Entfernungs-Phase, kein neues Verhalten, keine neuen Tests. Da nach dem Spike-Commit `af4a66e` zwei weitere Phasen (KS-P1b `7fb572a`, KS-P2 `7c720c3`) denselben Shim angefasst hatten, kein `git revert`, sondern gezielte Handarbeit — mit Byte-Identitätsprobe gegen `af4a66e^` bei allen seit dem Spike driftfreien Dateien (gemessen: 5 Stück).

**Geänderte Bereiche (Plan):**
- `src/telnyx-llm-shim.js` (9 Edits): kompletter Spike-Pfad raus (`FIRST_SENTENCE`, `splitAtFirstSentence`, `sseSpikeDelayMsFor`, `spikePauseFor`, `logShimSseSpike`, `sleep`-DI-Parameter, `pause`-Parameter aus `writeCompletion`/`writeStreamingCompletion`); 5 Aufrufstellen zurück auf Vor-Spike-Form; KS-P1b/KS-P2-Hunks bleiben unangetastet.
- `src/config.js` (4 Edits): Env-Keys `sseSpikeDelayMs`/`sseSpikeCallee`, `e164Env`-Validator samt `E164`-Import, `productionFootguns`-Spike-Klausel raus.
- `src/boot.js` (2 Edits): `sseSpikeBannerLine` + Banner-Zeile raus.
- `src/utils/timer.js` (1 Edit): `sleepMs` raus → Ziel byte-identisch zu `af4a66e^`.
- `scripts/telnyx-call-latency.mjs` (7 Edits): Spike-Urteil/-Flag/-Konstanten raus, `parseLatencyArgs` wieder zusammengeführt → byte-identisch zu `af4a66e^`.
- Tests: `test/al-p2-sse-spike.test.js` löschen (17 Tests); `test/telnyx-shim-harness.js`, `test/helpers.js`, `test/config-namespaces-helper.js`, `test/config-shape.test.js`, `test/telnyx-call-latency.test.js` bereinigen.
- Doku/Betrieb: `.env.example`, `render.yaml`, `PLAN-SECURITY.md` (Abschnitt AL-P2-SSESPIKE raus), `tasks/al-testcall-checklist.md` (Schritte 3/4 durch Statuseintrag ersetzt, kein Messergebnis erfunden).

**Explizit nicht angefasst:** Chronik-Dokumente (`tasks/al-p2-report.md`, `al-p2b-report.md`, `al-chain-state.md`, `al-handover-2026-07-29.md`), `PLAN-ASSISTANT-LEAP.md`, `PLAN-KOSTEN-STEUERUNG.md`-Verweise, sowie "Spike" in anderer Bedeutung (`wing-canvas-engine.js`, `design-system/**`).

**Verifikationsplan (§5):** node --check auf 5 Dateien; `npm test` grün, Zahl sinkt um 20; Symbol-Grep über 11 Spike-Begriffe → leer; Byte-Diff gegen `af4a66e^` bei 5 driftfreien Dateien → leer; Kollateralschaden-Check im Shim-Diff → 0 Treffer für spike/pause/sleep/FIRST_SENTENCE außerhalb KS-P1b/KS-P2; Blast-Radius genau 14 (später korrigiert: 15) Pfade; optionaler Smoke-Test.

**Pre-Mortem (4 Risiken benannt):** Antwortpfad kaputt (Gegenmittel: Byte-Probe + unveränderte Shim-Testfamilie), KS-P2/KS-P1b-Hunk versehentlich mitentfernt (Gegenmittel: gezielter Diff-Grep), `e164Env` fehlt später (Gegenmittel: null Aufrufer belegt, `E164` bleibt in `defaults.js`), verwaiste Live-Env-Werte im Render-Dashboard (Gegenmittel: expliziter Übergabepunkt in Checkliste + Bericht).

---

## 2. Implementierungs-Zusammenfassung

Branch `phase/ks-auf-spike-entfernen` auf `master` (`c83ff73`) angelegt, `af4a66e` als Ancestor verifiziert. Ein Commit (`643f8dc`), 15 Pfade, 26 insertions / 664 deletions — die 664 spiegeln exakt die insertions des Spike-Commits.

**Entfernt:**
- Shim: kompletter Spike-Pfad inkl. `sleep`-DI-Parameter; `writeCompletion`/`writeStreamingCompletion` zurück auf synchron; 5 Aufrufstellen zurück auf Vor-Spike-Form.
- config.js: beide Env-Keys, `e164Env` samt `E164`-Import, `productionFootguns`-Klausel.
- boot.js: `sseSpikeBannerLine` + Banner-Zeile.
- utils/timer.js: `sleepMs`.
- Messwerkzeug: Spike-Urteil samt `--spike-delay-ms`-Flag, `AUDIO_FIRST_TOKEN_FIELD`-Alias zurückgebaut (Konsistenz mit Literalen daneben, G11), `parseLatencyArgs` wieder zusammengeführt (S4).
- `.env.example`, `render.yaml`: Env-Dokumentation.
- `PLAN-SECURITY.md`: Abschnitt `AL-P2-SSESPIKE` ersatzlos.
- `tasks/al-testcall-checklist.md`: Schritte 3/4 durch Statuseintrag ersetzt (kein Messergebnis erfunden, offene Owner-Arbeit erhalten: DIDs zurück auf Connection Hermes, Render-Dienst `hermes-spike-al-p2` und Telnyx-App löschen).
- Tests: `test/al-p2-sse-spike.test.js` gelöscht (17 Tests), 3 AL-P2-Tests aus `telnyx-call-latency.test.js`, Spike-Reste in Harness/helpers/config-Fixtures.

**Bewusste Signaturänderung:** `writeCompletion`/`writeStreamingCompletion` sind wieder synchron. `async` existierte ausschließlich wegen `await pause()`; ohne Pause wäre es eine `async`-Funktion ohne einziges `await` (G12) gewesen und hätte alle fünf Aufrufer zu einem sinnlosen `await` gezwungen. Verhaltensidentisch, da der Body mit `pause = null` ohnehin vollständig synchron bis `res.end()` lief.

**Verifikation (deterministisch, nicht behauptet):**
1. `node --check` auf alle 7 geänderten `.js`/`.mjs`-Dateien: sauber.
2. Symbol-Grep über 11 Spike-Symbole in `src/ test/ scripts/ .env.example render.yaml PLAN-SECURITY.md`: `exit=1`, kein Treffer.
3. Byte-Identität gegen `af4a66e^` bei `src/utils/timer.js`, `scripts/telnyx-call-latency.mjs`, `test/config-shape.test.js`, `test/config-namespaces-helper.js`, `test/telnyx-call-latency.test.js`: leerer Diff.
4. Kollateralschaden-Check im Shim: `grep -icE '^[+-].*(spike|pause|sleep|FIRST_SENTENCE)'` gegen `af4a66e^`-Diff = 0; verbleibender Diff enthält nur KS-P1b-Hunks (`reattachActiveCallByControlId`, `resolveOrReattachActiveCall`, `logShimReattach`) und KS-P2-Signatur.
5. Blast-Radius: 15 Pfade (Plan-Zählfehler: 14 angekündigt, korrekt 15 gelistet — siehe Deviations).

**Tests:** 3591 pass / 0 fail (nach Abzug der 20 entfernten Datei-Wrapper aus dem Rohlauf 3611/3611).
**nodeCheckPass:** true. **smokePass:** true — Boot-Banner zeigt `Voice-Engine: budget`, `Assistant-Pfad: aus`, keine `SSE-Spike:`-Zeile mehr; `/healthz` antwortet 200; keine verwaisten Server-Kinder.

### Deviations
1. Node-modules-Symlink aus der Vorgehens-Anweisung war im Worktree eine Selbstreferenz — ersetzt durch Symlink auf das Haupt-Repo-`node_modules` (nicht committet, gitignored).
2. Plan kündigt in §5 Schritt 6 „genau 14 Pfade" an, listet aber 15 auf — Zählfehler im Plan; Commit enthält korrekt die 15 gelisteten Pfade.
3. Für die 5 seit `af4a66e` driftfreien Dateien wurde der Vor-Spike-Stand per `git checkout af4a66e^ -- <pfad>` wiederhergestellt statt Einzel-Edits von Hand nachzuvollziehen — vorher per `git log af4a66e..HEAD -- <pfade>` belegt, dass kein Commit sie seither angefasst hat; Ergebnis identisch zu den Plan-Edits, erfüllt die geforderte Byte-Identitätsprobe per Konstruktion.
4. Kein separates npm-Skript für pglite — die pglite-Tests laufen in-process (52 Testdateien importieren `@electric-sql/pglite`) als Teil desselben `npm test`-Laufs.
5. Nicht ausgeführt (außerhalb Phasen-Scope, im Plan als Owner-Übergabe benannt): Löschen der verwaisten Live-Env-Werte `TELNYX_SSE_SPIKE_*` im Render-Dashboard, des Render-Dienstes `hermes-spike-al-p2` und der Telnyx-App „AL-P2 Spike Silence" — als Schritt 4 in `tasks/al-testcall-checklist.md` festgehalten.

---

## 3. Safety-Urteil (final)

**approved:** true · **testsPassIndependently:** true · **safetyGatesIntact:** true · **disclosureIntact:** true · **authFailClosedIntact:** true · **noSecretsLeaked:** true · **scopeRespected:** true · **behaviorAsIntended:** true · **blockers:** keine

**Unabhängiger Testlauf** auf `review-ks-auf` (= `phase/ks-auf-spike-entfernen`, HEAD `643f8dc`, Basis `master` `c83ff73`, `merge-base` = master → Regel 0 erfüllt):
- Lauf 1 (Default-Backend json): grün, 3611/3611 roh, korrigiert 3591/3591 nach Abzug der 20 Datei-Wrapper.
- Lauf 2 (ambient `STORE_BACKEND=pg` auf dem Branch): 3126 tests / 3062 pass / 64 fail — Ursache verifiziert als reine Umgebungslücke (`[store] FATAL: pg-Backend nicht initialisierbar`, kein erreichbares `DATABASE_URL` in der Sandbox), keine Phasen-Ursache.
- Lauf 3 (Baseline auf `master` detached `c83ff73`, gleiches `STORE_BACKEND=pg`): 3130/3067 pass, 63 fail (Erstlauf) — Branch-Fehlermenge ist echte Teilmenge der master-Fehlermenge; nur zwei Einträge fallen weg (die gelöschte Spike-Datei + ein bekannter Flake). Null neue Fehlschläge.
- `node --check` + `npx eslint` auf alle geänderten Dateien: sauber. `package.json`/`package-lock.json` unverändert.

**Geprüfte Punkte:**
- **Vollständigkeit/Treue des Rückbaus:** 5 driftfreie Dateien byte-identisch zu `af4a66e^`; Shim-Diff gegen `af4a66e^` enthält nur 4 KS-P1b-Hunks, kein Treffer für spike/pause/sleep; Shim-Diff master..branch ist zeilengenaues Inverses des `af4a66e`-Diffs; repo-weiter Residuen-Grep über 9 Verzeichnisse/Dateien nach 9 Spike-Begriffen: null Treffer außerhalb der Chronik-Dokumente.
- **Regel 1 (Safety-Gates):** `git diff --stat` auf `claude.js`, `bridge.js`, `auth.js`, `web-auth.js`, `middleware.js`, `telephony/`, `budget-gate.js` leer. Einzige entfernte Boot-Klausel prüft ausschließlich den Spike selbst gegen sich selbst; Nachbar-Klausel `TELNYX_SHIM_MAX_TURNS_CEILING` (Fraud-Bremse) unverändert. Notaus-Pfade (Rate-Gate, `killCallForBudget`, Loop-Guard, Degradations-Catch) intakt und wieder sofortig. KS-P1b/KS-P2 unangetastet.
- **Regel 2 (Offenlegung):** `claude.js`/`bridge.js` nicht im Diff; `disclosureSentence` weiterhin fest verdrahtet; `disclosure-regression.test.js` grün.
- **Regel 3 (Auth fail-closed):** alle vier Auth-Kanten des Shims unverändert (404-Existenz-Gate, Bearer/`safeEqual`, ccid-Korrelation, Call-Resolve/403); keine neue Route.
- **Regel 4 (Secrets):** alle 24 hinzugefügten Zeilen geprüft — nur wiederhergestellter Vor-Spike-Code + Doku, kein Credential. Positiver Nebeneffekt: eine echte Wegwerf-Rufnummer verschwindet aus der Checkliste.
- **Scope:** alle 15 Dateien innerhalb der Spec-Menge, keine Nachbarphase mitgefixt.
- **Verhalten = Absicht:** SSE-Sequenz nach dem Rückbau identisch zu master-bei-Flag-aus; async→sync-Rückbau verhaltensneutral (kein beobachtbarer Reihenfolgeunterschied am Draht); Coverage-Verlust der 20 gelöschten Tests durch Bestandstest `telnyx-llm-shim.test.js:343-352` (Chunk-Invariante) weiterhin gepinnt.

**Concerns (nicht blockierend):**
1. Verwaiste Live-Env-Variablen `TELNYX_SSE_SPIKE_*` bleiben im dashboard-gemanagten Render-Dienst stehen, bis der Owner sie löscht — harmlos, da `config.js` sie nicht mehr liest; Checkliste verweist korrekt auf `tasks/al-env-changes.md`.
2. `PLAN-SECURITY.md`-Abschnitt wird ersatzlos gelöscht statt als „erledigt" markiert — von der Spec ausdrücklich erlaubt, Nachweis lebt fortan nur in Git-History + `tasks/al-p2-report.md`.
3. `tasks/al-testcall-checklist.md` Schritt 4 konsolidiert Ressourcen-IDs, die bereits in `al-chain-state.md` standen — reine Doku, keine neue Information; positiv: eine echte Rufnummer verschwindet dabei.
4. Ambienter `STORE_BACKEND=pg`-Lauf ist in diesem Repo kein unterstützter Modus (kein erreichbares `DATABASE_URL` in der Sandbox) — pg-Store wird stattdessen über ~20 pglite-Testdateien innerhalb von `npm test` abgedeckt, alle grün.

**Verdict:** PASS — „Ein befristeter Diagnose-Schalter, der eine künstliche Verzögerung in den Produktiv-Antwortpfad legen konnte, verlässt master ersatzlos und rückstandsfrei — nicht ‚auf 0 gestellt', sondern weg. Der Nachweis steht nicht als Behauptung im Bericht, sondern ist gegen `af4a66e^` nachrechenbar. Kein Blocker. Freigabe zum Merge."

---

## 4. Clean-Code-Audit (final)

**s1 (Blocker):** keine
**s2:** keine
**s3:** keine
**s4:** keine
**blocker:** false

**Verdict:** PASS. Der Diff (`master` `c83ff73` → `phase/ks-auf-spike-entfernen` `643f8dc`) ist eine reine, symmetrische Rückbau-Änderung: der AL-P2-SSE-Spike-Schalter wird ersatzlos aus Code, Config, Tests und Doku entfernt (664 Zeilen gelöscht, 26 hinzugefügt, ausschließlich Anpassungen an Restcode nach dem Wegfall). Keine neue Logik, keine neuen Abstraktionen, kein Feature — nur Entfernung.

**passNotes:**
- Alle Produktionsstellen sauber entfernt: `config.js` (Env-Keys, `e164Env`, `productionFootguns`-Check), `boot.js` (`sseSpikeBannerLine` + Aufruf), `telnyx-llm-shim.js` (`splitAtFirstSentence`, `sseSpikeDelayMsFor`, `spikePauseFor`, `logShimSseSpike`, `sleep`-Injektion, `pause`-Parameter), `utils/timer.js` (`sleepMs`), `scripts/telnyx-call-latency.mjs` (`AUDIO_FIRST_TOKEN_FIELD`-Alias, `sseSpikeVerdict`, `printSpikeVerdict`, `extractSpikeDelay`, `SPIKE_FLAG`).
- `writeCompletion` korrekt async→sync zurückgebaut, alle Call-Sites verloren gleichzeitig ihr `await` — kein verwaistes `await` auf synchronen Aufrufen, sauber durchgezogen.
- Testseite exakt symmetrisch entfernt/bereinigt, keine verwaisten Helfer.
- Repo-weiter Grep nach allen entfernten Symbolnamen im Zieldateisatz: keine Treffer, keine kaputten Imports.
- Doku im selben Zug bereinigt, Checklisten-Eintrag verweist korrekt auf Historie statt sie zu löschen.
- Keine Safety-Gates, Auth-Kanten oder Money-Pfade außerhalb des Spike-Codes berührt.

**topTodos:** keine.

---

## 5. Fix-Runden

Keine. Der erste Impl-Durchlauf hat Safety- und Clean-Code-Review im ersten Anlauf mit PASS bestanden — keine Blocker, keine Fix-Runde nötig.
