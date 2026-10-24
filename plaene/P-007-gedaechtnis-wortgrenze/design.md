# P-007 Gesprächsgedächtnis an der Wortgrenze kürzen: Design Doc

Status: freigegeben
Pitch: plaene/P-007-gedaechtnis-wortgrenze/pitch.md
Entscheidung: keine eigene technische Entscheidung (Design Doc: nein); dieses Dokument hält nur die Ausgangslage fest.

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| `memoryLine` kürzt das Ergebnis mit `.slice(0, MEMORY_MAX_OUTCOME_CHARS)` (100) und die ganze Zeile mit `.slice(0, MEMORY_MAX_ENTRY_CHARS)` (200), jeweils hart. | `src/call-memory.js:6`, `:16`, `:22` | – |
| `singleLine` faltet jede Folge von Leerraum zu einem Leerzeichen, bevor gekürzt wird. | `src/call-memory.js:10-13` | `clampAtWordBoundary` fände Tabs/Zeilenumbrüche nicht als Wortgrenze. |
| `clampAtWordBoundary(text, maxChars)` gibt den Text unverändert zurück, wenn er passt, sonst bis zum letzten `" "` vor der Grenze, ohne Leerzeichen hart gekürzt. | `src/utils/text.js:1-6` | – |
| `clampAtWordBoundary` hat weitere Aufrufer, die unverändert bleiben müssen. | `src/consult/question.js:16`, `src/thinking-signal.js:10`, `src/claude.js:248`, `src/research/lookup-guard.js:35`, `:45`; `grep -rn clampAtWordBoundary src` am 2026-10-24 | – |
| Das Gedächtnis erreicht das Sprachmodell nur über den Prompt der Telnyx-Engine, nur bei Outbound-Anrufen und nur mit `allowCallMemory: true`. | `src/claude.js:36`, `:55-58`, `:208-213`; `src/store/state-ops.js:918-927` | Ein weiterer Pfad wäre von der Änderung mit betroffen. |
| Der ElevenLabs-Outbound liest das Gedächtnis nicht. | `grep -rn counterpartyMemory src` am 2026-10-24: nur `src/claude.js`, Store | – |
| `MEMORY_MAX_CALLS` wird außerhalb gelesen. | `src/store/state-ops.js:69`, `:926` | – |
| Die Anweisung an den Sprachmodell-Anbieter ist in Tests über die Anthropic-Attrappe sichtbar. | `test/helpers.js:12`, `:43`, `:48` | Der Abnahmetest bräuchte einen anderen Weg an die Anbieter-Grenze. |
| Bestehende Tests der Datei: `test/al-p12-call-memory.test.js` (Faltung AL-P12-11, Budget AL-P12-12, Prompt AL-P12-13 bis -15). | `test/al-p12-call-memory.test.js:152-235` | – |
| „…“ (U+2026) ist in JavaScript ein einziges UTF-16-Zeichen; `"…".length === 1`. | nachgestellt mit node am 2026-10-24 | Eine gekürzte Angabe wäre länger als ihre Grenze. |
| `src/call-memory.js` hat keine Lint-Befunde. | `node tools/auftrag.mjs karte src/call-memory.js` am 2026-10-24 | – |
