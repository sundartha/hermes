# Impl-1 Report: Anrufqualitaet (Branch call-quality) — 2026-07-02

Umsetzung der Items I1-I13 aus tasks/call-quality-findings.md. Implementierung durch
Sonnet-Subagent (vom Owner vor den I8-Unit-Tests gestoppt); Lead hat reviewt, die
I8-Tests finalisiert (1 Erwartungswert-Fix: fehlender Schlusspunkt) und verifiziert.

## Status pro Item

| Item | Status | Anmerkung |
|---|---|---|
| I1a/I1b Anti-Interview (Buchungs-Titel + "frage nie nach Bekanntem") | UMGESETZT | claude.js allowBooking-Bullet + Outbound-SITUATION-Satz |
| I2 Turn-Fallback lokalisiert + richtungsabhaengig | UMGESETZT | locales.turnFallbackSpeech de/fr/en; DE-inbound byte-identisch; test/turn-fallback-locale.test.js (4 Tests) |
| I3 Quittierungs-Regel | UMGESETZT | REGELN-Bullet |
| I4 Datum/Uhrzeit natuerlich + TTS-Interpunktion | UMGESETZT | REGELN-Bullet |
| I5 Tool-Ergebnis-Gedaechtnis-Regel | UMGESETZT | REGELN-Bullet |
| I6 Kalender-Sektion richtungsneutral (inbound) + Inbound-Slot-Strategie | UMGESETZT | outboundCalendarSection -> calendarSection, Inbound-Zweig + Aufgaben-Satz; l2-Tests bewusst gedreht (Test 3) + neues fail-closed-Gate 4b |
| I7 Fragment-Regel | UMGESETZT | REGELN-Bullet |
| I8 shapeForSpeech | UMGESETZT | pure Funktion vor Fallback/addTranscript; Wort-Bindestriche geschuetzt; test/shape-for-speech.test.js |
| I9 objective-Description | UMGESETZT | "wird WOERTLICH vorgelesen", Thema-Pflicht, sonst Nutzer fragen |
| I10 context_received-Echo | UMGESETZT | server.js /api/calls-Antwort + mcp-tools CALL_OUTPUT + defensive Normalisierung (aelterer Gateway-Mock crasht nicht, fail-closed "nichts angekommen") |
| I11 summarySystem konkrete Fakten | UMGESETZT | de/fr/en |
| I12 assistantContextEnabled Default true | UMGESETZT | config.js + .env.example; BASE_ENV pinnt weiterhin explizit false (test/helpers.js:150, Drift-Schutz war schon da) |
| I13 metrics.llmCall additiv | UMGESETZT | callId (via llm.complete-Param, wird vor SDK-Call abgestreift) + cache_creation/cache_read_input_tokens, nur wenn vorhanden (kein Rauschen im Fehlerpfad) |

## Neue REGELN-Bullets (exakter Wortlaut)

- "Reagiere zuerst kurz und natuerlich auf das zuletzt Gesagte (z.B. \"Alles klar,\" / \"Gut,\"), bevor du weitersprichst."
- "Beziehe kurze oder unklare Aeusserungen des Gegenuebers auf deine letzte Frage, statt das Thema zu wechseln."
- "Sprich Datum und Uhrzeit natuerlich aus (z.B. \"Donnerstag um 17 Uhr\"), nie rohe Tool-Formate; keine Klammern, Anfuehrungszeichen oder Gedankenstriche."
- "Nenne das Ergebnis eines Tool-Aufrufs in deiner naechsten gesprochenen Antwort - der Gespraechsverlauf ist deine einzige Erinnerung daran."

Alle statisch (keine Call-Interpolation) -> Prompt-Cache-Praefix bleibt stabil.

## Golden-Master-/Test-Aenderungen (bewusst)

- personal-assistant-characterization.test.js: EXPECTED_SP_* um die 4 Bullets +
  I1a/I1b/I6-Saetze erweitert (gegen tatsaechlichen Output verifiziert).
- l2-calendar-prefetch.test.js: Test 3 von "inbound traegt KEINEN Kalender-Header"
  auf "traegt ihn jetzt" gedreht (I6, gewollte Verhaltensaenderung) + Test 4b neu
  (inbound fail-closed ohne allowCalendar).
- mcp-ui.test.js: place_call-structuredContent-Shape um context_received erweitert
  (inkl. Defensiv-Normalisierung-Assert).
- f1-i18n-locale.test.js: summarySystem-Pins um I11-Klausel nachgezogen.
- NEU: turn-fallback-locale.test.js (4), shape-for-speech.test.js (3).

## Verifikation

- node --check auf allen 7 geaenderten src-Dateien: OK.
- `npm test`: **1506 pass / 0 fail** (Baseline vor der Scheibe: 1493/1493).
- Unantastbar geblieben (per Test gepinnt): disclosureSentence/openingText
  byte-identisch, /voice/outbound LLM-frei, Safety-Gates/Auth unveraendert.

## Offene Punkte

- Bench-A/B (baseline b3d859f vs. diese Scheibe) steht aus -> tasks/todo.md Punkt 3/4.
- Wirkung der Prompt-Regeln auf echtes Gespraechsverhalten wird NUR ueber die
  Conversation-Bench belegt (Judge-Kohaerenz/Naturalness), nicht behauptet.
