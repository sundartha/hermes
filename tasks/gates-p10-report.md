# Phase GATES-P10: MCP-Oberflaeche (MCP-14, LANG-15)

- **Gate**: BLOCKED
- **finalBranch**: `phase/gates-p10-mcp-oberflaeche-fix1`
- **Katalog-IDs**: MCP-14 (Stufe-0-Text host-unabhaengig deutschfrei), LANG-15 (wirkungsloser `place_call.language`-Parameter entfernt)

## Hinweis zur Herkunft

Die Implementierung stammt aus dem am 2026-07-27 abgestuerzten Lauf. Dieser
Workflow hat KEINE neue Implementierung vorgenommen, sondern nur Review
(Safety + Clean-Code) und eine Self-Fix-Runde auf dem bereits vorliegenden
Branch/Commit `88bb6ca` nachgeholt. Es wurde weder neu geplant noch neu
implementiert.

## Abnahme

### 1. Gates gruen

Eigener Lauf `npm run test:gates` auf `88bb6ca`: 516 tests / 496 pass / 20 fail.
Die beiden Ziel-Gates dieser Phase sind GRUEN:

- "MCP-14 (SOLL, rot) - Stufe-0-Text eines EN-Tenants traegt keine deutschen
  Artefakte, auch bei faehigem Host" -> ok 229
- "MCP-14 (Mechanismus, gruen) - der Stufe-0-Text ist host-unabhaengig" -> ok 230
- "LANG-15 (SOLL, rot) - das MCP-Schema bietet keinen wirkungslosen
  place_call.language-Parameter mehr" -> ok 302
- "LANG-15 (Mechanismus, gruen) - body.language wird serverseitig ignoriert,
  der Geo-Anker gewinnt" -> ok 158

Gegenprobe an der Basis `5fe5980` gefahren (516/494/22) und die Fehlermengen
verglichen: genau die zwei Ziel-Gates kippen rot->gruen, NEU rot am HEAD ist
leer. Die verbleibenden 20 roten Gates gehoeren zu offenen Fremdphasen
(FMT-15, GAP-19 x2, WEB-08, GAP-23 x2, GAP-11, GAP-05, GAP-15 x2, GAP-31,
GAP-26, GAP-06, OUT-14, GAP-37, WEB-10, VOICE-12, GAP-24, WEB-13) und sind an
der Basis identisch rot. GAP-31 (locale-field-consumers) wurde explizit
nachgelesen: scheitert nur an `sttLocale` (locales.js, P9) - die neuen
mcp-texts-Felder haben Konsumenten.

### 2. Regression — NICHT erfuellt

`npm test` auf `88bb6ca`: 3321 tests / 3320 pass / **1 FAIL**. Der rote Test
ist ein bestehender, an der Basis gruener Regressionstest: "P1-02 (nach P2b):
place_call-Schema bleibt strukturell unveraendert (gleiche Felder +
Optionalitaet)" in `test/place-call-context-bridge.test.js:70`.

Kein Spawn-Flake: reine Schema-Assertion, isoliert nachgefahren
(`node --test test/place-call-context-bridge.test.js`) = 5 tests / 4 pass /
1 fail, deterministisch. Gegenprobe: dieselbe Datei mit den Basis-Staenden
von `test/place-call-context-bridge.test.js` + `src/mcp-tools.js` (`5fe5980`)
= 5/5 gruen. Der Fehlschlag ist also NEU und von dieser Phase verursacht:
`actual`-Keys ohne `language`, `expected`-Keys mit `language`.

### 3. Produkt-Diff — nicht leer, substanziell

- `src/mcp-tools.js` — drei deutsche Stufe-0-Literale -> `loc.mcp`;
  `place_call.language` aus dem Zod-Schema entfernt
- `src/i18n/mcp-texts.js` — Buendel-Schluessel de/en/fr
  (`emptyActionItems`, `appointmentPrefix`, `calendarLine`)

Das ist ein echter Produktfix, kein umgeschriebenes Gate — der
Praezedenzfall VOICE-12 liegt hier NICHT vor.

### 4. Testaenderungen — zulaessig

Die Streichung von `"place_call.language"` aus `EXPECTED_MARKERS` ist
woertlich freigegeben. Die zwei neu ergaenzten Tests in
`test/mcp-tools-language.test.js` tragen korrekt KEINE Katalog-ID am
Namensanfang (Regressionsschutz). Kein bestehender Test wurde umgeschrieben
oder geloescht.

## Safety-Review — Ergebnis

`approved: false`. Absolute Regeln halten samt und sonders: kein
Safety-Gate beruehrt (Diff enthaelt weder `outbound-gates.js` noch
`config.js`, `claude.js`, `bridge.js`, `auth`/`web-auth`, `middleware`), der
Offenlegungssatz ist unberuehrt, keine Auth-/Endpunkt-Aenderung, keine neue
npm-Dependency, keine Secrets in den neuen MCP-Texten, kein Audio durch MCP.
Die Entfernung von `place_call.language` ist fuer Clients verhaltensneutral
(Zod strippt unbekannte Keys; serverseitig gewann schon vorher
`resolveCallLanguage` — genau das pinnt der gruene LANG-15-Mechanismus-Test).
DE bleibt byte-identisch.

**scopeRespected: false** — siehe Concerns unten.

### Blocker

1. **BLOCKER 1 (Abnahmepunkt 2 verletzt)**: `npm test` ist nicht 0 rot. Der
   bestehende, an der Basis gruene Regressionstest "P1-02 (nach P2b):
   place_call-Schema bleibt strukturell unveraendert"
   (`test/place-call-context-bridge.test.js:70`, `PLACE_CALL_SHAPE` ab :48)
   pinnt den Feldsatz von `place_call` inklusive `language`. Die
   LANG-15-Umsetzung entfernt das Feld aus dem Zod-Schema
   (`src/mcp-tools.js:492`) und bricht damit diesen Pin. Isoliert
   reproduziert, an der Basis gruen bewiesen — kein Voll-Last-Flake.

2. **BLOCKER 2 (Spec-Luecke, verursacht Blocker 1 — NICHT durch eine
   weitere Testaenderung zu "fixen")**: Die Phase ist unter ihrer eigenen
   Spec unabschliessbar. LANG-15
   (`test/p15-mcp-tool-descriptions-en.test.js:148`, Entscheidung E3)
   verlangt die Entfernung von `place_call.language`; die "zulaessige
   Testaenderung" von P10 nennt aber ausschliesslich `EXPECTED_MARKERS` in
   `test/p15-mcp-tool-descriptions-en.test.js` und deckt `PLACE_CALL_SHAPE`
   in `test/place-call-context-bridge.test.js` nicht ab. Die Regel am
   Dokumentanfang von `tasks/gates-fix-chain.md` ("Faellt ein heute gruener
   Test, der dort nicht genannt ist, ist das ein Blocker: melden, NICHT
   anpassen. Es gibt keine neuen Ausnahmen.") greift damit. Der Impl-Agent
   hat sich korrekt verhalten: Commit `88bb6ca` nimmt genau diese
   unzulaessige Testanpassung aus `3bdb835` zurueck (`PLACE_CALL_SHAPE` +
   Testname). Es braucht eine Owner-Entscheidung, keine Agenten-Runde:
   entweder (a) P10s Liste zulaessiger Testaenderungen um `PLACE_CALL_SHAPE`
   + den Titel-Suffix in `test/place-call-context-bridge.test.js`
   erweitern (dann ist die Phase in einer Runde fertig — der Fix aus
   `3bdb835` war inhaltlich richtig), oder (b) LANG-15 aus P10 herausnehmen
   und die `place_call.language`-Entfernung als eigene Phase mit passender
   Testfreigabe fahren. Ohne diese Entscheidung darf nichts gemergt werden
   — ein Merge nach master wuerde `npm test` dauerhaft rot machen.

### Concerns

- **Scope-Ueberschreitung um eine Datei**: Die Dateiliste von P10 nennt
  ausschliesslich `src/mcp-tools.js`. Geaendert wurde zusaetzlich
  `src/i18n/mcp-texts.js` (+ `emptyActionItems`/`appointmentPrefix`/
  `calendarLine` je de/en/fr, rein additiv). Nicht zurueckzubauen — die
  Alternative (Sprachtabellen inline in `mcp-tools.js`) waere schlechter,
  `loc.mcp.emptyCalendar` liegt schon dort, und die Datei kommt in keiner
  anderen Phasen-Dateiliste vor (alle 15 Dateilisten geprueft). Richtiger
  Weg: Owner ergaenzt `src/i18n/mcp-texts.js` in der P10-Dateiliste.
- **Merge-Konflikt-Risiko in der Welle**: P12 (WEB-10/WEB-13) laeuft
  parallel und koennte ebenfalls Locale-Schluessel anlegen. Rein textueller
  Konflikt in `src/i18n/mcp-texts.js` moeglich, kein semantisches Risiko.
- **Schwache Assertion**: Die `SUPPORTED_LANGUAGES`-Schleife in T17
  vergleicht `toolText(r)` gegen `MCP_TEXTS[language].calendarLine(e)` —
  Code gegen sich selbst (tautologisch), Wert nur als Vollstaendigkeitsprobe.
  Der DE-Pin in T17 ist zudem nur ein Regex, kein Byte-Pin. Kein Blocker.
- **Kosmetische Fremdaenderung**: `callStillRunning` (en) wurde von
  zweizeiliger Konkatenation auf eine Zeile umformatiert
  (`src/i18n/mcp-texts.js:95`). String byte-identisch, reiner
  Prettier-Reflow, unnoetig im Diff dieser Phase.
- **Umgebungs-Hinweis**: Der vorgegebene Befehl
  `ln -s "./node_modules" node_modules` erzeugt einen selbstbezueglichen
  Symlink ("Too many levels of symbolic links"); `npm run test:gates` bricht
  dann mit Exit 194 und leerer Ausgabe ab — sieht wie "gruen ohne Fehler"
  aus. Symlink wurde auf das Repo-`node_modules` umgebogen, danach echte
  Laeufe erhalten. Fruehere Runden dieser Phase koennten auf dem stillen
  Exit 194 aufgesetzt haben.

## Clean-Code-Audit

- **S1** (Blocker): `test/place-call-context-bridge.test.js:48-58`
  (`PLACE_CALL_SHAPE`) — `npm test` ist nach diesem Diff rot. Der Fix
  entfernt das `language`-Feld aus dem `place_call`-Zod-Schema in
  `src/mcp-tools.js` (LANG-15), aber der Bestandstest P1-02 erwartet
  weiterhin `language: { optional: true }` in `PLACE_CALL_SHAPE` und in
  `assert.deepEqual(actualKeys, expectedKeys, ...)`. Verifiziert: auf Basis
  `5fe5980` laeuft dieser Test gruen, auf dem Phasen-Branch schlaegt er
  fehl (`node --test test/place-call-context-bridge.test.js` -> not ok; der
  volle `npm test`-Lauf zeigt exakt 1 Fail — genau dieser Test). CLAUDE.md
  verlangt explizit, dass `npm test` gruen sein MUSS — das ist hier
  verletzt. Fix-Vorschlag: `language: { optional: true }` aus
  `PLACE_CALL_SHAPE` entfernen (analog zur bereits erfolgten Anpassung von
  `test/p15-mcp-tool-descriptions-en.test.js` im selben Diff, wo die Zeile
  `"place_call.language": []` korrekt entfernt wurde).
- **S2**: keine Befunde.
- **S3** (kein Verstoss, nur vermerkt):
  - `src/i18n/mcp-texts.js` — `calendarLine` als Arrow-Funktion mit
    Objekt-Destrukturierung sauber benannt und dokumentiert (Kommentar
    erklaert bewusst punktfreien Verzicht wegen `map()`-Zusatzargumenten).
  - `src/mcp-tools.js:492-495` (LANG-15-Kommentar) — gut begruendeter
    Kommentar, der die Entscheidung (kein `language`-Feld mehr, kein
    wirkungsloses Client-Feld) nachvollziehbar macht.
- **S4**: keine Befunde.
- **Verdikt**: Blocker — 1 S1-Regression (Testbestand rot). Der eigentliche
  Produktcode (`mcp-texts.js`, `mcp-tools.js`) ist sauber: DE bleibt
  byte-identisch, EN/FR sind vollstaendig, keine Duplizierung (Text kommt
  aus demselben `loc.mcp`-Buendel wie die uebrigen Stufe-0-Texte), keine
  Magic Numbers, keine toten/auskommentierten Codeteile, Kommentare
  erklaeren Absicht statt Trivia nachzuerzaehlen. Die neuen Tests
  (T16/T17 in `mcp-tools-language.test.js`) folgen Build-Operate-Check und
  pruefen Grenzfaelle (leer, befuellt, alle `SUPPORTED_LANGUAGES`) sauber.
  Das einzige Problem ist eine vergessene Testanpassung an anderer Stelle:
  `PLACE_CALL_SHAPE` in `place-call-context-bridge.test.js` wurde nicht auf
  das Entfernen des `language`-Feldes nachgezogen, wodurch `npm test` nach
  diesem Merge rot laeuft.
- **PassNotes**: `mcp-texts.js`: DE-Text byte-identisch zum vorherigen
  Inline-String (verifiziert per Testassertion in T16/T17), EN/FR
  vollstaendig ergaenzt, `calendarLine` konsistent mit dem bestehenden
  Muster (Geld-/Monatszeilen). `mcp-tools.js`: `list_action_items` und
  `get_calendar` nutzen jetzt denselben `loc.mcp`-Lookup wie die uebrigen
  Tenant-Sprach-Texte, keine zweite Quelle. Die `language`-Feld-Entfernung
  aus dem `place_call`-Schema (LANG-15) ist im Produktcode vollstaendig
  sauber — keine toten Referenzen auf `language` mehr im Handler (grep
  bestaetigt). `p15-mcp-tool-descriptions-en.test.js` wurde korrekt an die
  Entfernung angepasst. `node --check` laeuft fehlerfrei fuer beide
  geaenderten Quelldateien.
- **Top-Todos**:
  1. `PLACE_CALL_SHAPE` in `test/place-call-context-bridge.test.js` um das
     `language`-Feld bereinigen, damit `npm test` wieder gruen ist
     (S1-Blocker).
  2. Nach dem Fix erneut vollen `npm test`-Lauf fahren und Gruen
     bestaetigen.

## Fix-Runden

- **r1**: Auf dem bereits existierenden Branch
  `phase/gates-p10-mcp-oberflaeche-fix1` gearbeitet (nicht neu erzeugt, da
  er schon vorlag — Branches `review-gates-p10-r2`/`review-p10-fix1-check`
  zeigen, dass Runde 1 bereits gelaufen war). Zwei der drei gemeldeten
  Blocker sind geklaert (MCP-14/LANG-15-Gates gruen).
- **r2**: Keine neuen Code-/Testaenderungen vorgenommen, kein Commit.
  Ergebnis der Runde-2-Pruefung: Die drei gemeldeten Punkte (BLOCKER 1,
  BLOCKER 2, das S1-Detail) sind EIN einziger Sachverhalt, und BLOCKER 2
  ist korrekt — kein Blocker, den der Fix-Agent fuer falsch haelt. Es
  braucht eine Owner-Entscheidung zur Testfreigabe (siehe BLOCKER 2 oben),
  keine weitere Selbst-Fix-Runde.
- **r2 (Fix-Agent)**: ABBRUCH — kein Commit vom Fix-Agenten (Branch
  `phase/gates-p10-mcp-oberflaeche-fix2` existiert nicht). Blocker der
  vorigen Review-Runde bleiben stehen.

## Gesamtverdikt

**BLOCKED**. Drei der vier Abnahmepunkte sind erfuellt (Gates gruen,
Produkt-Diff substanziell, Testaenderungen zulaessig), der entscheidende
(Regression `npm test` = 0 rot) nicht. Ursache ist eine Spec-Luecke: LANG-15
verlangt die Feldentfernung, P10s Liste zulaessiger Testaenderungen deckt den
dadurch fallenden Bestandspin `PLACE_CALL_SHAPE` nicht ab. Der Impl-Agent hat
die Regel "melden, NICHT anpassen" korrekt befolgt und seine eigene
unzulaessige Anpassung in `88bb6ca` zurueckgenommen. Naechster Schritt ist
eine Owner-Entscheidung (Testfreigabe erweitern ODER LANG-15 aus P10 loesen),
keine weitere Agenten-Runde. Bis dahin: nicht mergen, sonst ist master
dauerhaft rot.
