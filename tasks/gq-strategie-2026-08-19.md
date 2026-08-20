# GQ-Strategie 2026-08-19 — Eroeffnung (Track E) und Auftragsseite (Track B)

Grundlage: `tasks/gq-transkript-befunde-2026-08-19.md` (Anruf `call_mt0ddduxuzgl`), die beiden
Entwuerfe `tasks/gq-e1-entwurf.md` / `tasks/gq-b1-entwurf.md` und eine vollstaendige
Gegenpruefung am Code (jede Behauptung unten ist an der genannten Datei nachgelesen, mehrere
Zahlen sind am laufenden Node gemessen).

Dieses Dokument entscheidet. Die bindende Bauanweisung steht in `tasks/gq-e1-spec.md` und
`tasks/gq-b1-spec.md`; ein Implementierer liest NUR seine Spec, nicht die Entwuerfe.

---

## 0. Messbasis (vor jeder Aenderung erhoben, damit "nachher gruen" etwas bedeutet)

| Messung | Wert | Wie gemessen |
|---|---|---|
| Regressionslauf | `LLM_PROVIDER=anthropic npm test` -> 4888 Tests, 4887 gruen, **1 rot** | voller Lauf, 119 s |
| der eine rote Fall | `Gate 11 Budget: erschoepftes Tenant-Budget blockt auch mit Flag an (402)` (`test/telnyx-p5-gate-proof.test.js:235`) | bekannter Spawn-Flake, isoliert gruen |
| Summe der `place_call*`-Beschreibungen, ohne Consult-Kanal | **5283 Zeichen** | `registerTools` gegen einen Attrappen-Server, Zeichen gezaehlt |
| dieselbe Summe mit Kanal | **5513 Zeichen** | dito, `{ consultAllowed: true }` |
| dynamische Variablen der Agenten-Vorlage | **12** (`test/el-vorlage-variablen-abgleich.test.js:49`) | Datei gelesen |
| Testdefinitionen unter `elevenlabs/test_configs/` | **18** | `ls` |
| Testdefinitionen, die die feste Abschlussfrage im Text fuehren | **0** | Volltextsuche nach den drei Fragen |

**Pflicht-Vorbedingung fuer beide Tracks: `npm test` ohne `LLM_PROVIDER=anthropic` ist auf
diesem Rechner rot.** `.env` traegt `LLM_PROVIDER=deepseek` (Zeile 45); 42 Testdateien binden
`ANTHROPIC_BASE_URL`, ohne `LLM_PROVIDER` mitzupinnen (`test/helpers.js` `BASE_ENV` pinnt es
nur fuer *gespawnte* Server, nicht fuer In-Process-Tests). In `test/el-opening-line.test.js`
sind das 4 Faelle. Das ist ein **Bestandsdefekt, keine Folge dieser Tracks** — beide Specs
schreiben deshalb vor, Vorher- und Nachher-Lauf mit `LLM_PROVIDER=anthropic` zu fahren und die
42 Dateien NICHT anzufassen (Regel 6: nur was gefragt wurde). Der Sammelfix ist offener Punkt
S-O1.

---

## 1. Der Befund in einem Absatz

Ein einziger Testanruf hat zwei voneinander unabhaengige Wurzeln freigelegt. **Track E:** die
gesprochene Eroeffnung entsteht an zwei Orten, die einander nicht kennen — unsere Seite liefert
die Grund-Zeile als Variable, der fremde Agent haelt Offenlegung *und* Abschlussfrage als
statischen Text. Weil die Frage statisch ist, kann sie weder entfallen, wenn der Auftrag schon
fragt, noch die Anrede des Auftrags spiegeln; dazu setzt die Bruecke einen zweiten Punkt hinter
einen Auftragstext, der schon einen hat. **Track B:** der auftraggebende Claude fuellt eine
Wissensluecke natuerlicherweise mit einer Vertroestung im Briefing ("Antonio meldet sich"), und
genau diese Zeile schaltet den Live-Rueckfragekanal fuer diese Luecke ab, weil der Agenten-Prompt
`get_consult` fuer alles verbietet, was schon im Hintergrund steht — waehrend die
Feldbeschreibungen fuer Unbekanntes nur einen einzigen Ausgang kennen, die Vorab-Rueckfrage im
Chat.

---

## 2. Track E — Eroeffnungs-Komposition

### Gewaehlte Loesung

**Der statische Rahmen am Anbieter endet mit der Variablen.** `first_message` ist ab sofort
`disclosure(ownerName) + " " + {{opening_line}}` und nichts weiter; alles, was nach der
Offenlegung gesprochen wird, komponieren wir pro Anruf in genau einen Wert. Die feste Frage der
Sprache wird an die Grund-Zeile angehaengt — **genau dann, wenn die Grund-Zeile nicht schon
selbst fragt**. Die festen Bausteine der Sprachen mit Du/Sie-Unterscheidung (de, fr) verlieren
ihren anrede-tragenden Satzteil, und `bridgedObjective` streicht ein mitgebrachtes
Satz-Endzeichen, bevor die Bruecke ihres setzt.

Das loest alle drei Defekte an einer Stelle und fuer jede Stufe der Rueckfall-Treppe; das
Variablen-Vokabular bleibt bei zwoelf Namen, die 18 Testdefinitionen bleiben unberuehrt, und der
bisher UNGEPRUEFTE Teil des gesprochenen Satzes (die feste Frage im fremden Rahmen) faellt ab
jetzt unter `validOpeningLine` und die Hash-Gegenprobe. Details: `tasks/gq-e1-spec.md`.

### Verworfene Optionen

- **Nur die Interpunktion reparieren** (`bridgedObjective` strippt, sonst nichts): loest ein
  Drittel des Befunds und laesst den auffaelligsten Teil — die Sie-Frage hinter einer Du-Zeile —
  unveraendert stehen.
- **Zweite Variable `{{opening_question}}`**: kostet dieselbe Vorlagen-Aenderung und denselben
  Push wie die gewaehlte Loesung, dazu einen dreizehnten Variablennamen, den alle 18
  Testdefinitionen setzen muessten (`scripts/check-elevenlabs-tests.js` prueft die Deckung PRO
  Datei), und eine leere Variable hinterliesse ein doppeltes Leerzeichen im gesprochenen Text.
- **Die Frage im Agenten-Prompt entscheiden lassen**: nach `first_message` hat der fremde Agent
  den Zug nicht, er wartet — das ist genau der 11-Sekunden-Stille-Befund aus Anruf 6.
- **`trimGoalForSpeech` auf dem Telnyx-Weg mitziehen**: dort existiert der Defekt nicht, und eine
  Aenderung an `src/claude.js` waere Verhaltensaenderung ohne Befund.

### Pre-Mortem-Ergebnis (korrigiert gegenueber dem Entwurf)

| # | Ausfall in einem Jahr | Haltung |
|---|---|---|
| E-P1 | **Der Push an den Anbieter ist nie passiert.** | **Der Entwurf war hier falsch.** Er behauptete, der Zwischenzustand sei "nicht schlechter als heute". Nachgerechnet am gemessenen Auftrag ergibt Code-ohne-Push: *"... hast. Wie sieht es damit aus? Wie sieht es damit bei Ihnen aus?"* — **zwei fast gleiche Fragen hintereinander, also schlechter als der Ist-Zustand.** Konsequenz: der Push ist Teil der Aenderung, nicht ihr Nachspiel, und die Reihenfolge ist festgelegt (s. Abschnitt 5). |
| E-P2 | Die erzeugte Direkt-Frage behauptet einen Termin, den der Auftrag nicht nennt. | Erzeugungs-Anweisung formuliert nur um, wenn der Auftrag selbst fragt; "nothing is agreed in it" bleibt woertlich. Stufen 2/3 erfinden per Bau nichts. Semantisch nicht pruefbar -> offener Punkt E-O1, Notaus `openingLineLlm=false` bleibt. |
| E-P3 | Die Offenlegung ist nicht mehr der erste Satz. | `startsWith(disclosure)` bleibt je Sprache gepinnt; NEU kommt die Gegenrichtung dazu (der Rahmen ENDET auf `{{opening_line}}`) — danach passt zwischen Offenlegung und Variable kein Text mehr, weder davor noch dahinter. |
| E-P4 | Der Register-Bruch ist zurueck ("bei Ihnen" wieder eingefuegt). | Pronomen-Waechter ueber `openingQuestion`, `openingReasonFallback` UND den festen Bruecken-Rahmen, je Sprache mit T/V-Unterscheidung. Struktur statt Konvention. |
| E-P5 | Die Eroeffnung ist wieder zu lang. | `OPENING_QUESTION_MAX_CHARS` deckelt die Frage; ein Test rechnet die Obergrenze der komponierten Zeile nach. Rechnerisch sinkt sie fuer DE (33 -> 23 Zeichen) und FR (28 -> 14). |
| E-P6 | Niemand hat je den GANZEN gesprochenen Satz geprueft. | Genau die Luecke, aus der dieser Befund kam: Rahmen und Variable waren je fuer sich getestet. Neuer Test setzt beide zusammen und prueft "genau ein Fragezeichen, kein doppeltes Satzzeichen, beginnt mit der Offenlegung, endet auf die Frage". |
| E-P7 | **Die Komposition wandert auf die Leseseite.** Baut sie jemand spaeter in `outbound.js` (nach der Hash-Pruefung) ein, waere der angehaengte Satz ungeprueft und ungehasht — die Gegenprobe deckte ihn nicht mehr. | Die Spec verankert: komponiert wird auf der SCHREIBSEITE (`fetchOpeningLine`, vor `createCall`) und im Rueckfallzweig von `verifiedOpeningLine`. Ein Test belegt am echten Anrufweg, dass der GESPEICHERTE Wert bereits komponiert ist. |
| E-P8 | Die Frage verschwindet still, weil jemand `openingQuestion` leert. | Ein Waechter fordert je Sprache: nicht leer, endet auf "?", besteht `validOpeningLine`. Ohne ihn faellt der 11-Sekunden-Befund lautlos zurueck, sobald der Rahmen ihn nicht mehr traegt. |

---

## 3. Track B — Briefing und Tempo an `place_call`

### Gewaehlte Loesung

**Nur Texte, kein Laufzeitpfad.** Vier Feldbeschreibungen in `src/mcp-tools.js` und ein Satz in
`src/mcp-server-info.js`:

1. `briefing` bekommt das **Verbot** — nur Gewusstes hineinschreiben, keine vorweggenommene
   Antwort, insbesondere keine Vertroestung auf den Auftraggeber, Luecke offen lassen. Das Verbot
   gilt IMMER, auch bei abgeschaltetem Rueckfragekanal, deshalb steht es am immer registrierten
   Feld.
2. `PLACE_CALL_CONSULT_LOOP` bekommt die **Zusage** — sie haengt am Kanal und steht deshalb am
   kanalabhaengigen Text.
3. `objective` verengt die Vorab-Rueckfrage auf den einen Fall, der sie zwingend braucht (das
   Thema selbst, denn es wird woertlich vorgesprochen), und benennt erstmals den dritten Ausgang
   ("stays open").
4. `mandate.decide_freely` verliert seine zweite "Ask the user FIRST"-Anweisung; die
   Erfindungs-Sperre bleibt, der Ausgang dreht auf "Feld weglassen" (fail-closed).
5. Die Server-Instructions nennen die Frist der Rueckfrage, ohne eine Sekundenzahl zu nennen.

Details und die verbindlichen Wortlaute: `tasks/gq-b1-spec.md`.

### Verworfene Optionen

- **Serverseitiger Riegel gegen Vertroestungen** (Muster gegen `briefing`): Freitext-Musterabgleich
  in jeder Sprache ist nie vollstaendig, streicht falsch-positiv legitimen Kontext ("sag ihr, ich
  rufe morgen selbst an") und waere neue Logik im Anrufstartpfad.
- **Neues Schema-Feld fuer Unbekanntes**: existiert bereits als `context.open_questions` — ein
  zweites waere eine Dublette, und das vorhandene traegt auf der Live-Engine keine Wirkung (s.
  B-O2).
- **Den Agenten-Prompt entschaerfen** (`DO NOT CALL IT FOR: anything already written in your
  ... background`): das ist Anrufverhalten, nur am echten Anruf beurteilbar, und der Owner hat
  Testanruf-abhaengige Aenderungen ausgeschlossen.

### Pre-Mortem-Ergebnis (korrigiert gegenueber dem Entwurf)

| # | Ausfall in einem Jahr | Haltung |
|---|---|---|
| B-P1 | Die Beschreibungen sind dreimal "nur um einen Satz" gewachsen; der Werkzeugsatz kostet bei jedem Turn spuerbar Token. | Zwei Zeichen-Deckel als Test (ohne/mit Kanal). Wachsen heisst ab jetzt: Grenze bewusst anheben und begruenden. Der Entwurfswert 5700 war falsch gerechnet ("rund 320" statt gemessener 384 Zuwachs) und haette nur 33 Zeichen Luft gelassen — ein Test, der bei jeder Wortwahl kippt, wird weggeschrieben statt eingehalten. Korrigiert auf 5800 / 6200. |
| B-P2 | **Der Loop-Text verspricht ein Werkzeug, das ein viertes Flag abschaltet.** | **Der Entwurf war hier falsch.** Er wollte "the agent can ask you back once" zusagen. `PLACE_CALL_CONSULT_LOOP` haengt an `consultAllowedFor` = `CONSULT_ENABLED` x `ASSISTANT_CONTEXT_ENABLED` x `profile.allowConsult` (`src/consult/gate.js:19-25`). Die Rueckfrage IM Gespraech braucht zusaetzlich `IN_CALL_CONSULT_ENABLED` (`src/routes/webhooks-elevenlabs.js:271`, `src/consult/in-call.js:97`). Der Entwurf haette also eine ungedeckte Zusage gegen sein eigenes Prinzip 1 eingebaut. Korrigiert: der Satz ist **konditional** formuliert ("if the agent runs into a detail the briefing left open, its question reaches you only inside this loop") und damit unter jeder Flag-Kombination wahr. |
| B-P3 | Claude laesst zu viel offen; ab der zweiten Luecke steht der Agent sprachlos da. | Der Loop-Text nennt die Obergrenze ("at most once") statt Fragen im Plural; ein Test pinnt diese Formulierung gegen `MAX_IN_CALL_CONSULTS_PER_CALL`, damit die Zahl im Text nicht von der Zahl im Code wegdriftet. Ob EINE Rueckfrage reicht, ist eine Messfrage (B-O4). |
| B-P4 | Bei ausgeschaltetem Kanal wurde es schlechter: keine Vertroestung mehr, aber auch keine Rueckfrage. | Bewusst akzeptiert, aber ehrlicher als im Entwurf: der Agent sagt dann "weiss ich nicht" statt "der Auftraggeber meldet sich". Das ist der Zustand, den der Agenten-Prompt heute schon verlangt ("NEVER offer {{owner_name}} as another way to get that answer" — woertlich in der Vorlage nachgelesen); das Briefing hatte ihn nur ueberstimmt. Es wird keine Faehigkeit entfernt, nur eine Regelverletzung. |
| B-P5 | Ohne "Ask the user FIRST" beim Mandat fragt Claude nie mehr nach dem Rahmen; Termine kommen nicht zustande. | Die Verbots-Haelfte ("Never invent one") bleibt; nur der Ausgang dreht auf "Feld weglassen", und ohne Feld darf der Agent nichts zusagen. Die bedingte Aufforderung im ELTERN-Feld `mandate` bleibt WOERTLICH stehen — der Weg zur Rueckfrage ist nicht zu, nur nicht mehr doppelt. |
| B-P6 | Die Emphase-Waechter wurden gruen geschrieben, bis die Verbote verwaschen waren. | Genau zwei Marker-Listen aendern sich (`briefing`: +KNOW an dritter Stelle, `decide_freely`: -FIRST), jede mit Begruendung im Testkommentar. `objective` behaelt seine Inventur BYTE-GLEICH — wird sie rot, ist der neue Nebensatz falsch gross geschrieben. Die vier woertlich gepinnten Negativ-Beispiele bleiben unangetastet. |
| B-P7 | Wir haben nie gemessen, ob es half. | B-O1 nennt den einen Anruf und die Forensik-Frage. Ohne ihn ist die Phase statisch belegt, aber nicht wirksam belegt — das steht so in der Spec, damit niemand "gruen" mit "wirkt" verwechselt. |

---

## 4. Was die Pruefung am Code an den Entwuerfen korrigiert hat

Diese Liste existiert, damit die Korrekturen nicht in den Specs untergehen.

| Entwurf | Behauptung | Befund |
|---|---|---|
| E, Abschn. 5 P1 | "Der Zwischenzustand ist nachweislich nicht schlechter als heute." | **Falsch.** Code ohne Push ergibt zwei aufeinanderfolgende Fragen. Reihenfolge neu festgelegt. |
| E, Abschn. 2/4.5 | "Vokabular bleibt bei elf Namen", "elf `test_configs/*.json`". | **Falsch.** Zwoelf Variablen (`el-vorlage-variablen-abgleich.test.js:49`), 18 Testdefinitionen. Ergebnis (unberuehrt) stimmt trotzdem: keine Definition fuehrt die Frage. |
| E, R5 | "wortgleich das, was `trimGoalForSpeech` auf dem Telnyx-Weg tut". | **Falsch.** `trimGoalForSpeech` (`src/claude.js:436`) strippt `[.!?]+$`, also AUCH das Fragezeichen. Die neue Regel strippt bewusst nur `[.!]+$` und laesst eine Frage stehen. Das ist eine gewollte Abweichung, keine Angleichung — sie ist als solche zu kommentieren. |
| E, Abschn. 6 | Liste der mitzuziehenden Bestandstests ("Zeilen 170-197"). | **Unvollstaendig.** Mindestens `test/el-opening-line.test.js:152` (Stufe 1) faellt ausserhalb der genannten Spanne, ebenso vier `verifiedOpeningLine`-Faelle und der Notaus-Fall. Die Spec zaehlt sie einzeln mit Testnamen statt Zeilennummern auf. |
| E | — | **Fehlte:** ein Waechter, der `openingQuestion` gegen Leerung/fehlendes "?" schuetzt. Nach R1 traegt der Rahmen die Frage nicht mehr; ohne Waechter faellt der 11-Sekunden-Befund lautlos zurueck. Ergaenzt (E-P8). |
| E | — | **Fehlte:** die Regel, dass komponiert wird, BEVOR gehasht wird. Ergaenzt samt Beleg-Test (E-P7). |
| B, 4.4 | Loop-Text sagt "the agent can ask you back once" zu. | **Ungedeckte Zusage** bei `IN_CALL_CONSULT_ENABLED=false`. Konditional umformuliert. |
| B, 4.6 D | Deckel `PLACE_CALL_DESCRIPTION_BUDGET_CHARS = 5700`, "die Aenderungen addieren rund 320". | **Verrechnet.** Gemessener Zuwachs 384 (263 + 84 + 37); 5700 liesse 33 Zeichen Luft. Korrigiert auf 5800, plus ein zweiter Deckel 6200 fuer die Fassung mit Kanal. |
| B | — | **Fehlte:** die Zusage, dass `MCP_CONSULT_INSTRUCTIONS` seinen Bestandstext als byte-identischen PREFIX behaelt. Ergaenzt. |
| beide | "npm test muss gruen sein". | **Auf diesem Rechner unerreichbar** ohne `LLM_PROVIDER=anthropic` (s. Abschnitt 0). Beide Specs schreiben das Kommando vor. |

---

## 5. Reihenfolge, Merge, Deploy

1. **Track E zuerst** (Owner-Ziel), dann Track B. Die Tracks teilen keine Datei — E arbeitet in
   `src/elevenlabs/*`, `src/i18n/locales.js` und der Agenten-Vorlage, B in `src/mcp-tools.js` und
   `src/mcp-server-info.js`. Sie koennen unabhaengig gemergt werden, solange beide den
   Regressionslauf gruen halten.
2. **Track E ist eine gekoppelte Aenderung aus Code UND Anbieter-Konfiguration.** Verbindliche
   Reihenfolge: (a) Branch bauen, Tests gruen; (b) **`npm run elevenlabs:push` aus dem Branch —
   VOR dem Code-Deploy**; (c) mergen und deployen; (d) `npm run elevenlabs:drift`, muss sauber
   sein. Begruendung: das Fenster zwischen (b) und (c) laesst die Eroeffnung auf einer Aussage
   enden (der Zustand vor dem 18.08., bekannt und ausgehalten); die umgekehrte Reihenfolge
   erzeugt zwei aufeinanderfolgende Fragen — einen Zustand, den es nie gab und den niemand
   gemessen hat. Ist der Push nicht durchfuehrbar, wird der Code NICHT deployt.
3. Track B braucht keinen Push: die Feldbeschreibungen reisen mit dem Server.
4. Aufraeumen nach dem Merge nach CLAUDE.md: die beiden Entwuerfe (`gq-e1-entwurf.md`,
   `gq-b1-entwurf.md`) verschwinden im Merge-Commit, die Befunde-Datei, dieses Dokument und die
   beiden Specs bleiben, bis die offenen Punkte abgearbeitet sind.

---

## 6. Leitplanken, die beide Tracks unveraendert lassen

- **Offenlegung**: der Offenlegungssatz bleibt fest verdrahtet und allererster Satz (Absolute
  Regel 2). Track E veraendert ausschliesslich, was DAHINTER steht.
- **Fail-closed-Treppe und Hash-Gegenprobe** in `src/elevenlabs/opening-line.js`: unveraendert in
  Struktur und Wirkung. Die Treppe bleibt dreistufig, die Gegenprobe deckt weiterhin genau den
  Text ab, der gesprochen wird — nach der Aenderung sogar mehr davon als vorher.
- **Keine Gate-Logik in Track B**: `src/consult/gate.js`, `src/consult/in-call.js`,
  `src/routes/webhooks-elevenlabs.js`, `src/telephony/outbound-gates.js`,
  `MAX_IN_CALL_CONSULTS_PER_CALL`, `CONSULT_WAIT_MS`/`CONSULT_OPEN_MS` bleiben unberuehrt. Track B
  aendert ausschliesslich Text, den ein Client-Modell liest.
- **Umlaut-Regel**: gesprochene DE/FR-Strings tragen Umlaute und Akzente; Code-Kommentare und
  Dokumentation sind deutsches ASCII.
- **Regel 4**: kein Text aus Auftrag oder Gespraech wandert in ein Log.
- **Regel 6**: nur was gefragt wurde. Der Ton-Marker `[freundlich]`, die Formulierungsschwaeche
  beim Ablehnen ("guter Tipp, ich schaue mir das an") und der Agenten-Prompt selbst sind
  ausserhalb beider Tracks.

---

## 7. Offene Folgepunkte

### Braucht einen echten Testanruf

- **E-O1 — Treue der erzeugten Direkt-Frage.** Ob Stufe 1 den Auftrag trifft und keinen Termin
  hinzudichtet, ist nur am Anruf messbar. Naechster Testanruf: derselbe Tennis-Auftrag,
  `openingLineLlm` AN; im Transkript pruefen, ob die erste Aeusserung genau eine Frage stellt und
  nichts behauptet, was der Auftrag nicht nennt.
- **E-O2 — Wirkt eine Sachfrage schneller als die generische Frage?** Ob eine Eroeffnung, die auf
  die eigentliche Frage endet, den Angerufenen frueher zum Reden bringt als "Wie sieht es damit
  aus?" (11 s Stille in Anruf 6), ist eine Zeitmessung, keine Transkript-Lesung.
- **E-O3 — Klang der gekuerzten franzoesischen Frage.** "Qu'en est-il ?" ist der bestehende Satz
  minus des register-tragenden Teils, also grammatisch unauffaellig — ob er am Telefon natuerlich
  klingt, beurteilt nur ein franzoesisches Ohr.
- **E-O4 — Schreibt der Push die Presets wirklich?** Das Push-Werkzeug kennt inzwischen einen
  Schreibweg fuer `language_presets[*].overrides.agent.first_message`
  (`scripts/push-elevenlabs.mjs:302-314`), der Befund "Push kann Presets nicht schreiben" stammt
  aber vom 18.08. Belegt wird es erst durch `npm run elevenlabs:drift` nach dem Push. Bleibt er
  rot, ist das ein Werkzeug-Befund, kein Code-Befund.
- **B-O1 — Wirkungsbeleg Track B.** Ein Anruf mit demselben Szenario (genau ein Detail, das der
  Auftraggeber nicht kennt). Forensik danach: ist `consults` am Call-Datensatz NICHT mehr leer,
  und enthaelt das Transkript keine "der-Auftraggeber-meldet-sich"-Zeile? Ohne diesen Anruf ist
  die Phase statisch belegt, aber nicht wirksam belegt.
- **B-O4 — Reicht EINE Rueckfrage je Anruf?** `MAX_IN_CALL_CONSULTS_PER_CALL = 1` ist ein
  Kosten-Riegel. Wenn Claude nach dieser Aenderung mehr offen laesst, bleibt die zweite Luecke
  ungeklaert. Owner-Entscheidung (Geld gegen Gespraechsqualitaet), braucht Messdaten aus mehreren
  Anrufen.
- **B-O5 — Tempo-Messung.** "Weniger Vorab-Rueckfragen" ist heute nur Owner-Beobachtung
  (~1 Minute, eine Rueckfrage). Vorschlag: denselben Auftrag einmal mit Terminfrage stellen und
  zaehlen, wie viele Rueckfragen vor `place_call` kommen.
- **B-O6 — Agenten-Prompt-Seite.** Ein Briefing, das legitim eine Teilantwort enthaelt ("Platz
  steht noch nicht fest"), koennte der Agent als "steht schon im Hintergrund" lesen und wieder
  nicht rueckfragen. Korrektur laege in der Vorlage und ist damit Anrufverhalten.

### Statisch belegbar, aber ausserhalb dieser Tracks (brauchen eine eigene Entscheidung)

- **B-O2 — `context.open_questions` ist auf der Live-Engine vermutlich wirkungslos, und die
  Feldbeschreibung verspricht das Gegenteil.** `emitOpeningConsult` feuert unmittelbar vor
  `originateElevenLabsCall` (`src/routes/api-calls.js:281` vs. `:290-291`), waehrend
  `dynamicVariables`/`backgroundText` den Hintergrund genau einmal beim Waehlen bauen
  (`src/elevenlabs/outbound.js:742-762`). Eine waehrend der Klingelzeit eintreffende Antwort
  landet in `context.key_facts` — der Agenten-Prompt steht da schon. Die heutige Beschreibung des
  Feldes sagt woertlich: *"They are asked while the phone is ringing, so the agent starts the
  conversation with the answers."* Das ist auf der live laufenden Engine eine Zusage ohne Deckung.
  Track B wirbt deshalb mit keinem Wort fuer dieses Feld, aendert aber auch nichts daran — die
  Korrektur braucht zuerst die Antwort, ob der Weg auf einem anderen Kanal doch ankommt.
- **B-O3 — `consult_available` und der Webhook-Riegel messen nicht dasselbe.** Der Vorlagen-Wert
  `{{consult_available}}` kommt aus `consultAllowedFor` (drei Faktoren,
  `src/elevenlabs/outbound.js:1241`), der Webhook nimmt die Rueckfrage nur mit einem vierten an
  (`IN_CALL_CONSULT_ENABLED`, `src/routes/webhooks-elevenlabs.js:271`). Bei
  `CONSULT_ENABLED=true` und `IN_CALL_CONSULT_ENABLED=false` bekaeme der Agent "available"
  angesagt und liefe dann in die Ablehnung. Latent, nicht aktiv (live steht das vierte Flag an),
  aber ohne Testanruf beweisbar. Der Fix waere fail-closed, ist aber Anrufverhalten und braucht
  eine eigene Phase.
- **E-O5 — Der Anrufbeantworter-Text mischt Sprachen und traegt jetzt auch die Frage.**
  `voicemail_message` ist einsprachig englisch und fuehrt `{{opening_line}}` mitten im Satz; bei
  einem deutschen Anruf steht dort seit jeher ein deutscher Einschub, ab Track E zusaetzlich die
  Abschlussfrage ("... Wie sieht es damit aus? I will try again later."). Der Sprachmix ist
  Bestand, die rhetorische Frage auf Band ist neu und wird bewusst in Kauf genommen; eine zweite
  Variable nur fuer den seltensten Pfad kostet mehr als sie bringt.
- **S-O1 — 42 Testdateien binden `ANTHROPIC_BASE_URL` ohne `LLM_PROVIDER`.** Auf jeder Maschine
  mit `LLM_PROVIDER=deepseek` in `.env` faerbt sich der Regressionslauf breit rot, ohne dass etwas
  kaputt waere. Der Sammelfix (eine Zeile je Datei, oder ein gemeinsamer Vorlauf-Helfer) ist eine
  eigene, kleine Aufraeum-Phase.
