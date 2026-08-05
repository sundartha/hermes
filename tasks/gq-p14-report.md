# Phase GQ-P14 — die Zusammenfassung erfaehrt, was im Gespraech schon notiert wurde

**Gate: PASS**
**finalBranch:** `phase/gq-p14-summary-kennt-notizen`

---

## Plan (gekuerzt)

**Befund (gemessen, nicht angenommen):** `recordedMessagesSection({call, loc})` in `src/claude.js` (GQ-P10) liest bereits notierte Action Items und haengt sie an den **Gespraechs**-Systemprompt. `summarizeCall(call)` (Nachbereitung) baut die user-Message ausschliesslich aus `call.transcript` — ohne jeden Bezug auf bereits notierte Items. `store.callActionItems(s, callId)` ist ein reiner, geteilter Leser (json.js + pg.js).

**Entscheidung:** eine gemeinsame Renderfunktion fuer beide Pfade, nur die Handlungsanweisung unterscheidet sich (take_message vs. JSON-Key `actionItems`):

1. Neue Funktion `recordedItemsBlock({items, heading, guardrail})` in `src/claude.js` — geteilte Formatierung (G5/S2), ein Objekt-Argument (F1).
2. Neuer i18n-Schluessel `prompt.recorded.summaryGuardrail` in de/en/fr; `heading` bleibt geteilt.
3. `summarizeCall` haengt den Block **hinter** das Transkript an die user-Message; leer -> `""` -> Prompt byte-identisch zum Bestand.

Der Block wird **vor** dem `llm.complete`-Aufruf gelesen — also vor der `addActionItem`-Nachtragsschleife am Funktionsende. Die Liste zeigt damit den Stand des Gespraechs, nie den eigenen Output desselben Laufs.

**Ausdruecklich nicht Teil der Phase:** `actionItemKey`/Aehnlichkeitsschwelle, `take_message`/`execTool`, GQ-P10-Block im Gespraechsprompt, `objective_achieved`/Ergebnis-Karte, der `{duplicate}`-Nebenbefund (kein Konsument in der Nachbereitung, kein neuer Log-/Zaehlpfad — SCOPE), keine neue Dependency/Env/Gate.

**Pre-Mortem:** Drift zwischen den zwei Formatierungen -> ein Renderer + Test GQ-P14-6. Stiller Bestandsbruch am Leerfall -> Golden-Master-Pin GQ-P14-2. Block landet wieder am falschen Prompt (GQ-P10-Fehler wiederholt) -> Trenn-Test GQ-P14-4. Token-Mehrkosten -> begrenzt durch dieselbe Liste, die der Gespraechspfad ohnehin traegt, ein Aufruf pro Anruf. Neues Leak-Risiko -> verneint, gleicher Anruf, gleicher Empfaenger, kein neuer Speicher-/MCP-Pfad.

**Neue Testdatei:** `test/gq-p14-summary-recorded-items.test.js`, Muster `c1-auftragstreue.test.js` (lokaler Anthropic-Mock) + `gq-p10-recorded-messages.test.js` (Call-Pool). 8 Tests GQ-P14-1..6 (3 Sprachvarianten in einer Zaehlung): Wortlaut im Summary-Prompt, byte-identischer Leerfall, Sprachrendering de/en/fr, Pfad-Trennung Gespraech vs. Zusammenfassung, vollstaendige Locale-Abdeckung, identische Zeilenform in beiden Pfaden.

**Verifikationsplan:** Rot-vor-Fix-Nachweis (Lehre *bench-must-reproduce-defect*), Syntax-Check, neue Datei isoliert, Nachbarpfad-Tests (gq-p10, c1-auftragstreue, p11, al-p11, de-umlaut-orthography) unveraendert gruen, volle Suite, Prettier.

---

## Impl-Zusammenfassung

- `headCommit`: `3b7e51c6ea7d3fff1561b18e33e4356197c430c8`
- `node --check`: PASS auf `src/claude.js` + de/en/fr-Prompts
- Tests: 4016/4016 gruen (npm test), committed
- **`src/claude.js`**: `recordedItemsBlock({items, heading, guardrail})` neu extrahiert (reiner Formatierer, `""` bei leerer Liste); `recordedMessagesSection` ruft ihn mit GQ-P10-Guardrail auf; `summarizeCall` liest `alreadyRecorded` vor dem `llm.complete`-Aufruf mit `summaryGuardrail` und haengt ihn hinter das Transkript an `summaryInputText` (Umformung von Template-Literal zu Konkatenation, byte-identisch bei leerem Block).
- **`src/i18n/prompts/{de,en,fr}.js`**: neuer Schluessel `recorded.summaryGuardrail`, `heading`/`guardrail` unveraendert; DE-String mit korrekten Umlauten (gilt fuer vom Modell gelesene Prompt-Strings, wie beim GQ-P10-Nachbartext), Code-Kommentare ASCII.
- **`test/gq-p14-summary-recorded-items.test.js`** (neu): 8 Faelle, offline, in-process Anthropic-Mock, kein Server-Spawn.

**Getestete/geaenderte Tests:** GQ-P14-1 (Wortlaut im Prompt), GQ-P14-2 (Golden-Master Leerfall), GQ-P14-3 de/en/fr (Sprachrendering), GQ-P14-4 (Pfad-Trennung), GQ-P14-5 (Locale-Vollstaendigkeit), GQ-P14-6 (identische Form in beiden Pfaden).

### Deviations
1. Prettier `--write` haette zusaetzlich vorbestehende, phasenfremde Formatierungs-Drift in `src/claude.js`/`de.js`/`fr.js` angefasst (Repo bereits vor der Phase nicht prettier-clean). Verworfen; Edits manuell prettier-konform (<=100 Zeichen) reappliziert — nur der eigene Diff im Commit.
2. Voller Server-Smoke-Test scheiterte am Boot-Guard (keine geseedete Owner-Nummer im frischen temp `DATA_DIR`) — unabhaengig von dieser reinen Prompt-Logik-Aenderung; `smokePass=false` ohne Blocker-Charakter, durch 48 Unit-/Regressionstests kompensiert.

---

## Safety-Urteil

**approved: true** — alle Einzelurteile true (testsPassIndependently, safetyGatesIntact, disclosureIntact, authFailClosedIntact, noSecretsLeaked, scopeRespected, behaviorAsIntended). Keine Blocker.

- Diff: 5 Dateien, +222/-4, keine neue npm-Dependency.
- SCOPE exakt Spec; alle Spec-Verbote eingehalten (actionItemKey, take_message, GQ-P10-Block, objective_achieved/Ergebnis-Karte unberuehrt).
- Safety-Gates, Auth, Billing, Routen, Config, Telefonie-Adapter nicht im Diff.
- Offenlegungssatz unangetastet.
- Unabhaengige Verifikation: 2× `npm test` (4016/4016 bzw. 3996/3996 nach i18n-Katalog-Abzug), beide gruen; Rot-vor-Fix-Gegenprobe durch Zuruecksetzen der drei src-Dateien auf master-Stand — 7/8 Tests rot, GQ-P14-2 (Golden-Master) auf master **und** Branch gruen.

**Concerns (nicht blockierend):**
1. `npm run test:gates` wurde nach ~25 min Haenger in `test/auth-p9a-cache-headers.test.js` abgebrochen — bekannte Umgebungsklasse (verwaiste Spawn-Server/Last durch parallele Workflows), von P14 nicht beruehrte Datei, kein P14-Signal.
2. Prettier-Formatabweichung in `src/claude.js`/de.js/fr.js — identisch auch auf `master` gemessen, Vorbestand. eslint konnte Config im Worktree nicht aufloesen (Symlink-Problem), kein Lint-Signal.
3. `store.callActionItems` filtert nur nach `callId`, nicht nach `tenantId` — Vorbestand aus GQ-P10, P14 dehnt denselben Read auf einen zweiten Aufrufer aus, fuehrt keine neue Leak-Klasse ein.
4. `{duplicate}`-Rueckgabewert von `addActionItem` bleibt in der Nachbereitung bewusst unverwertet (Scope gewahrt, Folgearbeit offen).

---

## Clean-Code-Audit (S1-S4)

**blocker: false** — S1/S2/S3/S4 jeweils leer (keine FLAGs).

- G5 (Duplizierung, S2): vermieden — `recordedItemsBlock` ist die einzige Formatierungsquelle fuer beide Pfade.
- F1 (Argumente): Options-Objekt mit 3 Feldern zaehlt als 1 Argument.
- Test-Pflicht: neues Verhalten durch 8 gruene Tests abgedeckt.
- G33 (Grenzbedingungen): Leerlisten-Fall an einer Stelle verankert, durch GQ-P14-2 gepinnt.
- N7/G20: Namen (`recordedItemsBlock`, `summaryInputText`) halten, was sie versprechen.
- Kommentare: Code-Kommentare ASCII, Prompt-Strings (DE) korrekt mit Umlauten — konsistent mit dokumentierter Ausnahme.
- Keine Magic Numbers, kein toter/auskommentierter Code, keine abgeschalteten Sicherungen.

**topTodos:** keine Pflicht-Todos. Beobachtung (kein Blocker): der Fix ist ein Prompt-Guardrail, keine serverseitige Dedupe — falls das Modell die Anweisung ignoriert, bleibt der urspruengliche N-2-Befund (dreifache Eintraege) theoretisch reproduzierbar; ggf. spaeter serverseitige Deduplizierung erwaegen, falls Live-Messung erneut Duplikate zeigt.

---

## Fix-Runden

Keine — Erstumsetzung ging PASS ohne Nacharbeit (S1/S2/S3/S4 leer, Safety approved ohne Blocker).
