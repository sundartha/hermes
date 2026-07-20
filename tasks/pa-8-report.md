# Phase PA-8 — UiRenderer/Detector-Factory hinter dem UiRenderer-Port

**Datum:** 2026-07-17
**Gate:** PASS
**finalBranch:** `phase/polish-a-p8`
**headCommit:** `43431dfb2326e84fc12a286a2020c33da1a51611`

## Ueberblick

Phase PA-8 aus `PLAN-POLISH-A.md`: verhaltens-erhaltender Refactor, der zwei
Duplizierungs-Cluster im MCP-Rich-UI-Seam (`src/ui/`) hinter zwei geteilte
Fabrik-Funktionen zieht:

- **Cluster 1 (Detektoren):** `capabilityDeclaresUi` und
  `capabilityDeclaresChatgptUi` in `src/ui/contract.js` waren byte-gleich bis
  auf die verwendete MIME-Konstante (`UI_MIME` vs. `CHATGPT_UI_MIME`).
- **Cluster 2 (Renderer-Objekte):** `mcpNativeRenderer`
  (`src/ui/adapters/mcp-native.js`) und `chatgptRenderer`
  (`src/ui/adapters/chatgpt.js`) waren strukturell identisch bis auf (a)
  `mimeType` und (b) die Form von `toolMeta` (verschachtelt
  `{ [UI_META_KEY]: { resourceUri } }` fuer MCP-nativ vs. flach
  `{ [CHATGPT_META_KEY]: uri }` fuer ChatGPT/skybridge).

Ziel: genau **eine** Quelle je Cluster (G5), ohne den DIP-Seam
(`UiRenderer`-Port in `ports.js`) oder irgendeinen Exportnamen anzutasten, den
`registry.js`, `mcp-server.js`, `routes/mcp.js`, `mcp-tools.js` oder
`test/mcp-ui.test.js` konsumieren.

---

## Plan (gekuerzt)

### Grounding

- Betroffene Dateien vor Umsetzung unmodifiziert ggue. `master`
  (`src/ui/contract.js`, `src/ui/adapters/mcp-native.js`,
  `src/ui/adapters/chatgpt.js`).
- Kein Import-Zyklus: `widget-catalog.js` importiert `contract.js` NICHT ->
  `contract.js` darf umgekehrt `widget-catalog.js` importieren.
- DIP-Seam-Konsumenten mit fixen Exportnamen identifiziert: `registry.js`
  (`mcpNativeRenderer`, `chatgptRenderer`, `capabilityDeclaresChatgptUi`),
  `mcp-server.js` + `routes/mcp.js` (`uiServerExtension`), `mcp-tools.js`
  (`WIDGET_AGENT_STATUS`-Re-Export aus `mcp-native.js`),
  `test/mcp-ui.test.js` (48 Tests, alle o. g. Exports).

### Design-Entscheidung

Beide Fabriken leben in `contract.js` (nicht in einer neuen Datei) — die
Plan-Vorgabe (`PLAN-POLISH-A.md`, Abschnitt „PA-8 Dateien") nennt exakt die 3
Bestandsdateien, keine neue Datei, keine Testdatei. Folglich muss der Host der
Fabriken `contract.js` sein, da nur dort Zugriff auf `uiResourceUri` besteht
und die Katalog-Funktionen (`hasWidget`/`widgetHtml`/`widgetTitle`) importiert
werden koennen.

- `makeCapabilityDetector(mimeType)` — modul-privat in `contract.js`, baut
  einen fail-closed Detektor fuer genau einen `mimeType`.
- `makeUiRenderer({ mimeType, metaKey, buildMeta })` — exportiert aus
  `contract.js`, baut ein vollstaendiges `UiRenderer`-Objekt
  (`hasWidget`/`resourceUri`/`registerResource`/`toolMeta`/`mimeType`).

**Bewusst dokumentierte SRP-Abwaegung:** `contract.js` bekommt dadurch einen
Abwaerts-Import auf `widget-catalog.js`. Verworfene Alternative (eigene
`src/ui/adapters/renderer-factory.js`) haette `contract.js` puristischer
gehalten, weicht aber von der 3-Datei-Vorgabe im Plan ab — verworfen.
`makeUiRenderer` wird zur Modul-Ladezeit einmal pro Adapter aufgerufen und
liefert einen stabilen Singleton (Konstruktion an der Grenze, kein
Lazy-Init-Antipattern, P15).

### Exakte Edits (geplant)

1. `contract.js`: Kopfkommentar praezisiert (nennt jetzt explizit die zwei
   geteilten Fabriken) + Import von `hasWidget`/`widgetHtml`/`widgetTitle` aus
   `./widget-catalog.js`.
2. `contract.js`: `capabilityDeclaresUi` von `function`-Deklaration zu
   `export const ... = makeCapabilityDetector(UI_MIME)` umgebaut;
   `makeCapabilityDetector` selbst (hoisted `function`, modul-privat) davor
   eingefuegt.
3. `contract.js`: `capabilityDeclaresChatgptUi` analog zu
   `export const ... = makeCapabilityDetector(CHATGPT_UI_MIME)`.
4. `contract.js`: `makeUiRenderer` am Dateiende angehaengt (exportiert).
5. `mcp-native.js`: Vollersatz — ruft `makeUiRenderer({ mimeType: UI_MIME,
   metaKey: UI_META_KEY, buildMeta: (uri) => ({ resourceUri: uri }) })`;
   `WIDGET_AGENT_STATUS`/`WIDGET_CALL`-Re-Export bleibt unveraendert erhalten.
6. `chatgpt.js`: Vollersatz — ruft `makeUiRenderer({ mimeType:
   CHATGPT_UI_MIME, metaKey: CHATGPT_META_KEY, buildMeta: (uri) => uri })`.

### Tests

Keine neuen/geaenderten Tests geplant — reiner verhaltens-erhaltender
Refactor. Die 48 Bestandstests in `test/mcp-ui.test.js` (insbesondere die
Shape-Anker T-P3-AC1/AC2/AC5/AC6, T-P1-UI-AC2/AC3, T-W3-AC2/AC3,
T-Wb-*-AC2/AC3) muessen vorher-gruen/nachher-gruen mit identischer Anzahl (48)
bleiben.

### Deterministisch pruefbares Ergebnis (5 Befehlsgruppen)

1. `node --check` auf alle 3 Dateien -> `OK`.
2. Anker-Test-Selektion (`--test-name-pattern`) -> alle gruen.
3. Volle `test/mcp-ui.test.js` -> 48 pass/0 fail, `grep -c '^test('` weiterhin
   48.
4. Struktur-Gates: genau 1x `mimeTypes.includes(` und genau 1x
   `server.registerResource(` in `contract.js`, 0x `registerResource` in
   beiden Adaptern, `makeUiRenderer`/`makeCapabilityDetector` nur in
   `contract.js` definiert.
5. Volle Suite `npm test` gruen.

---

## Implementierungs-Zusammenfassung

Exakt gemaess Plan umgesetzt, 3 Dateien geaendert, keine neue Datei, kein
Push:

- `src/ui/contract.js` — `makeCapabilityDetector(mimeType)` (modul-privat,
  hoisted function) + `makeUiRenderer({mimeType, metaKey, buildMeta})`
  (exportiert) ergaenzt; `capabilityDeclaresUi`/`capabilityDeclaresChatgptUi`
  auf die Fabrik umgestellt; Kopfkommentar praezisiert; Import von
  `hasWidget`/`widgetHtml`/`widgetTitle` aus `./widget-catalog.js` ergaenzt.
- `src/ui/adapters/mcp-native.js` — Vollersatz, ruft `makeUiRenderer` mit
  MCP-nativen Parametern (verschachtelte `_meta`-Form); tote Importe
  (`uiResourceUri`, Katalog-Funktionen) entfernt; `WIDGET_AGENT_STATUS`/
  `WIDGET_CALL`-Re-Export unangetastet.
- `src/ui/adapters/chatgpt.js` — Vollersatz, ruft `makeUiRenderer` mit
  ChatGPT/skybridge-Parametern (flache `_meta`-Form); toter
  `widget-catalog`-Import entfernt.

Alle geplanten Exportnamen (`capabilityDeclaresUi`,
`capabilityDeclaresChatgptUi`, `uiServerExtension`, `mcpNativeRenderer`,
`chatgptRenderer`, `WIDGET_AGENT_STATUS`/`WIDGET_CALL`-Re-Export) blieben
byte-identisch; Widget-HTML und die host-spezifische `_meta`-Form (nested vs.
flach) sind unveraendert. `registry.js`, `mcp-server.js`, `routes/mcp.js`,
`mcp-tools.js` wurden nicht angefasst.

### Deterministik-Checks — Ergebnis

Alle 6 vorgeschriebenen Checks ausgefuehrt und bestanden:

- `node --check` auf allen 3 Dateien: OK (3/3).
- Anker-Test-Selektion: 13/13 pass.
- Volle `test/mcp-ui.test.js`: 48/48 pass, Testanzahl per `grep -c '^test('`
  weiterhin 48 (unveraendert).
- Struktur-Gates: genau 1x `mimeTypes.includes(` in `contract.js`, genau 1x
  `server.registerResource(` in `contract.js`, 0x in beiden Adaptern,
  `makeUiRenderer`/`makeCapabilityDetector` nur in `contract.js` definiert +
  je 1x Nutzung pro Adapter.
- Volle Suite: **2388/0**, zweimal reproduziert gruen. Ein einzelner
  Zwischenlauf zeigte einen isolierten `audit.test.js`-Fehlschlag; im
  isolierten Nachlauf 9/9 gruen bestaetigt — der bereits dokumentierte
  vorbestehende Voll-Last-Flake (Seed-vor-Boot-Race, siehe Memory
  `suite-flake-p5-gate-proof`), kein PA-8-Regressionsbefund.
- Zusaetzlicher Smoke-Test: Server lokal gestartet (`PORT=3999`,
  `SKIP_TWILIO_SIGNATURE_CHECK=true`, Dummy-Env, `MCP_UI_ENABLED=true`) nach
  Tenant-Bootstrap. `/healthz` -> 200. MCP `initialize` mit UI-Capability ->
  Server deklariert `capabilities.extensions` korrekt. `resources/read` fuer
  `ui://hermes/call` -> `mimeType text/html;profile=mcp-app` + korrektes
  Widget-HTML. `tools/list` -> `place_call._meta` = nested Form aus
  `makeUiRenderer`, byte-identisch zur Vorher-Form. Server danach sauber
  gestoppt.

### Clean-Code-Self-Check (Implementierer)

`.claude/refs/clean-code.md` gelesen und angewendet: G5 (Kernziel der Phase —
2 Duplizierungs-Cluster in je eine Quelle aufgeloest), F1 (`makeUiRenderer`
nimmt 1 Objekt-Argument statt 3 Einzelparameter), C2 (Kopfkommentar
praezisiert statt veraltet zu bleiben), G12 (tote Importe in
`mcp-native.js`/`chatgpt.js` entfernt), P15 (`makeUiRenderer` wird zur
Modul-Ladezeit einmal pro Adapter aufgerufen -> stabiler Singleton, kein
Lazy-Init), G27 (Struktur statt Konvention). Reiner verhaltens-erhaltender
Refactor -> keine Testaenderung noetig.

### Deviations

**Keine.** (`deviations: []` im Impl-Ergebnis)

### Geaenderte Dateien

- `src/ui/contract.js`
- `src/ui/adapters/mcp-native.js`
- `src/ui/adapters/chatgpt.js`

Keine neuen Dateien, keine geaenderten/neuen Tests.

---

## Safety-Urteil (final)

**Verdict: APPROVED**

- `approved`: true
- `testsPassIndependently`: true
- `safetyGatesIntact`: true
- `disclosureIntact`: true
- `authFailClosedIntact`: true
- `noSecretsLeaked`: true
- `behaviorAsIntended`: true
- `scopeRespected`: true
- `blockers`: keine

### Unabhaengiger Testlauf

Volle `npm test` in frischem Worktree (nach Fix des kaputten
`node_modules`-Symlinks): **2388 Tests, 2388 pass, 0 fail, 0 skipped**,
~103s. Lauf umfasst beide Backends (JSON-Store UND pglite-Postgres-Backend —
`store-pg`, `pg-json-parity`, `tenant-erasure-pg`, `web-auth-pg`,
RLS/NOBYPASSRLS) gruen im selben Durchlauf. `test/mcp-ui.test.js` allein: 48
pass/0 fail. Anker-Shape-Tests gruen bestaetigt: T-P3-AC1 (nested
`_meta.ui.resourceUri`, mcp-native), T-P3-AC2 (flach
`openai/outputTemplate`, chatgpt), plus T-P1-UI-AC2/3, T-W3-AC2/3,
T-Wb-*-AC2/3. `test/mcp-ui.test.js` ist byte-identisch zu `master`.

### Concerns (nicht blockierend)

1. **Harness/Setup-Artefakt (kein Phasen-Defekt):** Der vorgeschriebene
   Schritt `ln -s "./node_modules" node_modules` erzeugte einen
   selbstreferenziellen, kaputten Symlink (`node_modules -> ./node_modules`).
   `npm test` schlug lautlos fehl (Exit 194, keine Ausgabe), bis auf den
   echten `node_modules`-Pfad des Haupt-Repos umgelinkt wurde. Empfehlung:
   kuenftige Review-Harnesses sollten auf den absoluten Parent-Pfad linken.
2. `capabilityDeclaresUi`/`capabilityDeclaresChatgptUi` wechselten von
   `function`-Deklaration zu exportiertem `const`-Arrow. TDZ-sicher, da alle
   Aufrufer (`registry.js` innerhalb eines Funktionskoerpers + Tests) nur zur
   Laufzeit aufrufen, nie beim Top-Level-Modul-Eval — aber eine (harmlose)
   Oberflaechen-Aenderung, die es wert ist, notiert zu werden.
3. `contract.js` importiert jetzt aus `widget-catalog.js`. Verifiziert
   azyklisch (`widget-catalog` importiert `contract` nicht zurueck) und
   Fabrik-Referenzen sind lazy in Closures; voller 2388-Test-Lauf bestaetigt
   keinen Import-Zyklus-Bruch.

### Begruendung (Auszug)

PA-8 ist ein sauberer, verhaltens-erhaltender G5-Dedup, begrenzt auf genau
die 3 im Plan spezifizierten Dateien; keine npm-Dependency hinzugefuegt, kein
Safety-/Disclosure-/Auth-/Store-/Billing-Code angefasst.
`makeCapabilityDetector` und `makeUiRenderer` reproduzieren die vorherigen
Detektoren/Renderer byte-fuer-byte: fail-closed Capability-Erkennung erhalten
(nur die MIME-Konstante variiert), `UiRenderer`-DIP-Port intakt,
host-spezifische `_meta`-Formen erhalten (nested fuer mcp-native, flach fuer
chatgpt), Widget-HTML byte-identisch, Exportnamen unveraendert (Registry-Import
per Name funktioniert weiterhin). Rich-UI bleibt hinter `mcpUiEnabled` — kein
Safety-Pfad betroffen.

---

## Clean-Code-Audit (final)

**Verdict: PASS** — reiner G5-Fix (Duplizierung), verhaltenserhaltend
bewiesen.

- `s1` (Blocker): []
- `s2` (Struktur-/Fragilitaets-relevant): []
- `s3`: []
- `s4`: []
- `blocker`: false

### Pass-Notes (Auszug)

P1/G5 (Kernziel der Phase erreicht): 2 byte-identische
Capability-Detektoren (`capabilityDeclaresUi`/`capabilityDeclaresChatgptUi`)
und 2 strukturell identische `UiRenderer`-Objekte (mcp-native/chatgpt) wurden
durch geteilte Fabriken `makeCapabilityDetector(mimeType)` und
`makeUiRenderer({mimeType, metaKey, buildMeta})` ersetzt. Host-spezifische
Unterschiede (mimeType-Konstante, `_meta`-Form: verschachtelt vs. flach)
bleiben an der einzigen Stelle sichtbar, die sie kennen muss
(`contract.js`) — kein Wissenstransfer in die Adapter noetig.

Verhaltenserhaltung nicht nur behauptet, sondern selbst nachvollzogen: Branch
`phase/polish-a-p8` in isoliertem Worktree ausgecheckt, `node --check` fuer
alle 3 Dateien sauber, `node --test test/mcp-ui.test.js` -> 48/48 gruen,
volle Suite `npm test` -> 2388/2388 gruen, 0 fail. Die Tests pruefen dabei die
exakten Wire-Shapes je Host (`_meta.ui.resourceUri` verschachtelt vs.
flaches `openai/outputTemplate` an mehreren Stellen, u. a. Zeilen
225/280/512-535/714/916/999/1081/1136 in `test/mcp-ui.test.js`) — eine
strukturelle Vertrags-Pruefung pro Host, keine oberflaechliche
„wirft nicht"-Pruefung.

F1 im Kommentar selbst begruendet (`makeUiRenderer` nimmt 1 Objekt statt 3
Einzelparameter). JSDoc `@type {import('../ports.js').UiRenderer}` an beiden
Adapter-Exports erhalten und stimmt mit der Fabrik-Rueckgabe ueberein. Keine
Umlaute, keine toten Imports, kein zirkulaerer Import
(`widget-catalog.js` importiert nichts aus `contract.js` zurueck —
`contract.js` importiert jetzt einseitig aus `widget-catalog.js`). Kommentare
korrekt migriert statt veraltet zu bleiben (der P0-Beleg-Hinweis sitzt jetzt
am Ort der tatsaechlichen Variabilitaet, `makeCapabilityDetector`-Body — kein
C2-Verstoss).

Hinweis zur Einordnung: `HEAD` von `master` (776760e) lag zum Zeitpunkt der
Phase vor dem Branchpunkt von `phase/polish-a-p8` (Merge-Base `b7d7ce8`) —
`git diff master phase/polish-a-p8` lieferte trotzdem den korrekten,
vollstaendigen Tree-Diff (3 Dateien), keine uebersehenen Aenderungen aus
dazwischenliegenden Commits.

### Top-Todos

- Keine Blocker, kein Handlungsbedarf vor Merge.
- (Optional, kein Flag) Bei der naechsten Erweiterung um einen dritten Host:
  `makeUiRenderer`/`makeCapabilityDetector` sind bereits so geschnitten, dass
  ein dritter Aufruf ohne Aenderung an bestehendem Code moeglich ist
  (P3/OCP eingehalten) — einfach validieren, dass ein evtl. neuer `buildMeta`
  wieder eine reine Funktion bleibt.
- (Hinweis, kein Flag) Diff ist minimal und auf die eine Absicht
  (G5-Fix) fokussiert, keine Nacharbeit noetig.

---

## Fix-Runden

**Keine.** PA-8 durchlief den dualen Review (Safety + Clean-Code) ohne
Blocker im ersten Anlauf; es waren keine Fix-Runden noetig.
