# P4-Abschlussbericht — get_transcript ohne structuredContent + Server-instructions

**IDs:** T-19, T-20, T-21, O-27 (Teil 1). **Branch:** `phase/openai-p4-defekte`, aktueller
Stand **`26042cf`** (Basis `master` `8f8de37`).

**Hinweis zum Stand:** der Kickoff dieses Berichts nannte `68a946e` als Commit — das ist
der Stand, an dem der ERSTE Berichtsentwurf entstand, **vor** zwei Review-Runden mit
Fixes (`cccc36f`, `26042cf`). Dieser Bericht misst gegen den tatsaechlichen Branch-Tip
`26042cf` (Vorgabe CLAUDE.md: Quelldateien neu lesen, nicht auf Zusammenfassungen
verlassen) und ersetzt den ersten Entwurf vollstaendig.

---

## 0. Was NICHT erfuellt ist — zuerst, nicht versteckt

1. **O-27 Teil 1 ist nur zur HAELFTE geschlossen.** Die Aufzaehlung
   `(calendar, mail, files, chat)` ist aus `MCP_CONSULT_INSTRUCTIONS`
   (`src/mcp-server-info.js`) entfernt — aber dieselbe, wortgleiche Aufzaehlung steht
   weiterhin unveraendert in der `place_call`-Briefing-Beschreibung,
   **`src/mcp-tools.js:940`**, verifiziert per `sed -n '935,945p' src/mcp-tools.js` an
   diesem Branch-Tip. Diese Phase aendert die Stelle bewusst nicht (Begruendung:
   `convo-bench`-kalibrierter Text, Lehre `bench-must-reproduce-defect` verbietet eine
   Aenderung ohne Vorher-Messung). `tasks/openai-technik-stand.md` (Hauptarbeitskopie,
   Zeile 27) fuehrt P4 deshalb korrekt als **LAEUFT**, nicht als abgeschlossen — mit der
   Phase selbst so festgehalten, nicht erst durch diesen Bericht.
2. **Dokumentations-Fehler im ersten Berichtsentwurf, bei dieser Verifikation gefunden und
   hier korrigiert:** der Abschnitt "Vorher-/Nachher-Messung" des Entwurfs bei `68a946e`
   nennt fuer `MCP_BASE_INSTRUCTIONS`/`MCP_CONSULT_INSTRUCTIONS` die Laengen 305/1283
   Zeichen. Das war der Stand **vor** Review-Runde 2 (Befund 1 haengte den
   `get_transcript`-Wegweiser an `MCP_BASE_INSTRUCTIONS`), wurde nach dem Fix aber nicht
   nachgezogen. Direkt am aktuellen Branch-Tip gemessen (Befehl unten, Abschnitt 3) sind
   es **403 / 1381 Zeichen**. Die inhaltlichen Zusicherungen bleiben richtig (Geld-Satz
   in den ersten 512 Zeichen, Aufzaehlung entfernt) — nur die zwei absoluten Zahlen waren
   im alten Entwurf stehen geblieben. Kein Test pinnt diese Laengen (geprueft per
   `grep -n "\.length"` auf den drei betroffenen Testdateien), es ist eine reine
   Text-Ungenauigkeit im vorigen Bericht, keine Funktionsluecke.
3. **Kein Laufzeit-Waechter** fuer die outputSchema/isError-Regel in Produktionscode —
   bewusst, die Regel lebt ausschliesslich als Test (`test/openai-p4-...test.js`, Fall 2).
4. **`consultPermissionHint` (O-27 Teil 2)** nicht angefasst — anderer Text
   (`src/i18n/mcp-texts.js`), liegt explizit in P5b.
5. **`OWNER_PROFILE`/`DEFAULT_PROFILE` Tool-Mengen-Varianz (DP-5)** nicht angefasst —
   liegt in P10.
6. **Baseline-Zahl vor dieser Phase nicht selbst gemessen:** weder der erste Entwurf noch
   diese Verifikation hat `master` vor der ersten P4-Aenderung isoliert durchlaufen lassen
   (nur der Netto-Testzuwachs im Diff kontrolliert: +9 Faelle in genau einer neuen Datei,
   keine andere Testdatei veraendert). Der Auftrag nennt "6192 gruen/0 rot" als letzten
   bekannten Wert; mein eigener, an diesem Branch-Tip in dieser Session gefahrener Lauf
   ergab `# tests 6195 / # pass 6195 / # fail 0` (roh) bzw. nach dem
   `testbaenke-run`-Korrekturabzug der 20 Datei-Wrapper ohne echten Test: `6175/6175/0`.
   Die Differenz zu 6192 ist **UNKNOWN** — plausibel Zaehl-/Zeitdrift zwischen Messzeitpunkten
   (dieselbe Drift ist in der Kette schon mehrfach aufgetreten, s. `tasks/openai-p0-entscheidungen.md`),
   aber nicht selbst auf `master` nachgerechnet. Fuer die Abnahme-Entscheidung zaehlt: **0
   rot**, in zwei unabhaengigen Laeufen (Vorgaenger-Session lt. Auftrag, diese Session).

---

## 1. Was diese Phase erfuellt — ID fuer ID mit Beweisstelle

**T-19** (get_transcript liefert bei laufendem Anruf ein MCP-Fehlerergebnis statt einer
kaputten JSON-Huelle im Textblock):
- Code: `src/mcp-tools.js:1267` (aktuelle Zeile — vorher `text({error:...})`, jetzt
  `errText(loc.mcp.callStillRunning)`; `errText` bei `src/mcp-tools.js:84`,
  `isError: true`).
- Test (Bestand, angepasst): `test/mcp-tools-language.test.js`, Fall
  `"get_transcript bei laufendem Anruf: Hinweistext folgt der Tenant-Sprache (P15/T3a)"`
  — prueft `r.isError === true` UND den byte-identischen Satz ohne JSON-Huelle, ueber
  ALLE `SUPPORTED_LANGUAGES`.
- Test (neu): `test/openai-p4-ergebnisstruktur-instructions.test.js`, Fall 1
  (`P4 (T-19/T-20): get_transcript bei laufendem Anruf liefert isError + den
  lokalisierten Satz, nicht "Output validation error"`) — echter HTTP-`/mcp`-Request,
  prueft zusaetzlich `assert.doesNotMatch(text, /Output validation error/)`: die
  Positiv-UND-Negativ-Kontrolle gegen genau den SDK-Fehler, den T-19 beheben soll.

**T-20** (die Regel dahinter: JEDES Werkzeug mit `outputSchema` liefert in jedem
Rueckgabepfad `structuredContent` ODER `isError` — kein Einzelfall-Fix):
- Test (neu): `test/openai-p4-ergebnisstruktur-instructions.test.js`, Fall 2
  (`P4 (T-19/T-20 Regel): jedes Werkzeug mit outputSchema liefert in jedem
  Rueckgabepfad structuredContent ODER isError`) — tabellengetrieben ueber alle
  Werkzeuge mit deklariertem `outputSchema`, Pruefmenge aus der tatsaechlichen
  `registerTool()`-Registrierung (nicht aus einer gepflegten Namensliste), Groesse per
  `TOOLS_WITH_OUTPUT_SCHEMA = 10` (`test/helpers.js:62`) gepinnt. Je Werkzeug ein
  Erfolgslauf (Positiv-Kontrolle: `isError !== true` UND `structuredContent` vorhanden)
  und ein Fehlerlauf.

**T-21** (Server-`instructions` sind IMMER gesetzt — HTTP wie stdio, mit oder ohne
Consult-Freigabe — statt teilweise `undefined`):
- Code: `src/mcp-server-info.js` — `MCP_BASE_INSTRUCTIONS` (neu, gilt immer),
  `CONSULT_BLOCK` (modul-intern), `MCP_CONSULT_INSTRUCTIONS = MCP_BASE_INSTRUCTIONS + " " +
  CONSULT_BLOCK` (Komposition, kein Ersatz). `mcpServerOptions({uiEnabled, consultLoop})`
  liefert `options.instructions` unbedingt, der `undefined`-Ruecksprung ist entfernt.
- Code (HTTP-Pfad): `src/routes/mcp.js:136-142` ruft `mcpServerOptions(...)` bereits
  vorher, Kommentar dort auf den neuen Vertrag nachgezogen (kein Verhaltenswechsel an
  dieser Stelle).
- Code (stdio-Pfad, DP-1): `src/mcp-server.js` ruft jetzt denselben Bauer
  (`mcpServerOptions`) statt eines eigenen Ternarys, mit `STDIO_CONSULT_LOOP = false`
  fest verdrahtet (dieser Prozess registriert `await_call_event`/`answer_consult` nicht).
- Test (Bestand, angepasst — Byte-Identitaets-Zusage bewusst gekippt):
  `test/al-p13-consult-channel.test.js`, Fall `AL-P13-37` — prueft jetzt, dass
  `instructions` in JEDER Schalterkombination gesetzt ist (Basis- oder Consult-Block, nie
  `undefined`).
- Test (Bestand, angepasst): `test/gq-b1-briefing-openness.test.js`, Fall `GQ-B1-05` —
  `startsWith`-Pin auf `includes` umgestellt (der Geld-Satz muss laut T-21 in den ersten
  512 Zeichen stehen, der Consult-Satz rueckt dadurch von Position 0 weg; der Satz selbst
  bleibt erhalten).
- Test (neu), HTTP: Fall 4 (`P4 (T-21): initialize ohne Consult-Freigabe traegt den
  Basis-Block, nicht undefined und nicht den Consult-Text`) — echter `/mcp`-Request ohne
  `CONSULT_ENABLED`-Override (Produktions-Normalfall).
- Test (neu), stdio: Fall 5 (`P4 (T-21 stdio, DP-1): der echte stdio-Kindprozess traegt
  instructions im initialize-Handshake`) — echter Kindprozess ueber
  `StdioClientTransport`, kein InMemory-Transport, keine Quelltext-Inspektion.
- Eigene Nachmessung (diese Session, am Branch-Tip): `MCP_BASE_INSTRUCTIONS.length ===
  403`, nicht leer, enthaelt `"get_transcript"`; `mcpServerOptions({uiEnabled:false,
  consultLoop:false})` liefert ein Objekt mit `instructions`-Feld (kein `undefined` mehr).

**O-27 Teil 1** (Aufzaehlung fremder Werkzeugklassen `(calendar, mail, files, chat)`
entfaellt in der Server-`instructions`-Konstante; die WIRKUNG — eigene Quellen zuerst,
nur bei echter Anwesenheit fragen, nichts erfinden — bleibt):
- Code: `src/mcp-server-info.js`, `CONSULT_BLOCK` — die Aufzaehlung ist aus dem Satz
  `"answer_consult - answer from your own tools and context first..."` entfernt.
- Test (neu): Fall 3 (`P4 (T-21 Konstanten): ...traegt den Geld-Satz in den ersten 512
  Zeichen, nicht mehr die Werkzeug-Aufzaehlung`) — `!MCP_CONSULT_INSTRUCTIONS.includes("calendar,
  mail, files")`, mit Positiv-Kontrolle (`includes("await_call_event")`).
- Test (neu): Fall 6 (`P4 (T-21/O-27 Wirkung): der ausgelieferte Consult-Text traegt die
  vier Wirkungen, nicht die Aufzaehlung`) — prueft gegen den **ausgelieferten** Text
  (`mcpServerOptions(...).instructions`), nicht nur die rohe Konstante; vier
  Wirkungs-Assertions plus `assert.doesNotMatch(text, /calendar, mail, files/)`.
- **Eingeschraenkt auf `MCP_CONSULT_INSTRUCTIONS`** — die zweite Fundstelle
  `src/mcp-tools.js:940` ist NICHT Teil dieser Erfuellung, s. Abschnitt 0.1.

**Review-Runde 2, Befund 1** (nicht Teil der urspruenglichen vier IDs, aber am selben
Code gefunden und hier mit-behoben — genannt, weil er sonst wie eine stille
Nachbesserung aussaehe): `MCP_BASE_INSTRUCTIONS` schickte das Modell auf
"the result_summary text", ohne zu sagen, dass `get_transcript` dieses Feld traegt und
dass es auch bei `status=failed` gilt; `get_transcript`s eigene Beschreibung schloss
`status=failed` faelschlich aus ("call this only once status=completed"), obwohl der
Handler (`src/mcp-tools.js:1280`) nur `status==="active"` ablehnt.
- Fix: `src/mcp-server-info.js` (`MCP_BASE_INSTRUCTIONS` nennt `get_transcript` jetzt
  namentlich, "not only a completed one"); `src/mcp-tools.js`, Werkzeug-Beschreibung von
  `get_transcript` auf "a final status - completed, failed or cancelled" umformuliert.
- Test (neu): Faelle 7-9 (`P4 (Review-Runde 2, Befund 1): ...`), Fall 9 ist ein echter
  HTTP-Request mit `status:"failed"`-Anruf und `failure_reason="not-placed:..."` ohne
  Consult-Kanal — genau der vorher kaputte Pfad.

---

## 2. Beruehrte Pfade — und ob der Punkt auf ALLEN erfuellt ist

| Pfad | T-19/T-20 | T-21 | O-27 Teil 1 |
|---|---|---|---|
| HTTP `/mcp` (`src/routes/mcp.js`) | erfuellt, Fall 1 + Regel-Fall 2 | erfuellt, Fall 4 | erfuellt (Text kommt aus derselben Konstante) |
| stdio (`src/mcp-server.js`, Claude Desktop) | erfuellt — `get_transcript`-Handler ist transport-unabhaengig (`registerTools()` wird von beiden Prozessen aufgerufen, keine zweite Implementierung) | erfuellt, Fall 5 (echter Kindprozess-Spawn, nicht nur Quelltext-Lesen) | erfuellt (derselbe `mcpServerOptions`-Bauer) |
| ChatGPT-Adapter / Widget-Renderer | erfuellt strukturell: `get_transcript` traegt kein Widget-`_meta` (`src/mcp-tools.js:1250-1264`, kein `enableWidgetUi(...)`), der Renderer erreicht Handler-Ergebnisse nicht, nur Tool-Deskriptoren | n/a (Instructions sind kein Renderer-Feld) | n/a |
| `place_call`-Briefing (`src/mcp-tools.js:940`) | n/a | n/a | **NICHT erfuellt**, s. Abschnitt 0.1 — dieselbe Aufzaehlung steht dort unveraendert |

Fuer T-19/T-20/T-21 gilt: **auf allen gemessenen Pfaden erfuellt.** Fuer O-27 Teil 1 gilt
das ausdruecklich NICHT auf allen Oberflaechen — nur auf `MCP_CONSULT_INSTRUCTIONS`, nicht
auf der `place_call`-Briefing-Beschreibung.

---

## 3. Nachmess-Anleitung fuer einen externen Pruefer

Neutral formuliert — jeder Punkt fragt "ist X erfuellt, und woran siehst du das", nicht
"bestaetige X":

1. **Steht der Branch auf dem hier behaupteten Commit?**
   `git -C <worktree> log --oneline -1` → erwartet `26042cf ...`. Stimmt das nicht, ist
   dieser Bericht gegen einen anderen Stand geschrieben und ungueltig fuer den aktuellen
   Code.
2. **Liefert `get_transcript` bei laufendem Anruf ein MCP-Fehlerergebnis, keine kaputte
   JSON-Huelle?**
   `NODE_ENV=test node --test test/openai-p4-ergebnisstruktur-instructions.test.js` und
   `NODE_ENV=test node --test test/mcp-tools-language.test.js` — beide auf `# fail 0`?
   Enthaelt der Testcode fuer Fall 1 eine explizite Negativ-Kontrolle gegen
   `"Output validation error"` (nicht nur eine Positiv-Assertion, die auch beim alten
   Defekt zufaellig traefe)?
3. **Gilt die Regel fuer ALLE Werkzeuge mit `outputSchema`, nicht nur `get_transcript`?**
   In `test/helpers.js` nach `TOOLS_WITH_OUTPUT_SCHEMA` suchen — welcher Wert steht dort,
   und woher kommt die Pruefmenge im Testfall (`grep -n "outputSchema" src/mcp-tools.js`
   gegen dieselbe Zahl gegenpruefen — stammt die Menge aus der echten Registrierung oder
   aus einer separat gepflegten Liste, die veralten koennte)?
4. **Ist `instructions` in JEDER Schalterkombination gesetzt, nie mehr `undefined`?**
   `node -e 'import("./src/mcp-server-info.js").then(m=>console.log(m.mcpServerOptions({uiEnabled:false,consultLoop:false})))'`
   am Branch-Tip ausfuehren — was liefert das Feld `instructions`? Steht in
   `src/mcp-server.js` derselbe Bauer wie in `src/routes/mcp.js`, oder zwei getrennte
   Implementierungen, die auseinanderlaufen koennten?
5. **Traegt der stdio-Pfad `instructions` tatsaechlich ueber einen echten Kindprozess,
   nicht nur laut Quelltext?**
   Testfall 5 der neuen Datei lesen: verwendet er `StdioClientTransport` mit einem
   echten `process.execPath`-Spawn, oder einen InMemory-Transport/Mock? Ein Spawn ist der
   staerkere Beleg.
6. **Steht der Geld-Satz (`not-placed`-Wiederhol-Riegel) in den ersten 512 Zeichen von
   `MCP_CONSULT_INSTRUCTIONS`, und fehlt die Aufzaehlung `(calendar, mail, files, chat)`
   dort wirklich?**
   `node -e 'import("./src/mcp-server-info.js").then(m=>{const s=m.MCP_CONSULT_INSTRUCTIONS;console.log(s.slice(0,512).includes("not-placed"), s.includes("calendar, mail, files"));})'`
   — beide Werte am Branch-Tip nachrechnen, nicht die Zahlen aus diesem Bericht
   uebernehmen.
7. **Ist O-27 Teil 1 wirklich nur halb geschlossen, oder wurde die zweite Fundstelle doch
   mitgeaendert?**
   `sed -n '935,945p' src/mcp-tools.js` — steht dort noch `(calendar, mail, files, chat)`?
   Falls ja: stimmt `tasks/openai-technik-stand.md` (Hauptarbeitskopie, nicht Teil dieses
   Branches) mit dem Status "P4 LAEUFT" ueberein, oder wurde die Phase dort faelschlich
   schon als fertig eingetragen?
8. **Ist die Test-Suite tatsaechlich gruen, und ist die genannte Fehlschlagszahl (9 Faelle
   in einem frueheren Lauf) wirklich ein Last-Flake und keine echte Regression?**
   `npm test -- -- --test-concurrency=4` im Worktree fahren (dauert ca. 7 Minuten) —
   welche Endzeile zeigt `# fail`? Bei einem Fehlschlag: betrifft er
   `test/s2-mcp-origin.test.js`, und verschwindet er bei
   `NODE_ENV=test node --test test/s2-mcp-origin.test.js` isoliert? Wenn ja, stuetzt das
   die Flake-These; wenn ein anderer Test faellt oder der Fehlschlag isoliert bestehen
   bleibt, ist es KEIN Flake mehr und muss vor dem Merge geklaert werden.
9. **Lint sauber, keine neuen Unterdrueckungen?**
   `npx eslint src/mcp-tools.js src/mcp-server-info.js src/mcp-server.js src/routes/mcp.js
   test/openai-p4-ergebnisstruktur-instructions.test.js` — Ausgabe leer? Enthaelt der Diff
   ein neues `eslint-disable` oder einen Eintrag in `eslint-suppressions.json`?
10. **Bleibt der Offenlegungssatz/ein Safety-Gate unangetastet?**
    `git diff master...phase/openai-p4-defekte -- src/claude.js src/config.js
    src/telephony/` — leer? Falls nicht leer, widerspricht das der Zusage in Abschnitt 7
    des Berichtsentwurfs.

---

## 4. Restrisiko

Das inhaltliche Risiko dieser Phase ist klein und gut eingegrenzt: es werden keine
Safety-Gates, keine Auth-Pfade und kein Offenlegungssatz beruehrt, alle vier IDs sind
lokal (zwei Konstanten, ein Rueckgabewert, eine Aufzaehlung) und ueber echte
End-to-End-Requests (HTTP UND echter stdio-Kindprozess-Spawn) belegt, nicht nur ueber
Unit-Tests auf Quelltext-Ebene. Das groesste verbleibende Risiko ist prozessual, nicht
technisch: O-27 gilt in der Wahrnehmung leicht als "erledigt", weil drei der vier IDs
sauber gruen sind, obwohl die zweite Fundstelle (`src/mcp-tools.js:940`) bewusst offen
gelassen wurde und ein Host-Modell, das die `place_call`-Briefing-Beschreibung liest
(statt der `instructions`), weiterhin die volle Werkzeug-Aufzaehlung sieht — das ist ein
minimal groesseres Preisgabe-Risiko fremder Werkzeugklassen gegenueber dem Host-Modell,
nicht gegenueber dem Anrufer, und ohne Bezug zu einem Safety-Gate. Zweitens bleibt die
Vorher-Baseline der Tests ungeklaert (6192 laut Auftrag vs. 6195 roh / 6175 korrigiert in
dieser Session) — beide Werte sind "0 rot" und stuetzen damit unabhaengig dieselbe
Merge-Entscheidung, aber die Differenz selbst wurde nicht auf `master` isoliert
nachgerechnet. Drittens: die frueher beobachteten 9 Fehlschlaege in
`test/s2-mcp-origin.test.js` traten in meinem eigenen Lauf dieser Session nicht auf
(0 Fehlschlaege gesamt) — das staerkt die Flake-thece, beweist sie aber nicht abschliessend
fuer jede zukuenftige CI-Umgebung mit anderer Hardware-Auslastung.

---

## 5. Testzahlen (Anhang, Beleg zu Abschnitt 0.6)

Eigener Lauf dieser Session, am Branch-Tip `26042cf`, Kommando
`npm test -- -- --test-concurrency=4` (doppelter `--`-Trenner reicht das Flag durch):

```
# tests 6195
# suites 80
# pass 6195
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 408462.227917

# testbaenke-run (regression): 20 Datei-Wrapper ohne echten Test abgezogen
# korrigiert: tests 6175 / pass 6175 / fail 0
```

Einzellaeufe der direkt betroffenen Dateien (zur schnelleren Nachpruefung, ohne die volle
~7-Minuten-Suite):

```
NODE_ENV=test node --test test/openai-p4-ergebnisstruktur-instructions.test.js
# 9 Faelle: 6 urspruengliche (Abnahmekriterien 1-7) + 3 aus Review-Runde 2, Befund 1

NODE_ENV=test node --test test/mcp-tools-language.test.js
NODE_ENV=test node --test test/al-p13-consult-channel.test.js test/gq-b1-briefing-openness.test.js
```

`npx eslint src/mcp-tools.js src/mcp-server-info.js src/mcp-server.js src/routes/mcp.js
test/openai-p4-ergebnisstruktur-instructions.test.js test/mcp-tools-language.test.js
test/al-p13-consult-channel.test.js test/gq-b1-briefing-openness.test.js` — leere Ausgabe,
keine neuen Unterdrueckungen.

`node --check src/mcp-tools.js && node --check src/mcp-server-info.js && node --check
src/mcp-server.js` — durchgelaufen.

---

## 6. Review-Runden (zur Einordnung, Kurzfassung)

- **Runde 1** (`cccc36f`): veraltete Kommentar-Zusage in `src/routes/mcp.js`
  nachgezogen, Test-Schaerfung stdio-Fall. Kein Verhaltenswechsel.
- **Runde 2** (`26042cf`): echter funktionaler Fund (Befund 1, s. Abschnitt 1) —
  `get_transcript` war fuer einen fehlgeschlagenen Anruf ohne Consult-Kanal textuell
  unerreichbar, weil sowohl die Basis-Instruktion als auch die Werkzeug-Beschreibung
  selbst `status=failed` ausschlossen. Behoben an beiden Stellen, mit drei neuen
  Testfaellen. Befund 2 (dieselbe zweite O-27-Fundstelle) war ein reiner
  Dokumentations-Praezisierungs-Fund, kein Code-Fix.
- **Runde 3** (laut Auftrag): 0 Blocker, beide Rollen PASS. Kein weiterer Commit — die
  Fixes aus Runde 2 wurden ohne neue Einwaende akzeptiert. Ich habe diese Runde nicht
  selbst durchgefuehrt (sie liegt ausserhalb dieses Berichts-Auftrags) und kann ihren
  Ablauf nur wie im Auftrag angegeben wiedergeben — die inhaltlichen Befunde davor (Runde
  1+2) habe ich am Diff selbst nachvollzogen.
