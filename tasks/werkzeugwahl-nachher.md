# Nachher-Messung — Vorher/Nachher-Vergleich Werkzeugwahl (get_consult/take_message/look_up)

Phase "Nachher-Messung" aus `tasks/PLAN-WERKZEUGWAHL.md` (P4-Verifikation). Reine Messung,
**kein Produktivcode geaendert** in dieser Phase. Bewertet gegen den vorab (vor Kenntnis der
Zahlen) festgelegten `tasks/werkzeugwahl-abnahme.md`, Kriterien C/D/E.

---

## 1. Exakte Konfiguration — Vorher vs. Nachher, Seite an Seite

| | Vorher (P2) | Nachher (diese Phase) | identisch? |
|---|---|---|---|
| Commit-Basis | `1b73809017bb95858aa57029ff0e17dfc087fb32` (P0/P1) **plus** die zwei in P2 neu geschriebenen, zum Laufzeitpunkt noch unkommittierten Szenario-Dateien (spaeter mitkommittiert in `3fc286f`) | `7352ebf951b92b39097c5bfd6fc2b2bea8e21f0f` (aktueller `HEAD`, P3+P4) | **NEIN — das ist die einzige beabsichtigte Variable** |
| Anbieter | `LLM_PROVIDER=deepseek` | `LLM_PROVIDER=deepseek` | ja |
| Modell | `CLAUDE_MODEL=deepseek-v4-pro` | `CLAUDE_MODEL=deepseek-v4-pro` | ja (bestaetigt in `meta.agent_model`/`meta.llm_provider` jedes der 20 neuen Reports) |
| Persona-Modell | `claude-haiku-4-5` | `claude-haiku-4-5` | ja |
| Judge-Modell | `claude-sonnet-5` | `claude-sonnet-5` | ja |
| Treiber | `shim` (Telnyx-Assistant-Pfad) | `shim` | ja |
| Provider (Bench) | `telnyx` (Fake) | `telnyx` (Fake) | ja |
| Tenant | Bootstrap-/Owner-Tenant | Bootstrap-/Owner-Tenant | ja |
| Profilrechte | `OWNER_PROFILE`: `allowLookup:true`, `allowConsult:true` (hart gepinnt, `src/store/defaults.js`, von P3/P4/P6 nicht beruehrt) | dieselben | ja |
| `MAX_BUDGET_EUR` (Bench) | `BENCH_MAX_BUDGET_EUR`-Konstante aus `runner.mjs` | dieselbe Konstante | ja |
| Turn-Cap | `maxTurnsCap=10` | `maxTurnsCap=10` | ja |
| Wiederholungen | n=5 je Szenario, 4 Szenarien = 20 Laeufe | n=5 je Szenario, 4 Szenarien = 20 Laeufe | ja |
| Szenarien | `d3-consult-verlangt`, `d3-consult-implizit`, `d3-nachschlag-auftrag`, `d3-fremde-recherche` | dieselben vier, unveraendert (kein Diff auf den Szenario-Dateien seit der Vorher-Messung) | ja |
| Messwerkzeug | `instrumented-run.mjs` (Scratchpad) via `run-all.sh` | **dieselbe Datei**, aufgerufen via `run-all-nachher.sh` — byte-identisch zu `run-all.sh` bis auf den Output-Pfad (`diff` geprueft, einzige Differenz: `OUTBASE`) | ja |

`git diff 3fc286f 7352ebf -- scripts/convo-bench/` (der P2-Commit, der die vier Szenario-Dateien
im exakt fuer die Vorher-Messung verwendeten Zustand mitkommittiert hat, gegen den P3+P4-Commit)
ist **leer** — keine Aenderung an Runner, Checks oder den vier Szenario-Dateien seit der
Vorher-Messung. Der Code-Unterschied zwischen den beiden Messungen liegt ausschliesslich in
`src/claude.js`, `src/consult/in-call.js` und `src/i18n/prompts/*.js` (der P3+P4-Commit selbst).
Die Konfiguration ist damit bis auf die eine beabsichtigte Variable (Commit) identisch — der
Vergleich ist gueltig im Sinne von Kriterium D des Abnahmekatalogs.

**Herkunftshinweis (Transparenzpflicht):** Die 20 Nachher-Rohdateien lagen bereits im
Scratchpad, als diese Phase begann (Zeitstempel `r0.started_at` ab `2026-08-11T17:20:01Z`,
14 Minuten nach dem P3+P4-Commit `19:06:22` lokal; Log-Datei `run-all-nachher.log` endet
`19:33` lokal) — offenbar aus einem frueheren, nicht zu Ende gefuehrten Anlauf an genau dieser
Phase im selben Scratchpad-Verzeichnis. Vor der Verwendung wurde geprueft, nicht nur behauptet:
(1) `run-all-nachher.sh` ist byte-identisch mit dem fuer die Vorher-Messung verwendeten
`run-all.sh` bis auf den Output-Pfad (`diff`, s.o.); (2) das Arbeitsverzeichnis ist zum
Messzeitpunkt UND jetzt sauber auf `HEAD=7352ebf` (`git status --short` leer, damals wie jetzt);
(3) `meta.llm_provider`/`meta.agent_model` in den Reports selbst bestaetigen `deepseek`/
`deepseek-v4-pro`; (4) die aus diesen Dateien reproduzierten Vorher-Zahlen (unten, Abschnitt 5)
stimmen exakt mit den bereits im Vorher-Bericht dokumentierten Werten ueberein, was die
Auswertungslogik selbst validiert. Die Analyse in dieser Datei (Aggregation, Kreuzpruefung
Proxy-vs-Direktsignal, Abgleich gegen den Abnahmekatalog) wurde in dieser Phase neu und
eigenstaendig aus den rohen JSON-Reports durchgefuehrt, nicht uebernommen.

## 2. Positiv-Kontrolle: war das Zielwerkzeug angeboten?

Wie in P2 aus der unconditional `[telnyx-shim] turn_ok`-Zeile (`offeredToolNames`), PII-frei.

| Szenario | Ziel-Werkzeug | Vorher: angeboten (min. 1 Turn) | Nachher: angeboten (min. 1 Turn) |
|---|---|---|---|
| `d3-consult-verlangt` | `get_consult` | 5/5 | **5/5** |
| `d3-consult-implizit` | `get_consult` | 4/5 (1 Lauf ohne jeden erfolgreichen Turn, s.u.) | **5/5** |
| `d3-nachschlag-auftrag` | `look_up` | 5/5 | **5/5** |
| `d3-fremde-recherche` | `look_up` | 5/5 | **5/5** |

**Kriterium C** (die Vorher-Messung reproduziert den Defekt) ist bereits durch `tasks/werkzeugwahl-vorher.md`
belegt (get_consult 0/5 im IMPLIZIT-Szenario bei nachgewiesenem Angebot) und wird durch die
identische Reproduktion der Vorher-Zahlen aus den Rohdaten in dieser Phase (s. Abschnitt 4)
zusaetzlich bestaetigt — hier nicht erneut hergeleitet, nur referenziert.

Zusaetzliche, tiefere Pruefung (wie in P2 Abschnitt 6 gefordert): ein Lauf kann `turn_count > 0`
haben, obwohl **kein einziger** LLM-Aufruf erfolgreich war (reine Fehler-Ansagen zaehlen als
Turns). Vorher traf das auf `d3-consult-implizit` r1 zu (0 erfolgreiche LLM-Aufrufe von 3,
`offered_tool_names_by_turn` leer). **In der Nachher-Messung trat dieser Fall in keinem der 20
Laeufe auf** — jeder Lauf hat mindestens 2 protokollierte, informative Turns
(`offered_tool_names_by_turn` minimale Laenge 2, s. Rohpruefung unten). Die LLM-Fehlerrate
(non-transient Timeouts) liegt in dieser Messung bei 25/126 = 19,8 % gegenueber 27/127 = 21,3 %
vorher — vergleichbar, kein grosser Umgebungs-Sprung.

## 3. Gueltiger Nenner

Nur Laeufe mit `turn_count > 0` — bei **allen 20 Vorher- und allen 20 Nachher-Laeufen erfuellt**.
Zusaetzlich: alle 20 Nachher-Laeufe sind auch nach der schaerferen Pruefung (mind. 1 informativer,
erfolgreicher Turn) gueltig — anders als vorher (19/20 informativ). Der gueltige Nenner ist damit
fuer jedes Szenario **n=5** in beiden Messungen; bei `d3-consult-implizit` ist die Nachher-Stichprobe
sogar vollstaendiger (5/5 statt 4/5 informativ).

## 4. Ergebnistabelle — Vorher/Nachher nebeneinander

Zaehlmethodik identisch zu P2: "gefeuert" = Werkzeugname erscheint in mindestens einem
`metrics.turn.tools`-Eintrag des Laufs (dieselbe Quelle wie `checks.mjs#toolFireCount`, auf der
auch `consult_fired`/`lookup_fired` beruhen).

| Szenario | Kennzahl | Vorher | Nachher | Delta |
|---|---|---|---|---|
| `d3-consult-verlangt` (EXPLIZIT) | `get_consult` gefeuert | 4/5 | **5/5** | +1 |
| | `consult_fired`-Check bestanden | 4/5 | **5/5** | +1 |
| | `no_message_taken` bestanden (keine Nachricht trotz Mandat) | 0/5 | **1/5** | +1 |
| | `turn_count_within_budget` bestanden | 0/5 | 1/5 | +1 |
| `d3-consult-implizit` (IMPLIZIT, **Kernziel von P4**) | `get_consult` gefeuert | 0/5 (0/4 informativ) | **0/5** | **0 — unveraendert** |
| | `consult_fired`-Check bestanden | 0/5 | 0/5 | 0 |
| | `no_message_taken` bestanden | 3/5 | **0/5** | **−3 — schlechter** |
| | `turn_count_within_budget` bestanden | 3/5 | 2/5 | −1 |
| `d3-nachschlag-auftrag` | `look_up` gefeuert | 5/5 | 5/5 | 0 |
| | `lookup_turn_not_silent` bestanden | 3/5 | 4/5 | +1 |
| `d3-fremde-recherche` | `look_up` gefeuert (SOLL 0/5 sein) | 5/5 | 4/5 | +1 (marginal besser, weiterhin ueberwiegend falsch) |
| | `no_lookup_fired` bestanden | 0/5 | 1/5 | +1 |

Rohdaten je Lauf (inkl. `ended_via`, Failed-Checks, direkte Tool-Feuerzaehlung) liegen in
`aggregate2.py`-Ausgabe, Scratchpad `nachher-out2.txt`/`vorher-out2.txt` (nicht Teil des Commits,
Ableitung ist in dieser Datei vollstaendig wiedergegeben).

## 5. Kriterium E (Veto, aus `tasks/werkzeugwahl-abnahme.md`): kein Tausch eines Defekts gegen den anderen

Kriterium E hat zwei Teile. Beide sind einzeln zu pruefen — **beide muessen erfuellt sein**, sonst
ist die Phase laut Katalog nicht abgenommen, unabhaengig vom Ergebnis bei D.

### 5a. Feuert `get_consult` in den Szenarien, wo es NICHT soll?

`d3-nachschlag-auftrag` und `d3-fremde-recherche` sind reine `look_up`-Szenarien ohne
Entscheidungslage, die eine Rueckfrage rechtfertigen wuerde. `get_consult` gefeuert: **0/5 in
beiden Szenarien, in BEIDEN Messungen (vorher wie nachher).** Keine Ueberkorrektur nachweisbar —
**dieser Teil von E ist erfuellt.**

(Einschraenkung: dies sind dieselben vier Szenarien wie vorher, keine zusaetzlichen
"get_consult-soll-nicht-feuern-bei-Kleinigkeit"-Faelle innerhalb des Mandats wurden in dieser
Phase gemessen — die Aufgabenstellung verlangt ausdruecklich denselben Szenarien-Satz wie die
Vorher-Messung. Eine breitere Ueberkorrektur-Pruefung z.B. gegen `mandat-innerhalb.mjs` ist
**NICHT GEMESSEN**.)

### 5b. Feuert `take_message` weiterhin zusaetzlich (`no_message_taken`)?

Hier zwei Signale, sauber getrennt:

**Direktes Signal — beide Werkzeuge live im selben Lauf gefeuert** (`get_consult` UND
`take_message` beide in `metrics.turns[].tools`):

| Szenario | Vorher | Nachher |
|---|---|---|
| `d3-consult-verlangt` | 2/5 | 2/5 (unveraendert) |
| `d3-consult-implizit` | 0/5 (get_consult feuerte nie, also kein Doppelfeuer moeglich) | 0/5 |

**Proxy-Signal — der Check `no_message_taken` selbst** (Nachricht/Action-Item entstand,
unabhaengig davon ob `take_message` live oder erst die Anruf-Zusammenfassung — eine separate,
von P3/P4 unberuehrte LLM-Stufe, `src/claude.js:1330-1375` — das Action-Item erzeugte):

| Szenario | Vorher (failed) | Nachher (failed) |
|---|---|---|
| `d3-consult-verlangt` | 5/5 | 4/5 (leicht besser) |
| `d3-consult-implizit` | 2/5 | **5/5 (schlechter)** |

**Befund, unmissverstaendlich:** Im direkten Live-Signal (beide Tools im selben Lauf gefeuert)
aendert sich nichts — 2/5 bleibt 2/5 bei EXPLIZIT, 0/5 bleibt 0/5 bei IMPLIZIT. Aber die
Ausweich-Rate — wie oft am Ende ueberhaupt eine Nachricht/ein Action-Item entsteht, egal auf
welchem Weg — **steigt bei IMPLIZIT von 2/5 auf 5/5 fehlgeschlagene Laeufe.** Das ist die
Kennzahl, die die Aufgabenstellung ausdruecklich als Pruefpflicht nennt ("der Check
`no_message_taken`") — und sie bewegt sich in die falsche Richtung.

**Qualitative Einordnung (Transkript-Lesung aller 5 IMPLIZIT-Nachher-Laeufe, gegen die direkte
Tool-Feuerzaehlung geprueft, nicht nur gegen den Eindruck aus dem Text):** Der urspruenglich
beschriebene Defekt — das Modell sagt ohne jede Absicherung eigenmaechtig ein
Mandats-fremdes Angebot zu ("Donnerstag um siebzehn Uhr passt gut - den nehme ich gerne", exakt
so im Vorher-Transkript r2) — trat in **keinem** der 5 Nachher-Laeufe in dieser woertlichen Form
auf. Der direkte Tool-Zaehler zeigt: in 4/5 Laeufen (r0-r3) feuert `take_message` live
mindestens einmal; nur r4 (Lauf endet ueberwiegend an LLM-Timeouts) feuert keins von beiden Tools
live, bekommt aber ueber die separate Anruf-Zusammenfassung trotzdem ein Action-Item. Innerhalb
der 4 Laeufe mit `take_message` gibt es zwei Verlaeufe: in r1/r3 lehnt der Agent das
Mandats-fremde Angebot durchgehend ab und nimmt es klar als Nachricht; in r0/r2 verhandelt er die
Gegenseite zusaetzlich aktiv zurueck in sein Mandat und schliesst dort korrekt selbst ab (legitim,
kein Defekt) — nimmt aber DENNOCH an anderer Stelle im selben Lauf eine Nachricht auf (vermutlich
die separate, von P3/P4 nicht beruehrte Buchungs-Regel `boundaries.noBooking`, "Einen
Terminwunsch nimmst du mit allen Angaben als Nachricht auf", s. `PLAN-WERKZEUGWAHL.md`/P3-Bericht
"BEWUSSTE SCOPE-GRENZE 1" — nicht ursaechlich mit dem Konsult-Pfad verwechseln, aber **UNBELEGT**,
welcher der beiden Mechanismen hier genau griff). In keinem der 5 Laeufe bleibt am Ende ein
stilles, unabgesichertes Zusagen ohne jede Spur stehen — das ist eine reale Verhaltensaenderung
gegenueber vorher (dort hatten 3/5 Laeufe weder `get_consult` noch `take_message` noch ein
Action-Item). Ersetzt wurde dieses Muster aber durchweg durch den **take_message-Ausweg, nicht
durch den vorgesehenen `get_consult`-Weg.** Der Plan verlangt in P4 ausdruecklich beides
gleichzeitig ("`get_consult` steigt ... OHNE dass `take_message` zusaetzlich feuert") — nur die
zweite Haelfte in ihrer schwaechsten Lesart (kein voellig unabgesichertes Zusagen mehr) ist
eingetreten, die erste (der Live-Weg wird tatsaechlich genutzt) nicht, und die Ausweich-Rate
insgesamt ist gestiegen, nicht gefallen.

**Damit ist Teil 5b von Kriterium E NICHT erfuellt.** Die Ausweich-Nachricht feuert beim
Kern-Szenario der Phase (IMPLIZIT) haeufiger als vorher, nicht seltener — auch wenn die
zugrundeliegende Verhaltensaenderung (kein stilles Selbst-Zusagen mehr) fuer sich genommen in die
sichere Richtung geht.

## 6. Verdikt

Getrennt je Frage, weil die Zahlen keine einzelne Aussage tragen:

### 6.1 Kriterium D (`get_consult` steigt im IMPLIZIT-Szenario)

**NICHT BELEGT VERBESSERT — UNVERAENDERT.** `get_consult` feuert weiterhin 0/5 im
IMPLIZIT-Szenario, bei jetzt sogar vollstaendigerem gueltigem Nenner (5/5 statt 4/5 informativ)
als vorher. Das ist das in `tasks/PLAN-WERKZEUGWAHL.md` P4 explizit benannte Kernziel dieser
Aenderung, und es ist nicht erreicht.

### 6.2 Nebenbefund `d3-consult-verlangt` (EXPLIZIT, war schon vorher ueberwiegend gruen)

**BELEGT VERBESSERT, schwach (n=5, ein einzelner Lauf kippt das Ergebnis).** `get_consult`
gefeuert 4/5 -> 5/5, `no_message_taken` bestanden 0/5 -> 1/5 (ein vollstaendig sauberer Lauf neu
hinzugekommen, r3: `get_consult` feuert, keine Nachricht, alle 11 Checks bestehen). Bei n=5 ist
das ein einzelner gekippter Lauf — kein robuster Beleg, aber auch keine Verschlechterung.

### 6.3 Kriterium E / Veto (kein Tausch eines Defekts gegen den anderen)

**NICHT ERFUELLT.** Teil 5a (keine Ueberkorrektur, `get_consult` feuert nicht faelschlich) ist
erfuellt. Teil 5b (`take_message`/`no_message_taken` feuert nicht laenger zusaetzlich) ist **nicht
erfuellt** — die Ausweich-Rate steigt beim Kernszenario von 2/5 auf 5/5 fehlgeschlagene Laeufe.

### 6.4 Gesamtverdikt fuer die Phase

Nach der eigenen Regel des vorab festgelegten Abnahmekatalogs (`tasks/werkzeugwahl-abnahme.md`,
Kriterium E: *"Scheitert E, ist die Phase NICHT abgenommen, auch wenn D glaenzt"*) ist die Phase
**NICHT ABGENOMMEN** — und D glaenzt in diesem Fall ohnehin nicht: das Kernszenario zeigt beim
Zielwerkzeug selbst keine Bewegung (0/5 -> 0/5), nur eine Verschiebung *zwischen* den beiden
Nicht-Ziel-Auswegen (stilles Zusagen -> Nachricht), die die Aufgabenstellung ausdruecklich als
Alarmsignal benennt ("wenn der Fix dort jetzt Rueckfragen ausloest, ist ein Defekt gegen einen
anderen getauscht worden") — hier ist es kein Rueckfrage-Zuviel, sondern ein
Nachricht-statt-Rueckfrage-Zuviel: dieselbe Kategorie Befund (ein Ausweg-Werkzeug wandert nicht
zum vorgesehenen Ziel, sondern zum jeweils anderen Ausweg), nur mit vertauschten Rollen.

**d3-nachschlag-auftrag / d3-fremde-recherche: UNVERAENDERT** (marginale Verschiebungen bei n=5,
in beide Richtungen — keine dieser beiden Kennzahlen war Ziel von P3/P4, der Code-Diff beruehrt
diese Pfade nicht direkt). `d3-fremde-recherche` bleibt der in P2 dokumentierte, ausserhalb des
Consult-Fokus liegende offene Befund (look_up feuert ueberwiegend, wo es nicht soll) —
unveraendert offen, nicht Gegenstand dieser Phase.

## 7. Was diese Messung nicht zeigt

- Keine Kausalanalyse, WARUM die implizite Entscheidungsschwelle den Live-Consult-Weg nicht
  aktiviert, obwohl der neue Prompt-Block ihn laut P3-Prompt-Tests woertlich enthaelt (`npm test`
  WW-P3-1..8 gruen, Block rendert nachweislich). Der Block steht im Prompt — das Modell nutzt ihn
  in dieser Stichprobe trotzdem nicht fuer den Live-Weg. Eine Erklaerung (Schwellenformulierung zu
  eng? Modell bevorzugt grundsaetzlich `take_message` als "sicherste" Wahl, sobald *irgendein*
  Ausweg-Werkzeug im Satz steht?) ist **UNBELEGT** und nicht Teil dieser Phase.
- Keine breitere Ueberkorrektur-Pruefung ausserhalb der vier Bestandsszenarien (z.B.
  Mandat-innerhalb-Kleinigkeiten) — **NICHT GEMESSEN**.
- Kosten der 20 Nachher-Laeufe: **NICHT GEMESSEN** (derselbe methodische Verzicht wie in P2,
  `instrumented-run.mjs` traegt kein Kosten-Tracking).
- `npm run test:gates`: **NICHT GEMESSEN** in dieser Phase (war schon im P3+P4-Bericht als
  ueber 20 Minuten ohne Ausgabe abgebrochen dokumentiert; diese Phase aendert keinen Code, der
  Gates-Lauf ist ohnehin launch-Testkatalog, nicht Regressionsschutz).
- `npm test`: **GEMESSEN**, 4157/4157 gruen (korrigierte Zahl, roh 4177/4177 inkl. 20
  Datei-Wrapper ohne echten Test) auf demselben Commit `7352ebf`, den diese Nachher-Messung
  misst — selbst gefahren, nicht aus dem P3+P4-Bericht uebernommen.

## 8. Rohdaten

- Vorher: `/private/tmp/claude-501/-Users-antonio-Mein-Unternehmen-MCP-vodafone-agent/8af6ee0c-29a2-449c-85e3-918b3b13e6ee/scratchpad/vorher-messung/<scenario>/<scenario>-r<n>.json` (aus P2, unveraendert wiederverwendet)
- Nachher: `.../scratchpad/nachher-messung/<scenario>/<scenario>-r<n>.json` (20 Reports, `meta.llm_provider="deepseek"`/`meta.agent_model="deepseek-v4-pro"` je Datei bestaetigt)
- Auswertungsskript dieser Phase (Scratchpad, kein Produktivcode): `.../scratchpad/aggregate2.py` — zaehlt Tool-Feuern direkt aus `metrics.turns[].tools` (identische Quelle wie `checks.mjs#toolFireCount`), getrennt von der Action-Item-Proxy-Zaehlung des `no_message_taken`-Checks.
- `run-all.sh`/`run-all-nachher.sh` (Scratchpad): identisch bis auf Output-Pfad, `diff`-geprueft.
