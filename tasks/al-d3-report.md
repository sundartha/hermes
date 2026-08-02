# Phase AL-D3 — Den Tool-Entscheidungspunkt schärfen (Befund D-3)

**Gate: PASS**
**finalBranch:** `phase/al-d3-tool-entscheidungspunkt-fix2`

## Commits

- **Apparat:** `ab49f7f` — Messapparat (Env-Naht, Exa-Fake, Consult-Pumpe, fünf neue Bench-Checks, drei neue Szenarien)
- **Produkt:** `e42bd3b` — die eigentliche Produktänderung (R1–R4 in `take_message`/`get_consult`/`look_up`-Descriptions, de/en/fr)

**Wozu die Trennung dient:** Commit A baut ausschließlich das Messwerkzeug (`scripts/convo-bench/**`, Test-Erweiterungen für die Checks) und muss allein grün sein, bevor irgendein Prompt-Text sich ändert — so lässt sich später ein sauberer Vorher/Nachher-Bench-Lauf gegen genau diese beiden Commits fahren (Apparat vor Produkt, Produkt danach), ohne dass Apparat-Änderungen und Verhaltensänderung in derselben Messung vermischt werden. Commit B ist die alleinige, isolierte Produktänderung.

(Zusätzlich zwei Review-Fix-Commits `f4d2b54` und `152e751`, beide nach dem Produkt-Commit, beide nur an Apparat-Dateien — s. Abschnitt Fix-Runden.)

## Klausel-Begründungen (clauseRationale)

- **take_message — R1+R2 gemeinsamer Ausstieg** (NEU, am Ende der Description): „Verlangt dein Gegenüber die Entscheidung deines Auftraggebers, oder fehlt deinem Auftrag jetzt eine Sachauskunft, nimm KEINE Nachricht auf: dafür sind get_consult und look_up da." — Ausstiegssatz für den Inbound-Fall: „Fehlt dir das passende Werkzeug in diesem Zug, bleibt die Nachricht der richtige Weg." (EIN Satz deckt BEIDE Verweise; inbound sind get_consult/look_up nie im Werkzeugsatz, also greift dieser Ausstieg und take_message bleibt die richtige, ausführbare Anweisung — verifiziert per AL-D3-6 und per Code-Lesung von `consultAvailableFor`/`lookupProviderFor`, `direction!=="outbound" -> null`)
- **take_message — Fähigkeits-Aufzählung „nachschlagen, weiterverbinden, später zurückrufen"** (ENTFERNT): behauptete fälschlich ein statisch fehlendes Können (nachschlagen ist seit AL-P10b turn-genau möglich, `boundaryRules` sagt die Wahrheit) und duplizierte Verbote, die bereits woanders in derselben Description stehen (Rückruf-/Buchungs-Verbot) — kein Ausstieg nötig, es ist eine reine Streichung ohne Verweis auf ein anderes Werkzeug
- **get_consult — R1-Auslöser** (NEU, zweiter Satz): „Der klare Fall: dein Gegenüber verlangt ausdrücklich die Entscheidung deines Auftraggebers - dann rufst du get_consult auf, statt eine Nachricht aufzunehmen." — kein Ausstieg nötig: die Description erreicht das Modell nur in genau dem Zug, in dem get_consult auch im tools-Array liegt (`agentTools()` hängt sie nur bei `consultAvailableFor(call)` an) — inbound ungerendert
- **look_up — R2 Auftragsbindung** (GEÄNDERT, Bedingungssatz): „...und die Antwort deinen AUFTRAG jetzt weiterbringt." ersetzt „...das Gespräch jetzt weiterbringt." — kein Ausstieg nötig (existiert nur, wenn look_up angeboten wird, `lookupAvailableFor` gated auf `direction==='outbound'`)
- **look_up — R3 Verbotsfall** (NEU, nach der Themen-Aufzählung): „Betrifft die gewünschte Recherche deinen Auftrag nicht, rufst du look_up NICHT auf - lehne freundlich ab oder nimm es als Nachricht. Das ist richtig so." — kein EIGENER Ausstieg nötig: der Ausweg (‚als Nachricht') zeigt auf take_message, das immer angeboten wird — selbst wenn diese Klausel je inbound geriete, bliebe sie ausführbar
- **look_up — R4 führender Satz** (NEU, direkt vor dem Bestandsriegel): „Sprich EINEN kurzen überbrückenden Satz im SELBEN Zug, in dem du look_up aufrufst, nicht erst später." — kein Ausstieg nötig (existiert nur wenn look_up angeboten wird); der Bestandsriegel „Sage NIE, dass du nachschaust, und nenne NIE eine Quelle." bleibt unverändert direkt daneben stehen

## Zeichenzahl-Tabelle

| Feld | Sprache | vorher | nachher | Δ | Δ % |
|---|---|---:|---:|---:|---:|
| takeMessageDescription | de | 1000 | 1119 | +119 | +11,9 % |
| | en | 946 | 1053 | +107 | +11,3 % |
| | fr | 1011 | 1152 | +141 | +13,9 % |
| getConsultDescription | de | 665 | 823 | +158 | +23,8 % |
| | en | 604 | 743 | +139 | +23,0 % |
| | fr | 679 | 830 | +151 | +22,2 % |
| lookUpDescription | de | 522 | 779 | +257 | +49,2 % |
| | en | 531 | 762 | +231 | +43,5 % |
| | fr | 586 | 830 | +244 | +41,6 % |
| **Summe** | | **6544** | **8091** | **+1547** | **+23,6 %** |

Gemessen mit `node -e` gegen `LOCALES` vor und nach dem Produkt-Commit (E1–E3), identisch zu den Plan-Zahlen. `lookUpDescription` trägt zwei neue Regeln (R3+R4) bei der kleinsten Ausgangsbasis, daher der höchste Prozentsatz; absolut bleibt es mit 762–830 Zeichen weiterhin die kürzeste der drei Descriptions. `take_message`, der einzige Inbound-Entscheidungspunkt, wächst am wenigsten (+11…14 %). Aggregat +23,6 % liegt unter der 30-%-Marke aus der Spec — `lookUpDescription` allein liegt darüber (siehe Concern unten).

## Inbound-Prüfung

`toolDefs()` in `src/claude.js` liefert inbound wie outbound immer `end_call`+`take_message`, ohne Bedingung. `get_consult` hängt an `consultAvailableFor(call)` (`direction === "outbound"`), `look_up` an `lookupProviderFor`/`lookupAvailableFor` (`direction !== "outbound" -> null`). Beide Zusatzwerkzeuge sind inbound also strukturell abwesend, unabhängig von Flags/Kontingent.

Da eine Tool-Description nur sichtbar ist, wenn das Tool selbst im `tools`-Array steht, erreichen die neuen Klauseln in `getConsultDescription`/`lookUpDescription` (R1-Trigger, R2-Bindung, R3-Verbotsfall, R4-Satz) einen Inbound-Agenten nie — sie brauchen keinen eigenen Ausstieg. Die einzige neue Klausel, die auf `get_consult`/`look_up` verweist, ohne selbst an deren Verfügbarkeit gebunden zu sein, sitzt in `takeMessageDescription` (immer gerendert) — und genau sie trägt den B2-Ausstiegssatz. Verifiziert per Test AL-D3-6 (Ausstieg steht nach beiden Werkzeugnamen in allen drei Sprachen) und per Mutationsprobe (Entfernen des Ausstiegs färbt genau AL-D3-6 rot). Bestandstest AL-P10b-3 (unverändert grün) exerziert den Inbound-Fall für look_up bereits end-to-end.

**Ergebnis: genau eine Klausel verweist auf ein möglicherweise fehlendes Werkzeug (der Ausstieg in take_message), und genau sie trägt ihren Ausstieg. Kein Blocker.**

## Mutations- und Paritätsproben

Alle zwölf geplanten Mutationsproben gefahren, beobachtet, zurückgenommen (finaler Diff trägt keine Mutation):

- M1 (R1-Ausschluss aus de.js#takeMessageDescription entfernt) → genau AL-D3-1 rot
- M2 („Der klare Fall"-Satz nur aus fr.js#getConsultDescription) → genau AL-D3-2 (fr) rot
- M3 („YOUR TASK" in en.js#lookUpDescription auf „the conversation" zurückgedreht) → genau AL-D3-3 (en) rot
- M4 (R3-Klausel aus de.js#lookUpDescription entfernt) → genau AL-D3-4 rot
- M5 (R4-Satz aus en.js#lookUpDescription entfernt) → genau AL-D3-5 rot
- M6 (Ausstiegssatz aus fr.js#takeMessageDescription entfernt) → genau AL-D3-6 rot
- M9 („nachschlagen" in de.js#takeMessageDescription wieder eingefügt) → genau AL-D3-8 rot
- M10 (`EXA_API_KEY:"x"` in BASE_ENV gesetzt) → genau AL-D3-10 rot
- M11 (`lookup_turn_not_silent` auf `pass:true` verdrahtet) → genau AL-D3-13 rot
- M12 (`d3-fremde-recherche` deklariert unbekannten Check) → genau AL-P8-11 (Bestandstest) rot, AL-D3-15 blieb wie vorhergesagt grün

**Paritätsproben:**
- **M7** (Klausel NUR in de.js geändert — „Das ist richtig so." → „Das passt schon so." in R3): AL-D3-7 (der dedizierte Paritätstest, prüft nur Struktur) blieb GRÜN; rot wurde stattdessen genau AL-D3-4 (der R3-Regeltest) für de, en/fr blieben grün. Ergebnis wie vom Plan selbst vorhergesagt: die Sprachparität wird durch die Kombination aus AL-D3-1..6 (Inhalt je Sprache) + AL-D3-7 (Vollständigkeit der Regel-Menge) getragen, nicht durch AL-D3-7 allein.
- **M8** (Regel-Schlüssel `r4` aus `CONTRACT.fr` gelöscht): AL-D3-7 wurde wie erwartet rot (Schlüsselmengen-Mismatch). Kollateral auch AL-D3-5 (R4-Regeltest, fr-Iteration) rot, weil beide Tests dieselbe Tabelle lesen (G5) — ehrliche, erklärbare Nebenwirkung, bestätigt zusätzlich die geteilte Quelle.

In der unabhängigen Safety-Review (finaler Stand) wurden zwei weitere Mutationsproben eigenständig nachgefahren: B2-Ausstieg nur aus de.js entfernt → genau AL-D3-6 rot; R3-Klausel nur aus de.js entfernt → genau AL-D3-4 rot. Beide zurückgenommen, Worktree danach sauber.

## Angepasste Bestandstests

- **AL-P8-8** (`test/al-p8-bench-checks.test.js`): alte Zusage — `metricsTurns`-Fixture nahm Arrays nackter Zahlen (`[1,2,3]`); neue Zusage — Arrays von Objekten (`{roundtrips, tools}`). Dieselbe Prüfaussage (Mittelwert=2, n/a ohne Einträge) bleibt unangetastet, nur die Eingabeform generalisiert. Begründung: AL-D3 (`turnFiredTools`/`firedToolResult`/`lookup_turn_not_silent`) braucht auf denselben `metricsParsed`-turn-Einträgen zusätzlich das `tools`-Feld; eine zweite, parallele Fixture-Form wäre Duplikation (G5) statt Erweiterung. Beide Aufrufstellen im selben Commit A mitgezogen, keine Assertion geschwächt.

Geprüft und **unangetastet** gelassen (Risiko am Code verifiziert, kein Eingriff nötig): `al-p4-side-effect-tool-loop.test.js` (AL-P4-9, pinnt die drei Selbe-Zug-Substrings — bleiben wörtlich stehen), `cq-p5-prompt-redesign.test.js` (P5-O3, kein Transliterations-Treffer im neuen Text), `p11-agent-language-contract.test.js`, `prompt-en-scaffolding.test.js`/`prompt-en-call-e2e.test.js`, `al-p10b-lookup.test.js` (AL-P10b-1, vergleicht abgeleitet, nicht literal), `l3-prompt-caching.test.js`, `personal-assistant-characterization.test.js`, `e2e-06-en-purity-aggregate.test.js`, `de-umlaut-orthography.test.js`, `p15-mcp-tool-descriptions-en.test.js`.

## Safety-Urteil

**APPROVED.** Kurzfassung der unabhängigen Prüfung (frischer Worktree, Basis über `merge-base` gegen master gerechnet, da master zwischenzeitlich weiterlief):

- `npm test`: 3786/3786 grün (nach Abzug von 20 Datei-Wrappern: 3766/3766), 0 rot, 99,5 s
- `npm run test:gates`: 565 Tests, 562 grün, 3 rot — exakt die dokumentierte Baseline (GAP-05, GAP-15 zweimal), kein zusätzliches Rot
- `node --check` auf allen 9 geänderten `.js`/`.mjs`: OK
- Fail-Safe am Code nachgerechnet (Richtungs-Gate in `src/consult/in-call.js:69` und `src/research/in-call.js`), Ausstiegssatz-Position per AL-D3-6 gepinnt
- Gates unberührt: `git diff master...HEAD -- src/` betrifft ausschließlich die drei Prompt-Dateien; Kontingente, Frische, Flag×Tenant×Secret, `lookup-guard`, `sanitizeConsultQuestion`, `disclosureSentence`, `src/claude.js` byte-identisch
- Apparat-Isolation bestätigt: kein Netz außer 127.0.0.1, keine Vererbung von `process.env`, `EXA_API_BASE`/`EXA_API_KEY` in `BASE_ENV` leer (AL-D3-10 pinnt), `TELNYX_API_BASE` kann per Env-Präzedenz von keinem Szenario überschrieben werden
- Kein Bench-Lauf ausgelöst: kein `data/`-Verzeichnis, kein Artefakt im Diff, sauberer Baum
- Commit-Reihenfolge korrekt: `ab49f7f` (Apparat) vor `e42bd3b` (Produkt)

**Vom Safety-Reviewer offen benannte Concerns (kein Blocker, aber vom Lead vor Merge/Messung zu quittieren):**

1. **Bloat über der spec-eigenen 30-%-Schwelle ohne ausdrückliche Begründung.** `lookUpDescription` wächst de +49 % / en +44 % / fr +42 %; die Spec verlangt bei >30 % eine explizite Begründung, die im Branch fehlt. Genau die dokumentierte Lehre (Haiku kippt bei Bloat am Entscheidungspunkt in Überkorrektur, `call-quality-chain`) ist damit unquittiert.
2. **Spec-Abweichung E1.1 nicht als Abweichung ausgewiesen.** Die Spec erlaubte nur die Streichung von „nachschlagen"; umgesetzt wurde die Streichung der gesamten Aufzählung plus des Buchungssatzes. Inhaltlich am Code gedeckt (`boundaryRules` trägt beides), aber mehr als autorisiert und nicht als Abweichung dokumentiert.
3. Dieser Bericht fehlte zum Zeitpunkt der Safety-Review im Branch (wird mit dieser Datei nachgeliefert).
4. **Messlücke:** `d3-consult-verlangt` und `d3-fremde-recherche` tragen eine nicht-leere `mustNotPromiseSubstrings`-Liste, führen aber nicht den zugehörigen `no_invented_promise`-Check — die Liste ist dort tote Konfiguration.
5. E5-3 (`no_consult_fired` auf `mandat-innerhalb`) ist nur formal erfüllt: das Szenario läuft ohne Consult-Env, der Check ist strukturell grün und fängt die vorgesehene Ausweichform heute nicht.
6. Der Apparat wurde nach dem Produkt-Commit noch zweimal gefixt (`f4d2b54`, `152e751`); eine reine „Vorher"-Messung per `checkout ab49f7f` führt den ungefixten Apparat. Empfehlung: Vorher-Messung aus HEAD mit auf master zurückgesetzten Prompt-Dateien fahren, nicht den ganzen Baum zurücksetzen.
7. `scenario.env` steht in `buildEnv` vor den Runner-eigenen Pins und könnte künftig `CLAUDE_MODEL`/`VOICE_ENGINE`/`MAX_BUDGET_EUR` überschreiben — heute nicht genutzt, aber nicht durchgesetzt.

## Clean-Code-Audit (S1–S4)

**Verdict: PASS** — keine S1/S2-Blocker im tatsächlichen AL-D3-Diff (Drei-Punkt-Diff über merge-base, der Zwei-Punkt-Diff zeigt zusätzlich reine Basis-Drift aus dem zwischenzeitlichen auth-p3-Merge auf master, nicht Teil dieser Phase).

- **S1:** keine
- **S2:** keine
- **S3** (Notizen, kein Blocker):
  - `exaResultOf` (`scripts/convo-bench/exa-fake.mjs`) bildet dieselbe Exa-Antwortform wie `exaBody` in `test/al-p10b-lookup.test.js` nach, ohne gemeinsame Extraktion. Kein G5-Blocker (zwei strukturell verschiedene Konsumenten, kleiner Umfang); Fix bei Bedarf: gemeinsame `exaResultShape(title, highlight)`-Hilfsfunktion.
  - `checks.mjs`s `firedToolResult()`/`turnFiredTools()` sind saubere Single-Source-Helfer — positive Feststellung.
- **S4:** keine nennenswerten Struktur-/Anzahl-Auffälligkeiten; neue Dateiaufteilung (`checks.mjs`/`consult-pump.mjs`/`exa-fake.mjs`/`http-fake-helpers.mjs`) folgt SRP sauber.

## Fix-Runden

- **Runde 1** (`phase/al-d3-tool-entscheidungspunkt-fix1`, Commit `f4d2b54`): behoben — G5/S2-Blocker aus dem Review, `readBody(req)` war Byte-für-Byte dupliziert in `scripts/convo-bench/exa-fake.mjs` und `scripts/convo-bench/telnyx-fake.mjs`; auf eine gemeinsame Hilfsfunktion gezogen.
- **Runde 2** (`phase/al-d3-tool-entscheidungspunkt-fix2`, Basis fix1): beide Review-Blocker aus Runde 1 behoben, ein Commit. Unter anderem `AL-D3-RUN1` in `scripts/convo-bench/runner.mjs`: `finally`-Block korrigiert, damit `consultPump.stop()` bei fatalError im Lauf nicht mehr in einer Weise scheitert, die einen gespawnten Server oder den Exa-Fake zurücklässt.

## Was diese Phase NICHT gemessen hat

Diese Phase hat bewusst **keinen Bench-Lauf** gefahren (`npm run convo-bench` wurde nicht ausgeführt — Netzkosten, Spec-Vorgabe B6). Gepinnt wurde ausschließlich der **Wortlaut-Vertrag**: die vier Regeln R1–R4 stehen jetzt in allen drei Sprachen (de/en/fr) mit Ausstiegssatz für den Inbound-Fall, verifiziert durch statische Tests (Substring-Prüfung, Paritätsprüfung, Mutationsproben) und durch Code-Lesung der Gate-Bedingungen (`consultAvailableFor`, `lookupProviderFor`). **Nicht** gemessen wurde, ob das Modell (Haiku, live) diese Werkzeuge daraufhin tatsächlich anders wählt — insbesondere:

- ob R1 (Auftraggeber-Entscheidung verlangt → `get_consult`) im echten Modellverhalten häufiger feuert als vorher
- ob R2/R3 die Trennung auftragsdienlich/auftragsfremd beim Nachschlagen tatsächlich trifft, oder ob das Modell trotz der neuen Verbotsklausel weiter `look_up` bei auftragsfremden Bitten aufruft (oder umgekehrt zu vorsichtig wird)
- der **K4-Befund**: ob der führende, überbrückende Satz bei `look_up` im selben Zug tatsächlich kommt. Der neue Bench-Check `lookup_turn_not_silent` misst nur „der Zug war nicht stumm" — er kann einen Zug mit echtem führendem Satz nicht von einem Zug unterscheiden, der erst nach der Suche spricht (auf dem Shim-Treiber werden alle SSE-Deltas eines Zuges zu einem `sayTexts`-Eintrag gefaltet). Die scharfe Messung bräuchte einen inkrementellen SSE-Leser im Treiber (Vorbild `AL-P10b-7`) und ist ausdrücklich nicht Teil dieser Phase.
- ob der beobachtete Zeichenzahl-Zuwachs (besonders `lookUpDescription` +42…49 %) das Modell an diesem Entscheidungspunkt in Überkorrektur kippen lässt (die dokumentierte `call-quality-chain`-Lehre)

**Bench-Anleitung für den Lead:**

1. Vorher-Messung **nicht** per `git checkout ab49f7f` auf den gesamten Baum — zwei spätere Fix-Commits (`f4d2b54`, `152e751`) reparieren den Apparat selbst (u. a. den `finally`-Pfad gegen verwaiste Kindprozesse). Stattdessen: aus HEAD (`152e751`) starten und nur die drei Prompt-Dateien auf master zurücksetzen: `git checkout master -- src/i18n/prompts/de.js src/i18n/prompts/en.js src/i18n/prompts/fr.js`.
2. Nachher-Messung: HEAD unverändert (`152e751`, enthält Apparat + Produkt).
3. Lauf mit `--repeat 5` je Szenario.
4. Szenarien: die drei neuen (`d3-consult-verlangt`, `d3-nachschlag-auftrag`, `d3-fremde-recherche`) sowie zur Regressionskontrolle die Bestandsszenarien, deren Verhalten kippen könnte: `unerfuellbare-recherche` (schärfste Regressionsprobe von E1 — erwartet `message_taken`, wenn um Nachschlagen gebeten wird, ohne dass `look_up` im Werkzeugsatz liegt), `mandat-innerhalb` (neues `no_consult_fired`, Reichweite formal, s. Concern 5), `mandat-ausserhalb`, `rueckfrage-notausgang`, `friseur-voll`, `inbound-nachricht`.
5. Auswertung: `consult_fired`/`no_consult_fired`, `lookup_fired`/`no_lookup_fired`, `lookup_turn_not_silent` (mit dem Vorbehalt aus §K4 oben), plus die Bestands-Checks (`message_taken`, `no_early_agent_hangup`, `no_invented_promise` — sofern Concern 4 vorher behoben und der Check in die betroffenen Szenarien aufgenommen wurde).
6. Vor jeder Bewertung als PASS: die zwei offenen Concerns 1 und 2 (Bloat-Begründung, E1.1-Abweichungsdokumentation) explizit quittieren, nicht nur den grünen Testlauf werten.

---

# Nachtrag: die Messung (Lead, 2026-08-02)

## Konfiguration, unter der gemessen wurde

`npm run convo-bench`, Treiber `shim`, Provider-Fake Telnyx, **gefälschter Exa-Anbieter**
(lokaler HTTP-Server), **gepumpte Consult-Frische**, Gegenstelle = `claude-haiku-4-5`,
Judge = `claude-sonnet-5`, Agent = `CLAUDE_MODEL`-Default. **n = 5 je Szenario je Stand.**

**Vorher-Stand:** Endstand des Branches, nur die drei Sprachdateien auf `e42bd3b^`
zurückgesetzt. Damit ist der Messapparat in beiden Ständen **byte-identisch** — der
ursprüngliche Plan, gegen den Apparat-Commit `ab49f7f` zu messen, wäre falsch gewesen:
beide Fix-Runden haben den Apparat selbst noch angefasst.

## Das Ergebnis

| Szenario | Regel | Check | vorher | nachher |
|---|---|---|---:|---:|
| `d3-nachschlag-auftrag` | R2 | `lookup_fired` | **5/5** | **5/5** |
| `d3-nachschlag-auftrag` | R4 | `lookup_turn_not_silent` | **5/5** | **5/5** |
| `d3-fremde-recherche` | R3 | `no_lookup_fired` | **5/5** | **5/5** |
| `d3-consult-verlangt` | R1 | `consult_fired` | 0/5 | 1/5 |
| `d3-consult-verlangt` | R1 | `no_message_taken` | 0/5 | 0/5 |

**Die Änderung hat in dieser Konfiguration keine messbare Verhaltensverbesserung
erzeugt.** Jeder Check steht vorher wie nachher gleich; der einzige Unterschied
(`consult_fired` 0/5 → 1/5) ist bei n = 5 Rauschen und wird hier ausdrücklich **nicht**
als Gewinn gewertet.

## Zwei Befunde, die schwerer wiegen als die Tabelle

**B-1 — Der Bench reproduziert den Live-Defekt bei `look_up` gar nicht.**
Live feuerte `look_up` in 0 von 12 Turns. Im Bench feuert es **schon mit den alten
Beschreibungen** in 5 von 5 Läufen. Das Szenario ist also ein leichterer Fall als der echte
Anruf, und ein Vorher/Nachher-Vergleich kann dort per Konstruktion keinen Gewinn zeigen —
es gibt nichts zu reparieren, was hier kaputt wäre. Für R2/R3/R4 ist die Messung damit
**nicht aussagekräftig**, weder positiv noch negativ.

**B-2 — Bei `get_consult` ist der Defekt reproduziert, und die Schärfung bewegt ihn nicht.**
Über 11 instrumentierte Läufe: `get_consult` lag in ~10 Turns im angebotenen Werkzeugsatz
(`offeredToolNames`), gefeuert wurde es **einmal**. `take_message` feuerte stattdessen
durchgehend. Es ist also **kein** Verfügbarkeitsproblem — das Werkzeug liegt auf dem Tisch,
das Modell greift daneben.

## Eine Hypothese, die ich geprüft und widerlegt habe

Verdacht: der Systemprompt kontert die Tool-Beschreibung. `MANDATE_OUT_OF_SCOPE_DEFAULT`
ist `take_message`, und der AUSSERHALB-Block rendert **immer**, sobald ein Mandat vorliegt —
mit dem wörtlichen Satz „…gib es über take_message weiter und sag zu, dass {owner} sich
meldet." (`src/i18n/prompts/de.js`, `outOfScopeSentence`). Das steht eine Ebene über der
Tool-Description.

Gegenversuch: dasselbe Szenario mit `on_out_of_scope: "decline"`, n = 5.
Ergebnis: `get_consult` **0/5**, `take_message` 2–4 mal je Lauf. **Der Systemprompt ist
nicht die Ursache.** Die Hypothese ist erledigt, nicht offen.

Am Rande, aber festzuhalten: dass jeder Outbound-Anruf mit Mandat diese
`take_message`-Anweisung trägt, ist Produktionsverhalten und war vorher niemandem
aufgeschrieben.

## Regressionsproben

| Szenario | Ergebnis |
|---|---|
| `unerfuellbare-recherche` (schärfste Probe zu E1) | 5/5 Läufe judge=pass, Checks 10/10 bzw. 9/10 — die Streichung von „nachschlagen" aus der Fähigkeitsliste hat das Punten per Nachricht **nicht** beschädigt |
| `inbound-nachricht` (Inbound-Wächter zu B2) | `result_slots_present` 0/5 rot — **vorbestehend**, im Vorher-Stand ebenfalls 0/2 rot. Alle übrigen Checks grün, `message_taken` unberührt |

## Was damit belegt ist — und was nicht

Belegt:

- Der **Wortlaut-Vertrag** steht in drei Sprachen und ist gegen stille Divergenz gesichert
  (die Falle war vorher offen: kein Test färbte eine reine DE-Änderung rot).
- `take_message` behauptet nicht mehr, Nachschlagen sei eine fehlende Fähigkeit. Das war
  seit AL-P10b schlicht **falsch** und ist unabhängig vom Messergebnis eine Korrektur.
- Der **Messapparat existiert** und funktioniert — ohne ihn hätte dieser Befund nicht
  erhoben werden können, weil beide Werkzeuge im Bench strukturell abwesend waren.
- Keine Regression in den geprüften Bestandsszenarien.

Nicht belegt:

- Dass D-3 behoben ist. **R1 ist offen.** Eine Klausel in der Tool-Description reicht
  gegen `take_message` nicht.
- Dass R2/R3/R4 live wirken. Der Bench trifft den Live-Fall nicht (B-1).

## Was als Nächstes zu klären wäre (nicht Teil dieser Phase)

1. **Warum `take_message` gewinnt.** Der nächste Schritt ist eine Diagnose, keine weitere
   Formulierungsrunde — zwei Prompt-Anläufe ohne Wirkung sind genug. Kandidaten:
   `take_message` steht **vor** `get_consult` im Werkzeug-Array; seine Beschreibung öffnet
   mit „Nimmt eine Nachricht oder ein Anliegen für den Besitzer auf", was den Fall „der
   Chef soll entscheiden" wörtlich abdeckt; und der AUSSERHALB-Block nennt es zusätzlich.
2. **Ein Bench-Szenario, das den Live-Fall bei `look_up` wirklich trifft** — sonst misst
   jede künftige Phase dort weiter am Problem vorbei (B-1).
3. Der Vorbehalt zu `lookup_turn_not_silent` aus dem Abschnitt oben bleibt bestehen: der
   Check kann einen echten führenden Satz nicht von einem nach der Suche gesprochenen
   unterscheiden. **K4 ist damit weiterhin ungemessen.**

**Kosten der Messung:** rund 1,20 USD über ~45 Gespräche.
