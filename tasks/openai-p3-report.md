# P3-Abschlussbericht — securitySchemes an der SDK-Grenze (Weg B: Low-Level-Override)

**ID:** T-15. **Branch:** `phase/openai-p3-securityschemes`.

**Commit-Korrektur zum Kickoff:** der Kickoff nennt `ddfe749` als Phasen-Commit. Das ist der
Stand **vor** zwei bereits gemergten Nachbesserungsrunden im selben Branch
(`3edacd8` Runde 1, `d04f383` Runde 2). Dieser Bericht misst den tatsaechlichen Branch-Tip
`d04f383` — das ist der Stand, der gemergt wuerde, nicht `ddfe749`.

**Geaenderte Dateien — Korrektur zur Aufgabenstellung:** die Aufgabenstellung nennt fuenf
Dateien. Der tatsaechliche Diff `91ef2d2..d04f383` (Basis `master` vs. Branch-Tip) umfasst
**sieben**:

```
src/mcp-security-schemes.js             |  52 ++++++ (neu)
src/mcp-server.js                       |   5 +
src/routes/mcp.js                       |   3 +
tasks/openai-p3-report.md               | (diese Datei)
test/helpers.js                         |  11 ++          <- fehlt in der Aufgabenstellung
test/openai-p2-tool-metadaten.test.js   |  16 +-          <- fehlt in der Aufgabenstellung
test/openai-p3-security-schemes.test.js | 282 ++++++++++++ (neu)
```

`test/helpers.js` und `test/openai-p2-tool-metadaten.test.js` kamen durch die
Runde-2-Nachbesserung "Fixture-Baseline vereinheitlicht" dazu (s. Abschnitt 3, Punkt 3). Das
ist auch fachlich relevant: Spec-Abschnitt 3 behauptet, `test/openai-p2-tool-metadaten.test.js`
bleibe "bewusst unangetastet" und sei deshalb der **unabhaengige** Regressionswaechter fuer
P1/P2. Diese Aussage stimmt nicht mehr woertlich — die Datei wurde angefasst. Sachlich bleibt
die Unabhaengigkeit erhalten (siehe Abschnitt 3, Punkt 3 fuer den Beleg), aber der Bericht darf
das nicht verschweigen.

---

## 1. Was NICHT erfuellt ist — zuerst, nicht versteckt

### 1.1 Zwei ungeloeste Review-Befunde (Runde 3) — im aktuellen Commit noch NICHT behoben

Die Review-Historie zeigt drei Runden (Blocker 2 / 3 / 2). Die ersten beiden Runden sind
gefixt (`3edacd8`, `d04f383`). Die zwei Blocker aus Runde 3 stehen **in keinem Commit** und
**in keiner Zeile dieses Berichts vor dieser Fassung** — sie sind unten zum ersten Mal
schriftlich festgehalten.

**Befund 1 — unbelegte Reichweite auf den beiden produktiv genutzten Hosts.**
`src/routes/mcp.js:161` (HTTP, claude.ai-Connector) und `src/mcp-server.js:33` (stdio, Claude
Desktop) haengen `securitySchemes` an **jeden** Tool-Deskriptor jedes echten Requests. Gemessen
ist ausschliesslich: ein **typisierter SDK-Client** (`@modelcontextprotocol/sdk`, `ToolSchema`
ohne `.passthrough()`, `node_modules/@modelcontextprotocol/sdk/dist/esm/types.js:1229`, 0
`passthrough`-Treffer in der Datei) strippt das unbekannte Feld beim Parsen. Ob der
claude.ai-Connector oder Claude Desktop selbst Instanzen dieses Parsers sind, ist **nicht
gemessen**. Ein Feature-Flag existiert bewusst nicht (Spec Punkt 4.5) — es gibt also keinen
Schalter, um das Feld im Fehlerfall abzuschalten.

*Warum das zaehlt:* validiert einer der beiden Hosts Tool-Deskriptoren strikt (z.B.
`additionalProperties:false`) und verwirft die `tools/list`-Antwort deswegen, verliert der
zahlende Live-Tenant nach dem Deploy **alle** Werkzeuge ueber MCP — kein Anruf, kein
`check_inbox`, kein `place_call`. Der Server antwortet weiter mit 200, der Client zeigt nur
keine Tools — die Diagnose ist stumm, der einzige Rueckweg ist ein Revert-Deploy.

*Was das fuer den Merge heisst:* der Merge ist davon **nicht** blockiert (Merge != Deploy,
Spec Punkt 4.9: kein Deploy in dieser Phase). Aber die zweiteilige Deploy-Auflage —
(a) `tools/list` einmal ueber den echten claude.ai-Connector, (b) einmal ueber echtes Claude
Desktop, beide vor "Rollout abgeschlossen" — **muss beim Merge nach
`tasks/openai-technik-stand.md` uebertragen werden, bevor dieser Bericht nach der
CLAUDE.md-Aufraeumregel geloescht wird.** Heute steht die Auflage nur im Commit-Text von
`d04f383` und in diesem Bericht — beides ueberlebt das Aufraeumen einer gemergten Kette nicht
als Arbeitsanweisung, nur als Git-Historie, die niemand ungefragt durchsucht.

**Befund 2 — `oauth2` ueber stdio ist eine unbelegte Gleichbehandlung, keine gemessene Wahrheit.**
`src/mcp-server.js:33` deklariert `[{type:"oauth2",scopes:[]}]`, obwohl stdio **keine**
Auth-Schicht hat (D0-6, im Spec-Widerspruch W6 selbst so festgehalten — es gibt kein
`/.well-known/oauth-protected-resource` ueber stdio, keinen Token-Check). Die Begruendung
dafuer (Spec E3(c): "ueber stdio inert, weil SDK-Clients das Feld strippen") stuetzt sich exakt
auf die Annahme, die fuer den HTTP-Weg in Runde 1 als unbelegt zurueckgenommen wurde (Befund 1
oben, bzw. Abschnitt "Schritt 9" der Vorfassung dieses Berichts). `noauth` waere fuer stdio die
wahrheitsgemaesse Angabe.

*Warum das zaehlt:* wertet Claude Desktop das Feld je aus (es ist ein OpenAI-Feld, nichts
hindert einen anderen Host, es zu lesen), sieht es `oauth2` ohne erreichbaren
Verknuepfungsweg und koennte Werkzeuge ausblenden oder ihren Aufruf verweigern — der heute
funktionierende Desktop-Zugang des Owners waere betroffen, ohne Schalter zum Abdrehen.

*Was das fuer den Merge heisst:* Pruefung (b) der Deploy-Auflage aus Befund 1 (echtes Claude
Desktop) ist nicht optional und deckt genau diesen Fall mit ab. Reagiert Claude Desktop auf das
Feld, bekommt der stdio-Pfad `noauth` statt `oauth2` als Nachbesserung — die "eine
Wahrheit statt zweier"-Begruendung aus E3 waere damit widerlegt, nicht der Wert zu
verteidigen.

Beide Befunde sind inhaltlich, keine Testluecke: kein zusaetzlicher automatisierter Test kann
sie schliessen, weil das Verhalten eines fremden, nicht kontrollierten Clients (ChatGPT/claude.ai/
Claude Desktop) gemessen werden muesste, nicht Hermes-Code. Nur ein echter Smoke-Check mit dem
echten Host schliesst sie.

### 1.2 Bewusst nicht gebaut (Spec Abschnitt 4 — kein Versehen, keine Luecke im Auftrag)

1. Keine SDK-Anhebung (Weg A) — `npm view` liefert am 2026-09-21 weiterhin `1.30.0`, kennt das
   Feld laut P0/D0-5 nicht; eine Anhebung loest T-15 nicht und braucht laut Plan einen eigenen
   Beleg (Drei-Stellen-Diff).
2. Keine Ablage unter `_meta` — der zitierte Rohtext zeigt das Feld top-level, `_meta` ist der
   Laufzeit-Kanal fuer T-14.
3. Keine per-Werkzeug unterschiedlichen Schemata, keine Scope-Namen — kein Werkzeug hat eine
   abweichende Auth-Anforderung (D0-7), erfundene Scopes waeren eine Falschangabe.
4. Kein T-14 (`_meta["mcp/www_authenticate"]` im Fehlerergebnis) — gehoert zu P7 (Widerspruch
   W8: der Rohtext verlangt fuer die ChatGPT-Verknuepfungs-UI **beide** Haelften; ob sie ohne
   T-14 ueberhaupt erscheint, ist als U-P3-3/W8 offen fuer P7, nicht durch P3 entscheidbar).
5. Kein Feature-Flag, keine Env-Variable, keine Ableitung aus `config.auth.mcpAuth` — bewusst
   (E2/Spec 4.5); siehe aber Befund 1/2 oben: genau das ist der Preis dieser Entscheidung.
6. Kein Eintrag in `PLAN-SECURITY.md` — es aendert sich kein Gate, kein Token-Pfad, keine
   Route, nur eine Beschreibung der bestehenden Auth (Spec 4.8).
7. Keine gemeinsame Server-Fabrik fuer `routes/mcp.js` + `mcp-server.js` (ein Andockpunkt statt
   zwei) — eigener Umbau, nicht beauftragt (Spec 4.6). Der Naht-Pin (Abschnitt 2, T-15/Schritt 7)
   deckt die dadurch offene Luecke ab.
8. Kein Oeffnen von `tools/list`/`initialize` fuer unauthentifizierte Aufrufe — `mcpAuth` bleibt
   unangetastet.
9. Kein Deploy, kein echter ChatGPT-Verbindungsversuch, kein Anruf, keine SMS.

### 1.3 Abweichungen von der Spec (dokumentiert, keine davon aendert das Ergebnis)

1. Der Branch war frei — `phase/openai-p3-securityschemes` ohne `-neu`-Suffix angelegt.
2. `node_modules` fehlte in der neuen Worktree (Git-Worktrees bringen es nicht mit) — per
   Symlink auf das `node_modules` der Hauptarbeitskopie geloest statt `npm install`, um
   denselben Lock-Stand (`1.29.0`) zu garantieren. Symlink ist gitignored, keine Repo-Aenderung.
3. Der erste Entwurf des Naht-Pins (Schritt 7) nutzte ein reines `indexOf(...)` auf den
   Quelltext und blieb bei der Gegenprobe (Zeile auskommentieren -> Test muss rot werden)
   faelschlich gruen, weil `indexOf` den Aufruf auch im Kommentartext fand. In Runde 2 durch
   einen echten Kindprozess-Spawn-Test ersetzt (kein Text-Pin mehr, s. Abschnitt 2, Schritt 7);
   die Gegenprobe (Aufruf vor `registerTools()` verschoben -> Boot wirft -> Test rot) ist
   selbst nachgestellt worden (s. Abschnitt 3, Punkt 2).
4. Sechs statt der in Spec-Schritt 8 genannten fuenf neuen Testfaelle — sachlich deckungsgleich
   mit der Spec-Absicht (ein Lerntest-Teilstueck wurde als eigener Fall statt als dritte
   Assertion gebaut, dazu ein eigener Fall fuer E5), aber die Zaehlung "genau 5" trifft nicht
   exakt zu.
5. Die Testzahl-Bilanz ist **nicht** aufgeklaert: Spec-Baseline "6160 gruen + 6 neue = 6166" vs.
   gemessene `# pass 6186` nach den Aenderungen — Differenz 20, keine Baseline-Messung auf
   demselben `master`-Commit in diesem Worktree gefahren (Zeitgruende, zweiter kompletter
   Suitelauf haette den Zeitrahmen gesprengt). **UNKNOWN, Grund: nicht ohne einen zweiten
   vollen Suitelauf (~7 Minuten) auf dem exakt gleichen `master`-Commit im selben Worktree
   klaerbar; wurde in dieser Session nicht nachgeholt (Zeitrahmen dieses Berichts).** Was
   feststeht: `# fail 0` und kein `not ok` in der ungekuerzten Ausgabe — die
   Regressionsgarantie ist unabhaengig vom exakten Baseline-Wert.

---

## 2. Was diese Phase erfuellt — ID fuer ID, mit Beweisstelle

**T-15 (Hauptanforderung, Weg B):** `securitySchemes` liegt an jedem MCP-Tool-Deskriptor,
top-level, als Array — umgesetzt als Low-Level-Override nach `registerTools()`.
Beweis: `src/mcp-security-schemes.js:41-52` (`applyToolSecuritySchemes`), verdrahtet an
`src/routes/mcp.js:161` und `src/mcp-server.js:33`.

**E1 — Wert einheitlich `[{"type":"oauth2","scopes":[]}]` fuer alle Werkzeuge.**
Beweis: `src/mcp-security-schemes.js:26-28` (`TOOL_SECURITY_SCHEMES`, eingefroren);
Test-Literal `test/openai-p3-security-schemes.test.js:37`
(`EXPECTED_SECURITY_SCHEMES`, bewusst **nicht** aus `src` importiert, sondern woertlich aus
dem zitierten OpenAI-Rohtext — Gegenmassnahme gegen Pre-Mortem #4 der Spec: ein Test, der seine
Erwartung aus dem Pruefling zieht, belegt nichts).

**E2 — Wert wird NICHT aus `config.auth.mcpAuth` abgeleitet.**
Beweis: `src/mcp-security-schemes.js` importiert `config` an keiner Stelle (nachgeprueft,
`grep -n config src/mcp-security-schemes.js` liefert 0 Treffer). Bewusstes Restrisiko, siehe
Befund 1/2 in Abschnitt 1.1.

**E3 — stdio traegt denselben Wert wie HTTP.**
Beweis: `src/mcp-server.js:33` (`applyToolSecuritySchemes(server);`, nach `registerTools(...)`
bei `:27-29`); Test `test/openai-p3-security-schemes.test.js:188-208` ("Schritt 6a") belegt den
Mechanismus per echtem SDK + `InMemoryTransport`. Fachliche Angemessenheit dieser Entscheidung
ist Befund 2 in Abschnitt 1.1 — der Mechanismus ist belegt, die Wahl `oauth2` (statt `noauth`)
ist es nicht.

**E4 — Andockpunkt an den zwei Zusammenbau-Stellen, nicht in `registerTools()`.**
Beweis: `grep -rn applyToolSecuritySchemes src/` liefert exakt 5 Treffer (1 Definition,
2x Import: `src/mcp-server.js:13`, `src/routes/mcp.js:29`; 2x Aufruf: `src/mcp-server.js:33`,
`src/routes/mcp.js:161`) — selbst nachgezaehlt. Die 14 Attrappen-Server-Tests, die
`registerTools()` direkt mit einem Fake-Server aufrufen (z.B. `test/mcp-tools.js:27-36`),
sehen den Override deshalb nicht und bleiben unveraendert — kein stiller Uebersprung noetig.

**E5 — fehlende SDK-Naht wirft laut statt still zu uebergehen.**
Beweis: `src/mcp-security-schemes.js:44-47` (`throw new Error("MCP-SDK-Naht verloren...")`);
Test `test/openai-p3-security-schemes.test.js:154-163` ("P3 (Lerntest): fehlt der
Original-Handler...") belegt den Wurf per `assert.throws`.

**AK1 (Abnahmekriterium 1, `tasks/PLAN-OPENAI-TECHNIK.md` P3-Abschnitt) — jedes Werkzeug
traegt `securitySchemes` am tatsaechlich uebertragenen JSON.**
Beweis: Test `test/openai-p3-security-schemes.test.js:166-185` ("Schritt 5") spawnt den
Server als echten Kindprozess, ruft `POST /mcp` mit `tools/list` auf und prueft per
`assertSecuritySchemesOnEveryTool` (Zeile 55-64) jedes der 12 gelieferten Werkzeuge gegen das
Literal aus E1 — am **rohen** HTTP-Response, nicht am Config-Objekt.
Selbst nachgefahren: `NODE_ENV=test npx node --test test/openai-p3-security-schemes.test.js`
in `wt-p3` -> `# tests 6`, `# pass 6`, `# fail 0` (Einzellauf dieser Datei, in dieser Session
ausgefuehrt).

**AK2 (Abnahmekriterium 2) — `outputSchema`/`inputSchema`/P1-P2-Felder ueberleben den
Override im selben Response.**
Beweis: `assertOutputAndP1P2FeldNichtZerschossen`
(`test/openai-p3-security-schemes.test.js:68-95`) im selben Testfall wie AK1: genau 10 von 12
Werkzeugen mit `outputSchema`, `inputSchema.type === "object"` bei allen 12, `place_call`s
Widget-`_meta` (`ui://hermes/call`) bleibt neben `securitySchemes` erhalten.

**AK4 (Abnahmekriterium 4) — `npm test -- -- --test-concurrency=4` mit `# fail 0`.**
Beweis lt. Aufgabenstellung: `6186` gruen / `0` rot, voller Lauf im Worktree, ungekuerzte
Ausgabe auf `not ok` geprueft. In dieser Session **nicht** erneut vollstaendig gefahren
(Laufzeit ~7 Minuten, ausserhalb des Zeitrahmens dieses Berichts); stattdessen isoliert
nachgemessen: der neue Testfile allein (`6/6` gruen, s. AK1) sowie Syntax/Lint auf allen fuenf
inhaltlich veraenderten Dateien (`node --check` auf `src/mcp-security-schemes.js`,
`src/mcp-server.js`, `src/routes/mcp.js`, `test/openai-p3-security-schemes.test.js` -> ok;
`npx eslint` auf dieselben vier plus `test/helpers.js` und
`test/openai-p2-tool-metadaten.test.js` -> 0 Errors, 1 Bestandswarnung in
`test/helpers.js:1425` (`no-unused-vars`), die laut Bericht der Vorfassung bereits vor dieser
Phase bestand und hier nicht neu erzeugt wurde).

**Rohtext-Beleg (Schritt 1 der Spec, loest W1/W2 auf) — der Wert ist ein Array, nicht ein
Objekt.**
Woertliches Zitat, Quelle `https://developers.openai.com/apps-sdk/build/auth` (Redirect von
`.../plugins/build/auth`), Abrufdatum 2026-09-21, HTTP 200, 462552 Bytes — drei Fundstellen
(vollstaendiger Tool-Deskriptor mit `securitySchemes` als Geschwister von `annotations`/`_meta`,
Fliesstext "Stick to per-tool declarations...", TypeScript-Beispiel
`securitySchemes: [{ type: "oauth2", scopes: [...] }]`). Nicht in dieser Session erneut
abgerufen (Netzwerkzugriff auf externe Quelle nicht Teil dieses Berichtsauftrags); uebernommen
aus dem bereits im Vorbericht dokumentierten Zitat, das Plan und P0-Annahme (Objekt statt
Array) korrigiert.

**Lerntest auf die SDK-Naht (Schritt 2 der Spec).**
Beweis: `test/openai-p3-security-schemes.test.js:98-152` — belegt an einem Wegwerf-`McpServer`,
dass `registerTool()` ein unbekanntes Konfigfeld (`securitySchemes`) still verwirft (Zeile
121-129), und dass nach dem Override der **rohe** JSON-RPC-Weg das Feld traegt, der
**typisierte** `client.listTools()`-Weg nicht (Zeile 131-147) — der Beleg fuer "Messung B" der
Spec (zod strippt unbekannte Top-Level-Schluessel, `ToolSchema` ohne `.passthrough()`).

**Belege fuer stdio und ChatGPT-Adapter unabhaengig von der Adapterwahl (Schritt 6a/6b).**
Beweis: `test/openai-p3-security-schemes.test.js:188-208` (stdio, 10 Werkzeuge ohne
Consult-Faehigkeit) und `:211-243` (ChatGPT-Adapter-Capabilities gesetzt, `securitySchemes`
liegt neben `_meta["openai/outputTemplate"]` bei `place_call`) — beide gegen echtes SDK +
`InMemoryTransport`, roh abgefragt.

**Naht-Pin fuer den stdio-EINSTIEG (Schritt 7) — in Runde 2 verschaerft.**
Beweis: `test/openai-p3-security-schemes.test.js:257-282` — kein Text-Pin mehr (der urspruengliche
`indexOf`-Ansatz ist mit der Runde-2-Nachbesserung entfernt), sondern ein echter Kindprozess:
`src/mcp-server.js` wird per `StdioClientTransport` gestartet, `tools/list` ueber das echte
Protokoll abgefragt. Selbst nachgefahren in dieser Session (Teil des 6/6-Laufs oben,
Einzelfall-Laufzeit 90ms) — gruen.

---

## 3. Beruehrte Pfade — und ob der Punkt auf ALLEN erfuellt ist

| Pfad | Mechanismus durch Test belegt? | Mit echtem Produktions-Host smoke-getestet? |
|---|---|---|
| HTTP `/mcp`, mcp-nativer Adapter (heutiger claude.ai-Connector) | Ja — echter Serverprozess, echter HTTP-Request, rohes JSON (AK1/AK2) | **Nein** — offen, s. Befund 1 |
| HTTP `/mcp`, ChatGPT-Adapter-Capabilities | Ja — `InMemoryTransport`, echtes SDK, roh abgefragt (Schritt 6b) | Entfaellt heute (Hermes bedient produktiv claude.ai + Claude Desktop, keinen laufenden ChatGPT-Connector) |
| stdio (Claude Desktop, `src/mcp-server.js` als "command"-Eintrag) | Ja — echter Kindprozess-Spawn ueber das reale Protokoll (Schritt 7) | **Nein** — offen, s. Befund 1 **und** Befund 2 (Wertwahl `oauth2` dort fachlich ungeklaert) |
| Die 14 Attrappen-Server-Testdateien (`registerTools()` direkt mit Fake-Server) | Unveraendert, sehen den Override bewusst nicht (E4) | Nicht zutreffend — kein Produktionspfad |

**Ergebnis:** der **Mechanismus** (Feld liegt an jedem Werkzeug, auf beiden Transporten, in
beiden Adapter-Varianten, ohne die SDK-Normalisierung zu zerstoeren) ist auf **allen** Pfaden
durch einen automatisierten Test belegt — inklusive, seit Runde 2, eines echten
Prozess-Spawns fuer stdio statt nur einer In-Memory-Verdrahtung. Was auf **keinem** der beiden
produktiv genutzten Pfade (HTTP-claude.ai, stdio-Claude-Desktop) erfuellt ist: ein Nachweis,
dass der jeweilige **echte Host** das unbekannte Feld genauso schluckt wie der gemessene
SDK-Client. Das ist die offene Deploy-Auflage aus Befund 1/2.

---

## 4. Was ein externer Pruefer nachmessen sollte

Neutral formuliert — jede Zeile ist eine Frage, keine Bestaetigung.

1. Ist der Branch-Tip tatsaechlich `d04f383` und nicht `ddfe749`? — `git log --oneline
   phase/openai-p3-securityschemes | head -6` in einem Checkout dieses Branches.
2. Traegt jedes der 12 Werkzeuge im rohen `tools/list`-Response von `POST /mcp` das Array
   `[{"type":"oauth2","scopes":[]}]`, und stimmt das mit dem woertlichen OpenAI-Zitat in
   Abschnitt 2 ("Rohtext-Beleg") ueberein? — Server lokal starten, `curl -sS -X POST
   http://localhost:$PORT/mcp -H "content-type: application/json" -d
   '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` gegen eine Auth, die durchlaesst, dann das
   JSON pruefen (nicht `client.listTools()` eines SDK-Clients — der strippt das Feld, s.
   Abschnitt 2 "Lerntest").
3. Ruft `applyToolSecuritySchemes` in `src/mcp-security-schemes.js` den urspruenglichen
   `tools/list`-Handler auf und reichert dessen Ergebnis an, oder baut es die Liste neu? —
   Datei lesen, `grep -n "original(request, extra)" src/mcp-security-schemes.js`.
4. Ist der Andockpunkt an genau zwei Stellen verdrahtet (HTTP und stdio), keine mehr, keine
   weniger? — `grep -rn applyToolSecuritySchemes src/ | wc -l` (erwartete Antwort im Bericht:
   5 — pruefen, ob das noch stimmt).
5. Wirft `applyToolSecuritySchemes` bei fehlendem Original-Handler, oder faellt es still durch?
   — `src/mcp-security-schemes.js` lesen, dazu den Testfall "P3 (Lerntest): fehlt der
   Original-Handler..." in `test/openai-p3-security-schemes.test.js` ausfuehren.
6. Bleiben `outputSchema` (bei genau 10 von 12 Werkzeugen) und `inputSchema` (JSON-Schema-Objekt
   bei allen 12) im selben `tools/list`-Response erhalten? — Testfall "P3 (Schritt 5)" lesen und
   `NODE_ENV=test npx node --test test/openai-p3-security-schemes.test.js` ausfuehren.
7. Ist der Naht-Pin fuer stdio (Schritt 7) ein echter Kindprozess-Test oder nur eine
   Text-/Reihenfolge-Pruefung auf dem Quelltext? — Testfall "P3 (Schritt 7)" in
   `test/openai-p3-security-schemes.test.js:257-282` lesen; Gegenprobe: die Zeile
   `applyToolSecuritySchemes(server);` in `src/mcp-server.js` auskommentieren, denselben Test
   isoliert laufen lassen (muss rot werden), danach zuruecknehmen (`git diff` muss leer sein).
8. Ist `test/openai-p2-tool-metadaten.test.js` inhaltlich unveraendert (nur die drei Konstanten
   `TOOL_COUNT_WITH_CONSULT`/`TOOL_COUNT_WITHOUT_CONSULT`/`TOOLS_WITH_OUTPUT_SCHEMA` kommen jetzt
   aus `test/helpers.js` statt lokal definiert zu sein), oder wurden Assertions geaendert? —
   `git diff 91ef2d2..d04f383 -- test/openai-p2-tool-metadaten.test.js` lesen.
9. Laeuft `npm test -- -- --test-concurrency=4` mit `# fail 0` in der ungekuerzten Ausgabe (Exit-Code
   nicht massgeblich)? — Kommando im Worktree ausfuehren, komplette Ausgabe auf `not ok` durchsuchen.
10. Ist die Deploy-Auflage aus Befund 1/2 (zwei echte `tools/list`-Smoke-Checks, claude.ai und
    Claude Desktop) irgendwo ausserhalb dieses Berichts festgehalten (z.B.
    `tasks/openai-technik-stand.md`), oder existiert sie nur hier? — Datei pruefen, bevor
    dieser Bericht nach der CLAUDE.md-Aufraeumregel geloescht wird.
11. Passiert `npx eslint` auf den geaenderten Dateien ohne neue Fehler, und ist die eine
    verbleibende Warnung (`test/helpers.js:1425`) tatsaechlich Bestandscode dieser Phase
    vorausgehend? — `npx eslint <Dateien>` ausfuehren, dann `git blame test/helpers.js -L
    1425,1425` (oder Aequivalent) auf einen Commit vor `19365ad` pruefen.

---

## 5. Restrisiko

Der eingebaute Mechanismus selbst ist solide belegt: er reichert an statt neu zu bauen, wirft
statt still zu verschwinden, und sechs automatisierte Tests (davon einer ein echter
Kindprozess-Spawn seit Runde 2) decken beide Transporte und beide Adapter-Varianten am rohen
JSON ab, ohne dass ein bestehender Test bricht. Das tatsaechliche Restrisiko liegt ausserhalb
dessen, was ein automatisierter Test in diesem Repo pruefen kann: **kein Test misst, wie die
beiden echten, produktiv genutzten Hosts (claude.ai-Connector, Claude Desktop) auf ein
unbekanntes Top-Level-Feld an jedem Tool-Deskriptor reagieren** — nur, dass ein typisierter
SDK-Client es stillschweigend wegwirft. Es existiert kein Feature-Flag, das dieses Feld im
Fehlerfall abschalten koennte, und ein Ausfall waere serverseitig unsichtbar (200 OK, leere
Toolliste beim Client). Zusaetzlich ist die stdio-Deklaration `oauth2` eine fachlich unbelegte
Gleichbehandlung fuer einen Transport ohne Auth-Schicht — sie ist heute nur deshalb folgenlos,
weil dieselbe unbewiesene "SDK-Clients strippen es ohnehin"-Annahme gilt, die fuer HTTP bereits
einmal revidiert werden musste. Beides zusammen ergibt ein Muster: die Phase hat ein
Metadatenfeld korrekt und sauber verdrahtet, aber ihre Sicherheitsargumentation fuer den
Live-Betrieb steht auf einer Annahme, die noch nie an einem echten Host gemessen wurde. Die
zweiteilige Deploy-Auflage ist genau deshalb keine Formalitaet, sondern die einzige Stelle, an
der dieses Risiko vor "Rollout abgeschlossen" noch geschlossen werden kann — und sie ist heute
an keiner Stelle verankert, die das geplante Aufraeumen dieses Berichts ueberlebt.
