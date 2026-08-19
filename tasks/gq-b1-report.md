# Phase GQ-B1 — place_call-Briefing und Tempo

**Gate:** PASS
**finalBranch:** `phase/gq-b1-briefing-fix1`
**Basis:** `master` @ `a687f5e`

## Ziel

Drei Verhaltensmängel der `place_call`-Tool-Beschreibungen beheben:

1. Das `briefing`-Feld durfte eine Wissenslücke vorwegnehmen ("der Auftraggeber meldet sich") — das schaltet den Rückfragekanal für genau diese Lücke ab, statt eine Antwort zu liefern.
2. Zu viele Vorab-Rückfragen an den Nutzer vor dem Wählen (mehrfaches "ask the user FIRST").
3. Kein Token-Deckel auf die `place_call*`-Beschreibungen, die bei jedem Client-Turn mitgeschickt werden.

## Plan (gekürzt)

- **Basis:** `master @ a687f5e`, bindend `tasks/gq-b1-spec.md`.
- **Blast-Radius:** 2 Produktionsdateien (nur Stringliterale/Kommentare: `src/mcp-tools.js`, `src/mcp-server-info.js`), 2 Bestandstests, 1 neue Testdatei. Kein Laufzeitpfad, keine Gate-Logik, kein Schema-Feld, keine Dependency.
- Vorab am laufenden Code verifiziert: Zeichensummen der `place_call*`-Beschreibungen (5283 ohne Kanal / 5513 mit Kanal), Zuwachs pro Feld (263/84/37/172), Marker-Verschiebungen, `MCP_CONSULT_INSTRUCTIONS` ohne Sekundenzahl.
- Zwei zusätzliche Fallen gefunden und aufgelöst: (1) pre-commit-Ratsche pinnt Zeilenzahl von `registerTools` (430) — Probe-Patch zeigte, dass die Edits sie nicht verschieben; (2) `npm run format:check` ist auf `master` bereits rot — `prettier`-Lauf bewusst NICHT gefahren, um den Diff nicht zu sprengen.
- Edits: `briefing` bekommt Vertröstungs-Verbot + "Leave the gap open"; `objective` verengt die Vorab-Rückfrage aufs Thema selbst; `mandate.decide_freely` verliert die zweite "Ask the user FIRST"-Anweisung (Erfindungssperre bleibt, Ausgang wird fail-closed: Feld weglassen); `PLACE_CALL_CONSULT_LOOP` verliert die ungedeckte Klingelzeit-Zusage und wird konditional mit "at most once" formuliert; `MCP_CONSULT_INSTRUCTIONS` nennt die Frist ohne Sekundenzahl.
- Neue Testdatei `test/gq-b1-briefing-openness.test.js` mit 6 Fällen (`GQ-B1-01` bis `-06`), dateilokaler Attrappen-Bauer (bewusst nicht mit `p15` geteilt, siehe Plan-Entscheidung E1), kein Server-Spawn.
- Zwei Zeichen-Deckel als benannte Konstanten: `PLACE_CALL_BUDGET_CHARS=5800`, `PLACE_CALL_WITH_CONSULT_BUDGET_CHARS=6200`.
- Pre-Mortem (M1–M7) dokumentiert u.a.: Loop-Text-Zusage vs. abgeschalteter Kanal, Beschreibungswachstum, Draht `at most once` ↔ `MAX_IN_CALL_CONSULTS_PER_CALL`, Wegfall der zweiten Vorab-Rückfrage, fehlende Wirksamkeitsmessung (offener Punkt B-O1).
- Leitplanken: keine Gate-Logik, kein neues Schema-Feld, kein Anfassen von `outbound-agent.template.json`, keine Lokalisierung, keine neue Dependency.

## Implementierung — Zusammenfassung

- Diff besteht ausschließlich aus Stringliteralen und Kommentaren in `src/mcp-tools.js` und `src/mcp-server-info.js`, plus Ergänzungen in 2 Bestandstests und 1 neuer Testdatei.
- Gemessene Zeichensummen der `place_call*`-Beschreibungen: 5283 → 5667 (ohne Kanal), 5513 → 6069 (mit Kanal) — exakt wie geplant, 133/131 Zeichen Luft unter den Deckeln.
- Neuer Wächter `test/gq-b1-briefing-openness.test.js`: Vertröstungs-Verbot, konditionaler Loop-Hinweis nur bei aktivem Kanal ohne Klingelzeit-Zusage, Vorab-Rückfrage an genau einer Stelle, zwei Zeichen-Deckel, Frist ohne Sekundenzahl, Draht "at most once" ↔ `MAX_IN_CALL_CONSULTS_PER_CALL`.
- Rotprobe gefahren: mit wiederhergestelltem alten `decide_freely`-Text schlägt `GQ-B1-03` rot fehl (2 Treffer statt 1) — belegt, dass der Wächter wirklich misst.
- Ergebnis: `npm test` 4923/4923 grün (Basis 4917, Delta exakt +6). `npm run test:gates`: 3 rote Bestandsbefunde ohne Bezug zu Tool-Beschreibungen (erlaubt). `npm run test:abnahme`: 611/611 grün.
- Smoke über echte `/mcp`-Route bestätigt: neue Sätze in der ausgelieferten Beschreibung vorhanden, alte Sätze entfernt.

### Deviations vom Plan

- `node_modules`-Symlink-Problem im Worktree (Selbstschleife) — auf absoluten Pfad umgebogen, nicht committet.
- `GQ-B1-03` nutzt schreibungsunabhängige Regex statt schreibungsgenauem String-Split — Bestand trug den Satz einmal groß, einmal klein geschrieben; ein schreibungsgenauer Zähler hätte schon vor der Phase nur 1 Treffer geliefert und nichts belegt.
- Zwei Verweise aus Plan-Kommentartexten weggelassen (Pfad zu einer Prozessdatei, interner Befund-Code B-O2) — beide wären nach Merge/außerhalb der Phase nicht auflösbar gewesen; Sachaussage blieb unverändert.
- `npm run format` bewusst nicht gefahren (Plan-Entscheidung E4, Bestand bereits rot).
- Kein separater pglite-Lauf nötig — Postgres-/pglite-Fälle laufen in-process innerhalb von `npm test`.
- Erster Post-Change-Lauf zeigte 3 rote Spawn-Race-Fälle in `test/i6-write-scope.test.js` — isoliert grün, zweiter Vollauf grün, keine Regression.
- `npm run test:gates`: 3 rote Bestandsbefunde (GAP-05, GAP-15, E2E-03), ohne Bezug zu Tool-Beschreibungen — laut CLAUDE.md erlaubt.

## Safety-Urteil

**PASS – freigegeben.**

- Alle 7 absoluten Regeln einzeln geprüft: Safety-Gates unberührt (`git diff` über Gate-/Route-/Config-Dateien leer), Offenlegung unberührt (`claude.js`/`bridge.js` byte-identisch), Auth fail-closed unberührt (kein neuer Endpunkt), keine Secrets geleakt, Scope sauber (nur GQ-B1, keine neue Dependency), Flag-aus-Pfad strukturell byte-identisch garantiert (`consultLoop ? ... : null`), Draht-Invariante "at most once" ↔ `MAX_IN_CALL_CONSULTS_PER_CALL=1` belegt.
- Eigener Regressionslauf (unabhängig vom Implementierer): `npm test` 4923/4923 grün; Rotprobe gegen `master`-Stand bestätigt, dass 5 von 6 neuen Fällen plus 3 Bestandsfälle echt pinnen.
- **Concerns (nicht blockierend, als Beobachtung mitgegeben):**
  1. Inkonsistenz: die entfernte Klingelzeit-Zusage in `PLACE_CALL_CONSULT_LOOP` steht wortgleich weiterhin in `OPEN_QUESTIONS_FIELD` — dort ungedeckt geblieben (Scope-Creep vermieden, gehört in `gq-chain-state.md`).
  2. Überbreites Absolutum im `briefing`-Verbot ("never write that the principal will get back") kollidiert im Grenzfall mit `mandate.on_out_of_scope` (Default `take_message` verspricht genau das).
  3. Sprachliche Unschärfe in einem Begründungssatz ("so" statt "because").
  4. Bewusste Verhaltensverschiebung Richtung "früher wählen" (weniger Rückfrage-Reibung) — Server-Gates unberührt, als akzeptiertes Risiko benannt.
  5. `GQ-B1-04` (Zeichen-Deckel) ist auch gegen `master` grün — ein Wachstumsdeckel, kein Änderungswächter; 5 von 6 Fällen pinnen die Änderung selbst.

## Clean-Code-Audit

- **s1 (Blocker):** keine
- **s2 (schwerwiegend):** keine
- **s3:** keine
- **s4 (kosmetisch):** ein Bandwurmsatz in `PLACE_CALL_CONSULT_LOOP` — bewusst nicht geflaggt, Kürzung hätte Präzision gekostet, Zeichendeckel läuft ohnehin gegen.
- **Verdict:** PASS. Keine Duplizierung (G5) fehlerhaft — der dateilokale Attrappen-Bauer in der neuen Testdatei ist begründet nicht mit `p15` zusammengelegt (würde fremde Lint-Sanierung in eine reine Text-Phase ziehen). Draht-Invariante (`GQ-B1-06`) vermeidet G22 (zweite Quelle der Wahrheit). Kommentare sind Begründungen, keine toten/veralteten Referenzen.
- **Optional/kein Muss:** Bandwurmsatz in `PLACE_CALL_CONSULT_LOOP` bei Gelegenheit in zwei Sätze teilen, falls Zeichendeckel Spielraum lässt.

## Fix-Runden

- **r1:** Review-Blocker aus Runde 1 behoben — die `briefing`-Beschreibung behauptete fälschlich ein generelles Verbot, eine Rückmeldung des Auftraggebers zuzusagen; tatsächlich weist `mandate.on_out_of_scope` (Default `take_message`) genau das an. Text präzisiert, Widerspruchs-Test (`doesNotMatch`) ergänzt. Ergebnis: PASS, `finalBranch = phase/gq-b1-briefing-fix1`.

## Betriebswissen

- Betroffene Dateien: `src/mcp-tools.js`, `src/mcp-server-info.js` (Produktionscode, nur Text/Kommentare); `test/gq-b1-briefing-openness.test.js` (neu), `test/p15-mcp-tool-descriptions-en.test.js`, `test/place-call-context-bridge.test.js` (angepasst).
- Kein Push zu ElevenLabs nötig — Feldbeschreibungen reisen mit dem Server, nicht über `elevenlabs:push`.
- Offener Punkt für Kettenstand: ungedeckte Klingelzeit-Zusage in `OPEN_QUESTIONS_FIELD` (siehe Safety-Concern 1) und fehlende Wirksamkeitsmessung per Testanruf (Plan-Punkt B-O1).
