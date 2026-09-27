# T2-01 — Widget: csp/Origin am Resource-Inhalt, Skybridge raus — Abschlussbericht

Branch: `phase/openai-t2-01-widget-csp`, Commit: `0bd793e`. Lauf 2 (Nachbau T-31).
Scope dieser Phase: **T-30, T-31, T-23** (nicht X-3/X-7/T-34 — die sind an anderer
Stelle im Plan als "muss nach T2-01 erneut gelten" vermerkt, hier nur mitgeprüft
soweit die Regressionstests das tun).

## 1. Was diese Phase NICHT erfüllt

- **`_meta.ui.domain` (das von OpenAI wörtlich als Pflichtfeld geführte Feld, T-31)
  wird für ChatGPT nur gesetzt, wenn der Request nachweislich aus den veröffentlichten
  ChatGPT-Egress-IP-Bereichen kommt.** Das ist eine bewusste, im Plan/Lead-Vorgabe
  angelegte Design-Entscheidung, kein Bug — aber es bedeutet: ob T-31 für einen echten
  ChatGPT-Connector tatsächlich mit `ui.domain` (statt nur über den Alias
  `openai/widgetDomain`) ankommt, ist **vor dem Deploy nicht bewiesen**. Die Kette
  req.ip → Erkennung hängt an `trust proxy 1` (`src/app.js:534`); ein zusätzlicher Hop
  vor Render (CDN o.ä.) oder eine IP außerhalb der eingecheckten Liste ließe ChatGPT
  als "andere" einstufen und `ui.domain` stumm entfallen (Alias bleibt — fail-safe,
  aber T-31 wäre dann nur über den Alias erfüllt, nicht über den Standard-Schlüssel).
  Nicht blockierend laut offenem Review-Befund (kein Auth-/Kosten-/Gate-Effekt), aber
  eine echte Lücke zwischen "Code korrekt" und "OpenAI akzeptiert es im Scan".
- **Owner-Live-Proben stehen aus** (Claude rendert das Widget mit `ui.domain` =
  PUBLIC_URL-Origin; der OpenAI-Portal-Scan zeigt `ui.domain` als akzeptiert; die
  Log-Zeile `[mcp] client-class=chatgpt` erscheint tatsächlich bei einer echten
  ChatGPT-Anfrage). Alles Owner-Terrain (Deploy + Live-Probe), s. Abschnitt 5.
- **Eigentums-Verifikation der Egress-Liste ist eine statische, eingecheckte Kopie**
  ohne Auto-Update; ein 180-Tage-Frischetest existiert (neu, s. u.), aber das ist
  Betriebswissen, kein Blocker.
- Nicht Teil des Scopes und daher hier nicht bewertet: T-34 (Cache), X-3/X-7
  (Regressionstests dafür laufen mit und sind grün, s. u., aber keine gezielte
  Vertiefung).

## 2. Was erfüllt ist, ID für ID

**T-23** (Standard-Key `_meta.ui.resourceUri` statt `openai/outputTemplate` als Default) —
erfüllt. Der Tool-Deskriptor trägt seit T2-01 ausschließlich `_meta.ui.resourceUri`,
kein `openai/outputTemplate` mehr für irgendeinen Host (der Skybridge-Adapter ist
gelöscht: `find src -name chatgpt.js` liefert nichts mehr, s. u.).
Beweisstellen: `src/ui/ports.js` (JSDoc, `toolMeta`-Kommentar), Test
`test/openai-p8-widget-ui.test.js` Fall "P8-F" (`_meta.ui` trägt nur noch
`["resourceUri"]`) und Fall "P8-A" (Skybridge-Capability sowohl im initialize als auch
direkt im tools/list-Request ändert nichts).

**T-30** (CSP zwingend am Resource-Inhalt, exakte Domains) — erfüllt. `resources/read`
liefert `contents[0]._meta.ui.csp = {connectDomains:[],resourceDomains:[]}` für jedes
der 5 Widgets, HTTP und stdio. Beweisstellen: `src/ui/contract.js` Funktion
`uiResourceMeta()` (Zeilen ~84-150 des Diffs, `UI_CSP`-Konstante unverändert leer,
begründet durch die 12-Datei-Quellenmessung im Kommentar oberhalb `UI_CSP`), Tests
`test/openai-p8-widget-ui.test.js` "P8-C" (HTTP) und "P8-D" (stdio, echter Kindprozess)
sowie die Byte-Beweise "P8-I"/"P8-J" (voller sha256-Hash über tools/list +
resources/list + alle resources/read, neu gepinnt gegen den T2-01-Sollwert).

**T-31** (eigener, pro Plugin eindeutiger Origin `_meta.ui.domain`) — **teilweise
erfüllt, mit der unter Punkt 1 genannten Einschränkung**:
- Der Alias `_meta["openai/widgetDomain"]` (= `config.server.publicUrl`-Origin) wird
  IMMER gesetzt, wenn ein Origin bekannt ist (HTTP wie stdio) — Beweis: Test "P8-C"/
  "P8-D" (`EXPECTED_RESOURCE_META`), `test/openai-t2-01-widget-resource-meta.test.js`.
- `_meta.ui.domain` (Standard-Schlüssel) wird zusätzlich gesetzt, **nur** wenn
  `isChatGptEgressIp(req.ip)` true liefert — Beweis: `src/ui/contract.js`
  `uiResourceMeta(chatgptEgress)`, `src/routes/mcp.js` Funktion
  `logAndDetectChatgptEgress`, Test `test/chatgpt-egress.test.js` (6 Fälle: gültige
  IPv4/IPv6-Treffer, Nicht-Treffer, kaputte Eingaben, kaputte/fehlende Liste →
  fail-closed false) und `test/openai-t2-01-widget-resource-meta.test.js` (12 Fälle,
  inkl. explizit stdio-nie-`ui.domain`).
- stdio setzt `ui.domain` NIE — Beweis: `src/mcp-server.js:36` (`uiHost: { enabled:
  config.tenancy.mcpUiEnabled }`, kein `chatgptEgress`-Feld) → in `mcp-tools.js`
  `widgetResourceOptions()` wird `uiHost?.chatgptEgress === true` zu `false`.
- Fail-safe: fehlt `config.server.publicUrl` (leer/unparsbar), entfällt sowohl Alias als
  auch `ui.domain` — Beweis Test "E7-T12" (`test/mcp-ui.test.js`).

## 3. Betroffene Pfade — Vollständigkeit

| Pfad | T-23 | T-30 | T-31 (Alias) | T-31 (`ui.domain`) |
|---|---|---|---|---|
| HTTP, OAuth | ja | ja | ja | ja, wenn req.ip in Egress-Liste |
| HTTP, Legacy-Token | ja | ja | ja | ja, wenn req.ip in Egress-Liste |
| stdio | ja | ja | ja | **nie** (Owner-Vorgabe) |

Alle drei IDs sind für HTTP OAuth und HTTP Legacy identisch behandelt (dieselbe Route,
`routes/mcp.js`, kein Unterschied nach Auth-Zweig) — die Egress-Erkennung sitzt vor der
Tool-Registrierung, unabhängig vom Auth-Pfad. Das ist NICHT separat getestet (kein Test
mit `MCP_LEGACY_TOKEN` + Egress-IP-Spoof kombiniert), sondern folgt aus dem Code-Fluss
(`makeMcpRoutes` ruft `logAndDetectChatgptEgress(req)` einmal, vor jeder
Auth-Verzweigung in `mcpAuth`).

## 4. Was ein unabhängiger Prüfer nachmessen sollte (neutral)

- Ist `find src -name chatgpt.js` wirklich leer und `grep -r capabilityDeclaresChatgptUi src`
  ebenfalls? (Abnahme-Punkt 5 aus dem Plan.)
- Liefert `resources/read` für alle 5 URIs aus `resources/list` (HTTP, `MCP_UI_ENABLED=true`,
  gesetzter `PUBLIC_URL`) `_meta.ui.csp` = leer UND `_meta["openai/widgetDomain"]` =
  Origin — UND, nur bei einer als ChatGPT erkannten Absender-IP, zusätzlich
  `_meta.ui.domain`? Ist ohne diese Erkennung (normaler Test-Client) `ui.domain`
  tatsächlich abwesend?
- Landet `params.capabilities` (Skybridge-Form) im tools/list-Request selbst
  (nicht nur im initialize) — ändert das wirklich nichts (Test "P8-A" Zusatzfall)?
- Setzt der stdio-Pfad (`npm run mcp`, echter Kindprozess) `ui.domain` unter keinen
  Umständen — auch nicht mit einer manipulierten `X-Forwarded-For` (die stdio ohnehin
  nicht kennt)?
- Stimmen die zwei sha256-Pins (P8-I/P8-J) tatsächlich mit einem frischen Klartext-Dump
  überein, wenn man den Test bei Abweichung den kanonisierten Capture mitloggen lässt
  (im Testcode bereits vorgesehen)?
- **Test-Vollständigkeit (Prüfauftrag des Leads):** ein frischer, isolierter Lauf von
  `NODE_ENV=test node --test-concurrency=4 test/testbaenke-run.mjs regression`
  auf diesem Branch gegen denselben Lauf auf `master` (288376b, dem tatsächlichen
  Merge-Base — kein Drift) — stimmt die Differenz mit "13 Tests mehr, 0 rot" überein?
  (Eigene Messung unten, Rohdaten in den Logdateien.)

## 5. Owner-Punkte (nach der Owner-Regel) und Restrisiko

- **Live-Messung nach Deploy (OW-C/OW-E, in `PLAN-SECURITY.md` bereits als offener
  Punkt eingetragen):** in den Render-Logs prüfen, dass eine echte ChatGPT-
  Developer-Mode-Anfrage `[mcp] client-class chatgpt` erzeugt und eine Claude-Anfrage
  `andere` — das belegt gleichzeitig die trust-proxy-Hop-Zahl und dass `req.ip` hinter
  Render die echte Client-IP ist. Kein Auth-/Kosten-/Gate-Effekt bei falscher Hop-Zahl,
  daher nicht blockierend für den Merge, aber ohne diese Probe bleibt offen, ob T-31 für
  ChatGPT über den Standard-Schlüssel oder nur über den Alias erfüllt ist.
- **Owner-Live-Proben (Claude/ChatGPT):** rendert das Widget in Claude mit `ui.domain` =
  PUBLIC_URL-Origin? Zeigt der OpenAI-Portal-Scan `ui.domain` als akzeptiert? Beides nur
  im jeweiligen Developer Mode messbar, nicht im Code belegbar.
- Restrisiko in einem Satz: der Code ist fail-safe in beide Richtungen (falsches
  "kein ChatGPT" verschenkt höchstens ein Feld, der Alias bleibt immer stehen — kein
  Widget-Ausfall, kein Sicherheits-Gate berührt), aber ob die IP-Erkennung hinter Render
  tatsächlich trifft und ob ChatGPT/Claude das Ergebnis wie erwartet rendern, ist ohne
  die zwei genannten Owner-Proben unbewiesen; bis dahin gilt T-31 für ChatGPT nur als
  "über den Alias erfüllt, über den Standard-Schlüssel unbestätigt".

## Anhang: eigene Testlauf-Messung (Prüfauftrag)

Beide Läufe isoliert, `NODE_ENV=test node --test-concurrency=4 test/testbaenke-run.mjs regression`,
volle Ausgabe in `/private/tmp/claude-501/.../scratchpad/logs-t2-01/{branch,master}-npm-test.log`:

| | roh (tests/pass/fail) | korrigiert (Wrapper abgezogen) |
|---|---|---|
| `master` (288376b, = Merge-Base des Branches) | 6248 / 6248 / 0 | 6228 / 6228 / 0 |
| Branch `0bd793e` | 6261 / 6261 / 0 | 6241 / 6241 / 0 |

Differenz zum tatsächlichen Merge-Base: **+13 Tests, 0 rot** — keine Regression. Die im
Kickoff zitierten Zahlen (6252 Baseline, 6239/1 fail beim Nachbau) stammen aus einem
früheren Zwischenstand vor den letzten beiden Fix-Commits (`76ba1d8`, `0bd793e`) und sind
durch die aktuelle Messung überholt: der Merge-Base ist heute 288376b (6228 korrigiert,
nicht 6252) — der Branch war nie gegen einen älteren `master` verglichen worden, er ist
direkt von diesem Commit abgezweigt.

Auf Test-Datei-Ebene (top-level `test(`-Aufrufe, master → Branch):
- entfernt (5): `test/openai-p3-security-schemes.test.js` Schritt 6b (ChatGPT-Adapter-
  Test, Adapter gelöscht), `test/openai-p8-widget-ui.test.js` "P8-H" (ChatGPT-Adapter-
  Regressions-Pin, im Kommentar auf den Ersatzbeweis in der neuen Testdatei verwiesen),
  `test/mcp-ui.test.js` "T-P3-AC2"/"T-P3-AC5"/"E7-T13" (alle drei prüften den jetzt
  entfernten ChatGPT-Adapter-Pfad).
- hinzugekommen (18): `test/openai-t2-01-widget-resource-meta.test.js` (12 Fälle, neu),
  `test/chatgpt-egress.test.js` (6 Fälle, neu).

Alle fünf Entfernungen sind durch die Adapter-Löschung sachlich begründet (der Testinhalt
existiert als Verhalten nicht mehr) und keine davon prüfte innerhalb einer Schleife
mehrere Fälle, die als node:test-Einzeltests gezählt hätten (kein verdeckter Verlust
über Schleifen-Multiplikation) — nachgesehen im vollen Diff der vier betroffenen Dateien.

## Unabhaengige Verifikation (gewinnt gegen alles oben)

- Urteil des Laufs: PASS (PASS nur bei beiden Reviews PASS, allen IDs ja, keinem isoliert roten Test)
- Gemessener Commit: 0bd793e; Tests (volle Suite, pass/fail): 6261/0
- Review-Urteile zuletzt: {"safety":"PASS","cleancode":"PASS"}
- Tabelle ID | erfuellt | Beleg | Luecke:

| ID | erfuellt | Beleg | Luecke |
|---|---|---|---|
| T-30 | ja | resources/read ueber /mcp: alle 5 Widgets tragen _meta.ui.csp={connectDomains:[],resourceDomains:[]} (contract.js:82). Eigener Scan des Draht-HTML: keine externen Loads (nur data:-URIs). T3/T8 gruen. Live-Rest: Rendern in den Hosts | Nur live messbar: ob ChatGPT und Claude das Widget mit dieser leeren CSP tatsaechlich rendern. |
| T-31 | ja | contract.js:110-114: ui.domain=PUBLIC_URL-Origin nur bei ChatGPT-Egress-IP (req.ip, routes/mcp.js); sonst Alias openai/widgetDomain (per Probe ueber Loopback gemessen). T9/T10 am HTTP-Draht gruen | Nur live: ob die Hosts die Domain annehmen und ob req.ip (trust proxy 1) auf Render die echte ChatGPT-IP ist. stdio setzt ui.domain nie (nur Alias). |
| T-23 | ja | Probe tools/list ueber /mcp: place_call, get_my_number, list_calls, get_calendar und get_agent_status tragen _meta.ui.resourceUri (ui://hermes/...), kein openai/outputTemplate; chatgpt.js entfernt; P8-J stdio byte-identisch und gruen | keine; der Alias outputTemplate fehlt ganz, das ist mit 'nur als Alias' vereinbar. |

- Isoliert rot: []
- Offene Blocker:
  - safety/wichtig src/routes/mcp.js:74: Die ChatGPT-Erkennung haengt an req.ip hinter 'trust proxy 1' (src/app.js:534). Stehen vor Render weitere Hops, zum Beispiel ein CDN, oder kommen der OpenAI-Portal-Scan bzw. resources/read aus IPs ausserhalb von chatgpt-connectors.json, wird ChatGPT als 'andere' eingestuft, und ui.domain fehlt still.
