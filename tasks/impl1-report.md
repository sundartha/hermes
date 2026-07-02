# Impl-1 Report: Anrufqualitaet (Branch call-quality) — 2026-07-02

Umsetzung der Items I1-I13 aus tasks/call-quality-findings.md (Scheibe "Impl-1").
Finale Verifikation: `npm test` **1512 pass / 0 fail** (Baseline 1493/1493, +19 neue
Tests). Commits feb2497 + c126887 hat der Lead gesetzt (der Impl-Agent hat NICHT
committet, Vorgabe eingehalten).

## Status pro Item

| Item | Status | Anmerkung |
|---|---|---|
| I1a Anti-Interview Buchungs-Titel | UMGESETZT | claude.js allowBooking-Bullet erweitert (Titel aus AUFTRAG ableiten oder take_message, nie verhoeren) |
| I1b Outbound-SITUATION-Satz | UMGESETZT | "Du bist der Anrufer: frage nie nach Informationen, die du als Anrufer selbst wissen muesstest oder die bereits in deinem AUFTRAG/BRIEFING stehen." |
| I2 Turn-Fallback lokalisiert + richtungsabhaengig | UMGESETZT | locales.turnFallbackSpeech{inbound,outbound} de/fr/en; DE-inbound BYTE-IDENTISCH "Alles klar, vielen Dank fuer Ihren Anruf. Auf Wiederhoeren!"; claude.js agentTurn direction-aware; test/turn-fallback-locale.test.js (4 Tests, Mock liefert nur tool_use ohne Text) |
| I3 Quittierungs-Regel | UMGESETZT | REGELN-Bullet (statisch, cache-safe) |
| I4 Datum/Uhrzeit natuerlich + TTS-Interpunktion | UMGESETZT | REGELN-Bullet |
| I5 Tool-Ergebnis-Gedaechtnis | UMGESETZT | REGELN-Bullet |
| I6 Kalender-Sektion richtungsneutral + Inbound-Slot-Strategie | UMGESETZT | outboundCalendarSection -> calendarSection (Umbenennung + Kommentar), im Inbound-Zweig eingehaengt (gleiches allowCalendar-Gate, fail-closed); Inbound-Aufgaben-Satz "Bei einem Terminwunsch bietest du konkrete freie Zeiten aus <owner>s Kalender an, statt offen nach einer Wunschzeit zu fragen." |
| I7 Fragment-Regel | UMGESETZT | REGELN-Bullet |
| I8 shapeForSpeech | UMGESETZT | pure, exportierte Funktion in claude.js, angewendet auf speech VOR Fallback/addTranscript: Bullets am Zeilenanfang, Markdown-Reste [*_#`], " - "-Gedankenstriche -> Komma (NUR mit Leerzeichen beidseitig - "E-Mail"/"Kuendigungs-Service" bleiben intakt), Whitespace, haengendes ,;: vor Satzende-Ergaenzung (nie ",."), Satzende sicherstellen; test/shape-for-speech.test.js (13 Input/Output-Paare + Grenzfaelle + Idempotenz) |
| I9 objective-Description verschaerft | UMGESETZT | mcp-tools.js: (1) "wird ... WOERTLICH vorgelesen, BEVOR er antwortet", (2) "IMMER ein konkretes Thema/Anlass", (3) "frage ZUERST kurz beim Nutzer nach, statt einen vagen Auftrag abzusetzen"; kein Schema-Wechsel (P1-02 gruen); kein Test pinnte den Text woertlich; neuer Regex-Pin I9-01 |
| I10 context_received | UMGESETZT | server.js contextReceivedMeta() additiv in /api/calls-Erfolgsantwort {active,summary,key_facts_count,recipient_relationship,desired_outcome}; active=false wenn assistantContextEnabled aus; mcp-tools.js CALL_OUTPUT + place_call-structuredContent mit defensiver Normalisierung (fehlendes Feld -> fail-closed "nichts angekommen", kein Crash); Tests HC7-HC9 (HTTP) + T-I10 (structuredContent-Passthrough) |
| I11 summarySystem konkrete Ergebnisse | UMGESETZT | de/fr/en: "Nenne in der summary konkrete Ergebnisse (vereinbartes Datum/Uhrzeit, Preis, Name der Kontaktperson), sofern im Transkript vorhanden, statt allgemeiner Umschreibungen." (FR/EN sinngleich kuratiert) |
| I12 assistantContextEnabled Default true | UMGESETZT | config.js Muster mcpUiEnabled ((env \|\| "true") === "true"), Kommentar angepasst; .env.example nachgezogen (Default an, false zum Abschalten); BASE_ENV (test/helpers.js) pinnte das Flag SCHON explizit auf "false" -> unveraendert gelassen (Lesson test-base-env-drift, Flag-aus-Byte-Identitaet deterministisch); neuer Default-Pin test/assistant-context-default.test.js |
| I13 metrics.llmCall additiv | UMGESETZT | cache_creation_input_tokens/cache_read_input_tokens aus resp.usage (llm.js) + callId. callId WAR sauber durchreichbar: als additives Feld im params-Objekt von llm.complete({callId, ...params}) - llm.js streift es per Rest-Destrukturierung vor dem SDK-Call ab (kein unbekanntes Feld im Provider-Request, kein Signatur-Umbau). metrics.js bleibt Whitelist (bedingtes Anhaengen, PII-frei; Fehler-/Breaker-Pfad ohne Cache-Felder) |

## Neue Prompt-Bullets/-Saetze (exakter Wortlaut)

REGELN-Block (4 neue Bullets, alle statisch ohne Call-Interpolation = Cache-sicher):

- `- Reagiere zuerst kurz und natuerlich auf das zuletzt Gesagte (z.B. "Alles klar," / "Gut,"), bevor du weitersprichst.` (I3)
- `- Beziehe kurze oder unklare Aeusserungen des Gegenuebers auf deine letzte Frage, statt das Thema zu wechseln.` (I7)
- `- Sprich Datum und Uhrzeit natuerlich aus (z.B. "Donnerstag um 17 Uhr"), nie rohe Tool-Formate; keine Klammern, Anfuehrungszeichen oder Gedankenstriche.` (I4)
- `- Nenne das Ergebnis eines Tool-Aufrufs in deiner naechsten gesprochenen Antwort - der Gespraechsverlauf ist deine einzige Erinnerung daran.` (I5)

Erweiterungen bestehender Zeilen:

- I1a (an das allowBooking-Bullet angehaengt): ` Fehlt dir fuer den Termin-Titel ein konkreter Anlass, frage NICHT danach - leite einen allgemeinen Titel aus deinem AUFTRAG ab oder nimm den Terminwunsch als Nachricht auf (take_message).`
- I1b (Outbound-SITUATION): `Du bist der Anrufer: frage nie nach Informationen, die du als Anrufer selbst wissen muesstest oder die bereits in deinem AUFTRAG/BRIEFING stehen.`
- I6 (Inbound-Aufgaben-Satz, einzige interpolierte Stelle = owner wie im Bestand): `Bei einem Terminwunsch bietest du konkrete freie Zeiten aus ${owner}s Kalender an, statt offen nach einer Wunschzeit zu fragen.`

## Geaenderte Dateien

- src: claude.js, llm.js, metrics.js, i18n/locales.js, mcp-tools.js, server.js, config.js; .env.example
- Tests justiert: personal-assistant-characterization.test.js, f1-i18n-locale.test.js, l2-calendar-prefetch.test.js, mcp-ui.test.js, place-call-context-bridge.test.js, assistant-context-http.test.js, llm.test.js, l0-metrics.test.js
- Tests NEU: turn-fallback-locale.test.js (4), shape-for-speech.test.js (3), assistant-context-default.test.js (1)
- NICHT angefasst: scripts/, package.json, public/, apps/ (Bench-Pfade der Parallel-Agentin)

## Golden-Master-Aenderungen (bewusst, mit Begruendung)

- personal-assistant-characterization.test.js SP1-SP7: Erwartungstexte um exakt die
  spezifizierten Bullets/Saetze erweitert. Vorgehen: neuen Ist-Output per Skript
  generiert, dann Zeile fuer Zeile gegen die Item-Spezifikation geprueft (nicht blind
  einkopiert) - jede Abweichung ist eines der beauftragten Items; Disclosure-/
  WICHTIG-/Erledige-Bloecke byte-identisch geblieben.
- f1-i18n-locale.test.js DE_SUMMARY: I11-Klausel woertlich an der Stelle nach dem
  JSON-Schema-Satz nachgezogen (Rest byte-identisch).
- l2-calendar-prefetch.test.js Test 3: von "Inbound traegt KEINEN Kalender-Header"
  auf "traegt ihn jetzt" GEDREHT - das ist die gewollte I6-Verhaltensaenderung;
  fail-closed-Gegenprobe bleibt (Test 4) + neu fuer inbound (Test 4b).
- mcp-ui.test.js T-W2-place-shape: structuredContent-Keyliste + callOutput-Schema um
  context_received erweitert (I10 ist additiv); Defensiv-Normalisierung (Mock ohne
  Feld -> alles false/0) explizit gepinnt.
- assistant-context-http.test.js FLAG_OFF-Kommentar: haengt seit I12 am expliziten
  BASE_ENV-Pin statt am config-Default (Kommentar justiert, Verhalten identisch).
- disclosure-/openingText-Pins (disclosure-regression, disclosure-outbound, D1-D3,
  O1-O5, claude-identity): UNVERAENDERT und gruen (Leitplanke eingehalten).

## Verifikation

- `node --check` auf allen 7 geaenderten src-Dateien: OK.
- `npm test`: 1512/1512 (Baseline 1493/1493; +19 neue Tests: 4 turn-fallback,
  3 shape-for-speech, 1 assistant-context-default, 4 llm T-I13, 1 l0-metrics T-L0-1b,
  1 mcp-ui T-I10, 1 place-call I9-01, 1 l2 4b, 3 assistant-context-http HC7-9).
- Unantastbar per Test bewiesen: disclosureSentence/openingText byte-identisch,
  /voice/outbound LLM-frei (outbound-premature-close A gruen), Safety-Gates/Auth/
  Budget unberuehrt (kein Diff an diesen Pfaden).

## Abweichungen

- I13 callId: NICHT weggelassen - sauber durchreichbar ohne Signatur-Verrenkung
  (additives Feld im bestehenden params-Objekt, Abstreifen in llm.js vor dem SDK).
- I8: eine zusaetzliche Regel ueber die Spezifikation hinaus (haengendes ,;: am Ende
  wird vor der Satzende-Ergaenzung entfernt), verhindert ",." nach abgebrochenen
  Gedankenstrich-Saetzen.

## Risiken

- I12 Default-Flip: nach Deploy ist der Kontext-Kanal live aktiv - der HINTERGRUND-
  Block geht als Teil des systemPrompt an Anthropic (gleiche Datenklasse wie briefing;
  entspricht O5 im findings-Doc). Abschaltbar per ASSISTANT_CONTEXT_ENABLED=false.
- shapeForSpeech " - "->Komma trifft auch Zahlbereiche MIT Leerzeichen ("10 - 12 Uhr"
  -> "10, 12 Uhr"); spezifiziertes Verhalten, Restrisiko akzeptiert (Wort-Bindestriche
  ohne Leerzeichen sind geschuetzt).
- Prompt-Wachstum: +4 Bullets ueberall, + Kalender-Block jetzt auch inbound (bis 8
  Eintraege) -> mehr Input-Tokens pro Turn; statisch/cache-freundlich, aber der
  Inbound-Praefix haengt am Kalender-Inhalt (Cache-Miss bei Kalender-Aenderung).
- Realtime-Bridge erbt die Prompt-Aenderungen automatisch (instructions() ->
  systemPrompt); gewollt, aber live nur fuer die Budget-Engine relevant/verifizierbar.
- Wirkung der Prompt-Regeln auf echtes Gespraechsverhalten ist NUR ueber die
  Conversation-Bench belegbar (Baseline vs. Candidate, tasks/todo.md), nicht behauptet.
