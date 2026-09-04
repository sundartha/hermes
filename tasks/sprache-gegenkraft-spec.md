# Sprach-Gegenkraft: SP1 (Vorlage + Tests) und SP2 (Push-Werkzeug) — Spec, 2026-09-04

## Befund (gilt als BELEGT, nicht neu erheben — Details `tasks/UEBERGABE-SPRACHDEFEKT.md`, Nachtrag 1+2)

Die Echtzeit-Spracherkennung von ElevenLabs (Scribe v2 Realtime) erzeugt intermittierend
PHANTOM-User-Turns aus einem leisen Signal der Gegenseite, ohne dass der Angerufene spricht
(Audio: Stille; 03.09. "Wie?"/"Wie sind?", 04.09. "No. ¿Sí está ahí?" bei t=2 WAEHREND der
Eroeffnung; im August "..." und "Und ."). Das ist seit Mitte August nachweisbar und korreliert
mit KEINER Aenderung an Code, Agent-Version, Payload oder Telco-Route. Am 04.09. 12:37 wurde
daraus ein spanisches Gespraech, weil UNSERE Konfiguration ein Phantom ungebremst in einen
Sprachwechsel verwandelt:

1. `agent.disable_first_message_interruptions=true` + `turn.transcribe_on_disabled_interruptions=true`:
   was waehrend der Eroeffnung "gehoert" wird, unterbricht nicht, landet aber als User-Turn beim Modell.
2. Prompt-Regel (E-5, seit 2026-08-14): "Begin the call in English. If the other party switches to
   another language, continue in that language and keep pursuing the same objective." — Wechsel
   ohne Schwelle, ein einzelner Turn genuegt.
3. `language_detection` (bleibt!) verriegelt danach Erkennung und Stimme auf die neue Sprache.

## Ziel (Eigentuemer-Entscheidung 2026-09-04, bindend)

Flexibel bleiben: die Gegenseite DARF eine andere Sprache waehlen. Aber kein Wechsel durch einen
einzelnen Fehlhoerer. Die Schwelle heisst BESTAETIGUNG: bei Verdacht einmal kurz zweisprachig
nachfragen, erst nach Bestaetigung in der anderen Sprache wechseln. Ein einzelnes Wort, ein
Fragment oder etwas Unklares ist nie ein Grund fuer einen Wechsel — und auch nicht fuer einen
Kommentar zur Verbindungsqualitaet (03.09.: "Entschuldige, die Verbindung war kurz schlecht").

## Nicht-Ziele (SCOPE, Absolute Regel 6)

- KEIN Server-Code, KEIN Deploy, KEINE neue dynamische Variable (die Regel braucht keine).
- KEIN Push an den Live-Agenten durch einen Agenten oder Workflow. `scripts/push-elevenlabs.mjs`
  ist fuer Agenten in JEDER Aufrufform gesperrt (Sandbox). Den Push faehrt der Eigentuemer.
- `language_detection` bleibt aktiv, `only_at_conversation_start` bleibt unveraendert (false).
- `disable_first_message_interruptions` bleibt `true` (Artikel 50, dritte Stelle).
- Voicemail-Text (DE1, `{{voicemail_line}}`) bleibt wie gemergt.
- Keine Aenderung an Presets, Werkzeug-Karte (`tools`), Stimme, LLM.

## SP1 — Gegenkraft in der Vorlage (`elevenlabs/agent_configs/outbound-agent.template.json`) + Tests

### SP1-A Prompt-Regel (Pfad `agent.conversation_config.agent.prompt.prompt`, Block `HOW YOU SPEAK`)

GENAU die zwei Saetze
`Begin the call in English. If the other party switches to another language, continue in that language and keep pursuing the same objective.`
werden ersetzt durch diesen Wortlaut (bindend, englisch, ohne eckige Klammern):

`Speak the language of your opening message and keep it for the whole call. If the other party appears to use a different language, ask once, briefly and in both languages, whether they would prefer that language; switch only after they confirm in that language, and keep pursuing the same objective. A single word, a fragment or anything unclear is never a reason to switch the language or to comment on the connection - briefly repeat your last question instead.`

Der Rest des Blocks (kurze Antworten, hoefliche Anrede, Zahlen) bleibt byte-identisch.
Vorlagen-Doku-Schluessel, die E-5 als "Startsprache fest englisch" beschreiben
(`_sprachumstellung_hinweis`, `_prompt_grundlage_hinweis`, ggf. weitere mit "E-5"), bekommen
einen kurzen Nachtrag "E-5b (2026-09-04): Wechsel nur nach Bestaetigung; Grund Phantom-Turns,
s. tasks/UEBERGABE-SPRACHDEFEKT.md" — keine Umlaute, kein Roman.

### SP1-B Turn-Schalter

`agent.conversation_config.turn.transcribe_on_disabled_interruptions`: `true` -> `false`.
Bewusste Umkehr der Entscheidung vom 2026-08-18 (Test EL-START T5 (f), "haelt fest, was die
Gegenstelle waehrend des gesperrten Zuges sagt"). Neuer Zweck: was waehrend der gesperrten
Eroeffnung ankommt, erreicht das Modell NICHT — dort entstand das Phantom vom 04.09. (t=2).
Preis, akzeptiert: ein echtes "Hallo?"/"Kein Interesse" waehrend der Offenlegung geht verloren;
das Modell haette darauf ohnehin erst nach der Eroeffnung reagieren koennen.
Der Besitz-Eintrag `transcribe_on_disabled_interruptions` in `_besitz.felder` bleibt (Drift-Waechter),
der Doku-Schluessel `_offenlegung_unterbrechung_hinweis` wird nachgezogen.
`disable_first_message_interruptions` bleibt `true` — unveraendert, weiter gepinnt.

### SP1-C Tests (Pflicht, Regressionsbahn `npm test`)

1. `test/elevenlabs-agent-werkzeuge.test.js`, Test "der Prompt setzt die Startsprache, gibt den
   Wechsel frei und verlangt keinen Rueckwechsel": auf die NEUE Invariante umpinnen, gleiche
   Bauart (Konzept-Mengen je Satz, Positiv-/Negativ-Kontrollen am Messwerkzeug, nicht am Wortlaut).
   - REQUIRED (je in EINEM Satz): (a) Startsprache = Sprache der Eroeffnung (`opening message` +
     `language`); (b) Wechsel nur nach Bestaetigung (Wechsel-Verb + `confirm`); (c) einzelnes Wort/
     Fragment/Unklares ist kein Wechselgrund (`single word|fragment|unclear` + Negation + Wechsel-Verb);
     (d) dasselbe Ziel bleibt (unveraendert).
   - FORBIDDEN: (1) Sprach-Sperre ohne Wechselweg ("Speak only in this language: {{language}}",
     `LOCK_SENTENCE` bleibt verboten); (2) Wechsel-Verbot ohne Bestaetigungsweg ("Never switch the
     language during the call."); (3) Rueckwechsel-Pflicht ("...return to English right after.");
     (4) NEU: bedingungsloses Mitgehen ("If the other party switches to another language, continue
     in that language." — die alte E-5-Regel). Ein Satz mit Wechsel-Verb + Folge-Verb + `language`
     OHNE `confirm` ist verboten.
   - CONTROL_OK muss eine PARAPHRASE des neuen Wortlauts sein (nicht der Wortlaut selbst), damit die
     Zusicherungen am Kern und nicht am Text kleben. CONTROL_VIOLATIONS = die vier Saetze oben.
   - Der Test "language_detection gilt den ganzen Anruf" bleibt unveraendert gruen.
2. `test/elevenlabs-anrufstart.test.js`, EL-START T5 (f): `OFFENLEGUNG_UNTERBRECHUNG` pinnt
   `disable_first_message_interruptions` weiter auf `true` und `transcribe_on_disabled_interruptions`
   NEU auf `false` (je Eintrag ein SOLL-Wert statt eines gemeinsamen `true`), mit neuem `zweck`-Text
   und Verweis auf die Uebergabe. Besitz-Pruefung bleibt.
3. Kein Test wird geloescht; jeder geaenderte Test bleibt ein Waechter (Rotprobe: alter Wortlaut in
   der Vorlage -> rot; `true` beim Turn-Schalter -> rot). Die Rotproben im Report belegen, nicht
   behaupten.

### SP1 Nachweis (deterministisch)

- `node -e 'JSON.parse(require("fs").readFileSync("elevenlabs/agent_configs/outbound-agent.template.json","utf8"))'` -> Exit 0.
- `npm test` gruen (Stand vor SP1: 5686 pass; Anzahl darf sich durch umgepinnte Tests aendern,
  sinken nur mit Begruendung im Report). `npm run lint` -> 0 errors.
- `npm run elevenlabs:check` gruen, falls es offline laeuft (Plan prueft, was es tut).
- NICHT durch Agenten: Trockenlauf `npm run elevenlabs:push -- --felder=prompt,transcribe_on_disabled_interruptions`
  (Eigentuemer). Erwartet: PATCH-Koerper mit genau den zwei Blatt-Pfaden
  `conversation_config.agent.prompt.prompt` und `conversation_config.turn.transcribe_on_disabled_interruptions`.

## SP2 — Push-Werkzeug sendet Werkzeug-Objekte vollstaendig (`scripts/push-elevenlabs.mjs` + Vorlage + Tests)

### Problem (am Anbieter gemessen, 2026-09-04)

`npm run elevenlabs:push -- --felder=voicemail_message --ausfuehren` bricht ab:
`HTTP 400 ... "Field required", param: agent.prompt.built_in_tools.voicemail_detection.name`.
Der Anbieter ERSETZT beim PATCH das Werkzeug-Objekt (Dict) statt zu mergen; unser Koerper traegt
nur den Blattpfad `...voicemail_detection.params.voicemail_message`. Folge: KEIN Werkzeug-Feld
ist heute pushbar — der DE1-Voicemail-Text (`{{voicemail_line}}`) haengt daran.

### Loesung (kleinster Eingriff, bestehender Mechanismus)

Der Schreibweg `schreibweg: "je_schluessel"` existiert bereits (Besitz-Eintrag
`language_presets_offenlegung`): die ganze Sammlung wird aus LIVE geklont und NUR die besessenen
Blaetter bekommen den Vorlagenwert; Schluessel nur live -> Abbruch, nie stilles Loeschen.
Genau das braucht `voicemail_message`: der Besitz-Eintrag wird ein Sammlungs-Eintrag ueber
`built_in_tools` (vorlage `agent.conversation_config.agent.prompt.built_in_tools`, live
`conversation_config.agent.prompt.built_in_tools`) mit `je_eintrag: "params.voicemail_message"`,
`schreibweg: "je_schluessel"`, `schreibweg_besitz: ["params.voicemail_message"]`. Der PATCH-Koerper
traegt dann das VOLLSTAENDIGE Live-Dict aller eingebauten Werkzeuge (`name`, `type`, alle
nicht-besessenen `params` unveraendert), nur `voicemail_detection.params.voicemail_message` ersetzt.
Traegt die Vergleichs-Art `texte` ein Blatt, das nur an EINEM Eintrag existiert
(voicemail_detection hat es, end_call nicht), noch nicht sauber (fehlt auf beiden Seiten = gleich;
fehlt in der Vorlage = nicht besessen, bleibt live), dann ist DAS die minimale Erweiterung — keine
neue Schreibart, kein zweiter Koerper-Bau.

### Harte Vorgaben SP2

- Die SIEBEN RIEGEL im Skriptkopf bleiben unangetastet: gesperrte Felder, kein blinder Passagier
  (jeder Blattpfad des Koerpers liegt unter dem erlaubten Pfad — der erlaubte Pfad ist jetzt die
  Sammlung `...built_in_tools`), nur benannte Felder, Trockenlauf-Default, Vorhersage
  (`simuliereSchreiben`) muss NULL unerwartete Abweichungen melden.
- `check-elevenlabs-drift.mjs` meldet `voicemail_message`-Drift weiterhin in beide Richtungen.
- Der Besitz-Eintrag `dynamic_variables` (liest Platzhalter u.a. aus dem Voicemail-Pfad) und
  `test/el-vorlage-variablen-abgleich.test.js` bleiben gruen.
- Kein Netz in Tests. Fixture: synthetische Live-Form (end_call, language_detection mit
  `params.only_at_conversation_start`, voicemail_detection mit `name`, `type`, `params.system_tool_type`,
  `params.voicemail_message`) — KEINE Kopie der Live-Config, keine PII.

### SP2 Tests (Pflicht)

`test/elevenlabs-push-zusammenfuehrung.test.js` (erweitern, Bestandsmuster): (1) Koerper enthaelt ALLE
Werkzeuge der Live-Sammlung; (2) `name`/`type`/nicht-besessene `params` byte-identisch zu live;
(3) nur `voicemail_detection.params.voicemail_message` traegt den Vorlagenwert; (4) Werkzeug nur live
-> Abbruch mit der bestehenden Meldung; (5) Blattpfad-Riegel: alle Koerper-Pfade liegen unter dem
erlaubten Sammlungs-Pfad; (6) Vorhersage nach dem simulierten Schreiben: `voicemail_message` gruen,
nichts sonst rot. Drift-Test fuer die Vergleichsseite, falls die Art erweitert wird.

### SP2 Nachweis

- `npm test` gruen, `npm run lint` 0 errors.
- NICHT durch Agenten: Trockenlauf `npm run elevenlabs:push -- --felder=voicemail_message`
  (Eigentuemer): PATCH-Koerper zeigt `conversation_config.agent.prompt.built_in_tools.<jedes Werkzeug>...`,
  danach `--ausfuehren` ohne HTTP 400, Drift danach gruen.

## Reihenfolge nach dem Merge (Eigentuemer, ZWINGEND)

1. Push `prompt` + `transcribe_on_disabled_interruptions` (SP1; kein Server-Bezug).
2. Push `voicemail_message` (SP2; Server DE1 ist live, `{{voicemail_line}}` wird aufgeloest).
3. Zwei echte Testanrufe, Gespraechspfad und Mailboxpfad getrennt. Erwartet: kein
   `language_detection`-Aufruf ohne Bestaetigung, Sprache durchgehend deutsch, Mailbox-Text deutsch
   und beginnend mit `LOCALES.de.disclosure`. Abnahme NUR am Anruf.

## Pre-Mortem (benannt, akzeptiert)

- Echter Fremdsprachler bekommt eine Rueckfrage mehr (ein Turn). Akzeptiert.
- Ein Phantom koennte die Rueckfrage "bestaetigen": die Regel verlangt die Bestaetigung IN der
  anderen Sprache; ein Fragment reicht nicht. Restrisiko akzeptiert, Anruf-Abnahme prueft es.
- SP1-B verwirft echte Rede waehrend der Offenlegung. Akzeptiert (s. o.).
- Push-Reihenfolge falsch (voicemail vor Server): nicht moeglich, Server ist bereits live.
- SP2 sendet ein ganzes Dict: ein Fehler dort koennte Werkzeuge loeschen. Gegenkraft: "nur live ->
  Abbruch", Vorhersage, Trockenlauf-Default, Test (1)/(2).
