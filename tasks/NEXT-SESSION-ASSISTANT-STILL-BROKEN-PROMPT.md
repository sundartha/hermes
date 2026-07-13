# NEXT-SESSION — Telnyx-Assistant-Anruf funktioniert weiter nicht (EVIDENZ-FIRST, KEINE ANNAHMEN)

**In eine FRISCHE Claude-Code-Session einfügen.**

## Oberste Regel (Owner-Direktive 2026-07-12)
**KEINE ANNAHMEN.** Frühere Sessions (inkl. der letzten) haben wiederholt Ursachen *behauptet*, die
sich als falsch/unbelegt herausstellten, und die Zeit mit Bauen statt Beobachten verbrannt.
Vorgehen strikt: **erst Runtime-Evidenz lesen → dann falsifizierbare Hypothese → dann erst handeln.**
Nichts als Ursache behaupten, was nicht direkt aus Logs/Portal belegt ist. Kein Code-Fix, bevor die
Bruchstelle belegt ist. (CLAUDE.md „erst Runtime lesen, nie raten" — genau das wurde verletzt.)

## Das Symptom (Owner-Testanruf 2026-07-12) — WÖRTLICH, NICHT interpretieren
- Die Offenlegung wurde gesprochen.
- Die KI sagte danach **etwas mehr als nur die Offenlegung** (formulierte anders, **fragte nach dem
  Wetter morgen**).
- Der Owner **antwortete**.
- Danach sagte die KI **nichts mehr**, reagierte nicht — **es kam KEIN Gespräch zustande.**

Das ist die einzige belegte Verhaltensbeschreibung. Alles Weitere ist zu ermitteln, nicht anzunehmen.

## Direkt beobachtete Fakten (verifiziert, nicht interpretiert)
- **Live-Deploy:** commit `bed694e` (Render-Service `srv-d8m0fhflk1mc73bno570`, Deploy
  `dep-d99jtrd7vvec73fmjktg`, status live, `/healthz` 200 auf `app.sundartha.com` +
  `vodafone-agent.onrender.com`). Enthält die Kette P5–P10 (Details: `tasks/stab-CHAIN-report.md`,
  Memory `stabilize-chain-state`). autoDeploy=off; Live-Gehen = `git push upstream master` + manueller
  Render-Deploy im No-Call-Fenster.
- **Telnyx-Assistant Hermes** (`assistant-dcf48d08-1d4e-4673-ab94-2681b22d26d4`), am 2026-07-12 im
  Portal direkt abgelesen: Custom LLM aktiv (unser Shim), Voice = ElevenLabs / key-ref `elevenlabs_prod`
  / `eleven_flash_v2_5` / „Ela", **Interruptions = Enabled**, Greeting-Interruptions = Enabled,
  Transcription Model = `deepgram/flux`, **Transcription Language wurde von English auf „Multilingual
  (no language hint)" geändert + gespeichert** (Toast „Updated AI Assistant successfully"). End-of-turn
  Threshold 0,8 / Timeout 5000 ms / Eager 0,8; Background Audio = Silence; Speaking Plan Wait 0 s;
  Interruption-Prediction-Threshold 0.
- **Connector** in claude.ai: URL = `https://app.sundartha.com/mcp`. Das **Widget** (`get_agent_status`)
  rendert **korrekt** mit echten Live-Daten (KEIN Widget-Bug). Connector-Icon leer; Google-S2
  `sundartha.com` = 559 B (alter Würfel), `app.`/`www.` = 404. (P13-Details Memory
  `claude-connector-icon-mechanism` — **Owner bezweifelt die Google-Cache-Erklärung ausdrücklich; NICHT
  als gesichert übernehmen**, ggf. neu prüfen ob claude.ai server-seitige Icons konsumieren kann.)

## Frühere FALSCHE / unbelegte Annahmen — NICHT wiederholen
- „Widget zeigt Demo/ist kaputt" → **WIDERLEGT**, Widget rendert korrekt. P12 gegenstandslos (außer evtl.
  das selbst-pollende Live-Call-Widget während eines Anrufs — ungeprüft).
- „STT muss Deutsch sein" → **FALSCH**. Hermes ist **international**, Sprache folgt dem **Anrufer**
  (DE/EN/FR/…). STT steht jetzt auf Multilingual; **ob das den Anruf verbessert hat, ist UNBEKANNT**.
- „P13 ist nur Google-Cache, abwarten" → seit ~2 Wochen behauptet, nie eingetreten. **Nicht als gelöst
  annehmen.**
- Grundhaltung: Der Assistant-Pfad ist trotz Kette + STT-Fix **end-to-end kaputt**. Das ist der Stand.

## Aufgabe (Reihenfolge — Evidenz vor Hypothese vor Code)
1. **Runtime-Evidenz zum konkreten Testanruf holen, OHNE Vorannahme über die Ursache.** Owner nach dem
   Zeitfenster/Call-Zeitpunkt fragen. Dann:
   - **Render-Logs** dieses Calls durchgehen — jede Zeile nach `ai_assistant_start`: Kommen
     Shim-Turns rein (`[telnyx-shim] ...`, `turn_ok`, gate-reason)? `[metrics] llm outcome`? Fehler?
     **Erreicht die USER-Antwort überhaupt den Shim** (nach der ersten KI-Äußerung)? Feuert der neue
     Watchdog (`[telnyx-conversation-watchdog]`) oder ein Loop-Guard? Legt die Turn-Logik auf?
     (Das PII-Shape-Log `TELNYX_SHIM_DEBUG_SHAPE` — default off — kann bei Bedarf temporär helfen:
     `messagesCount`, Rollen, `speechEmpty`. Nur Booleans/Counts, PII-frei.)
   - **Telnyx-Sicht**: gibt es für diesen Call ein Conversation-Transkript / Insights? (Owner-Zugriff;
     die Portal-UI für vergangene Conversations wurde bisher NICHT gefunden — ggf. Langfuse-Tracing
     aktivieren oder überwachter Live-Mitschnitt.) Ziel: **Sieht der Assistant die User-Antwort?
     Antwortet der Shim darauf? Spricht Telnyx-TTS danach oder nicht?**
2. Erst wenn belegt ist, **WO** die Kette bricht (Kandidaten NUR als Untersuchungs-Orte, NICHT als
   Diagnose: User-Turn erreicht den Shim nicht / STT liefert nichts nach der ersten Runde / Shim
   antwortet leer / TTS spricht die Folge-Antwort nicht / Turn-Logik terminiert), eine **falsifizierbare
   Hypothese** bilden und lokal reproduzieren (`/v1/chat/completions`-Shim + `/voice/*` lassen sich mit
   `SKIP_TWILIO_SIGNATURE_CHECK` + curl ohne echten Anruf durchspielen).
3. Pro Owner-Ökonomie: **ein** überwachter Testanruf pro Fix, **erst nach** belegter Ursache.

## Randbedingungen
- Safety-Gates (Regel 1) + Offenlegung byte-identisch erster Satz (Regel 2) unantastbar. Secrets/PII nie
  loggen (Regel 4).
- Lies zuerst NEU: `stabilize-chain-state`, `telnyx-remediation-chain-state`,
  `telnyx-assistant-live-api-findings`, `outbound-dialog-fixed-live`, `barge-in-solution-options`.
  Diese sind Kontext, KEINE gesicherte Ursache für den aktuellen Anruf.
- Ton: direkt, keine Floskeln, keine Annahmen, Evidenz zuerst.
