# PLAN: Assistant-Gespraechsfaehigkeit fixen (nach RCA 2026-07-12)

Stand: Rev. 3. Zwei adversariale Review-Runden (Opus): Runde 1
PASS-mit-Auflagen (F1-F16, alle BLOCKER/MAJOR eingearbeitet, Greeting-Migration
verworfen), Runde 2 PASS-eng (P1-Fallback-Retry, Config-Reuse statt neuer
Env-Vars, Suspend statt Invariante, Budget-Engine-Seam-Festlegung, R1-Gate auf
eine Zahl praezisiert — alles eingearbeitet). Bereit fuer Owner-Freigabe.

Grundlage: `tasks/rca-2026-07-12-assistant-dead-call.md` — 5 verifizierte Wurzeln
R1-R5. Die Pipeline (Shim, SSE-Format, ElevenLabs-TTS, Playback) ist BEWIESEN
intakt; kaputt sind Timing/Turn-Taking, STT-Input-Qualitaet und das
Beendigungsverhalten. Dieser Plan behebt genau diese Wurzeln — nichts anderes.

Doku-Basis: Telnyx-OpenAPI-Spec (team-telnyx/openapi) + developers.telnyx.com.
Zentrale Befunde: `speak` unterstuetzt ElevenLabs (`ElevenLabs.<Model>.<VoiceId>`
+ `voice_settings.api_key_ref`); per-Call-`transcription.language` in
`ai_assistant_start`; `telephony_settings.user_idle_reply_secs` (Default 10,
min 0) nur am persistenten Assistant-Objekt; `start_speaking_plan` greift bei
deepgram/flux NICHT; Eager-EOT ist bei eot==eager==0.8 (Live-Stand) effektiv aus;
es existiert KEINE Option, das Verwerfen einer noch nicht gespielten Antwort bei
Nutzer-Zwischenrede abzuschalten.

## Leitplanken (unantastbar)

- Regel 1: Safety-Gates unveraendert. Kein neuer Endpunkt, keine Gate-Aenderung.
- Regel 2: Offenlegung bleibt fest verdrahteter ERSTER Satz UND behaelt ihre
  per-Call-Zustellgarantie: Der deterministische Opening-`speak` mit
  `speak.ended`-Bestaetigung und `onSpeakFailed`-Fail-Safe (KI startet nie ohne
  zugestellte Offenlegung) bleibt der Anker. (Review-Auflage F2 — die zunaechst
  geplante Greeting-Migration ist verworfen, siehe "Verworfene Alternative".)
- Testanruf-Oekonomie: EIN ueberwachter, gebuendelter Testanruf verifiziert
  P1+P2+P3 und das R1-Gate anhand GETRENNTER Observablen. P4 lokal (kein Anruf).
  Auswertung immer mit der etablierten Forensik-Pipeline (Render-Logs,
  /v2/call_events, /v2/ai/conversations/{id}/messages, Recording-Kanalanalyse).
- Kein Fix ohne vorab notierte, falsifizierbare Erwartung (workflow.md Regel 7).

## R1 zuerst ehrlich einordnen (Review-Auflage F1)

R1 (Antwort wird verworfen, wenn der Nutzer im Latenzfenster spricht) ist bei
aktiviertem Barge-in NICHT konfigurativ abschaltbar (Doku-verifiziert) und
Barge-in ist Launch-Pflicht. Der Plan behauptet deshalb NICHT, das Verwerfen zu
eliminieren. Das nutzerseitig zaehlende Verhalten wird stattdessen HART gegatet:

**R1-Gate (GO/NO-GO im Testanruf, EINE Zahl):** Nach JEDER abgeschlossenen
Nutzer-Aeusserung — auch wenn sie eine gerade generierte/spielende Antwort
verworfen hat — muss die naechste Assistant-Antwort hoerbar auf dem Agent-Kanal
beginnen, spaetestens **5s** nach Aeusserungsende (gemessen in der Aufnahme).
Eine einzige Ueberschreitung ist ein FAIL des gesamten Rollouts (Symptom
"KI ist stumm" = das Ur-Symptom).

Hebel, die das Fenster verkleinern: P2 (STT-Konfidenz -> schnellere EOT statt
5s-Timeout), P1 (frueherer Gespraechseinstieg), P5 (Streaming/eot_timeout —
wird PFLICHT statt optional, falls das TTFA-Ziel unten reisst).

## P1 — Opening-Stimme + Idle-Nudge (fixt R5; Architektur bleibt)

Aenderung:
1. Opening-`speak` auf die ElevenLabs-Assistant-Stimme umstellen:
   im Telnyx-Adapter (`src/telephony/adapters/telnyx/voice.js`, speak-Command)
   `voice: "ElevenLabs.<model>.<VoiceId>"` +
   `voice_settings: { api_key_ref: <ref> }` fuer den Assistant-Pfad.
   Quelle: die BESTEHENDE `config.telnyxElevenLabs.*`-Config (voiceId, model,
   apiKeyRef — bereits vom Provisioner genutzt); KEINE neuen Env-Vars, kein
   Wert-Duplikat (Re-Review P2: Drift-Landmine vermeiden).
   Fallback-Kette (Re-Review P1, Regel 2 — Opening darf NIE ausfallen):
   (a) ElevenLabs-Config leer -> direkt Azure wie heute. (b) ElevenLabs-`speak`
   scheitert zur LAUFZEIT (Sync-Fehler ODER `speak.failed`-Event) -> genau EIN
   Retry mit der Azure-Voice; erst wenn auch der scheitert, greift der heutige
   `onSpeakFailed`-Fail-Safe (kein Assistant-Start). Ohne diesen Retry waere
   der schlimmste Fall ein stiller toter Call — schlechter als heute.
2. `user_idle_reply_secs` 10 -> 4 am Assistant-Objekt — NICHT als One-off-PATCH,
   sondern in `buildAssistantConfig` (`scripts/telnyx-assistant-provision.mjs`)
   aufnehmen und per Provisioner ausrollen (Review F9: kein Config-Drift; der
   Provisioner bleibt Single Source of Truth).
3. Ingest-Flow, `watchdog.arm()`, `onSpeakFailed`-Fail-Safe: UNVERAENDERT
   (Review F8/F16 damit gegenstandslos).

Erwartung (falsifizierbar):
- E1.1: Durchgehend EINE Stimme (ElevenLabs) im ganzen Call; kein
  Azure-Segment in der Aufnahme.
- E1.2: Offenlegung vollstaendig und woertlich am Anfang (wie heute, speak-Anker).
- E1.3: Bleibt der Angerufene nach dem Opening still, beginnt die erste
  Assistant-Aeusserung ("Nudge") <= ~7s nach speak.ended (4s Idle + Turn-Latenz;
  bisher 12.4s). Messung: Recording/Events.
- E1.4: `speak.ended` weiterhin im Event-Log VOR `ai_assistant_start`
  (Zustellgarantie intakt).

Pre-Mortem P1: ElevenLabs-`speak` schlaegt live fehl (Key-Scope des
Integration-Secrets) -> `speak.failed`-Fallback wie heute; Testanruf prueft es;
schlimmster Fall = heutiger Zustand (Azure), nie Stille.

## P2 — STT-Sprach-Hint pro Call (fixt R2)

Aenderung: Der Port `startAssistant` bekommt die neutrale Gespraechssprache
(`call.language`) als Parameter; das Mapping auf
`transcription: { model: "deepgram/flux", language: <hint> }` lebt
ADAPTER-INTERN in voice.js (Review F10: kein Provider-String durch den Port).
Mapping: von flux unterstuetzte Hints (en, es, fr, de, hi, ru, pt, ja, it, nl)
direkt; alles andere -> `"auto"`; NIE `"multi"` (= dokumentiert "no language
hint"). Assistant-Objekt bleibt unveraendert (per-Call-Override gewinnt).

Erwartung (falsifizierbar):
- E2.1: Deutsche Test-Aeusserungen erscheinen als deutscher Text in
  `/v2/ai/conversations/{id}/messages` (bisher 3/3 NL/EN-Kauderwelsch).
  Messinstrument: Offline-Referenz-Transkription derselben Aufnahme-Segmente
  via Telnyx `/v2/ai/audio/transcriptions` (Whisper large-v3-turbo) — die
  Methode ist etabliert (RCA R2, Cross-Modell-Test 07-12); flux-Live-Transkript
  vs. Whisper-Referenz vergleichen, nicht nur "sieht deutsch aus".
- E2.2: Kein NL/EN-Artefakt bei rein deutschem Testanruf.
- E2.3 (Metrik mit Entscheidungsregel, Review F14): Per-Turn-TTFA
  (Nutzer-Aeusserungsende -> Agent-Kanal-Sprachbeginn) wird pro Turn gemessen.
  Ziel: Median <= 2.5s. Reisst das Ziel, wird P5 zur PFLICHT vor Launch.
- E2.4 (Beobachtung, kein Gate): Mid-Call-Sprachwechsel — im Testanruf einmal
  auf Englisch antworten. Erwartung: Verstaendlicher englischer Transkript-Text
  trotz de-Hint (Hint ist Gewichtung, kein Lock; Modell bleibt
  flux-general-multi). Falls der Hint Wechsel nachweislich unterdrueckt:
  Entscheidungsregel -> `"auto"` statt Sprach-Hint (dynamisch, nie "multi").

Fallback-Leiter bei E2.1-FAIL (Kauderwelsch TROTZ de-Hint): (1) `"auto"`
testen; (2) `language` am Assistant-Objekt via Provisioner + Telnyx-Ticket;
(3) STT-Modellwechsel ernsthaft pruefen — der Cross-Modell-Test (RCA R2)
belegt, dass Whisper dasselbe Audio Hint-los korrekt transkribiert, flux ist
also die schwaechste Stelle; Trade-off dokumentieren: flux ist das einzige
Telnyx-Modell mit Turn-Taking-Features (eot_*, Interruption-Prediction).

## P3 — end_call verschluckt den Abschied nicht mehr (fixt R4)

Design nach Review-Auflagen F3-F5 — der verzoegerte Hangup lebt im WATCHDOG
(`src/telnyx-conversation-watchdog.js`), der Timer-Ownership, setTimer/clearTimer
und das `onHangup`-Clearing bereits besitzt:

1. Neue Watchdog-API `scheduleFarewellHangup(callId, speechChars)`:
   `delayMs = clamp(1500 + speechChars * 70, 3000, 12000)` (benannte
   Konstanten, ~14 Zeichen/s + Anlauf).
2. Waehrend ein Farewell-Timer laeuft: Dead-Air-Timer fuer diesen Call
   suspendiert — das IST der Schutzmechanismus gegen praeemptives Terminate/
   Doppel-Hangup/irrefuehrendes dead_air-Log (F4). Keine zusaetzliche
   delayMs-vs-deadAir-Invariante: redundant zum Suspend und bei
   Min-Konfiguration (TELNYX_DEAD_AIR_TIMEOUT_S=5) unerfuellbar (Re-Review P3).
3. Kommt waehrend des Delays ein NEUER Shim-Turn herein (Nutzer sprach doch
   weiter), cancelt `observeTurn` den Farewell-Timer (F5: der Abschied war
   verfrueht; das Gespraech laeuft normal weiter; beendet wird am naechsten
   end_call-Turn-Boundary).
4. `onHangup` cleart wie heute ALLE Timer des Calls (`watchdog.clear`) —
   externer Hangup gewinnt immer, kein Doppel-Terminate.
5. Shim-Aenderung minimal: statt sofortigem `terminateCall` ->
   `watchdog.scheduleFarewellHangup(...)`. Log-Marker
   `[telnyx-shim] farewell_scheduled {callId, delayMs}` (kein PII).
6. Prozess-Restart mid-Delay (F: Timer weg): Backstop-Kette bleibt —
   Dead-Air-Watchdog (re-arm via naechstem Turn/Boot-Sweep), Max-Dauer,
   Budget-Gates. Akzeptiertes Restrisiko: Call lebt dann bis Backstop.
   In PLAN-SECURITY.md als bewusste Abweichung dokumentieren (bewusster
   verzoegerter Hangup, gedeckelt 12s).

Erwartung (falsifizierbar):
- E3.1: Abschiedssatz vollstaendig hoerbar auf dem Agent-Kanal VOR `call.hangup`
  (bisher: Hangup 81ms nach Completion, Abschied nie gespielt).
- E3.2: Hangup-Zeitpunkt >= Ende des letzten Agent-Sprachsegments, aber
  <= Segment-Ende + ~4s (nicht ewig offen).
- E3.3: Testfall (node:test): neuer Turn waehrend Farewell-Delay -> Timer
  gecancelt, kein Terminate; onHangup waehrend Delay -> genau ein Cleanup,
  kein zweiter Terminate-Call (Fake-Timer-Seam existiert im Watchdog-Modul).

## P4 — end_call-Disziplin (mitigiert R3 — ehrlich: kein vollstaendiger Schutz)

NUR Prompt-Regel. Der urspruengliche P4.2-Turn-Zaehler-Guard ("fruehestens ab
dem zweiten Assistant-Turn") wurde vom Owner GESTRICHEN (Entscheidung
2026-07-12), gestuetzt durch Review F7: Laengen-Substanz erkennt Kauderwelsch
nicht (haette den 08:25-Fall nicht verhindert) und macht legitime
Sofort-Enden ("kein Interesse, tschuess") einen Turn langsamer.

1. Prompt-Regel am Tool-Entscheidungspunkt (src/claude.js, gemaess Lehre
   call-quality-chain "enge Verbote am Entscheidungspunkt"): end_call NUR,
   wenn (a) eine Verabschiedung im selben Turn ausgesprochen wird UND (b) der
   letzte User-Turn verstanden wurde; bei unverstaendlichem Input EINMAL
   nachfragen statt aufzulegen.
2. Der bestehende `suppressEndCall`-Seam in claude.js (Outbound: end_call
   unterdrueckt, bis der Anrufer ueberhaupt substanziell sprach) bleibt
   UNVERAENDERT — keine Erweiterung, kein paralleler Guard.
3. Der eigentliche R3-Schutz ist P2 (korrekte Transkripte) + Prompt-Regel 1;
   Watchdog/Max-Dauer/Budget bleiben die harten Grenzen.

Erwartung (falsifizierbar):
- E4.1: `npm run convo-bench` (n>=5, Scores poolen): Szenario
  "unverstaendliche Erstantwort" endet nicht mit sofortigem Auflegen, sondern
  mit EINER Nachfrage; keine Regression in den uebrigen Szenarien.
- E4.2: Bestehende Suite gruen, `node --check` sauber (reine Prompt-Aenderung,
  aber der Offenlegungs-/Opening-Pfad wird von Tests abgedeckt).

## P5 — Latenz (bedingt PFLICHT, Entscheidungsregel in E2.3)

Falls Median-TTFA > 2.5s im Testanruf:
- P5a: `eot_timeout_ms` 5000 -> 2500 am Assistant-Objekt (via Provisioner,
  F9-konform); Wirkung: unsichere EOTs warten kuerzer. Einzeln messen.
- P5b: Sentence-Streaming im Shim (erste Saetze als SSE-Chunks sobald
  verfuegbar; `agentTurn` ist heute non-streaming -> eigener Phasen-Plan mit
  eigenem Review). Nutzen: TTFA sinkt um die LLM-Restlaufzeit; verkleinert
  zugleich das R1-Verwerf-Fenster.
Faellt E2.3 gruen aus, bleibt P5 vertagt — dann aber als dokumentierte,
datierte Entscheidung, nicht stillschweigend.

## P6 — Inbound-Pfad (SEPARAT, nicht im ersten Wurf; Review F12)

Der Inbound-Assistant-Start (`src/telnyx-inbound.js`, Greeting aus
`ctx.settings.greeting`, zusaetzlich addTranscript + TeXML-Fallback) bekommt
dieselben P1/P2-Verbesserungen als EIGENE Phase mit eigenem (Inbound-)Test-Leg.
Keine Offenlegungspflicht (Regel 2 ist outbound), aber gleiche Stimm-/STT-Logik.
Nicht Teil des ersten Deploys, damit der Testanruf beweiskraeftig bleibt.

## Explizit NICHT tun (aus der Evidenz begruendet)

- KEINE Greeting-Migration des Openings (verworfen, siehe unten).
- KEIN `start_speaking_plan`-Tuning: greift laut Spec bei deepgram/flux nicht.
- KEINE Eager-EOT-Aenderung: eot==eager==0.8 -> bereits effektiv deaktiviert.
- KEIN SSE-/Format-Umbau als "Fix": Format ist entlastet (Kontrollanruf).
- KEINE ElevenLabs-Key-/Voice-Arbeiten am Assistant: entlastet, funktioniert.
- KEIN Widget-/MCP-Umbau: entlastet.
- KEINE Aenderung an Offenlegungsinhalt, Gates, Budgets (Regeln 1+2).

## Verworfene Alternative (dokumentiert fuer die Zukunft)

Opening als per-Call-`greeting` in `ai_assistant_start` (haette Totzeit und
Stimmbruch in einem Zug geloest): VERWORFEN wegen Regel 2 — das Greeting-Feld
liefert keine per-Call-Zustellbestaetigung; Offenlegung und KI-Start wuerden
ein atomarer, unbeobachtbarer Telnyx-Call (Review F2). Der `speak`-Anker mit
`speak.ended`-Gate und `onSpeakFailed`-Fail-Safe bleibt. Wiedervorlage nur,
falls Telnyx ein Greeting-Delivery-Event dokumentiert.

## Reihenfolge, Buendelung, Rollout

1. Impl P1+P2+P3+P4 in EINEM Branch, Phasen einzeln committen (dualer Review;
   Subagenten-Politik: Opus=Review, Sonnet=Impl, nie Fable erben lassen).
2. Lokal: Suite + neue Tests (E3.3, E4.1) + Smoke (startAssistant-/speak-Bodies
   asserten: Voice-Felder + transcription.language vorhanden; curl-Simulation
   mit SKIP_TWILIO_SIGNATURE_CHECK).
3. Provisioner-Lauf (user_idle_reply_secs=4) VOR dem Code-Deploy — harmlos,
   aendert nur das Idle-Timing.
4. Deploy im No-Call-Fenster (push upstream + manueller Render-Deploy,
   [boot]-Banner pruefen).
5. EIN ueberwachter Testanruf mit Owner, Skript (jede Erwartung einzeln
   PASS/FAIL in tasks/-Report):
   (i) Abnehmen, Opening anhoeren ohne reinzusprechen (E1.1/E1.2/E1.4).
   (ii) Nach dem Opening bewusst still bleiben, BIS der Idle-Nudge kommt;
        Dauer messen (E1.3: erwartet <= ~7s, FAIL wenn > 10s).
   (iii) Normal deutsch antworten, kurzes Hin und Her (E2.1/E2.2, TTFA-Messung
        E2.3 ueber alle Turns).
   (iv) Overlap-Probe (R1-Gate): waehrend die KI spricht, bewusst
        reinsprechen und dann stoppen -> naechste Antwort muss <= 5s nach
        Aeusserungsende hoerbar beginnen; jede Ueberschreitung =
        Rollout-FAIL (Review F1/F13).
   (v) Gespraech natuerlich beenden ("das wars, danke") -> Abschied vollstaendig
       abwarten (E3.1/E3.2).
6. FAIL-Handling: Nur die gescheiterte Phase zurueckrollen/nacharbeiten; kein
   Sammel-Revert. Ausnahmen: R1-Gate-FAIL = kein Launch-GO fuer den
   Assistant-Pfad, P5 wird Pflicht und der Anruf-Test wird wiederholt;
   E1.2-FAIL (Offenlegung nicht vollstaendig) = Sofort-Rollback P1-Commit.

## Owner-Gates

- Freigabe dieses Plans (vor Impl).
- Provisioner-Lauf gegen den Live-Assistant (Schritt 3).
- Teilnahme am gebuendelten Testanruf (Schritt 5, inkl. Overlap-Probe iv).

## Pre-Mortem (Gesamtplan, aktualisiert)

Angenommen, in einem Jahr war dieser Plan ein Fehler — was ist passiert?
(a) Das R1-Verwerfen blieb im Feld haeufiger als im Test (viele Nutzer sprechen
dauernd) und die KI wirkte weiter stumm -> darum R1-Gate + Overlap-Probe als
GO/NO-GO und P5-Pflicht-Regel statt Hoffnung. (b) Der ElevenLabs-`speak`
scheiterte live am Key-Scope -> Laufzeit-Retry mit Azure-Voice (Sync-Fehler UND
speak.failed abgedeckt), erst danach der heutige onSpeakFailed-Fail-Safe;
Opening faellt nie stumm aus. (c) Der Farewell-Delay hielt Calls offen/kostete Geld -> Cap 12s,
Dead-Air-Suspend nur waehrend des Delays, onHangup-Clear, Max-Dauer+Budget-Gates
unveraendert. (d) Voreiliges Auflegen kam trotz P2+P4.1 zurueck -> dann war die
Prompt-Regel zu schwach; naechste Eskalationsstufe waere ein semantischer
Guard (STT-Konfidenz statt Laenge) als eigene, neu zu begruendende Phase —
bewusst NICHT vorauseilend gebaut (P4.2 vom Owner gestrichen); Watchdog
bleibt Notaus. (e) Per-Call-language brach internationale Anrufe -> Mapping
fail-open auf "auto", nie hart "de" fuer fremde Sprachen. (f) Idle-Nudge 4s
nervte Menschen, die nur kurz nachdenken -> Wert ist eine Provisioner-Zeile,
leicht auf 6-8s justierbar; im Testanruf beobachten.
