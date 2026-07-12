# PLAN: Gespraechsqualitaet optimieren (Telnyx-AI-Assistant-Pfad)

Stand 2026-07-12.

## UMSETZUNGSSTAND (Nachtrag, gleiche Session)

**K0, K1, K2, K3 sind IMPLEMENTIERT** (Branch `worktree-convo-optimization-plan`), Suite
2168/2168 gruen, dualer Review (Opus) bestanden nach ZWEI Fix-Runden — der erste Wurf hatte
einen echten R4-Rueckfall fuer en/fr eingebaut (siehe K3).

**NICHT ausgerollt.** Zwei Dinge kann nur der Owner tun:
1. **Provisioner-Lauf** (`node scripts/telnyx-assistant-provision.mjs`) — erst dadurch werden
   K1 (`interrupt_prediction_threshold: 0.4`) und K2 (`background_audio: office`) am
   Live-Assistant scharf. Der Provisioner prueft jetzt selbst per GET nach, ob Telnyx die
   beiden Felder wirklich uebernommen hat, und wirft sonst (fail-closed) — ein gruener Lauf
   beweist also, dass sie live sind.
2. **EIN gebuendelter Testanruf** — inkl. der Overlap-Probe. **E1.2 ist der harte Gate:**
   Faellt der Owner der KI mit einem echten SATZ ins Wort, muss sie weiterhin SOFORT stoppen.
   Tut sie das nicht, geht `interrupt_prediction_threshold` sofort zurueck auf 0.0.

Offen bleiben: G1 (Gate-Experiment Streaming), K5, K6, K4, K8, K9 — unveraendert wie unten.

---

Strategiedokument. Owner entscheidet ueber Umsetzung und Reihenfolge.

Ausgangslage: `tasks/STATUS-ANRUFQUALITAET-2026-07-12.md` (Schwachstellen S1-S5),
`tasks/rca-2026-07-12-assistant-dead-call.md` (Wurzeln R1-R5),
`PLAN-ASSISTANT-CONVERSATION-FIX.md` (P1-P4 live seit d83be2d).

**Leitplanke (Owner-Entscheidung 2026-07-12):** Der Telnyx-AI-Assistant-Pfad BLEIBT. Barge-in
war der Grund fuer den Wechsel und funktioniert live. Dieses Dokument optimiert INNERHALB
des Pfads. Kein Stack-Wechsel wird vorgeschlagen. Telnyx-Grenzen, die wir gefunden haben,
stehen als benannte Grenzen in §9 — als Owner-Entscheidung fuer spaeter, nicht als
Empfehlung dieser Session.

**Regel 1 (Safety-/Budget-Gates) und Regel 2 (Offenlegung als erster Satz, per-Call
zugestellt) werden von KEINER Phase angefasst.** Zwei Phasen (K5, K8) beruehren das
Kostenmodell und sind deshalb explizit als Owner-Kostenentscheidung markiert.

---

## 1. Die zentrale Einsicht dieser Recherche

Wir haben zwei Telnyx-Funktionen, die exakt unsere zwei groessten Probleme adressieren —
**und beide sind bei uns ausgeschaltet.** Das war keine Entscheidung, das ist der Default.

| Feature | Unser Live-Wert | Was es tut | Adressiert |
|---|---|---|---|
| `interruption_settings.interrupt_prediction_threshold` | **0.0 (= aus)** | Filtert Backchannels ("ja", "mhm", "aha") aus der Unterbrechungs-Erkennung heraus | **S1** (Verwerf-Fenster) |
| `transcription.settings.eager_eot_threshold` | **0.8 (== `eot_threshold` = aus)** | Telnyx startet die LLM-Generierung spekulativ VOR dem finalen Turn-Ende | **S4 / Latenz** |
| `voice_settings.background_audio` | **`silence` (= Feature aus)** | Leises Raum-Ambiente statt toter Leitung | **S4** (Totzeit-Empfinden) |

Belege: alle drei per `GET /v2/ai/assistants/{id}` am Live-Objekt erhoben (2026-07-12, eigene
Messung). Semantik siehe §3.

Ausserdem gilt (Recherche gegen LiveKit, Pipecat, Vapi, Retell, ElevenLabs, OpenAI Realtime):
**Das Verwerfen einer noch nicht gespielten Antwort bei Nutzer-Zwischenrede ist
Branchenstandard, kein Telnyx-Defekt.** Kein untersuchtes System queued die Antwort und
spielt sie spaeter — alle canceln. Die einzige gefundene Verfeinerung (LiveKit kuerzt die
Historie auf das tatsaechlich Gehoerte) braucht Kontrolle ueber die Audio-Pipeline, die wir
im Telnyx-Pfad nicht haben.
Quellen: https://docs.livekit.io/agents/build/turns/ , https://docs.vapi.ai/customization/voice-pipeline-configuration ,
https://www.retellai.com/blog/how-voice-ai-handles-hardest-parts-real-call (alle 2026-07-12).

Konsequenz: Der Hebel ist **nicht**, das Verwerfen abzuschalten (geht nirgends), sondern
(a) weniger Turns faelschlich als Unterbrechung zu werten (K1) und
(b) das Zeitfenster zu verkleinern, in dem verworfen werden kann (K5, K8).

---

## 2. Was wir vorher NICHT wussten und jetzt messen koennen

Telnyx liefert pro Conversation-Message eine `metadata`-Struktur mit
**fertiger Latenz-Zerlegung** (live geprueft an unseren echten Calls, 2026-07-12):

`transcription_duration_ms`, `llm_first_token_duration_ms`, `audio_first_token_duration_ms`,
`end_user_perceived_latency_ms`, `start_speaking_plan_extra_wait_duration_ms`

Damit ist P-C (Latenz-Bestandteile einzeln messen) **ohne einen einzigen zusaetzlichen
Testanruf** beantwortbar — die Daten der beiden bereits gefuehrten Calls reichen. Das ist
die Grundlage von K0 und der Grund, warum K0 vor allem anderen kommt.

**Was diese Metadaten NICHT enthalten:** kein Marker fuer "dieser Turn war spekulativ" und
keiner fuer "dieser Turn wurde verworfen" (adversarial geprueft, REFUTED). Verworfene Turns
sind ausschliesslich an unserem eigenen Shim-Request-Zaehler erkennbar — deshalb ist der
Zaehler Vorbedingung fuer K8.

---

## 3. Belegte Fakten, auf denen die Phasen stehen

Jede Zeile wurde adversarial gegengeprueft (zwei Opus-Pruefdurchgaenge mit dem Auftrag zu
widerlegen, nicht zu bestaetigen). `DOKU` = Anbieter-Aussage, `MESSUNG` = eigene Erhebung.

| # | Fakt | Beleg | Urteil |
|---|---|---|---|
| F1 | `interrupt_prediction_threshold`: Range 0.0-1.0, Default 0.0 (aus), **"0.4 is a good starting point"**, hoeher = strikter (weniger Unterbrechungen). Nur mit `deepgram/flux`. Deutsch unterstuetzt. | https://telnyx.com/release-notes/interruption-prediction-voice-ai-assistants (2026-07-06) + `GET`-Objekt | **CONFIRMED** |
| F2 | Das Feld fehlt in der oeffentlichen OpenAPI-Spec, existiert aber real am Live-Objekt. | Spec-`grep`: 0 Treffer; `GET`: Feld vorhanden | **CONFIRMED** (Spec-Drift) |
| F3 | Eager-EOT: Telnyx selbst "starts tentative LLM responses before final turn completion", faellt auf Standard zurueck, wenn sich das Transkript mid-turn aendert. Gleiche Werte = deaktiviert. | Telnyx Release-Note (2026-01-14) | **CONFIRMED** |
| F4 | Preis von Eager-EOT: **"50-70 % more LLM calls"** (Deepgram beziffert es selbst). Im BYO-Betrieb ist UNSER Shim "das LLM" → Telnyx ruft uns spekulativ oefter an. | https://developers.deepgram.com/docs/flux/voice-agent-eager-eot | **CONFIRMED** |
| F5 | Es gibt **keinen** Marker, an dem ein spekulativer/verworfener Turn erkennbar waere. | `metadata`-Felder live geprueft | **REFUTED** (kein Marker) |
| F6 | `background_audio`: `predefined_media` mit exakt zwei Presets `silence` \| `office`; `volume` 0.1-1.0. **`silence` = Feature deaktiviert** (nicht "Stille gewaehlt"). | OpenAPI `VoiceSettings` + `GET`-Objekt | **CONFIRMED** |
| F7 | `background_audio` ist per `ai_assistant_start` **nicht ueberschreibbar** — es kann nur aus der gespeicherten Assistant-Config kommen. Ob es im Call-Control-Pfad ueberhaupt greift: **keine Quelle sagt es**. | `CallAssistantRequest`-Schema (kein `voice_settings`) | **UNPROVEN** |
| F8 | `keyterm` funktioniert mit flux (nicht nur Nova-3), multilingual, bis 100 Terme — aber harte Grenze ist ein **Token-Budget von 500**, nicht die Term-Zahl. Bei Telnyx ein komma-separierter String. | https://telnyx.com/release-notes/deepgram-keyterm-prompting-voice-ai-assistants (2026-04-20) | **CONFIRMED** |
| F9 | **Kein Telnyx-Event signalisiert das Ende der Assistant-TTS eines Turns.** `ai_assistant_start` hat exakt zwei Expected Webhooks: `call.conversation.ended`, `call.conversation_insights.generated` — beide auf Konversations-Ende-Ebene. | OpenAPI-Pfad-Description + `GET /v2/call_events` unseres echten Calls (18 Events, 0 speak.ended fuer Assistant-Turns) | **CONFIRMED (Doku UND Messung)** |
| F10 | `send_conversation_message_events` (live am Objekt, undokumentiert) taugt **nicht** als Rettungsanker: 0 Treffer in allen Spec-Dateien, 0 in der Doku, GitHub-weit 4 Treffer in einem einzigen fremden Repo, das das Flag setzt und nie ausliest. | Spec-`grep` + authentifizierte GitHub-Code-Suche | **CONFIRMED (Sackgasse)** |
| F11 | `start_speaking_plan` greift bei `deepgram/flux` nicht — Telnyx sagt das woertlich in der Spec. | OpenAPI `StartSpeakingPlan`-Description | **CONFIRMED** |
| F12 | **Ob Telnyx unsere SSE-Chunks inkrementell konsumiert** (TTS startet beim ersten Satz) oder auf `[DONE]` wartet: **keine Quelle, weder Spec noch Doku noch Release-Notes.** | erschoepfende Suche | **UNBEKANNT** → Gate G1 |
| F13 | Anthropic garantiert **nicht**, dass Text vor einem `tool_use`-Block kommt ("Claude will **often** comment ... before invoking tools" + "do not rely on specific formatting conventions"). `tool_choice: any/tool` erzwingt sogar das Gegenteil. Es gibt **kein** Feature, das Text-vor-Tool erzwingt. | https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools.md (2026-07-12) | **REFUTED** (keine Garantie) |
| F14 | Gestreamten Text kann man nicht zurueckziehen — es existiert kein Retract-Event in der SSE-Event-Liste. | https://platform.claude.com/docs/en/build-with-claude/streaming.md | **CONFIRMED** (Argument aus Abwesenheit) |
| F15 | Prompt-Caching-Minimum fuer **Haiku 4.5 = 4.096 Tokens**; darunter wird still nicht gecacht (kein Fehler). Unser cachebarer Praefix (Tools+System) liegt bei **~1.200-1.700 Tokens**. → Unser Caching ist **heute wirkungslos**. | https://platform.claude.com/docs/en/build-with-claude/prompt-caching.md (2026-07-12) | **CONFIRMED** |
| F16 | Preise Haiku 4.5: Input $1 / Output $5 / Cache-Write-5min $1.25 / Cache-Read $0.10 je MTok. Tool-Use-System-Overhead 496 Tokens pro Request (`tool_choice: auto`). | https://platform.claude.com/docs/en/about-claude/pricing.md (2026-07-12) | **CONFIRMED** |
| F17 | TTFT Haiku 4.5: **Anthropic publiziert keine Latenzzahlen.** Drittanbieter-Spannweite 0,58-1,03s (Faktor ~2). | Artificial Analysis (Drittanbieter) | **UNPROVEN** — nicht als Planungsgrundlage nutzen |

---

## 4. Die Phasen

Jede Phase: Ziel, Aenderung, falsifizierbare Erwartung, Verifikation, Pre-Mortem,
Abbruchkriterium, Umsetzungsempfehlung (Lean-Workflow vs. direkter Edit), Kosten.

---

### K0 — Messgrundlage schaffen (Vorbedingung, kein Anruf noetig)

**Ziel:** Nie wieder gegen eine erfundene Zahl optimieren. Vor der ersten Aenderung eine
Baseline aus Daten, die schon existieren.

**Aenderung:**
1. Auswerte-Skript (`scripts/`, Wegwerf-tauglich): zieht fuer eine Call-ID die
   `metadata`-Felder aller Conversation-Messages (`/v2/ai/conversations/{id}/messages`) und
   gibt pro Turn die Zerlegung aus: STT-Dauer, LLM-First-Token, Audio-First-Token,
   `end_user_perceived_latency_ms`. Read-only gegen Telnyx.
2. Ein Log-Feld im Shim: **Shim-Requests pro Call** (Zaehler). Heute ist nicht unterscheidbar,
   ob Telnyx uns 4x oder 6x fuer 4 Nutzer-Aeusserungen angerufen hat. Der Zaehler ist die
   einzige Sichtbarkeit auf verworfene/spekulative Turns (F5) und **Vorbedingung fuer K8**.
3. `count_tokens` gegen den echten System-Prompt + Tools messen (kostenlos, keine Inferenz)
   → belegt F15 fuer unseren konkreten Prompt statt es zu schaetzen.

**Falsifizierbare Erwartung:**
- E0.1: Die Summe der Metadaten-Bestandteile erklaert den gemessenen TTFA-Median (2.13s)
  auf ±300ms genau. Tut sie das NICHT, fehlt uns ein Latenz-Bestandteil, den wir nicht kennen —
  das waere der wichtigste Einzelbefund und muss vor allen weiteren Phasen geklaert werden.
- E0.2: `count_tokens` liefert < 4.096 fuer Tools+System → F15 bestaetigt, Caching-Phase
  bleibt gestrichen (§8). Liefert es > 4.096, wird §8 neu bewertet.

**Verifikation:** Skriptlauf gegen die beiden bereits gefuehrten Calls. Kein neuer Anruf.

**Pre-Mortem:** Wir bauen Instrumentierung und optimieren danach trotzdem nach Gefuehl.
Gegenmittel: E0.1 ist ein hartes Gate — ohne erklaerten TTFA keine Latenz-Phase.

**Abbruchkriterium:** Wenn die Telnyx-Metadaten fuer unsere Calls leer/unvollstaendig
zurueckkommen, faellt die billige Messgrundlage weg; dann wird K0 auf reine Recording-Analyse
(ffmpeg, wie im RCA) zurueckgestuft — teurer, aber machbar.

**Umsetzung: direkter Edit + Test.** Kein Lean-Workflow. Begruendung: ein Auswerte-Skript und
ein Log-Zaehler, kein Produktionspfad-Verhalten, keine Gate-Beruehrung. Der Lean-Workflow
(Plan → Impl → dualer Review) waere hier reiner Overhead.

**Kosten:** ~0. `count_tokens` ist kostenlos; Telnyx-GETs sind kostenlos; kein Anruf.
**Owner-Gate:** Nur fuer den `count_tokens`-Teil — der lokale `ANTHROPIC_API_KEY` liefert
weiterhin **401** (heute erneut geprueft). Siehe K9.

---

### K1 — `interrupt_prediction_threshold` 0.0 → 0.4 (der Hauptschlag gegen S1)

**Ziel:** Das Verwerfen von Antworten seltener machen, ohne Barge-in zu schwaechen. Genau
dafuer hat Telnyx das Feature gebaut: kurze Bestaetigungslaute ("ja", "mhm", "okay") sollen
die laufende Antwort NICHT mehr toeten; echtes Reinreden weiterhin schon.

Das ist die belegte Antwort auf die Frage, die die Konkurrenz-Recherche offengelassen hat:
LiveKit (`min_words`), Vapi (`numWords`), Retell (`interruption_sensitivity`) haben alle so
einen Schutz — **Telnyx hat ihn auch, wir hatten ihn nur nie eingeschaltet.**

**Aenderung:** Eine Zeile in `buildAssistantConfig`
(`scripts/telnyx-assistant-provision.mjs`, Single Source of Truth):
`interruption_settings: { enable: true, interrupt_prediction_threshold: 0.4 }`.
Danach ein Provisioner-Lauf. `enable: true` bleibt unangetastet — Barge-in bleibt an.

**Falsifizierbare Erwartung:**
- E1.1: Im Testanruf sagt der Owner waehrend einer laufenden Assistant-Antwort bewusst nur
  "mhm" / "ja" → die Antwort laeuft **weiter** und wird zu Ende gesprochen (heute: wird
  abgeschnitten/verworfen).
- E1.2 (**Gegenprobe, ist das eigentliche Risiko**): Der Owner faellt der KI mit einem echten
  Satz ins Wort ("Moment, nein, ich meinte...") → die KI **stoppt trotzdem sofort**.
  Barge-in ist Launch-Pflicht; **wenn E1.2 reisst, wird K1 sofort auf 0.0 zurueckgesetzt.**
- E1.3: Die Zahl der Shim-Requests pro Nutzer-Aeusserung (K0-Zaehler) sinkt oder bleibt gleich —
  sie darf nicht steigen.

**Verifikation:** EIN ueberwachter Owner-Testanruf mit Overlap-Probe (das Skript aus
`PLAN-ASSISTANT-CONVERSATION-FIX.md` Schritt 5(iv) existiert bereits und ist wiederverwendbar).
Das **R1-Gate bleibt gueltig**: nach JEDER abgeschlossenen Nutzer-Aeusserung muss die naechste
Antwort spaetestens 5s spaeter hoerbar beginnen.

**Pre-Mortem:** In einem Jahr stellt sich heraus, dass 0.4 zu strikt war und die KI Menschen
nicht mehr zu Wort kommen liess — der Kernvorteil des Telnyx-Wechsels waere kaputt gewesen,
und wir haetten es nicht gemerkt, weil wir nur auf "weniger Verwerfen" geschaut haetten.
Gegenmittel: E1.2 ist ein **harter Rollback-Trigger**, nicht eine Beobachtung. Und: 0.4 ist
Telnyx' eigener empfohlener Startwert, nicht unsere Erfindung.

**Abbruchkriterium:** E1.2 FAIL (echtes Barge-in funktioniert nicht mehr) → sofort zurueck
auf 0.0, Phase verworfen. Eine Zeile, sekundenschnell reversibel.

**Umsetzung: direkter Edit + Provisioner-Lauf.** Kein Lean-Workflow — es ist eine
Konfigurations-Zeile in einer Datei, deren Merge-Guard (`PRESERVED_SAFETY_FIELDS`) bereits
fail-closed prueft. Der Lean-Workflow (dualer Review von 1 Zeile) waere Overkill.
**Aber: Owner-Gate**, weil es den Live-Assistant schreibt und einen Testanruf braucht.

**Kosten:** Konfiguration ~0. Ein Testanruf (siehe §6). **Erwartete Kostenersparnis:** jede
nicht mehr verworfene Antwort spart LLM- + TTS-Arbeit; im letzten Call waren 25 % der
generierten Antworten Verschnitt.

**Bindung:** K1 pinnt uns auf `deepgram/flux` — Interruption Prediction ist flux-exklusiv.
Das ist ein bewusst akzeptierter Trade-off und der Hauptgrund, warum §8 einen STT-Modellwechsel
verwirft.

---

### K2 — `background_audio` `silence` → `office` (gegen das Totzeit-Empfinden)

**Ziel:** Die 24-37 % Stille im Gespraech aufhoeren zu lassen, sich wie eine tote Leitung
anzufuehlen — ohne eine einzige Zeile Produktivcode.

**Wichtig zur Einordnung:** Unser `silence` war **keine Entscheidung**, es ist der Default und
bedeutet laut Spec woertlich "disables background audio" (F6). Vapi hat fuer Telefonie
`office` als **Default** — leises Buero-Ambiente ist Branchenpraxis, nicht Exotik
(https://docs.vapi.ai/customization/speech-configuration, 2026-07-12).

**Aenderung:** Eine Zeile im Provisioner:
`voice_settings.background_audio = { type: "predefined_media", value: "office", volume: 0.3 }`
(Volume bewusst niedrig; Range 0.1-1.0 in 0.1-Schritten).

**Falsifizierbare Erwartung:**
- E2.1: In der Aufnahme des Testanrufs ist auf dem **Agent-Kanal** waehrend der Antwortpausen
  ein durchgehender leiser Grundpegel messbar (RMS > 0), wo heute **digital exakt Null** steht.
  Das ist der direkte Beweis fuer F7 (ob `background_audio` im `ai_assistant_start`-Pfad
  ueberhaupt greift — **nicht belegt, dieser Testanruf ist der Beweis**).
- E2.2: Die STT-Qualitaet bleibt unveraendert (kein neues Kauderwelsch) — Ambiente laeuft auf
  dem Agent-Kanal, darf den Nutzer-Kanal nicht kontaminieren.
- E2.3 (subjektiv, Owner): Fuehlt sich die Pause weniger tot an?

**Verifikation:** Derselbe Testanruf wie K1 (getrennte Observablen: Kanal-RMS vs.
Turn-Verwerf-Verhalten → Buendelung ist zulaessig, sie konfundiert nichts).

**Pre-Mortem:** Das Ambiente nervt Angerufene ("warum rauscht das?") oder — schlimmer — es
kontaminiert die STT und bringt R2 zurueck. Gegenmittel: Volume 0.3 statt Default 1.0,
E2.2 als Gate, und ein Rollback ist eine Zeile.
Zweites Risiko: **Es greift gar nicht** (F7 ist UNPROVEN). Dann kostet uns die Phase genau
einen Blick in die Aufnahme — und wir wissen es endlich.

**Abbruchkriterium:** E2.2 FAIL (STT verschlechtert sich) → sofort zurueck auf `silence`.
E2.1 FAIL (kein Pegel messbar) → F7 ist damit als Telnyx-Grenze belegt, Phase verworfen,
Eintrag in §9.

**Umsetzung: direkter Edit + Provisioner-Lauf.** Kein Lean-Workflow (eine Config-Zeile).
Owner-Gate wie K1.

**Kosten:** ~0 (Telnyx berechnet fuer Preset-Ambiente nichts Zusaetzliches, das in unserer
`call.analyzed`-Kostenaufstellung auftauchen wuerde — **nicht verifiziert**, im ersten
Testanruf gegen die Kostenposten pruefen).

---

### K3 — Farewell-Timing kalibrieren statt raten (S3 / P-E)

**Ziel:** Kein 4,5s-Schweigen mehr vor dem Auflegen.

**Der Befund zuerst, weil er eine Hoffnung begraebt:** Es gibt **kein** Telnyx-Event fuer
"Assistant hat zu Ende gesprochen" — doppelt bewiesen (Doku UND Messung an unseren echten
Call-Events, F9). Und `send_conversation_message_events`, der attraktivste Kandidat, ist eine
Sackgasse (F10). **Schaetzen bleibt die einzige belegte Option.** Also schaetzen wir besser,
statt weiter zu hoffen.

**Aenderung:** Die Konstanten in `farewellDelayMs`
(`src/telnyx-conversation-watchdog.js`) gegen **gemessene** Werte tauschen. Heute:
`1500ms + Zeichen * 70ms`, gedeckelt auf 3000-12000ms — die 70ms/Zeichen (≈14 Zeichen/s)
ueberschaetzen ElevenLabs systematisch, deshalb wird der 12s-Cap in **beiden** Calls
ausgeschoepft. Die echte Sprechrate ist aus den **vorhandenen Aufnahmen** messbar
(Agent-Kanal: gesprochene Zeichen / Segmentdauer). Ergebnis: neue, benannte Konstanten.
**Korrektur (Umsetzung):** Der Cap wurde NICHT gesenkt, sondern auf 15000ms **angehoben** —
die urspruengliche Absicht hier ("auf einen Wert senken, der zur gemessenen Rate passt") ist
mit der gemessenen Rate nicht vereinbar: der laengste gemessene Abschiedssatz (206 Zeichen)
braucht real 11,694s, ein gesenkter Cap haette genau diesen Fall selbst abgeschnitten (R4).
Ein hoeherer Cap wandelt "abgeschnitten" (Bug) in "etwas laenger Stille" (haesslich, aber
harmlos) um — das ist die richtige Richtung (s. Pre-Mortem unten).
**Sprach-Einschraenkung:** Die neuen Konstanten sind NUR fuer `de` gemessen und werden auch
NUR fuer `de` angewandt (`src/telnyx-conversation-watchdog.js`, sprachabhaengige
Kalibrierungs-Tabelle). `en`/`fr`/unbekannte Sprache behalten unveraendert die alten
Konstanten (1500ms + 70ms/Zeichen) — Englisch hat bei aehnlichem Sprechtempo kuerzere Woerter
und damit weniger Zeichen/s als Deutsch; die de-Kalibrierung wuerde englische Abschiedssaetze
zu knapp schaetzen (R4). **Ein englischsprachiger Testanruf ist noetig, bevor die
de-Kalibrierung auf en/fr ausgeweitet wird.**

**Gemessene Werte (Forensik an beiden echten Testanrufen, Kanaltrennung + silencedetect,
Abgleich mit den Telnyx-Message-Texten, 2026-07-12 — damit die naechste Session sie nicht neu
erheben muss):**
- ElevenLabs-Sprechrate ueber 4 sauber zuordenbare Passagen: 17.30 / 19.90 / 20.34 / 17.62
  Zeichen/s → Median **18.76**, LANGSAMSTES **Minimum 17.30** (= 57.8 ms/Zeichen).
- TTS-Anlauf (Telnyx `audio_first_token_duration_ms`, Zeit von unserer Completion bis Audio
  bereit): 108-139 ms → Median **119 ms**, Maximum **139 ms**.
- Laengster gemessener Abschiedssatz: 206 Zeichen → **11,694 s** echte Sprechdauer
  (`tasks/afix-testcall2-report.md`, Turn-3-Audiofenster 17:37:34.393-17:37:46.087).
- Neue Konstanten: `FAREWELL_BASE_MS` 500 (Anlauf-Maximum + Puffer), `FAREWELL_MS_PER_CHAR` 65
  (langsamste Rate + ~12% Aufschlag, bewusst NICHT der Median), `FAREWELL_MIN_MS` 1500,
  `FAREWELL_MAX_MS` 15000 (deckt bei der langsamsten Rate ~220 Zeichen ab, statt den 206-Zeichen-
  Fall selbst abzuschneiden).

**Falsifizierbare Erwartung:**
- E3.1 (**korrigiert — die urspruengliche Fassung war mit reiner Zeichen-Heuristik nicht
  haltbar**): Ursprünglich verlangt: Hangup **>= Ende des letzten Agent-Sprachsegments** und
  **<= Segment-Ende + 1,5s**. Das ist ohne ein echtes TTS-Ende-Event (F9, existiert bei Telnyx
  nicht) nicht erreichbar: die gemessene Sprechrate streut zwischen 17,3 und 20,3 Zeichen/s
  (~15%). Wer auf die langsamste Rate kalibriert (um Abschneiden sicher zu vermeiden,
  E3.2 hat Vorrang vor E3.1), ueberschaetzt bei schnell gesprochenen Saetzen zwangslaeufig um
  diese Streuung. Realistisch erreichbar ist deshalb **Hangup <= Segment-Ende + ~3s** (heute:
  bis 4,5s UND permanenter Cap-Hit bei jedem Call). Ein besserer Wert braucht ein echtes
  TTS-Ende-Event — und das existiert bei Telnyx nicht.
- E3.2: Kein abgeschnittener Abschiedssatz — das ist der Regressions-Trigger. R4 (verschluckter
  Abschied) darf NICHT zurueckkommen. Lieber 1s zu lang als 200ms zu kurz.
- E3.3: Bestehende Watchdog-Tests (Fake-Timer-Seam existiert) bleiben gruen.

**Verifikation:** Kalibrierung offline aus den zwei vorhandenen Aufnahmen (kein Anruf).
Verifikation im naechsten ohnehin geplanten Testanruf.

**Pre-Mortem:** Wir kalibrieren zu knapp, der Abschied wird wieder verschluckt — genau der
Bug, den P3 gerade gefixt hat. Gegenmittel: Die Konstante wird bewusst mit
Sicherheitsaufschlag gesetzt (gemessene Rate + Puffer), nicht auf die Kante. Asymmetrie
explizit im Code-Kommentar: zu lang = 1s Stille (haesslich); zu kurz = abgeschnittener
Abschied (Bug).

**Abbruchkriterium:** E3.2 FAIL → sofort zurueck auf die alten Konstanten.

**Umsetzung: direkter Edit + node:test.** Grenzfall, aber kein Lean-Workflow noetig: Der
**Mechanismus** (Watchdog-Timer, Dead-Air-Suspend, `observeTurn`-Cancel, `onHangup`-Clear) ist
bereits gebaut und dual-reviewed; K3 aendert **nur die Konstanten** darin, und die
Test-Abdeckung (`telnyx-afix-p3-farewell.test.js`, `telnyx-stab-p9-watchdog.test.js`) existiert.
Waere es eine Mechanismus-Aenderung, waere die Antwort Lean-Workflow.

**Kosten:** ~0. Verkuerzt sogar die Call-Dauer (bezahlte Telnyx-Minuten) um bis zu 4s pro Anruf.

---

### G1 — GATE-EXPERIMENT: Konsumiert Telnyx unsere SSE-Chunks inkrementell?

**Das ist die wichtigste offene Frage des ganzen Dokuments.** Sie entscheidet ueber K5 UND K6 —
zusammen der groesste Brocken Arbeit. Wenn Telnyx unsere Antwort puffert, bis `[DONE]` kommt,
sind Sentence-Streaming und Filler-Chunks **exakt wertlos** (Ersparnis: null), und wir haetten
zwei Phasen umsonst gebaut.

**Beweislage heute:** Keine einzige Quelle — nicht die OpenAPI-Spec, nicht die
Custom-LLM-Doku, nicht die Release-Notes — sagt, wie Telnyx die Completion konsumiert (F12).

**Experiment (billig, ohne Produktions-Risiko):**
1. Wegwerf-Assistant anlegen (die Praxis hat sich bewaehrt; danach loeschen).
2. Shim-Instrumentierung hinter einem Flag: erster SSE-Chunk sofort ("Guten Tag."), restliche
   Chunks um **8 Sekunden** verzoegert, dann `[DONE]`.
3. EIN Testanruf gegen den Wegwerf-Assistant.
4. Auswertung: Beginnt die Sprachausgabe nach **~1s** (→ inkrementell, **G1 GRUEN**) oder erst
   nach **~8s** (→ Telnyx puffert, **G1 ROT**)? Messbar in der Aufnahme UND an
   `audio_first_token_duration_ms` in den Message-Metadaten (K0).

**Erwartung:** offen. Ich habe bewusst keine Vermutung — das ist der Punkt des Experiments.

**Pre-Mortem:** Wir bauen K5/K6 auf der Annahme "OpenAI-kompatibel heisst schon irgendwie
streaming-faehig" und stellen nach zwei Wochen Arbeit fest, dass Telnyx puffert. Genau davor
schuetzt G1. **Kosten des Experiments: ein Testanruf. Kosten des Ueberspringens: zwei Phasen.**

**Abbruchkriterium:** G1 ROT → K5 und K6 werden **gestrichen** (nicht vertagt), und F12 wird
als benannte Telnyx-Grenze in §9 eingetragen. Dann bleiben gegen die Stille nur K2 (Ambiente)
und gegen die Latenz nur K8 (Eager-EOT).

**Umsetzung: Spike, direkter Edit hinter einem Flag, danach zurueckbauen.** Kein Lean-Workflow —
es ist ein Wegwerf-Experiment, das nie in Produktion geht. **Owner-Gate** (Testanruf + kurzzeitig
ein Wegwerf-Assistant).

**Kosten:** ein Testanruf (~2 Min Telnyx + ein paar Cent LLM/TTS).

---

### K5 — Sentence-Streaming im Shim (nur bei G1 GRUEN)

**Ziel:** Das Latenzfenster verkleinern, in dem Antworten verworfen werden koennen — und
damit gleichzeitig S1 (Verschnitt), S4 (Stille) und P-C (Latenz) angreifen.

**Ehrliche Erwartung, nach adversarialer Pruefung nach unten korrigiert:** Streaming senkt
**nicht** die Zeit bis zum ersten Token (TTFT bleibt), es macht die Tokens nur frueher
nutzbar. Bei ~94 Output-Tokens/s und einer typischen Antwort von 40-95 Tokens ist die
realistische Ersparnis **~0,2-0,6s** — **nicht** die urspruenglich vermuteten 0,5-1,2s. Das ist
weniger, als es klingt, aber es ist der einzige Hebel, der das Fenster strukturell verkleinert
und uns dabei nicht mehr Geld kostet.

**Aenderung (Grobschnitt, kein Impl-Auftrag):**
- Neuer Streaming-Pfad in `src/llm.js` (heute existiert **kein** Streaming-Code — es ist kein
  Flag-Flip, es ist neuer Code in einem Resilienz-Seam mit Retry/Breaker).
- `agentTurn` bleibt fuer den **Budget-Engine-Aufrufer byte-identisch**; der Shim bekommt eine
  streamende Variante. `agentTurn` ist geteilter Code (`src/server.js` UND
  `src/telnyx-llm-shim.js`) — die Budget-Engine hat keinen Streaming-Konsumenten und darf
  nicht angefasst werden.
- Der Shim schreibt pro Satz einen `content`-Delta statt einem einzigen. Das SSE-Framing ist
  **bereits spec-korrekt** (Rolle → Content → Finish → `[DONE]`); es aendert sich nur die
  **Anzahl** der Content-Chunks. Das senkt das Risiko dieser Phase erheblich.

**Die Landmine, die diese Phase gefaehrlich macht (F13/F14):** Es gibt **keine Garantie**, dass
Claude Text ausgibt, bevor es ein Tool aufruft. Wenn wir einen Satz streamen und das Modell
danach `end_call` aufruft, ist der Satz **schon gesprochen und nicht mehr zurueckholbar**.
Deshalb braucht K5 eine **explizite Policy**, keine Annahme:
- `end_call` nach gestreamtem Text ist **unkritisch** — der Text IST der Abschiedssatz
  (genau das Verhalten, das P3/K3 ohnehin erwarten).
- Tools mit **inhaltlicher** Folgewirkung (`book_appointment`, `get_calendar`) duerfen NICHT
  nach bereits gesprochenem Text kommen, der ihr Ergebnis vorwegnimmt.
- Umsetzbare Regel: **Erst ab dem zweiten Satz streamen** oder: Text nur streamen, wenn im
  laufenden Stream noch kein `tool_use`-Block begonnen hat — und die Retry-/Breaker-Semantik
  aus `llm.js` neu denken (was heisst "Retry", wenn schon Tokens beim Anrufer sind?).
  **Das ist Design-Arbeit, kein Refactoring.**

**Falsifizierbare Erwartung:**
- E5.1: `end_user_perceived_latency_ms` (Telnyx-Metadatum, K0-Baseline) sinkt im Median um
  **>= 200ms**. Sinkt es um weniger, war die Phase den Aufwand nicht wert — **das ist ein
  ehrliches Abbruchkriterium, kein Erfolgsfenster.**
- E5.2: Kein Fall von "Satz gesprochen, danach widersprach der Tool-Aufruf ihm".
- E5.3: Regel-1-Gates (Loop-Guard, Rate-Limit, Dead-Air) greifen weiterhin **VOR** dem
  LLM-Call — sie duerfen durch den Streaming-Umbau nicht nach hinten rutschen.

**Pre-Mortem:** In einem Jahr ist das Gespraech kaputt, weil die KI Saetze anfaengt, die sie
nicht halten kann (Tool-Ergebnis widerspricht dem schon Gesagten), oder weil ein Retry mitten
im Satz einen zweiten, widerspruechlichen Satz erzeugt hat. Gegenmittel: die Policy oben ist
**Teil der Phase**, nicht ein Nachgedanke; E5.2 ist ein Gate; die Budget-Engine bleibt
unangetastet.

**Abbruchkriterium:** G1 ROT → Phase gestrichen. E5.1 < 200ms → zurueckrollen, der Komplexitaet
nicht wert.

**Umsetzung: `phase-impl-lean` PFLICHT.** Begruendung — als einzige Phase in diesem Dokument
erfuellt sie alle Kriterien fuer den schweren Workflow: sie beruehrt den **geteilten**
`agentTurn`-Seam (zwei Aufrufer), sie aendert die **Retry-/Breaker-Semantik** eines
Resilienz-Seams, sie liegt **vor** den Regel-1-Gates im Kontrollfluss, und sie beruht auf einer
**nicht garantierten** API-Eigenschaft (F13). Ein direkter Edit hier waere fahrlaessig.

**Kosten:** Keine laufenden Mehrkosten (gleiche Token-Zahl, nur frueher geliefert).
Entwicklungsaufwand: die groesste Phase des Dokuments.

---

### K6 — Filler / Soft-Timeout (nur nach K5)

**Ziel:** Die verbleibende Luecke ueberbruecken, wenn die Antwort laenger dauert als ueblich.

**Vorbild (belegt):** ElevenLabs hat genau dafuer ein Feature — "Soft Timeout": Ueberschreitet
die Antwort eine Schwelle (0,5-8,0s, Empfehlung 3,0s), wird sofort eine Fuellphrase gesprochen,
**waehrend die echte Antwort im Hintergrund weiterlaeuft**
(https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow, 2026-07-12).

**Was die Recherche klar verbietet:**
- **Kein Filler bei JEDER Antwort** — Vapi hat sein `fillerInjectionEnabled` 2024 wieder
  entfernt; LiveKit warnt vor Ueberdosierung; die Praxis ist einhellig: dieselbe Phrase bei
  jeder Antwort wirkt sofort robotisch.
- **Filler NICHT vom LLM generieren lassen.** Retells Praxis zeigt: LLM-generierte Fuellwoerter
  lassen sich per Prompt nicht zuverlaessig steuern — und Steuerbarkeit ist genau unser Problem.
  Der Filler muss **deterministisch im Shim** entstehen.

**Aenderung:** Im Shim: wenn `agentTurn` nach **T ms** (Startwert ~1.200ms, aus der K0-Baseline
zu bestimmen) noch nicht geliefert hat, geht ein kurzer Filler-Chunk als erster SSE-Delta raus
(2-3 rotierende Varianten: "Mhm.", "Einen Moment.", "Okay."), danach die echte Antwort.
Deutsche Backchannels sind sprachwissenschaftlich gut belegt (kurz, ein- bis zweisilbig:
"mhm", "genau", "okay" — https://www.mdpi.com/2226-471X/10/8/194).

**Die Landmine:** Ein Filler, dem **keine** Antwort folgt, ist schlimmer als Stille
(dokumentiertes Pipecat-Muster: Interruption cancelt die Antwort, der Filler ist aber schon
raus — https://github.com/pipecat-ai/pipecat/issues/950). Und: Filler + direkt danach
`end_call` = "Moment mal." *klick*. Beides braucht eine Policy.

**Falsifizierbare Erwartung:**
- E6.1: Anteil der Aufnahme mit kompletter Stille sinkt von 24-37 % messbar (Ziel < 15 %).
- E6.2: Auf jeden gespielten Filler folgt **in 100 % der Faelle** eine echte Antwort — nie ein
  Filler als letzte Aeusserung vor dem Hangup.
- E6.3: Der Filler triggert die Telnyx-Turn-Erkennung nicht (kein zusaetzlicher Shim-Request
  pro Nutzer-Aeusserung; K0-Zaehler).

**Pre-Mortem:** Die KI sagt bei jedem zweiten Turn "Mhm." und wirkt dadurch aufgesetzt statt
natuerlich — schlimmer als die Stille, die wir kaschieren wollten. Gegenmittel: Schwelle T
(Filler nur bei langsamen Turns, nicht immer) + Rotation + Owner-Urteil im Testanruf als
subjektives Gate. **Wenn der Owner sagt "nervt", wird die Phase verworfen — kein Feilschen.**

**Abbruchkriterium:** G1 ROT (kein Streaming → kein Filler-Chunk moeglich) → gestrichen.
E6.2 FAIL → sofort zurueck.

**Umsetzung: `phase-impl-lean`.** Begruendung: Es ist zwar wenig Code, aber es ist Code am
**Tool-Entscheidungspunkt** mit Verhaltensrisiko (Filler vs. `end_call`) — und genau dort hat
uns die `call-quality-chain`-Lehre schon einmal eingeholt ("enge Verbote am
Tool-Entscheidungspunkt; breite Regeln kippen in Ueberkorrektur"). Dualer Review lohnt.

**Kosten:** vernachlaessigbar (ein paar TTS-Zeichen pro Turn).

---

### K4 — `keyterm` gegen den STT-Restfehler (klein, optional)

**Ziel:** Das verbleibende Kauderwelsch (`"vêtementgut"`) reduzieren, **ohne** das STT-Modell
zu wechseln.

**Warum kein Modellwechsel:** Er wuerde uns Interruption Prediction kosten — und die ist
flux-exklusiv und **die Grundlage von K1**, unserem staerksten Hebel. Ein Modellwechsel wuerde
also den besten Fix gegen S1 opfern, um einen seltenen Transkriptions-Fetzen zu reparieren.
Das ist ein schlechter Tausch. (Details in §8.)

**Aenderung:** `transcription.settings.keyterm` befuellen — per Call, analog zum bereits
gebauten `language`-Hint. Sinnvolle Terme: Tenant-/Firmenname, Name des Angerufenen, das
Anrufziel-Vokabular (z.B. "Termin", "Friseur", "Rueckruf"). Telnyx unterstuetzt dort
Mustache-Variablen — der per-Call-Kontext ist also einsetzbar.
**Grenze beachten (F8):** Nicht die 100 Terme sind das Limit, sondern **500 Tokens pro Request**;
Deepgram empfiehlt 20-50 Terme. Bei Telnyx ist es ein komma-separierter String (bei Deepgram
roh dagegen wiederholte Query-Parameter — nicht verwechseln).

**Falsifizierbare Erwartung:**
- E4.1: Namen/Fachbegriffe aus der Keyterm-Liste erscheinen im Live-Transkript korrekt, wo sie
  vorher verstuemmelt wurden. Gegenprobe wie im RCA: Whisper-Referenz-Transkription desselben
  Audio-Segments.
- E4.2 (ehrlich): Ein generisches deutsches Wort wie "gut" wird `keyterm` **nicht** retten —
  die Massnahme wirkt nur auf **bekanntes Vokabular**. Der Restfehler bei Allerweltswoertern
  bleibt und wird bewusst akzeptiert.

**Pre-Mortem:** Wir stopfen die Keyterm-Liste voll, reissen das 500-Token-Budget und bekommen
einen API-Fehler bei JEDEM Call — ein stiller Totalausfall der Transkription. Gegenmittel:
harte Laengenbegrenzung im Code + Test.

**Abbruchkriterium:** Wenn E4.1 nach einem Testanruf keinen Unterschied zeigt → verwerfen,
Restfehler akzeptieren (das ist ein legitimes Ergebnis, siehe §8).

**Umsetzung: direkter Edit + Test.** Kein Lean-Workflow: der per-Call-Transcription-Override ist
bereits gebaut (fuer `language`) und dual-reviewed; K4 haengt ein zweites Feld an denselben,
bereits abgesegneten Seam.

**Kosten:** ~0.

---

### K8 — Eager-EOT einschalten (Latenz gegen Geld — reine Owner-Entscheidung)

**Ziel:** TTFA senken, indem Telnyx die Generierung startet, **bevor** der Turn final ist.

**Das ist die Technik, die LiveKit "preemptive generation" nennt und standardmaessig AN hat.
Telnyx hat sie auch — und macht sie selbst** (nicht Deepgram, nicht wir): "Starts tentative LLM
responses before final turn completion" (F3). Im BYO-LLM-Betrieb ist **unser Shim das LLM** →
Telnyx wuerde uns spekulativ frueher anrufen.

**Der Preis, unumwunden:** Deepgram beziffert ihn selbst mit **"50-70 % more LLM calls"** (F4).
Jeder spekulative Turn, der verworfen wird, ist **voll bezahlte Anthropic-Arbeit**. Und
(F5): **Wir koennen spekulative Turns nicht von finalen unterscheiden** — es gibt keinen Marker,
keinen Header, kein Metadaten-Feld. Wir wuerden also blind 50-70 % mehr LLM-Calls bezahlen.

**Das kollidiert direkt mit Regel 1** (Budget-Gates duerfen nicht stillschweigend aufgeweicht
werden). Deshalb:

**Harte Vorbedingung:** K0 (Shim-Request-Zaehler pro Call) MUSS live sein, **bevor** dieser
Schalter umgelegt wird. Ohne ihn fliegen wir bei den Kosten blind.

**Aenderung:** Eine Zeile im Provisioner: `eager_eot_threshold` 0.8 → 0.5 (< `eot_threshold` 0.8).

**Falsifizierbare Erwartung:**
- E8.1: `end_user_perceived_latency_ms` (K0-Baseline) sinkt messbar.
- E8.2 (**das eigentliche Gate**): Die Shim-Requests pro Nutzer-Aeusserung steigen um
  **hoechstens den Faktor, den der Owner vorher als akzeptabel benannt hat**. Deepgrams eigene
  Zahl ist 1,5-1,7x. Steigt es staerker → sofort zurueck.
- E8.3: Der Budget-Guard (`MAX_BUDGET_EUR`, global UND pro Tenant) bleibt unveraendert wirksam —
  er zaehlt Geld, nicht Turns, und faengt Ausreisser weiterhin ab.

**Pre-Mortem:** In einem Jahr ist die LLM-Rechnung um 60 % gestiegen, niemand hat es mit diesem
Schalter in Verbindung gebracht, weil der Zusammenhang unsichtbar ist (F5). Gegenmittel: K0 als
harte Vorbedingung; E8.2 als Zahl-Gate; und **diese Phase wird nicht "nebenbei" mitgenommen** —
sie ist eine bewusste Owner-Entscheidung "Latenz gegen Geld".

**Abbruchkriterium:** E8.2 gerissen → eine Zeile zurueck.

**Umsetzung: direkter Edit + Provisioner-Lauf** (eine Zeile), **aber Owner-Kostenentscheidung
mit K0 als Vorbedingung.** Kein Lean-Workflow (der Code ist trivial; das Risiko ist
oekonomisch, nicht technisch — und oekonomische Risiken loest kein Code-Review, sondern eine
Messung).

**Kosten:** **+50-70 % LLM-Calls** (Deepgram-Zahl). Bei einem geschaetzten Anruf von ~$0,03
LLM-Kosten (8 Turns, ohne Caching, Preise F16 — **Token-Zahlen geschaetzt, nicht gemessen**)
waeren das ~$0,015-0,02 mehr pro Anruf. Klein pro Anruf, aber es ist ein **Multiplikator auf
eine Kostenachse**, und bei Millionen-Skala multipliziert sich das mit.

---

### K9 — E4.1 nachholen (Bench, S5) — blockiert

**Status:** `npm run convo-bench` (Szenario `kauderwelsch-erstantwort`, n>=5) kann weiterhin
nicht laufen. Der lokale `ANTHROPIC_API_KEY` liefert **heute erneut geprueft HTTP 401**
(eigene Messung, 2026-07-12). Der gueltige Key liegt nur auf Render.

**Owner-Gate:** Gueltigen Key in die lokale `.env` legen. Danach ist K9 ein Kommandolauf, kein
Projekt — und er ist Vorbedingung fuer die `count_tokens`-Messung in K0.

**Kosten:** reine LLM-Tokens (Persona + Judge, 5 Laeufe), kein Anruf. Groessenordnung wenige
Cent bis ~1 USD je nach Szenario-Laenge (**geschaetzt**).

---

## 5. Reihenfolge nach Wirkung/Aufwand

| # | Phase | Wirkung | Aufwand | Anruf noetig? | Workflow |
|---|---|---|---|---|---|
| 1 | **K0** Messgrundlage | Vorbedingung fuer alles | klein | nein | direkter Edit |
| 2 | **K1** Interruption Prediction 0.4 | **hoch** (S1 direkt) | 1 Zeile | ja (gebuendelt) | direkter Edit |
| 3 | **K2** background_audio office | mittel (S4 gefuehlt) | 1 Zeile | ja (gebuendelt) | direkter Edit |
| 4 | **K3** Farewell kalibrieren | mittel (S3) | klein | nein zum Bauen | direkter Edit |
| 5 | **G1** Streaming-Gate | entscheidet K5+K6 | klein | **ja** | Spike (Wegwerf) |
| 6 | **K5** Sentence-Streaming | hoch (S1+S4+Latenz) | **gross** | ja | **phase-impl-lean** |
| 7 | **K6** Filler/Soft-Timeout | hoch (S4) | mittel | ja | **phase-impl-lean** |
| 8 | **K4** keyterm | klein (S2-Rest) | klein | ja | direkter Edit |
| 9 | **K8** Eager-EOT | mittel (Latenz) | 1 Zeile | ja | Owner-Kostenentscheidung |
| — | **K9** Bench | Beweis fuer P4 | 1 Kommando | nein | blockiert (Key) |

**Buendelung:** K1 + K2 + K3 gehen in **EINEN** Testanruf (getrennte Observablen:
Turn-Verwerf-Verhalten / Kanal-RMS / Hangup-Timing — sie konfundieren sich nicht). G1 braucht
einen **eigenen** Anruf gegen einen Wegwerf-Assistant, weil es die Produktions-Antwort
kuenstlich verzoegert.

**Der ehrliche erste Schritt:** K0 + K1 + K2 + K3, ein Testanruf. Das sind ~3 Konfigurations-
zeilen, ein kalibrierter Konstantensatz und ein Auswerte-Skript — und es adressiert die
groesste belegte Schwachstelle (S1) mit dem Feature, das Telnyx exakt dafuer gebaut hat.

---

## 6. Kostenabschaetzung

Verifizierte Preise (F16, 2026-07-12): Haiku 4.5 Input **$1/MTok**, Output **$5/MTok**,
Cache-Read $0,10/MTok, Cache-Write(5min) $1,25/MTok; Tool-Use-Overhead **496 Tokens/Request**.

| Posten | Betrag | Sicherheit |
|---|---|---|
| LLM pro Anruf (8 Turns, wachsender Kontext, ohne Caching) | **~$0,03** | **GESCHAETZT** (Token-Zahlen angenommen; per K0 messbar) |
| Testanruf (Telnyx-Minuten + STT + TTS) | aus `call.analyzed` des jeweiligen Calls exakt ablesbar | **nicht beziffert** — ich schaetze hier bewusst nicht |
| K1, K2, K3, K4 laufend | ~0 | — |
| **K1 spart**: verworfene Antworten = LLM + TTS ohne Gegenwert (letzter Call: **25 % Verschnitt**) | Ersparnis | **MESSUNG** (Call 2) |
| **K3 spart**: bis zu 4s kuerzere Anrufe (Telnyx-Minuten) | Ersparnis | **MESSUNG** |
| **K8 kostet**: +50-70 % LLM-Calls | ~ +$0,015-0,02/Anruf | **DOKU** (Deepgram-Zahl) + geschaetzte Basis |
| K9 Bench (5 Laeufe) | wenige Cent bis ~$1 | **GESCHAETZT** |

**Nicht beziffert, bewusst:** Telnyx-Minutenpreise fuer den AI-Assistant-Pfad. Die liegen in
den `call.analyzed`-Kostenposten unserer echten Calls und sind dort exakt ablesbar — ich rate
sie nicht.

---

## 7. Wie die Phasen zusammenwirken (Abhaengigkeiten)

- **K1 pinnt uns auf `deepgram/flux`.** Interruption Prediction ist flux-exklusiv. Damit ist
  ein STT-Modellwechsel (§8) faktisch vom Tisch, solange K1 lebt — das ist gewollt.
- **K0 ist Vorbedingung fuer K8** (Kosten-Sichtbarkeit) **und fuer K5/K6** (Baseline, gegen die
  der Erfolg gemessen wird).
- **G1 ist ein Ja/Nein-Tor vor K5 und K6.** Rot = beide gestrichen.
- **K5 ist Vorbedingung fuer K6** (ohne Streaming kann der Shim keinen Filler VOR der Antwort
  ausliefern).
- **K3 und K5 beruehren beide den `end_call`-Pfad.** Wenn K5 kommt, muss K3s Farewell-Delay
  gegen den gestreamten Abschiedssatz neu gedacht werden (die Zeichenzahl steht dann frueher
  fest, aber die Wiedergabe laeuft laenger). Das ist kein Konflikt, aber eine Kopplung, die im
  K5-Plan explizit auftauchen muss.

---

## 8. Was NICHT gemacht werden sollte (mit Begruendung)

**KEINE Prompt-Caching-Phase.** Das war eine der Ausgangsideen und sie ist tot: Haiku 4.5
verlangt **4.096 Tokens** Mindest-Praefix (F15), unser cachebarer Praefix (Tools + System)
liegt bei **~1.200-1.700**. Zwei unabhaengige Killer: (a) wir sind unter dem Minimum, (b) ein
Minuten-Zeitstempel im gecachten Block wuerde ihn ohnehin bei jedem Minutenwechsel
invalidieren. Und selbst wenn beides repariert waere: die Message-Historie eines 8-Turn-
Telefonats bringt den Praefix **nicht** ueber 4.096. Ausserdem — und das ist der eigentliche
Punkt — **Caching ist ein Kosten-Hebel, kein Latenz-Hebel**. Wer es als Anrufqualitaets-Phase
verkauft, liefert nicht. (Empfehlung: `cache_control` steht drin, ist harmlos, kann bleiben;
in K0 wird per `cache_read_input_tokens` einmal belegt, dass es inert ist, und dann ist das
Thema dokumentiert erledigt.)

**KEIN STT-Modellwechsel.** `assemblyai/universal-streaming` waere der einzige Kandidat mit
eigener Turn-Detection — aber Interruption Prediction (K1, unser staerkster Hebel gegen S1) ist
**flux-exklusiv**. Wir wuerden den besten Fix opfern, um einen seltenen Transkriptions-Fetzen
zu reparieren. Bei einem Fragment pro Anruf ist der Restfehler im Rahmen dessen, was auch
fuehrende ASR-Systeme bei 8-kHz-Telefonaudio produzieren. **Restfehler akzeptieren** ist hier
die richtige Entscheidung, nicht Kapitulation.

**KEIN `start_speaking_plan`-Tuning.** Telnyx sagt in der Spec woertlich, dass es bei
`deepgram/flux` nicht greift (F11). Es steht bei uns ohnehin auf `null`.

**KEIN Hangup-Fix auf Basis von `send_conversation_message_events`.** Das war der attraktivste
Kandidat fuer ein echtes TTS-Ende-Signal und ist der bestwiderlegte: null Spec, null Doku, null
Web, ein einziges fremdes GitHub-Repo, das das Flag setzt und nie ausliest (F10). Wer es
trotzdem will: Wegwerf-Assistant + Flag `true` + ein Testanruf + Event-Diff — **vorher nichts**.

**KEIN Stack-Wechsel.** Ausdrueckliche Leitplanke des Owners, und die Recherche stuetzt sie:
Das Verwerfen laufender Antworten ist Branchenstandard (LiveKit, Pipecat, Vapi, Retell, OpenAI
Realtime canceln alle) — ein Wechsel wuerde das Problem nicht loesen, sondern nur umziehen.

**KEIN Telnyx-`speak` waehrend eines laufenden Assistant-Gespraechs** (als Filler-Ersatz).
Technisch waere es einen Funktionsaufruf entfernt (der Adapter kann es, die
`call_control_id` liegt vor), aber **keine Quelle sagt, was Telnyx dann tut** — ueberlagerte
Audiostroeme, Assistant-Stoerung, Fehler? Unbelegt. Wenn ueberhaupt: Spike gegen den
Wegwerf-Assistant, nie direkt in Produktion.

---

## 9. Benannte Telnyx-Grenzen (Owner-Entscheidungen fuer spaeter, keine Empfehlung)

Gemaess Leitplanke hier festgehalten, **nicht** als Argument fuer einen Stack-Wechsel:

1. **Kein TTS-Ende-Event pro Turn** (F9, doppelt bewiesen). Solange das so ist, bleibt unser
   Hangup nach dem Abschiedssatz eine **Schaetzung**. K3 macht die Schaetzung gut; sie bleibt
   eine Schaetzung.
2. **Kein Queueing statt Cancel** — es existiert keine Option, eine noch nicht gespielte Antwort
   bei Zwischenrede zu behalten. (Gilt aber branchenweit, siehe §1.)
3. **Spekulative Turns sind fuer uns unsichtbar** (F5). Wenn K8 kommt, zahlen wir eine
   Kostenachse, die wir nur indirekt (Shim-Zaehler) beobachten koennen.
4. **`background_audio` ist per Call nicht ueberschreibbar** (F7) und es ist unbelegt, ob es im
   `ai_assistant_start`-Pfad ueberhaupt greift. K2 ist der Beweisversuch.
5. **Streaming-Konsum unbekannt** (F12). G1 klaert es. Ist es rot, ist die Latenz im
   Telnyx-Pfad nach unten begrenzt durch "volle Antwort abwarten, dann synthetisieren".
6. **Doku-Drift ist systematisch.** Drei Quellen nennen drei verschiedene Eager-EOT-Defaults
   (0.8 / 0.4 / 0.3); `interrupt_prediction_threshold` fehlt ganz in der Spec; das
   Top-Level-`Assistant`-Schema in der Spec ist ein veraltetes Duplikat aus der TeXML-Aera.
   **Lehre, die ueber dieses Dokument hinausgeht: Bei Telnyx zaehlt nur der Objekt-`GET`,
   nie die Doku.** (Bestaetigt die PUT-404-Lehre von 2026-07.)

---

## 10. Owner-Gates

1. **Freigabe dieses Plans** und der Reihenfolge (§5).
2. **Gueltiger `ANTHROPIC_API_KEY` in der lokalen `.env`** — blockiert K9 (Bench) und den
   `count_tokens`-Teil von K0. Der Key auf Render ist gueltig, der lokale ist es nicht (401,
   heute geprueft).
3. **Provisioner-Laeufe gegen den Live-Assistant** (K1, K2, K8) — jeder ist eine Zeile und
   sekundenschnell reversibel, aber er schreibt das Live-Objekt.
4. **Testanruf 1** (gebuendelt K1+K2+K3, mit Overlap-Probe — insbesondere E1.2, das
   Barge-in-Gate).
5. **Testanruf 2** (G1, gegen einen Wegwerf-Assistant, der danach geloescht wird).
6. **Kostenentscheidung K8** (+50-70 % LLM-Calls gegen Latenz) — bewusst, nicht nebenbei.

---

## 11. Pre-Mortem (Gesamtplan)

Angenommen, es ist 2027 und dieser Plan war ein Fehler. Was ist passiert?

**(a) Wir haben K1 zu strikt eingestellt und Barge-in verloren** — der eine Grund, warum wir
ueberhaupt auf Telnyx sind. Gegenmittel: E1.2 ist ein harter Rollback-Trigger, kein
Beobachtungspunkt; 0.4 ist Telnyx' eigener Startwert.

**(b) Wir haben K5 gebaut, und Telnyx puffert doch** — zwei Wochen fuer nichts. Gegenmittel:
G1 kostet einen Testanruf und steht **vor** K5. Diese Reihenfolge ist nicht verhandelbar.

**(c) K8 hat die LLM-Rechnung leise um 60 % erhoeht** und niemand hat den Zusammenhang gesehen,
weil spekulative Turns unsichtbar sind. Gegenmittel: K0-Zaehler als **harte Vorbedingung**;
E8.2 als Zahl-Gate; Budget-Guard bleibt unveraendert scharf.

**(d) Der Filler (K6) hat genervt und Anrufer haben aufgelegt** — wir haetten die Stille besser
in Ruhe gelassen. Gegenmittel: Schwelle statt Dauer-Filler; Rotation; Owner-Urteil als
subjektives Veto ohne Diskussion.

**(e) Wir haben eine Sekunde Latenz gejagt und dabei die Gespraechsfaehigkeit kaputt gemacht**
(gestreamte Saetze, die der nachfolgende Tool-Aufruf widerlegt). Gegenmittel: F13 ist als
**nicht garantiert** erkannt, die Policy ist Teil von K5, E5.2 ist ein Gate — und K5 ist die
einzige Phase mit Pflicht-Lean-Workflow.

**(f) Wir haben viel gemessen und wenig geliefert.** Gegenmittel: K0 ist bewusst klein
(ein Skript, ein Zaehler, eine Messung) und der erste echte Schritt (K1+K2+K3) sind drei
Konfigurationszeilen — kein Monat Vorarbeit.
