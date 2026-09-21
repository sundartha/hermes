# P4-Abschlussbericht — get_transcript ohne structuredContent + Server-instructions

**IDs:** T-19, T-20, T-21, O-27 (Teil 1). **Branch:** `phase/openai-p4-defekte`.
**Basis:** `master` `8f8de37` (Merge von `phase/openai-p3-securityschemes`).

---

## 0. Vorher-/Nachher-Messung

| Messung | Vorher | Nachher |
|---|---|---|
| `tools/call get_transcript`, Anruf `active`, echte `/mcp`-Route | `isError:true`, Text = SDK-Systemmeldung `MCP error -32602: Output validation error: Tool get_transcript has an output schema but no structured content was provided`. Der lokalisierte Hinweissatz erreicht den Client NIE. | `isError:true`, Text = `MCP_TEXTS.<sprache>.callStillRunning` (DE-Wortlaut byte-identisch zum Bestand: "Anruf laeuft noch. Bitte get_call_status pollen und spaeter erneut versuchen."). Kein `Output validation error` mehr. |
| `initialize`, `/mcp`, Tenant ohne Consult-Freigabe | `result.instructions === undefined` | `result.instructions === MCP_BASE_INSTRUCTIONS` (305 Zeichen, nicht leer) |
| `initialize`, echter stdio-Kindprozess (`src/mcp-server.js`) | `client.getInstructions() === undefined` | `client.getInstructions()` ist ein nicht-leerer String (Basis-Block, da `consultAllowed:false` im stdio-Pfad) |
| `MCP_CONSULT_INSTRUCTIONS` | Laenge 1238, `indexOf("not-placed")` = 1073 (**ausserhalb** der ersten 512), `includes("calendar, mail, files")` = **true** | Laenge **1283**, `indexOf("not-placed")` = **50** (< 512), `includes("calendar, mail, files")` = **false** |

Alle vier Nachher-Werte sind am Branch-Tip nachgemessen (nicht nur behauptet):

```
node -e 'import("./src/mcp-server-info.js").then(m=>{const s=m.MCP_CONSULT_INSTRUCTIONS;console.log(s.length, s.indexOf("not-placed"), s.includes("calendar, mail, files"));console.log(m.MCP_BASE_INSTRUCTIONS.length);})'
# -> 1283 50 false
# -> 305
```

---

## 1. Was gebaut wurde

1. **T-19/T-20** (`src/mcp-tools.js:1267`): `get_transcript` liefert bei laufendem Anruf
   `errText(...)` (isError, kein `structuredContent`) statt `text({error:...})`. Der SDK-
   Validator nimmt Fehlerergebnisse ausdruecklich aus (`isError` -> kein Output-Schema-Check).
   Der Satz selbst bleibt byte-identisch, nur die JSON-Huelle faellt weg.
2. **T-19/T-20 (die Regel)**: neuer tabellengetriebener Test ueber ALLE 10 Werkzeuge mit
   `outputSchema` (Pruefmenge aus der GELIEFERTEN `registerTool()`-Registrierung, nicht aus
   einer gepflegten Namensliste). Jedes Werkzeug bekommt einen Erfolgslauf (Positiv-Kontrolle:
   `isError!==true` UND `structuredContent` vorhanden) und einen Fehlerlauf (`isError===true`).
   Kein Laufzeit-Waechter in Produktionscode (bewusst, s. Abschnitt 2 der Spec) — die Regel lebt
   ausschliesslich als Test.
3. **T-21** (`src/mcp-server-info.js`): `MCP_BASE_INSTRUCTIONS` (neu, 305 Zeichen, gilt IMMER)
   + `MCP_CONSULT_INSTRUCTIONS` = Basis + Consult-Block (Komposition, nicht Ersatz — sonst
   waeren Abnahmekriterium 3 und der Wiederhol-Riegel-Test gleichzeitig unerfuellbar, s. Spec
   W-7). `mcpServerOptions()` liefert `instructions` jetzt IMMER (nie mehr `undefined`).
4. **T-21/DP-1** (`src/mcp-server.js`): der stdio-Server ruft denselben Options-Bauer
   (`mcpServerOptions`) wie der HTTP-Connector, mit `consultLoop:false` (dieser Prozess
   registriert `await_call_event`/`answer_consult` nicht). Kein neuer Modulgraph, kein Store
   (Pre-Mortem-Sorge des Plans entschaerft: `mcpServerOptions` importiert nur zwei Booleans-
   Konsumenten, `mcp-server.js` importierte `mcp-server-info.js` bereits vorher).
5. **O-27 Teil 1** (`src/mcp-server-info.js`): die Aufzaehlung `(calendar, mail, files, this
   chat)` im Consult-Block entfaellt. Die WIRKUNG bleibt woertlich: "answer from your own tools
   and context first; only ask the user when they are actually present right now, and never
   invent an answer."
6. Drei Bestandstests angepasst (Begruendung je Fall unten, Abschnitt 2).
7. Neue Testdatei `test/openai-p4-ergebnisstruktur-instructions.test.js`, sechs Faelle
   (Abnahmekriterien 1-7 des Plans, s. Abschnitt 3).

---

## 2. Die drei angepassten Bestandstests — mit Begruendung

| Datei | Fall | Alte Zusicherung | Neue Zusicherung | Grund |
|---|---|---|---|---|
| `test/mcp-tools-language.test.js` | `get_transcript bei laufendem Anruf: ...` | `JSON.parse(toolText(r)).error === MCP_TEXTS[language].callStillRunning` | `r.isError === true` (neu, additiv) UND `toolText(r) === MCP_TEXTS[language].callStillRunning` (ohne JSON-Huelle) | T-19: der Text ist nach dem Fix kein JSON mehr, nur die Huelle faellt weg — der Satz bleibt fuer alle `SUPPORTED_LANGUAGES` byte-identisch, DE zusaetzlich am vollen Wortlaut geprueft |
| `test/al-p13-consult-channel.test.js` | `AL-P13-37`: `mcpServerOptions ist ohne beide Schalter undefined (Bestand byte-identisch)` | alle Kombinationen ohne Consult -> `undefined` | umbenannt auf "... setzt instructions immer, Consult-Block nur am Schalter (T-21)"; jede Kombination traegt jetzt `instructions` (Basis oder Consult je nach `consultLoop`) | T-21 kippt genau diese Byte-Identitaets-Zusage ABSICHTLICH — `instructions` soll nie mehr `undefined` sein |
| `test/gq-b1-briefing-openness.test.js` | `GQ-B1-05`: `consultInstructions.startsWith("While a call placed with place_call is running")` | `startsWith`-Pin | `consultInstructions.includes(...)` (der Satz bleibt, nur seine Position aendert sich) | T-21 verlangt "Wichtigstes (Geld-Satz) in die ersten 512 Zeichen" — das schliesst einen `startsWith`-Pin auf den Consult-Satz aus. Die drei anderen Zusicherungen desselben Falls (Bestandssatz, "answer within seconds", keine Sekundenzahl) bleiben unveraendert und sind weiterhin erfuellt |

Alle drei Aenderungen sind additiv/umbenennend, keine wurde geloescht oder entschaerft. Zwei
weitere Bestandstests wurden VOR der Aenderung als potenziell betroffen geprueft und liefen
bereits vorher unveraendert gruen (keine Anpassung noetig):
`test/mcp-fehlergrund-rueckweg.test.js` (pinnt `await_call_event`, `NOT_PLACED`,
`Do NOT retry the call` — alle drei ueberleben, weil `MCP_CONSULT_INSTRUCTIONS` weiterhin Basis
UND Consult-Block traegt), `GQ-B2-03/04/05` in `test/gq-b1-briefing-openness.test.js` (pinnen
den Consult-Wortlaut ab 4c — unveraendert).

---

## 3. Neue Testdatei — sechs Faelle

`test/openai-p4-ergebnisstruktur-instructions.test.js`:

1. **T-19/T-20**: echter HTTP-`/mcp`-Request (`startServer`+`mcpPost`), `get_transcript` bei
   laufendem Anruf liefert `isError` + den lokalisierten Satz (Sprache explizit geseedet, DE)
   und NICHT `"Output validation error"`.
2. **T-19/T-20, die Regel**: tabellengetrieben ueber alle 10 `outputSchema`-Werkzeuge (Pruefmenge
   `TOOLS_WITH_OUTPUT_SCHEMA===10` aus der gelieferten Registrierung), je Erfolgslauf +
   Fehlerlauf, plus der gezielte `get_transcript`/`status:"active"`-Lauf.
3. **T-21 Konstanten**: `MCP_CONSULT_INSTRUCTIONS` traegt `not-placed` in den ersten 512
   Zeichen, NICHT mehr `"calendar, mail, files"`, mit Positiv-Kontrolle (`await_call_event`
   bleibt im Text).
4. **T-21**: echter HTTP-`initialize`-Request ohne Consult-Freigabe (BASE_ENV
   `CONSULT_ENABLED=false`, kein Override) liefert `MCP_BASE_INSTRUCTIONS`, nie `undefined`.
5. **T-21/DP-1**: echter stdio-Kindprozess (`StdioClientTransport`, kein InMemory-Transport,
   keine Quelltext-Inspektion) traegt `instructions` im `initialize`-Handshake.
6. **T-21/O-27 Wirkung**: der AUSGELIEFERTE Consult-Text (`mcpServerOptions(...)`, nicht die rohe
   Konstante) traegt die vier Wirkungen (Poll-Schleife, Quittungspflicht, eigene Quellen zuerst,
   `not-placed` nicht wiederholen) und NICHT die Aufzaehlung — ein Pin auf die Aufzaehlung waere
   mit Kriterium 6 unvereinbar, dieser Fall macht den Widerspruch strukturell unmoeglich.

Alle sechs Faelle sind bei Erstlauf, im gemeinsamen Lauf und im Vollbestand gruen.

---

## 4. Testzahlen

```
NODE_ENV=test node --test test/openai-p4-ergebnisstruktur-instructions.test.js
# -> 6 Faelle, # fail 0

NODE_ENV=test node --test test/mcp-tools-language.test.js
# -> 19 Faelle, # fail 0

NODE_ENV=test node --test test/al-p13-consult-channel.test.js test/gq-b1-briefing-openness.test.js test/mcp-fehlergrund-rueckweg.test.js
# -> 70 Faelle, # fail 0

NODE_ENV=test node --test --test-concurrency=4 test/openai-p2-tool-metadaten.test.js \
  test/openai-p3-security-schemes.test.js test/mcp-server-icon.test.js \
  test/mcp-tool-annotations.test.js test/mcp-tools.test.js test/mcp-ui.test.js
# -> 86 Faelle, # fail 0

npm test -- -- --test-concurrency=4
# -> # tests 6192 / # pass 6192 / # fail 0
```

**Baseline-Abweichung (offen zu dokumentieren, s. Spec W-4):** der Auftrag nennt 6166 gruen als
Vorher-Grundlinie. `6192 - 6 neue Faelle (Schritt 6) = 6186` ist die rechnerische Vorher-Zahl auf
diesem Branch-Tip — **22 mehr** als die im Auftrag genannten 6166, nicht die dort erwarteten 0.
Diese Phase hat die Baseline NICHT selbst vor der ersten Aenderung auf `master` gemessen (nur
den Netto-Testzuwachs ueber `git diff` verifiziert: `+7`/`-1` `test(`-Vorkommen in `test/**` =
netto +6, exakt die sechs neuen Faelle aus Schritt 6 — kein versehentlicher zusaetzlicher Test).
Die Differenz zur genannten 6166 ist damit plausibel reine Zaehl-/Zeitdrift zwischen dem
Auftrags-Zeitpunkt und diesem Lauf (P0 selbst nennt bereits einen dritten, wieder anderen Wert,
6153/6152 — s. Spec W-4) und keine dieser Phase zuzuschreibende Regression. Ein unabhaengiger
Pruefer sollte das vor dem Merge durch einen `git stash`-Lauf auf `master` selbst bestaetigen,
falls diese Zahl fuer die Abnahme kritisch ist.

Keine zurueckgelassenen Testserver (`ps aux` nach dem Lauf leer bzgl. `node --test`/
`server-mit-elternwaechter`/`npm test`). `data/store.json` der Hauptarbeitskopie unangetastet
(alle Server-Spawns liefen mit `DATA_DIR`-Overrides in Temp-Verzeichnissen, wie vom
Store-Multi-Tenant-Setup vorgesehen).

---

## 5. Offener Befund (nicht in dieser Phase behoben, absichtlich)

**W-3 (Spec):** `src/mcp-tools.js:940`, die `briefing`-Beschreibung von `place_call`, enthaelt
ebenfalls die Formulierung `(calendar, mail, files, chat)` — eine zweite, im Plan nicht genannte
Fundstelle derselben Werkzeug-Aufzaehlung. Diese Phase aendert sie NICHT: die Phasen-IDs
schneiden O-27 Teil 1 ausdruecklich auf `MCP_CONSULT_INSTRUCTIONS` zu, und die Briefing-
Beschreibung ist ein an `convo-bench` kalibrierter Anruf-Qualitaetstext (GQ-B2) mit eigenen
Zeichenbudget-Tests — eine Aenderung ohne Vorher-Messung waere genau das Muster, das die Lehre
`bench-must-reproduce-defect` verbietet. **Muss vor der Einreichung entschieden werden, sonst
schliesst jemand O-27 mit halber Abdeckung.**

---

## 6. Was NICHT gebaut wurde (mit Grund, s. auch Spec Abschnitt 2)

- Kein Laufzeit-Waechter fuer die outputSchema-Regel (waere Code, der im Betrieb nie greift —
  der SDK-Validator wirft bereits; die Regel lebt als Test).
- Keine Kuerzung des Instruktionstextes (der Plan verlangt umstellen/umformulieren, nicht
  kuerzen; die Laenge steigt sogar leicht, 1238 -> 1283).
- `consultPermissionHint` (O-27 Teil 2) — liegt in P5b, anderer Text, anderes Risiko.
- Die zweite `(calendar, mail, files, chat)`-Fundstelle (`src/mcp-tools.js:940`) — s. Abschnitt 5.
- `OWNER_PROFILE`/`DEFAULT_PROFILE`-Varianz der Tool-MENGE (P10/DP-5) — ausserhalb des Scopes.
- Keine neue Env-Variable (P4 brauchte keine — damit entfaellt die Vier-Orte-Pflicht).
- Kein `PLAN-SECURITY.md`-Eintrag — kein Safety-Gate beruehrt, `disclosureSentence` unangetastet.

---

## 7. Sicherheits-/Scope-Selbstpruefung

- Kein Safety-Gate (Outbound-Permit, `OUTBOUND_FROZEN`, Denylist, Land-Gate, Stundenlimit,
  Kostendecke, Max-Gespraechsdauer, Signaturpruefung) angefasst.
- `disclosureSentence` unangetastet (lebt in `src/claude.js`/EL-Prompt, nicht in dieser Phase).
- Kein echter Anruf, keine SMS, kein Deploy, kein Schreibzugriff auf Produktion — alle Belege
  laufen gegen lokal gespawnte Testserver mit Gateway-Attrappe oder gegen reine Modul-Constants.
- Keine neuen `eslint-disable`-artigen Marker, keine Magic Numbers ohne benannte Konstante
  (`HTTP_OK`, `INSTRUCTIONS_HEAD_CHARS` in der neuen Testdatei), kein toter/auskommentierter Code.
- `npm run lint` (Teil des `git commit`-Hooks) lief bei jedem der drei Commits durch — 0 Fehler,
  nur vorbestehende Warnungen in unveraenderten Dateien.
