# Agenten-Stimme verbessern

Strategiedoc, Stand 2026-09-02. KEIN Code in diesem Lauf. Grundlage: Forensik-Berichte A
(EL-Live-Agent), B (Repo-Landkarte), C (Historie) vom 2026-09-02; Quellenangaben darin sind
EL-Feldnamen bzw. file:line. Unantastbar fuer jede Option dieses Plans: Offenlegungssatz,
KI-Kennzeichnung und Owner-Eroeffnung (Absolute Regel 2, PLAN-OWNER-CALL) — keine Option darf
sie anfassen oder umbauen.

## Kontext & Befunde

Testanruf `call_mtka4kunn0qy` (2026-09-02, 17:57 MESZ), EL-Conversation
`conv_0501m1hddb92f5d8hktsr4cb813m`, Live-Agent `agent_5301kwkh9vv3ezesf100pggfj9rs`
("Hermes", einziger Agent des Workspaces; Version `agtvrsn_6601m0g1rhdcez98q21cq3ntx9ga`
identisch mit der des Anrufs — kein Config-Drift zwischen Vorfall und Abfrage).

- **B1 DOPPELTE ANKUENDIGUNG.** Transkript-Beleg: Anrufer: "Kannst du mir vielleicht 'ne zehn
  Sekunden Gedicht machen und erzaehlen?" — Agent: "Gut, dann erzaehle ich dir ein kurzes
  Gedicht. Klar, hier ein kurzes Gedicht: <Gedicht>". Der Agent kuendigt den Inhalt an und
  kuendigt ihn ein zweites Mal an, bevor er ihn liefert. Kein Detektor im Repo sieht dieses
  Muster (nur Klammer-Token werden erkannt).
- **B2 GESPROCHENE KLAMMERMARKE.** Der Agent sprach "[froehlich]" woertlich aus. Der lokale
  Detektor schlug an (Flag `[el-tags]`, `src/elevenlabs/outbound.js:513`). Vorfaelle gleicher
  Familie: "[Curious]"-Serie am 18.08. (Befund 3, seinerzeit Konfig-Ursache, behoben),
  "[freundlich]" am 19.08. (bewusst zurueckgestellt, "Muster sammeln"). Damit ZWEI Rueckfaelle
  seit dem Fix — das aufgestaute Muster ist jetzt Gegenstand dieses Plans.

## Forensik: Was wir wissen

### Live-Agent (Bericht A, EL-API, version-matched)

- Override zur Anrufzeit live bestaetigt: NUR `agent.language='de'`, `agent.first_message`
  (Owner-Eroeffnung), `tts.voice_id`. `agent.prompt=null` -> System-Prompt kam vollstaendig aus
  dem EL-Agentenobjekt (Repo-Seite: `src/elevenlabs/outbound.js:1036-1046`; das Feld ist
  client-seitig gar nicht uebersteuerbar, `platform_settings...agent.prompt.prompt=false`).
- `tts.suggested_audio_tags=[]` (LEER) -> die Ursache vom 18.08. ist im Live-Agenten entfernt.
  "[froehlich]" ist keine vorgeschlagene Marke, sondern Improvisation des Modells.
- `tts.model_id='eleven_v3_conversational'` UND `tts.expressive_mode=true` -> v3-Expressive-
  Mechanik ist aktiv, die auf Klammer-Audio-Tags (Englisch-Vokabular) ausgelegt ist; ein
  deutsches Tag liegt ausserhalb des erkannten Vokabulars und wird woertlich synthetisiert
  (plausibler Mechanismus, nicht bewiesen).
- Prompt-Regeln GEGEN B1 und B2 existieren BOTH am Live-Agenten (Abschnitt "SAY ONLY WHAT IS
  NEEDED"): "Do not think out loud, do not narrate what you are about to do", "Never write
  square brackets. Everything you produce is spoken out loud exactly as it stands ...". Befund
  ist also KEINE fehlende Regel, sondern eine Adhaerenz-Luecke.
- GEGEN-Instruktion am Live-Agenten: `turn.soft_timeout_config` (timeout 2.0 s,
  `use_llm_generated_message=true`, `max_soft_timeouts_per_generation=1`) mit
  `llm_generated_message_prompt_override`, der eine "short, natural bridging phrase (max. 6-8
  words) ... hinting at what you are about to address" fordert — das ist eine Anweisung zum
  ANKUENDIGEN. Der erste Satz des Vorfalls ("Gut, dann erzaehle ich dir ein kurzes Gedicht.",
  8 Woerter, reine Ueberleitung) passt exakt auf dieses Profil; gemessenes
  `convai_llm_service_ttf_sentence`=2.067 s lag knapp ueber der 2.0-s-Schwelle. ABER: beide
  Saetze stehen in EINER LLM-Message (`original_message=null`, kein separater Filler-Eintrag) —
  Filler vs. Modelltext ist per API nicht trennbar.
- Musterquelle im Prompt: Tool-Abschnitte FORDERN Ankuendigungen (get_consult: "Announce the
  call with one short spoken sentence", look_up: "Announce it with one short spoken sentence").
  Das Muster "anmuendigen, dann liefern" ist fuer Spezialfaelle etabliert und wurde vom Modell
  auf den Tool-losen Gedicht-Wunsch generalisiert.
- `agent.prompt.ignore_default_personality=false` -> ElevenLabs-Default-Personality liegt
  ZUSAETZLICH ueber dem Custom-Prompt und wirkt der Kuerze-Disziplin entgegen (glaubwuerdiger
  Mit-Faktor, Wortlaut des Layers nicht abrufbar).
- LLM: `claude-sonnet-5`, temperature 0.66; `agent.language='en'` im Agentenobjekt (Call lief
  per Override auf 'de', Prompt regelt den Sprachwechsel selbst).

### Repo (Bericht B, verifizierte Anker)

- Detektor: `src/elevenlabs/outbound.js:493` `AUDIO_TAG=/\[[^\]\n]{1,40}\]/g` (sprachagnostisch,
  deckt "[froehlich]"), `:513-524` `reportAudioTags` — NUR Agent-Zeilen, NUR `console.error`,
  kein Store-Flag, keine Transkript-Aenderung (Art.-50-Begruendung im Kommentarblock `:495-512`).
  Aufruf in `persistProviderResult` (`:944`), laeuft auf beiden Ergebniswegen. Ein B1-Detektor
  existiert NICHT.
- Override-Whitelist: `src/elevenlabs/convai.js:96`
  `OVERRIDE_ALLOWED_LEAF_PATHS=['agent.language','tts.voice_id']`, `:108`
  `OVERRIDE_OWNER_ONLY_LEAF_PATHS=['agent.first_message']`; Waechter `assertOverrideWhitelisted`
  (`:138-155`) wirft fail-closed VOR dem Netz (`startOutboundCall`, `:217`). Systemprompt,
  suggested_audio_tags, turn.*-Timeouts sind per Whititelist nicht uebersteuerbar.
- "Registrierungsflaeche" des Agenten ist die Vorlage
  `elevenlabs/agent_configs/outbound-agent.template.json` (38 besessene Felder in `_besitz.felder`,
  u.a. prompt, first_message, suggested_audio_tags, soft_timeout_meldung/-zusatzmeldungen/
  -prompt_override). Drift-Waechter: `scripts/check-elevenlabs-drift.mjs` (`npm run
  elevenlabs:drift`, read-only). Push: `scripts/push-elevenlabs.mjs` (`npm run elevenlabs:push`,
  patcht nur abweichende besessene Pfade mit Ruecklese). Eine `registrierung.js` fuer Agenten
  existiert nicht.
- Vorlagen-SOLL zu B2: `suggested_audio_tags=[]`; soft_timeout-Override endet auf "Never write
  anything in square brackets: every character you produce is spoken out loud exactly as it
  stands."
- i18n-Prompts (`src/i18n/prompts/{de,en,fr}.js`, speechRules de.js:36-43 / en.js:67-74 /
  fr.js:31-38): inhaltlich konsistent, haben KEINE Klammer-Verbotsregel und KEINE
  Einmal-Ankuendigungs-Regel — die existieren nur in der EL-Vorlage.
- Tests: `test/el-prompt-kuerze.test.js` pinnt die Vorlagen-Regeln (u.a. (c) kein lautes
  Denken, (e) keine square-bracket-Tags — die B1/B2-Pendants, geprueft wird die VORLAGE; Live
  = drift-Skript). `test/el-fixtures-echte-antworten.test.js:293-327` pinnt den Detektor an
  echter Anruf-6-Fixture inkl. Positiv-Kontrolle und UNVERAENDERTER Speicherung (Art. 50).
  `test/elevenlabs-override-whitelist.test.js` pinnt die Whitelist gegen die Besitzkarte.
  Kein Test pinnt B1-artige Doppelankuendigungen.

### Historie (Bericht C)

- 18.08.: "[Curious]"-Serie (Anruf 3, Ursache zunaechst nur Verdacht); Anruf-6-Befundung fand
  die Tags an DREI Stellen (suggested_audio_tags, soft_timeout-Meldungen,
  llm_generated-Override "an audio tag such as ... benutzen") — alle drei umgeschrieben/geleert,
  Push 18.08. 17:5x mit Ruecklese; Detektor "MELDEN, NICHT ENTFERNEN" gebaut (Art. 50:
  Transkript ist Nachweis, stilles Strippen waere Schoenschrift). Verifikation Anrufe 7+8:
  0 Klammerausdruecke.
- Lehre vom 18.08.: ein Prompt-Verbot mit Klammer-BEISPIEL verlor gegen das Beispiel — der
  Prompt traegt seither keine einzige eckige Klammer. JEDE neue Regel hier muss dasselbe halten.
- 19.08.: "[freundlich]" als DE-Marke dokumentiert und bewusst NICHT angegangen ("erst Muster
  ueber weitere Testanrufe sammeln", `tasks/gq-strategie-2026-08-19.md:199`). Der heutige
  Vorfall ist der zweite Strike dieses Musters.
- B1-Verwandte: Anruf 7 Defekt 1 (Anliegen zweimal), behoben durch Sachfrage statt
  Hoeflichkeitsfrage; GQ-E1 (19.08.) reparierte die Eroeffnungs-KOMPOSITION (Frage reist im
  Wert, `src/elevenlabs/call-locale.js:76ff`). Doppelankuendigung IM TURN war nie Gegenstand
  einer Messung.
- Luecke: `tasks/lessons.md` enthaelt KEINE EL-/Tag-/Klammer-Regel — die Befund-3-Lehre lebt
  nur in `.fortschritt.md` und Code-Kommentaren.

## Forensik: Was wir nicht wissen

- War der erste Satz von B1 ein plattform-injizierter Soft-Timeout-Filler oder echter
  claude-sonnet-5-Text? Die Conversations-API trennt das nicht (eine Message,
  `original_message=null`, realtime_config_snapshots leer). Klaerung nur per Audio-Mitschnitt
  oder EL-Support.
- Spricht eleven_v3_conversational unbekannte deutsche Klammer-Tags tatsaechlich woertlich?
  Aus Config abgeleitet, per API nicht beweisbar; Beleg waere eine gezielte Test-Synthese.
- Foerdert `tts.expressive_mode=true` die LLM-Produktion von Klammer-Tags (auch ohne
  suggested_audio_tags)? Vermutung, nicht gemessen.
- Wortlaut und Staerke des EL-Default-Personality-Layers (`ignore_default_personality=false`)
  sind unbekannt (nicht Teil der Agenten-API-Antwort).
- Gab es zwischen dem 19.08. und heute weitere `[el-tags]`-Meldungen in den Render-Logs
  (30-Tage-Fenster)? Ungeprueft — [freundlich] und [froehlich] koennten die einzigen
  Rueckfaelle sein oder ein Muster.
- Liegt `agent.first_message` auf der LIVE-Erlaubnis-Karte des Anbieters inzwischen frei?
  Vorlage messt am 16.08. `false`; der Anbieter ignoriert nicht freigeschaltete Overrides
  STILL — die Owner-Eroeffnung koennte live wirkungslos sein (kein Fehler, kein Log). Gehoert
  in die OC-Kette (PLAN-OWNER-CALL), nicht in diesen Plan; hier nur festgehalten.
- Hat `outboundAgentConfigFor` (`src/conversation/elevenlabs-agent-config.js`, kein
  Produktion-Aufrufer) einen geplanten Zweck oder ist es ein toter Sehm? Owner-Entscheidung.

## Optionen

### O1 Prompt-Regeln am EL-Agenten (plus konsistente i18n-Regeln)

Schwaecht die Adhaerenz-Luecke, beseitigt die GEGEN-Instruktion. WICHTIG: Regeln fuer B1/B2
existieren schon — O1 ist NICHT "Regel einfuehren", sondern (a) die live wirksame
Gegen-Instruktion im soft_timeout-Override umformulieren (der fordert heute ausdruecklich
"hinting at what you are about to address" — eine Ankuendigungs-Anweisung im besessenen Feld,
dieselbe Fehlerfamilie wie Befund 3: Konfiguration schlaegt Prompt), (b) der B1-Regel einen
Carve-out geben, der das gueltige Tool-Announce-Muster begrenzt, (c) der B2-Regel einen
ALTERNATIV-Kanal geben (Stimmung nur ueber Wortwahl — Verbote ohne Alternative versagen
haeufiger).

Vorschlag soft_timeout_prompt_override (besessen, englisch, Schlusssatz bleibt): "Generate a
short, natural acknowledgement (max. 6-8 words) that you are working on the answer. Do NOT
name, introduce or announce the content — the full answer follows immediately after. Never
write anything in square brackets: every character you produce is spoken out loud exactly as
it stands."

Vorschlag EL-Master-Prompt, Abschnitt SAY ONLY WHAT IS NEEDED (englisch, ohne jedes
Klammer-Zeichen — Lehre 18.08.):
- B1: "Deliver content exactly once. When you start an answer, a story or a result, the very
  next sentence is that answer, story or result — never a second introduction of it. You
  announce an action only while a tool call or a wait is actually happening; once you are
  speaking content, speak the content."
- B2 (Ergaenzung zur Bestandsregel): "Convey mood through word choice and pacing only, never
  through notation of any kind."

Konsistente Formulierungen fuer die drei i18n-speechRules (Legacy-/Budget-Weg; fuer den
EL-Weg gilt der englische Master-Prompt, Calls laufen per `agent.language`-Override auf de —
die Sprachvarianten sorgen dafuer, dass BEIDE Wege dieselbe Disziplin tragen; franzoesische
Akzente wie im Bestand fr.js):

- de: "- Kuendige Inhalt genau einmal an und liefere ihn dann: Der Satz nach einer Ankuendigung
  IST der Inhalt, keine zweite Ankuendigung. Eine Handlung kuendigst du nur an, solange
  wirklich gewartet wird oder ein Werkzeug laeuft." / "- Keine eckigen Klammern und keine
  Stimm- oder Regieanweisungen im Gesprochenen: Alles, was du schreibst, wird exakt so
  ausgesprochen. Stimmung traegst du nur ueber die Wortwahl."
- en: "- Announce content exactly once, then deliver it: the sentence after an announcement IS
  the content, never a second announcement. You announce an action only while genuinely
  waiting or while a tool is running." / "- No square brackets and no mood or stage directions
  in spoken text: everything you write is pronounced exactly as it stands. Convey mood through
  word choice only."
- fr: "- Annonce le contenu une seule fois, puis livre-le : la phrase qui suit une annonce EST
  le contenu, jamais une deuxième annonce. Tu n'annonces une action que pendant une vraie
  attente ou pendant qu'un outil tourne." / "- Aucun crochet ni indication d'humeur ou de mise
  en scène dans le texte parlé : tout ce que tu écris est prononcé exactement tel quel.
  L'humeur passe uniquement par le choix des mots."

Wahrheits-Kette gegen duellierende Formulierungen (Wartungsregel, Pflicht ab ST1):
kanonisch fuer den Regel-Inhalt B1+B2 ist die EL-VORLAGE — Master-Prompt EN und
soft_timeout-Override EN. Die drei i18n-speechRules-Zeilen sind bewusste Uebersetzungen
desselben Regel-Inhalts, keine zweite Wahrheit; auch die en-Zeile ist eine eigenstaendige
Formulierung ABGELEITET von der Vorlage, nicht ihr Massstab. Jede Einfuegestelle in
de.js/en.js/fr.js traegt einen einzeiligen Quell-Kommentar, der die Vorlage als Herkunft
nennt (Regel-Inhalt B1/B2). Inhaltliche Aenderungen an B1/B2 gehen im SELBEN Commit an
alle fuenf Stellen (Master-Prompt, soft_timeout-Override, speechRules de/en/fr) UND an
ihre Pins (AS2/AS3-Assertions) — wer nur eine Stelle aendert, erzeugt Drift zwischen
Vorlage und speechRules, den kein Detektor sieht: die Befund-3-Falle eine Ebene tiefer.
Diese Regel ist der vierte Kernsatz von ST5/AS11.

Vorteile: billigster Hebel; soft_timeout-Umformulierung ist deterministisch (besessenes Feld,
kein Modellverhalten); i18n-Konsistenz schliesst die Luecke auch am Budget-Weg.
Nachteile: wirkt nicht, wenn B1-Satz 1 ein Plattform-Filler war UND der Override nicht der
Quelle entspricht; B2-Adhaerenz bleibt Modell-Risiko (Regel versagte schon einmal); Wirkung
nur per Testanruf messbar. Bewertung: NOTWENDIG, aber NICHT HINREICHEND allein.

### O2 Pin in der Registrierungs-Vorlage (Befund-3-Mechanik)

Damit die Regeln bei Dashboard-Aenderung oder Neuanlegen des Agenten nicht still
zurueckfallen: alle Aenderungen aus O1 ausschliesslich ueber die Vorlage + `npm run
elevenlabs:push` bringen (prompt und soft_timeout_prompt_override sind bereits besessen —
KEINE neuen Pins fuer den Wortlaut noetig). Zusaetzlich pruefen, ob die Besitzkarte minimale
Neueintraege braucht: `turn.soft_timeout_config.use_llm_generated_message` und
`max_soft_timeouts_per_generation` (heute Dashboard-Eigentum) — Pin verhindert, dass der
Filler-Mechanismus unbemerkt zurueckkommt oder hochgedreht wird.

Vorteile: drift-Skript bewacht den Stand ab dann automatisch; dieselbe Mechanik, die Befund 3
nach dem Push stabil gehalten hat; kein neues Werkzeug noetig. Nachteile: jeder Pin verengt
die Dashboard-Freiheit (Tenant-/Stimm-Experimente); Pin ohne Verstaendnis der Stellschraube
heisst kuenftig Konflikt bei jeder beabsichtigten Aenderung. Bewertung: PFLICHTBEGLEITUNG von
O1 — eine Regel, die nur am Live-Objekt haengt, ist beim naechsten Dashboard-Griff weg.

### O3 Code-Seite: Detektoren erweitern, NUR Diagnose

- B1-Detektor (neu): Heuristik auf Agent-Zeilen — Ankuendigungs-Satz unmittelbar gefolgt von
  zweiter Ankuendigung desselben Inhalts (Lexem-Overlap plus Leit-Cues), Sprache de/en/fr,
  ausdruecklich mit dokumentierter False-Positive-Toleranz; Ausgabe NUR `console.error`
  (`[el-b1]`), analog `[el-tags]`.
- `[el-tags]`-Haefigkeit persistent machen: diagnostisches Zaehlfeld am Call-Datensatz
  (KEINE Transkript-Aenderung) — macht das 19.08.-"Muster sammeln" endlich messbar, statt von
  Log-Zufall abzuhaengen.
- Kommentarpflicht: der Kommentarblock an `reportAudioTags`
  (`src/elevenlabs/outbound.js:495-512`) gehoert um den Vorfall 2026-09-02 erweitert
  ([froehlich] als zweite DE-Marke nach dem 18.08.-Fix; B1-Muster; Verweis auf dieses Doc)
  — derselbe Ort, an dem die Befund-3-Lehre lebt.
- UNANTASTBAR: NIEMALS Transkripte nachtraeglich strippen (Art. 50 EU AI Act — das Transkript
  ist der Nachweis; Bestands-Kommentar "WARUM MELDEN UND NICHT ENTFERNEN" gilt woertlich).

Vorteile: permanentes Mess-Instrument; deckt B1, den heute KEIN Sensor sieht; macht
Rueckfaelle zaehlbar. Nachteile: Heuristik bleibt ungenau (genaue Trennung Filler vs.
LLM-Text leistet auch er nicht); Wartungsaufwand; Gefahr, dass ein zu lauter Detektor
Betriebsrauschen erzeugt. Bewertung: JA, als Messstelle nach dem Push — aber nicht als
Ersatz fuer O1/O2.

### O4 Konfig-Hebel am Live-Agenten (Owner-Entscheidungen)

- (a) soft_timeout_prompt_override-Umformulierung: Teil von O1 (siehe oben), deterministisch,
  besessen. Empfehlung: mit O1 together pushen.
- (b) `tts.expressive_mode` auf false? Waere der harte B2-Hebel (Removes den Konfig-Sog),
  aendert aber die Stimm-Charakteristik — gegen das Ziel "Stimme verbessern". Empfehlung:
  anlassen; Escalations-Schwelle: ein weiterer Tag-Rueckfall NACH dem O1/O2-Push -> dann aus.
- (c) `ignore_default_personality` auf true? Nimm den unbekannten Layer raus, der der
  Kuerze-Disziplin entgegenwirkt — aendert aber evtl. die Persoenlichkeit spuerbar.
  Empfehlung: zunaechst messen lassen (Testanruf-Vergleich), nicht blind schalten.
- (d) Filler ganz abschalten (`use_llm_generated_message=false`): toetet die
  Announce-Filler-Quelle, laesst aber die statische Ueberbruechung (die selbst
  ankuendigungsartig klingt) uebrig und verschlechtert die Ueberbrueckungs-Qualitaet.
  Empfehlung: nein — (a) loest dasselbe praeziser.

## Empfehlung

1. **ST0 zuerst** (read-only): drift-Lauf + Render-Log-Rueckblick — klaert, ob der Live-Agent
   ueberhaupt auf Vorlagen-SOLL steht und wie viele Rueckfaelle es gab. Alles Weitere haengt
   davon ab: bei Drift ist die Wurzel Konfig, nicht Modell.
2. **O1 + O2 gemeinsam in EINEM Push** (Prompt-Regeln, soft_timeout-Umformulierung,
   minimalen Pin-Erweiterungen, Vorlage ist Quelle, Ruecklese per `elevenlabs:push`). Eine
   Regel ohne Pin ist die Befund-3-Falle in Zeitlupe.
3. **O3 danach als Dauer-Sensor** (B1-Diagnose + Zaehlfeld + Kommentar-Erweiterung).
4. **Verifikations-Testanruf** mit beiden Detektoren live; Transkript als Fixture pinnen
   (Bestandsmuster Anruf 6).
5. O4(b)/(c) nur auf Messung hin entscheiden; O4(d) ablehnen.

Begruendung: B2 ist eine Adhaerenz-Luecke trotz existierender Regel — desshalb wirkt O1 nur
mit (a) der Umformulierung der lebenden Gegen-Instruktion und (b) dem Pin, der die Regel
haelt. Fuer B1 ist unklar, ob Satz 1 ueberhaupt Modelltext ist — O1/ST0-3 (Audio-Mitschnitt
bzw. EL-Support) sind die einzigen Wege, das zu klaeren; die soft_timeout-Umformulierung
greift in BEIDEN Faellen.

## Phasenplan

Kriterien nach ABNAHME-<ID>-Konvention (Kennung am Namensanfang, "ABNAHME-AS<n>: ...", Grundzeile
"| ROT WEIL: ... | FIX: ..." solange rot; gruen gewordene Kriterien wandern nach
`test/abnahme-ausgewandert.json`). KEINE Umsetzung in diesem Lauf.

- **ST0 Forensik schliessen (read-only).** Drift-Lauf, Render-Log-Rueckblick 30 Tage,
  B1-Filler-Hypothese (Mitschnitt-Testanruf auf eigene Nummer ODER EL-Support-Ticket).
  - Pflicht aus der Vorlage (Hinweis zu `conversation_config_override_erlaubnisse`): der
    Driftlauf belegt die LIVE-Erlaubnis-Karte LESSEND — ST2 pusht nie mit ueberholter
    SOLL-Karte, sonst dreht ein einziger Push die Stimme ALLER Anrufe, lautlos (Pre-Mortem
    R7).
  - ABNAHME-AS1: `npm run elevenlabs:drift`-Ergebnis (Exit-Code + Feldliste der Abweichungen)
    dokumentiert in einem Befund-Doc unter `tasks/`; Zahl der `[el-tags]`-Log-Treffer der
    letzten 30 Tage steht darin als Zahl.
- **ST1 Regeln (O1).** Vorlagen-Prompt (B1-Regel + B2-Ergaenzung), soft_timeout_override-
  Umformulierung, i18n-speechRules de/en/fr.
  - Insert-Disziplin (Pre-Mortem R1): neue speechRules-Zeilen haengen ans ENDE des jeweiligen
    Blocks in de.js/en.js/fr.js; kein Verschieben oder Re-Indentieren benachbarter Bausteine
    (GAP-/PROMPT-Kataloge pinnen Wortlaut). npm test MUSS danach gruen sein.
  - Wahrheits-Kette (O1): die speechRules-Zeilen sind Uebersetzungen der Vorlagen-Regel —
    jede Einfuegestelle traegt einen Quell-Kommentar mit Verweis auf die Vorlage.
    Inhaltliche B1/B2-Aenderungen im SELBEN Commit an allen fuenf Stellen (Master-Prompt,
    soft_timeout-Override, speechRules de/en/fr) und ihren Pins (AS2/AS3).
  - ABNAHME-AS2: Test pinnt die exakten Regel-Saetze (Substring-Match) im Vorlagen-Prompt:
    B1-Regel, B2-Ergaenzung, neuer soft_timeout-Override-Text (3 Assertions). ZUSAETZLICH
    Unberuehrtheits-Assertion: die Offenlegungs-Felder der Vorlage (first_message,
    voicemail_message, language_presets_offenlegung je Sprache) bleiben byte-identisch zu
    LOCALES und `disable_first_message_interruptions` bleibt true — eine Regel-Aenderung darf
    niemals an Art.-50-Feldern mitschleifen (Pre-Mortem R1).
  - ABNAHME-AS3: Test pinnt, dass ALLE drei i18n-speechRules (de.js/en.js/fr.js) die B1-Zeile
    UND die B2-Zeile enthalten — fehlt EINE Sprache, ist das Kriterium rot.
  - ABNAHME-AS4: Test pinnt, dass KEINE der neuen Regeltexte (Vorlagen-Prompt, drei
    speechRules, soft_timeout-Override) ein eckiges Klammer-Zeichen enthaelt (Lehre 18.08.:
    Beispiel schlaegt Regel).
- **ST2 Pin & Push (O2).** Minimale Besitz-Erweiterung (sofern ST0/Owner es tragen:
  `use_llm_generated_message`, `max_soft_timeouts_per_generation`), Push mit Ruecklese.
  - Reihenfolge-Pflicht (Pre-Mortem R2/R7/R9): FRISCHER Driftlauf unmittelbar VOR dem Push
    (Erlaubnis-Karte stimmt mit Live ueberein, s. ST0); Push-Protokoll (geaenderte Felder +
    Ruecklese-Ergebnis) ins Befund-Doc; neue Pin-Eintraege tragen einen _hinweis mit
    Begruendung und dem Aenderungsweg ("SOLL aendern NUR in der Vorlage, dann pushen").
  - ABNAHME-AS5: Test pinnt die neuen `_besitz.felder`-Eintraege (Feldname + beide Pfade) in
    der Vorlage.
  - ABNAHME-AS6: `npm run elevenlabs:drift` exit 0 nach Push (alle besessenen Felder am
    Live-Agenten = SOLL) — als dokumentierter Lauf in der Phase, Skript-Exit-Code als Beleg.
- **ST3 Detektoren (O3, NUR Diagnose).** `[el-b1]`-Heuristik, Zaehlfeld am Call-Datensatz,
  Kommentar-Erweiterung in `src/elevenlabs/outbound.js`; erzeugt die anonymisierte
  Vorfalls-Fixture (Original-Transkript conv_0501..., AS7).
  - PII-Schranken (Pre-Mortem R8): `[el-b1]` loggt NUR Trefferzahl, Cues und Zeilenindizes,
    KEINE Vollsaetze (Render-Logs stehen 30 Tage offen). Heuristik eng fuehren (Lexem-Overlap-
    Schwelle, nur UNMITTELBAR aufeinanderfolgende Saetze — Pre-Mortem R5); das Zaehlfeld macht
    die B1-Rate messbar (Treffer/Anrufe): dominiert `[el-b1]` das Log, Detailligung
    duenner ziehen, NIE abstellen (MELDEN-Prinzip).
  - ABNAHME-AS7: Test an einer Fixture des ORIGINALEN Vorfalls-Transkripts (conv_0501...,
    anonymisiert; Quelle ist das Vorfalls-Transkript selbst, NICHT der ST4-Verifikationsanruf
    — ein sauberer Anruf liefert die Positiv-Erwartung per Definition nie): `[el-b1]` feuert
    genau 1x, `[el-tags]` feuert mit Marken "[froehlich]", und das GESPEICHERTE Transkript
    bleibt unveraendert (Art.-50-Pinning, Bestandsmuster). ZUSAETZLICH: die `[el-b1]`-Meldung
    enthaelt KEINE Vollsaetze aus dem Transkript (nur Cues/Indizes/Trefferzahl) UND die
    Fixture ist anonymisiert — kein Nummern-/Eigennamen-Grep-Fund, Bestandsmuster
    Anruf-6-Fixture, dieselbe Bedingung wie AS10.
  - ABNAHME-AS8: Gegenprobe an sauberen Echtfall-Fixtures (Anruf 7/8-Charakter): beide
    Detektoren still; Zaehlfeld=0.
  - ABNAHME-AS9: `src/elevenlabs/outbound.js` Kommentarblock nennt den Vorfall 2026-09-02
    (deterministischer String-Check auf Datum + Doc-Verweis).
- **ST4 Verifikations-Testanruf.** Ein echter Testanruf mit Detektoren live; Transkript als
  Fixture ins Repo.
  - Hoer-Urteil-Pflicht (Pre-Mortem R3/R6/R10): der Owner HOERT den Verifikationsanruf
    (Mitschnitt liegt vor, wenn die B1-Hypothese in ST0 per Mitschnitt geklaert wurde);
    Urteil zu natuerlichem Uebergang und Stille-Wahrnehmung als Notiz ins Befund-Doc — sonst
    zaehlt die Verifikation nur Negative (Marken/B1) und Kuerze, und "steif/abgehackt" bleibt
    unsichtbar. Fixture nur ANONYMISIERT (Nummern maskiert, Eigennamen entfernt,
    Bestandsmuster Anruf-6-Fixture, Pre-Mortem R8).
  - ABNAHME-AS10: Im Transkript des Verifikationsanrufs (call-/conv-ID dokumentiert) ist die
    Zahl der Klammer-Marken in Agent-Zeilen 0 (grep/Skript, Exit-Code als Beleg) UND das
    B1-Muster bleibt ungemeldet. ZUSAETZLICH: das Befund-Doc fuehrt das Hoer-Urteil des
    Owners (String-Check auf den Abschnitt) und die Fixture liegt anonymisiert vor (kein
    Klarnamen-/Nummern-Grep-Fund).
- **ST5 Lehren sichern.**
  - ABNAHME-AS11: `tasks/lessons.md` enthaelt eine EL-Regel mit den VIER Kernsaetzen
    (MELDEN statt ENTFERNEN; Beispiel schlaegt Regel / keine Klammer im Regeltext; Dashboard
    schlaegt ungepinntes Repo — nur gepinnte Felder sind Wahrheit; Vorlage ist kanonisch,
    speechRules sind Uebersetzungen — B1/B2-Aenderungen im selben Commit an allen fuenf
    Stellen und ihren Pins) — deterministischer Grep-Check auf vier Signatur-Phrasen.

## Pre-Mortem

Gedankengang (CLAUDE.md): Stand 2027-09-02, der Umbau nach diesem Doc ist gescheitert oder
hat Schaden angerichtet. Rueckwaerts erzaehlt, was passiert ist. Die Unantastbaren
(Offenlegungssatz, KI-Kennzeichnung, Owner-Eroeffnung) sind bei jedem Risiko mitgeprueft;
Anker: Offenlegung haengt an first_message, voicemail_message,
disable_first_message_interruptions und language_presets_offenlegung der Vorlage (Kette
locales.js -> T5-Test byte-identisch -> Vorlage -> Drift -> Live-Agent), der EL-Weg holt
Prompt-Fragmente nur aus EN_PROMPT (outbound.js:355).

| # | Risiko | Failure-Pfad (was im Jahr danach passierte) | Massnahme (konkret) | Entscheidung |
|---|--------|---------------------------------------------|---------------------|--------------|
| R1 | Prompt-Aenderung schwaecht Offenlegung/KI-Kennzeichnung oder Owner-Eroeffnung (de/en/fr) | Ein echter Anruf beginnt mit verstummeltem Eroeffnungssatz. ST1 hat SAY ONLY WHAT IS NEEDED umgebaut — derselbe Prompt-Abschnitt wie Sprachwechsel- und Sprechregeln; beim Edit wurde ein benachbarter Offenlegungs-/Sprachwechsel-Satz mit verschoben bzw. in de.js/en.js/fr.js beim Einfuegen der speechRules-Zeilen der disclosure-nahe Baustein de-indiziert. AS2/AS3 prueften nur PRAESENZ der neuen Saetze, nicht UNBERUEHRTHEIT der Art.-50-Felder; drift lief gruen, weil Vorlage und Live dieselbe Beschaedigung trugen. | AS2 erweitern: zusaetzliche Unberuehrtheits-Assertion — first_message, voicemail_message, language_presets_offenlegung je Sprache bleiben byte-identisch zu LOCALES, disable_first_message_interruptions bleibt true. Insert-Disziplin: neue speechRules-Zeilen nur ans ENDE des Blocks, kein Re-Indent benachbarter Bausteine. npm test MUSS gruen sein (GAP-/PROMPT-Kataloge pinnen Wortlaut). | entschaerft — die T5-Kette (locales -> Test -> Vorlage -> drift -> Live) bleibt die eine Wahrheit; Unberuehrtheit wird zur Gruen-Bedingung von ST1 |
| R2 | Befund-3-Mechanik kehrt zurueck: Dashboard/Konfig ueberschreibt die neuen Regeln | Sechs Monate spaeter will jemand die Filler "natuerlicher" machen und editiert soft_timeout-Texte im DASHBOARD statt in der Vorlage — die Anti-Ankuendigungs-Formulierung ist still ersetzt. Oder ein Agenten-Neuanlage/Reset stellt use_llm_generated_message/max_soft_timeouts auf Anbieter-Defaults zurueck, der Filler-Mechanismus kommt hochgedreht. drift wurde seit Monaten nicht gefahren (manuell, kein CI); [el-b1] meldet, aber untergeht (R5). | O2 zur Pflicht: Regeln NUR ueber Vorlage + elevenlabs:push (Ruecklese); Pin-Erweiterung use_llm_generated_message/max_soft_timeouts_per_generation (Owner-Entscheidung 4, Empfehlung ja); AS6 dokumentiert drift exit 0 NACH Push; ST5 schreibt die Lehre "Dashboard schlaegt ungepinntes Repo" in lessons.md | entschaerft — Restrisiko "drift-Lauf bleibt Manuelles" bewusst akzeptiert; nur besessene Felder sind bewacht, das ist die eingetauschte Sicherung |
| R3 | B1-Regel macht den Agenten steif/abgehackt ("Turbo-Responder"); Stimm-Qualitaet sinkt unbemerkt, weil nur Kuerze und Negative gezaehlt werden | "The very next sentence IS the content" wirkt ueber: komplexe Fragen werden einsilbig beantwortet, keine natuerlichen Uebergaenge, Werkzeuge ohne jede Anmuendung. Die Kuerze-Metrik (Sprechzeit, Kosten je Anruf) SINKT erfreulich — AS10 zaehlt nur Marken=0 und B1 ungemeldet, niemand hoert zu. Abbruchquote steigt leise; ein Jahr spaeter gilt der Agent als "effizient, aber unangenehm". | Carve-out im Regeltext (in O1 enthalten: ankuedndigen nur "while a tool call or a wait is actually happening"); ST4 erweitern: Owner HOERT den Verifikationsanruf, Urteil (natuerlicher Uebergang?) als Notiz ins Befund-Doc und Gruen-Bedingung fuer AS10; klingt es steif -> Regeltext abschwaechen, NICHT die Messung umbauen | entschaerft — Hoer-Urteil ist bewusst subjektiv und dokumentationspflichtig; bleibt der einzige nicht-deterministische Gate-Anteil |
| R4 | Regression bleibt unentdeckt: kein Test pinnt Regeln, Detektoren oder Pinning | Die Kette stockt nach ST2 (Prompt gepusht, Detektoren nie gebaut); AS2-AS11 bleiben rot, test:abnahme wird nie gefahren. Ein spaeterer Refactor verschiebt speechRules — ohne Tests still. Oder: Kriterien wurden gruen, wanderten aus, die Ausgewanderten-Zahl sinkt unbemerkt. | Jedes Kriterium deterministisch fixture-basiert (bestehender Plan); die Vorfalls-Fixture fuer AS7 entsteht in ST3 aus dem ORIGINALEN anonymisierten Vorfalls-Transkript (conv_0501...) — nicht aus dem ST4-Verifikationsanruf, der per Definition sauber ist und die Positiv-Erwartung (Marke [froehlich], B1 1x) nie liefern kann; AS8 bleibt bei Anruf-7/8-Clean-Fixtures, die AS10-Fixture kommt aus dem ST4-Anruf; Ausgewanderten-Mechanik (npm test) haelt gewordene Gruen automatisch fest | entschaerft — Live-Seite (drift gegen das echte Konto) bleibt ohne CI; akzeptiert, weil Netz+EL-Key im CI nicht vorgesehen sind (Bestandsentscheidung) |
| R5 | [el-b1]-Heuristik feuert auf jedem zweiten Anruf: Betriebsrauschen, Alarm-Blindheit | Breite Cues: natuerliche Wiederholungen (Rueckfrage, Abschluss-Zusammenfassung) feuern dauernd. Ops gewoehnt sich an [el-b1]-Zeilen; als der naechste ECHTE B2-Rueckfall kommt, geht [el-tags] im Rauschen unter — der Art.-50-Sensor ist wirkungslos, genau der Schaden, den MELDEN verhindern sollte. | Heuristik eng fuehren (Lexem-Overlap-Schwelle, nur UNMITTELBAR aufeinanderfolgende Saetze, dokumentierte Toleranz); AS8-Gegenprobe an sauberen Echtfall-Fixtures ab Tag 1; Zaehlfeld macht die Rate messbar (B1-Treffer/Anrufe); Rueckbau-Kriterium: dominiert [el-b1] das Log -> Detaillierung duenner, NIE abstellen | entschaerft — False-Positive-Rest bewusst akzeptiert (Owner-Entscheidung 5), aber sichtbar und zaehlbar statt Log-Zufall |
| R6 | soft_timeout-Override zu steil: hoerbare Stille statt Bruecke | Der neue Filler-Text ("Do NOT name, introduce or announce the content", 6-8 Woerter) ist so bland, dass er keine Bruecke mehr ist. Bei Denkpausen von 2-4 s hoert der Angerufene Stille, haengt ein, unterbricht. B1 ist weg — dafuer ein NEUES Qualitaetsproblem, das kein Sensor sieht; niemand hat die B1-Hypothese je geklaert, also weiss auch niemand, ob der Filler ueberhaupt die Quelle war. | ST0 klaert ZUERST die Filler-Hypothese (Mitschnitt-Testanruf/EL-Support) — nur dann ist der neue Text ueberhaupt begruendet; Text behaelt "natural acknowledgement that you are working on the answer" (beruhigt statt schweigt); max_soft_timeouts_per_generation=1 gepinnt (kein Filler-Staccato); Hoer-Urteil in ST4 deckt Stille-Wahrnehmung mit ab | entschaerft — O4(d) (Filler ganz aus) bewusst ABGELEHNT: Stille ist fuer den Angerufenen schlechter und schlechter messbar als eine blasse Bruecke |
| R7 | ST2-Push dreht im Vorbeigehen Stimme/Konfig fuer ALLE Anrufe (Erlaubnis-Karten-Falle, Vorlage-Hinweis conversation_config_override_erlaubnisse) | Der Push patcht besessene Felder; die SOLL-Erlaubnis-Karte (tts.voice_id=true, text_only=false) trifft auf einen Live-Agenten, dessen Karte inzwischen anders steht — derselbe Push setzt die Stimme aller Anrufe zurueck oder oeffnet text_only. Lautlos; die Ruecklese meldet nur "Patch = Vorhersage", und die Vorhersage basierte auf der ueberholten Karte. | Reihenfolge-Pflicht: FRISCHER drift-Lauf unmittelbar vor dem Push, der die LIVE-Erlaubnis-Karte lesend belegt (Vorlage: "VOR dem naechsten Push ist der Live-Stand dieser Karte LESEND zu belegen", Runbook 8.3/1b); bei Abweichung anhalten, Karte in die Vorlage nachziehen, erst dann pushen; nach Push zweiter drift-Lauf (AS6) | entschaerft — Falle ist in der Vorlage dokumentiert und wird Phasen-Bedingung von ST2 statt Stubeglaube |
| R8 | Transkript-/PII-Leak durch Fixture oder Detektor-Logs | AS7 (Vorfalls-Transkript) und AS10 (Verifikations-Transkript) pinnen Transkript-Ausschnitte als Fixture ins Git — mit echtem Namen/Nummer des Angerufenen. Und [el-b1] loggt die verdaechtigen VOLLSAETZE ins Render-Log (30 Tage abrufbar) — Transkript-PII an zweiter Stelle, ausserhalb des Art.-50-gesicherten Call-Datensatzes. | Fixture nur anonymisiert (Nummern maskiert, Eigennamen entfernt — Bestandsmuster Anruf-6-Fixture pruefen und gleich behandeln), deterministisch gepinnt in AS7 UND AS10 (Nummern-/Eigennamen-Grep); [el-b1] loggt NUR Trefferzahl/Cues/Zeilenindizes, keine Vollsaetze — als AS7-Erweiterung deterministisch gepinnt | vermeiden — kein bewusst akzeptiertes Restrisiko; das gespeicherte Transkript selbst bleibt unveraendert (Art. 50) |
| R9 | Pin-Erweiterung verengt Dashboard-Freiheit: Reibung bei jeder beabsichtigten Aenderung (O2-Nachteil) | Der Owner will den Filler abschalten oder 2 Soft-Timeouts erlauben — drift meldet Abweichung, niemand erinnert, dass SOLL NUR in der Vorlage geaendert wird; jemand "fixt" die Abweichung per Push zurueck und macht die beabsichtigte Aenderung ungewollt rueckgaengig. Vertrauen in die Bewachung sinkt, der naechste Pin wird verweigert. | Pin-Eintraege tragen _hinweis mit Begruendung UND Aenderungsweg ("SOLL aendern NUR hier, dann pushen"); ST5-Lehre formuliert die Regel beidseitig: gepinnte Felder sind Wahrheit, Aenderung geht durch die Vorlage, nie am Dashboard vorbei | akzeptiert — bewusster Tausch Dashboard-Freiheit gegen Bewachbarkeit; dokumentiert, damit der Konflikt beim ersten Auftritt als bekannt wiedererkannt wird |
| R10 | O4-Hebel zu frueh gezogen: expressive_mode aus / ignore_default_personality true verschlechtert die STIMME (gegen das Ziel des Plans) | Nach dem naechsten einzelnen Rueckfall wird expressive_mode HART ausgeschaltet (Escalations-Schwelle ueberinterpretiert) — die Stimme ist flacher, B2 ist weg, aber der Agent klingt mechanisch; ignore_default_personality true nimmt einen Layer, der auch Sympathie trug. Kein A/B-Messstand existierte; die Aenderung blieb ungemessen, weil "keine Marken" als Erfolg zaehlte. | O4(b)/(c) nur auf MESSUNG hin (A/B-Testanrufe in ST4, Empfehlung im Doc); Escalations-Schwelle ausformulieren: ein Rueckfall NACH O1/O2-Push -> expressive_mode aus, aber MIT anschliessendem Hoer-Vergleich (nicht blind); jede O4-Schaltung ins Befund-Doc mit Vorher/Nachher | entschaerft — Hebel bleiben Owner-Entscheidungen mit Messpflicht; Restrisiko "ein Rueckfall erzeugt Druck zur Schnellschaltung" durch die dokumentierte Schwelle gebunden |

Rueckfluss in den Phasenplan: R1 -> ST1 (AS2-Erweiterung, Insert-Disziplin), R2/R7/R9 -> ST0
(Erlaubnis-Karte) + ST2 (Reihenfolge-Pflicht, Hinweis-Pflicht) + ST5, R3/R6/R8 -> ST3
(Log-Umfang, anonymisierte Vorfalls-Fixture in AS7) + ST4 (Hoer-Urteil, anonymisierte
Verifikations-Fixture in AS10), R4 -> Bestandsmechanik der Abnahme-Baenke (Vorfalls-Fixture
aus dem Original-Transkript, nicht aus ST4), R5 -> ST3 (enge Heuristik + Zaehlfeld-Rate).

## Offene Owner-Entscheidungen

Entscheidungsstand: ALLE 7 entschieden am 2026-09-02 durch den Owner (jeweils im Sinne der
Doc-Empfehlung). ST0-Start ausdruecklich NICHT freigegeben ("noch nicht") - die Kette startet
auf Kommando; bis dahin passiert nichts.

1. **B1-Filler-Hypothese klaeren:** Audio-Mitschnitt-Testanruf (eigene Nummer, billig,
   deterministisch auswertbar) vs. EL-Support-Ticket vs. unbeachtet lassen.
   Empfehlung: Mitschnitt-Testanruf in ST0.
   **Entscheidung 2026-09-02 (Owner): Mitschnitt-Testanruf** - in ST0, auf die eigene
   Nummer; Auswertung ueber Sprechpausen/Stimmwechsel im Mitschnitt.
2. **`tts.expressive_mode`:** anlassen (Stimm-Qualitaet) mit Escalations-Schwelle "ein
   Rueckfall nach O1/O2-Push -> aus" vs. sofort aus. Empfehlung: anlassen mit Schwelle.
   **Entscheidung 2026-09-02 (Owner): anlassen mit Escalations-Schwelle** - ein Rueckfall
   nach dem O1/O2-Push schaltet aus, MIT anschliessendem Hoer-Vergleich (R10), nie blind.
3. **`ignore_default_personality`:** unbekannter Layer vs. Kuerze-Disziplin.
   Empfehlung: in ST4 per A/B-Testanrufen messen, dann entscheiden; nicht blind schalten.
   **Entscheidung 2026-09-02 (Owner): in ST4 per A/B-Testanrufen messen** - Schaltung nur
   auf Messung hin.
4. **Pin-Umfang:** minimale Erweiterung (`use_llm_generated_message`,
   `max_soft_timeouts_per_generation`) vs. Pin nur Bestandsfelder. Empfehlung: minimale
   Erweiterung — der Filler-Mechanismus ist die einzige live belegte B1-Gegenquelle.
   **Entscheidung 2026-09-02 (Owner): minimal erweitern** - beide Felder kommen in den Pin
   (ST2), mit _hinweis und Aenderungsweg ueber die Vorlage (R9).
5. **B1-Detektor-Unschaerfe akzeptieren:** Heuristik mit False-Positives vs. verzichten.
   Empfehlung: akzeptieren, NUR Diagnose, mit Gegenprobe-Pflicht (AS8) ab Tag 1.
   **Entscheidung 2026-09-02 (Owner): akzeptieren** - enge Heuristik, NUR Diagnose,
   Gegenprobe-Pflicht ab Tag 1; keine Transkript-Aenderung (Art. 50).
6. **Zaehlfeld am Call-Datensatz:** neues diagnostisches Feld (keine Transkript-Aenderung)
   vs. weiter nur Logs. Empfehlung: ja — sonst bleibt "Muster sammeln" Log-Zufall.
   **Entscheidung 2026-09-02 (Owner): einfuehren** - diagnostisches Zaehlfeld fuer
   [el-tags]/[el-b1] am Call-Datensatz (ST3); Transkript bleibt unveraendert.
7. **(Nur adjacent, nicht Teil dieses Plans):** Pruefen, ob `agent.first_message` am
   Live-Agenten fuer Overrides freigeschaltet ist (Owner-Eroeffnung koennte still wirkungslos
   sein). Gehoert zur OC-Kette (PLAN-OWNER-CALL); Wortlaut unangetastet.
   **Entscheidung 2026-09-02 (Owner): in ST0 mitlesen** - der frische Drift-Lauf liest die
   LIVE-Erlaubnis-Karte sowieso (R7-Massnahme) und dokumentiert den first_message-Status
   gleich mit; inhaltliche Weiterverfolgung bleibt in der OC-Kette (PLAN-OWNER-CALL),
   Wortlaut unangetastet.

## ST0-Ergebnisse (2026-09-03, Nachtrag zur Umsetzung)

Alle Belege und Messwerte: tasks/EL-STIMME-BEFUNDE.md. Kompakt:

- **Forensik-Luecken geschlossen:**
  - **B1-Filler-Hypothese WIDERLEGT** am Original-Vorfalls-Audio (urteil
    eine-generation; Grenzpause 0,33 s UNTER Baseline-Median 0,58 s, kein
    Pegel-/Spektralsprung an der Satz1/Satz2-Kante, Frueheinsatz-Fenster 19,5-20,7 s
    reine Stille; Luecke vollstaendig durch 0,512 s Initiierung + 2,067 s LLM-TTFB +
    0,143 s TTS-TTFB erklaert — Turn-Initiierung VOR der 2,0-s-Schwelle). B1-Satz 1
    ist echter claude-sonnet-5-Text. O1a (soft_timeout-Umformulierung) bleibt —
    Begruendung verschiebt sich auf "Gegen-Instruktion im besessenen Feld entfernen"
    (Fehlerfamilie Befund 3), nicht "Filler-Quelle des Vorfalls entschaeerfen".
  - **first_message-Erlaubnis: LIVE freigeschaltet** (TRUE, = Vorlagen-SOLL NACHTRAG
    OC-P2). Entscheidung 7 erledigt; Weiterverfolgung des Wortlauts bleibt OC-Kette.
  - **[el-tags]-30-Tage-Frage:** Render-Retention betraegt nur 7 Tage; im
    beobachtbaren Fenster (ab 27.08.) **3 Treffer** ([freundlich] 30.08.
    call_mtfm5ss7g3jz; [freundlich] 02.09. call_mtjsvfkpuzm8; [froehlich] 02.09.
    call_mtka4kunn0qy); **3/3** der seit 30.08. log-sichtbaren Outbound-Anrufe
    betroffen; verlaessliche Quote pro Anruf erst mit ST3-Zaehlfeld messbar. Der
    19.08.-Fall ist logseitlich nicht verifizierbar (evicted).
  - **Live-Konfig SOLL-identisch** an allen 4 Tag-Quellen (suggested_audio_tags leer,
    Soft-Timeout-Texte klammerfrei, llm-Override mit Bracket-Verbot) — B2-Wurzel ist
    prompt-/modellseitig, O1 gestuetzt. R7-Falle (voice_id/text_only) entkraeftet.
- **Neue Owner-Entscheidungen 2026-09-03** (je im Sinne der Lead-Empfehlung):
  8. **ST0-Mitschnitt-Testanruf UEBERSPRUNGEN** — die Primaerfrage ist am
     Original-Audio beantwortet (staerkere Evidenz als jede Reproduktion); der
     ST4-Verifikationsanruf misst die neuen Regeln nach dem Push live.
  10. **Kein Testanruf / Kettenschutz ohne Verifikationsanruf (2026-09-04):** Der
      ST4-Verifikationsanruf und die A/B-Messanrufe wurden ausdruecklich NICHT
      durchgefuehrt (Owner-Anordnung: "den testanruf mach ich nicht"; keine
      Begruendung erfragt). AS10 bleibt bewusst ROT und nachholbar (Protokoll
      ST0-3), A/B entfaellt bis auf Widerruf, Schaltungen bleiben beim Ist (R10).
      Der Deploy (4368c00) mit Detektoren + Zaehlfeld ist trotzdem live.
  9. **Erlaubnis-Karte: die 2 LIVE-only Schluessel** (tts.supported_voices,
     turn.soft_timeout_config.additional_soft_timeout_messages, beide false) **kommen
     in die Vorlage** (SOLL erweitern; kein Verhalten geaendert, kein Push dafuer
     noetig) — Erledigung in ST2 zusammen mit der Pin-Erweiterung; AS6 damit
     erreichbar.
- Offen (ST2-vorgelaegig, technisch, keine Owner-Frage): Push-Semantik der Karte am
  eigenen Push-Skript-Code verifizieren (es patcht nur abweichende besessene Pfade).
