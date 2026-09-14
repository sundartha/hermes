# Kickoff: Inbound klingt wie Outbound

Geschrieben 2026-09-14. Diese Datei hat Vorrang vor `tasks/kickoff-inbound-ein-system.md` und
`tasks/inbound-ein-system-stand.md` (beide nur noch Hintergrund).

**Jede Aussage hier ist gemessen (Quelle genannt). Was nicht gemessen ist, steht in Abschnitt 4
und darf nicht als Prämisse benutzt werden.**

---

## 1. Die Aufgabe (Owner, wörtlich sinngemäß)

Ein eingehender Anruf soll **dieselbe Gesprächsqualität** haben wie ein ausgehender. Das ist die
einzige Aufgabe. Phasen, Löschungen und Aufräumarbeit sind kein Ergebnis, solange ein Inbound-Anruf
nicht hörbar wie Outbound klingt.

**Reihenfolge, vom Owner festgelegt:**
1. **Zuerst Inbound auf den ElevenLabs-Agenten umstellen** (derselbe Agent, der Outbound führt).
2. Echter Inbound-Testanruf durch den Owner, der hörbar wie Outbound klingt.
3. **Erst ganz am Ende** die Budget-Engine löschen.

**Was die vorige Sitzung falsch gemacht hat — nicht wiederholen:** die Umstellung (1) war blockiert
(3.7), und statt anzuhalten hat sie die Nebenaufgabe gemacht (zwei ungenutzte Engines gelöscht).
Regel daraus: **ist Schritt 1 blockiert, sofort stoppen und dem Owner sagen, was fehlt. Keine
Ersatzarbeit.**

**Zur Klarstellung der Engines** (war für den Owner missverständlich): es gab vier. Gelöscht sind die
zwei, die live nie Anrufe führten (Telnyx-AI-Assistant, OpenAI-Realtime-Bridge). Die **Budget-Engine**
(Telnyx-Gather → unser Sprachmodell → Vorabsynthese) führt Inbound weiterhin und darf erst nach
Schritt 2 weg. Der **ElevenLabs-Agent** führt Outbound.

## 2. Arbeitsweise (Owner, verbindlich)

- **Lean Lead.** Der Lead orchestriert und entscheidet, er liest keinen Code und keine Diffs selbst.
  Recherche, Messung und Umsetzung laufen über Subagenten bzw. `.claude/workflows/runs/inbound-paritaet-lean.js`.
  Die vorige Sitzung hat ~500k Token im Lead verbraucht; der Owner sagt, damit sind keine guten
  Entscheidungen mehr möglich.
- Keine Annahmen. Unklar → messen oder den Owner fragen.
- Große Umbauten nicht in EINEN Umsetzungs-Agenten legen: IE6-S1 kostete 755 Mio Token
  (Umsetzungs-Agent 1159 Turns), IE6-S2 375 Mio (852 Turns) — gemessen mit `node scripts/workflow-kosten.mjs`.

## 3. Gemessene Fakten

### 3.1 Live-Stand (Render, Service `srv-d8m0fhflk1mc73bno570`)

Deploy `dep-dajtcoh594qs73di7ijg`, Commit `fa24414`, Instanz `-gqz6m`, live seit 2026-09-14 11:12 UTC
(Quelle: `list_deploys`, Boot-Banner):
- `Voice-Engine: budget`
- `Inbound-Sprechpfad: play_tts (ELEVENLABS_PLAY_TTS_ENABLED=true)`
- `CLAUDE_MODEL=deepseek-v4-pro`
- keine Assistant-Zeile mehr im Banner (Telnyx-AI-Assistant und OpenAI-Realtime-Bridge sind entfernt
  und live, Commits `6621039`, `aa4a681`; Regression-Bank danach 5543/5543 grün)
- Env laut Owner im Dashboard: `VOICE_TARIFF_DEFAULT_CENTS=30`, `VOICE_ENGINE=budget`;
  `VOICE_TARIFF_GRUNDBETRAG_CENTS` existiert nicht.

### 3.2 Der Owner-Testanruf nach dem Deploy: `call_mu15unxcw3xi`

Render-Log, Instanz `-gqz6m`, 2026-09-14:

| Zeit (UTC) | Logzeile |
|---|---|
| 11:29:35 | `inbound_path {"path":"budget"}` |
| 11:29:38 | `[play-tts] Synthese vollstaendig (erstes Audio 638 ms, Gesamt 3318 ms)` (Begrüßung) |
| 11:30:02 | `speech_result chars=36` |
| 11:30:03 | `llm latencyMs=1652` → `turn roundtrips=1` |
| 11:30:04 | `[play-tts] erstes Audio 151 ms, Gesamt 915 ms` |
| 11:30:16 | `stt_gap gapMs=12834`, `speech_result chars=88` |
| 11:30:18 | `llm latencyMs=1787` → Synthese 147 / 1337 ms |
| 11:30:35 | `stt_gap gapMs=16929`, `speech_result chars=35` |
| 11:30:37–39 | `llm latencyMs=2228` + `2055`, `turn roundtrips=2 tools=["take_message"]` → Synthese 171 / 1394 ms |
| 11:30:47 | `[voice/status] completed callDurationS=72 hangupSource=caller` |
| 11:30:50 | Zusammenfassung `llm latencyMs=3503`; `[sms] Telnyx sendSms fehlgeschlagen: HTTP 400 (40305 Invalid 'from' address)` |

**Owner-Bericht zu diesem Anruf** (nicht gemessen, aber seine Wahrnehmung): ~30 s bis zur Antwort,
Begrüßung braucht ~30 s, spricht langsam, Stimme klingt „doof", antwortet dumm; auf „ich will morgen
einen Termin" fragte der Agent nach dem Wochentag. „Hört sich genauso an wie vorher."

**Warum „wie vorher" stimmt:** der Anruf lief über die Budget-Engine (`inbound_path budget`), also
denselben Weg wie vor der Nacht: Telnyx-TeXML-Gather (STT) → unser Sprachmodell (`claude.js`, DeepSeek)
→ ElevenLabs-Vorabsynthese (`<Play>`). IE6-S1/S2 haben nur ungenutzte Engines entfernt; die
Invariante dort war „Inbound-TeXML byte-identisch". An der Inbound-Gesprächsführung hat sich nichts geändert.

### 3.3 Outbound

Läuft über den ElevenLabs-ConvAI-Agenten per `POST /v1/convai/sip-trunk/outbound-call` (Code-Zweig
`config.voice.elevenLabsOutbound.enabled` in `src/routes/api-calls.js`, vor allen anderen Zweigen).
Owner-Testanruf `call_mu099j471pla` am 2026-09-13: gut verständlich, Agent antwortete normal
(Quelle: vorheriger Kickoff; in dieser Sitzung nicht neu gemessen).

### 3.4 Der ElevenLabs-Agent (`GET /v1/convai/agents/<ELEVENLABS_AGENT_ID>`, 2026-09-13 ~20:50 UTC)

- `first_message`, Prompt und Werkzeuge referenzieren **14** dynamic variables: `owner_name,
  opening_line, callee_relation, callee, objective, constraints, background, today, owner_timezone,
  callee_timezone, consult_available, lookup_available, mandate, voicemail_line`.
- `dynamic_variable_placeholders` nur für 4: `owner_name, objective, callee, mandate`.
- `first_message` ist der Outbound-Offenlegungssatz (Vorlage: `LOCALES.en.disclosure`), 149 Zeichen.
- `agent.language=en`, `language_presets`: de, fr, es. `tts.model_id` je Anruf NICHT übersteuerbar.
- `turn.silence_end_call_timeout=30`, `conversation.max_duration_seconds=600`.
- Conversation-Initiation-Webhook: `null`.
- Gemessen am 2026-08-14 (Spike 2, `tasks/spike2-messung.jsonl`): fehlt eine Variable der
  `first_message`, beendet ElevenLabs das Gespräch direkt nach dem Abheben (Code 1008), der Angerufene hört Stille.

### 3.5 ElevenLabs-Nummern (`GET /v1/convai/phone-numbers`, 2026-09-13)

Vier Registrierungen, alle am Agenten „Hermes". Nur `phnum_1101m00pjrg7e1js7aaxwp8hdw38`
(Label „Spike2 Telnyx", Nummer …0177) trägt `inbound_trunk`: `allowed_addresses ["0.0.0.0/0"]`,
`allowed_numbers [<eigene Nummer>]`, keine Zugangsdaten. Die anderen drei (…1188, …4874, …8341)
haben kein `inbound_trunk`. Laut Memory `e5-absender-did-live` gehört …0177 seit 24.08. nicht mehr
zum Telnyx-Konto und ist in Produktion unreferenziert.

### 3.6 Anbieter-Doku (abgerufen 2026-09-13)

- ElevenLabs SIP inbound: INVITE an `sip:<Kennung>@sip.rtc.elevenlabs.io:5060`, Auth per Digest oder
  IP-ACL; `X-`Header werden zu `sip_*`-Variablen. **Wie** ein INVITE einem Agenten zugeordnet wird:
  nicht dokumentiert. Verhalten bei fehlenden Variablen: nicht dokumentiert.
  (elevenlabs.io/docs/eleven-agents/phone-numbers/sip-trunking)
- ElevenLabs API `inbound_trunk_config` hat `attributes_to_headers` („Map of dynamic variable name to
  header name") — Wirkung ungemessen. (elevenlabs.io/docs/api-reference/phone-numbers/update)
- Telnyx TeXML `<Dial>`: `action`, `timeout` 5–120, `timeLimit` 60–14400; `<Sip>`: `username`, `password`.
  (developers.telnyx.com/docs/voice/programmable-voice/texml-verbs/dial)
- Telnyx TeXML-Anrufe per API akzeptieren Inline-`Texml`; TeXML- und Call-Control-Apps haben
  `inbound.sip_subdomain` (Telnyx OpenAPI / API-Referenz).

### 3.7 Was die Ausführungsumgebung dem Agenten verweigert (Auto-Mode-Classifier, 2026-09-13/14)

- Skript, das echte Testanrufe auslöst (Telnyx → ElevenLabs-SIP) → `Real-World Transactions`
- `cloudflared`-Tunnel → `External Ingress Tunnel`
- `psql` gegen Prod-DB, nur lesend → `Production Reads`
- `git push upstream master` → `Production Deploy`. Seit 2026-09-14 steht eine Allow-Regel
  `Bash(git push upstream master)` in `.claude/settings.local.json` — **ob sie greift, ist nicht getestet.**
- Render `trigger_deploy` → `Production Deploy`. Den Deploy löst der Owner im Dashboard aus.

Erlaubt waren: Anbieter-API lesen, zwei Wegwerf-Apps ohne Nummer anlegen, Render-Logs lesen, Doku lesen.

### 3.8 Vorhandene Wegwerf-Objekte bei Telnyx (ohne Nummer, ohne Verkehr)

TeXML-App `3048315229369796444`, Call-Control-App `3048315366347376485` (SIP-Subdomain
`hermesie15c3d4cd0`, `only_my_connections`). Angelegt für einen Probe-Aufbau ohne Tunnel; Beschreibung
in `tasks/ie1-messbericht.md` Abschnitt 3.

### 3.9 Folge der Löschung aus IE6-S2

Der im Plan benannte Rückfallweg K2 (Telnyx-Media-Streams ↔ ElevenLabs-WebSocket) hätte auf
`src/bridge.js`, dem Telnyx-Media-Adapter und `DIRECTIVE.STREAM` aufgebaut. Diese Bausteine sind
seit `aa4a681` entfernt; der Stand davor liegt in der git-Historie (`d333a25^` bzw. `6621039`).

## 4. Nicht belegt — nicht als Prämisse benutzen

- Ob im Testanruf das `<Play>`-Audio (ElevenLabs) oder der Azure-`<Say>`-Rückfall zu hören war. Das
  Log zeigt nur „Synthese vollstaendig", nicht das gerenderte Verb.
- Welches ElevenLabs-Modell und welche Stimm-ID der Inbound-Play-Pfad live benutzt
  (`ELEVENLABS_MODEL` wurde laut vorigem Kickoff am 13.09. auf `eleven_v3_conversational` gesetzt —
  in dieser Sitzung nicht nachgelesen) und ob sie dieselbe Stimme wie der Outbound-Agent ist (offene Messung M19).
- Was `stt_gap` genau misst und woraus die vom Owner erlebten ~30 s bestehen. Gemessen ist nur der
  LLM-Anteil: 1,7–2,2 s je Runde, 4,3 s mit Werkzeug.
- Warum der Agent bei „morgen" nach dem Wochentag fragte (Transkript nicht gelesen).
- Ob ein INVITE von Telnyx an `sip:<Kennung>@sip.rtc.elevenlabs.io` den Agenten erreicht, welche
  Variablen ankommen, ob unser Hangup danach noch wirkt, was im Fehlerfall passiert (IE1, F-A…F-F).
- Wie der eine Agent einen Inbound-Anruf eröffnet, ohne seinen Outbound-Offenlegungssatz zu sprechen
  und ohne an fehlenden Variablen zu scheitern.
- Warum die SMS am Anrufende mit 40305 scheiterte (eigener Befund, nicht diese Aufgabe).

## 5. Vorgehen

1. **Gleich zu Beginn, mit dem Owner:** klären, wie echte Testanrufe laufen dürfen. Die vorige
   Sitzung wurde dabei blockiert (3.7). Möglich sind eine Permission-Regel in
   `.claude/settings.local.json` für das Messskript oder der Owner startet es selbst per `!`. Der
   Owner ist bereit, selbst Testanrufe zu machen. Ohne diese Klärung nicht weiterarbeiten.
2. **Subagent, parallel:** am Code und an den Anbietern belegen, wie der ElevenLabs-Agent einen
   Inbound-Anruf eröffnen kann, ohne seinen Outbound-Satz zu sprechen und ohne an den 14 Variablen zu
   scheitern (3.4, Abschnitt 4). Kandidaten: `attributes_to_headers`, Conversation-Initiation-Webhook,
   Variablen in `first_message`/Prompt. Ergebnis als Fakten mit Quelle, keine Empfehlung ohne Beleg.
3. **Subagent:** den Übergabe-Weg messen (IE1 F-A…F-F in `PLAN-INBOUND-PARITAET.md`) mit den
   Objekten aus 3.8 und der Spike2-Registrierung; produktive DID und Live-Agent nicht verändern,
   Outbound bleibt unberührt.
4. **Bauen** (Workflow, kleine Umsetzungs-Agenten): Inbound → Pflichtsatz → Übergabe an den Agenten,
   hinter einem Schalter; Schalter aus = heutiges Verhalten. Die sieben Sicherungen in `/voice/incoming`
   bleiben vor der Übergabe (Absolute Regeln 1–3).
5. Owner pusht/deployt (3.7), stellt den Schalter an, macht den Inbound-Testanruf. Gemessen wird am
   Render-Log und am Anruf, nicht an Tests.
6. **Erst danach** Budget-Engine entfernen.

Nebenbei, nicht vor Schritt 5: Transkript von `call_mu15unxcw3xi` (warum „morgen" → Wochentag),
SMS-Fehler 40305.
