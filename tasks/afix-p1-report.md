# Report Phase afix-p1 — Opening-Stimme (ElevenLabs) + Fallback-Kette + Provisioner-Fix

**Gate: PASS**
**finalBranch:** `phase/afix-p1-opening-voice-fix3`
**headCommit (Impl, vor Fix-Runden):** `6bf9ee3ae8d2ad8c31505ce87c64d418e321d988`
**Basis:** `master` @ `bed694e`
**Quelle:** `tasks/assistant-fix-spec.md` § P1 + "Gemeinsame Leitplanken"

---

## 1. Ziel der Phase

Die Opening-Ansage (Offenlegungssatz) beim Telnyx-AI-Assistant-Pfad soll mit der ElevenLabs-Stimme gesprochen werden, mit der auch der Assistant selbst spricht (statt Azure), plus eine robuste Fallback-Kette, falls ElevenLabs nicht verfuegbar/fehlkonfiguriert ist oder der Speak-Call scheitert. Zusaetzlich zwei Provisioner-Fixes: `user_idle_reply_secs=4` (R5, gegen 12s Totzeit im Live-Call) und ein PUT→POST-Bugfix am Assistant-Update-Endpunkt (der PUT-Pfad war laut Telnyx-OpenAPI-Spec strukturell nie funktionsfaehig — 404).

---

## 2. Plan (gekuerzt)

### 2.1 API-Recherche (Beleg: Telnyx-OpenAPI-Spec, `spec3.json`)

- **`voice_settings` im Call-Control-`speak`-Body**: zulaessig, `type` ist PFLICHT (`SpeakRequest.voice_settings` ist eine per `type` diskriminierte Union; `ElevenLabsVoiceSettings` verlangt `type:"elevenlabs"`). Kontrast: Das **Assistant**-Objekt hat ein FLACHES `voice_settings`-Schema OHNE `type` (`required: ["voice"]`) — der Provisioner bleibt daher bei `{ voice, api_key_ref }`.
- **`language` bei ElevenLabs-Voice**: laut Spec optional, nicht verboten — aber bewusst weggelassen (spec-legal), weil ElevenLabs-Modelle multilingual sind und dem Text folgen (analoge Entscheidung wie bereits im TeXML-`<Say>` in `render.js`).
- **Bonus-Beleg P1.3**: `/ai/assistants/{assistant_id}` kennt laut Spec nur `get`, `post`, `delete` — **kein `put`** ⇒ der bisherige PUT-Update-Pfad war strukturell tot (404). `telephony_settings.user_idle_reply_secs`: `integer, minimum:0, default:10` ⇒ `4` ist gueltig.

### 2.2 Geplante Edits

1. **NEU** `src/telephony/adapters/telnyx/elevenlabs-voice.js` — rein, config-frei, EINE Quelle fuer Voice-Format (`elevenLabsVoiceName`) + Vollstaendigkeits-Gate (`hasElevenLabsVoice`); dedupliziert einen String, der vorher bereits zweimal existierte (`render.js`, `scripts/telnyx-assistant-provision.mjs`).
2. `render.js` (`sayVoiceAttrs`) — reine Dedupe auf die neue Quelle, Ausgabe byte-identisch (Snapshot-Tests bleiben unveraendert gruen als Beweis).
3. `ports.js` — nur JSDoc-Erweiterung um `useAssistantVoice?: boolean` (semantischer Wunsch, kein Provider-String; Default false = byte-identisch zum Bestand).
4. `voice.js` (`speak`) — neuer optionaler Parameter `useAssistantVoice` (Default `false`), neue Helper `speakVoiceFields()` (ElevenLabs-Zweig mit `voice_settings.type="elevenlabs"`, KEIN `language`-Feld; sonst Azure-Fallback `voiceAttrs`), neue `export function assistantVoiceConfigured()` fuer Observability.
5. `src/telnyx-call-control-ingest.js` — volle Fallback-Kette (a–d), Retry-Token pro Call (`Set`, in `onHangup` geraeumt), Log-Marker `opening_voice=elevenlabs|azure reason=...`. `onSpeakFailed` bekommt `callControlId`.
6. `scripts/telnyx-assistant-provision.mjs` — `USER_IDLE_REPLY_SECS=4` in `telephony_settings`; neue exportierte, netzfreie Funktion `assistantRequest(existingId)` liefert IMMER `POST` (Create: Collection-URL, Update: `/{id}`-URL) — BUGFIX fuer den toten PUT-Pfad; Voice-Format ueber die neue Dedupe-Quelle.
7. `src/telnyx-inbound.js` — **BYTE-IDENTISCH**, keine Aenderung (kein `useAssistantVoice` im Aufruf ⇒ Azure-Default wie bisher; automatisiert bewiesen durch unveraendert gruene `test/telnyx-p8-inbound.test.js`).

### 2.3 Fallback-Kette (a–d)

| Fall | Auslöser | Mechanismus | Retry-Token |
|---|---|---|---|
| (a) | `config.telnyxElevenLabs` unvollstaendig | Adapter baut direkt Azure-Payload, kein Retry noetig. Log: `opening_voice=azure reason=config_missing` | unberuehrt |
| (b) | ElevenLabs-`speak` wirft synchron (4xx/5xx) | Ingest-Catch → `consumeOpeningRetry` → genau EIN Azure-`speak` | verbraucht |
| (c) | `call.speak.failed`-Event | `onSpeakFailed` → `consumeOpeningRetry` → genau EIN Azure-`speak` | verbraucht |
| (d) | Auch der Azure-Retry scheitert | Token verbraucht → heutiger Fail-Safe: kein `startAssistant` | verbraucht |

Retry-State als `Set` im Factory-Closure (`consumeOpeningRetry`), in `onHangup` geraeumt (kein Sweep, kein Leak). Regel-2-Anker (`speak.ended` → `startAssistant` → `watchdog.arm()`) unveraendert.

### 2.4 Tests (Plan-Vorgabe)

12 neue Tests ueber drei Dateien: `telnyx-call-control.test.js` (T-neu 1–4, Voice-Body inkl. Fallback a + Grenzfall + Inbound-Regression), `telnyx-event-ingest-machine.test.js` (T-neu 5–10, Fallback b/c/d, State-Cleanup, Observability), `telnyx-assistant-config.test.js` (T-neu 11–12, `telephony_settings`-Feld + PUT→POST-Regression). Erwartung: betroffene Suiten 68→80 gruen, volle Suite `# fail 0`.

---

## 3. Impl-Zusammenfassung

**headCommit:** `6bf9ee3ae8d2ad8c31505ce87c64d418e321d988` auf Branch `phase/afix-p1-opening-voice` (Worktree `.claude/worktrees/wf_11763920-934-2`)
**node --check:** PASS auf allen geaenderten Dateien
**Tests:** PASS, 2107/2107 (0 fail)

### Umgesetzt

- **NEU** `src/telephony/adapters/telnyx/elevenlabs-voice.js`: `elevenLabsVoiceName()` + `hasElevenLabsVoice()` — EINE Quelle, genutzt von `render.js`, `voice.js`, `scripts/telnyx-assistant-provision.mjs`.
- `src/telephony/ports.js`: JSDoc um `useAssistantVoice` erweitert.
- `src/telephony/adapters/telnyx/voice.js`: `speak()` mit optionalem `useAssistantVoice` (Default `false`, Inbound byte-identisch), neue `speakVoiceFields()`-Helper (ElevenLabs-Zweig ohne `language`, Azure-Fallback sonst), neue `export function assistantVoiceConfigured()`.
- `src/telnyx-call-control-ingest.js`: vollstaendige Fallback-Kette a–d, Retry-Token pro Call (Set, in `onHangup` geraeumt), `opening_voice`-Log-Marker (`elevenlabs` / `azure reason=config_missing|retry_after_failure`), `onSpeakFailed` bekommt `callControlId`.
- `scripts/telnyx-assistant-provision.mjs`: BUGFIX PUT→POST via neuer `assistantRequest()`-Funktion, `USER_IDLE_REPLY_SECS=4` in `telephony_settings`, Voice-Format ueber die neue Dedupe-Quelle.

### Tests

12 neue Tests wie geplant (T-neu 1–4 in `telnyx-call-control.test.js`, T-neu 5–10 in `telnyx-event-ingest-machine.test.js`, T-neu 11–12 in `telnyx-assistant-config.test.js`). Betroffene Suiten 68→80 gruen. `test/telnyx-p8-inbound.test.js` und `test/telnyx-p8-opening-contract.test.js` NICHT angefasst (blieben unveraendert gruen ⇒ automatisierter Beweis der Inbound-Invarianz). Volle Suite: 2107/2107 gruen.

### Smoke

Kein echter Netz-Call zu Telnyx (plangemaess). Stattdessen Adapter-Bodies per Unit-Test asserted (speak-Body mit/ohne `useAssistantVoice`, Fallback-Kette a–d end-to-end im Ingest-Test, `assistantRequest()`-Methode/URL fuer den PUT→POST-Bugfix). Der Live-Lauf des Provisioners und der Testanruf sind laut Plan Owner-gated, kein Merge-Gate dieser Phase.

### Deviations (Plan vs. Impl)

1. `src/telnyx-call-control-ingest.js`: den vom Plan vorgeschlagenen Import `import { config } from "./config.js"` NICHT uebernommen — `logOpeningVoice()` ruft ausschliesslich `assistantVoiceConfigured()` (kapselt `config` bereits intern), ein zusaetzlicher `config`-Import waere ungenutzt gewesen (G12).
2. `test/helpers.js` `BASE_ENV`: die vom Plan als "zu ergaenzen" beschriebenen Eintraege `TELNYX_ELEVENLABS_VOICE_ID`/`TELNYX_ELEVENLABS_API_KEY_REF` waren im Bestand bereits vorhanden — keine Aenderung noetig.

---

## 4. Safety-Urteil (final)

**approved: true** — alle Einzelpruefungen grün: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `noSecretsLeaked`, `authFailClosedIntact`, `scopeRespected`, `behaviorAsIntended`.

**Unabhaengiger Testlauf:** frischer Worktree (`review-afix-p1-r3` von `phase/afix-p1-opening-voice-fix3`), `npm test` → 2115/2115 gruen, 0 fail, 7 Suites, 96.6s. `node --check` gruen auf allen 6 geaenderten Quelldateien. Diff gegen `master`: kein Test entfernt/abgeschwaecht, kein `.skip`/`.only`/`eslint-disable`, keine abgeschaltete Sicherung. Kein Gate-/Auth-/Server-File im Diff (`src/claude.js`, `src/bridge.js`, `src/telnyx-inbound.js`, `src/config.js`, `package.json`, `.env.example` byte-identisch zu master).

**Verdict (Kurzfassung der sechs Pruefpunkte a–f):**
- (a) Offenlegungs-Anker intakt: `speak → speak.ended → ai_assistant_start` unveraendert, `watchdog.arm()` nicht angefasst; Fail-Safe nach erschoepfter Fallback-Kette bleibt bestehen (kein `startAssistant`).
- (b) Fallback-Kette beschraenkt auf genau EIN Retry pro Call (`consumeOpeningRetry`, Set in `onHangup` geraeumt) — Endlosschleife ausgeschlossen, per Test belegt.
- (c) Inbound byte-identisch (`src/telnyx-inbound.js` unveraendert, Regressionstest vorhanden).
- (d) Ohne ElevenLabs-Config byte-identisch (Azure-Bestand, Test T-neu 2 + T-neu 3).
- (e) Keine neuen Env-Vars, keine neuen Dependencies, kein Secret im Log (`opening_voice`-Marker traegt nur `call.id` + Zweig + Grund; aktiv getestet, dass weder `ccid` noch `api_key_ref` geloggt werden).
- (f) Provisioner: `assistantRequest()` liefert fuer Create UND Update immer `POST` (PUT explizit ausgeschlossen, Test T-neu 12); `telephony_settings` sendet ausschliesslich `user_idle_reply_secs=4`; zusaetzlich ein GET-vorher/nachher-Guard, der fail-closed wirft, falls Telnyx doch Safety-Felder verlieren sollte.

**Concerns (kein Blocker, Restrisiken):**
1. Provisioner-Update-POST: falls Telnyx `telephony_settings` als GANZES ersetzt statt deep-zu-mergen (live unbestaetigt), wuerden `time_limit_secs`/`recording_settings`/`default_texml_app_id` geloescht. Der GET-vorher/nachher-Guard (`PRESERVED_SAFETY_FIELDS` + `fieldsLostOnUpdate`) erkennt das fail-closed, aber post-hoc (Schreibvorgang ist schon passiert). Entschaerft durch unabhaengigen app-seitigen Max-Dauer-Gate. Empfehlung: ersten Live-Update-Lauf gegen einen Wegwerf-Assistant fahren.
2. Regel-2-Restrisiko live (offline nicht pruefbar): die Fallback-Kette deckt nur SIGNALISIERTE Fehler ab. Scheitert ElevenLabs still (z.B. Quota-402) und Telnyx meldet trotzdem `speak.ended`, feuert `ai_assistant_start` mit unhoerbarer Offenlegung. E1.2 im Testanruf MUSS explizit bestaetigen, dass die Offenlegung hoerbar ist.
3. Layering: `telnyx-call-control-ingest.js` importiert `assistantVoiceConfigured()` direkt aus dem Telnyx-Adapter statt ueber den Port — begruendet (EINE Quelle, G5), aber notiert.
4. `speakVoiceFields()` umgeht im ElevenLabs-Zweig `voiceAttrs(voiceProfile)` — ein unbekanntes `voiceProfile` wuerde dort nicht mehr fail-closed werfen; heute unerreichbar, nur der Vollstaendigkeit halber notiert.
5. Doppeltes `call.answered`-Webhook: pathologischer Randfall, identisch zum heutigen Verhalten, keine Regression.

---

## 5. Clean-Code-Audit (final)

**verdict:** PASS mit 1 kleinem S2-Hinweis + gebuendeltem S3-Kleinkram. Kein Blocker.

- **s1 (Blocker):** keine Funde.
- **s2 (Minor, kein Blocker):**
  - G5 (Duplizierung) in `src/telnyx-call-control-ingest.js` — die Retry-Sequenz "`consumeOpeningRetry` pruefen → `console.warn` → `sendOpeningSpeak(useAssistantVoice:false)`" ist im `onAnswered`-Catch und in `onSpeakFailed` strukturell dieselbe 3-Schritt-Logik mit inkonsistenter Log-Formulierung ("Opening-Speak fehlgeschlagen" vs. "Speak-Offenlegung fehlgeschlagen" fuer denselben Sachverhalt, vgl. G11). Empfehlung: kleinen Helper extrahieren (`retryOpeningSpeakOrThrow`), einheitliche Log-Terminologie. Nicht blockierend — kleine Codemenge (3 Zeilen), beide Stellen durch Tests (T-neu 5–8) abgesichert.
- **s3:** G11-Inkonsistenz (gleicher Log-Sachverhalt, zwei Formulierungen) — Teil des s2-Fixes, sonst kosmetisch. Positiv vermerkt: N7-konforme Funktionsnamen, G25 durchgaengig beachtet (benannte Konstanten statt Magic Values).
- **s4:** keine Funde. Nesting-Tiefe ≤2, Funktionslaenge deutlich unter 100 Zeilen, Argumentzahl ≤3 (Objekt-Parameter statt Positionslisten, F1-konform).

**topTodos (optional, kein Merge-Blocker):**
1. `retryOpeningSpeak`-Duplizierung in gemeinsamen Helper ziehen, bevor eine dritte Fallback-Variante dazukommt.
2. Log-Terminologie fuer den Opening-Speak-Fehlerfall vereinheitlichen.

**passNotes (Auszug):** Die im Auftrag explizit benannte ElevenLabs-Voice-String-Duplizierung ist sauber geloest (eine Quelle `elevenlabs-voice.js`, genutzt von `render.js`, `voice.js`, `scripts/telnyx-assistant-provision.mjs`). Testduplizierung zwischen `telnyx-call-control.test.js` und `telnyx-event-ingest-machine.test.js` ebenfalls behoben (`makeConfigOverrides`-Fabrik in `test/helpers.js`). Keine Magic Numbers/Strings ohne benannte Konstante. Keine Umlaute in Code-Kommentaren (Konvention eingehalten). Absolute Regeln beachtet: Offenlegungssatz bleibt fest verdrahtet, BUGFIX (PUT→POST) mit Regressionstest abgesichert, `PRESERVED_SAFETY_FIELDS`-Merge-Guard schuetzt aktiv den Sicherheits-Cap `time_limit_secs`, kein Secret/Key im Log oder in Fehlermeldungen. Vollstaendige Testabdeckung fuer alle vier Fallback-Pfade (a–d) + State-Cleanup + Observability-Marker; Inbound-Backward-Kompatibilitaet explizit als Regressionstest verifiziert (T-neu 4). Verifikation: `node --check` auf allen 5 geaenderten Quelldateien gruen; volle Testsuite in Parallel-Worktree mit demselben Branch-Stand: 2115/2115 Tests gruen.

---

## 6. Fix-Runden

### r1
Fixed den G26/G11-Review-Blocker in `scripts/telnyx-assistant-provision.mjs`: die unbelegte Behauptung, der Telnyx-Assistant-Update-POST sei ein Deep-Merge (sodass allein `telephony_settings.user_idle_reply_secs` zu senden `time_limit_secs`/`recording_settings`/`default_texml_app_id`/`transcription` unangetastet liesse), wurde entschaerft/abgesichert.

### r2
Alle 4 Review-Blocker der Runde 2 behoben, minimal und im Scope. Branch `phase/afix-p1-opening-voice-fix2` (von `phase/afix-p1-opening-voice-fix1`), Commit `be1b02f`. Kern-Blocker: der Merge-Sicherheitscheck war strukturell wirkungslos — `scripts/telnyx-assistant-provision.mjs` bekam einen `preserved`-Guard, der den GET-vorher/nachher-Vergleich tatsaechlich fail-closed durchsetzt (statt nur zu behaupten).

### r3
Review-Blocker (d) behoben. Branch `phase/afix-p1-opening-voice-fix3` (von `phase/afix-p1-opening-voice-fix2`), Commit `f7880b9`. Fix: `consumeOpeningRetry()` prueft jetzt zuerst `assistantVoiceConfigured()` und gibt ohne ElevenLabs-Config immer `false` zurueck — beide Retry-Aufrufer (`onAnswered`-Catch, `onSpeakFailed`) verbrennen das Retry-Token damit nicht mehr sinnlos auf einen redundanten zweiten Azure-Speak, wenn ElevenLabs von vornherein gar nicht konfiguriert war.

**Ergebnis nach r3:** Gate PASS, `finalBranch = phase/afix-p1-opening-voice-fix3`, unabhaengiger Testlauf 2115/2115 gruen.
