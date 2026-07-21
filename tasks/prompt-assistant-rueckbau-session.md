# Prompt fuer die naechste Session — ai-voice-assistant-Pfad: ERST verstehen, dann entscheiden

Alles ab der Trennlinie ist der Prompt. In einer **frischen Session** einfuegen.

---

Es geht um den **`ai-voice-assistant`-Pfad** (Telnyx) und die Frage, ob und wie er
zurueckgebaut wird. **Deine erste und wichtigste Aufgabe ist NICHT der Rueckbau, sondern die
LAGE zu verstehen und sie mir verstaendlich zu erklaeren.** Ich (der Owner) verstehe den
aktuellen Zustand selbst nicht mehr, und es gibt echte Widersprueche. **Mach keine Annahmen.
Verifiziere jeden Punkt am echten Code und am echten Live-Zustand, bevor du irgendetwas
behauptest oder aenderst.**

Ein naiver Rueckbau ist gefaehrlich: der Pfad wird LIVE fuer echte Anrufe genutzt (Beleg
unten), und ein Fehler bricht den Outbound-Betrieb. Wer einen Pfad entfernt, ueber den gerade
erfolgreich telefoniert wurde, ohne zu wissen, was ihn ersetzt, macht den Dienst kaputt.

## Was in der VORIGEN Session tatsaechlich passiert ist (belegt, nicht Annahme)

- Die Kette `PLAN-LIVE-COST-TRACING` (P1-P8, Ist-Kosten statt Schaetzung) wurde komplett
  umgesetzt und ist **seit 2026-07-21 LIVE** (Deploy von Commit `1666da9` auf dem
  Deploy-Remote `jonas986`, Boot verifiziert). Details: Memory `[[live-cost-tracing-plan]]`
  und `[[live-cost-tracing-chain-complete]]`, Deploy-Auflagen in
  `tasks/lct-DEPLOY-CHECKLIST.md`.
- Live gesetzt wurde u.a. `COST_TRUING_REQUIRED_RECORD_TYPES=sip-trunking,call-control`,
  `MAX_BUDGET_EUR=30`, `PROVIDER_TO_BUCKET_RATE_MICRO=920000`.
- Ein **echter Testanruf** am 2026-07-21 (~10:58 UTC, `call_mrujjae2w33g`, outbound an die
  Owner-Nummer, 57 s, `completed`) lief auf dem neuen Code. **Die App-Logs zeigen eindeutig
  den `ai-voice-assistant`-Pfad:** `[telnyx/voice] startAssistant ok`,
  `ai_assistant_start abgesetzt`, `[telnyx-shim] turn_ok`, `opening_voice=elevenlabs`, bis
  `call.hangup -> Settlement finishCall`. Der Anruf war erfolgreich als Gespraech.
- Der `get_agent_status`-Wert war `voiceEngine: budget`. **Der Assistant-Pfad lief also
  INNERHALB der budget-Engine, nicht als separate Engine** — das musst du verstehen, bevor du
  ihn anfasst.
- **Noch offen aus der vorigen Session** (nicht dein Hauptauftrag, aber Kontext): der
  Ist-Kosten-Abgleich fuer den Testanruf steht aus (~3 h Vorlauf, und der Free-Tier-Dyno
  schlaeft ein -> der Sweep muss von Hand angestossen werden, Endpunkt `POST
  /api/billing/cost-truing/sweep` hinter Basic-Auth). `PLATFORM_ALERT_SMS_TO` ist live leer
  (Alarme nur im Audit-Log).

## Warum das Thema ueberhaupt aufkam

`PLAN-LIVE-COST-TRACING.md`, **Owner-Entscheidung 5**, verwirft den `ai-voice-assistant`-Pfad.
Begruendung dort: er kostet laut Messung **~10,4 USD-ct/min statt ~5,4** (fast das Doppelte,
Kapitel 2.2). Solange der Pfad im Code aktivierbar ist, bleibt die konservative
Vollkosten-Schwelle `VOICE_TARIFF_FULL_COST_FLOOR_CENTS` auf **10** EUR-ct; **erst nach dem
gemergten Rueckbau** darf sie auf **5** sinken. Der Rueckbau selbst ist ausdruecklich
**NICHT** Teil von PLAN-LIVE-COST-TRACING (dort als Folgearbeit gefuehrt, Befund D4).

## Die Widersprueche, die DU aufloesen musst (nicht ich, nicht Annahmen)

Es gibt Signale, die sich widersprechen. Nimm KEINES als gegeben — pruefe jedes selbst:

1. **"Verworfen" vs. "laeuft erfolgreich".** Der Plan sagt, der Pfad soll weg. Aber der
   Testanruf am 2026-07-21 lief erfolgreich ueber genau diesen Pfad. Ist er heute stabil,
   oder war das Glueck? Die Memory `[[assistant-dead-call-rca]]`,
   `[[telnyx-remediation-chain-state]]`, `[[c-telnyx Chain-Stand]]` sprechen von frueheren
   **Dead-Call-Fehlschlaegen** (z.B. "Live-Call 07-11 fehlgeschlagen"). Sind die geloest? Der
   Testanruf legt es nahe — aber beweise es, statt es anzunehmen.
2. **Engine vs. Pfad.** `voiceEngine=budget`, aber der Call lief ueber `startAssistant` +
   `telnyx-shim`. Wie haengen die budget-Engine und der Assistant-Shim zusammen? Ist der
   Assistant ein OPTIONALER Aufsatz auf der budget-Engine (per `TELNYX_AI_ASSISTANT_ENABLED`),
   oder traegt er den Outbound-Dialog? Das entscheidet, was der Rueckbau bricht.
3. **Was ist der ERSATZ?** Wenn der Assistant-Pfad weg ist — laeuft Outbound dann ueber den
   reinen budget-Pfad (Gather/STT + Speak/ElevenLabs, ohne Assistant-Shim)? **Funktioniert
   der ueberhaupt?** Die Memory `[[outbound-dialog-fixed-live]]`,
   `[[telnyx-budget-stt-bugfix]]`, `[[play-tts-elevenlabs-chain]]` deuten an, dass der reine
   budget-Pfad frueher lief. Aber verifiziere, ob er HEUTE, nach allen Aenderungen, noch der
   funktionierende Fallback ist. Ein Rueckbau ohne funktionierenden Ersatz ist ein
   Totalausfall des Outbound-Betriebs.
4. **Der Umfang.** Der Plan (D4) nennt nur `adapters/telnyx/voice.js` und `config.js`. Ein
   `grep` zeigt aber, dass der Pfad ueber **>10 Dateien** verstreut ist (u.a.
   `src/telnyx-inbound.js`, `src/telnyx-origination.js`, `src/telnyx-llm-shim.js`,
   `src/telnyx-conversation-watchdog.js`, `src/telnyx-call-control-ingest.js`, `server.js`,
   `app.js`, `registry.js`, `ports.js`). Kartiere den ECHTEN Umfang selbst, bevor du ihn fuer
   klein haeltst.

## Die Lage-Pruefung, die ich von dir erwarte (in dieser Reihenfolge)

1. **Live-Zustand feststellen, nicht raten.** Welcher Pfad laeuft aktuell bei einem
   Outbound-Call? Ist `TELNYX_AI_ASSISTANT_ENABLED` live an? (Env auf Render ist per API nicht
   lesbar — leite den Zustand aus den Live-Logs des letzten echten Calls ab, oder aus dem
   Boot-Banner/Verhalten. Render-Logs: `mcp__render__list_logs`, Service
   `srv-d8m0fhflk1mc73bno570`, Workspace `tea-d8m0b9jeo5us73cvasg0`. Voice-Webhooks
   erscheinen als **app**-Logs, NICHT als request-Logs.)
2. **Code-Landkarte des Assistant-Pfads.** Grep alle Symbole (`startAssistant`,
   `ai_assistant_start`, `telnyxAssistant`, `TELNYX_AI_ASSISTANT_ENABLED`, `telnyx-shim`/
   `telnyxShim`, `telnyx-conversation-watchdog`). Welche Datei tut was? Was ist reiner
   Assistant-Code (kann weg) vs. geteilter Code (muss bleiben)?
3. **Den Ersatzpfad verstehen und seine Funktionsfaehigkeit belegen.** Wie laeuft ein
   Outbound-Call OHNE Assistant? Existiert dieser Zweig noch im Code, ist er getestet, lief
   er je live? Ohne einen belegt funktionierenden Ersatz gibt es keinen sicheren Rueckbau.
4. **Die Kosten-Motivation verifizieren.** Stimmt der Faktor ~10,4 vs. ~5,4 ct/min noch? (Der
   Ist-Kosten-Abgleich aus PLAN-LIVE-COST-TRACING kann das jetzt erstmals mit ECHTEN Zahlen
   belegen — der Testanruf lief ueber den Assistant-Pfad, sein `ai-voice-assistant`-Record
   traegt die realen Zusatzkosten. Wenn der Abgleich schon gelaufen ist, lies die echten
   Zahlen statt der Planungs-Schaetzung.)

## Danach: mir die Lage erklaeren, DANN erst planen

- **Erklaer mir das Ergebnis auf Deutsch, verstaendlich, ohne Fachjargon-Wand** — ich muss
  verstehen, was da laeuft, bevor wir irgendetwas aendern. Nenne, was belegt ist und was
  offen bleibt.
- **Leg mir die Optionen vor** (z.B. Flag AUS als reversibler erster Schritt vs. echter
  Code-Rueckbau; sofort vs. nach dem Ist-Kosten-Abgleich), mit den Konsequenzen jeder Option.
  Lass MICH entscheiden.
- **Erst nach meiner Freigabe** wird umgesetzt — und dann sauber (Plan Mode / dein
  Phasen-Workflow, dualer Review, Rot-vor-Fix). Ein Rueckbau, der einen Outbound-Pfad
  entfernt, ist hoch-nicht-trivial: `.claude/refs/workflow.md` und `.claude/refs/clean-code.md`
  sind Pflicht.

## Absolute Randbedingungen (nicht dagegen arbeiten)

- **Nicht deployen ohne meine ausdrueckliche Ansage.** Merge auf `master` ist kein
  Ausliefern. Der Deploy-Remote ist `upstream` (jonas986), autoDeploy=no; eine Env-Aenderung
  auf Render triggert aber sehr wohl einen Deploy des dann aktuellen GitHub-Stands — also
  Vorsicht mit Env-Aenderungen, solange ungewollter Code auf dem Remote liegt.
- **Safety-Gates, Disclosure, Auth fail-closed** bleiben unantastbar (CLAUDE.md).
- **Der Assistant-Pfad ist LIVE und traegt echte Anrufe.** Behandle jeden Schritt daran wie
  einen Eingriff am offenen Betrieb: reversibel zuerst (Flag), Code-Entfernung nur mit
  belegtem Ersatz und Tests.
- **Keine Annahmen, kein Raten. Bei Unsicherheit fragen.** Das ist die Kernvorgabe dieses
  Auftrags: erst die Wirklichkeit feststellen, dann handeln.
