# EL-Agenten-Stimme: Befund-Doc ST0 (2026-09-03)

Begleit-Doc zu tasks/PLAN-AGENTEN-STIMME.md (Phasen ST0-ST5). Quellen: Workflow-Run
wf_ac26e11f-91a (3 read-only Agenten: Drift, Render-Logs, Anruf-Vorbereitung) +
nachgelagerte Vorfalls-Audio-Analyse. Maskierungsregel: Nummern nur als +49***xxxx,
keine Secrets, keine Eigennamen. Transkripte/Audio NIEMALS aendern (Art. 50) und nicht
ins Repo committen (nur /tmp).

## ST0-1 Drift-Lauf (npm run elevenlabs:drift, 2026-09-03)

- **Exit-Code 1 (ROT)** — erwartetes Rot, keine Ueberraschung: 38/38 besessene Felder
  verglichen, 0 Verbots-Verletzungen. Davon 2 bewusst ausgenommene Abweichungen
  (Owner-Entscheidung 2026-08-15, Messbetrieb; Rueckdreh auf G7-SOLL vor dem ersten
  Fremdkunden): `platform_settings.privacy.retention_days` SOLL 0 / LIVE -1,
  `platform_settings.privacy.record_voice` SOLL false / LIVE true.
- **1 blockierende Abweichung**: `conversation_config_override` (Erlaubnis-Karte).
  Alle 18 gemeinsamen Blattpfade LIVE = SOLL; die Abweichung entsteht NUR durch 2
  LIVE-only Blattpfade, die die Vorlage nicht deklariert:
  `tts.supported_voices`=false, `turn.soft_timeout_config.additional_soft_timeout_messages`
  =false. Beide false = keine Erlaubnis erweitert. -> Vor ST2 entscheiden (Offener
  Punkt 1); ohne Entscheidung bleibt das Drift-Gate an der Karte dauerhaft rot.
- **Erlaubnis-Karte LIVE** (read-only GET auf den Agenten, 2026-09-03):
  `agent.first_message`=**TRUE** — Antwort auf Entscheidung 7: die Owner-Eroeffnung ist
  inzwischen override-faehig und damit live wirksam (im Vorlagen-SOLL als NACHTRAG
  OC-P2, 2026-08-20, dokumentiert; inhaltliche Weiterverfolgung bleibt OC-Kette).
  `tts.voice_id` LIVE true = SOLL true; `conversation.text_only` LIVE false = SOLL
  false (die offene Tuer Sprach->Text ist zu); `agent.language` = SOLL.
  **R7-Falle entkraeftet**: die fuer den Push gefuerchtete Abweichung an
  voice_id/text_only existiert nicht (messbar belegt).
- **Alle vier Tag-Quellen LIVE im SOLL** (keine Konfig-Ursache):
  `tts.suggested_audio_tags`=[] (leer), soft_timeout `message`="Right, there is a bit
  more to that...", `additional_soft_timeout_messages`=["I am still on it, almost
  there..."] (beide klammerfrei), `llm_generated_message_prompt_override` byte-identisch
  mit dem englischen SOLL inkl. "Never write anything in square brackets...".
  `use_llm_generated_message` steht LIVE weiter auf true (Dashboard-Besitz, unbesessen).
- **Kopplung an ST1/ST2**: ST1 gestuetzt, nicht erschuettert — die Wurzel von B1/B2 ist
  nicht die Live-Konfiguration, sondern modell-/promptseitig. ST2-Push bleibt
  Owner-Gate (er beruehrt die Erlaubnis-Karte als Schreibweg sowie die beiden
  Owner-Ausnahmen retention/record_voice).

## ST0-2 [el-tags]-Log-Rueckblick (Render, srv-d8m0fhflk1mc73bno570)

- Angefragt: 30 Tage (ab 2026-08-04T00:00Z). **Render-Retention betraegt 7 Tage** —
  beobachtbar nur 2026-08-27T13:56Z bis 2026-09-03T14:01Z; 08-04 bis 08-27 ist
  logseitlich UNERREICHBAR (API lehnt aeltere Startzeiten ab, aeltere Eintraege sind
  evicted). Der 19.08.-[freundlich]-Fall ist logseitlich weder bestaetigbar noch
  widerlegbar.
- **Trefferzahl im beobachtbaren Fenster: 3.**

  | Zeit (UTC)      | Marke      | call-ID          | lokal (MESZ)   |
  |-----------------|------------|------------------|----------------|
  | 2026-08-30 09:36 | [freundlich] | call_mtfm5ss7g3jz | 30.08. 11:36 |
  | 2026-09-02 07:54 | [freundlich] | call_mtjsvfkpuzm8 | 02.09. 09:54 |
  | 2026-09-02 15:58 | [froehlich]  | call_mtka4kunn0qy | 02.09. 17:58 |

- **Muster-Lesart**: [freundlich] ist die dominierende Marke (3 von 4 bekannten
  Ereignissen inkl. 19.08.); jedes Ereignis genau 1 Marke; 02.09. zwei Ereignisse
  innerhalb ~8 h. Bemerkenswert: die 3 einzigen seit 08-30 im Log sichtbaren
  place_call-bestaetigten Outbound-Anrufe sind exakt die 3 Treffer — **jeder im Log
  sichtbare Outbound-Anruf seit dem 30.08. sprach eine Klammer-Marke (3/3)**. Eine
  verlaessliche Trefferquote pro Anruf ist aus Logs allein nicht berechenbar (11 von 14
  sichtbaren call-IDs erscheinen nur in Settlement-Sweeps, ihre Anruf-Zeitpunkte sind
  nicht datierbar) — genau das macht das ST3-Zaehlfeld (Entscheidung 6) noetig.

## ST0-3 Recording + Testanruf-Vorbereitung

- **Recording AKTIV, hart belegt**: `platform_settings.privacy.record_voice`=true,
  `retention_days`=-1 (unbegrenzt), `delete_audio`=false,
  `delete_transcript_and_pii`=false (LIVE-GET 2026-09-03; besessenes Feld mit
  Ausnahme-Eintrag in der Vorlage). **Audio-Abruf belegt**: Vorfalls-Conv liefert
  GET .../audio HTTP 200, audio/mpeg, 661869 Bytes, 41,36 s. Der Mitschnitt entsteht
  ANBIETERSEITIG bei ElevenLabs (nicht bei Telnyx, nicht im Repo).
- **Abrufweg**: Audio `GET /v1/convai/conversations/<conv_id>/audio` (xi-api-key aus
  .env; Wert nie ausgeben). conv_id via `GET /v1/convai/conversations?agent_id=...`
  (neueste zuerst) oder aus dem Hermes-Call-Record (Store, MCP get_transcript).
  Transkript: EL-Conversations-API (Turn-Timestamps; KEINE Wort-Timestamps).
- **Anrufweg** (wie der Vorfall): Hermes-MCP-Connector, Tool `place_call` gegen den
  Prod-Gateway (REST /api/calls ist internalOnly/Loopback und steht von aussen nicht
  zur Verfuegung). Parameter: `to` = eigene hinterlegte Nummer (Ziffern exakt wie
  hinterlegt, keine clientseitige E.164-Umformung), `objective` (sprechbarer
  Ich-Satz), `briefing` (Test: Gedicht-Wunsch + 1 Kontrollfrage, <= 2 min),
  `constraints` ("Anruf kurz halten (unter 2 Minuten), keine Termine oder Zusagen,
  nur Test"), `max_duration_s`=120. Danach `get_call_status`, am Ende
  `get_transcript`.
- **Owner-Self-Call** (nur dokumentierend): Praedikat `ownerSelfCallGranted` =
  Schalter an UND Tenant gepinnt UND Ziel strikt gleich hinterlegter Nummer
  (fail-closed). Am Vorfall aktiv (callee_relation-Block injiziert). Vor dem Anruf
  Flags read-only gegenlesen (Render-Env kann sich ohne Deploy aendern). Greift das
  Praedikat nicht: derselbe Anruf laeuft im Dritt-Modus mit VOLLER Offenlegung —
  Anruf funktioniert, Protokoll dreht auf Dritt-Modus (selbst ein Befund).
- **Protokoll Testanruf (<= 2 min)**: Owner nimmt selbst ab (NICHT Voicemail —
  sonst Test unbrauchbar). (a) Gedicht-Wunsch in Vorfalls-Naehe: "Kannst du mir
  vielleicht 'ne zehn Sekunden Gedicht machen und erzaehlen?" — dann RUHIG BLEIBEN
  (soft_timeout braucht 2,0 s Stille), Gedicht anhoeren. (b) Kontrollfrage ohne
  Werkzeug, z.B. "Erzaehl mir in einem Satz, was du gerade gemacht hast." (c) Beenden
  ("Danke, das reicht, guten Tag."). Analyse ohne Menschenohr: ffmpeg silencedetect
  (noise=-35dB, d=0.45 grob / d=0.15 fein) + Turn-Timestamps + astats/aspectralstats
  Segmentvergleich (RMS/Zentroide).
- **Vorfall-Referenzmesswerte** (Vorfalls-Audio, heute): Stille 3,28(0,49 s),
  10,49(0,99 s), 17,88-20,72 s (2,84 s — Luecke zwischen Gedicht-Wunsch und
  Agent-Turn), Gedicht-Innenpausen 25,32(0,63), 30,48(0,79), 33,61(0,58 s).

## ST0-4 Vorfalls-Audio-Analyse (B1-Filler-Frage) — ERGEBNIS: eine-generation

NEUER BEFUND: Das Vorfalls-Audio EXISTIERT (record_voice war zur Vorfallszeit an,
Retention unbegrenzt) — die Filler-Frage wurde am ORIGINAL-Vorfall geprueft
(read-only, kostenlos; ffmpeg 9.0, MP3 16 kHz mono, 41,364 s, 661869 Bytes).

**URTEIL: `eine-generation` — die Filler-Hypothese ist WIDERLEGT.** Beide Ankuendigungen
sind EIN kontinuierlicher Sprechzug aus EINER Modell-Generation (LLM-Stream). Drei
unabhaengige Vorhersagen der Filler-Hypothese sind alle gescheitert:

1. **Grenzpause vs. Baseline**: Pause zwischen Satz 1 und Satz 2 = 0,33 s (23,750-24,079,
   -35 dB; 0,35 s bei -30 dB) — UNTER der Baseline der Gedicht-Satzgrenzen
   (0,32-0,83 s, Median 0,58; 0,57x des Medians). Filler-Signal haette >1,5x erfordert.
   (Die erste Pause im Turn, P1 21,25/0,26 s, ist die Komma-Kante nach "Gut," — Satz 1
   gesamt 3,03 s, Satz 2 1,24 s, Gedicht ab 25,95 s.)
2. **Stimmprofil an der Grenze**: RMS/Peak/Zentroid-Spruenge an Satz1/Satz2
   (-0,67 dB / -1,64 dB / +490 Hz) sind durchgaengig KLEINER als an der Kontrolle
   Satz2/Gedicht (+1,06 dB / +1,72 dB / -803 Hz) — die Kontrolle ist sicher dieselbe
   Generation. Innerhalb Satz 1 schwankt RMS natuerlich um 3,05 dB. Kein
   Synthese-Segment-Sprung.
3. **Frueheinsatz-Fenster leer**: 19,5-20,7 s (Einsatzpunkt eines 2,0-s-Fillers waere
   ~19,88 s) liegt bei -80,9 dB RMS — identisch zur Referenzstille, ~60 dB unter
   Sprachniveau; die Luecke bleibt bis -50 dB/d=0,05 ununterbrochen still.

**Quantitative Erklaerung der Luecke** (Turn-Metrik aus dem Conversations-JSON):
`convai_turn_silence_before_initiation`=0,512 s (Turn initiert VOR der 2,0-s-Schwelle!),
LLM-TTFB 2,067 s + TTS-TTFB 0,143 s → 0,512+2,067+0,143 = 2,72 s ≈ gemessene
2,84-s-Luecke (Nutzer-Ende 17,883 s, Agent-Beginn 20,725 s). Die Luecke ist
vollstaendig durch Endpointing + LLM-Latenz erklaert — kein Platz fuer einen Filler.
Befund der Forensik ("beide Saetze in EINER LLM-Message") wird damit
audio-seitig bestaetigt: B1-Satz 1 ist echter claude-sonnet-5-Text.

Vorbehalte (dokumentiert): `realtime_config_snapshots.turn`=null (soft_timeout-Konfig
im Payload nicht nachweisbar — ob sie an war, ist aus Vorlage/drift uebernommen);
Text-zu-Segment-Zuordnung ueber Sprechdauern inferiert (kein ASR), aber zwangslaeufig
(3,03 s / 1,24 s / Gedicht); Spektralstatistik auf 9-36 Frames je Segment (Trend
sicher, Einzelwerte mit Streuung). Ein generierter, aber nie ausgegebener Filler waere
audio-unsichtbar — haette den Verlauf aber auch nicht gepraegt.

**Kopplung an den Plan:**
- **ST1 unveraedert, Begruendung verschiebt sich**: B1-Regel im Master-Prompt wird
  WICHTIGER (Quelle ist das Modell selbst). Die soft_timeout-Umformulierung (O1a) ist
  weiter richtig — aber nun als "Gegen-Instruktion entfernen" (besessenes Feld fordert
  heute "hinting at what you are about to address") begruendet, nicht als
  "Filler-Quelle des Vorfalls entschaeerfen". R6-Argument (Stille statt Bruecke)
  bleibt entkraeftet: der Filler hat im Vorfall ueberhaupt nicht gefeuert.
- **ST0-Mitschnitt-Testanruf (Entscheidung 1)**: seine Primaerfrage ist damit am
  Original beantwortet — staerkere Evidenz als jede Reproduktion (ein neuer Anruf
  koennte B1 ohnehin nicht deterministisch reproduzieren). Owner-Entscheidung, ob er
  trotzdem durchgefuehrt wird (Lead-Empfehlung: ueberspringen; der
  ST4-Verifikationsanruf misst nach dem Push live). [Entscheidung ausstehend]
- Push-Semantik der Erlaubnis-Karte (Offener Punkt 2) ist im eigenen Push-Skript im
  Code lesbar (patcht nur abweichende besessene Pfade) — in ST2 am Code verifizieren,
  keine Provider-Frage.

## ST1-Regeln gelandet (2026-09-03, O1 - Repo-Seite, KEIN Push)

- Gelten tun die Regeln an FUENF Stellen (Wahrheits-Kette O1, Vorlage ist kanonisch):
  Master-Prompt (B1-Regel + B2-Ergaenzung im Abschnitt SAY ONLY WHAT IS NEEDED),
  soft_timeout_prompt_override (GANZ umgeformt - Bestaetigung statt Ankuendigung,
  Schlusssatz/Klammer-Verbot bleibt), speechRules de/en/fr (je zwei neue Zeilen).
  Pins: `test/el-stimme-abnahme.test.js`, AS1-AS4 alle GRUEN (`npm run test:abnahme`
  meldet 7 von 7).
- **Betriebserwartung bis ST2:** `npm run elevenlabs:drift` wird ROT mit ZWEI
  ZUSAETZLICHEN erwarteten Abweichungen - `agent.prompt.prompt` und
  `llm_generated_message_prompt_override` - weil ST1 nur das SOLL aendert und der Push
  (Owner-Gate) erst in ST2 laeuft. Der "frische Driftlauf vor dem Push" (R7) darf an
  diesen beiden Abweichungen NICHT anhalten; die beiden ST0-Ausnahmen
  (retention_days/record_voice) und die Erlaubnis-Karte bleiben unveraendert Teil des
  ST0-Befunds. AS1 prueft nur den ST0-Abschnitt dieses Docs und bleibt gruen.

## ST2 Repo-Vorbereitung (2026-09-03, KEIN Push)

1. **Entscheidung 9 umgesetzt**: die 2 LIVE-only Erlaubnis-Schluessel stehen in der
   SOLL-Karte - `tts.supported_voices`=false, `turn.soft_timeout_config.additional_soft_timeout_messages`
   =false. Einfuegeposition je LIVE-GET (Vergleichskern `istGleich` in
   scripts/lib/elevenlabs-besitz.mjs vergleicht per JSON.stringify, Schluesselreihenfolge
   ist serialisierungsrelevant): `supported_voices` zwischen `voice_id` und `stability`,
   `additional_soft_timeout_messages` hinter `message`. Beide Werte false = keine
   Erlaubnis erweitert (Semantik der Karte: nur `true` erlaubt), kein Push dafuer
   noetig (SOLL == LIVE an der Karte). BELEGT durch read-only Drift-Lauf 2026-09-03
   (KEIN Schreibzugriff): `conversation_config_override` steht NICHT mehr in der
   Abweichungsliste.
2. **Pin-Erweiterung (Entscheidung 4)**: zwei neue art-wert-Eintraege in
   `_besitz.felder`, direkt hinter `soft_timeout_prompt_override`:
   `soft_timeout_llm_filler` (agent.conversation_config.turn.soft_timeout_config.
   use_llm_generated_message, SOLL true) und `soft_timeout_filler_limit`
   (agent.conversation_config.turn.soft_timeout_config.max_soft_timeouts_per_generation,
   SOLL 1). Beide SOLL-Werte sind der am 2026-09-03 per GET gemessene LIVE-Stand
   (Bewachung statt Korrektur, dasselbe Muster wie timezone/max_duration_seconds);
   Aenderungsweg im `_hinweis` je Eintrag ("SOLL aendern NUR in dieser Vorlage", dann
   npm run elevenlabs:push - nie am Dashboard, R9). Keine Push-Kandidaten (SOLL ==
   LIVE); der Drift-Lauf vergleicht jetzt 40/40 besessene Felder, beide Pins gruen.
3. **Push-Semantik am eigenen Skriptcode verifiziert** (scripts/push-elevenlabs.mjs,
   Symbol-Anker statt Zeilennummern): Schreib-Kandidaten sind nur ABWEICHENDE besessene
   Felder mit art "wert" und genau EINEM Live-Pfad (`vergleicheBesitz` ->
   `teileAbweichungen` -> `istSchreibbar`, `zielPfad` = livePfade[0]).
   `mitSchreibwerten` setzt `schreibWert = abweichung.soll.wert` - fuer die Karte der
   KOMPLETTE Karten-Wert -, `bauePatchKoerper` -> `setzeAnPfad(koerper, zielPfad,
   schreibWert)`: ein Karten-Patch setzt das GANZE Objekt, kein Blatt-Merge. Der
   Skriptkopf ("GEGENPROBE STATT VERTRAUEN") haelt die Anbieter-Messung fest: PATCH
   deep-merged verschachtelte Modelle, aber Dict-Felder ERSETZT es. Konsequenz: VOR
   Entscheidung 9 haette ein Karten-Push die 2 LIVE-only Schluessel GELAESCHT (SOLL
   kannte sie nicht); ab jetzt schreibt ein etwaiger Karten-Push sie mit, nichts geht
   verloren. Da SOLL == LIVE ist die Karte ueberhaupt kein Push-Kandidat mehr. Die
   Sperrliste `GESPERRTE_FELDER` (retention_days, record_voice) bleibt unberuehrt - der
   spaetere ST2-Push schreibt nur die ST1-Regelfelder `agent.prompt.prompt` und
   `llm_generated_message_prompt_override`.
4. **Betriebserwartung bis zum Push** (ersetzt/erweitert den ST1-Absatz): `npm run
   elevenlabs:drift` bleibt ROT mit GENAU den erwarteten Abweichungen -
   `retention_days` + `record_voice` (BEWUSST AUSGENOMMEN), `agent.prompt.prompt`,
   `llm_generated_message_prompt_override`. Die Erlaubnis-Karte ist aus der
   Abweichungsliste GEFALLEN (read-only Drift-Lauf 2026-09-03: 40/40 verglichen, 4
   Abweichungen, Exit-Code 1). Der frische Drift-Lauf unmittelbar vor dem Push (R7)
   darf nur noch an genau diesen vier Feldern rot sein - an jeder fuenften Abweichung
   ist anzuhalten.

### R7-Zwischenfall beim Vor-Push-Drift (2026-09-03)

Der Vor-Push-Drift (R7) meldete FUENF Abweichungen statt der erwarteten vier -
Block 4 hiess: an jeder fuenften Abweichung anhalten. Angehalten, per Deep-Diff
zweier Live-GETs (ST0 frueher Morgen vs. jetzt) aufgeklaert. KEIN Push bis
hierher, kein Schreibzugriff - nur Vorlagen-Edit und read-only GETs.

- **Ursache (Anbieter-seitig, kein Eingriff unserer Seite):** EL hat am
  Live-Agenten vier NEUE Keys ins Tool-API-Schema migriert, alle Wert null -
  `allowed_values` an `properties.question` und `properties.conversation_id`
  von get_consult sowie `properties.query` und `properties.conversation_id` von
  look_up (je Pfad `api_schema.request_body_schema.properties.*`). Die
  `version_id` ist UNVERAENDERT (agtvrsn_6601m0g...), niemand hat den Agenten
  bearbeitet, und die Vorlagen-Werkzeuge sind seit cd8a88c unbewegt (bewiesen)
  - eine EL-seitige Schema-Migration (Key-Default null = keine Einschraenkung),
  kein echter Drift.
- **Wirkung aufs Gate:** der Besitz-Eintrag `werkzeug_body_params_schema`
  vergleicht die Spiegel `tools.*._live_gemessene_form.request_body_schema` per
  JSON.stringify gegen die Live-Form; die vier fehlenden Keys machten die
  Werkzeuge scheinbar abweichend.
- **Nachzug:** alle vier Keys (null) in BEIDE Spiegel aufgenommen, Position je
  frischem Live-GET zwischen `dynamic_variable` und
  `allowed_values_dynamic_variable` (Schluesselreihenfolge
  serialisierungsrelevant); Nachtrag am Spiegel-Hinweis von get_consult
  (NACHTRAG ST2 2026-09-03). Die Push-Form `tool_config.api_schema` bleibt
  unberuehrt - kein Besitz-Eintrag zieht sie fuer diesen Vergleich heran.
- **Beleg:** Drift vorher ROT mit 5 Abweichungen, nachher ROT mit 4
  Abweichungen (beide Exit-Code 1; `werkzeug_body_params_schema` aus der Liste
  gefallen, die vier erwarteten bleiben: prompt,
  llm_generated_message_prompt_override, retention_days [BEWUSST AUSGENOMMEN],
  record_voice [BEWUSST AUSGENOMMEN]). Der Push-Blocker aus Block 4 ist damit
  wieder frei.

## Offene Punkte

1. **[erledigt ST2 2026-09-03]** Umgang mit den 2 LIVE-only Erlaubnis-Schluesseln
   (`tts.supported_voices`,
   `turn.soft_timeout_config.additional_soft_timeout_messages`, beide false):
   Owner-Entscheidung 9 - in die SOLL-Karte aufgenommen, Wert false, keine Erlaubnis
   erweitert. Drift meldet `conversation_config_override` nicht mehr (read-only
   Drift-Lauf 2026-09-03, s. Abschnitt "ST2 Repo-Vorbereitung", Block 1).
2. **[erledigt ST2 2026-09-03]** Push-Semantik der Karte (Besitz-Eintrag art 'wert'):
   am eigenen Skriptcode geklaert - der Karten-Patch setzt das GESAMTE Objekt
   (`mitSchreibwerten`/`bauePatchKoerper`/`setzeAnPfad` am kompletten Karten-Wert),
   und der Anbieter ERSETZT Dict-Felder beim PATCH statt zu mergen (Skriptkopf
   "GEGENPROBE STATT VERTRAUEN"). Ein Karten-Push nimmt die 2 Schluessel damit mit,
   statt sie still zu loeschen; SOLL == LIVE macht die Karte ohnehin zum
   Nicht-Kandidaten (s. Abschnitt "ST2 Repo-Vorbereitung", Block 3).
3. 19.08.-[freundlich] logseitlich nicht verifizierbar (7-Tage-Retention); optional
   Store-/Transkript-Pruefung.
4. Trefferquote [el-tags] pro Anruf: erst mit ST3-Zaehlfeld messbar (Logs allein
   datieren 11/14 Anruf-IDs nicht).
5. (Nicht ST0-ST5, nur gemeldet — Go-live-Bedingung): Rueckdreh
   retention_days/record_voice auf G7-SOLL vor dem ersten Fremdkunden.

## ST2 Push-Protokoll (2026-09-03, Owner-Freigabe nach Patch-Prognose)

- **Freigabe:** Owner 2026-09-03, nach Prognose "GENAU 2 Felder" (AskUserQuestion).
- **R7 davor:** frischer Drift-Lauf meldete 5 statt 4 Abweichungen -> ANGEHALTEN (kein
  Push). Ursache: EL-seitige Schema-Migration (allowed_values:null an get_consult/
  look_up), version_id unveraendert; R7-Nachzug in die Vorlage (Commit 9b52004);
  danach 4 Abweichungen exakt wie erwartet. Siehe Abschnitt R7-Zwischenfall.
- **Trockenlauf:** PATCH-Koerper 7913 Zeichen, genau 2 Blattpfade, nichts sonst.
- **Push (echt):** `npm run elevenlabs:push -- --felder=prompt,soft_timeout_prompt_override
  --ausfuehren` — geschrieben wurden NUR
  `conversation_config.agent.prompt.prompt` (B1/B2-Regeln aus ST1) und
  `conversation_config.turn.soft_timeout_config.llm_generated_message_prompt_override`
  (neuer Wortlaut). Unberuehrt: Stimme/voice_id, Modell, Timeouts, Erlaubnis-Karte,
  neue Pins, alle Offenlegungsfelder, retention_days/record_voice (bewusste Ausnahmen).
- **Ruecklese:** Skript-Meldung "OK - 2 Felder geschrieben und zurueckgelesen,
  2 besessene Felder weichen noch ab (wie vorhergesagt)" — die 2 Verbleibenden sind
  die bewussten Ausnahmen retention_days/record_voice.
- Drift nach dem Push: Exit-Code 0 — "OK - 2 besessene Felder weichen ab, ALLE mit
  Grund und Datum bewusst ausgenommen ... 40 von 40 besessenen Feldern wirklich
  verglichen ... keine Verbots-Verletzung."

## ST4-Abschluss ohne Verifikationsanruf (2026-09-04, Owner-Entscheidung)

- **Deploy live:** dep-dad718gn74is73dia44g auf Commit 4368c00 (getriggert 2026-09-04
  07:17 UTC, finished 07:24 UTC); /healthz belegt 4368c00. Damit laufen die Detektoren
  [el-tags]/[el-b1], das Zaehlfeld elDetectorCounts (inkl. pg-Spalte, idempotente
  Migration) und die ST1-i18n-Regeln (Budget-/Realtime-Weg) im Prod-Gateway.
- **Owner-Self-Call-Pfad scharf** (Render-Env readonly: OWNER_SELF_CALL_ENABLED=true,
  Tenant gepinnt); Recording aktiv (record_voice=true, Retention unbegrenzt).
- **Verifikationsanruf: NICHT durchgefuehrt** — Owner-Entscheidung 2026-09-04 ("kein
  Testanruf", Kette trotzdem abschliessen; keine Begruendung erfragt). Damit ist
  ABNAHME-AS10 BEWUSST ROT und nachholbar: Protokoll steht in ST0-3, Aufrufweg ist
  place_call (Connector) oder Loopback /api/calls (Betreiber-Kanal), Auswertung
  automatisch (EL-Conversations + Render-Logs + Zaehlfeld) plus Owner-Hoer-Urteil.
  Bis dahin ist die Wirkung der B1/B2-Regeln am Live-Verkehr UNVERMESSEN — der
  naechste echte Anruf liefert die ersten Feldwerte (Zaehlfeld, Detektor-Logs).
- **A/B ignore_default_personality (Entscheidung 3): entfallen bis auf Widerruf** —
  A/B benoetigt Messanrufe; mit dem Verzicht auf Testanrufe entfaellt auch diese
  Messung. Schaltung bleibt beim Ist (false), keine ungemessene Aenderung (R10).
- Escalations-Schwelle (Entscheidung 2) bleibt unveraendert scharf: ein
  Marken-Rueckfall NACH dem O1/O2-Push -> expressive_mode aus, MIT Hoer-Vergleich.

## Offene Punkte (Endstand 2026-09-04)

1. **AS10 Verifikationsanruf** (bewusst rot, nachholbar): Protokoll ST0-3, Marker im
   Test test/el-stimme-abnahme.test.js. Nachhol jederzeit moeglich.
2. **A/B ignore_default_personality**: entfallen bis auf Widerruf (Owner 2026-09-04).
3. **Wirkungsmessung B1/B2 live**: erst ab naechstem echtem Anruf (Zaehlfeld +
   Detektoren); [el-tags]-Rate war vor dem Push 3/3 der log-sichtbaren Outbounds
   (7-Tage-Fenster).
4. 19.08.-[freundlich] logseitlich nicht verifizierbar (Render-Retention 7 Tage).
5. (Go-live, nicht diese Kette): Rueckdreh retention_days/record_voice auf G7-SOLL
   vor dem ersten Fremdkunden; Besitz-Verifikation private_number (PLAN-SECURITY,
   Launch-Blocker zur OC-Ausnahme).
