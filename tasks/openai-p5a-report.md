# P5a — Datenminimierung im Output, rein subtraktiv (Abschlussbericht)

Stand: 2026-09-21. Branch `phase/openai-p5a-datenminimierung`. Spec: `tasks/openai-p5a-spec.md`.

## Offene Punkte zuerst

1. **O-13 gilt nach dieser Phase als TEILWEISE erfuellt, nicht vollstaendig.**
   `last_transcript_lines` (`src/mcp-tools.js:171-176`, Feld von `pickCallStatus`) bleibt im
   `get_call_status`-Output und traegt woertliche Zeilen der Gegenseite durch. Das ist
   ausdruecklich NICHT Gegenstand dieser Phase (Spec Abschnitt 2, Punkt 2) — waehrend eines
   laufenden Anrufs gibt es keine Zusammenfassung als Ersatz, das Call-Widget bindet und rendert
   das Feld. Schliessen heisst: entschaerften Ersatz bauen UND das Widget im selben Commit
   umstellen — eigene Phase mit Live-Probe.
2. **O-14 gilt als erfuellt fuer selbst erzeugte Daten, NICHT abschliessend fuer woertliche
   Gegenrede.** Siehe Abschnitt "O-14" unten. Ein Satz "O-14 vollstaendig erfuellt" waere falsch.
3. `failure_reason` und `consultPermissionHint` sind P5b — hier nicht angefasst.

## Was gebaut wurde (O-13 Teil 1)

`voiceEngine` und `model` (interne Konfigurationswerte: TTS-Engine, LLM-Modell-ID) sind aus dem
`get_agent_status`-Tool-Output entfernt — an allen sieben Stellen, die am Code lagen (Spec
Abschnitt 0), nicht nur an den zwei, die der Plan nannte:

1. `src/mcp-tools.js` — `pickAgentStatus` (Pick-Funktion)
2. `src/mcp-tools.js` — `AGENT_STATUS_OUTPUT` (Zod-Schema)
3. `src/mcp-tools.js` — Stufe-0-Textblock (sonst `undefined` im Chat)
4. `src/mcp-tools.js` — Tool-Beschreibung (`tools/list`, versprach die Felder weiterhin)
5. `src/i18n/mcp-texts.js` — Labels in `agentStatus` (de/en/fr)
6. `src/ui/widgets/agent-status.html` — zwei Widget-Zeilen
7. `src/ui/widget-i18n.js` — Widget-Chrome-Labels (de/fr)

Schema, Pick-Funktion und Textblock wurden bewusst in **einem** Commit geaendert (Spec-Reihenfolge
1-3) — auseinandergefallen waere das der T-19-Defekt neu (Zod verlangt Felder, die
`structuredContent` nicht mehr traegt → SDK-Validator wirft "Output validation error").

`/api/state` (`src/routes/api-read.js:92-93`) und das Boot-Banner (`src/boot.js`) behalten die
Felder unveraendert — das ist die Innenkante hinter der Tenant-Sitzung bzw. Betriebswahrheit im
Serverlog, kein Kundentool (Spec Abschnitt 2, Punkte 1+5). Ein Betreiber verliert damit keine
Selbstauskunft.

**Zusatzargument fuer Entfernen statt Pflegen:** der ausgelieferte `model`-Wert kam aus
`config.llm.claudeModel` (nur von `CLAUDE_MODEL` gespeist), waehrend die tatsaechliche
Anbieterwahl an `config.llm.llmProvider` haengt — bei `LLM_PROVIDER=deepseek` (heute live, s.
MEMORY `live-auf-deepseek.md`) haette das Tool bereits einen irrefuehrenden Modellnamen
behauptet. Ein Feld, das falsch sein kann und das niemand pflegt, ist schlechter als kein Feld.

## Kommentar-Praezisierung

`src/mcp-tools.js:160-166` (der Block direkt ueber `pickCallStatus`): ein Satz ergaenzt, der
`last_transcript_lines` woertlich nennt, sagt, dass das Feld woertliche Zeilen der Gegenseite
traegt, klarstellt, dass die Aussage darueber ueber FELDER geht (nicht ueber den Inhalt des
Feldes), und den Punkt als bewusst offenen Befund markiert. Selbsttragend formuliert, kein
Verweis auf `PLAN-OPENAI-TECHNIK.md` (die Datei wird nach Merge der Kette aufgeraeumt).

## O-14 (Restricted Data) — Nachweis, kein Code

Die vier Whitelist-Funktionen, mit `datei:zeile` (Stand nach diesem Branch):

- `pickCallStatus` — `src/mcp-tools.js:168`
- `pickTranscript` — `src/mcp-tools.js:210`
- `pickAgentStatus` — `src/mcp-tools.js:385`
- `pickCall` — `src/mcp-tools.js:421`

Alle vier sind Positivlisten (Objekt-Literale mit fester Feldliste), kein Feld daraus traegt
PCI-DSS-Daten, PHI, staatliche Identifikatoren oder Zugangsdaten.

**Einschraenkung:** `last_transcript_lines` (Feld von `pickCallStatus`) reicht woertliche
Gegenrede durch. O-14 gilt deshalb als erfuellt fuer alles, was der Server selbst erzeugt, und
als **nicht abschliessend** fuer woertliche Gegenrede — das bleibt ein offener Teilbefund (s.
"Offene Punkte" oben).

**Gegenprobe des Pruefers:** `grep -n "\.\.\.c\b\|\.\.\.s\b\|Object.assign" src/mcp-tools.js` findet
keinen Spread des Upstream-Objekts in eine dieser vier Funktionen (leerer Treffer, nachgemessen
auf diesem Branch).

## Tests

Baseline (drei Bestandsdateien, vor jeder Aenderung, `NODE_ENV=test node --test
--test-concurrency=4 test/mcp-ui.test.js test/mcp-tools-language.test.js
test/mcp-ui-widget-i18n.test.js`): 92/92 gruen.

Nach allen Aenderungen dieselben drei Dateien: 92/92 gruen (Bestandspins nachgezogen, keine
Zahl-Bewegung — Spec-Erwartung).

Neu: `test/openai-p5a-datenminimierung.test.js`, vier Faelle (in-process, HTTP `/mcp`, stdio,
Beschreibung), alle vier gegen den echten `tools/call`- bzw. `tools/list`-Ausgang, nicht gegen
das `registerTool()`-Registrierungsobjekt (das SDK verwirft unbekannte Config-Felder still).
4/4 gruen, isoliert gemessen.

Gegenprobe (Spec Schritt 8c): Schritt 1 zurueckgedreht (`voiceEngine`/`model` wieder in
`pickAgentStatus` eingefuegt) macht `T-W3-AC1` in `test/mcp-ui.test.js` isoliert rot
("Output validation error", da Schema die Felder nicht mehr kennt). Bestaetigt und wieder
verworfen (kein Restbestand im Branch).

Gesamtlauf: siehe strukturierte Rueckgabe dieses Agenten (`test_kommando`, `test_pass`,
`test_fail`).

## Nicht angefasst (Spec Abschnitt 2)

- `/api/state` (Innenkante, kein Kundentool)
- `last_transcript_lines` (eigene Phase, Live-Probe noetig)
- `failure_reason`, `consultPermissionHint` (P5b)
- Kein neues Env, kein Flag, keine Migration
- `config.voice.voiceEngine`, Boot-Banner
- Kein Test, der den Kommentarwortlaut pinnt
- Widget-Bind-Logik (nur zwei Markup-Zeilen weg)
