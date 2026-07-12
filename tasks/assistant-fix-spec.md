# SPEC — Assistant-Gespraechsfaehigkeit (P1-P4)

Autoritative Scope-/Design-/Invarianten-Definition pro Phase. Verbindlich VOR
`PLAN-ASSISTANT-CONVERSATION-FIX.md` (Umbrella-Kontext) und
`tasks/rca-2026-07-12-assistant-dead-call.md` (Wurzeln R1-R5).

Geltungsbereich: NUR der Telnyx-AI-Assistant-OUTBOUND-Pfad. Der Inbound-Pfad
(`src/telnyx-inbound.js`) bleibt in diesem Wurf BYTE-IDENTISCH (Plan P6, eigene
Phase). Die Budget-Engine (Gather/TeXML) bleibt unangetastet.

## Gemeinsame Leitplanken (alle Phasen)

- Regel 1 (Safety-Gates) und Regel 2 (Offenlegung) unantastbar. Der
  Offenlegungs-Anker bleibt exakt wie heute: deterministischer Call-Control-
  `speak` -> Warten auf `call.speak.ended` -> erst dann `ai_assistant_start`.
  Keine Greeting-Migration (bewusst verworfen).
- KEINE neuen Env-Vars. P1 nutzt die BESTEHENDE `config.telnyxElevenLabs`
  (`voiceId`, `model`, `apiKeyRef`).
- KEINE neuen npm-Dependencies.
- Keine Provider-Strings durch den Port (`src/telephony/ports.js`): das Mapping
  auf Telnyx-Payloads lebt adapter-intern.
- Flag-/Config-Aus => byte-identisches Verhalten zu heute.
- Jede Phase: `node --check` auf jede geaenderte Datei + `npm test` gruen.

## Bestandsaufnahme (Live-Assistant, per GET verifiziert 2026-07-12)

`assistant-dcf48d08-1d4e-4673-ab94-2681b22d26d4`:
- `voice_settings`: `ElevenLabs.eleven_flash_v2_5.SJJe86Va82zRzg6zi2dX`,
  `api_key_ref: elevenlabs_prod`
- `transcription`: `{ model: "deepgram/flux", language: "multi",
  settings: { eot_threshold: 0.8, eot_timeout_ms: 5000, eager_eot_threshold: 0.8 } }`
- `telephony_settings`: `{ user_idle_reply_secs: 10, time_limit_secs: 1800,
  recording_settings: { enabled: true, channels: "dual", format: "mp3" },
  default_texml_app_id: ... }`
- `interruption_settings`: `{ enable: true }`

Telnyx-API-Semantik (empirisch an einem Wegwerf-Assistant bewiesen, danach
geloescht):
- **`PUT /v2/ai/assistants/{id}` existiert NICHT** (HTTP 404, Route fehlt in der
  OpenAPI-Spec). Update = **`POST /v2/ai/assistants/{id}`**.
- Der POST-Update ist ein **Deep-Merge**: nicht gesendete Felder (auch
  Geschwisterfelder innerhalb von `telephony_settings`) bleiben erhalten.
  Folge: `buildAssistantConfig` muss `time_limit_secs`, `recording_settings`,
  `transcription` etc. NICHT mitpinnen — sie ueberleben.

---

## P1 — Opening-Stimme (ElevenLabs) + Idle-Nudge (fixt R5)

Ziel: Der Angerufene hoert EINE Stimme im ganzen Call, und die KI faengt nach
dem Opening nicht erst nach 12.4s an.

### P1.1 — Opening-`speak` auf die Assistant-Stimme (Laufzeit-Code)

Port (`src/telephony/ports.js`): `speak` bekommt einen zusaetzlichen,
OPTIONALEN, semantischen Parameter — KEIN Provider-String:

    speak({ callControlId, text, voiceProfile, useAssistantVoice })

- `useAssistantVoice` (bool, Default false/undefined): "sprich mit derselben
  Stimme, die der AI-Assistant danach benutzt, sofern verfuegbar".
- Fehlt der Parameter, ist das Verhalten BYTE-IDENTISCH zu heute (Azure via
  `voiceAttrs(voiceProfile)`). Der Inbound-Pfad ruft `speak` unveraendert auf
  und bleibt damit unveraendert.

Adapter (`src/telephony/adapters/telnyx/voice.js`):
- Bei `useAssistantVoice === true` UND vollstaendiger `config.telnyxElevenLabs`
  (voiceId UND apiKeyRef nicht leer; `model` hat einen Default): Payload mit
  `voice: "ElevenLabs.<model>.<voiceId>"` + `voice_settings: { api_key_ref }`.
- Sonst (Fallback a): Azure-Payload wie heute.
- Die Konstruktion des ElevenLabs-Voice-Strings existiert bereits im Provisioner
  (`ELEVENLABS_VOICE_PREFIX`). Duplizierung vermeiden (S2): EINE gemeinsame
  Quelle fuer das Format `ElevenLabs.<model>.<voiceId>` (z. B. eine kleine
  Helper-Funktion, die Provisioner und Adapter nutzen — Import-Richtung
  beachten: `scripts/` darf aus `src/` importieren, nicht umgekehrt).
- `language`-Feld: gegen die Telnyx-OpenAPI-Spec pruefen, ob `language`
  zusammen mit einer ElevenLabs-Voice zulaessig ist. Im Zweifel bei
  ElevenLabs-Voice WEGLASSEN (nur bei Azure-Voice senden) und das im
  Code-Kommentar begruenden. Ein 400 ist durch die Fallback-Kette abgedeckt,
  soll aber nicht der Normalfall sein.

Observability (PFLICHT — sonst ist "Azure statt ElevenLabs" im Live-Betrieb
unsichtbar): EIN Log-Marker beim Opening, ohne PII und ohne Secrets, z. B.
`[voice/call-control] opening_voice=elevenlabs|azure (call=<id>)`, plus bei
`azure` einen knappen Grund (`reason=config_missing|retry_after_failure`).

### P1.2 — Fallback-Kette (Regel 2: das Opening darf NIE ausfallen)

Policy im Ingest (`src/telnyx-call-control-ingest.js`), Mechanismus im Adapter:
- (a) ElevenLabs-Config unvollstaendig -> direkt Azure (kein Retry noetig).
- (b) ElevenLabs-`speak` scheitert SYNCHRON (Adapter wirft, z. B. 400) ->
  genau EIN Retry mit `useAssistantVoice: false` (Azure).
- (c) ElevenLabs-`speak` scheitert per EVENT (`call.speak.failed` ->
  `onSpeakFailed`) -> genau EIN Retry mit `useAssistantVoice: false` (Azure).
- (d) Scheitert auch der Azure-Retry (synchron oder per Event), greift der
  HEUTIGE `onSpeakFailed`-Fail-Safe unveraendert: kein `startAssistant`.
- Retry-State: pro Call genau EIN Retry (Endlosschleife
  speak.failed -> retry -> speak.failed ausgeschlossen). Ephemerer In-Memory-
  State im Ingest-Closure (analog zum Watchdog-Map-Muster), aufgeraeumt in
  `onHangup`. Prozess-Restart mid-Call = kein Retry mehr = heutiges Verhalten
  (akzeptiert, im Kommentar festhalten).
- `speak.ended` -> `startAssistant` -> `watchdog.arm()`: Reihenfolge und
  Fail-Safe-Semantik UNVERAENDERT.

### P1.3 — `user_idle_reply_secs` 10 -> 4 (Provisioner = Single Source of Truth)

`scripts/telnyx-assistant-provision.mjs`:
- `buildAssistantConfig` ergaenzt `telephony_settings: { user_idle_reply_secs: <konst> }`
  mit benannter Konstante (Wert 4). Keine weiteren `telephony_settings`-Felder
  (Deep-Merge erhaelt sie).
- **BUGFIX (Voraussetzung):** Der Update-Pfad muss `POST /v2/ai/assistants/{id}`
  benutzen, nicht `PUT` (PUT => 404, Re-Provisioning war nie funktionsfaehig).
  Die Create-Route (`POST /v2/ai/assistants`) bleibt wie sie ist.
- Tests: `test/telnyx-assistant-config.test.js` erweitern —
  (1) `buildAssistantConfig` enthaelt `telephony_settings.user_idle_reply_secs === 4`;
  (2) die Update-Request-Bildung liefert Methode `POST` und die
  `/{assistantId}`-URL (dafuer ggf. eine kleine, exportierte Helferfunktion, die
  `{ method, url }` aus `existingId` ableitet — kein Netz im Test).

### Tests P1 (node:test, offline)

- Adapter (`test/telnyx-call-control.test.js`-Muster, `global.fetch`-Stub):
  - `useAssistantVoice: true` + vollstaendige ElevenLabs-Config -> Body traegt
    `voice: "ElevenLabs.<model>.<voiceId>"` + `voice_settings.api_key_ref`.
  - `useAssistantVoice: true` + leere Config -> Azure-Body (byte-identisch zu
    heute).
  - Ohne Parameter -> Azure-Body (Regression: Inbound unveraendert).
- Ingest (`test/telnyx-event-ingest-machine.test.js`-Muster):
  - Sync-Fehler beim ElevenLabs-`speak` -> genau ein zweiter `speak`-Aufruf mit
    `useAssistantVoice: false`; danach kein dritter.
  - `speak.failed`-Event -> genau ein Azure-Retry; zweites `speak.failed` ->
    KEIN weiterer Retry, KEIN `startAssistant` (Fail-Safe intakt).
  - `speak.ended` nach dem Retry -> `startAssistant` + `watchdog.arm()` wie heute.

### Erwartungen (Live, im gebuendelten Testanruf)

E1.1 eine Stimme durchgehend; E1.2 Offenlegung vollstaendig und woertlich zuerst;
E1.3 Idle-Nudge <= ~7s nach `speak.ended` (FAIL > 10s); E1.4 `speak.ended` im
Event-Log VOR `ai_assistant_start`.

### Explizit NICHT

Kein Greeting-Feld, keine Aenderung an `openingText`/Disclosure-Inhalt, keine
neuen Env-Vars, kein Anfassen des Inbound-Pfads, kein `start_speaking_plan`,
keine Eager-EOT-/`eot_timeout_ms`-Aenderung (das ist P5, separat).

---

## P2 — STT-Sprach-Hint pro Call (fixt R2)

Ziel: Deutsche Aeusserungen kommen als deutscher Text beim LLM an (heute:
NL/EN-Kauderwelsch, weil das Assistant-Objekt `language: "multi"` = Auto-Detect
fuehrt).

### Aenderung

Port (`src/telephony/ports.js`): `startAssistant` bekommt die NEUTRALE
Gespraechssprache (kein Provider-String):

    startAssistant({ callControlId, assistantId, language })

- `language` = `call.language` (`"de" | "fr" | "en"`, Werte aus
  `src/i18n/locales.js`). OPTIONAL: fehlt der Wert, wird KEIN
  `transcription`-Feld gesendet -> Body byte-identisch zu heute (Inbound bleibt
  damit unveraendert; P6 zieht spaeter nach).

Adapter (`src/telephony/adapters/telnyx/voice.js`), adapter-intern:
- Mapping `language` -> `transcription: { model: "deepgram/flux", language: <hint> }`.
- Von flux unterstuetzte Hints direkt durchreichen: `en, es, fr, de, hi, ru, pt,
  ja, it, nl`. Alles andere (inkl. unbekannt) -> `"auto"`. NIE `"multi"`
  (= dokumentiert "kein Sprach-Hint" = genau der Live-Defekt).
- Benannte Konstanten (Modellname, Hint-Liste, `"auto"`), keine Magic Strings
  verstreut.

Call-Site: `onSpeakEnded` in `src/telnyx-call-control-ingest.js` reicht
`call.language` durch. Das Assistant-Objekt bleibt unveraendert (der
per-Call-Override gewinnt).

### Tests P2 (node:test, offline)

- Adapter: `language: "de"` -> Body enthaelt
  `transcription: { model: "deepgram/flux", language: "de" }`.
- Adapter: `language: "tr"` (nicht in der flux-Liste) -> `language: "auto"`.
- Adapter: kein `language` -> KEIN `transcription`-Feld im Body (Regression
  Inbound).
- Ingest: `onSpeakEnded` reicht `call.language` an `startAssistant` durch.

### Erwartungen (Live)

E2.1 deutscher Transkript-Text in `/v2/ai/conversations/{id}/messages`, verifiziert
gegen eine Whisper-Referenztranskription derselben Aufnahme-Segmente
(`/v2/ai/audio/transcriptions`); E2.2 kein NL/EN-Artefakt; E2.3 Median-TTFA
<= 2.5s (sonst wird P5 PFLICHT); E2.4 Beobachtung Mid-Call-Sprachwechsel
(Englisch-Probe) — wenn der Hint den Wechsel nachweislich unterdrueckt:
Entscheidungsregel -> `"auto"` statt Sprach-Hint.

### Explizit NICHT

Kein Anfassen des Assistant-Objekts fuer `transcription`, kein `"multi"`, kein
STT-Modellwechsel (das ist die Fallback-Leiter im Plan, nicht diese Phase).

---

## P3 — end_call verschluckt den Abschied nicht mehr (fixt R4)

Ziel: Der Abschiedssatz wird vollstaendig gespielt, BEVOR aufgelegt wird (heute:
Hangup 81ms nach der Completion, Abschied nie hoerbar).

### Aenderung

`src/telnyx-conversation-watchdog.js` (besitzt bereits Timer-Ownership,
`setTimer`/`clearTimer`-Seam und das `clear`-Aufraeumen):

- Neue API: `scheduleFarewellHangup(callId, speechChars)`.
- `delayMs = clamp(FAREWELL_BASE_MS + speechChars * FAREWELL_MS_PER_CHAR,
  FAREWELL_MIN_MS, FAREWELL_MAX_MS)` mit benannten Konstanten
  (1500 / 70 / 3000 / 12000; ~14 Zeichen/s + Anlauf).
- Waehrend ein Farewell-Timer laeuft, ist der Dead-Air-Timer dieses Calls
  SUSPENDIERT (das ist der Schutz gegen praeemptives Terminate, Doppel-Hangup
  und irrefuehrende `dead_air`-Logs). KEINE zusaetzliche
  delayMs-vs-deadAir-Invariante (redundant und bei
  `TELNYX_DEAD_AIR_TIMEOUT_S=5` unerfuellbar).
- Kommt waehrend des Delays ein NEUER Turn (`observeTurn`), wird der
  Farewell-Timer GECANCELT (der Abschied war verfrueht, das Gespraech laeuft
  weiter; beendet wird am naechsten `end_call`-Turn).
- Feuert der Farewell-Timer: genau EIN `terminate(callId)` + State-Cleanup
  (kein zweites Terminate, keine unhandled rejection — Muster von `onDeadAir`).
- `clear(callId)` (Hangup, egal welche Quelle) loescht ALLE Timer des Calls,
  auch den Farewell-Timer. Externer Hangup gewinnt immer.

`src/telnyx-llm-shim.js`:
- Im `end_call`-Zweig statt sofortigem `terminateCall(call.id)`:
  `watchdog.scheduleFarewellHangup(call.id, <Laenge des gesprochenen Textes>)`.
- Die uebrigen Terminate-Pfade (Loop-Guard, Budget-Kill, Fehler) bleiben
  SOFORTIG — das sind Notaus-Pfade, kein Abschied.
- Log-Marker `[telnyx-shim] farewell_scheduled {callId, delayMs}` (kein PII,
  kein Text-Inhalt).

Restrisiko (bewusst): Prozess-Restart mid-Delay verliert den Timer; Backstops
bleiben Dead-Air-Watchdog (Re-Arm), Telnyx `time_limit_secs=1800`, Budget-Gates.
In `PLAN-SECURITY.md` als bewusste Abweichung dokumentieren (verzoegerter
Hangup, gedeckelt 12s).

### Tests P3 (node:test, Fake-Timer — `test/telnyx-stab-p9-watchdog.test.js`-Muster)

- Farewell-Delay laeuft ab -> genau ein `terminate`.
- `observeTurn` waehrend des Delays -> Timer gecancelt, KEIN `terminate`.
- `clear` (Hangup) waehrend des Delays -> genau ein Cleanup, KEIN zweites
  `terminate`.
- Dead-Air-Timer feuert waehrend des Farewell-Delays NICHT (Suspend).
- `delayMs`-Clamping: kurzer Text -> Minimum, sehr langer Text -> Maximum.
- Shim: `endCall === true` -> `scheduleFarewellHangup` statt sofortigem
  `terminateCall`; Loop-Guard/Budget-Kill -> weiterhin sofortiges Terminate.

### Erwartungen (Live)

E3.1 Abschiedssatz vollstaendig auf dem Agent-Kanal VOR `call.hangup`;
E3.2 Hangup >= Ende des letzten Agent-Sprachsegments und <= Segment-Ende + ~4s.

---

## P4 — end_call-Disziplin (mitigiert R3)

NUR Prompt-Regel. Der Turn-Zaehler-Guard (P4.2) ist vom Owner GESTRICHEN.

### Aenderung

`src/claude.js`, am Tool-Entscheidungspunkt (Lehre `call-quality-chain`: enge
Verbote genau dort, breite Stil-Regeln kippen in Ueberkorrektur):
- Regel: `end_call` NUR, wenn (a) im selben Turn eine Verabschiedung
  ausgesprochen wurde UND (b) der letzte Beitrag des Gegenuebers verstanden
  wurde. Bei unverstaendlichem/zusammenhanglosem Input: EINMAL nachfragen statt
  aufzulegen.
- Der bestehende `suppressEndCall`-Seam bleibt UNVERAENDERT (kein paralleler
  Guard, keine Erweiterung).
- Keine Aenderung an der `end_call`-Tool-Definition ausser, wenn noetig, einer
  praezisierenden Description am selben Entscheidungspunkt.

### Tests P4

- E4.2: Bestandssuite gruen + `node --check`.
- Deterministischer Test: der gebaute System-Prompt enthaelt die
  end_call-Disziplin-Regel (fuer alle Sprachen, da das Prompt-Geruest deutsch ist).
- E4.1 (Bench, braucht Netz + `ANTHROPIC_API_KEY`, NICHT Teil von `npm test`):
  neues Szenario in `scripts/convo-bench/scenarios/index.mjs` —
  "unverstaendliche Erstantwort" (Persona antwortet mit Kauderwelsch). Erwartung:
  Der Agent legt NICHT sofort auf, sondern fragt EINMAL nach. Lauf mit
  `--repeat >= 5` (Scores poolen, n>=5), keine Regression in den uebrigen
  Szenarien.

### Explizit NICHT

Kein Turn-Zaehler-Guard, kein semantischer Konfidenz-Guard, keine Aenderung an
`suppressEndCall`, keine Aenderung an Watchdog/Budget/Max-Dauer.
