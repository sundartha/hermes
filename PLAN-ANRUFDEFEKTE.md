# PLAN-ANRUFDEFEKTE

Die Anrufdefekte vom 05./06.09.2026: Wurzeln, Widerlegtes, Phasenplan.

Grundlage sind fuenf Forensik-Spuren (S1 Dead-Air, S2 Sprache, S3 Laerm, S4 Logs,
S5 Zeitachse), deren Befunde je zweimal angegriffen wurden (Linse "Mechanismus": haelt die
Kausalkette? Linse "Gegenbeispiel": tritt dieselbe Ursache auch in einem funktionierenden
Anruf auf?). In dieses Dokument kommt nur, was beide Linsen ueberstanden hat oder mit
ausdruecklicher Korrektur ueberlebt hat. Was gefallen ist, steht in Abschnitt 3 - damit die
naechste Session es nicht noch einmal verfolgt.

**Belegarten.** GEMESSEN heisst: an einem Laufzeit-Objekt beobachtet (Prod-DB, Render-Log,
ElevenLabs-API, Audiodatei). ERSCHLOSSEN heisst: aus dem Code gelesen, ohne Laufzeitbeleg.
Jede Wurzel traegt ihre Belegart. Eine nur erschlossene Wurzel beginnt ihren Plan mit einer
Messung, nicht mit einem Umbau.

**Stand der Messung.** Alle Zeiten UTC. Tenant t_user_01KX600834GCJFV9GTZQKWZMTH.
Live-Agent `agent_5301kwkh9vv3ezesf100pggfj9rs`, Version
`agtvrsn_5901m1q67m31f22ar8vptava9skp` (committet 2026-09-04 21:47) - dieselbe Version in
ALLEN untersuchten Anrufen vom 05./06.09., kaputten wie sauberen.

---

## 1. Was passiert ist

| # | Worte des Eigentuemers | Belegter Mechanismus |
|---|---|---|
| S-1 | "Da hat er ploetzlich aufgehoert zu reden. ... er sollte auf Portugiesisch wechseln, und dann kam gar nichts." (06.09. 16:06, ruhige Umgebung) | Das Modell rief `get_consult` auf. Unser Rueckfrage-Webhook nahm den Aufruf an, obwohl der Prompt desselben Anrufs `consult_available: "unavailable"` trug, und hielt die HTTP-Antwort an den Anbieter bis `CONSULT_OPEN_MS` = 47 000 ms offen. Solange der Werkzeug-Aufruf haengt, spricht der Agent nicht, ist nicht unterbrechbar und die Rede des Anrufers wird nicht transkribiert. (W1, W2) |
| S-2 | "Ich habe komischerweise nur irgendein Tippen gehoert, also Tastaturtippen wie auf so einem alten Computer." | `tool_call_sound: "typing"` am Werkzeug `get_consult`. Der Ton lief als bit-identische 8,000-s-Schleife 42 Sekunden lang und war ab Sekunde 22 das Einzige auf der Leitung. Kein Anbieter-Defekt: die Einstellung ist an unserem Konto gesetzt, ihre DAUER bestimmen wir. (W3) |
| S-3 | "Da hat er absolut gar nichts verstanden. Vielleicht ist er zu empfindlich eingestellt ... komplett durcheinander." (06.09. mittags, Restaurant) | 6 von 6 Agenten-Turns nach der Eroeffnung wurden unterbrochen; ausgeliefert wurden 21-86 % des erzeugten Textes, teils mitten im Wort. Kein vollstaendiger Gedanke kam durch, und der Agent erholte sich nie per Recap. Die Vermutung "zu empfindlich eingestellt" ist damit im ERGEBNIS bestaetigt, in der URSACHE aber NICHT belegt - siehe W6 und Abschnitt 3. (W6) |

Der Auftrag des 16:06-Anrufs war portugiesisch (`goal`, `briefing` "Am Telefon ist der
Grossvater von Antonio", `constraints` "Nur Portugiesisch sprechen"). Gewaehlt wurde
`+491737252163` - das ist, per DB gemessen, die hinterlegte eigene Nummer des Tenants.
`callee_is_owner = true`, `call.language = 'de'`, Eroeffnung deutsch. (W4, W5)

---

## 2. Die Wurzeln

Sortiert nach Schwere: was einen Anruf toetet, steht vor dem, was ihn haesslich macht.

### W1 - Zwei Tore, eine Frage: der Rueckfrage-Webhook prueft die Owner-Bedingung nicht (BLOCKER, GEMESSEN)

**Mechanismus.** Vor dem Waehlen rechnet `src/elevenlabs/outbound.js:1581-1582` den Wert der
dynamischen Variable `consult_available` als
`consultAllowedFor(store.resolveProfile(call.tenantId)) && call.calleeIsOwner !== true` - bei
einem Owner-Anruf also `false`, der Prompt bekommt `unavailable`
(`src/elevenlabs/outbound.js:900`). Das Werkzeug `get_consult` bleibt aber am AGENTEN
registriert (Agenten-Ebene, nicht pro Anruf), und ein Prompt kann einen Aufruf nur verbieten,
nicht verhindern. Am Webhook `src/routes/webhooks-elevenlabs.js:269-275` fehlt die
`calleeIsOwner`-Bedingung: dort gilt nur `inCallConsultEnabled && consultAllowedFor(profile)
&& direction === "outbound" && Kontingent`. Also 200 statt 404, ein Consult-Datensatz
entsteht, und der Handler haelt die Anbieter-Verbindung
(`src/routes/webhooks-elevenlabs.js:338-341`, `await consultSlots.withOpenSlot(...)`).

Der Prompt hat den Aufruf an ZWEI Stellen verboten, beide gemessen am Live-Agenten: die
dynamische Variable `consult_available = "unavailable"` (im Anbieter-Datensatz dieses Anrufs)
und der Owner-Baustein selbst - "There is nobody else to consult and no message to pass on:
if something is unclear, ask them directly" (`src/i18n/prompts/en.js:59`). Das Modell rief das
Werkzeug trotzdem auf. **Der Prompt ist kein Tor. Nur der Server ist eins.**

**Beleg.**
- Code an beiden Stellen gelesen; `grep` auf `calleeIsOwner`/`callee_is_owner` in
  `src/routes/webhooks-elevenlabs.js` und allen `src/consult/*.js`: null Treffer.
- Anbieter-Datensatz `conv_0401m1vqhxdce8gt5q3h816hmb3r`:
  `conversation_initiation_client_data.dynamic_variables.consult_available = "unavailable"`.
- Render-Log `srv-d8m0fhflk1mc73bno570`: `16:07:15.576 [consult-raised] gestellt
  call=call_mtq08ett4l3o event=c0 offen_ms=47000`; KEINE Zeile
  `[el-consult] abgelehnt grund=kanal_nicht_freigegeben`.
- Prod-DB: `callee_is_owner = t`, `consults[0].status = "timed_out"`, `answeredAt = null`.
- **A/B ueber die gesamte Tenant-Historie:** genau 6 Anrufe haben je einen Consult ausgeloest.
  Die 5 mit `callee_is_owner = false` sind ALLE `answered` (7,8-19,6 s bis zur Antwort). Der
  EINE mit `callee_is_owner = true` ist der einzige `timed_out`. Das ist eine saubere
  Trennung, kein Einzelfall.

**Erklaert:** S-1 (Ausloeser).

**Grenze des Befunds.** Der Torfehler ist der Ausloeser DIESES Anrufs, nicht die einzige
Quelle des Einfrierens - siehe W2.

---

### W2 - Der Halt ist blockierend, und der Code behauptet das Gegenteil (BLOCKER, GEMESSEN)

**Mechanismus.** `handleConsult` reicht an `makeConsultRaised` weiter; `awaitAnswer`
(`src/conversation/consult-raised.js:126-157`) wartet in 250-ms-Ticks bis
`deadlineMs = Date.now() + holdMs` mit `holdMs = CONSULT_OPEN_MS` (Default 47 000 ms,
`src/config.js:1685`, `.env.example:465`, `render.yaml:425`). Solange bleibt die HTTP-Antwort
an den Anbieter aus, und solange steht der Werkzeug-Aufruf. Am Werkzeug gilt zusaetzlich
`disable_interruptions: true`, `interruption_mode: "disable_during_tool"` und
`conversation_config.turn.transcribe_on_disabled_interruptions: false` - was der Anrufer in
dieser Zeit sagt, loest keinen Turn aus und landet nicht im Transkript
(Anbieter-Schema, woertlich: "user speech during a non-interruptible turn is ignored and
won't trigger a turn").

**Das ist nicht auf Owner-Anrufe beschraenkt.** Jeder unbeantwortete `get_consult` friert die
Leitung bis `CONSULT_OPEN_MS` ein. Auch die 5 erfolgreich beantworteten Rueckfragen hielten
die Leitung 7,8-19,6 s. Der Torfehler aus W1 macht diesen Fall nur zum garantierten
Worst Case: der Auftraggeber war selbst am Telefon, es KONNTE niemand antworten.

**Die Herleitung der Zahl passt nicht zu diesem Weg.** 47 000 ms sind laut Kommentar in
`src/config.js` "zwei volle Poll-Zyklen plus Marge" - hergeleitet aus dem MCP-Long-Poll,
nicht aus menschlicher Wartetoleranz am Telefon. Im SELBEN Modul existiert das Gegenbeispiel:
der Recherche-Webhook hat mit `EL_LOOKUP_TIMEOUT_MS = 6000`
(`src/routes/webhooks-elevenlabs.js:48-54`) eine EIGENE Frist bekommen, ausdruecklich weil die
geliehene Frist "eine Groesse [ist], die es auf diesem Weg nicht gibt (Lehre
calibration-scope)". Genau diese Ueberlegung fehlt beim Rueckfrage-Webhook.

**Die Datei-Doku ist falsch.** `src/consult/in-call.js:34-38` schreibt woertlich: "Ein laenger
offener Consult verlaengert KEIN Gespraech - es wird nirgends gewartet". Das gilt fuer den
Budget-Pfad. Auf dem heute live laufenden ElevenLabs-Weg wird sehr wohl gewartet
(`src/conversation/consult-raised.js:11-16`, "ES WIRD GEWARTET"). Zwei Aussagen ueber
dieselbe Tatsache, eine davon irrefuehrend.

**Beleg.**
- Render-Log: `[consult-raised] gestellt ... offen_ms=47000` 16:07:15.576 ->
  `[el-consult] call=call_mtq08ett4l3o ergebnis=timeout` 16:08:02.637 = 47,061 s
  (Ueberhang 61 ms = ein Poll-Tick, `CONSULT_POLL_TICK_MS = 250`).
- Audio `conv_0401.../audio`, 64,188 s, 16 kHz mono, RMS je Sekunde: Agentensprache endet
  bei 21 s (-28,1 dB), ab 22 s durchgehend -49 bis -54 dB. Laute Einwuerfe des Eigentuemers
  bei 34 s (-31,3), 35 s (-33,0), 39 s (-27,1), 54 s (-27,9) - zu KEINEM davon existiert eine
  Transkriptzeile. Letzter Agenten-Turn mit Text: t = 15 s.
- Anbieter: `termination_reason = "Client disconnected: 1000"`,
  `tool_results[get_consult].is_error = true`, `result_value = "Tool execution was abandoned
  because the call ended before the tool could complete"`.

**Erklaert:** S-1 (Wirkung), S-2 (Dauer).

**Praezisierung, die ins Dokument gehoert.** Die 47,06 s sind der Abstand zweier Server-
Logzeilen, NICHT die vom Anrufer erlebte Stille. Der Anrufer erlebte ca. 39-43 s (Sekunde 21
bis Anrufende bei 64 s) und legte rund 7 s VOR Ablauf unseres eigenen Timers auf. Unser
Timeout hat den Anruf also nicht beendet - der Mensch gab vorher auf. Als Beleg fuer "die
Stille ist unsere" reicht das; als Beleg fuer "unser Timer hat den Anruf beendet" nicht.

---

### W3 - Auf dem ElevenLabs-Weg gibt es kein zweites GESPROCHENES Signal (BLOCKER, GEMESSEN)

**Mechanismus.** Beide von uns gebauten Ueberbrueckungs-Mechanismen haengen ausschliesslich
an der Turn-Schleife der Budget-Engine und laufen im Live-Betrieb nie:

- `consultFillerSpeech` ("Einen kleinen Moment, ich pruefe das kurz. Sind Sie noch dran?")
  wird NUR von `decideConsultRequest` zurueckgegeben (`src/consult/in-call.js:150`);
  `decideConsultRequest` wird nur aus `src/claude.js:1242` innerhalb `agentTurn()` gerufen.
- `makeThinkingSignal` (`src/thinking-signal.js:22`) hat als einzigen Importeur
  `src/claude.js:10`, genutzt nur innerhalb derselben `agentTurn`-Funktion.
- `agentTurn(` hat in ganz `src/` genau zwei Aufrufer: `src/routes/voice.js:426` und
  `src/telnyx-llm-shim.js:904` - beides der Budget-/Telnyx-Weg. Der EL-Weg
  (`src/routes/webhooks-elevenlabs.js`) ist eine strukturell eigenstaendige Implementierung
  und ruft keines von beidem.

Der EL-Weg hat als Ersatz genau zwei anbieterseitige Mittel: (1) `pre_tool_speech: "force"` -
EIN Satz VOR dem Aufruf (im Transkript bei t = 15 s gemessen), und (2) `tool_call_sound`.
**Es gibt keinen Mechanismus, der waehrend der Wartezeit ein ZWEITES Mal spricht.**

Der Vollstaendigkeit halber - der Anrufer hoerte NICHT nichts: `tool_call_sound: "typing"`
lief als bit-identische 8,000-s-Schleife (Selbstkorrelation bei Verzoegerung 8,000 s: fuer
jedes 2-s-Fenster ab t = 22 s +0,93 bis +1,000; fuer jedes Fenster t = 0..21 s zwischen -0,03
und +0,03). Die Einbrueche bei t = 25-27, 30-31, 34-35, 38-39, 45-46, 53 sind die Stellen, an
denen der Eigentuemer daruebersprach. Der Anbieter-Agent hat zusaetzlich ein
`soft_timeout_config` (2 s, mit Fuellsaetzen, `max_soft_timeouts_per_generation: 1`) - es hat
in diesem Anruf nachweislich KEINEN Satz erzeugt: nach t = 15 s existiert kein Sprech-Turn
mehr, und das Audio ab t = 22 s traegt nur die Tipp-Schleife.

**Beleg.** `grep` ueber `src/` fuer `consultFillerSpeech` (nur `src/i18n/locales.js:321/452/569`
Definition und `src/consult/in-call.js:150` als einziger Leser) und `thinkingSignal`
(`src/claude.js:10/312/314`). Live-Agent per GET: `get_consult` traegt
`tool_call_sound: "typing"`, `tool_call_sound_behavior: "auto"`,
`interruption_mode: "disable_during_tool"`, `disable_interruptions: true`,
`pre_tool_speech: "force"`, `force_pre_tool_speech: true`, `response_timeout_secs: 60`.
Audio-Selbstkorrelation wie oben.

**Erklaert:** S-2.

**Korrektur zur Herkunft.** Der Wert `tool_call_sound: "typing"` ist am LIVE-Agenten gemessen
und war vor dem Anruf gesetzt (Version vom 04.09. 21:47, unveraendert). Die Behauptung, er
stamme aus `scripts/spike1-setup.mjs:115` / `scripts/spike1-b.mjs:185`, ist FALSCH: beide
Skripte legen laut eigenem Kopfkommentar einen separaten Wegwerf-Agenten an, fassen den
Live-Agenten ausdruecklich nicht an und setzen ausserdem
`tool_call_sound_behavior: "always"` statt des live gemessenen `"auto"`.
`elevenlabs/agent_configs/outbound-agent.template.json:577` dokumentiert nur die ABSICHT; der
automatisierte Push (`scripts/push-elevenlabs.mjs`) schreibt dieses Feld NICHT, weil die
Besitz-Karte `tools` die Vergleichsart `"namen"` fuehrt (nur Werkzeugnamen, keine
werkzeug-internen Felder). Wie der Wert live wurde, ist nicht belegt - fuer die Einordnung
"kein Anbieterdefekt, sondern eine bei uns aktive Kontoeinstellung" reicht der GET am
Live-Agenten. Diese Luecke ist selbst ein Befund: siehe W9.

---

### W4 - Die Owner-Ausnahme feuerte auf einem Auftrag, der einen Dritten ansagt (BLOCKER, GEMESSEN / Wirkung ERSCHLOSSEN)

**Mechanismus.** Das Praedikat `callee_is_owner` beweist, dass die gewaehlte NUMMER die
hinterlegte Nummer des Tenants ist - nicht, dass die PERSON am Apparat der Auftraggeber ist.
Genau das steht auch in CLAUDE.md (Owner-Entscheidung 2026-08-20, OC). Am 16:06-Anruf trafen
beide Dinge gleichzeitig zu: `callee_is_owner = true` UND ein Briefing, das ausdruecklich
einen Dritten ansagt ("Am Telefon ist der Grossvater von Antonio"). Folge: die deutsche
Owner-Eroeffnung ueberschrieb die eigentlich portugiesische Eroeffnungszeile, und der
Owner-Prompt-Baustein galt.

Der von CLAUDE.md geforderte Pflicht-Rueckfall EXISTIERT im Prompt und ist woertlich
vorhanden (`src/i18n/prompts/en.js:60`): "IF THE PERSON WHO ANSWERED IS NOT ${owner}: say this
sentence immediately, word for word, before anything else - '${disclosure}'". Er haengt aber
**ausschliesslich am Ermessen des Modells**. Im einzigen Live-Fall, in dem die Ambiguitaet
tatsaechlich auftrat (die Person antwortete "Ja, bitte, worum geht's?" und bestaetigte ihre
Identitaet nicht), hat das Modell den Rueckfall NICHT gesprochen, sondern `get_consult`
gerufen - ein Werkzeug, das der Owner-Baustein zwei Zeilen darueber ausdruecklich ausschliesst
(`en.js:59`).

**Beleg.**
- Prod-DB: `to_e164 = +491737252163` == `tenant.private_number`; `callee_is_owner = t`;
  `briefing` woertlich mit dem Grossvater-Satz.
- Anbieter-Datensatz: `first_message` deutsch ("Hallo Antonio, hier ist dein KI-Assistent...").
- Transkript: [10 s] Nutzer "Ja, bitte, worum geht's?" -> [15 s] Agent "Warte kurz - ich glaube,
  es gibt hier ein Missverstaendnis. Lass mich das auf Portugiesisch klaeren, wie es meine
  Aufgabe vorsieht." -> [17 s] Werkzeug `get_consult`. Kein Offenlegungssatz.
- Prompt-Wortlaut `src/i18n/prompts/en.js:54-60`, gerendert ueber `calleeRelationText`
  (`src/elevenlabs/outbound.js:656-659`).

**GEMESSEN:** dass die Konstellation live auftrat und dass der Rueckfall nicht gesprochen wurde.
**ERSCHLOSSEN / NICHT belegt:** dass daraus ein Artikel-50-Verstoss wurde - nach eigener
Aussage war der Eigentuemer selbst am Apparat. Es ist also kein Schaden eingetreten, aber die
Schutzwirkung hat sich nicht gezeigt, als sie zum ersten Mal gebraucht wurde.

**Erklaert:** die deutsche Eroeffnung auf einem portugiesischen Auftrag; die
Identitaets-Rueckfrage, die W1/W2 ausloeste.

**Absolute Regel.** Die Offenlegung selbst wird in diesem Plan NICHT angefasst. Kein
Plan-Schritt weicht die OC-Ausnahme auf oder erweitert sie; W4 fuehrt hoechstens zu einer
ENGEREN Ausnahme oder zu einer serverseitigen Zusatzsicherung.

---

### W5 - Es gibt keinen Weg, pro Anruf eine Sprache zu waehlen; 'pt' existiert nicht; der Widerspruch wird still ignoriert (SCHWER, GEMESSEN)

**Mechanismus.** `place_call` fuehrt bewusst KEIN Sprachfeld (`src/mcp-tools.js:770-773`,
Marker LANG-15); Zod strippt unbekannte Keys, ein Client-Feld waere wirkungslos. Der Wert
entsteht allein in `callLocaleFor` (`src/elevenlabs/call-locale.js:175`):
`calleeLanguage(to) || resolveCallLanguage(state, {...})`. Das ist ein JS-Kurzschluss-ODER -
liefert die Zielnummer ein Land, GEWINNT sie deterministisch. Hier: `to = +491737252163` ->
DE -> `'de'`. Der so gewonnene Code laeuft durch `localeFor` und geht als
`conversation_config_override.agent.language` an ElevenLabs
(`src/elevenlabs/outbound.js:1101-1109`).

**Die Auftragssprache geht an KEINER Stelle in diese Kette ein.** `resolveCallLanguage`
(`src/store/state-ops.js:1799-1803`) liest ausschliesslich Spracheinstellung, Nummern-Geo,
Tenant-Default, Weltdefault - nie `goal`/`briefing`/`constraints`. Diese reisen roh als
`{{objective}}`/`{{constraints}}`/`{{background}}` in den Prompt. Es existiert also ein
Ueberschreibungs-KANAL (er wird bei jedem Anruf benutzt), aber der Auftraggeber kann ihn nicht
erreichen.

Zusaetzlich: das Produkt kennt heute genau drei Sprachen. `LOCALES` hat die Schluessel
`de`, `fr`, `en` (`src/i18n/locales.js:149ff`, `SUPPORTED_LANGUAGES:607`);
`localeFor('pt').language` ergibt `'en'` (fail-safe auf den Weltdefault). Am Live-Agenten
stehen `language_presets` fuer `de`, `fr`, `es` und `agent.language = 'en'` - **kein `pt`**.
Ein Auftrag in einer nicht unterstuetzten Sprache erzeugt weder Fehler noch Warnung.

**Beleg.** Code an allen fuenf Stellen selbst gelesen. `node`-Auswertung von
`src/i18n/locales.js`: `LOCALES` keys `['de','fr','en']`, `localeFor('pt').language = 'en'`.
Live-Agent per GET: `language_presets` keys `['de','fr','es']`, `agent.language = 'en'`, kein
`pt`. Anbieter-Datensatz `conv_0401...`: `agent.language = "de"` bei
`dynamic_variables.constraints` woertlich "CONSTRAINTS: Nur Portugiesisch sprechen." Prod-DB:
`call_mtq08ett4l3o.language = 'de'`.

**Erklaert:** warum ein portugiesischer Auftrag als deutscher Anruf gefuehrt wurde und warum
das Modell in einen inneren Widerspruch lief.

**Reichweite, ausdruecklich begrenzt.** Dieser Mechanismus ist bei JEDEM Anruf aktiv, auch bei
den beiden sauberen Referenzanrufen (10:26 am 06.09., 17:09 am 03.09.) - er trennt kaputt und
gut NICHT. Er wird erst wirksam, wenn Auftragssprache und geo-abgeleitete Sprache
auseinanderlaufen. Das trifft auf `call_mtq08ett4l3o` (16:06) und `call_mtpt4jeydmlf` (12:47)
zu. Fuer `call_mtpt021ylo4e` (12:44, Restaurant) trifft es NICHT zu - dessen Auftrag ist
vollstaendig deutsch; dieser Anruf gehoert zu W6, nicht zu W5.

---

### W6 - Der Laerm-Anruf: Dauer-Unterbrechung ohne Erholung; die Ursache ist NICHT gemessen (SCHWER, teils GEMESSEN, Ursache ERSCHLOSSEN)

**Was GEMESSEN ist.**

1. **Chronizitaet, nicht Einzelschwere.** Je Agenten-Turn liefert der Anbieter `message`
   (tatsaechlich ausgeliefert) und `original_message` (vom Modell erzeugt). Im 12:44-Anruf
   (`conv_0501m1vbz70bfpctff3th2h2htrc`) sind 6 von 6 Sprechzuegen nach der Eroeffnung
   unterbrochen; ausgeliefert 56,7 / 65,7 / 86,3 / 35,5 / 21,4 / 85,4 % (Turns bei
   12/22/40/56/61/65 s). Abbruch mitten im Wort belegt bei t = 22 s: `message` endet
   "...Alles an...", `original_message` "...Alles andere nehme ich...". Kontrolle 10:26
   (`conv_5801m1v4269mfq4bqy9qz0a04xqe`): 1 von 4 unterbrochen, 607 von 615 Zeichen = 98,7 %.
   Die Feld-Semantik ist per Audio gegengeprueft: der 56-s-Turn (39 von 110 Zeichen) hat nur
   2,58 s akustisches Aktivitaetsfenster, bei der aus dem unbeschnittenen Kontroll-Turn
   kalibrierten Sprechrate (~16,8 Zeichen/s) waeren ~6,5 s noetig.
2. **Das Verhaeltnis allein trennt nicht.** Im als "gut" bewerteten Referenzanruf vom 03.09.
   (`conv_9301m1m3z963ewbvz4s7zzrevfa0`) liegt bei t = 10 s ein Turn mit 63 von 120 Zeichen =
   52,5 %, mitten im Wort abgeschnitten - und der Anruf lief sauber weiter, weil der Agent im
   naechsten Turn einen expliziten Recap lieferte ("Entschuldige, ich glaube die Verbindung
   war kurz schlecht..."). Das unterscheidende Merkmal ist also **die Rate unterbrochener
   Turns UND das Fehlen einer Recap-Erholung ueber die Anruf-Sequenz** (12:44: 6/7; Kontrolle
   10:26: 1/6; Referenz 03.09.: 2/7), nicht der prozentuale Verlust eines Einzel-Turns.
3. **Der Anbieter hat keinen Empfindlichkeits-Zahlwert.** Suche ueber das GESAMTE
   OpenAPI-Schema nach background/noise/denoise/echo/ambient/barge: einziger einschlaegiger
   Treffer ist `VADConfig.background_voice_detection` (genau EIN Feld, boolean,
   "Whether to use background voice filtering", Default `false`). `ASRConversationalConfig`
   hat genau 4 Felder, keins numerisch. `TurnEagerness` ist ein 3-wertiges Enum
   (patient/normal/eager). Live gemessen: `vad.background_voice_detection = false`,
   `turn.turn_eagerness = "normal"`, `turn.turn_model = "turn_v3"`, `turn.turn_timeout = 5`,
   `turn.silence_end_call_timeout = 30`, `turn.interruption_ignore_terms = []`,
   `turn.merge_with_default_ignore_terms = false`, `asr.provider = "scribe_realtime"`,
   `asr.keywords = []`. **Ungenutzte Stellschrauben sind damit genau vier:**
   `background_voice_detection`, `turn_eagerness = "patient"`, `interruption_ignore_terms` +
   `merge_with_default_ignore_terms`, `asr.keywords`.

**Was NICHT gemessen ist - und deshalb die erste Phase bestimmt.**

- Die Konfiguration ist KONSTANT: `version_id agtvrsn_5901m1q67m31f22ar8vptava9skp` in den
  drei Stoerfaellen UND im sauberen Kontrollanruf 10:26 desselben Tages. Eine Konstante
  erklaert keine Varianz.
- **Auf der Mischspur ist KEIN Laerm-Unterschied messbar**: `ffmpeg volumedetect` ergibt fuer
  den "lauten" 12:44-Anruf -25,1 dB mittleren Pegel und 64 erkannte Stille-Intervalle, fuer
  den ruhigen Kontrollanruf -22,8 dB und 66 Intervalle. Der "laute" Anruf ist im Mix sogar
  LEISER. Die Kennzahl ist vom TTS-Anteil dominiert und damit fuer Umgebungslautstaerke wenig
  aussagekraeftig - aber sie ist der einzige Pegelbeleg, den wir haben.
- Der einzige Audio-Endpunkt des Anbieters (`/v1/convai/conversations/{id}/audio`) liefert nur
  den GEMISCHTEN Track. **Eine kanalgetrennte Laermmessung existiert nicht und ist ueber die
  Anbieter-API nicht herstellbar.**
- `background_voice_detection` filtert laut Schema-Beschreibung FREMDSTIMMEN, nicht Musik. Der
  Eigentuemer benennt im Transkript des 12:44-Anrufs selbst Musik als Stoerer ("ich glaub, das
  ist die ist irritiert von der Musik ... Kann das sein, dass sie sehr laut ist hier?"). Die
  technisch naeherliegende Stellschraube ist `turn_eagerness = "patient"` (generische
  Warteschwelle vor Turn-Uebernahme), nicht `background_voice_detection`.

**Konsequenz.** W6 ist als BEOBACHTUNG belastbar (Chronizitaet, Metrik, Inventar der
Stellschrauben), als URSACHE nicht. Der Plan beginnt hier deshalb mit einer Messung
(Phase P6), nicht mit einem Schalter-Umlegen.

**Erklaert:** S-3 im Erscheinungsbild, nicht in der Ursache.

---

### W7 - Der Inbound-Weg ist seit 02.09. tot, und kein Alarm sagt es (SCHWER, GEMESSEN)

**Mechanismus.** Der Outbound-Weg laeuft ueber den ElevenLabs-Agenten mit dessen eigenem
Modell (`conversation_config.agent.prompt.llm = "claude-sonnet-5"`, `custom_llm = null`,
live gemessen); der DeepSeek-Seam (`src/llm.js`) wird dort nur fuer Briefing und
Eroeffnungszeile beruehrt und faellt still (`src/precall-briefing.js:311`,
`src/elevenlabs/opening-line-llm.js:139` - beide nur `console.warn(... uebersprungen: ...)`,
dann `return null`). Der Inbound-Weg dagegen laeuft ueber die Budget-Engine
(`src/routes/voice.js` -> `src/claude.js`) und ruft DeepSeek PRO TURN. Dort schlaegt der 402
mitten im Gespraech zu und danach noch einmal bei der Zusammenfassung.

Fuer LLM-Ausfaelle existiert **kein Outage-Code**: `src/telephony/outage-detection.js` zaehlt
ausschliesslich Outbound-Anrufe mit `failureReason`-Eimern aus der Anruf-PLATZIERUNG
(`not-placed:*`), nie LLM-Antworten. Die Audit-Klassenzaehlung ueber 09-05 und 09-06 kennt nur
`auth_failed`, `drift_*`, `cost_truing_*` und `place_call`. In `outage_alert` existiert kein
Datensatz mit einem LLM-Code. `src/metrics.js` ist reines strukturiertes `console.log` ohne
Konsumenten; der Log-Eintrag traegt `level: "info"`, loest also auch infrastrukturseitig nichts
aus.

**Beleg.** Render-Logs 09-05T00:00 bis 09-06T23:59, Volltextsuche "DeepSeek-Adapter": 20
Treffer. GENAU EIN `[turn]`-Treffer (12:42:57.942) und GENAU EIN `[summary]`-Treffer
(12:43:03.875), beide fuer `call_mtpsxmfsiscq` - den einzigen Inbound-Anruf im Fenster
(DB-verifiziert: 10x outbound mit EL-conversation-id und nicht-leerem `summary`, 1x inbound
ohne EL-conv und `summary = NULL`). Begleitlog: `inbound_path {"path":"budget",
"reason":"handoff_disabled"}` und `[metrics] llm {"outcome":"non-transient"}`. Die uebrigen 18
Treffer sind `[precall-briefing]`/`[opening-line] uebersprungen`. `[precall-briefing]
uebersprungen: DeepSeek-Adapter: HTTP 402 - Insufficient Balance` erscheint durchgehend vom
02.09. bis 06.09.

**Praezisierungen, beide gemessen.**
- "Tot" heisst nicht Stille: ein 402 im Turn endet mit einer gesprochenen Degradations-
  meldung (`locale.llmDegradedSpeech`) und kontrolliertem Auflegen nach genau einem
  gescheiterten Turn - das im Code vorgesehene Verhalten bei `LlmUnavailableError`.
- `call_mtpsxmfsiscq` ist der EINZIGE Inbound-Anruf seit dem 01.09. Die Aussage gilt als
  gemessen fuer diesen einen Anruf; dass DeepSeek in den 34 Stunden lueckenlos 402 lieferte,
  ist ebenfalls gemessen - die Verallgemeinerung auf "jeder Inbound-Anruf" ist damit sehr gut
  gestuetzt, aber formal n = 1.
- Der Fail-Soft-Pfad fuer Outbound (Briefing/Eroeffnungszeile) lief NACHWEISLICH auch bei
  beiden sauberen Referenzanrufen (03.09. 17:09:55, 06.09. 10:26:12) - er erklaert KEINEN der
  drei Defekte. Er ist eine Beobachtungsluecke, kein Ausloeser.

**Erklaert:** keinen der drei Symptome. Steht hier, weil er jeden eingehenden Anruf toetet und
seit vier Tagen unbemerkt lief.

---

### W8 - Ein gescheiterter Anruf ist von einem "die Gegenstelle hat nein gesagt" nicht unterscheidbar, und niemand wird benachrichtigt (MITTEL, GEMESSEN)

**Mechanismus.** `endStatusOf` (`src/elevenlabs/outbound.js:388`) setzt `status = "completed"`,
weil der Anbieter `conversation.status = "done"` meldet. `objectiveAchievedOf`
(`:391-393`) mappt `analysis.call_successful` ueber `OBJECTIVE_ACHIEVED_BY_PROVIDER` auf
`false`. `failure_reason` wird ueber `providerErrorReasonFor` (`:486-487`) NUR geschrieben,
wenn der Anruf nie einen Antwort-Anker bekam - bei 64 s Verbindung strukturell ausgeschlossen.
`outageWindow` (`src/telephony/outage-detection.js:52-70`) zaehlt einen Anruf mit gesetztem
`answeredAt` IMMER als Erfolg - dieser Anruf kann strukturell nie einen Outage-Alarm ausloesen.
`call.consults` (das Feld mit `status = "timed_out"`) wird in `views.js` und `mcp-tools.js`
NIRGENDS nach aussen gegeben; es ist nur ueber rohe DB-Forensik sichtbar.

**Beleg.** EL-API `conv_0401...`: `analysis.call_successful = "failure"`. DB: `status =
"completed"`, `objective_achieved = "false"`, `failure_reason` leer, kein `outage_alert`.

**Wichtige Einordnung.** Diese Signatur ist der NORMALFALL dieses Tenants, nicht ein Merkmal
des Defekts: der ausdruecklich als "sauber durchgelaufen" bezeichnete Kontrollanruf 10:26
(101 s echtes Gespraech, `termination_reason = "end_call tool was called."`) traegt exakt
dieselbe Zeile - `call_successful = "failure"`, `objective_achieved = false`,
`failure_reason = NULL`, kein Alarm. Von den 11 gezogenen Anrufen hat NUR der 03.09.-Anruf
`objective_achieved = true`. W8 ist also ein Beobachtbarkeits-Defizit, KEIN Beleg fuer den
16:06-Vorfall.

---

### W9 - Werkzeug-interne Anbieterfelder liegen ausserhalb des Drift-Gates (MITTEL, GEMESSEN)

**Mechanismus.** Die Besitz-Karte in `elevenlabs/agent_configs/outbound-agent.template.json`
fuehrt den Eintrag `tools` mit der Vergleichsart `"namen"`: verglichen wird, WELCHE
Werkzeugnamen existieren, nicht deren interne Felder. `scripts/push-elevenlabs.mjs`
dokumentiert selbst, dass Felder dieser Vergleichsart "angezeigt und ausdruecklich NICHT
geschrieben" werden. Damit sind `tool_call_sound`, `tool_call_sound_behavior`,
`interruption_mode`, `disable_interruptions`, `pre_tool_speech` und `response_timeout_secs`
weder von uns geschrieben noch vom Drift-Gate ueberwacht. Ebenso `vad.*` und `asr.*`:
`grep -c 'vad' ` ueber die Vorlage = 0; `scripts/check-elevenlabs-drift.mjs` vergleicht
ausschliesslich `vergleicheBesitz(vorlage.felder)`.

**Beleg.** Vorlage und Push-Skript gelesen; Drift-Lauf vergleicht 40 besessene Felder, keins
davon werkzeug-intern. Genau diese Luecke macht W3 unsichtbar: der Wert, den der Eigentuemer
als "Tastaturtippen" gehoert hat, kann sich jederzeit still aendern, ohne dass ein Gate es
meldet.

---

### Nebenbefunde ohne Erklaerungskraft fuer die Vorfaelle

Diese Punkte sind gemessen und real, erklaeren aber KEINEN der drei Symptome. Sie gehoeren
nicht in die Ursachenkette und duerfen keine Phase vor W1-W3 belegen.

| # | Befund | Beleg | Warum kein Ausloeser |
|---|---|---|---|
| N-1 | Der EL-Rueckfrage-Webhook prueft die Client-Frische nicht (`consultClientIsPolling` fehlt in `webhooks-elevenlabs.js:269` gegenueber `consult/in-call.js:95-106`) | Code-Vergleich, Kommentar `webhooks-elevenlabs.js:255-268` | Konstante in JEDEM EL-Anruf. Am einzigen Datenpunkt widerlegt sie sich selbst: der Client pollte 16:06:59.498, der Consult kam 16:07:15.576 - Abstand 16,08 s, unter `CONSULT_POLL_FRESH_MS = 25000`. Das Praedikat waere TRUE gewesen und haette nichts blockiert. |
| N-2 | `call.caller_turns` ist auf dem EL-Weg strukturell immer 0 | `countCallerTurn` hat genau einen Aufrufer (`src/claude.js:990`, in `agentTurn`); Prod-DB: 31/31 EL-Anrufe `caller_turns = 0` seit dem Cutover 19.08., 18/22 Nicht-EL-Anrufe > 0 | Kein Laufzeit-Leser. ABER: `scripts/call-abandon-rate.mjs` liest das Feld und klassifiziert dadurch heute JEDEN beantworteten EL-Outbound-Anruf unter 15 s als Abbruch - eine still falsche Forensik-Kennzahl, kein Ausloeser. |
| N-3 | Telnyx-Guthaben-Warnung und ANI-Eigentumswache melden sich nur ins Log | `outbound-drift-watch.js:36` (`VOLL_KLASSEN` = OWNERSHIP/CONFIG/STALE), `outbound-config-drift.js:293` (balance_low = WARN); DB `outage_alert`: `otg_mto2gj6yfkiu` seit 09-05 07:33 `reported_at = NULL`, `otg_mtfke24wyk2p`/`otg_mtfke24wy05m` seit 08-30 | Beide Zustaende liefen wortgleich ueber den sauberen Kontrollanruf 10:26 UND ueber den guten Anruf vom 03.09. hinweg. 5 von 9 Drift-Pruefungen sind "unbekannt", weil `TELNYX_FQDN_CONNECTION_ID` und `TELNYX_OUTBOUND_VOICE_PROFILE_ID` leer sind. Eigener Ops-Befund. |
| N-4 | Die Anrufe punktgenau um 06:01 UTC stammen aus keinem internen Scheduler | kein `placeCall(`-Aufrufer in `src/`; kein Cron-Job im Render-Konto; DB `actual_cost_micro_cents` 4.010.000 / 36.713.095 / 4.989.258, alle mit `billed_at` = zusammen 45,7 Cent | `ip = ::1` ist KEIN Unterscheidungsmerkmal (steht auf jedem `place_call`, auch auf den vom Eigentuemer selbst getippten). Tragfaehig ist nur das Session-Muster: `initialize` auf die volle Minute, single-shot, identisches Goal an drei Tagen. Herkunft mit den vorhandenen Render-Logs (kein Request-Log-Typ, keine Client-IP) NICHT feststellbar. |
| N-5 | Der SP1/SP2/DE1-Push vom 04.09. aenderte am Live-Agenten genau vier Felder | Feld-fuer-Feld-Diff v38->v41 ueber `?version_id=`, je Paar exakt 2 Unterschiede; Werkzeugliste, Presets, Stimme, ASR unveraendert | Die Version trennt NICHT: `v41` traegt 6 saubere und 3 defekte Anrufe. Nur die 03.09.-Referenz lag auf `v38`. |
| N-6 | Es gibt keinen risikofreien Agent-Rollback | `v38`/`v39`/`v40` tragen alle noch den festen englischen Anrufbeantworter-Text; erst `v41` hat `{{voicemail_line}}`. Ein Rollback auf `v38` bringt die englische Mailbox zurueck, die am 04.09. behoben wurde. `transcribe_on_disabled_interruptions` auf `true` zurueckzusetzen reaktiviert den am 04.09. gemessenen Phantom-Turn-Defekt (Commit 5ba507a) | Jede Rollback-Option tauscht einen bekannten Fehler gegen einen anderen bekannten. Rollback ist deshalb KEINE Option in diesem Plan. Korrektur zur Zeitachse: DE1 wurde am Agenten erst 04.09. 21:47 wirksam, nicht mit dem Server-Deploy um 12:33. |

| N-10 | **Ob eine Rueckfrage jemals einen Client ERREICHT hat, ist nirgends festgehalten** - weder im Log noch am Datensatz. `[mcp]` protokolliert nur den Request-EINGANG, nie die Antwort; `call.consults[]` fuehrt `askedAt`/`answeredAt`, aber kein `deliveredAt` | Log-Feldinventar; Consult-Datensatz `call_mtq08ett4l3o` | **AUFGEKLAERT 06.09. durch den Eigentuemer: die Frage KAM an. Seine Assistenten-Sitzung konnte nur nicht antworten, weil die Connector-Berechtigung fuer `answer_consult` auf "nachfragen" stand - und er war zum Bestaetigen im Anruf.** Der Server ist damit entlastet und der Zustellweg belegt: `waitForEvent` liefert einen waehrend des Polls entstehenden Consult binnen eines Ticks aus (Reproduktion am echten Modul: Consult nach 3,00 s gestellt, Rueckgabe `event="consult"` bei 3,01 s), und der Live-Consult (16:07:15.576) lag im 22-s-Haltefenster des Polls (16:06:59.498 + `CONSULT_POLL_HOLD_MS`). Die Telemetrie-Luecke selbst BLEIBT ein Befund: sie ist der Grund, warum die Aufklaerung eine Zeugenaussage brauchte statt einer Messung. P3 schliesst sie, P2 macht sie zum Schutzmechanismus. Ein Test fuer "Consult entsteht WAEHREND eines laufenden Polls" fehlt in `test/al-p13-consult-channel.test.js` (AL-P13-20 deckt nur den leeren Halt) |

---

## 3. Was WIDERLEGT ist

Diese Hypothesen sind an einer Gegenprobe gescheitert. **Nicht erneut verfolgen.**

**Zur Vermutung des Eigentuemers ("Vielleicht ist er zu empfindlich eingestellt").** Im
Ergebnis richtig beobachtet - der Agent wurde chronisch unterbrochen. In der Ursache NICHT
bestaetigt: (a) es existiert im gesamten Anbieter-Schema kein Empfindlichkeits-Zahlwert, den
jemand zu niedrig gestellt haben koennte; (b) dieselbe Konfiguration lief am selben Tag durch
einen sauberen Anruf; (c) auf der Mischspur ist der "laute" Anruf sogar leiser als der ruhige
Kontrollanruf (-25,1 dB gegen -22,8 dB) bei praktisch gleicher Anzahl Stille-Intervalle
(64 gegen 66); (d) Interrupts kommen mit dieser Konfiguration grundsaetzlich immer vor -
1/6 im Kontrollanruf, 2/7 in der 03.09.-Referenz gegen 6/7 im Stoerfall. Das ist ein Grad-,
kein Ja/Nein-Unterschied. **Gemessen wurde stattdessen:** die Rate unterbrochener Turns und
das Fehlen einer Recap-Erholung (W6). Die Ursache dieser Rate ist offen; deshalb steht in
Phase P6 eine Messung und kein Schalter.

| Hypothese | Warum gefallen |
|---|---|
| Der Agent verstummte, weil unser 47-s-Halt den Anruf beendete | Zeitachse widerspricht: der Anruf war akustisch bei 64,19 s vorbei, unser Timeout feuerte 16:08:02.637 (~71,7 s nach Anrufstart) - also NACH dem Anrufende. Der Anbieter fuehrt den Aufruf als "abandoned because the call ended". Der Mensch legte auf, unser Timer kam zu spaet, um noch etwas zu bewirken. |
| Waehrend der 47 s war absolute Stille | `silencedetect` bei -35 dB UND -45 dB: ab ~15,5 s bis Dateiende KEINE einzige Stille-Phase. Es lief die 8-s-Tipp-Schleife (W3). |
| "Unsere Timeout-Antwort kam 1,6 s zu spaet - die Geduld des Anrufers endete knapp davor" | Die Praezision ist nicht zu halten: das EL-Transkript kennt fuer den Tool-Call nur `time_in_call_secs: 17` (Ganzzahl), die DB-Spalte `ended_at` ist ein Poll-Zeitpunkt, nicht das reale Ende. Der reale Spielraum liegt bei 0-3 s in beide Richtungen. |
| Eine Gegenstelle war da und hat die Rueckfrage bewusst ignoriert | Der `[mcp]`-Log schreibt nur den REQUEST-Eingang, nie die Antwort. Dass die Frage den Client ERREICHTE, ist Inferenz. Naheliegender: `callee_is_owner = true` - der Mensch, der haette antworten sollen, telefonierte gerade selbst. **Nachtrag 06.09., Aussage des Eigentuemers: er hat in seiner Assistenten-Sitzung NIE eine Rueckfrage gesehen.** Siehe N-10. |
| Es gibt auf dem Live-Pfad keinen Dead-Air-Notaus | Uebersehen: `conversation_config.turn.silence_end_call_timeout = 30` (Sekunden) - eine anbieterseitige Stille-Frist, seit Commit 5b799a3 (15.08.) in der Vorlage dokumentiert. Ausserdem: der fehlende Telnyx-Watchdog ist eine Konstante ueber ALLE Anrufe, auch die sauberen. |
| Die `de`-Sprachsperre machte den portugiesisch sprechenden Grossvater technisch unverstehbar | In diesem Anruf wurde nie Portugiesisch gesprochen. Die Person antwortete Deutsch und wurde KORREKT transkribiert. Die ASR hatte nichts zu leisten. |
| Die SP1-Sprachregel hat den Agenten in die Rueckfrage gezwungen | Die SP1-Regel adressiert einen Sprachwechsel mit dem GEGENUEBER ("ask once, in both languages ... switch only after they confirm") und nennt `get_consult` nicht. Die gestellte Frage war eine IDENTITAETS-Frage an den Auftraggeber - der CONSULT-TOOL-/OC-Pfad, der seit 20.08. unveraendert ist. Zusaetzlich: `call_mtpt4jeydmlf` (12:47) hatte 3,5 h vorher dieselbe Konstellation unter demselben Prompt und erzeugte KEINEN Consult. |
| SP1 (`transcribe_on_disabled_interruptions` true -> false) hat den Anrufer stumm geschaltet | `interruption_mode: "disable_during_tool"` unterdrueckt Reaktionen waehrend der GESAMTEN Tool-Laufzeit, unabhaengig von diesem Feld - und ist seit vor `v38` gesetzt. Das Feld entscheidet nur, ob die ignorierte Rede fuer einen SPAETEREN Turn aufbewahrt wird; einen spaeteren Turn gab es hier nie. |
| Das "Tastaturtippen" liess sich an einem Hochband-Ausschlag bei 17-21 s nachweisen | Der Ausschlag liegt mitten im gesprochenen `pre_tool_speech`-Satz (Spektrogramm zeigt Formanten und Vokal-Harmonische bis > 5 kHz). Dieselbe Hochband-Bandbreite tritt im sauberen Referenzanruf in 82 von 100 Ein-Sekunden-Fenstern auf. Der Tool-Sound ist ueber die 8-s-Selbstkorrelation belegt (W3), nicht ueber diesen Ausschlag. |
| Die Unterbrechungen wurden von einer Fremdstimme ausgeloest (F0-Analyse) | Dasselbe F0-Muster liegt auch in Stille-Fenstern 4-6 s entfernt von jedem Schnitt und in 3 von 7 Schnitten des STOERUNGSFREIEN Kontrollanrufs. Oktav-/Subharmonien-Mehrdeutigkeit EINER Stimme reproduziert das Bild (Autokorrelations-Kamm bei Lag 55/82/110/137/165, ein Frame-Sprung von exakt 123,1 -> 246,2 Hz = Faktor 2,0000). Die Audiodatei ist MONO - es existiert kein "Anrufer-Band". Der Eigentuemer benennt im Transkript selbst Musik und sein eigenes Dazwischenreden. |
| Die Fremdereignis-RATE ist fuenffach hoeher (142/156 gegen 30 pro Minute) | Mit der zitierten Methode nicht reproduzierbar: je nach Segmentierung 211,8/193,5/76,8 oder 33,9/34,3/9,0 pro Minute. Keine Variante trifft die genannten Zahlen. Ausserdem tritt "interrupted=true ohne jedes Anrufer-Band-Ereignis im Sprechfenster" auch im Kontrollanruf auf. |
| Der Agent verstummte im 12:47-Anruf, weil `turn_v3` ~1,2 s Ruhe braucht und der Laerm sie nie liefert | Die 1,12 s sind ein Schwellenwert-Artefakt (-40 dB: 1,15 s; -35 dB: 1,54 s; -30 dB: 3,34 s). Im 12:44-Anruf schliesst ein Turn nach nur ~1,11 s Stille. `turn.mode = "turn"` ist ein probabilistisches Modell, kein fixer Stille-Timer. |
| `vad.background_voice_detection = false` ist "der Schaden, ein Anbieter-Vorgabewert" | Der Wert ist Agenten-, nicht Anruf-Konfiguration und war im sauberen Kontrollanruf identisch gesetzt. Er filtert laut Schema Fremdstimmen, nicht Musik. Was bleibt: er ist unbeachtet und fuer das Drift-Gate unsichtbar (W9). |
| Der DeepSeek-402 hat den Agenten verstummen lassen / hat die deutsche Eroeffnung verursacht | Das Gespraech laeuft nicht ueber DeepSeek (W7). Und selbst mit vollem Guthaben haette `openingSystem(locale.language)` eine DEUTSCHE Eroeffnung erzeugt - `locale` ist bereits `'de'`, bevor ein LLM-Aufruf versucht wird (W5). Der 402 erklaert die TEXTQUALITAET der Eroeffnung, nicht ihre Sprache. Und er lief bei den beiden sauberen Referenzanrufen genauso. |
| Das Anrufergebnis erreicht den Eigentuemer ueber keinen dauerhaften Kanal | Widerlegt: `finishCall` (`src/telephony/call-finish.js:321`) schreibt unbedingt eine `notification`-Zeile; fuer alle sechs geprueften Anrufe existiert eine Zeile "Neue Call Summary" mit Zusammenfassungstext, abrufbar ueber `GET /api/self-service/state` hinter `webAuthMw`. Zusaetzlich existiert ein bestaetigter Newsletter-Empfaenger, der `planSummaryMail` unabhaengig vom Consent-Boolean scharf stellt. Der SMS-Kanal scheitert tatsaechlich zu 100 % (Telnyx 40305 "Invalid 'from' address", 10x in zwei Tagen). |
| Der EL-Outbound-Weg protokolliert kein Anruf-Ende | Bei erweitertem Log-Fenster stehen 6 statt 3 Treffer: der `cost-truing`-Sweep schreibt ~75 min spaeter `[cost-truing] abschluss call=... zustand=vollstaendig grund=belegsammlung fehlend=keine` samt echtem Ist-Kostenwert. Dasselbe Muster beim sauberen Kontrollanruf. |
| Ein stuendlicher Stripe-Abgleich laeuft in eine unbehandelte Promise-Rejection | Der Stack-Trace zeigt `applyStripeWebhook` ueber die echte `POST /stripe-webhook`-Route, kein Frame aus `stripe-reconcile.js`. Der Sweep filtert auf existierende Tenants und ist doppelt `catch`-gesichert; sein 6-h-Intervall passt nicht zur gemessenen Kadenz. |

---

## 4. Der Phasenplan

Reihenfolge nach Schadenspotenzial. Jede Phase ist einzeln mergebar und einzeln testbar.
Kein Schritt weicht ein Safety-Gate auf, den Offenlegungssatz oder die Auth-Fail-Closed-Regel;
mehrere Schritte ENGEN bestehende Tore ein.

### Sofortmassnahmen ohne Code (Entscheidung des Eigentuemers, nicht dieses Plans)

| # | Massnahme | Wirkung | Preis |
|---|---|---|---|
| SM-1 | DeepSeek-Guthaben aufladen | Inbound-Anrufe funktionieren wieder (W7) | keiner |
| SM-2 | `IN_CALL_CONSULT_ENABLED=false` auf Render setzen, bis P1+P2 live sind | Kein `get_consult` kann mehr angenommen werden -> W1 und W2 koennen nicht mehr feuern. Wirkt sofort und ohne Deploy von Code | Der Rueckfrage-Kanal ist weg. Gemessen: er wurde in sieben Tagen genau EINMAL benutzt, und dieses eine Mal war der Defekt. |

SM-2 ist eine Konfigurationsaenderung an einer bestehenden Faehigkeit, kein Aufweichen eines
Gates - sie ENTFERNT eine Faehigkeit. Der Plan setzt sie NICHT voraus.

---

### P1 - Das Torleck schliessen: eine Frage, ein Praedikat

**Ziel.** Ein `get_consult`-Aufruf auf einem Anruf mit `calleeIsOwner === true` wird abgelehnt,
bevor irgendetwas gehalten oder geschrieben wird.

**Betroffene Dateien.**

| Datei | Aenderung |
|---|---|
| `src/consult/gate.js` | neue exportierte Funktion `consultAllowedForCall(call, profile)` = `consultAllowedFor(profile) && call.calleeIsOwner !== true`. EINE Stelle, die beide Tore benutzen - die Divergenz darf nicht wieder entstehen (G5). Strikt `!== true`: ein Bestandsdatensatz ohne das Feld heisst NICHT-Owner, wie ueberall sonst. |
| `src/elevenlabs/outbound.js:1581-1582` | ersetzt den inline-Ausdruck durch `consultAllowedForCall(call, store.resolveProfile(call.tenantId))` - verhaltensgleich |
| `src/routes/webhooks-elevenlabs.js:269-275` | `consultAllowedFor(store.resolveProfile(call.tenantId))` -> `consultAllowedForCall(call, store.resolveProfile(call.tenantId))`; der Kommentarblock `:255-268` bekommt den Satz, dass `calleeIsOwner` KEIN Turn-Fakt ist und deshalb sehr wohl uebernommen wird |
| `test/elevenlabs-consult-webhook-guards.test.js` | neue Faelle |

**Erwartetes Ergebnis (deterministisch).**
1. `POST /webhooks/elevenlabs/consult` mit gueltigem Token, gueltiger `conversation_id` und
   gueltiger Frage auf einem Anruf mit `calleeIsOwner = true` antwortet **404** mit dem
   Ablehnungsgrund `kanal_nicht_freigegeben`; im Log steht `[el-consult] abgelehnt
   grund=kanal_nicht_freigegeben`; `call.consults` bleibt **leer**; es entsteht **keine**
   `[consult-raised] gestellt`-Zeile; die Antwort kommt in **unter 1 s** (kein Halt).
2. Derselbe Aufruf auf einem Anruf mit `calleeIsOwner = false` verhaelt sich unveraendert
   (200, `[consult-raised] gestellt`).
3. `consult_available` in den `dynamic_variables` bleibt byte-identisch zum Bestand.

**Verifikation.**
```
node --check src/consult/gate.js && node --check src/routes/webhooks-elevenlabs.js && node --check src/elevenlabs/outbound.js
node --test test/elevenlabs-consult-webhook-guards.test.js   # fail 0, Faelle "owner-anruf-404" und "nicht-owner-unveraendert"
node --test test/callee-is-owner-elevenlabs.test.js test/elevenlabs-anrufstart.test.js
npm test
grep -n "calleeIsOwner" src/routes/webhooks-elevenlabs.js src/consult/gate.js   # Positiv-Kontrolle: nicht-leere Ausgabe
```

**Abhaengigkeiten.** Keine.

**Risiko / Blast-Radius.** Klein und einseitig: die Aenderung LEHNT MEHR AB. Sie kann keinen
zusaetzlichen Anruf durchlassen. Betroffen sind ausschliesslich Rueckfragen auf Owner-Anrufen -
gemessen 1 Vorkommen in sieben Tagen, und dieses eine war der Defekt. `src/elevenlabs/outbound.js`
wird nur umverdrahtet, nicht in der Semantik veraendert; Abnahmepunkt 3 sichert das ab.

---

### P2 - Der Halt wird dreistufig: erst pruefen, ob der Kanal traegt, dann warten

**Owner-Entscheidung 06.09.2026.** Eine pauschale Frist ist der falsche Hebel. Sie muss
gleichzeitig zwei Fragen beantworten, die nichts miteinander zu tun haben: *"kann hier
ueberhaupt jemand antworten?"* - in Millisekunden entscheidbar - und *"wie lautet die
Antwort?"* - darf zehn bis dreissig Sekunden dauern. Jede einzelne Zahl ist fuer eine der
beiden Fragen falsch. Deshalb wird der Halt gestaffelt: **eine kurze Frist, um den Kanal zu
pruefen, und erst danach die lange Frist fuer die eigentliche Antwort.**

Der Anlass ist gemessen (N-10): der Kanal war intakt, die Frage kam an, und trotzdem kam keine
Antwort - die Connector-Berechtigung fuer `answer_consult` stand auf "nachfragen", und der
Mensch, der haette bestaetigen muessen, war der Angerufene. **Diese Bedingung ist fuer den
Server unsichtbar, aber ihr Symptom ist in Millisekunden messbar.**

**Der Entwurf.**

| Stufe | Frist | Was geprueft wird | Woher der Server es weiss | Bei Ausbleiben |
|---|---|---|---|---|
| 0 | `EL_CONSULT_DELIVERY_MS` (Start 5 000 ms) | Wurde die Frage ueberhaupt an einen pollenden Client AUSGELIEFERT? | deterministisch, ohne neue Berechtigung: `waitForEvent` gibt den Consult zurueck - das IST die Zustellung, sie muss nur festgehalten werden (P3) | niemand hoert zu -> sofort abbrechen, Agent spricht weiter |
| 1 | `EL_CONSULT_ACK_MS` (Start 5 000 ms nach Stufe 0) | Hat der Client SOFORT quittiert ("ich sehe es mir an")? | neue Quittung, siehe unten | Kanal zugestellt, aber nicht bedienbar (fehlende Berechtigung, blockierter Client) -> abbrechen |
| 2 | `EL_CONSULT_ANSWER_MS` (Start 30 000 ms gesamt) | die eigentliche Antwort | Bestand (`answerConsult`) | Timeout-Text wie bisher |

**Die Quittung haengt an DERSELBEN Berechtigung wie die Antwort - das ist der Kern.** Sie wird
kein eigenes Werkzeug: ein neues `ack_consult` haette eine eigene Connector-Berechtigung, die
per Default wieder auf "nachfragen" stuende, und die Falle waere identisch nachgebaut. Statt
dessen bekommt `answer_consult` einen leichten Modus (`answers` weggelassen bzw.
`status: "working"`), den das Modell unmittelbar nach Erhalt der Frage ruft. Damit gilt:
Berechtigung vorhanden -> Quittung in Millisekunden -> der Agent darf beruhigt bis Stufe 2
warten. Berechtigung fehlt -> die Quittung laeuft in denselben Dialog -> sie bleibt aus ->
Abbruch nach 10 s statt nach 47 s. **Das Ausbleiben der Quittung IST der Berechtigungstest.**

**Unverzichtbar dazu: der Anrufer wird nicht mehr stummgeschaltet.** `interruption_mode` steht
am Werkzeug auf `disable_during_tool`; der Anbieter-Default ist `allow`. Gemessen am
16:06-Anruf: vier laute Einwuerfe (34/35/39/54 s) loesten nichts aus und stehen in keiner
Transkriptzeile. Eine Wartezeit von bis zu 30 s ist nur vertretbar, wenn der Mensch sie
jederzeit abbrechen kann. Ohne diesen Teil verlaengert Stufe 2 den Defekt, statt ihn zu heilen.

**Und: der Warteton wird gesprochen, nicht getippt** (Owner-Entscheidung 06.09.).
`tool_call_sound` auf `null`; `pre_tool_speech` steht bereits auf `force`, der Agent sagt also
hoerbar, dass er kurz etwas klaert. Die 8-s-Tippschleife entfaellt.

**Herleitung der Zahlen - und ihre ausdrueckliche Vorlaeufigkeit.** Alle je beantworteten
Rueckfragen dieses Tenants kamen in 7,8-19,6 s (5 Faelle, gesamte Historie) - das traegt
Stufe 2 mit 30 s. Fuer Stufe 0 und 1 existiert **keine Messung**, weil genau diese Zeitpunkte
heute nicht protokolliert werden (N-10). Die Startwerte sind deshalb konservativ gewaehlt und
in EINE Richtung sicher: zu kurz heisst "der Agent redet weiter", zu lang heisst "Stille am
Telefon". **P3 liefert die Telemetrie, aus der beide Zahlen nachkalibriert werden; bis dahin
sind sie als vorlaeufig zu kennzeichnen.** Bindend nach oben bleibt
`response_timeout_secs = 60` am Werkzeug (live gemessen).

**Betroffene Dateien.**

| Datei | Aenderung |
|---|---|
| `src/routes/webhooks-elevenlabs.js` | drei benannte Modul-Konstanten mit Herleitungskommentar nach dem Muster von `EL_LOOKUP_TIMEOUT_MS` (`:48-54`); Durchreichung an `onConsultRaised` |
| `src/conversation/consult-raised.js` | der Wartelauf wird gestaffelt: Abbruchgruende `not_delivered` / `not_acked` / `timeout` statt eines einzigen Timeouts. `holdMs` ist bereits Parameter (`:64-77`) |
| `src/consult/delivery.js` | die Zustellung wird festgehalten (Stufe 0) - reiner Leser bleibt reiner Leser, der Marker gehoert an den Consult-Datensatz (P3) |
| `src/store/state-ops.js` | `deliveredAt` / `ackedAt` am Consult-Datensatz, additiv-nullable |
| `src/mcp-tools.js` | `answer_consult` nimmt die Quittung entgegen; Werkzeugbeschreibung UND `MCP_CONSULT_INSTRUCTIONS` machen sie zur ersten Pflicht nach Erhalt der Frage |
| `elevenlabs/agent_configs/outbound-agent.template.json` | `interruption_mode: "allow"`, `tool_call_sound: null` am Werkzeug `get_consult` |
| `src/consult/in-call.js:34-38` | Kommentar richtigstellen: "es wird nirgends gewartet" gilt nur fuer den Budget-Pfad |
| neu `test/el-consult-staffelung.test.js` | Fristnachweis je Stufe |

**Erwartetes Ergebnis (deterministisch).**
1. Consult ohne jeden pollenden Client: HTTP-Antwort nach hoechstens
   `EL_CONSULT_DELIVERY_MS` + ein Tick, `{ status: "timeout", reason: "not_delivered" }`.
2. Consult zugestellt, keine Quittung: Antwort nach hoechstens
   `EL_CONSULT_DELIVERY_MS + EL_CONSULT_ACK_MS` + ein Tick, `reason: "not_acked"`.
3. Quittung da, keine Antwort: Antwort nach `EL_CONSULT_ANSWER_MS`, `reason: "timeout"`,
   Text unveraendert `locale.prompt.turnControl.consultTimeout`.
4. Quittung da, Antwort nach 18 s: unveraendert ausgeliefert (`status: "answered"`) - der
   Fall, den die heutige Historie als Normalfall zeigt.
5. Am Live-Werkzeug gilt danach `interruption_mode = "allow"` und `tool_call_sound = null`;
   `npm run elevenlabs:drift` ist gruen (Vorlage und Live stimmen ueberein).
6. `CONSULT_OPEN_MS` bleibt unveraendert der Wert fuer den MCP-Long-Poll-Weg.

**Verifikation.**
```
node --check src/routes/webhooks-elevenlabs.js && node --check src/conversation/consult-raised.js && node --check src/mcp-tools.js
node --test test/el-consult-staffelung.test.js      # fail 0; je Stufe ein Fall, Zeit gegen heruntergesetzte Fristen gemessen
node --test test/gq-p2-consult-deadline.test.js test/al-p13-consult-channel.test.js test/al-p14-in-call-consult.test.js test/elevenlabs-consult-webhook-envelope.test.js
npm test
npm run elevenlabs:drift
```

**Abhaengigkeiten.** P1 zuerst (schliesst den konkreten Ausloeser). P3 liefert die Telemetrie
fuer die Kalibrierung von Stufe 0/1 - P2 kann davor gebaut werden, seine Zahlen sind dann aber
ausdruecklich vorlaeufig. Die Aenderung an der Agenten-Vorlage braucht einen Push
(`scripts/push-elevenlabs.mjs`) - der ist fuer den Agenten gesperrt und vom Eigentuemer zu
fahren, Server-Code zuerst.

**Risiko / Blast-Radius.** Mittel bis hoch - dies ist der Pfad, der eine LAUFENDE
Telefonverbindung haelt.
- **Das Hauptrisiko ist neu und gehoert benannt: die Quittung ist Modellverhalten.** Vergisst
  eine Assistenten-Sitzung sie, bricht der Kanal ab, obwohl er getragen haette - ein Rueckschritt
  gegenueber heute. Milderung: Stufe 0 ist deterministisch und faengt den haeufigsten Fall
  ("niemand da") ohne jedes Modellverhalten ab; Stufe 1 ist mit 5 s grosszuegig; die Pflicht
  steht in Werkzeugbeschreibung UND Instruktionsblock. Wer das nicht akzeptieren will, baut
  Stufe 0 allein - sie deckt den haeufigsten Fall und kostet kein Modellvertrauen.
- `interruption_mode: "allow"` macht den Agenten waehrend der Rueckfrage unterbrechbar. Das ist
  der Zweck; die Nebenwirkung ist, dass ein Huesteln den Werkzeug-Turn beenden kann. Gegen W6
  (Laerm) ist das eine Verschaerfung - deshalb gehoert P7 (Laerm-Stellschraube) NACH P2 gemessen,
  nicht davor.
- Fristen sind ohne echten Anruf pruefbar (`holdMs` ist Test-Override im Bestand).

---

### P3 - Ein gescheiterter Consult hinterlaesst eine dauerhafte Spur

**Ziel.** Ein Rueckfrage-Timeout ist ohne rohe DB-Forensik erkennbar.

**Betroffene Dateien.**

| Datei | Aenderung |
|---|---|
| `src/routes/webhooks-elevenlabs.js` | beim Ergebnis `timeout` ein durabler Audit-Eintrag ueber den bestehenden `makeDurableAudit`-Weg: Aktion `consult_timeout`, Felder `tenantId`, `callId`, `consultId`, `holdMs`. **KEIN Fragetext, keine Antwort, kein Transkriptfragment** - der Fragetext ist Gespraechsinhalt (Absolute Regel 4/5). |
| `test/route-auth-inventory.test.js` | unveraendert (keine neue Route) |
| neu `test/el-consult-timeout-spur.test.js` | Nachweis |

**Erwartetes Ergebnis (deterministisch).**
1. Nach einem Timeout existiert genau EIN `audit_log`-Datensatz mit `action = 'consult_timeout'`
   und dem korrekten `tenant_id`/`call_id`.
2. Der Datensatz enthaelt an keiner Stelle den Fragetext (Test prueft das mit einer
   Marker-Zeichenkette in der Frage, die im Audit-Eintrag NICHT vorkommen darf).
3. Bei einer beantworteten Rueckfrage entsteht KEIN solcher Eintrag.

**Verifikation.**
```
node --test test/el-consult-timeout-spur.test.js    # fail 0; Fall "kein-fragetext-im-audit"
npm test
```

**Abhaengigkeiten.** Nach P2 (der Timeout-Zweig ist dann der geaenderte).

**Risiko / Blast-Radius.** Klein. Additiv, keine Verhaltensaenderung am Telefon. Einziges
echtes Risiko ist ein PII-Leck ins Audit-Log - dagegen steht Abnahmepunkt 2.

---

### P4 - Der Auftraggeber kann die Anrufsprache benennen, und eine unbekannte Sprache wird laut abgelehnt

**Ziel.** `place_call` nimmt ein optionales `language` entgegen, validiert es gegen
`SUPPORTED_LANGUAGES` und laesst es die Geo-Ableitung ueberstimmen; eine nicht unterstuetzte
Sprache wird mit einem eindeutigen Fehler abgelehnt statt still ignoriert.

**Diese Phase steht unter Vorbehalt der Owner-Entscheidung F-2** (LANG-15 ist eine bewusste
Bestandsentscheidung). Wird F-2 verneint, reduziert sich die Phase auf die Ablehnungsseite:
ein Auftrag, der eine nicht unterstuetzte Sprache verlangt, wird abgelehnt - dazu braucht es
allerdings ein Signal vom Client, also ebenfalls ein Feld. Ohne F-2 entfaellt P4 ganz.

**Betroffene Dateien.**

| Datei | Aenderung |
|---|---|
| `src/mcp-tools.js` | optionales `language`-Feld im `place_call`-Schema, `z.string().optional()`; der LANG-15-Kommentar wird ersetzt, nicht geloescht - die neue Begruendung steht an derselben Stelle |
| `src/routes/api-calls.js` | Validierung gegen `SUPPORTED_LANGUAGES`; unbekannt -> `400 unsupported_language` mit der Liste der unterstuetzten Codes |
| `src/elevenlabs/call-locale.js:175` | neuer, hoechstrangiger Eingang: `gewuenscht || calleeLanguage(to) || resolveCallLanguage(...)`. Die bestehende Kette bleibt woertlich stehen. |
| `test/` | neuer Test `test/place-call-sprachwahl.test.js` |

**Erwartetes Ergebnis (deterministisch).**
1. `place_call` mit `language: "fr"` erzeugt einen Anruf mit `call.language = 'fr'` und sendet
   `conversation_config_override.agent.language = "fr"` - auch bei einer DE-Zielnummer.
2. `place_call` mit `language: "pt"` wird mit **400** und Code `unsupported_language`
   abgelehnt; **kein Anruf entsteht**, kein Datensatz, keine Kosten.
3. `place_call` ohne `language` verhaelt sich byte-identisch zum Bestand (Regressionstest gegen
   die bestehende Ableitungskette).

**Verifikation.**
```
node --check src/mcp-tools.js && node --check src/elevenlabs/call-locale.js && node --check src/routes/api-calls.js
node --test test/place-call-sprachwahl.test.js   # fail 0; Faelle "fr-ueberstimmt-geo", "pt-400-kein-anruf", "ohne-feld-unveraendert"
node --test test/elevenlabs-anrufstart.test.js test/el-voicemail-sprache.test.js test/el-opening-line.test.js
npm test && npm run test:gates
```

**Abhaengigkeiten.** Keine technische; blockiert durch die Owner-Entscheidung F-2.

**Risiko / Blast-Radius.** Mittel, und der Kern des Risikos ist die OFFENLEGUNG: der
Offenlegungssatz kommt aus `LOCALES.<lang>.disclosure` und traegt damit die gewaehlte Sprache.
Ein Client, der eine Sprache waehlt, die der Angerufene nicht versteht, erzeugt eine
Offenlegung, die ihren Zweck nicht erfuellt. Der Satz selbst bleibt fest verdrahtet und
unabschaltbar - aber seine Sprache waere ab hier client-bestimmt. Das ist eine
Produktentscheidung, keine technische: siehe F-2. Ohne ausdrueckliche Zustimmung wird P4
nicht gebaut.

---

### P5 - Der Owner-Dritt-Konflikt wird sichtbar, bevor gewaehlt wird

**Ziel.** Ein Anruf, der gleichzeitig `calleeIsOwner = true` traegt UND ein Briefing/Kontext
fuehrt, das einen Dritten am Apparat ansagt, wird nicht mehr stillschweigend als reiner
Owner-Anruf gefuehrt.

**Diese Phase beginnt mit einer MESSUNG, weil die Wirkung der Owner-Ausnahme in dieser
Konstellation ERSCHLOSSEN und nicht gemessen ist** (W4). Serverseitig ist "das Briefing sagt
einen Dritten an" nicht deterministisch entscheidbar - Freitext. Was deterministisch ist: die
Konstellation selbst zaehlbar zu machen.

**Schritt 1 (Messung).** Ein Zaehler/Log-Marker, der beim Anrufstart festhaelt, ob ein
Owner-Anruf ein nicht-leeres `briefing`/`context` fuehrt - ohne Inhalt, nur `true`/`false`.
Damit ist nach einigen Tagen belegbar, ob diese Konstellation eine Ausnahme oder der Regelfall
ist.

**Schritt 2 (erst nach Schritt 1 und Owner-Entscheidung F-3).** Eine der drei Optionen aus F-3.

**Betroffene Dateien (Schritt 1).** `src/elevenlabs/outbound.js` (Log-/Metrik-Zeile am
bestehenden `[metrics]`-Weg), neuer Test.

**Erwartetes Ergebnis (Schritt 1, deterministisch).** Beim Start eines Anrufs mit
`calleeIsOwner = true` erscheint genau eine strukturierte Zeile mit dem Feld
`owner_call_with_briefing: true|false`, **ohne** Briefing-Inhalt. Bei `calleeIsOwner = false`
erscheint keine Zeile.

**Verifikation.**
```
node --test test/owner-briefing-marker.test.js   # fail 0; Fall "kein-briefing-inhalt-im-log"
npm test
```

**Abhaengigkeiten.** Keine. Schritt 2 haengt an F-3.

**Risiko / Blast-Radius.** Sehr klein (Schritt 1 ist reine Beobachtung). Ausdrueckliche
Grenze: **an der Offenlegung und an der OC-Ausnahme selbst wird in Schritt 1 nichts
geaendert.** Schritt 2 darf die Ausnahme nur ENGER machen, nie weiter.

---

### P6 - Laerm: das Messwerkzeug zuerst

**Ziel.** Eine reproduzierbare, dokumentierte Kennzahl je Anruf, mit der sich eine spaetere
Konfigurationsaenderung als Verbesserung oder Verschlechterung BELEGEN laesst.

**Warum zuerst messen.** Die Ursache der hohen Unterbrechungsrate ist ERSCHLOSSEN, nicht
gemessen (W6): dieselbe Konfiguration lief am selben Tag durch einen sauberen Anruf, und die
Mischspur zeigt keinen Laerm-Unterschied. Repo-Lehre: die Vorher-Messung kommt ZUERST, sonst
belegt die Nachher-Messung nichts.

**Betroffene Dateien.** Neues Skript `scripts/anruf-unterbrechungen.mjs` (Muster:
`scripts/stt-wer.mjs`, `scripts/call-abandon-rate.mjs`), read-only gegen die
ElevenLabs-Conversation-API und die Prod-DB. **Kein PATCH, kein POST.**

**Erwartetes Ergebnis (deterministisch).** Das Skript liefert fuer eine gegebene Liste von
`conversation_id`s je Anruf: Anzahl Agenten-Turns, Anzahl mit `interrupted = true`, deren
Anteil, den ausgelieferten Zeichenanteil je unterbrochenem Turn
(`len(message)/len(original_message)`), und ob im Folge-Turn ein Recap stattfand (Heuristik
muss im Skript benannt und begruendet sein). Fuer die bereits gemessenen Anrufe muss es die
bekannten Werte REPRODUZIEREN:

| Anruf | erwartete Ausgabe |
|---|---|
| `conv_0501m1vbz70bfpctff3th2h2htrc` (12:44) | 6 von 6 Turns nach der Eroeffnung unterbrochen; Anteile 56,7 / 65,7 / 86,3 / 35,5 / 21,4 / 85,4 % |
| `conv_5801m1v4269mfq4bqy9qz0a04xqe` (10:26, Kontrolle) | 1 von 4 unterbrochen; 607/615 = 98,7 % |
| `conv_9301m1m3z963ewbvz4s7zzrevfa0` (03.09., Referenz) | 2 von 7 unterbrochen; Turn bei 10 s mit 63/120 = 52,5 % |

Weicht eine dieser Zahlen ab, ist das Messwerkzeug falsch - nicht die Wirklichkeit. Das ist
die Positiv-Kontrolle (Repo-Lehre: ein Pruefkommando ohne Positiv-Kontrolle sieht aus wie
"sucht nichts").

**Verifikation.**
```
node scripts/anruf-unterbrechungen.mjs conv_0501m1vbz70bfpctff3th2h2htrc conv_5801m1v4269mfq4bqy9qz0a04xqe conv_9301m1m3z963ewbvz4s7zzrevfa0
node --test test/anruf-unterbrechungen-script.test.js   # Fixtures, kein Netz
```

**Abhaengigkeiten.** Keine.

**Risiko / Blast-Radius.** Sehr klein: read-only Skript, kein Laufzeit-Code. Das Skript darf
keine Transkriptinhalte in Dateien schreiben, die im Repo landen (Absolute Regel 4/5) -
Ausgabe sind Zahlen, keine Zitate.

---

### P7 - Laerm: EINE Stellschraube, gegen die Messung aus P6

**Ziel.** Genau eine der vier ungenutzten Anbieter-Stellschrauben wird geaendert und ihre
Wirkung mit P6 vorher/nachher belegt.

**Empfehlung der Reihenfolge (Begruendung in W6).** Zuerst `turn_eagerness: "patient"` -
das ist die generische Warteschwelle vor der Turn-Uebernahme und damit die einzige der vier,
die zu "Musik/Umgebungsgeraeusch" passt. `background_voice_detection` filtert laut Schema
FREMDSTIMMEN und trifft den gemessenen Fall nicht. `interruption_ignore_terms` und
`asr.keywords` sind Feinschliff.

**Betroffene Dateien.** `elevenlabs/agent_configs/outbound-agent.template.json` (Feld plus
Besitz-Eintrag, damit das Drift-Gate es kuenftig ueberwacht - siehe P8), Push ueber den
bestehenden Weg.

**Erwartetes Ergebnis (deterministisch).**
1. `scripts/check-elevenlabs-drift.mjs` meldet nach dem Push keine Abweichung fuer das neue
   Feld.
2. Ueber mindestens **fuenf** Testanrufe unter vergleichbaren Bedingungen liegt der Anteil
   unterbrochener Agenten-Turns (gemessen mit P6) unter dem Vorher-Wert. Die Vorher-Werte
   werden VOR dem Push mit demselben Skript erhoben und in `tasks/` festgehalten.

**Verifikation.**
```
node scripts/check-elevenlabs-drift.mjs
node scripts/anruf-unterbrechungen.mjs <die neuen conversation_ids>
```

**Abhaengigkeiten.** P6 zwingend (ohne Vorher-Messung belegt die Nachher-Messung nichts).
P8 empfohlen davor, sonst faellt das neue Feld wieder aus dem Drift-Gate.

**Risiko / Blast-Radius.** Mittel und LIVE: die Aenderung wirkt auf jeden Anruf sofort.
`turn_eagerness: "patient"` kann den Agenten traeger machen - eine laengere Wartezeit vor der
Turn-Uebernahme kostet Gespraechsfluss und Geld. Deshalb genau EIN Feld je Push und die
Rueckfallzeile (der Vorwert `"normal"`) in der Uebergabe. **`npm run push-elevenlabs` ist in
der Forensik-Session gesperrt; diese Phase ist die erste, die ihn wieder benutzt - sie
gehoert damit ausdruecklich in eine eigene Session mit Owner-Freigabe.**

---

### P8 - Werkzeug-interne und VAD/ASR-Felder in den Besitz-Vergleich

**Ziel.** Die Felder, die W3 verursacht haben, sind ab hier von uns besessen und vom
Drift-Gate ueberwacht.

**Betroffene Dateien.** `elevenlabs/agent_configs/outbound-agent.template.json`
(Besitz-Karte: `tools` von Vergleichsart `"namen"` auf eine Form erweitern, die die
werkzeug-internen Felder `tool_call_sound`, `tool_call_sound_behavior`, `interruption_mode`,
`disable_interruptions`, `pre_tool_speech`, `response_timeout_secs` mitvergleicht; `vad` und
`asr` als eigene Besitz-Eintraege), `scripts/lib/elevenlabs-besitz.mjs`,
`scripts/check-elevenlabs-drift.mjs`.

**Erwartetes Ergebnis (deterministisch).**
1. `node scripts/check-elevenlabs-drift.mjs` listet die neuen Felder als besessen und meldet
   fuer den heutigen Live-Stand **keine** Abweichung (die Vorlage wird auf den GEMESSENEN
   Live-Wert gesetzt, nicht auf einen Wunschwert - diese Phase aendert das Verhalten nicht).
2. Wird `tool_call_sound` in der Vorlage testweise auf einen anderen Wert gesetzt, meldet das
   Drift-Kommando genau diese eine Abweichung (Positiv-Kontrolle).

**Verifikation.**
```
node scripts/check-elevenlabs-drift.mjs
node --test test/elevenlabs-agent-werkzeuge.test.js test/el-vorlage-variablen-abgleich.test.js
npm test
```

**Abhaengigkeiten.** Keine. Vor P7 empfohlen.

**Risiko / Blast-Radius.** Klein, solange die Vorlage auf den gemessenen Live-Stand gesetzt
wird. Gefahr: wer hier einen Wunschwert eintraegt, aendert beim naechsten Push still das
Live-Verhalten. Abnahmepunkt 1 sichert genau das ab.

---

### P9 - Der LLM-Ausfall bekommt eine Klasse und einen Alarm

**Ziel.** Ein nicht-transienter LLM-Fehler ist nicht mehr nur eine `console.warn`-Zeile.

**Betroffene Dateien.** `src/precall-briefing.js:311`,
`src/elevenlabs/opening-line-llm.js:139`, `src/routes/voice.js:436` (Turn-Pfad),
`src/telephony/call-finish.js` (Summary-Pfad): je ein durabler Audit-Eintrag mit einer neuen
Aktion `llm_unavailable` samt Anbieter und HTTP-Status, **ohne Prompt- und ohne
Antwortinhalt**. Optional (F-5): eine eigene Outage-Klasse.

**Erwartetes Ergebnis (deterministisch).**
1. Wirft der LLM-Seam einen nicht-transienten Fehler, existiert danach genau ein
   `audit_log`-Eintrag `action = 'llm_unavailable'` mit `provider` und `status`.
2. Der Eintrag enthaelt weder Prompt noch Modellantwort (Marker-Test wie in P3).
3. Ein transienter Fehler, den der Retry auffaengt, erzeugt KEINEN Eintrag.

**Verifikation.**
```
node --test test/llm-ausfall-audit.test.js   # fail 0; Faelle "nicht-transient-schreibt", "transient-schreibt-nicht", "kein-prompt-im-audit"
npm test
```

**Abhaengigkeiten.** Keine.

**Risiko / Blast-Radius.** Klein. Reine Beobachtung; kein Verhalten am Telefon aendert sich.
Zweitrisiko: Audit-Flut, wenn ein Konto tagelang leer ist - deshalb dieselbe Entprellung wie
bei den `cost_truing_*`-Klassen pruefen, bevor die Klasse scharf gestellt wird.

---

### P10 - Die falsche Forensik-Kennzahl stilllegen oder reparieren

**Ziel.** `scripts/call-abandon-rate.mjs` liefert auf dem EL-Weg keine still falschen Zahlen
mehr.

**Betroffene Dateien.** `scripts/call-abandon-rate.mjs`, `test/al-p1-forensics-scripts.test.js`.

**Erwartetes Ergebnis (deterministisch).** Das Skript schliesst Anrufe mit gesetzter
`elevenlabs_conversation_id` entweder aus (und sagt das in seiner Ausgabe explizit) oder
leitet "Anrufer hat gesprochen" aus `transcript_segment` statt aus `caller_turns` ab. Auf den
31 EL-Anrufen des Tenants darf danach nicht mehr jeder beantwortete Anruf unter 15 s als
Abbruch gezaehlt werden.

**Verifikation.**
```
node --test test/al-p1-forensics-scripts.test.js
node scripts/call-abandon-rate.mjs   # Ausgabe nennt die Zahl der ausgeschlossenen bzw. anders gemessenen EL-Anrufe
```

**Abhaengigkeiten.** Keine.

**Risiko / Blast-Radius.** Sehr klein (Skript, nicht Laufzeit).

---

## 5. Pre-Mortem

Ein Jahr spaeter. Der Plan wurde umgesetzt und hat Schaden angerichtet. Was ist passiert?

### PM-1 - Der verkuerzte Halt hat die Rueckfrage praktisch getoetet (MITTEL, entschaerft)

**Hergang.** P2 setzte die Frist auf 20 s. Ein Nutzer arbeitete mit einer langsamen
Assistenten-Sitzung; seine Antworten kamen nach 25-35 s. Der Agent hatte da laengst
"ich konnte das nicht klaeren" gesagt und das Gespraech ohne die Information beendet. Nach
drei Wochen benutzte niemand mehr `answer_consult`, weil es nie rechtzeitig ankam - der Kanal
starb an einer Zahl, die aus fuenf Datenpunkten hergeleitet war.

**Massnahme (entschaerft).** Die Zahl steht in einer benannten Konstante mit
Herleitungskommentar und ist ueber Env aenderbar. Der Consult-Datensatz bleibt vom HTTP-Halt
unabhaengig - was mit einer spaeten Antwort geschieht, ist ausdruecklich als F-4 gestellt und
nicht stillschweigend entschieden. Ausserdem gilt: 20 s deckt jeden je gemessenen Erfolgsfall
ab; wenn sich das aendert, sieht man es an der neuen Audit-Klasse aus P3.

### PM-2 - Die Sprachwahl hat die Offenlegung entwertet (HOCH, offen bis F-2 entschieden)

**Hergang.** P4 ging live. Ein Client rief mit `language: "en"` eine deutsche Nummer an, weil
das Modell den Auftrag auf Englisch formuliert hatte. Der Angerufene sprach kein Englisch,
hoerte einen englischen Offenlegungssatz und verstand nicht, dass er mit einer KI sprach. Der
Satz war formal da, seine Funktion nicht. Artikel 50 verlangt aber, dass der Mensch es
ERFAEHRT.

**Massnahme.** Nicht entschaerft, sondern zurueckgestellt: P4 wird ohne ausdrueckliche
Owner-Entscheidung (F-2) NICHT gebaut. Wird sie erteilt, gehoert eine Zusatzsicherung in die
Phase: die Sprache des Offenlegungssatzes folgt der geo-abgeleiteten Sprache des ANGERUFENEN,
auch wenn der Gespraechsverlauf danach in der gewaehlten Sprache laeuft. Das ist eine
Erweiterung des Plans und muss in F-2 mitentschieden werden.

### PM-3 - Die engere Owner-Ausnahme hat den Offenlegungssatz an eigene Anrufe gehaengt (NIEDRIG, bewusst)

**Hergang.** P5 Schritt 2 machte die Ausnahme enger. Seither hoerte der Eigentuemer bei jedem
eigenen Testanruf wieder den vollen Dritt-Offenlegungssatz - stoerend, aber harmlos.

**Bewertung.** Bewusst akzeptiert. Die Richtung ist einseitig: eine engere Ausnahme kann nur
zu MEHR Offenlegung fuehren, nie zu weniger. Das ist der einzige Fehler, den dieser Plan in
dieser Richtung machen darf.

### PM-4 - `turn_eagerness: "patient"` hat die Anrufe verteuert (MITTEL, entschaerft)

**Hergang.** P7 ging live. Der Agent wartete vor jeder Turn-Uebernahme laenger, die
Gespraeche wurden im Schnitt 15 s laenger, und bei 30 ct/min schlug das auf die
Tenant-Kostendecke durch. Die Unterbrechungsrate war besser, die Marge schlechter - und
niemand hatte die Gespraechsdauer mitgemessen.

**Massnahme (entschaerft).** P6 misst nicht nur Unterbrechungen: die Abnahme von P7 verlangt
ausdruecklich einen Vorher/Nachher-Vergleich ueber mindestens fuenf Anrufe, und die
Gespraechsdauer je Anruf ist bereits in `call.durationS` und im Kostenbuch vorhanden. Die
Abnahme von P7 ist um die Bedingung zu erweitern, dass die mittlere Gespraechsdauer nicht
signifikant steigt. Die pro-Tenant-Kostendecke bleibt unangetastet und faengt den Extremfall.

### PM-5 - Ungewollte Anrufe durch den Plan (KEINES, geprueft)

**Hergang.** Kein Plan-Schritt loest einen Anruf aus. P1, P2, P3, P8, P9, P10 sind
Ablehnungs-, Fristen-, Beobachtungs- oder Skript-Aenderungen. P4 aendert nur, WIE ein bereits
vom Auftraggeber ausgeloester Anruf gefuehrt wird. P6 ist read-only. P7 aendert die
Gespraechsfuehrung, nicht die Ausloesung. Die Gates (Abo+KYC als Outbound-Permit,
`OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit, pro-Tenant-Kostendecke, Max-Dauer,
Provider-Signatur) werden von keinem Schritt beruehrt. P1 ENGT ein bestehendes Tor ein.

**Restrisiko.** Die drei Anrufe um 06:01 UTC (N-4) stammen aus einer Quelle ausserhalb dieses
Repos und kosteten 45,7 Cent. Der Plan aendert daran nichts - das ist eine Frage an den
Eigentuemer (F-6), keine Codeaenderung.

### PM-6 - Transkript-Leck ueber die neuen Beobachtungswege (MITTEL, entschaerft)

**Hergang.** P3 loggte den Fragetext der Rueckfrage ins Audit, P9 den Prompt, P6 schrieb
Transkriptzitate in eine Datei im Repo. Nach einem Jahr lagen Gespraechsinhalte von Dritten in
drei Systemen, die dafuer nie vorgesehen waren.

**Massnahme (entschaerft).** In P3, P6 und P9 steht die Inhaltsfreiheit ausdruecklich in den
Abnahmepunkten, jeweils als Marker-Test ("eine Marker-Zeichenkette in der Frage darf im
Audit-Eintrag nicht vorkommen"). P6 gibt Zahlen aus, keine Zitate. Diese Abnahmepunkte sind
nicht optional.

### PM-7 - Der Plan hat den falschen Anruf repariert (MITTEL, teilweise akzeptiert)

**Hergang.** W1-W3 wurden sauber behoben, und der 16:06-Anruf wuerde heute nicht mehr
einfrieren. Die Restaurant-Anrufe wurden dadurch aber kein Stueck besser, weil ihre Ursache
nie gemessen wurde - und genau die sind der Alltag des Produkts, waehrend der Consult-Kanal in
sieben Tagen genau einmal feuerte.

**Massnahme (teilweise).** P6 steht bewusst als eigene Phase im Plan und darf nicht
uebersprungen werden. **Bewusst akzeptiert:** die Ursache der hohen Unterbrechungsrate ist mit
den heute verfuegbaren Anbieter-Daten (nur Mischspur, keine Kanaltrennung, kein numerischer
Empfindlichkeitswert) moeglicherweise gar nicht aufloesbar. Dann bleibt nur der empirische
Weg: eine Stellschraube, fuenf Anrufe, messen - und das dauert.

### PM-8 - Der geteilte Praedikat-Refactor hat den Anrufstart gebrochen (NIEDRIG, entschaerft)

**Hergang.** P1 zog den Ausdruck aus `outbound.js:1581` in `consult/gate.js`. Dabei kippte
`!== true` versehentlich zu `!==` gegen einen anderen Wert, und `consult_available` stand
fortan auf `available` bei Owner-Anrufen - genau das Gegenteil der Absicht.

**Massnahme (entschaerft).** Abnahmepunkt 3 von P1 verlangt ausdruecklich, dass
`consult_available` in den `dynamic_variables` byte-identisch zum Bestand bleibt; die
bestehenden Tests `test/callee-is-owner-elevenlabs.test.js` und
`test/elevenlabs-anrufstart.test.js` laufen mit.

---

## 6. Offene Fragen an den Eigentuemer

Nur Entscheidungen, die ich nicht treffen darf. Jede mit Empfehlung.

**F-1 - Soll der Rueckfrage-Kanal (`get_consult`) ueberhaupt bleiben? -- ENTSCHIEDEN 06.09.: JA.**
Der Eigentuemer hat statt der Stilllegung den dreistufigen Umbau beauftragt (P2) und den
gesprochenen Warteton anstelle der Tippschleife gewaehlt. Begruendung unveraendert gueltig:
der Defekt lag im Tor, in der Frist und in der fehlenden Kanalpruefung, nicht in der Idee.
Die urspruengliche Abwaegung zur Nachvollziehbarkeit:
Gemessen: in sieben Tagen Produktion genau EINMAL benutzt, und dieses eine Mal war der Defekt.
Er haelt eine bezahlte Telefonverbindung, kann nur von einer wachen Assistenten-Sitzung
beantwortet werden, und beim haeufigsten Anruftyp dieses Tenants (Anruf an die eigene Nummer)
ist die Gegenstelle strukturell besetzt.
*Empfehlung: behalten, aber erst nach P1+P2 wieder scharf. Der Kanal ist die einzige Bruecke
zwischen Anruf und Auftraggeber; die Defekte lagen im Tor und in der Frist, nicht in der Idee.
Kurzfristig SM-2 (Flag aus), bis P1+P2 live sind.*

**F-2 / F-4b - Sprache -- ENTSCHIEDEN 06.09.**
**Die Regel des Eigentuemers, woertlich: "Default sollte immer die Sprache des Users sein, und
Claude bzw. die KI, wenn sie den MCP-Server benutzen, muessen nicht gezwungen sein, das auch so
zu machen - wie bei dem Use Case, wenn es eine andere Sprache ist. Aber ansonsten hat immer
Default die Sprache vom User."**

Daraus folgt:
1. `place_call` bekommt einen OPTIONALEN Sprachparameter (LANG-15 wird aufgehoben). Gibt der
   Client eine Sprache an, GILT sie - das ist der Grossvater-Fall.
2. Ohne Angabe gilt die Sprache des Users (Tenant), NICHT mehr die aus der Zielnummer
   abgeleitete. Das kehrt den heutigen Kurzschluss in `callLocaleFor`
   (`src/elevenlabs/call-locale.js:175`) um: heute gewinnt `calleeLanguage(to)` deterministisch.
3. Eine nicht unterstuetzte Sprache wird ABGELEHNT, nicht still auf `en` zurueckgefallen. `pt`
   ist damit zu bauen (LOCALES-Eintrag inkl. Offenlegungssatz, Preset am Agenten, Stimme, Tests),
   sonst laeuft der ausloesende Use Case weiter ins Leere.
4. **Die Sprache des OFFENLEGUNGSSATZES folgt weiterhin dem Angerufenen, nicht dem Client.**
   Der Grund steht in PM-2: eine client-gewaehlte Sprache darf nicht darueber entscheiden, ob
   ein Mensch die Art.-50-Aufklaerung versteht. Nebenwirkung von Punkt 2, hier ausdruecklich
   festgehalten: bei einer AUSLAENDISCHEN Zielnummer ohne Client-Angabe spricht das Gespraech
   dann die Sprache des Auftraggebers - die Offenlegung bleibt davon unberuehrt.

Die urspruengliche Abwaegung zur Nachvollziehbarkeit:
Heute entscheidet allein die Zielnummer. Ein portugiesischer Auftrag an eine deutsche Nummer
ist damit nicht ausdrueckbar. Der Preis: die Sprache des Offenlegungssatzes wuerde
client-bestimmt (siehe PM-2).
*Empfehlung: ja, aber mit der Zusatzsicherung aus PM-2 - die Gespraechssprache ist waehlbar,
die Sprache des Offenlegungssatzes folgt weiterhin der Sprache des Angerufenen. Und: eine
nicht unterstuetzte Sprache muss ABGELEHNT werden, nicht auf 'en' zurueckfallen.*

**F-3 - Owner-Anruf mit Briefing, das einen Dritten ansagt -- ZURUECKGESTELLT 06.09.**
Owner-Entscheidung, woertlich: *"Dass jetzt ein Dritter rangegangen ist mit meiner Nummer und
kein Briefing von einem KI-Agenten hat - lassen wir erstmal so stehen, ist egal."* W4 bleibt
als Befund dokumentiert, P5 wird NICHT gebaut. Kein Schritt dieses Plans weitet die
OC-Ausnahme aus; sie bleibt exakt wie sie ist. Bei Wiederaufnahme gilt die Abwaegung unten.

Die urspruengliche Abwaegung zur Nachvollziehbarkeit:
Optionen: (a) so lassen, der Prompt-Rueckfall genuegt - er hat im einzigen Live-Fall nicht
gefeuert; (b) die OC-Ausnahme greift nur, wenn der Anruf KEIN Briefing/keinen Kontext fuehrt;
(c) ein ausdruecklicher Client-Hinweis "am Apparat ist ein Dritter" schaltet die Ausnahme ab.
*Empfehlung: (b). Deterministisch, serverseitig, ohne neues Client-Feld, und die Richtung ist
einseitig sicher (mehr Offenlegung, nie weniger). Der Preis: ein Owner-Testanruf mit Briefing
hoert wieder den vollen Satz.*

**F-4 - Was soll mit einer Antwort geschehen, die nach Ablauf des verkuerzten Halts eintrifft?**
Auf dem ElevenLabs-Weg gibt es keinen zweiten Zustellweg zum Agenten - der Werkzeug-Aufruf ist
der einzige Kanal. Optionen: (a) den Consult-Datensatz mit dem Halt schliessen, spaete
Antworten werden abgewiesen; (b) den Datensatz bis `CONSULT_OPEN_MS` offen lassen, die Antwort
landet nur im Kontext des Anrufs.
*Empfehlung: (a). Ein offener Datensatz ohne Zustellweg ist ein Phantom - er suggeriert eine
Wirkung, die es nicht gibt, und verbraucht das Kontingent.*

**F-4b - Soll 'pt' (oder eine weitere Sprache) ueberhaupt unterstuetzt werden?**
Heute: `de`, `fr`, `en` im Code; `de`, `fr`, `es` als Presets am Agenten. Das ist bereits eine
Abweichung (`en` hat kein Preset, `es` hat keinen Code). Eine neue Sprache heisst: LOCALES-
Eintrag inklusive Offenlegungssatz, Preset am Agenten, Stimme, Tests.
*Empfehlung: erst die bestehende Abweichung `en`/`es` aufloesen, dann ueber neue Sprachen
reden. Eine vierte Sprache ohne belastbaren Offenlegungssatz waere ein Rueckschritt.*

**F-5 - LLM-Ausfall: Alarmklasse oder Audit? -- ENTSCHIEDEN 06.09.: nur Audit-Eintrag.**
P9 wird auf den Audit-Eintrag begrenzt. Der SMS-Kanal (Telnyx 40305) bleibt ein eigener
Ops-Punkt und ist Vorbedingung fuer jede spaetere Alarmierung.

Die urspruengliche Abwaegung zur Nachvollziehbarkeit:
Gemessen: die WARN-Stufe des Drift-Waechters stellt per Konstruktion an niemanden zu, und der
SMS-Kanal scheitert derzeit zu 100 % (Telnyx 40305). Eine neue Klasse ohne funktionierenden
Kanal ist Kosmetik.
*Empfehlung: P9 auf den Audit-Eintrag begrenzen, und den SMS-Kanal (40305, falsche
Absendernummer) als eigenen Ops-Punkt behandeln - er ist die Vorbedingung fuer jede
Alarmierung.*

**F-6 - Wer loest die Anrufe um 06:01 UTC aus? -- GEKLAERT 06.09.: eine vom Eigentuemer
eingerichtete Morgen-Briefing-Routine.** Kein Auth-Thema, kein Eintrag in PLAN-SECURITY.md.
Der Befund N-9 ("Herkunft mit den vorhandenen Logs nicht feststellbar") bleibt insofern
gueltig, als die Logs die Herkunft nicht zeigen - die Antwort kam vom Eigentuemer, nicht aus
einer Messung.

Die urspruengliche Abwaegung zur Nachvollziehbarkeit:
Gemessen: kein interner Scheduler, kein Render-Cron; eine frisch authentifizierte MCP-Session
zur vollen Minute an drei Tagen, identisches Goal ("Ich rufe dich mit deinem Morgen-Briefing
an."), 45,7 Cent. Die Herkunft ist mit den vorhandenen Render-Logs nicht feststellbar (kein
Request-Log-Typ, keine Client-IP).
*Empfehlung: nachsehen, ob in claude.ai eine geplante Routine dafuer existiert, und sie
entweder bewusst behalten oder abschalten. Wenn die Herkunft unklar bleibt, ist das ein
Auth-Thema und gehoert in PLAN-SECURITY.md, nicht hierher.*

**F-7 - Wie viel Aufwand ist der Laerm-Fall wert? -- ENTSCHIEDEN 06.09.: hohe Prioritaet.**
Owner-Entscheidung, woertlich: *"Ist natuerlich super wichtig, dass der KI-Assistent auch
einfach steht, wenn man im Restaurant ist."* P6 (Messwerkzeug) und P7 (Stellschraube) werden
gebaut und ruecken in der Reihenfolge nach vorn - hinter P1/P2, vor die Beobachtungs-Phasen.
Die Begrenzung auf EINE Stellschraube je Messrunde bleibt: ohne Vorher-Messung belegt eine
Aenderung nichts (Lehre bench-must-reproduce-defect).

Die urspruengliche Abwaegung zur Nachvollziehbarkeit:
Gemessen: der Anbieter bietet keinen numerischen Empfindlichkeitswert, nur vier kategoriale
Schalter, und liefert nur eine Mischspur - eine saubere Kanaltrennung ist ueber seine API
nicht herstellbar. Der empirische Weg (eine Stellschraube, fuenf Anrufe, messen) kostet pro
Runde echte Anrufe und echtes Geld.
*Empfehlung: P6 bauen (billig, read-only, macht jede spaetere Aussage belegbar), dann genau
EINE Runde P7 mit `turn_eagerness: "patient"`. Bringt das nichts, ist das ein Signal ueber den
Anbieter, kein Signal ueber unseren Code - und dann gehoert die Frage in die
Voice-Stack-Strategie, nicht in diesen Plan.*

---

## 7. Was dieser Plan ausdruecklich NICHT tut

- **Kein Agent-Rollback.** Es existiert keine Version ohne bekanntes Eigenrisiko (N-6).
- **Keine Aenderung am Offenlegungssatz**, an seiner festen Verdrahtung oder an der Reichweite
  der OC-Ausnahme in Richtung "weiter". P5 kann sie nur enger machen.
- **Kein Aufweichen eines Safety-Gates.** P1 engt ein Tor ein; kein Schritt entfernt eine
  Pruefung, auch nicht temporaer.
- **Keine neue Route**, damit kein Eintrag in `src/route-policy.js` und keine neue
  Auth-Ausnahme.
- Keine Aenderung an `CONSULT_OPEN_MS` fuer den MCP-Long-Poll-Weg (P2 fuehrt eine eigene Frist
  fuer den Anbieter-Weg ein und laesst die bestehende Zahl in Ruhe).
- Keine Aenderung an `caller_turns` selbst (N-2) - nur am falschen Leser (P10).
- Keine Behebung des SMS-Fehlers 40305, des Telnyx-Guthabens oder der leeren
  `TELNYX_FQDN_CONNECTION_ID` (N-3): eigene Ops-Punkte, hier nur benannt.
