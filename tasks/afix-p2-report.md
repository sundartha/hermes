# Report Phase afix-p2 — STT-Sprach-Hint pro Call (`transcription.language`, NIE `multi`)

**Gate: PASS**
**finalBranch:** `phase/afix-p2-stt-language-hint-fix3`
**headCommit (Impl, vor Fix-Runden):** `198b7e439c7589ecbcb58d96c9428e3a80bb5952`
**Basis:** `master` @ `960afe5` (P1 gemergt)
**Quelle:** `tasks/assistant-fix-spec.md` § P2 (autoritativ) + Plan-Doc/RCA als Kontext

---

## 1. Ziel der Phase

Der Live-Assistant transkribiert mit STT-Modell `deepgram/flux`, dessen per-Call-`transcription.language`-Feld heute nicht gesetzt wird — der Live-Default steht faktisch auf `"multi"`, was laut Telnyx-Doku wortlich **"no language hint"** bedeutet. Das ist RCA-Wurzel R2 (Deutsch kam als NL/EN-Kauderwelsch an). Ziel: pro Call einen expliziten Sprach-Hint aus `call.language` an `ai_assistant_start` mitsenden, der Adapter darf `"multi"` NIE aussenden, der Inbound-Pfad bleibt byte-identisch (P6-Invariante).

---

## 2. Plan (gekuerzt)

### 2.1 API-Beweis (Telnyx-OpenAPI, `team-telnyx/openapi`, `openapi/spec3.json`, geladen 2026-07-12)

- `POST /calls/{call_control_id}/actions/ai_assistant_start` → `AIAssistantStartRequest` erlaubt u.a. `transcription` (`TranscriptionConfig`) — im Action-Body zulaessig, bestaetigt.
- `TranscriptionConfig` hat GENAU ZWEI Properties: `model` (Default `distil-whisper/distil-large-v2`, **englisch-only**) und `language` (Default `"auto"`; fuer `deepgram/flux` gueltige Werte: `auto`, `multi` — Telnyx-Doku woertlich: *"no language hint"* — sowie `en,es,fr,de,hi,ru,pt,ja,it,nl`).
- Zwei harte Folgerungen: (1) `"multi"` ist per Telnyx-Doku woertlich "no language hint" — der Live-Assistant steht darauf, das ist exakt R2. (2) `model` MUSS im per-Call-`transcription` mitgesendet werden, sonst riskiert ein `{language:"de"}` ohne `model` den englisch-only Schema-Default — schlimmer als der Status quo.
- Risiko-Fund: Das *Assistant-Objekt* nutzt ein ANDERES Schema (`TranscriptionSettings` mit `settings.eot_threshold/eot_timeout_ms/eager_eot_threshold`), der *per-Call*-`TranscriptionConfig` hat KEIN `settings`-Feld. Ob der per-Call-Override den `transcription`-Block merged oder ersetzt, ist **undokumentiert** (s. Safety-Concern C1).

### 2.2 Geplante Edits

1. `src/telephony/adapters/telnyx/voice.js` (einzige Logik-Aenderung): neue Konstanten `STT_MODEL="deepgram/flux"`, `STT_FLUX_HINTS` (`en,es,fr,de,hi,ru,pt,ja,it,nl`, `Object.freeze`), `STT_LANGUAGE_AUTO="auto"`; neue reine Funktion `transcriptionFields(language)` (spiegelt das Bestandsmuster `speakVoiceFields`, adapter-intern, kein Provider-String durch den Port); `startAssistant({callControlId, assistantId, language})` baut `body: { assistant: {id}, ...transcriptionFields(language) }` — Guards unveraendert, `language` optional (kein neuer fail-closed-Pfad).
2. `src/telephony/ports.js` — nur JSDoc: `StartAssistantParams.language` als optionales, neutrales Sprachfeld (`de|fr|en`) dokumentiert, kein Provider-String.
3. `src/telnyx-call-control-ingest.js` — eine Zeile an der Call-Site: `startAssistant({callControlId, assistantId: call.assistantId, language: call.language})`; Reihenfolge `speak.ended → startAssistant → watchdog.arm` und `!call.assistantId`-Fail-Safe unveraendert.
4. `src/telnyx-inbound.js` — **NULL Edits** (byte-identisch, P6-Invariante).

### 2.3 Mapping-Tabelle

| Eingabe (`call.language`) | Ausgabe im Body |
|---|---|
| `de/fr/en` (+ `es,hi,ru,pt,ja,it,nl`) | `transcription: { model: "deepgram/flux", language: <code> }` |
| beliebig anders (`"tr"`, **`"multi"`**, Muell) | `transcription: { model: "deepgram/flux", language: "auto" }` |
| `undefined`/`null`/`""` (Inbound) | **kein `transcription`-Feld** |

Mapping lebt modul-intern in `voice.js` (genau ein Konsument, keine Extraktion in eigenes Modul — S4-Vermeidung); nicht in `config.js` (Protokoll-Vertrag, kein Operator-Knopf, keine neuen Env-Vars laut Spec).

### 2.4 Tests (Plan-Vorgabe)

Baseline gemessen (master): 58 pass/0 fail in den drei Zieldateien. Geplant: 6 neue Tests — `test/telnyx-call-control.test.js` P2-T1 (Kernfall `de`), P2-T2 (unbekannte Sprache → `auto`), P2-T3 (**Invariante**: `"multi"` → `auto`), P2-T4 (Inbound-Regression, kein `language` → kein `transcription`-Feld), P2-T5 (Grenzfaelle `""`/`null` → kein Feld); `test/telnyx-event-ingest-machine.test.js` 2 erweiterte `deepEqual`-Assertions (+`language:"de"`) + P2-T6 (Fixture `language:"fr"`, beweist Durchreiche-Pfad statt Hardcodierung — RCA-Lehre "gleiche Fixture-Werte testen nichts"). `test/telnyx-p8-inbound.test.js` bleibt **unangetastet** als Beweis fuer Inbound-Byte-Identitaet. Erwartung: 58+6 = 64 pass/0 fail in den drei Dateien.

### 2.5 Pre-Mortem (Auszug)

- **Risiko A** — per-Call-`transcription`-Override koennte die `eot_*`-Settings des Assistants loeschen (Merge-Semantik undokumentiert); bewusst nicht spekulativ mitgepinnt (`settings` ist im per-Call-Schema nicht erlaubt, wuerde 400 provozieren). Fallback-Ausweg dokumentiert: `language` bei Bedarf ans Assistant-Objekt verlagern statt per-Call.
- **Risiko B** (vergessenes `model` → stille Englisch-STT) — entschaerft, `model` ist Pflichtteil von `transcriptionFields`.
- **Risiko C** (Hint unterdrueckt Mid-Call-Sprachwechsel) — bekannte Spec-Beobachtung E2.4, Entscheidungsregel hinterlegt (`"auto"` statt Hint bei Bedarf).
- **Risiko D** (Drift Assistant-Modell vs. Adapter-Konstante) — bewusst akzeptiert, keine zweite Quelle im Code (Provisioner setzt `transcription` heute nicht).

---

## 3. Impl-Zusammenfassung

**headCommit:** `198b7e439c7589ecbcb58d96c9428e3a80bb5952` auf Branch `phase/afix-p2-stt-language-hint` (von `master@960afe5`)
**node --check:** PASS auf allen 5 geaenderten Dateien
**Tests:** PASS, 2121/2121 (0 fail)

### Umgesetzt

- `src/telephony/adapters/telnyx/voice.js`: neue Konstanten `STT_MODEL="deepgram/flux"`, `STT_FLUX_HINTS` (10 Sprachen, `Object.freeze`), `STT_LANGUAGE_AUTO="auto"`; neue Funktion `transcriptionFields(language)` (adapter-intern, spiegelt `speakVoiceFields`-Muster); `startAssistant({callControlId, assistantId, language})` baut `body: { assistant: {id}, ...transcriptionFields(language) }` — fehlt `language`, entsteht KEIN `transcription`-Feld (Body byte-identisch zum Bestand).
- `src/telephony/ports.js`: `StartAssistantParams.language` als optionales JSDoc-Feld dokumentiert (kein Laufzeit-Code).
- `src/telnyx-call-control-ingest.js`: `onSpeakEnded` reicht `language: call.language` an `startAssistant` durch (eine Zeile, Reihenfolge unveraendert).
- `src/telnyx-inbound.js`: NULL Edits wie Plan §2.4 verlangt (bestaetigt per `git diff --stat`: Datei nicht im Diff).

### Tests

6 neue offline-Tests wie geplant: `test/telnyx-call-control.test.js` (P2-T1 Kernfall `de`, P2-T2 unbekannte Sprache → `auto`, P2-T3 `multi` → `auto`-Invariante, P2-T4 Inbound-Regression ohne `language`, P2-T5 Leerwert/`null`-Grenzfaelle); `test/telnyx-event-ingest-machine.test.js` (P2-T6 mit `language:"fr"`-Fixture) plus 2 erweiterte `deepEqual`-Assertionen (`language:"de"` ergaenzt). Zielsuite (`telnyx-call-control.test.js` + `telnyx-event-ingest-machine.test.js` + `telnyx-p8-inbound.test.js`): **64 pass/0 fail** (Baseline 58 + 6, exakt Plan §5). Vollsuite `npm test`: **2121 pass/0 fail** (Baseline 2115 + 6).

### Smoke

Kein echter Anruf, kein Netz zu Telnyx (Plan-Vorgabe: Smoke best-effort via Adapter-Body-Unit-Tests). Payload-Beweis ausschliesslich ueber gestubbte `fetch`-Unit-Tests in `test/telnyx-call-control.test.js` (`global.fetch`-Stub, `JSON.parse(calls[0].body)`-Assertions).

### Deviations (Plan vs. Impl)

1. Plan §5 Schritt 4 erwartet `grep -rn '"multi"' src/ scripts/` → keine Treffer (Exit 1). Tatsaechlich: 3 Treffer, aber ALLE innerhalb von `//`-Kommentaren, die den Live-Defekt erklaeren (`voice.js:39` in der `STT_FLUX_HINTS`-Doku, `voice.js:107` im `transcriptionFields`-Doc-Kommentar, `telnyx-call-control-ingest.js:131` im Call-Site-Kommentar). Diese Kommentare sind woertlich aus dem Plan selbst uebernommen (Plan §2.1a und §2.3 enthalten dieselben Formulierungen mit `"multi"` in Anfuehrungszeichen) — der Plan ist an dieser Stelle intern inkonsistent (die vorgeschriebenen Kommentare verletzen die eigene Verifikations-Vorgabe). Die Kern-Invariante der Phase (`"multi"` wird NIE als tatsaechlicher Wert an Telnyx gesendet) ist erfuellt und durch P2-T3 automatisiert getestet; die Impl folgte der Plan-Vorgabe fuer den Code-/Kommentar-Wortlaut statt die Kommentare abzuschwaechen (genau-gemaess-Plan hatte Vorrang vor einem nicht-funktionalen grep-Check). Dies wurde in Fix-Runde r3 korrigiert (s. §6).

---

## 4. Safety-Urteil (final)

**approved: true** — alle Einzelpruefungen gruen: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `noSecretsLeaked`, `authFailClosedIntact`, `scopeRespected`, `behaviorAsIntended`.

**Unabhaengiger Testlauf:** frischer Worktree (Branch `review-afix-p2-r3` = `phase/afix-p2-stt-language-hint-fix3`, `node_modules`-Symlink): `npm test` → tests 2122, pass 2122, fail 0, cancelled 0, skipped 0, todo 0, duration 72551ms. `node --check` gruen auf `src/telephony/adapters/telnyx/voice.js`, `src/telephony/ports.js`, `src/telnyx-call-control-ingest.js`. Diff-Umfang (`git diff master...HEAD`): nur 3 Quelldateien + 3 Testdateien (148 insertions/6 deletions). 0 Diff-Zeilen in `src/telnyx-inbound.js`, `src/claude.js`, `src/bridge.js`, `src/config.js`, `.env.example`, `package.json`, `scripts/`.

**Verdict (Kurzfassung der sechs Pruefpunkte a–f):**
- (a) Offenlegungs-Anker UNVERAENDERT: `answered → sendOpeningSpeak → call.speak.ended → onSpeakEnded → ai_assistant_start`; der `onSpeakFailed`-Fail-Safe (genau 1 Retry mit Bestands-Stimme, sonst KEIN Assistant-Start) unangetastet. Kein Diff in `src/claude.js`/`src/bridge.js` → `disclosureSentence` bleibt fest verdrahtet.
- (b) INBOUND byte-identisch: `git diff master...HEAD -- src/telnyx-inbound.js` = 0 Zeilen. Aufruf dort weiterhin `vc.startAssistant({callControlId, assistantId: call.assistantId})` (Zeile 41) → `transcriptionFields(undefined) = {}` → Body exakt `{assistant:{id}}`. Neuer Regressionstest in `test/telnyx-p8-inbound.test.js` beweist das mit NICHT-Default-Wert (`call.language='fr'`), sodass ein versehentlicher Passthrough nicht durch einen `de`-Default maskiert wird.
- (c) `"multi"` wird NIE gesendet: `STT_FLUX_HINTS=[en,es,fr,de,hi,ru,pt,ja,it,nl]`; alles ausserhalb (inkl. `"multi"` und `"tr"`) → `STT_LANGUAGE_AUTO="auto"`. Kein hartes `de` im Adapter; fehlende `language` → gar kein `transcription`-Feld. Tests P2-T1..T5 decken `de/tr/multi/absent/leer/null` ab.
- (d) Kein Provider-String durch den Port: `StartAssistantParams.language` ist die neutrale Gespraechssprache (`de|fr|en` aus `src/i18n/locales.js`); `"deepgram/flux"` und `"auto"` existieren ausschliesslich adapter-intern in `transcriptionFields()`.
- (e) Keine neuen Env-Vars (`src/config.js`/`.env.example` 0 Diff), keine neuen Dependencies (`package.json` 0 Diff), keine Secrets im Log.
- (f) Assistant-Objekt/Provisioner unangetastet (`scripts/` 0 Diff); keine Aenderung an `eot_*`/Eager-EOT im Code; einzige Aenderung ist der per-Call-Override.

**Concerns (kein Blocker, Restrisiken):**
1. **C1 (wichtigste, live zu verifizieren):** Der per-Call-Block ist `transcription:{model,language}` OHNE `settings`. Das Live-Assistant-Objekt traegt `transcription.settings = {eot_threshold:0.8, eot_timeout_ms:5000, eager_eot_threshold:0.8}`. Ob Telnyx den per-Call-Block DEEP-MERGED oder das `transcription`-Objekt komplett ERSETZT, ist offline nicht beweisbar. Ersetzt es, fallen die `eot_*`-Werte pro Call still auf Telnyx-Defaults zurueck (Turn-Taking/R1 geaendert) und der geplante P5a-Schritt (`eot_timeout_ms` 5000→2500 am Assistant-Objekt via Provisioner) waere durch diesen per-Call-Override GESCHATTET, also wirkungslos. Kein Blocker, aber im Live-Gate (E2.x) explizit auf Turn-Taking-Regression pruefen und C1 VOR P5a aufloesen.
2. **C2:** `STT_MODEL='deepgram/flux'` ist jetzt eine ZWEITE Quelle fuer das STT-Modell (erste: das Assistant-Objekt via `scripts/telnyx-assistant-provision.mjs`). Ein spaeterer Modellwechsel am Assistant-Objekt wuerde vom per-Call-Override still auf flux zurueckgezwungen. Spaetestens bei der Fallback-Leiter (Modellwechsel) zusammenfuehren.
3. **C3:** Kein Fallback, wenn Telnyx das neue `transcription`-Feld ablehnt (400/422). `startAssistant` wirft in `onSpeakEnded` → Handler-Catch → `ai_assistant_start` feuert NIE und `watchdog.arm(call.id)` wird NICHT erreicht → stumme Restlaufzeit ohne Dead-Air-Wache bis zum harten Max-Dauer-Cap. Kosten durch Max-Dauer-Timer (Regel 1) begrenzt, Fehler ueber `[voice/call-control] <err.message>` diagnostizierbar. Empfehlung: Live-Gate = ein Testanruf mit Log-Check auf "ai_assistant_start abgesetzt", vor breitem Rollout.
4. **C4 (dokumentierter Trade-off, kein Defekt):** `createCall` setzt `language: language || 'de'` (`src/store/state-ops.js:151`), d.h. auf dem Ingest-Pfad ist `call.language` praktisch immer gesetzt → der Ohne-`language`-Zweig ist dort tote Randlage; wer auf einem als `de` gefuehrten Call Englisch spricht, wird nun mit deutschem Hint transkribiert (vorher `multi`/Auto-Detect). Genau das ist der Zweck der Phase; Spec E2.4 sieht die Beobachtung des Mid-Call-Sprachwechsels bereits vor.

**Auflagen fuer das Live-Gate (aus C1/C3):** (1) pruefen, ob der per-Call-`transcription`-Block die `eot_*`-Settings des Assistant-Objekts ueberschreibt — falls ja, VOR P5a beheben; (2) erster Testanruf mit Log-Check auf "ai_assistant_start abgesetzt".

---

## 5. Clean-Code-Audit (final)

**verdict:** PASS. Kein Blocker.

- **s1 (Blocker):** keine Funde.
- **s2:** keine Funde.
- **s3:** keine Funde.
- **s4:** keine Funde.

**topTodos (optional, kein Merge-Blocker):**
1. Kein Blocker — Phase `afix-p2-stt-language-hint-fix3` kann gemergt werden.
2. Optional (reine Doku-Politur): der Kommentar ueber `STT_FLUX_HINTS` (voice.js ~Zeile 35–38) koennte explizit erwaehnen, dass die Liste bewusst NICHT `SUPPORTED_LANGUAGES` (`src/i18n/locales.js`) ist, sondern eine unabhaengige, von Telnyx/deepgram-flux vorgegebene Menge — aktuell erschliesst sich das nur implizit.

**passNotes (Auszug):** Sauberer, kleiner Diff (3 Quelldateien + 3 Testdateien, 148 Zeilen). Magic Strings sauber in benannte, gefrorene Konstanten extrahiert (`STT_MODEL`, `STT_LANGUAGE_AUTO`, `STT_FLUX_HINTS` via `Object.freeze`) — kein nacktes `"deepgram/flux"` oder `"auto"` mehr im Code. `transcriptionFields()` ist eine reine, einzweckige Funktion (CQS-konform, keine Nebeneffekte), adapter-intern platziert (G5/DIP: der Port bleibt provider-neutral). Die geprueften Sprach-Hint-Liste (`STT_FLUX_HINTS`, 10 STT-Provider-Sprachen) ist inhaltlich KEINE Duplizierung von `SUPPORTED_LANGUAGES` (3 App-Sprachen) — unterschiedliche Domaenen; die `"multi"`-Ausschluss-Logik ist zusaetzlich generisch geloest (kein Sonderfall-Vergleich auf den String `"multi"`, jeder nicht gelistete Wert faellt einheitlich auf `"auto"`). JSDoc in `ports.js` konsistent zum Bestandsstil ergaenzt und inhaltlich korrekt (Inbound-Pfad byte-identisch, per Diff bestaetigt). Keine Kommentare mit Umlauten (grep negativ), kein auskommentierter Code, keine deaktivierten Sicherungen. Testabdeckung ungewoehnlich gruendlich fuer eine so kleine Aenderung: Kernfall (`de`), Fallback (unbekannte Sprache → `auto`), explizite Invariante (`multi` → nie durchgereicht), Inbound-Regression (ohne `language` → Body byte-identisch), Grenzfaelle (leer/`null`), sowie ein bewusst NICHT-Default-Sprachwert (`fr` statt `de`) im Event-Ingest-Test gegen die RCA-Lehre "gleiche Fixture-Werte testen nichts". Test-Spies zeichnen die tatsaechlich uebergebenen Parameter aus dem Produktionscode auf (kein Hardcoding, das Faelschungen verdecken koennte). Verifiziert: `node --check` auf allen 3 geaenderten Quelldateien gruen; die 3 zugehoerigen Testdateien isoliert 65/65 gruen; vollstaendige Suite (`npm test`) 2122/2122 gruen auf dem Branch (Worktree `wf_7488caec-30b-11`, Commit `a7fda25`). Keine Grenzverletzungen gegen die Absoluten Regeln (Safety-Gates/Offenlegung/Auth/Secrets/Audio) — reine STT-Konfigurations-Feld-Ergaenzung im bestehenden Call-Control-Body.

---

## 6. Fix-Runden

### r1
Fixed den einzigen Review-Blocker der Runde 1 in `src/telnyx-inbound.js`, Worktree `.claude/worktrees/wf_7488caec-30b-5`, Branch `phase/afix-p2-stt-language-hint-fix1` (Basis `phase/afix-p2-stt-language-hint`, Commit `198b7e4`). Commit `e559556`.

### r2
Alle 5 Review-Blocker der Runde 2 durch EINE Wurzel-Korrektur behoben: `src/telnyx-inbound.js` auf byte-identisch mit dem Vor-P2-Stand zurueckgesetzt (kein `language`-Feld mehr an `startAssistant` durchgereicht, Diff gegen `960afe5` = leer). Damit entfaellt auch die live-relevante Verhaltensaenderung am Inbound-Pfad, die Runde 1 unbeabsichtigt eingefuehrt hatte.

### r3
Reiner Dokumentations-Fix, kein Scope-Drift. Alle drei im Blocker genannten Kommentar-Stellen korrigiert (`ports.js:44`, `voice.js:106`, `voice.js:222` im alten Stand): sie behaupteten faelschlich, der Inbound-Pfad reiche `call.language` durch. Jetzt beschreiben sie korrekt, dass NUR der Ingest-Pfad (Outbound, `onSpeakEnded`) die Sprache durchreicht, der Inbound-Pfad byte-identisch bleibt. Damit auch die in §3 dokumentierte Deviation (grep-Treffer auf `"multi"` in Kommentaren) mit adressiert.

**Ergebnis nach r3:** Gate PASS, `finalBranch = phase/afix-p2-stt-language-hint-fix3`, unabhaengiger Testlauf 2122/2122 gruen.
