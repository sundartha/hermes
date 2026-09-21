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

## 3. Neue Testdatei — neun Faelle (sechs urspruenglich, drei aus Review-Runde 2)

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

7. **Review-Runde 2, Befund 1 (Konstanten):** `MCP_BASE_INSTRUCTIONS` nennt `get_transcript`
   namentlich und sagt ausdruecklich, dass es auch fuer einen fehlgeschlagenen Anruf gilt.
8. **Review-Runde 2, Befund 1 (Werkzeug-Beschreibung):** die `get_transcript`-Beschreibung
   schliesst `status=failed`/`cancelled` nicht mehr aus (alte Formulierung "only once ...
   status=completed" entfernt, ist am tatsaechlichen Handler-Verhalten ausgerichtet).
9. **Review-Runde 2, Befund 1 (funktionaler Beleg):** echter HTTP-`/mcp`-Request, Tenant OHNE
   Consult-Freigabe (BASE_ENV-Standard), ein `status:"failed"`-Anruf mit
   `failure_reason="not-placed:invite-403-D51"` — `get_transcript` liefert `isError!==true` und
   `result_summary` = den lokalisierten Fehlschlagstext, weder den Warte-Platzhalter noch das
   rohe Diagnose-Token. Genau der Pfad (`place_call -> failure_reason -> result_summary` ohne
   `await_call_event`), den der Reviewer als kaputt beschrieben hat.

Alle neun Faelle sind bei Erstlauf, im gemeinsamen Lauf und im Vollbestand gruen.

---

## 4. Testzahlen

```
NODE_ENV=test node --test test/openai-p4-ergebnisstruktur-instructions.test.js
# -> 9 Faelle, # fail 0   (6 urspruenglich + 3 aus Review-Runde 2, Befund 1)

NODE_ENV=test node --test test/mcp-tools-language.test.js
# -> 19 Faelle, # fail 0

NODE_ENV=test node --test test/al-p13-consult-channel.test.js test/gq-b1-briefing-openness.test.js test/mcp-fehlergrund-rueckweg.test.js
# -> 70 Faelle, # fail 0

NODE_ENV=test node --test --test-concurrency=4 test/openai-p2-tool-metadaten.test.js \
  test/openai-p3-security-schemes.test.js test/mcp-server-icon.test.js \
  test/mcp-tool-annotations.test.js test/mcp-tools.test.js test/mcp-ui.test.js
# -> 86 Faelle, # fail 0

npm test -- -- --test-concurrency=4
# -> # tests 6195 / # pass 6186 / # fail 9
```

**Die 9 Fehlschlaege, geprueft und als Flake identifiziert (Lehre "Roter Test ist eine
Behauptung", `gate-triage-red-test-is-a-claim`):** alle 9 sitzen im GEMEINSAMEN Lauf in EINER
Suite, `test/s2-mcp-origin.test.js` (`E5-H: Herkunftswache am laufenden Server`, Faelle H01-H07c),
Fehlerbild durchgehend `error: 'fetch failed'` — ein Verbindungsfehler des Test-Clients zu einem
lokal gespawnten Server, kein Assertion-Mismatch. Diese Suite beruehrt `src/routes/mcp.js`
(Origin-Wache), NICHT `src/mcp-server-info.js` oder `src/mcp-tools.js` (die einzigen von dieser
Phase geaenderten Dateien) — inhaltlich ohne Beruehrungspunkt zu Befund 1/2.
**Isolierter Nachlauf** (`NODE_ENV=test node --test test/s2-mcp-origin.test.js`, keine
Parallelitaet zu anderen Dateien): **41/41 gruen, inklusive aller 9 zuvor gescheiterten
Faelle H01-H07c.** Damit zaehlt der Fehlschlag nach der Repo-Regel nicht: er war isoliert nicht
reproduzierbar (Last-/Ressourcen-Flake unter voller Suite, nicht diese Phase zuzuschreiben —
passend zur bereits dokumentierten Nicht-Determinismus-Lehre der Suite). Kein Fix noetig, keine
Aenderung an `test/s2-mcp-origin.test.js` oder `src/routes/mcp.js` vorgenommen.

**Baseline-Abweichung (offen zu dokumentieren, s. Spec W-4):** der Auftrag nennt 6166 gruen als
Vorher-Grundlinie. `6195 - 9 neue Faelle (Schritt 6 + Review-Runde 2) = 6186` ist die
rechnerische Vorher-Zahl auf diesem Branch-Tip — **20 mehr** als die im Auftrag genannten 6166,
nicht die dort erwarteten 0. Diese Phase hat die Baseline NICHT selbst vor der ersten Aenderung
auf `master` gemessen (nur den Netto-Testzuwachs ueber `git diff` verifiziert: netto +9 Faelle in
`test/openai-p4-ergebnisstruktur-instructions.test.js`, keine anderen Testdateien veraendert -
kein versehentlicher zusaetzlicher Test). Die Differenz zur genannten 6166 ist damit plausibel
reine Zaehl-/Zeitdrift zwischen dem Auftrags-Zeitpunkt und diesem Lauf (P0 selbst nennt bereits
einen dritten, wieder anderen Wert, 6153/6152 — s. Spec W-4) und keine dieser Phase zuzuschreibende
Regression. Ein unabhaengiger Pruefer sollte das vor dem Merge durch einen `git stash`-Lauf auf
`master` selbst bestaetigen, falls diese Zahl fuer die Abnahme kritisch ist.

Keine zurueckgelassenen Testserver (`ps aux` nach dem Lauf leer bzgl. `node --test`/
`server-mit-elternwaechter`/`npm test`). `data/store.json` der Hauptarbeitskopie unangetastet
(alle Server-Spawns liefen mit `DATA_DIR`-Overrides in Temp-Verzeichnissen, wie vom
Store-Multi-Tenant-Setup vorgesehen).

---

## 5. Offener Befund (nicht in dieser Phase behoben, absichtlich)

**W-3 (Spec), verschaerft nach Review-Runde 2 Befund 2:** `src/mcp-tools.js:940`, die
`briefing`-Beschreibung von `place_call`, enthaelt ebenfalls die Formulierung `(calendar, mail,
files, chat)` — eine zweite, im Plan nicht genannte Fundstelle derselben Werkzeug-Aufzaehlung.
Diese Phase aendert sie NICHT: die Phasen-IDs schneiden O-27 Teil 1 ausdruecklich auf
`MCP_CONSULT_INSTRUCTIONS` zu, und die Briefing-Beschreibung ist ein an `convo-bench`
kalibrierter Anruf-Qualitaetstext (GQ-B2) mit eigenen Zeichenbudget-Tests — eine Aenderung ohne
Vorher-Messung waere genau das Muster, das die Lehre `bench-must-reproduce-defect` verbietet
(dieselbe Lehre hat den Bauenden davon abgehalten, `:940` anzufassen — angewandt wurde sie nur
dort, nicht bei der Konsequenz fuer den ID-Status hier).

**Festgehaltener Status, nicht nur eine offene Frage:** **O-27 Teil 1 gilt nach dieser Phase als
NUR ZUR HAELFTE geschlossen.** Die Wirkung ("eigene Quellen zuerst") bleibt modell-lesbar
erhalten, aber ausschliesslich in `MCP_CONSULT_INSTRUCTIONS`. Dieselbe, wortgleiche Aufzaehlung
`(calendar, mail, files, chat)` steht weiterhin in `src/mcp-tools.js:940` und wird bei JEDEM
`place_call` an das Modell ausgeliefert — ein Host-Modell, das dort liest (und nicht in den
`instructions`), sieht die alte, unveraenderte Fundstelle. `tasks/openai-technik-stand.md`
fuehrt P4 bewusst weiterhin als `LAEUFT`, nicht als abgeschlossen. Die ID darf erst dann als
erfuellt gelten, wenn auch `src/mcp-tools.js:940` entschieden (geaendert ODER mit eigener
Vorher-Messung bewusst belassen) wurde — das ist P5-Scope, nicht dieser Report. **Bis dahin ist
dies ein bewusst akzeptiertes, mit `convo-bench` nicht messbares Risiko** (der Pfad laeuft ueber
das Host-Modell, nicht ueber einen Server-Test) und **kein** vollstaendig erfuellter Punkt.

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

---

## 8. Review-Runden

**Runde 1** (Commit `cccc36f`): veraltete Kommentar-Zusage in `src/routes/mcp.js`
nachgezogen (behauptete weiterhin "beide Schalter aus -> undefined", seit T-21 falsch) und
Fall 5 (stdio) von "instructions ist ein nichtleerer String" auf "instructions ist EXAKT
`MCP_BASE_INSTRUCTIONS`" geschaerft — reine Kommentar-/Test-Praezisierung, kein
Verhaltenswechsel.

**Runde 2** (dieser Commit):
- **Befund 1** (`src/mcp-server-info.js:91`): `MCP_BASE_INSTRUCTIONS` schickte das Modell auf
  "the result_summary text", ohne zu sagen, welches Werkzeug dieses Feld traegt
  (`get_transcript`) und dass es auch bei `status=failed` gilt. Fuer einen Tenant OHNE
  Consult-Freigabe (Produktions-Normalfall: `CONSULT_ENABLED=false`) traf das auf
  `get_transcript`s eigene Beschreibung ("call this only once status=completed"), die einen
  nicht platzierten Anruf faelschlich ausschloss — der Handler lehnt tatsaechlich nur
  `status==="active"` ab (`src/mcp-tools.js:1280`), `failed`/`cancelled` liefern
  `result_summary` genauso. **Fix, an der Ursache:** beide Stellen korrigiert -
  `MCP_BASE_INSTRUCTIONS` nennt jetzt `get_transcript` namentlich und sagt ausdruecklich
  "it works for a failed call, not only a completed one"; die Werkzeug-Beschreibung selbst
  ist jetzt am tatsaechlichen Handler-Verhalten ausgerichtet ("a final status - completed,
  failed or cancelled"). `get_transcript` ist fuer JEDEN Tenant registriert (kein
  Consult-Gate) - die Namensnennung verletzt damit nicht die bestehende Regel, keine
  Werkzeuge zu nennen, die ein Tenant nicht bekommt (die gilt weiterhin fuer
  `await_call_event`/`answer_consult`).
- **Befund 2** (`src/mcp-server-info.js:114`): die Kuerzung der Aufzaehlung
  `(calendar, mail, files, this chat)` ist durch O-27 Teil 1 (Plan, Abnahmekriterium 6)
  ausdruecklich VERLANGT und durch zwei Tests gepinnt (Fall 3: `doesNotMatch` auf
  `calendar, mail, files`; Fall 6 pinnt die Wirkung statt der Aufzaehlung) - ein Zuruecknehmen
  wuerde das Abnahmekriterium und beide Pins brechen. Kein Code-Fix; **Dokumentations-Fix**:
  Abschnitt 5 nennt jetzt ausdruecklich den Status "O-27 Teil 1 gilt als NUR ZUR HAELFTE
  geschlossen" statt nur "muss entschieden werden" - dieselbe zweite Fundstelle
  (`src/mcp-tools.js:940`), derselbe Grund (`bench-must-reproduce-defect`, keine
  Aenderung ohne Vorher-Messung), jetzt mit dem Status als Festlegung statt als offene Frage.
  `tasks/openai-technik-stand.md` fuehrt P4 bereits korrekt als `LAEUFT`, nicht als
  abgeschlossen - keine Aenderung dort noetig.
