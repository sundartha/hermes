# GQ-B1 Entwurf: place_call-Briefing und Tempo (Track B)

Grundlage: `tasks/gq-transkript-befunde-2026-08-19.md`, Befund B (1-3) und die Owner-Ziele.
Dieser Entwurf aendert KEINEN Code - er spezifiziert genau, was ein Implementierungs-Agent
aendert. Alles unten Behauptete ist am gelesenen Code belegt (Datei:Zeile).

## 0. Gelesener Code (Belegstellen)

| Ort | Was dort steht |
|---|---|
| `src/mcp-tools.js:578-582` | `objective`-Beschreibung, enthaelt "if the topic or preference is still unknown, ask the user FIRST" |
| `src/mcp-tools.js:583-588` | `briefing`-Beschreibung - erwaehnt den Rueckfrage-Kanal mit KEINEM Wort |
| `src/mcp-tools.js:599-606` | `mandate.decide_freely` - zweite "Ask the user FIRST"-Anweisung |
| `src/mcp-tools.js:440-452` | `PLACE_CALL_DESCRIPTION` + der NUR bei aktivem Kanal angehaengte `PLACE_CALL_CONSULT_LOOP` |
| `src/mcp-tools.js:431-436, 646` | `open_questions` ist im zod-Schema deklariert, erreicht den Server also |
| `src/mcp-tools.js:753-762` | `answer_consult`-Beschreibung ("if you do not know, ask the user FIRST") - IM Gespraech, korrekt |
| `src/mcp-server-info.js:75-82` | `MCP_CONSULT_INSTRUCTIONS` (ServerOptions.instructions, gesetzt in `routes/mcp.js`) |
| `src/consult/gate.js:19-25` | Kanal-Schnittmenge: Master-Schalter x Kontext-Kanal x `profile.allowConsult`, fail-closed |
| `src/consult/in-call.js:48` | `MAX_IN_CALL_CONSULTS_PER_CALL = 1` - hoechstens EINE Rueckfrage je Gespraech |
| `src/routes/webhooks-elevenlabs.js:269-274` | der EL-Weg liest denselben Riegel (`consultQuotaUsed < 1`) |
| `src/store/state-ops.js:1202-1204, 1153` | Consult #0 (Klingelzeit) traegt KEIN Kontingent, nur In-Call-Consults zaehlen |
| `src/routes/api-calls.js:145-151, 281, 290-291` | `emitOpeningConsult` feuert unmittelbar vor `originateElevenLabsCall` |
| `src/elevenlabs/outbound.js:547-559, 744-762` | `backgroundText` setzt BRIEFING als erste Zeile des `{{background}}`-Blocks; `dynamicVariables` wird EINMAL beim Waehlen gebaut |
| `elevenlabs/agent_configs/outbound-agent.template.json`, Prompt-Abschnitte `IF SOMETHING IS UNCLEAR` / `CONSULT TOOL` | "NEVER offer {{owner_name}} as another way to get that answer" und "DO NOT CALL IT FOR: anything already written in your task, background, constraints or mandate" |

## 1. Wurzelursache (Befund B)

Das Briefing reist als erste Zeile des `{{background}}`-Blocks in den Agenten-Prompt
(`outbound.js:547-559`), und derselbe Prompt verbietet `get_consult` fuer "anything already
written in your ... background". Damit ist jede Zeile, die eine Wissensluecke im Voraus
beantwortet, zugleich die Abschaltung des Live-Rueckfrage-Kanals fuer genau diese Luecke -
und die `briefing`-Feldbeschreibung (`mcp-tools.js:583-588`) sagt dem auftraggebenden Claude
nichts davon, sie verlangt nur "relevanten Kontext". Ein hilfsbereites Modell fuellt eine
Luecke deshalb natuerlicherweise mit einer Vertroestung ("Antonio meldet sich dazu direkt"),
die zusaetzlich gegen das ausdrueckliche Prompt-Verbot "NEVER offer {{owner_name}} as another
way" verstoesst - das Briefing ueberstimmt den Prompt, weil es konkreter und
auftragsspezifisch ist. Der zweite Teil des Befunds hat dieselbe Wurzel von der anderen
Seite: die Feldbeschreibungen kennen fuer Unbekanntes nur EINEN Ausgang, die Vorab-Rueckfrage
im Chat ("ask the user FIRST", zweimal: `objective` und `mandate.decide_freely`) - "offen
lassen" ist als Option nirgends benannt, also kostet jede Unklarheit entweder eine
Chat-Runde oder eine erfundene Zeile im Briefing.

## 2. Optionen

### Option A - nur die Texte: Verbot im Briefing, Verweis am aktiven Kanal, Vorab-Rueckfrage verengen

Vier Textaenderungen (`briefing`, `objective`, `mandate.decide_freely`,
`PLACE_CALL_CONSULT_LOOP`) plus ein Satz in den Server-Instructions. Kein Laufzeitpfad,
keine Gate-Logik, keine neue API-Flaeche.

- **Dafuer:** vollstaendig statisch belegbar (die Beschreibungen sind reine
  Client-Metadaten, es gibt bereits eine Test-Mechanik dafuer:
  `test/p15-mcp-tool-descriptions-en.test.js`, `test/place-call-context-bridge.test.js`).
  Wirkt an genau dem Punkt, an dem der Defekt entsteht (dort, wo das Briefing GESCHRIEBEN
  wird), nicht dort, wo er sichtbar wird. Repo-Lehre: enge Verbote an der
  Tool-Beschreibung wirken, wo breite Prompt-Regeln kippen (`mcp-tools.js:443-445`).
- **Dagegen:** Beschreibungen sind advisory - es gibt keine Durchsetzung. Jedes Zeichen
  kostet bei JEDEM Claude-Turn Token. Ob das Modell folgt, zeigt erst ein Testanruf.

### Option B - serverseitiger Riegel gegen Vertroestungen

`/api/calls` prueft `briefing` gegen ein Muster ("meldet sich", "will get back to you", ...)
und lehnt ab oder streicht die Zeile.

- **Dafuer:** wirkt unabhaengig vom Wohlverhalten des Modells.
- **Dagegen:** Musterabgleich auf Freitext in jeder unterstuetzten Sprache - die Textmenge
  ist unbegrenzt, das Muster nie vollstaendig; falsch-positiv streicht es echten Kontext
  (ein Auftrag KANN legitim lauten "sag ihr, ich rufe morgen selbst an"). Es waere neue
  Logik im Anrufstartpfad, also genau das, was der Auftrag ausschliesst, und es macht die
  Ablehnung fuer den Nutzer unerklaerlich. **Verworfen.**

### Option C - neues Schema-Feld fuer Unbekanntes

Ein Feld `unknowns` neben `briefing`, das der Agent nie vorgesagt bekommt.

- **Dafuer:** trennt "was ich weiss" von "was offen ist" strukturell statt per Ermahnung.
- **Dagegen:** das Feld existiert bereits - `context.open_questions`
  (`mcp-tools.js:431-436`, Server-Auswertung `routes/api-calls.js:145-151`). Ein zweites
  waere eine Dublette. Und `open_questions` traegt auf dem HEUTE LIVE laufenden Weg
  (ElevenLabs) keine Wirkung: `dynamicVariables` samt `background` wird einmalig beim
  Waehlen gebaut (`outbound.js:744-762`), `emitOpeningConsult` feuert unmittelbar davor
  (`api-calls.js:281` vs. `:290-291`) - eine Antwort, die Sekunden spaeter eintrifft,
  landet in `context.key_facts`, aber in keinem Prompt mehr. Ein Text, der Claude auf
  diesen Kanal verweist, waere auf der Live-Engine eine Zusage ohne Deckung.
  **Verworfen** (und als offener Punkt notiert, s. Abschnitt 6).

### Wahl: Option A

Sie ist die einzige Option, die den Owner-Auflagen genuegt ("nur Aenderungen, die OHNE
weitere Testanrufe belegt werden koennen") und die Wurzel trifft. B behandelt das Symptom
mit einem Werkzeug, das Freitext nicht zuverlaessig beurteilen kann; C baut eine Dublette
auf einen Kanal, der auf der Live-Engine nachweislich nicht ankommt.

**Zwei Entwurfsprinzipien, die alle Formulierungen unten binden:**

1. **Kanalabhaengige Zusagen stehen nur am kanalabhaengigen Text.** Der Rueckfrage-Kanal
   kann pro Tenant aus sein (`consult/gate.js`). Das VERBOT ("keine Vertroestung schreiben")
   gilt immer und gehoert deshalb ins `briefing`; die ZUSAGE ("der Agent fragt dich live")
   gehoert in `PLACE_CALL_CONSULT_LOOP`, der ohnehin nur bei aktivem Kanal angehaengt wird
   (`mcp-tools.js:451-452`). Andernfalls verspraeche `place_call` ein Werkzeug, das gar
   nicht registriert ist - genau die Luege, die der Kommentar an `PLACE_CALL_CONSULT_LOOP`
   bereits benennt.
2. **Praezision schlaegt Laenge.** Netto duerfen die `place_call`-Beschreibungen um
   hoechstens ~400 Zeichen wachsen (Ist heute: 5283 Zeichen ueber alle
   `place_call*`-Pfade, gemessen). Bezahlt wird das mit dem Wegfall mindestens einer
   Chat-Runde je Anruf - die kostet mehr Token und mehr Nutzer-Wartezeit als 80 Token
   Systemkontext.

## 3. Pre-Mortem der Wahl (August 2027, die Entscheidung war falsch)

| # | Was schiefging | Entschaerfung / Haltung |
|---|---|---|
| R1 | **Die Beschreibungen sind seither dreimal gewachsen.** Jede Phase haengte "nur einen Satz" an, niemand mass die Summe; heute kostet der Werkzeugsatz bei jedem Turn spuerbar Token. | Der Test `GQ-B1-04` pinnt eine OBERGRENZE fuer die Summe aller `place_call`-Beschreibungen. Wachsen heisst ab jetzt: die Grenze bewusst anheben und begruenden. |
| R2 | **Claude laesst zu viel offen.** Der Agent darf pro Anruf genau EINMAL rueckfragen (`in-call.js:48`); ab der zweiten Luecke steht er sprachlos da - schlechter als vorher. | Der Loop-Text nennt die Zahl ("once"), statt "Fragen" im Plural zu versprechen. Das `briefing`-Verbot betrifft nur das VORSAGEN einer Antwort, nicht das Weglassen von Kontext; die bestehende Aufforderung, relevanten Kontext mitzugeben, bleibt woertlich stehen. Ob eine Rueckfrage reicht, ist eine Messfrage (offener Punkt 3). |
| R3 | **Bei ausgeschaltetem Kanal wurde es schlechter:** kein Vertroesten mehr, aber auch keine Rueckfrage - der Agent sagt nur noch "weiss ich nicht". | Akzeptiert und bewusst: der Agenten-Prompt verbietet die Vertroestung heute schon ("NEVER offer {{owner_name}} as another way"). Das Briefing-Verbot stellt nur den Zustand her, der ohnehin gelten sollte; es nimmt keine Faehigkeit weg. |
| R4 | **Ohne "Ask the user FIRST" beim Mandat fragt Claude nie mehr nach dem Rahmen** - Agenten nehmen nur noch Nachrichten auf, Termine kommen nicht zustande, das Produkt wirkt nutzlos. | Die Verbots-Haelfte ("Never invent one") BLEIBT - sie ist die sicherheitsrelevante; nur der Ausgang aendert sich von "frag nach" zu "lass das Feld weg", und ohne Feld darf der Agent nichts zusagen (fail-closed, `mcp-tools.js:605` letzter Satz). Die bedingte Aufforderung im ELTERN-Feld ("Ask the user about their frame when an appointment or price question is to be expected") bleibt UNVERAENDERT stehen - der Weg zur Rueckfrage ist also nicht zu, nur nicht mehr doppelt. |
| R5 | **Die Emphase-Waechter wurden gruen geschrieben:** man hat die Marker-Erwartung immer nur nachgezogen, bis die Verbote verwaschen waren. | Nur zwei Marker-Listen aendern sich (`briefing`: +KNOW, `decide_freely`: -FIRST), jede mit Begruendung im Testkommentar - dieselbe Praxis wie bei `max_duration_s`/KS-P3 und `diagnostic`/GQ-P11. Die vier woertlich gepinnten Negativ-Beispiele bleiben unangetastet; `objective` behaelt seine Marker-Inventur BYTE-GLEICH. |
| R6 | **Wir haben nie gemessen, ob es half.** Der Text wurde geaendert, der naechste Testanruf zeigte dasselbe Verhalten, niemand merkte es. | Abschnitt 6 nennt den einen Anruf, der die Wirkung belegt (dasselbe Szenario: Auftrag mit einem Detail, das der Auftraggeber nicht kennt), samt der Forensik-Frage: ist `consults` danach NICHT mehr leer? |

## 4. Spezifikation

### 4.1 `src/mcp-tools.js` - `briefing` (Zeile 583-588)

**Vorher** (Wert von `.describe(...)`):

> "Relevant context from the chat so far that the agent needs for the call: what it is about, the names involved, likes/preferences, history as well as the desired outcome and tone. SUMMARISE instead of copying in raw - only what counts for the conversation. NO secrets, passwords or payment data. The agent speaks as the personal AI assistant of the principal (not as Claude/Gemini); phrase the context from their perspective."

**Nachher** (EIN neuer Satz, eingefuegt nach dem Secrets-Satz, Rest byte-identisch):

> "Relevant context from the chat so far that the agent needs for the call: what it is about, the names involved, likes/preferences, history as well as the desired outcome and tone. SUMMARISE instead of copying in raw - only what counts for the conversation. NO secrets, passwords or payment data. Write only what you KNOW: never script an answer for a detail you are missing, and never write that the principal will get back to the other party - the agent is not allowed to say that, so such a line removes an answer instead of adding one. Leave the gap open. The agent speaks as the personal AI assistant of the principal (not as Claude/Gemini); phrase the context from their perspective."

Neuer Code-Kommentar ueber dem Feld (Deutsch, ohne Umlaute), sinngemaess: *Das Briefing
reist als erste Zeile des HINTERGRUND-Blocks in den Agenten-Prompt (elevenlabs/outbound.js
backgroundText). Der Agenten-Prompt verbietet die Rueckfrage fuer alles, was dort schon
steht - eine vorweggenommene Antwort schaltet damit den Rueckfrage-Kanal fuer genau diese
Luecke ab (Befund B, tasks/gq-transkript-befunde-2026-08-19.md). Deshalb steht das VERBOT
hier (gilt immer, auch bei ausgeschaltetem Kanal), die ZUSAGE dagegen am kanalabhaengigen
PLACE_CALL_CONSULT_LOOP.*

Marker-Inventur nachher: `["SUMMARISE", "NO", "KNOW"]`.

### 4.2 `src/mcp-tools.js` - `objective` (Zeile 578-582)

**Vorher** (nur die betroffene Passage): "... ALWAYS name a concrete topic/occasion when it
is known; if the topic or preference is still unknown, ask the user FIRST, instead of
sending off a vague task. Background and details do NOT belong here ..."

**Nachher:** "... ALWAYS name a concrete topic/occasion when it is known; if the topic
itself is still unknown, ask the user FIRST, instead of sending off a vague task - a single
missing detail is not a reason to ask, it belongs in the briefing or stays open. Background
and details do NOT belong here ..."

Alles davor und danach bleibt byte-identisch. Zwei Aenderungen, beide bewusst:

- "the topic or preference" -> "the topic itself": die Vorab-Rueckfrage bleibt fuer den
  einen Fall, der sie zwingend braucht - der Satz wird woertlich vorgesprochen
  (`opening_line`), ohne Thema gibt es keinen sprechbaren ersten Satz. Eine fehlende
  *Praeferenz* ist dagegen genau das, was das Mandat oder die Live-Rueckfrage traegt.
- Der neue Nebensatz benennt den bisher fehlenden dritten Ausgang ("stays open").

Marker-Inventur nachher: `["ONE", "VERBATIM", "BEFORE", "NO", "ALWAYS", "FIRST", "NOT"]` -
**unveraendert** (das neue "not" ist bewusst klein geschrieben; die Testerwartung fuer
diesen Pfad wird NICHT angefasst).

### 4.3 `src/mcp-tools.js` - `mandate.decide_freely` (Zeile 599-606)

**Vorher** (betroffener Satz): "Ask the user FIRST about their frame, instead of inventing
one."

**Nachher:** "Never invent one: take the frame from what the user has already said,
otherwise leave the field out."

Rest der Beschreibung byte-identisch. Begruendung: die Erfindungs-Sperre ist die
sicherheitsrelevante Haelfte und bleibt; der Ausgang wird von "Chat-Runde" auf "Feld
weglassen" gedreht, was fail-closed ist (ohne Feld darf der Agent nichts zusagen - der
naechste Satz derselben Beschreibung sagt das bereits). Die bedingte Aufforderung im
ELTERN-Feld `mandate` ("Ask the user about their frame when an appointment or price
question is to be expected in the call") bleibt WOERTLICH stehen: sie ist bereits an eine
Bedingung geknuepft und ist der einzige verbleibende Weg zu einem Mandat.

Marker-Inventur nachher: `["WITHOUT", "WITHOUT", "NOT"]` (das mittlere `FIRST` faellt weg).

### 4.4 `src/mcp-tools.js` - `PLACE_CALL_CONSULT_LOOP` (Zeile 446-447)

**Vorher:**

> "Right after this call returns, start calling await_call_event with the returned call_id and keep calling it until it returns event=\"done\" - while the phone is still ringing the agent may ask you questions you can answer for free."

**Nachher:**

> "Right after this call returns, start calling await_call_event with the returned call_id and keep calling it until it returns event=\"done\" - during the call the agent can ask you back once about a detail the briefing left open, and that question only reaches you while you are in this loop. So place the call with what you have: an open detail costs nothing, a guessed one cannot be taken back."

Drei bewusste Aenderungen:

1. "questions" (Plural) -> "once": am Code belegt, `MAX_IN_CALL_CONSULTS_PER_CALL = 1`
   (`consult/in-call.js:48`, derselbe Riegel auf dem EL-Weg,
   `routes/webhooks-elevenlabs.js:269-274`).
2. Die Aussage "waehrend das Telefon klingelt" faellt weg. Sie beschreibt Consult #0, und
   dessen Antwort erreicht auf dem heute live laufenden EL-Weg keinen Prompt mehr
   (`api-calls.js:281` feuert unmittelbar vor `originateElevenLabsCall`,
   `outbound.js:744-762` baut `background` genau einmal). Eine Zusage ohne Deckung gehoert
   nicht in eine Beschreibung; der Sachverhalt selbst ist offener Punkt 2.
3. Der Tempo-Satz ("So place the call with what you have") ersetzt die weggefallene
   Gratis-Zusage als Antrieb - er ist kanalabhaengig richtig und steht deshalb hier.

Caps-Marker: KEINE (wie bisher). Die Inventur von `place_call` bleibt damit `["NOT"]`, und
`test/al-p13-consult-channel.test.js` AL-P13-36 (`looped.startsWith(plain)`) bleibt gruen,
weil `PLACE_CALL_DESCRIPTION` unangetastet bleibt.

### 4.5 `src/mcp-server-info.js` - `MCP_CONSULT_INSTRUCTIONS` (Zeile 75-82)

**Nachher** (ein Satz angehaengt, Rest byte-identisch):

> "... Staying in that loop pays off: the final \"done\" answer carries the summary of the call and whether the objective was achieved. The agent is on the phone while it waits, so answer within seconds - if you have to ask the user, do it in the same turn."

Begruendung: die Rueckfrage hat eine Wanduhr-Frist (`CONSULT_OPEN_MS`,
`consult/in-call.js:38`); eine Antwort nach einer gemuetlichen Chat-Runde kommt zu spaet.
KEINE Sekundenzahl im Text - der Wert liegt in der Konfiguration und wuerde im Text
veralten.

### 4.6 Tests

**A. `test/p15-mcp-tool-descriptions-en.test.js`** (Bestand anpassen, Zeile 65-113):

- `"place_call.briefing": ["SUMMARISE", "NO"]` -> `["SUMMARISE", "NO", "KNOW"]`, mit
  Kommentar: *GQ-B1: die Vertroestungs-Sperre. KNOW ist die Verhaltensgarantie des Feldes
  (nur Gewusstes ins Briefing) - bewusst nachgezogen statt weggeschrieben, Praezedenz
  max_duration_s/KS-P3.*
- `"place_call.mandate.decide_freely": ["WITHOUT", "FIRST", "WITHOUT", "NOT"]` ->
  `["WITHOUT", "WITHOUT", "NOT"]`, mit Kommentar: *GQ-B1: die Vorab-Rueckfrage ist hier
  gestrichen (sie steht bedingt im Eltern-Feld); die Erfindungs-Sperre bleibt, sie traegt
  keinen Marker.*
- `"place_call.objective"` bleibt UNVERAENDERT - wenn dieser Fall rot wird, ist der neue
  Nebensatz falsch gross geschrieben.
- Der Fall "die Negativ-Beispiele stehen woertlich" (Zeile 144-152) bleibt unveraendert und
  MUSS gruen bleiben (`ask the user FIRST` steht weiterhin in `objective`).

**B. `test/place-call-context-bridge.test.js`** (Bestand ergaenzen):

- P1-01 (Zeile 68-76): zwei Zusicherungen dazu -
  `assert.match(briefing, /never write that the principal will get back/i)` und
  `assert.match(briefing, /Leave the gap open/i)`.
- I9-01 (Zeile 98-107): eine Zusicherung dazu -
  `assert.match(objective, /topic itself/i, "die Vorab-Rueckfrage gilt nur noch dem Thema selbst")`.
  Die bestehende Zeile `/ask the user FIRST/i` bleibt.

**C. Neue Datei `test/gq-b1-briefing-openness.test.js`** (Harness: derselbe `fakeServer` wie
in `p15-mcp-tool-descriptions-en.test.js`, beide Registrierungswege einsammeln; KEIN
Server-Spawn noetig). Testnamen beginnen mit `GQ-B1-` - **nicht** mit einem Katalog-Praefix
aus `package.json` `config.i18nCatalogPattern` (`MCP-`, `GAP-`, ... wuerden den Fall in den
`test:gates`-Lauf verschieben, Lehre `catalog-id-prefix-misroutes-tests`).

1. `GQ-B1-01: die briefing-Beschreibung verbietet die Vertroestung und verlangt die offene Luecke`
   - `briefing` matcht `/never script an answer/i`, `/get back to the other party/i`,
     `/Leave the gap open/i`; und `assert.doesNotMatch(briefing, /await_call_event/)` -
     das Feld ist immer registriert und darf kein Werkzeug versprechen, das fehlen kann.
2. `GQ-B1-02: die Live-Rueckfrage wird NUR bei aktivem Kanal zugesagt`
   - ohne `consultAllowed`: `place_call`-Beschreibung matcht nicht `/ask you back/i`;
   - mit `consultAllowed: true`: matcht `/ask you back once/i` und `/only reaches you while you are in this loop/i`.
3. `GQ-B1-03: die Vorab-Rueckfrage steht an GENAU EINER Stelle des place_call-Schemas`
   - ueber alle Pfade, die mit `place_call` beginnen, zaehlt `/ask the user FIRST/`
     genau EINMAL, und zwar in `place_call.objective`. Das ist der Regressionsfang gegen
     das Wiedereinwandern der zweiten Vorab-Rueckfrage. (`answer_consult` traegt denselben
     Wortlaut bewusst weiter - anderer Pfad, anderer Zeitpunkt, deshalb die
     Praefix-Einschraenkung.)
4. `GQ-B1-04: die place_call-Beschreibungen bleiben unter dem Token-Deckel`
   - Summe der Zeichen aller `place_call*`-Beschreibungen (ohne Kanal) `<=`
     `PLACE_CALL_DESCRIPTION_BUDGET_CHARS`. Konstante im Test, Wert **5700**
     (Ist vor der Aenderung: 5283, gemessen; die Aenderungen oben addieren rund 320).
     Kommentar an der Konstante: *Jede Beschreibung kostet bei JEDEM Claude-Turn Token.
     Der Deckel ist kein Stil-Test: er zwingt die naechste Phase, Zuwachs zu begruenden
     statt anzuhaengen. Anheben nur mit benanntem Grund.*
5. `GQ-B1-05: die Server-Instructions nennen die Frist der Rueckfrage`
   - `MCP_CONSULT_INSTRUCTIONS` matcht `/answer within seconds/i` und enthaelt KEINE
     Ziffernfolge als Sekundenzahl (`assert.doesNotMatch(text, /\d+\s*(s|sec|seconds)\b/i)`),
     damit der Konfigurationswert nicht in den Text wandert.

**D. Pflichtlauf:** `node --check src/mcp-tools.js`, `node --check src/mcp-server-info.js`,
danach `npm test` (muss gruen sein). `npm run test:gates` darf unveraendert bleiben - keine
der Aenderungen traegt eine Katalog-ID.

## 5. Was NICHT angefasst wird

Woertlich aus `tasks/gq-transkript-befunde-2026-08-19.md`:

- "Hebel, die uns gehoeren (alles im Repo): die place_call-Feldbeschreibungen in
  src/mcp-tools.js (goal/briefing/constraints/mandate/context), die MCP-Server-Instructions
  (String im Server, der den await_call_event-Loop vorschreibt), ggf. Tool-Result-Texte.
  NICHT unser Hebel: das Verhalten von claude.ai selbst."
- "Nur Aenderungen, die OHNE weitere Testanrufe belegt werden koennen (Tests/Statik). Was
  einen echten Anruf braucht, als offener Folgepunkt notieren, nicht bauen."
- "Die Formulierungsschwaeche des Agenten beim Ablehnen ('guter Tipp, ich schaue mir das
  an') ist AUSSERHALB dieses Auftrags - erst Muster ueber weitere Testanrufe sammeln."
- "HARTE LEITPLANKEN: Der Offenlegungssatz bleibt fest verdrahtet allererster Satz
  (Absolute Regel 2, CLAUDE.md). Die fail-closed-Treppe und die Hash-Gegenprobe in
  opening-line.js duerfen nicht aufgeweicht werden. Gesprochene DE-Strings tragen Umlaute
  (Memory-Regel)."
- "(Das '[freundlich]' ist eine gesprochene Ton-Marke im Transkript - separater
  Bestandsbefund, NICHT Teil dieser Kette.)"

Zusaetzlich, aus dem Auftrag dieser Phase und aus CLAUDE.md:

- **Keine Gate-Logik**: `src/consult/gate.js`, `src/consult/in-call.js`,
  `src/routes/webhooks-elevenlabs.js`, `src/telephony/outbound-gates.js`,
  `MAX_IN_CALL_CONSULTS_PER_CALL`, `CONSULT_WAIT_MS`/`CONSULT_OPEN_MS` bleiben unberuehrt.
- **Keine neuen Endpunkte**, kein neues Schema-Feld, keine Aenderung an der Feldmenge oder
  Optionalitaet von `place_call` (`test/place-call-context-bridge.test.js` P1-02 muss
  unveraendert gruen bleiben).
- **Keine Aenderung an** `elevenlabs/agent_configs/outbound-agent.template.json` - das ist
  Anrufverhalten und braucht Testanrufe.
- **Kein Anfassen** von `answer_consult` ("if you do not know, ask the user FIRST" gilt IM
  Gespraech und ist richtig), `place_call.to`, `constraints`, `context.*` (inkl.
  `open_questions`), `max_duration_s`, `diagnostic`, `mandate` (Eltern-Beschreibung),
  `mandate.fallback_order`, `mandate.on_out_of_scope`, `PLACE_CALL_DESCRIPTION`,
  `CANCEL_CALL_DESCRIPTION`.
- **Keine Lokalisierung**: die Beschreibungen bleiben einsprachig englisch (Systemgrenze
  O14, Kopf von `src/mcp-tools.js`). `loc.mcp.consultPermissionHint` (tenant-sichtbar,
  drei Sprachen) bleibt unveraendert.
- Kommentare/Doku in dieser Phase: Deutsch OHNE Umlaute.

## 6. Offene Punkte (brauchen einen echten Testanruf oder eine eigene Entscheidung)

1. **Wirkungsbeleg.** Ob der auftraggebende Claude die Vertroestung nun laesst UND der
   Agent daraufhin `get_consult` zieht, zeigt nur ein Anruf mit demselben Szenario: ein
   Auftrag mit genau einem Detail, das der Auftraggeber nicht kennt (Vorlage: der
   Tennis-Anruf, "Platz/Ort unbekannt"). Forensik-Frage danach: ist `consults` am
   Call-Datensatz NICHT mehr leer, und enthaelt das Transkript keine
   "der-Owner-meldet-sich"-Zeile? Ohne diesen Anruf ist die Phase statisch belegt, aber
   nicht wirksam belegt.
2. **Consult #0 ist auf dem EL-Weg vermutlich wirkungslos.** `emitOpeningConsult`
   (`api-calls.js:281`) feuert Millisekunden vor `originateElevenLabsCall` (`:290-291`),
   und `dynamicVariables`/`backgroundText` bauen den Hintergrund genau einmal
   (`outbound.js:744-762`). Eine Antwort, die waehrend der Klingelzeit eintrifft, landet in
   `context.key_facts` - aber der Agenten-Prompt steht da schon. Das ist am Code
   nachvollzogen, NICHT am Anbieter gemessen; es gehoert in eine eigene Kette (entweder die
   Antwort erreicht den laufenden Agenten auf einem anderen Weg, oder `open_questions` ist
   auf dieser Engine tote Flaeche und die Feldbeschreibung muss das sagen). Deshalb wirbt
   in dieser Phase KEIN Text fuer `open_questions` als "offen lassen"-Kanal.
3. **Reicht EINE Rueckfrage je Anruf?** `MAX_IN_CALL_CONSULTS_PER_CALL = 1` ist ein
   Kosten-Riegel. Wenn Claude nach dieser Aenderung mehr offen laesst, kann der zweite
   offene Punkt im Gespraech nicht mehr geklaert werden. Das ist eine Owner-Entscheidung
   (Geld gegen Gespraechsqualitaet) und braucht Messdaten aus mehreren Anrufen, keine
   Schaetzung.
4. **Tempo-Messung.** Das Ziel "weniger Vorab-Rueckfragen" ist heute nur als
   Owner-Beobachtung belegt (~1 Minute, eine Rueckfrage). Ob die zwei entschaerften
   "Ask the user FIRST"-Stellen die Zahl der Chat-Runden tatsaechlich senken - und ob die
   Auftraege dabei konkret bleiben -, laesst sich nur ueber mehrere echte Auftraege
   beobachten. Vorschlag fuer den naechsten Anruf: denselben Auftrag einmal mit
   Terminfrage stellen und zaehlen, wie viele Rueckfragen vor `place_call` kommen.
5. **Agenten-Prompt-Seite.** Der Prompt sagt heute "DO NOT CALL IT FOR: anything already
   written in your task, background, constraints or mandate". Wenn ein Briefing legitim
   eine Teilantwort enthaelt ("Platz steht noch nicht fest"), koennte der Agent das als
   "steht schon im Hintergrund" lesen und wieder nicht rueckfragen. Ob das eintritt, zeigt
   erst ein Anruf; die Korrektur laege im Template und ist damit ausserhalb dieser Phase.
6. **Reihenfolge.** Owner-Ziel: "Track E zuerst (kleiner Fix), dann Track B." Dieser
   Entwurf beruehrt keine Datei aus Track E (`call-locale.js`, `locales.js`,
   `opening-line*.js`, `outbound.js`) - die beiden Ketten koennen unabhaengig gemergt
   werden, sofern beide `npm test` gruen halten.
