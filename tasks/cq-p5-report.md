# P5 — Prompt-Redesign inkl. Umlaut-Priming (Commit B) · Detailbericht

**Gate: PASS**
**finalBranch:** `phase/cq-p5-prompt-fix1`
**headCommit:** `493d163b7d5c67fd5ab2ade908191025cafa1219` (+ Fix-Runde r1, siehe unten)
**Repo-Basis:** `master` = `b71cf3a` (P0–P4 + P1b gemergt)
**Tests:** 2486/2486 grün, 0 fail, 0 skipped (+7 netto-neue Tests ggü. `b71cf3a` = 2479)

---

## 1. Plan (gekürzt)

### Ausgangslage (Abschnitt 0)

| Fläche | Ist-Stand auf `master` |
|---|---|
| `src/claude.js` `systemPrompt(call)` | `base`-Template (Header + 15-Bullet-Regelblock) + richtungsabhängiger Tail; Regeln standen **vor** der Situation; vollständig transliteriert. |
| `src/claude.js` `assistantContextSection(call)` | Labels `Verhaeltnis zum Angerufenen:`, `Gewuenschtes Ergebnis:`, Guardrail `…ist fuer dich;` |
| `src/claude.js` `toolDefs()` | Genau 2 Tools (P1b): `end_call` + `take_message`, beide transliteriert |
| `src/i18n/locales.js` | DE `speechClause` und `STYLE_CLAUSES_DE["warm-persoenlich"]` einzige transliterierte Strings, die in `systemPrompt` fließen |
| `src/bridge.js` | `instructions(call)` hängt Barge-in-Satz an `"…lass dich unterbrechen."` |
| Baseline | 35/35 Kern-Pin-Tests grün (selbst verifiziert) |

Drei P5-Listenpositionen waren durch P1b bereits gegenstandslos (`:254-261`, `:262-284`, `:164`,
plus am Code nachgeprüft ein viertes totes `calendarExcerpt`-Fragment bei `claude.js:146`) — **nicht
gesucht, nicht angefasst**. Zwei `locales.js`-Positionen (`realtimeOpener`, `summarySystem`) kollidieren
mit P1s eigenem Test `P1-U3` (pinnt beide *positiv* als transliteriert) und lagen außerhalb des
P5-Ziels (dormant bzw. nie gesprochen) → bewusst nicht geändert, als Owner-Auflage vermerkt.

### Bindende Entscheidungen (D1–D10)

- **D1** Anhang A ist der Inhalt, wörtlich; einzige Abweichungen D2–D7.
- **D2** Deterministische Hard-Wrap-Auflösung für Anhang A (eingerückte/nicht-satzendende Folgezeilen = Fortsetzung).
- **D3** Prompt-Text trägt korrekte Orthografie inkl. `ß` (bewusster Bruch mit der `locales.js`-TTS-Konvention, da Prompt-Text nie gesprochen wird); Kommentare bleiben ASCII.
- **D4** `end_call`-Description: nur die drei Umlaut-Ersetzungen (`Gegenuebers`→`Gegenübers`, `unverstaendlich`→`unverständlich` ×2), kein Wort mehr/weniger.
- **D5** Stil-Key `"warm-persoenlich"` ist Datenwert (validiert in `PERSONA_STYLE_IDS`/`updateSettings`) — **nur der Klauselwert ändern, NIE der Key**.
- **D6** Inbound behält Überschrift `SO KOMMST DU ZUM ERGEBNIS:`, nur der Rumpf wird ersetzt.
- **D7** Inbound-Identitätspunkt richtungskorrekt: „…oder für wen du **sprichst**" statt „…anrufst".
- **D8** Ternary-Leerzeilen (`briefing`/`constraints`/`allow*`) fallen weg — Umbau auf gefilterte Arrays; fail-closed-Semantik identisch; `context: null` bleibt byte-identisch zur kontextlosen Baseline.
- **D9** „lege niemals auf, bevor er geantwortet hat" fällt weg, ersetzt durch „Warte nach deinem Anliegen IMMER auf die Antwort des Angerufenen, bevor du weiterredest." Strukturelle Sicherung (`shouldSuppressEndCall`, `END_CALL_WAIT_INSTRUCTION`, `end_call`-Description) bleibt unangetastet.
- **D10** Vorgehensreihenfolge bindend: Tests schreiben → rot sehen → `src/*` ändern → Charakterisierungstests laufen lassen → **Diff aus der Assertion-Fehlermeldung** in die `EXPECTED_SP_*`-Literale übernehmen. Niemals umgekehrt.

### Neue Dateien laut Plan

- `test/umlaut-stems-helper.js` — eine Denylist-Quelle (G5): `SPOKEN_TRANSLITERATION_STEMS` (P1-Bestand, unverändert) + `TRANSLITERATION_STEMS` (Vereinigung mit `PROMPT_STEMS` für P5).
- `test/cq-p5-prompt-redesign.test.js` — 7 Tests P5-O1…O7 (Orthografie in allen 6 Sprach/Richtungs-Kombis, Gegenprobe echter Umlaute, Tool-Description-Orthografie, Situation-vor-Regeln, inbound ohne DEIN-AUFTRAG-Block, 6 neue Telefonie-Marker, Wegfall der „Alles klar,"-Floskel).

### Edits laut Plan

- `src/claude.js`: `systemPrompt` von Monolith zu Composer + sechs Ein-Argument-Sektionsbuildern (`promptInputs`, `personaHeader`, `inboundSituation`/`outboundSituation`, `assignmentBlock`, `speechRules`, `clarificationRules`, `boundaryRules`) + zwei Modul-Konstanten für den Abschluss; `assistantContextSection`-Labels/Guardrail auf Umlaute; `toolDefs()` `end_call` nur 3 Umlaute, `take_message`-Description komplett neu (trägt jetzt die engen Verbote, P1b-Lehre: enge Verbote am Tool-Entscheidungspunkt).
- `src/i18n/locales.js`: `STYLE_CLAUSES_DE["warm-persoenlich"]`-**Wert** + `speechClause` auf Umlaute; Key unverändert; `realtimeOpener`/`summarySystem`/FR/EN unangetastet.
- `src/bridge.js`: Barge-in-Halbsatz „Mache kleine Pausen moeglich, lass dich unterbrechen." streichen (Barge-in läuft über `server_vad`, nicht Modellentscheidung); Prosodie-Rest bleibt transliteriert (dormanter Pfad laut L3).
- Elf Bestandstest-Dateien: Pins über Testnamen aufgelöst, nie über Zeilennummern (`personal-assistant-characterization`, `persona-style`, `c1-auftragstreue`, `assistant-context-render`, `p1b-no-booking`, `f1-i18n-locale`, `afix-p4-end-call-discipline`, `de-umlaut-orthography`). Fünf Dateien explizit **nicht** anfassen (`g2-opening-turn`, `disclosure-regression`, `claude-identity`, `g1-identity-binding`, `l3-prompt-caching`) — Merksatz des Plans: „Wird einer rot, ist zu viel geändert worden — nicht den Test anpassen."

### Abnahmekriterien

Sonderregel P5 (Owner-Entscheidung): **PASS, sobald der Code steht und die Suite grün ist.** Die
Bench-Kriterien (a) Judge-Mittel/Check-Pass-Rate, (b) Transliterations-Check im Bench, (c) neue
Szenarien ≥ 80 % bleiben ausdrücklich „Abnahme offen" — Baseline weder erheben noch schätzen, kein
`npm run convo-bench` gegen echte APIs im Agenten-Anteil.

---

## 2. Implementierungs-Zusammenfassung

Umgesetzt im isolierten Worktree, Branch `phase/cq-p5-prompt` von `master`=`b71cf3a`,
`headCommit` `493d163b7d5c67fd5ab2ade908191025cafa1219`, testPassCount 2486, testFailCount 0.

**`src/claude.js`**: `systemPrompt(call)` komplett umgebaut zu Composer + sechs Sektions-Buildern
mit je genau einem Objekt-Argument (F1): `promptInputs`, `personaHeader`,
`outboundSituation`/`inboundSituation`, `assignmentBlock`, `speechRules`, `clarificationRules`,
`boundaryRules`, plus `OUTBOUND_OUTCOME_SECTION`/`INBOUND_OUTCOME_SECTION` als Modul-Konstanten.
Reihenfolge jetzt SITUATION → AUFTRAG → SO SPRICHST DU → WENN ETWAS UNKLAR IST → DEINE GRENZEN →
SO KOMMST DU ZUM ERGEBNIS (vorher: 17 Regelzeilen vor der Situation). Vier neue Telefonie-Lücken
geschlossen (Warten/Hold, Personenwechsel, Identitäts-Rückfrage richtungsabhängig gemäß D7,
Ziffern/Preise/Buchstabieren) plus Fähigkeits-Ehrlichkeit + Werkzeug-Sparsamkeit.
`assistantContextSection`-Labels + Guardrail auf Umlaute gehoben (D3). D8 umgesetzt:
`assignmentBlock`/`boundaryRules` bauen aus gefilterten Arrays statt Leerstring-Ternaries, keine
Füll-Leerzeilen mehr; `context: null` bleibt laut R2-Test byte-identisch zur kontextlosen Baseline.
`toolDefs()`: `end_call`-Description nur die 3 Umlaute nachgezogen (D4, wortgenau); `take_message`-
Description komplett neu (trägt jetzt die engen Verbote, die vorher auf 4 Tools verteilt waren,
P1b-Lehre). Tool-Namen, `input_schema`, `execTool`-Rückgaben unverändert.

**`src/i18n/locales.js`**: `STYLE_CLAUSES_DE["warm-persoenlich"]`-Wert und `speechClause` auf Umlaute
gehoben; der Key `"warm-persoenlich"` bewusst unverändert (D5, `PERSONA_STYLE_IDS`/`updateSettings`-
Validierung hängt daran). `realtimeOpener`/`summarySystem`/FR/EN nicht angefasst (P1-U3-Grenze
respektiert). Kopfkommentar ergänzt.

**`src/bridge.js`**: Barge-in-Halbsatz „Mache kleine Pausen moeglich, lass dich unterbrechen."
gestrichen (irreführend — Barge-in läuft über `server_vad`, nicht durch Modellentscheidung);
Prosodie-Hinweis bleibt, Reststring bleibt transliteriert (dormant laut L3).

**Neue Tests**: `test/umlaut-stems-helper.js` (eine Denylist-Quelle, G5 — P1-Bestand
`SPOKEN_TRANSLITERATION_STEMS` unverändert übernommen + P5-Ergänzung `PROMPT_STEMS` für die
Vereinigung `TRANSLITERATION_STEMS`). `test/cq-p5-prompt-redesign.test.js` (7 Tests P5-O1…O7) —
rot-vor-Fix nachgewiesen (6/7 rot gegen den alten Prompt, O5 zufällig schon grün, siehe Deviations).

**Bestandstests nachgezogen** (D10-Workflow: Diff aus der Assertion-Fehlermeldung übernommen, nicht
erraten): `personal-assistant-characterization` (alle 6 SP-Literale per Skript aus dem tatsächlichen
Output eingefroren), `p1b-no-booking` (`UNCONDITIONAL_LINES` auf Präfix-Pins wegen
Owner-Interpolation), `persona-style` (PS2/PS3 auf die neue Zeilen-Struktur, `FIXED_RULE_FRAGE`
entfernt — Länge+Frage sind jetzt ein Punkt), `assistant-context-render` (Guardrail-Umlaut,
Positions-Anker `WICHTIG:`→`SO SPRICHST DU:`), `c1-auftragstreue` (Umlaut-Wortlaut + D9-Wait-Klausel),
`afix-p4-end-call-discipline` (3 Umlaute in `END_CALL_UNDERSTANDING_CLAUSE`), `f1-i18n-locale`
(`DE_SPEECH_CLAUSE`), `de-umlaut-orthography` (lokale Regex durch Helper-Import ersetzt, G5,
verhaltensneutral).

**Nicht angefasst** (wie im Plan verlangt): `g2-opening-turn`, `disclosure-regression`,
`claude-identity`, `g1-identity-binding`, `l3-prompt-caching` — alle liefen unverändert grün, vor UND
nach dem `src`-Umbau bestätigt.

**Verifikation**: `node --check` auf allen 3 `src`- + allen geänderten `test`-Dateien grün. Volle
Suite `npm test` zweimal grün (2486/2486, 0 fail) — ein einzelner Full-Load-Flake in
`voice-incoming-catch-path.test.js` (unrelated file) trat einmal auf, isoliert + im Re-Run sofort
grün (Flake-Protokoll: nur isoliert-rot zählt als echt). `test/telnyx-p5-gate-proof.test.js` isoliert
grün (14/14). Manueller Smoke: Server gebootet (PORT=3999, SKIP_TWILIO_SIGNATURE_CHECK=true,
Dummy-Env + `scripts/bootstrap-tenant.js` für die Owner-Nummer), `/healthz` → 200, `POST
/voice/incoming` → 200 mit `charset=utf-8`.

Negativ-Gegenprobe-Grep (Plan-Vorgabe „erwartet 0"): tatsächlich 3 Treffer, alle in
Code-Kommentaren (Substring „Buchung" in „Buchungs-"), 2 davon bereits auf `master` vor dieser Phase
vorhanden, 1 neu (Kommentar an `boundaryRules`). Der eigentliche funktionale Beweis (kein
Kalender-/Buchungs-Text im gerenderten Prompt) läuft über `p1b-no-booking.test.js` gegen den echten
Prompt-Output und ist grün — dokumentierte Abweichung, kein Blocker.

### Deviations gegenüber dem Plan

1. Plan erwartete alle 7 P5-O*-Tests rot-vor-Fix; **P5-O5** (inbound ohne DEIN-AUFTRAG-Block) war im
   Altbestand zufällig bereits erfüllt und lief schon vor dem `src`-Umbau grün. Kein funktionales
   Problem, nur eine ungenauere Plan-Vorhersage.
2. Abschnitt-4-Grep-Gegenprobe (`grep -c "Buchung\|book_appointment\|get_calendar\|…" src/claude.js`)
   erwartete 0, liefert 3 — alle drei Treffer sind Code-**Kommentare** (Substring „Buchung" in
   „Buchungs-"), 2 davon bereits auf `master` (`b71cf3a`) vor dieser Phase vorhanden, 1 neu (eigener
   Kommentar an `boundaryRules`). Der eigentliche funktionale Beweis läuft über
   `p1b-no-booking.test.js` gegen den echten Prompt-Output (0 Marker im gerenderten Prompt) und ist
   grün — die Plan-Grep-Vorgabe unterscheidet nicht zwischen Kommentar und Prompt-String.

### Clean-Code-Selbstcheck (Implementierungs-Runde)

Gegen `.claude/refs/clean-code.md` geprüft: G5/S2 (Denylist lebt in einer Datei statt dupliziert);
G25 (keine neuen Magic Numbers); C5/G9 (kein toter/auskommentierter Code — alter `systemPrompt`-Block
vollständig ersetzt); G12 (keine ungenutzten Imports); N7 (alle sechs neuen Sektions-Builder sind
reine Funktionen, kein Store-/Netz-/Uhr-Zugriff außer `promptInputs`); G30/G34 (ein Builder = eine
Sektion, keiner greift selbst auf store/config zu); F1 (alle Builder nehmen genau ein
Objekt-Argument); P15 (nicht berührt); C2 (Kommentare referenzieren Testnamen/Plan-Abschnitte D3/D4/
D7/D8/D9/P5-O6, keine Zeilennummern); ESM/kein Build-Step/kein TypeScript eingehalten; Kommentare
deutsch ohne Umlaute eingehalten (nur String-Literale tragen Umlaute — das ist die Absicht der
Phase).

---

## 3. Safety-Urteil

**approved: true** — keine Blocker, `testsPassIndependently: true`, `safetyGatesIntact: true`,
`disclosureIntact: true`, `authFailClosedIntact: true`, `noSecretsLeaked: true`,
`scopeRespected: true`, `behaviorAsIntended: true`.

### Unabhängige Verifikation (Kurzfassung)

Frischer Worktree, `node_modules` auf das Haupt-Repo gelinkt, Branch `review-p5-r1` aus
`phase/cq-p5-prompt-fix1` (2 Commits: `493d163` + `bdba20d`).

- **JSON-Backend (kanonisch)**: 2486/2486 pass, 0 fail, ~94s. Master-Baseline im selben Worktree
  (detached `b71cf3a`): 2479/2479 — +7 netto-neue grüne Tests, keine verlorene Abdeckung.
- **PG erzwungen** (`STORE_BACKEND=pg`): Branch 2204/2166 pass, 38 Datei-Fehler; Master-Baseline
  (gleiches Env) 2203/2166, 37 Fehler. Diff der Fehler-Dateilisten = genau eine Datei: das neue
  `cq-p5-prompt-redesign.test.js`, mit demselben vorbestehenden Umgebungsartefakt
  (`[store] FATAL: pg-Backend nicht initialisierbar`) wie die 37 Master-Dateien — keine P5-Regression.
  Der echte pg-Pfad (pglite, in-Suite) ist im JSON-Lauf mit fail=0 abgedeckt.
- **Fokussierter Lauf** der 12 prompt-/offenlegungsrelevanten Dateien: 107/107 grün.
- **Falsifikationsprobe** (wichtigster Beleg): Master-`src` (`claude.js`/`locales.js`/`bridge.js`)
  temporär eingespielt, neue Testdatei dagegen gefahren → 6 von 7 Assertions rot (O1 Orthografie, O2
  Gegenprobe, O3 Tool-Descriptions, O4 Reihenfolge, O6 vier neue Telefonie-Punkte, O7
  „Alles klar,"-Floskel). Test ist echt falsifizierend, kein Rubber-Stamp. Worktree danach restauriert,
  `git status` sauber.
- **Runtime-Smoke**: voller Server-Boot → `/healthz` 200 `{"ok":true}`; `POST /voice/incoming` → 200,
  `text/xml; charset=utf-8`, Content-Length 175 = UTF-8-Bytezahl 175, gerenderter Satz „Auf
  Wiederhören" byte-korrekt.
- **Prompt-Dump zur Laufzeit** (outbound de mit briefing+constraints, inbound de, outbound fr, alle
  drei Offenlegungen, `openingText`, beide Tool-Descriptions) gegen Anhang A A.1/A.2/A.3 Zeile für
  Zeile verglichen: deckungsgleich inkl. der drei markierten Inbound-Abweichungen.

### Gate-für-Gate-Prüfung

- **SAFETY-GATES**: Diff fasst genau drei `src`-Dateien an (`claude.js`, `bridge.js`,
  `i18n/locales.js`). Keine Datei mit Gate-Logik (config, server, voice, telephony, auth, billing,
  store, middleware, guard) berührt — grep über die Dateiliste liefert keine Treffer.
  `numberGateError`, Denylist/Land/Stundenlimit, Budget-Guard, Max-Dauer und Provider-
  Signaturprüfung byte-identisch zu master. Die beiden `allow*`-Gates im Prompt behalten exakt ihre
  fail-closed-Semantik: aus `${s.allowPersonalData ? "" : "- Du gibst KEINE…"}` wurde
  `if (!s.allowPersonalData) lines.push(...)` — die Verbotszeile steht weiterhin, solange nicht
  ausdrücklich erlaubt; nur die vorher gerenderte Leerzeile fällt weg. Die strukturelle
  `end_call`-Sicherung (`shouldSuppressEndCall` + `END_CALL_WAIT_INSTRUCTION`, genutzt von
  Budget-Engine UND `bridge.js`) ist unverändert; nur ihre Prompt-Ebene ist umformuliert, und
  `c1-auftragstreue` pinnt die neue Formulierung.
- **OFFENLEGUNG**: `disclosureSentence()`, `LOCALES.{de,fr,en}.disclosure` und `openingText()` sind
  byte-unverändert; Offenlegungs-Pins in `personal-assistant-characterization` im Diff nicht
  angefasst, `disclosure-regression.test.js` überhaupt nicht modifiziert und grün. Laufzeit-Dump
  bestätigt den Offenlegungssatz als ersten gesprochenen Satz (LLM-frei). Realtime-Pfad sauber:
  `bridge.js` ändert nur die `instructions()`-Prosodie-Zeile; `realtimeOpener`, der den
  Offenlegungssatz als Pflicht-Erstsatz erzwingt, ist unberührt. Der gestrichene Barge-in-Halbsatz
  ist in der Spec ausdrücklich entschieden („streichen, nicht konkretisieren"), Fix-Commit belegt die
  Regression fälschungsgeprüft.
- **AUTH FAIL-CLOSED / SECRETS**: Keine Auth-Fläche im Diff, kein neuer Endpunkt, Boot-Smoke grün.
  Keine neue console-/log-Ausgabe im `src`-Diff, keine Secrets, keine Env-Namen in Prompt oder
  Kommentar. Audio-durch-MCP nicht berührt.
- **SCOPE**: `package.json`/`package-lock.json` byte-identisch — keine neue Dependency. Keine Datei
  außerhalb der P5-Spec-Liste. Die zwei durch P1b gegenstandslos gewordenen Spec-Positionen
  (`get_calendar`, `book_appointment`) wurden korrekt **nicht** nach Zeilennummer gesucht/angefasst.
  In `locales.js` sind exakt die zwei Prompt-Bausteine auf Umlaute gehoben, `realtimeOpener`/
  `summarySystem` bewusst transliteriert geblieben — P1-U3-Abgrenzung intakt.
- **ORTHOGRAFIE-RISIKO** (heikelste Stelle der Phase, explizit geprüft): verifiziert, dass
  `speechClause` und `styleClause` **ausschließlich** in `claude.js` `systemPrompt` konsumiert werden
  (grep über `src/`) — sie erreichen niemals einen TTS-Renderpfad. Der Umlaut-Flip verletzt damit die
  Umlaut-Wurzel-Regel (ASCII-Transliteration für GESPROCHENE DE-Strings) nicht. Der Katalog-Key
  `warm-persoenlich` blieb korrekt unverändert.
- **TEST-INTEGRITÄT**: Byte-Pins in `personal-assistant-characterization` bleiben strikte
  `assert.equal`, Testanzahl unverändert (19) — kein Pin auf ein weicheres `includes` aufgeweicht.
  `persona-style` verliert `FIXED_RULE_FRAGE`, aber nachweislich weil Länge und „höchstens eine
  Frage" in Anhang A ein Punkt geworden sind — Regel bleibt in `FIXED_RULE_KURZ` gepinnt.

### Concerns (kein Blocker, dokumentiert)

1. Bench-Abnahmekriterien (a)–(c) aus der P5-Spec sind **nicht gemessen** — durch Owner-Entscheidung
   in Commit `d56831d` gedeckt („Bench-Baseline blockiert die Kette nicht"), bedeutet aber: der Merge
   geht ohne jeden empirischen Beleg, dass der deutlich längere Prompt die Gesprächsqualität nicht
   verschlechtert.
2. Verhaltens-Entfernung ohne Testabdeckung: die alte Prompt-Zeile „Nenne das Ergebnis eines
   Tool-Aufrufs in deiner nächsten gesprochenen Antwort — der Gesprächsverlauf ist deine einzige
   Erinnerung daran." fällt ersatzlos weg. Anhang A enthält sie nicht, spec-konform; nur teilweise
   kompensiert durch die neue `take_message`-Description. Kein Test pinnt dieses Verhalten.
3. Prompt ist substanziell länger als der Ist-Stand — vorgeschriebene Reaktion bei fallendem
   naturalness/efficiency im Bench ist **Kürzen** (zuerst Buchstabieren + Personenwechsel), nicht
   Nachschärfen.
4. Namenskollision geprüft: `tasks/p5-report.md` (frühere cc-P5-Phase, Provider-Registry) existiert
   bereits auf master — dieser Bericht liegt unter dem eigenen Dateinamen `cq-p5-report.md` und
   überschreibt ihn nicht.
5. eslint ließ sich im Review-Worktree nicht ausführen (`@eslint/js` fehlt auch im Haupt-Repo-
   `node_modules`) — vorbestehende Umgebungslücke, kein P5-Befund. `node --check` auf allen drei
   geänderten `src`-Dateien sauber.
6. Der erzwungene globale `STORE_BACKEND=pg`-Lauf ist nicht der projekteigene pg-Testpfad (BASE_ENV
   pinnt Spawn-Tests auf json, pg läuft in-process über pglite) — die dortigen Dateifehler sind reine
   Umgebungsartefakte.

---

## 4. Clean-Code-Audit

**blocker: false** — **s1: []**, **s2: []**, **s4: []**.

### s3 (nicht blockierend)

1. `src/claude.js` (`boundaryRules`) — „Handle sparsam: du hast pro Antwort nur wenige
   Werkzeugaufrufe." ist eine vage Prompt-Anweisung ohne konkrete Zahl/Grenze und ohne
   Code-Gegenstück (kein `MAX_TOOL_CALLS`-Gate gefunden) — liest sich wie eine Absicherung, ist aber
   nicht überprüfbar. Fix-Vorschlag: entweder konkretisieren („höchstens zwei Werkzeugaufrufe") oder
   als bewusst weiche Stilregel kennzeichnen; kein Blocker, da reine LLM-Prompt-Copy und keine
   Code-Invariante behauptet wird.
2. `test/cq-p5-prompt-redesign.test.js` — Testname „P5-O6 die vier neuen Telefonie-Punkte" vs. sechs
   Marker-Strings im Array — inhaltlich konsistent aufgelöst durch die Kommentare in
   `clarificationRules`/`boundaryRules` (4 Lücken, 2 davon mit je 2 Markern getestet), aber der
   Testname selbst zählt nicht nach; leichte Verwirrung für Leser, die nur den Testnamen sehen.

### Verdict (Volltext)

„PASS. Sauberer, gut begründeter Prompt-Umbau (`systemPrompt()` von einer ~70-Zeilen-
Monolith-Funktion in sieben kleine Ein-Argument-Sektionsfunktionen zerlegt, F1/G30/G34 vorbildlich
eingehalten). Safety-Invarianten unangetastet: `disclosureSentence` bleibt byte-identisch fest
verdrahtet, die fail-closed-Semantik der `allowPersonalData`/`allowBankData`-Gates ist beim
Ternary→if-Umbau exakt erhalten (Default false → Restriktionszeile steht), Kalender-/
Buchungsverbote bleiben unbedingt. Volle Testsuite lokal grün: 2486/2486, inkl. neuer
P5-O1…O7-Tests, die genau die Phasen-Zusagen (Umlaut-Orthografie, Situation-vor-Regeln,
Lücken-Marker) mit Positiv- UND Gegenprobe pinnen. Der Review-Fix1-Commit
(Barge-in-Halbsatz-Entfernung in `bridge.js`) ist mit echter Regressionsverifikation im Test
abgesichert (Fehlschlag bei Wiedereinfügen belegt). Einzige Beobachtung: die fünf/sechs fast
identischen `EXPECTED_SP_*`-Golden-Master-Blöcke in `personal-assistant-characterization.test.js`
sind stark textlich dupliziert — das ist aber ein vorbestehendes Testmuster (Characterization/
Golden-Master), das bereits vor P5 in gleicher Form existierte, und ein Refactoring in gemeinsame
Bausteine würde die Tests an die Produktionsstruktur koppeln und ihren Sinn (unabhängige
Volltext-Pins) untergraben — daher kein S2-Flag, sondern PASS unter Regel 3
(Vorrang Lesbarkeit/Testwert)."

### passNotes

G5 sauber angewandt: neue Datei `test/umlaut-stems-helper.js` dedupliziert die Umlaut-Denylist
zwischen `de-umlaut-orthography` und dem neuen `cq-p5-prompt-redesign`-Test (eine Quelle, zwei
Exports für unterschiedliche Scopes). Kommentare tragen durchgängig Begründung und Bezug zu den
D-Nummern des Plans — keine Widersprüche zum Code gefunden (C2 PASS). Keine Magic Numbers außer der
schon vorher etablierten `OPENING_GOAL_MAX_CHARS`-Konstante (unverändert). Keine toten Funktionen,
kein auskommentierter Code, keine abgeschalteten Sicherungen. `node --check` auf den drei geänderten
`src`-Dateien fehlerfrei. Keine anderen Aufrufer von `systemPrompt`/`toolDefs` betroffen (nur
`bridge.js`, Signatur unverändert).

### topTodos (optional, kein Blocker)

1. „Handle sparsam"-Zeile in `boundaryRules` konkretisieren (z. B. Obergrenze nennen) statt vage zu
   bleiben.
2. Testname `P5-O6` auf die tatsächliche Zahl der Marker (6) oder auf „die neu geschlossenen
   Telefonie-Lücken" ohne Zahl umstellen, um die 4-vs-6-Verwirrung zu vermeiden.

---

## 5. Fix-Runden

**r1** — Behob den einzigen genannten Review-Blocker (fehlende Verifikation der P5-
Verhaltensänderung an `src/bridge.js` `instructions()`): im bestehenden Open-Handshake-Test
(`test/bridge-openai-event.test.js`) zwei Assertions ergänzt, die `sessionUpdate.session.instructions`
prüfen — (1) enthält NICHT mehr den Barge-in-Halbsatz „lass dich unterbrechen.", (2) der
Prosodie-Rest „natuerlich, zuegig, kurze Saetze." bleibt erhalten. Damit ist die in D-Regel des Plans
verlangte „streichen, nicht konkretisieren"-Änderung an `bridge.js` erstmals durch eine echte
Regressionsprobe abgesichert (Fehlschlag bei Wiedereinfügen des Halbsatzes belegt, laut Safety-
Review nachvollzogen). Ergebnis nach r1: Gate PASS, `finalBranch` `phase/cq-p5-prompt-fix1`, keine
weitere Fix-Runde nötig.

---

## 6. Offene Owner-/Deploy-Auflagen (NICHT-AGENTEN-ARBEIT, Restrisiken, Bestandsdaten-Auflagen)

Diese Punkte sind ausdrücklich **nicht** Teil des Agenten-Anteils dieser Phase und wurden nicht
versucht:

1. **Live-Probeanruf mit frei generiertem Umlauttext** (z. B. „frag nach den Öffnungszeiten für
   nächste Woche") — der eigentliche Test der Priming-These. Der Bench kann das strukturell nicht
   prüfen (kein TTS). **Bleibt der Effekt aus, ist die These widerlegt — dann kein Nachschärfen der
   Umlaut-Anweisung im Prompt.**
2. **Bench-Vergleichslauf** `npm run convo-bench` mit `n ≥ 5` über die 6 Bestands- + 4 neuen
   Szenarien gegen die P4-Baseline (P4-Merge-Commit `b71cf3a` als Vorher-Stand). Echte API-Kosten,
   nicht vom Agenten ausgeführt. Deckt die drei offenen Abnahmekriterien (a)–(c) der P5-Spec ab.
3. **Deploy-Hinweis**: Die Prompt-Änderung wirkt sofort auf jeden Live-Call, sobald deployt — kein
   Env-Flip, kein Render-Eingriff nötig. Rollback = Revert dieses Commits (Commit A/P1 bleibt live).
4. **Owner-Entscheidung offen**: sollen `realtimeOpener` und `summarySystem` (dormanter bzw. nie
   gesprochener Pfad) doch orthografisch nachgezogen werden? Dann fällt der P1-Test `P1-U3` und muss
   mit umgedreht werden. Default dieser Phase: **nein**.
5. **Restrisiko — Prompt-Länge**: Der neue Prompt ist deutlich länger als der Ist-Stand. Fällt
   `naturalness`/`efficiency` im Owner-Bench, ist die vorgeschriebene Reaktion **Kürzen** (zuerst
   Buchstabieren + Personenwechsel — die seltensten Fälle streichen), **nicht** Nachschärfen. Diese
   Reihenfolge ist im Report festgehalten, damit eine Folgesession nicht in Prompt-Basteln kippt.
6. **Restrisiko — ungetestete Verhaltens-Entfernung**: die alte Anweisung, Tool-Ergebnisse in der
   nächsten gesprochenen Antwort zu nennen, ist ersatzlos weggefallen (Anhang-A-konform, aber
   ungetestet). Falls Haiku nach einem `take_message` beobachtbar stumm weitermacht, fällt das erst
   im Bench oder Live-Probeanruf auf — kein automatisierter Test pinnt dieses Verhalten aktuell.
7. **eslint-Umgebungslücke** (`@eslint/js` fehlt im Haupt-Repo-`node_modules`) — vorbestehend, kein
   P5-Befund, aber blockiert lokal jede eslint-gestützte Nachprüfung bis behoben.
8. **Namenskollision beachtet**: `tasks/p5-report.md` (ältere cc-P5-Phase, Provider-Registry) bleibt
   unangetastet; dieser Bericht liegt unter `tasks/cq-p5-report.md`.
