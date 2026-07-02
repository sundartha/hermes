# Anrufqualitaet Post-G: Befund-Synthese + Entscheidungen (2026-07-02)

Quelle: Analyse-Workflow (5 Sonnet-Agenten: Gespraechslogik, TTS/SSML, Latenz,
MCP-Nahtlosigkeit, Bench-Design), Lead-Synthese. Constraints: KEIN Modell-Wechsel
(Haiku/nova-3/Katja bleiben), Safety-Gates/Offenlegung unantastbar, /voice/outbound
LLM-frei, Verifikation ohne echte Anrufe (Conversation-Bench, siehe
tasks/convo-bench-spec.md).

## Entscheidung: JETZT umsetzen (Scheibe "Impl-1", Branch call-quality)

| # | Befund (Sev) | Fix | Dateien |
|---|---|---|---|
| I1 | Kein Umgang mit fehlendem Buchungs-Anlass -> "Thema?"-Verhoer (S1) | Anti-Interview-Regel: Titel aus AUFTRAG ableiten oder take_message, nie verhoeren (allowBooking-Bullet + Outbound-Satz) | src/claude.js + Golden-Master-Tests |
| I2 | Fallback-Satz hart de + bei Outbound richtungsverkehrt (S1) | locales.turnFallbackSpeech {inbound,outbound} de/fr/en; claude.js:405 direction-aware; DE-inbound byte-identisch | src/claude.js, src/i18n/locales.js, neuer Test |
| I3 | Kein Quittierungs-/Uebergangsmuster -> Staccato (S2) | Prompt-Bullet: kurze natuerliche Reaktion vor dem Weitersprechen | src/claude.js |
| I4 | Rohe Datums-/Zahlenformate + TTS-feindliche Interpunktion (S2/S1-tts) | Prompt-Bullet: Datum/Uhrzeit natuerlich sprechen ("Donnerstag um 17 Uhr"), keine Klammern/Anfuehrungszeichen/Gedankenstriche | src/claude.js |
| I5 | Tool-Ergebnisse ueberleben Turns nicht (History nur aus Transkript) (S2) | Prompt-Bullet: Tool-Ergebnis in der naechsten Antwort nennen (Mitigation; Struktur-Umbau = Folgearbeit) | src/claude.js |
| I6 | Inbound fragt statt Kalender zu nutzen; Inbound ohne Kalender-Prefetch = Extra-Roundtrip (S2, 2 Agenten unabhaengig) | Kalender-Sektion richtungsneutral auch inbound einbetten (allowCalendar-Gate) + Inbound-Strategie-Satz (konkrete Slots anbieten) | src/claude.js |
| I7 | STT-Fragment-Regel fehlt (S3) | Prompt-Bullet: Fragment auf letzte eigene Frage beziehen | src/claude.js |
| I8 | Kein deterministisches Text-Shaping vor <Say> (S1-tts) | shapeForSpeech(text): Whitespace, Markdown-Reste, Aufzaehlungs-/Gedankenstriche, Satzende; pure, vor Fallback/addTranscript | src/claude.js + Unit-Test |
| I9 | objective erzwingt kein Thema, wird aber woertlich vorgelesen (S1) | place_call objective-Description verschaerfen (wird vorgelesen; Thema/Anlass Pflicht wenn bekannt; sonst erst Nutzer fragen) | src/mcp-tools.js |
| I10 | place_call meldet nie, welcher Kontext ankam (S2) | context_received-Meta additiv in /api/calls-Antwort + place_call structuredContent (active=false wenn Flag aus) | src/server.js, src/mcp-tools.js + Test |
| I11 | Summary ohne konkrete Fakten ("zur Buchung vorgesehen") (S2) | summarySystem-Klausel: konkrete Ergebnisse (Datum/Uhrzeit/Preis/Name) nennen | src/i18n/locales.js |
| I12 | context-Kanal live tot: Default false (S1) | config-Default assistantContextEnabled -> true (Praezedenz mcpUiEnabled; Feature migriert + 10 Tests, R3 = Anti-Spoofing bewiesen); .env.example nachziehen; Test-Pins bewusst justieren (BASE_ENV pinnt false weiter) | src/config.js, .env.example, Tests |
| I13 | metrics.llmCall ohne Cache-Zaehler/Turn-Zuordnung -> Bench kann Latenz/Cache nicht messen (S2) | additiv cache_creation/cache_read_input_tokens (+ callId nur falls sauber durchreichbar) | src/metrics.js, src/llm.js |

## Entscheidung: NICHT jetzt (bewusst)

- **SSML (break/prosody)**: Telnyx-<Say>+SSML ohne Erstquellen-Beleg; Injection-Seam
  noetig; Katja hat KEINE express-as-Styles. -> Erst Text-Shaping (I4/I8); SSML nur
  nach echtem Telnyx-Struktur-Check (Owner-Live-Gate).
- **speechTimeout senken (2s -> 1.5s)**: garantierter Stille-Posten, aber
  Truncation-Historie (G3). Textuelle Bench kann echtes Endpointing nicht messen ->
  Owner-Live-Gate, Wert ist env-tunebar ohne Code.
- **Deterministische Buchungsbestaetigung (Roundtrip sparen)**: A/B-Kandidat fuer die
  Bench, Risiko Template-Kuenstlichkeit. Erst nach Baseline bewerten.
- **Turn-Timeout vom Summary-Timeout entkoppeln / Wall-Clock ueber Tool-Loop**:
  sinnvoll, aber eigener llm.js-Schnitt mit eigenem Review. Folge-Ticket.
- **keyterms (Deepgram-Vokabular-Bias)**: additiv moeglich, Wirkung offline nicht
  verifizierbar. Folge-Ticket/Live-Gate.
- **Filler-Audio waehrend LLM-Verarbeitung**: TeXML strukturell synchron, kein
  bargeIn dokumentiert -> Architektur-Entscheidung (Kurz-Say+Redirect-Kette oder
  Call-Control-API), NICHT Teil dieses Schnitts.
- **Transcript um Tool-Ergebnis-Kanal erweitern** (Wurzel-Fix zu I5): Store-Vertrag +
  Persistenz -> eigene Phase mit Owner-Entscheidung.

## OWNER-only (kann nur Antonio; siehe Abschluss-Report)

- O1: Render-Env `METRICS_ENABLED=true` (render.yaml:186 steht false) — ohne das gibt
  es NULL Live-Latenzzahlen. Reine Diagnose, kein Safety-Riss.
- O2: Render plan:free -> Always-on (Cold-Start kann JEDE andere Ursache dominieren;
  deckt sich mit docs/strategy/project-audit-2026-06-19.md).
- O3: Telnyx Mission Control: konfiguriertes TeXML "hang-up on timeout" pruefen.
- O4: Voice-Alternativen (andere Azure-Stimme/ElevenLabs) = Modell-Entscheidung des
  Owners, hier bewusst NICHT angefasst; Katja hat keine Style-Tags.
- O5: Nach Deploy: ASSISTANT_CONTEXT_ENABLED wird durch I12 default-true — kein
  Env-Eingriff mehr noetig; nur wissen, dass der Kontext-Block jetzt im System-Prompt
  an Anthropic geht (gleiche Datenklasse wie briefing heute).

## Verifikation

1. `npm test` gruen (Baseline Worktree: 1493/1493).
2. Bench-Baseline (master-Stand) vs. Candidate (diese Scheibe), gleiche Szenarien,
   --repeat 3: kein deterministischer Check schlechter, Judge-Kohaerenz/Naturalness
   im termin-duenn-/friseur-voll-Szenario >= Baseline.
3. Charakterisierung: disclosure byte-identisch; /voice/outbound weiter LLM-frei.
