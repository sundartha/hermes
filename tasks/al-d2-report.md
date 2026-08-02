# AL-D2 — Prozessbericht

**Phase:** Warum feuert das Denk-Signal in KEINEM Turn? Ursache messen (reine Diagnose, kein Fix).
**Gate:** PASS
**finalBranch:** `phase/al-d2-denk-signal-diagnose-fix2`

---

## Plan (gekürzt)

Basis: `tasks/al-d2-spec.md`, `tasks/al-handover-2026-08-01.md` §1/§4, `tasks/al-p7b-workflow-report.md` §2.2/E3, `PLAN-ASSISTANT-LEAP.md` (Phase 7b), Code-Lesen von `thinking-signal.js`, `claude.js` (`agentTurn`), `telnyx-llm-shim.js`, `research/in-call.js`, `consult/in-call.js`.

- Verifizierte Bedingungskette B1..B7 aus dem Code (nicht aus der Spec-Tabelle): tatsächliche Prüfreihenfolge **B3 → B4 → B5 → B7 → B1 → B2 → B6**, nicht aufsteigend wie in der Spec-Tabelle skizziert. Zwei Korrekturen an der Spec: (1) Reihenfolge, (2) B6 bedeutet „der aktuelle Wert von `speech` ist nicht leer", nicht „führender Text im selben Antwort-Block".
- Neue Testdatei `test/al-d2-thinking-signal-diagnostics.test.js`: sechs Turn-Klassen K1..K6 offline gegen den Shim (`stream:true` wie Telnyx live) gegen den echten `agentTurn` und einen lokalen Anthropic-Mock (JSON + echtes SSE), plus zwei Pin-Tests für ein neues Log-Feld.
- K3 (`look_up` mit führendem Text) als Pflicht-Positivkontrolle: weist die Reihenfolge auf dem SSE-Draht nach (`contentPieces` deepEqual `[BRUECKE+" ", ANTWORT]`), nicht nur ein Flag.
- `look_up` bewusst ohne `query`-Feld gerufen, damit `sanitizeLookupQuery` vor Kontingent/Gebühr/Egress verwirft — kein Netz-Egress in den Tests.
- Einzige Produktivänderung: ein additives Boolean `speechWireOpen: wire !== null` in `logShimTurnOk(...)` (`src/telnyx-llm-shim.js`), eine Schreibstelle. `src/claude.js` und `src/thinking-signal.js` bleiben unangetastet (Diff-Kontrolle als Abnahmekriterium).
- Drei Mutationsproben (M1: B5 in `claude.js`, M2: B2 in `telnyx-llm-shim.js`, M3: B6 in `thinking-signal.js`), jeweils selektives Rot erwartet, per `git checkout --` zurückgenommen.
- Liefergegenstand `tasks/al-d2-diagnose.md` (Diagnose-Dokument, mitcommitten) — getrennt von diesem Prozessbericht.

---

## Impl-Zusammenfassung

- headCommit: `c41138dad588e6011814a0223870174a0b787e9f`
- `node --check` grün, `npm test` grün: 3724 laut Impl-Report gemeldet, in Review-Läufen konsistent 3744 (Zahlendreher im Diagnose-Dokument, siehe Fix-Runden).
- Neue Datei `test/al-d2-thinking-signal-diagnostics.test.js` mit 8 Tests (AL-D2-1..8), alle grün.
- Einzige Produktivänderung: `speechWireOpen: wire !== null` im `logShimTurnOk({...})`-Literal in `src/telnyx-llm-shim.js`, unmittelbar vor `streamChunks`, mit erklärendem Kommentar. Rein additiv, PII-frei (Boolean), keine neue Env-Variable, keine Migration.
- `tasks/al-d2-diagnose.md` erstellt und committed (Kern-Ergebnis: Denk-Signal hat keinen Defekt — es hatte in 21/21 Live-Turns nichts zu überbrücken; Reichweite-Antwort NEIN; K4 als eigenständiger, noch nicht gefixter Defekt benannt).

**Mutationsproben (Ergebnis):**
- M1 (B5, `const loopContinues = true;` in `claude.js`): genau AL-D2-2 (K2) rot, 7/8 grün.
- M2 (B2, Wire-Bedingung in `telnyx-llm-shim.js` entfernt): AL-D2-5 (K5) und AL-D2-8 rot, 6/8 grün.
- M3 (B6, `bridgeSpeechFrom` liefert konstant `"X "`): AL-D2-4 (K4) rot wie behauptet, AL-D2-3 (K3) rot als vorab benannte erwartete Nebenwirkung, 6/8 grün.
- Nach Rücknahme aller drei: 8/8 grün, `npm test` grün. Kein Bestandstest verändert (abgesehen von der in Fix-Runde r1 vorgenommenen Fixture-Extraktion, s.u.).

**Blockierende Bedingung je Turn-Klasse:**
K1 (Text ohne Werkzeug, 18/21 live) → B3 sperrt. K2 (`take_message` + Text, 3/21) → B5 sperrt. K3 (Positivkontrolle) → nichts sperrt, Brücke feuert auf dem Draht. K4 (`look_up` ohne führenden Text) → B6 sperrt, tote Leitung während der Suche. K5 (wie K3, ohne Wire) → B2 sperrt. K6 (angenommenes `get_consult`) → B4 sperrt korrekt (anderer Sprecher, kein Defekt).

### Deviations

- `node_modules`-Symlink aus der Vorgabe war ein Selbstbezug im Worktree (ELOOP); ersetzt durch absoluten Symlink auf das Haupt-Repo-`node_modules`, nicht committed (gitignored).
- `git diff master --stat` zeigte zusätzlich `PLAN-AUTH-GATE.md`/`tasks/auth-gate-kickoff.md` — nicht Teil der Phase, sondern Branch-Drift, weil master nach dem Branch-Punkt um einen fremden Docs-Commit weitergewandert ist. Gegen den echten `merge-base` (1bf694a) betrifft der Diff exakt drei bzw. (nach Fix-Runde r1) fünf Dateien.
- `tasks/al-d2-report.md` (dieser Prozessbericht) wurde von der Impl-Phase bewusst nicht geschrieben — Workflow-Artefakt, nicht Impl-Liefergegenstand.
- Inhaltliche Korrektur an der Spec dokumentiert (keine Code-Änderung): tatsächliche Prüfreihenfolge B3→B4→B5→B7→B1→B2→B6, und B6 bedeutet „`speech` ist nicht leer", nicht „führender Text im selben Block".
- §6 des Diagnose-Dokuments hält offen: Zuordnung „B5" für die 3 Live-`take_message`-Turns stützt sich auf Spec-Angabe + Reproduktion, Render-Logs wurden nicht erneut gezogen; B2 ist für die zwei Live-Anrufe rückwirkend nicht entscheidbar (dafür `speechWireOpen` gebaut).

---

## Safety-Urteil

**APPROVED.**

- Scope/keine Verhaltensänderung bestätigt: Branch-Diff gegen `merge-base` umfasst nur `src/telnyx-llm-shim.js`, `tasks/al-d2-diagnose.md` und drei Testdateien. `git diff` auf `src/claude.js`, `src/thinking-signal.js`, `src/bridge.js` liefert null Zeilen. Kein `package.json`-Diff, keine neue Env-Variable, keine Gate-/Auth-/Billing-/Telephony-Datei berührt.
- Das eine neue Boolean (`speechWireOpen: wire !== null`) ist fail-safe (const aus Ternär, nie undefined), PII-frei, eine Schreibstelle, negativ gepinnt durch AL-D2-7 (kein Gesprächsinhalt in der Log-Zeile).
- Positivkontrolle als echt verifiziert: Reviewer mutierte selbst `onSpeechChunk(bridge)` in `thinking-signal.js` weg → K3 wird selektiv rot (7/8 grün), und zwar über die Draht-Assertion (`contentPieces` deepEqual), nicht über das Flag `thinkingSignalSpoken` (das blieb unter der Mutation fälschlich grün — Beleg, dass die Draht-Assertion die eigentliche Beweislast trägt).
- Bericht ehrlich: widerspricht der eigenen Übergabe (`al-handover-2026-08-01.md` §4) ausdrücklich mit einer klaren NEIN-Antwort zur Reichweite, benennt die Grenze der eigenen Messung, führt B2 rückwirkend als nicht entscheidbar.
- Unabhängiger Testlauf: AL-D2-Datei isoliert 8/8 grün; volle Suite in drei Läufen (Maschine unter Fremdlast) — ein isoliert nachgeprüfter Flake (`cq-p8-briefing.test.js`, Timeout-getrieben, hängt an keiner vom Diff berührten Stelle) zählt nach Repo-Regel nicht als Befund; `npm run test:gates` unveränderte Baseline (3 rot: GAP-05, GAP-15×2).
- Concerns (kein Blocker): Zahlendreher 3724 vs. tatsächlich 3744 im Diagnose-Dokument; §4 formuliert „nichts zu fixen" zu absolut neben dem in §2/§5 klar benannten K4-Defekt; M2/M3 der Mutationstabelle vom Reviewer nicht unabhängig nachgefahren (nur M1 plus eigene Probe); Bestandstest `test/al-d1-cause-diagnostics.test.js` durch Fixture-Extraktion verändert (verhaltensfrei, aus Review-Runde 1 gefordert).

---

## Clean-Code-Audit (S1-S4)

**Verdict: PASS** — keine S1/S2-Blocker.

- S1: keine.
- S2: keine.
- S3: eine sehr kleine Erwähnung — `wire !== null` liesse sich idiomatischer als `Boolean(wire)` schreiben; kein Blocker, der Kommentar direkt darüber macht die Absicht bereits explizit.
- S4: keine Funde im Phasen-Scope.

Hervorgehoben: G5-Duplizierung nicht nur vermieden, sondern verbessert — die wortgleichen Anthropic-SSE-Fixture-Bausteine aus `test/al-d1-cause-diagnostics.test.js` wurden nach `test/anthropic-sse-fixtures.js` extrahiert (Form-2-Extraktion, als Fabriken wegen je Datei anderer Message-ID). K1–K6 bleiben trotzdem klar unterscheidbare Turn-Klassen mit je eigener Fixture und Assertion-Menge; K3/K5 sind bewusst identische Response-Queues bis auf eine Variable (`tokenStreaming`), was korrekte differenzielle Testtechnik zur Isolierung von B2 ist. Der im Prompt genannte Audit-Hinweis „gleiche Fixture-Werte testen nichts" trifft hier nicht zu, da die Gleichheit selbst der Beweis-Mechanismus ist.

---

## Fix-Runden

- **r1**: Beide G5-Blocker (Duplizierung) behoben, sonst nichts angefasst. Wortgleiche Anthropic-Antwort-Fixture-Bausteine (`text`/`toolUse`/`reply`/`jsonMessage`/`sseEvent`/`writeSse`) aus `test/al-d1-cause-diagnostics.test.js` und `test/al-d2-thinking-signal-diagnostics.test.js` nach `test/anthropic-sse-fixtures.js` extrahiert.
- **r2**: Beide Review-Blocker in `tasks/al-d2-diagnose.md` behoben — reiner Doku-Fix, kein Code-/Verhaltens-Diff. §8 nennt jetzt korrekt alle 5 vom Diagnose+Fix-Commit-Paar (1bf694a..ea16ef9) geänderten Dateien inklusive der Bestandstest-Änderung in `test/al-d1-cause-diagnostics.test.js` (-66 Zeilen, reine Fixture-Extraktion).
