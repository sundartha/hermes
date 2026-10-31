# P-010 Kürzen an der Wortgrenze behält das letzte ganze Wort: Design Doc

Status: freigegeben
Pitch: plaene/P-010-wortgrenze-ganzes-wort/pitch.md
Entscheidung: keine eigene technische Entscheidung (Design Doc: nein); dieses Dokument hält nur die Ausgangslage fest.

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| Vorhandene Hilfe: `clampAtWordBoundary` ist die einzige Kürzung an der Wortgrenze im Repo; eine zweite gibt es nicht. | `node tools/auftrag.mjs suche 'lastIndexOf(" "'`: nur `src/utils/text.js:4` (2026-10-25) | Es gäbe einen zweiten Weg zur Wortgrenze, der dieselbe Lücke hat. |
| `clampAtWordBoundary(text, maxChars)` gibt den Text unverändert zurück, wenn er passt; sonst sucht sie das letzte `" "` nur in `text.slice(0, maxChars)` und kürzt davor, ohne Leerzeichen (oder bei einem Leerzeichen an Position 0) hart auf `maxChars`. Ein Leerzeichen an Stelle `maxChars` sieht sie nicht. | `src/utils/text.js:1-6` | – |
| Aufrufer der Hilfe: Ziel im Eröffnungssatz (75), Denk-Signal (120), Gedächtnis (`clampMarked`, Grenze minus 1), Recherche-Anfrage (120), Recherche-Fakt (200), Rückfrage an den Besitzer (200). | `src/claude.js:248`, `src/thinking-signal.js:10`, `src/call-memory.js:21`, `src/research/lookup-guard.js:35`, `:45`, `src/consult/question.js:16`; `grep -rn clampAtWordBoundary src` am 2026-10-25 | Ein weiterer Aufrufer wäre mit betroffen. |
| Der Recherche-Fakt entsteht aus Titel und erstem Auszug des Exa-Treffers, verbunden mit „: “, wird auf ein Leerzeichen je Lücke gefaltet und auf 200 Zeichen gekürzt; die `answer` des Webhooks ist der Rahmensatz gefolgt von den Fakten. | `src/research/adapters/exa-search.js:9`, `src/research/lookup-guard.js:38-46`, `src/routes/webhooks-elevenlabs.js:140`, `:157-161` | S1 und B2 bräuchten andere Werte. |
| Der Eröffnungstext ist der Offenlegungssatz (oder bei einem Anruf beim Besitzer selbst dessen Begrüßung), dann ein Leerzeichen und die Brücke mit dem gekürzten Ziel; nur das Ziel geht durch die Hilfe. | `src/claude.js:215-233`, `:243-248`; `src/i18n/locales.js:132-139` | Die Änderung erreichte den Offenlegungssatz (B1). |
| Der Eröffnungstext geht als Antwort auf `POST /voice/outbound` an Telnyx und ins Gesprächsprotokoll. | `src/routes/voice.js:434-436` | S2 und B1 bräuchten einen anderen sichtbaren Ausgang. |
| Die Recherche-Anfrage wird vor dem Kürzen auf Ziffernfolgen, E-Mail, Zielnummer und wörtliche Zitate geprüft; gekürzt wird nur ein schon geprüfter Text. | `src/research/lookup-guard.js:28-36` | Ein zusätzliches Wort könnte ungeprüft an die Suche gehen. |
| Mit `lastIndexOf(" ", maxChars)` auf dem ganzen Text ist das Ergebnis immer ein Anfang des Textes, nie länger als `maxChars` und nie kürzer als heute. | nachgestellt mit node am 2026-10-25 (S1: 194 → 200 Zeichen, B2: 194 → 194) | Die Grenze „nie weniger Text als heute“ hielte nicht. |
| Bestehende Tests nahe den Aufrufern bleiben mit der Behebung grün. | Wegwerf-Versuch am 2026-10-25: Kopie von ae362d2 außerhalb des Worktrees, Hilfe auf `lastIndexOf(" ", maxChars)` geändert, `npm test --` mit 20 Testdateien (`test/al-p10b-lookup-guard.test.js`, `test/al-p10b-lookup.test.js`, `test/al-p12-call-memory.test.js`, `test/al-p14-in-call-consult.test.js`, `test/al-p5-opening.test.js`, `test/anrufe/gedaechtnis-kuerzung.test.js`, `test/el-lookup-webhook.test.js`, `test/g2-opening-turn.test.js`, `test/callee-is-owner-opening.test.js` und 11 weitere): 270 bestanden, 0 rot; die volle Suite ist nicht gelaufen | Ein bestehender Test müsste geändert werden (Testschutz). |
| `src/utils/text.js:clampAtWordBoundary` hat keine Lint-Befunde. | `node tools/auftrag.mjs karte src/utils/text.js` am 2026-10-25 | Ein Umbau davor wäre nötig. |
