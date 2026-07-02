# Phase T3 — MCP-Server-Icon

**Gate:** PASS
**finalBranch:** `phase/widget-branding-t3-fix1`

## Plan (gekuerzt)

### Grounding-Befund
Zwei getrennte `new McpServer(...)`-Konstruktionsstellen tragen bisher byte-identisch dasselbe `{ name: "hermes", version: "0.2.0" }`-Literal:

| Stelle | Datei | Transport | Wer nutzt das live? |
|---|---|---|---|
| `src/mcp-server.js:21` | stdio | Claude Desktop (`npm run mcp`, lokal) |
| `src/server.js:1915` | Streamable HTTP, `POST /mcp` | **claude.ai Custom Connector, ChatGPT** — der live gemeldete Pfad |

Ein Fix nur in `src/mcp-server.js` (wie in der Chain-Doc/`PLAN-MCP-WIDGET-BRANDING.md` §4 als "Root Cause" benannt) haette auf das live gemeldete Symptom (grauer Platzhalter im claude.ai-Connector) **null Wirkung**, da claude.ai/ChatGPT nie mit dem stdio-Prozess sprechen. Empfehlung des Plans: `src/server.js` bekommt zwei surgical, eng begruendete Edits (Identitaets-Konstruktion + eine Basic-Auth-Ausnahme) — kein Gate, keine Disclosure, kein Tool-Handler beruehrt. Als Fallback (Abschnitt 2b) war dokumentiert, nur `mcp-server.js` zu aendern, falls 0-Diff auf `server.js` strikt gefordert wird — mit dem Hinweis, dass dieser Weg den Live-Bug nicht fixt.

### Zweiter empirischer Befund
`public/` liegt hinter Basic-Auth (`app.use(express.static(config.publicDir))` direkt nach der Basic-Auth-Middleware). In Produktion (`DASHBOARD_PASSWORD` Pflicht) liefert `GET /brand/hermes-icon.png` ohne eigene Ausnahme `401` statt des Icons — ein MCP-Host laedt `icons[0].src` ohne Dashboard-Credentials. Verifikationsmuster: `test/audit.test.js` (`externalUrl` + `{ skip: !EXTERNAL_IP }`), weil Loopback-Requests Basic-Auth per `isTrustedLocalCaller` umgehen und das Problem sonst verdeckt bleibt.

### Code-Edit (Plan-Vorschlag)
- Neues, seiteneffektfreies Modul `src/mcp-server-info.js` (`HERMES_SERVER_INFO` + `BRAND_ASSETS_PREFIX = "/brand/"`), weil `src/mcp-server.js` wegen Top-Level-Seiteneffekt (verbindet `StdioServerTransport` an stdin/stdout) nicht importierbar ist — kein Re-Export moeglich.
- `src/mcp-server.js`: Import + `new McpServer(HERMES_SERVER_INFO, serverOptions)` statt Inline-Literal.
- `src/server.js`: Import + `new McpServer(HERMES_SERVER_INFO, serverOptions)` im `/mcp`-Handler, **plus** eine Basic-Auth-Ausnahme (`req.path.startsWith(BRAND_ASSETS_PREFIX)`) im bestehenden Ausnahme-Block.
- Fallback (2d, nicht empfohlen): nur 2a+2b, falls 0-Diff auf `server.js` strikt gefordert — dann bleibt der live Connector-Pfad beim Platzhalter, muss als bewusste Owner-Entscheidung festgehalten werden.

### Asset
Quelle `apps/hermes-studio/public/hermes-logo.png` (1024x1024, 8-bit RGB, opak, verifiziert per `file`) als einzig passende Quelle (Alternative `design-system/assets/logos/hermes-wing.png` ist RGBA/transparent, vom Chain-Doc ausgeschlossen). Ziel: `public/brand/hermes-icon.png` (Byte-Kopie).

### favicon.ico — Entscheidung: NICHT umsetzen
Nicht Teil der deterministischen AC-Liste; einziger Kandidat (`design-system/assets/logos/favicon.svg`) ist stale/off-Brand (falsche Fuellfarbe, generisches Glyph); echte `.ico`-Erzeugung braucht neue Dependency oder ungeprueftes Rendering; Marketing-Auftritt mit eigenem Favicon liegt ohnehin auf `apps/web`, ausserhalb des Scopes.

### Tests (`test/mcp-server-icon.test.js`, neu)
5 Tests: AC1 PNG-Signatur-Bytes, AC2 stdio-Wiring statisch (kein dupliziertes Literal mehr), AC3 echter `initialize`-Request gegen `POST /mcp` mit vollstaendigem SDK-schema-konformem Body (Default-Body ohne `params` scheitert empirisch an der SDK-Schema-Pruefung), AC6a statische Auslieferung 200+`image/png`, AC6b Basic-Auth-Ausnahme + Gegenprobe auf `/tenant.html` = 401 (via `externalIp`-Skip-Muster aus `test/audit.test.js`).

### AC-Liste (7 Kriterien)
AC1 Asset valide PNG, AC2 beide `McpServer`-Stellen tragen `icons`/`config.publicUrl`, AC3 echter `initialize`-Request liefert `icons[0].src`, AC4 `node --check` fehlerfrei, AC5 `npm test` 0 Fehler, AC6a/AC6b statische Auslieferung + Basic-Auth-Ausnahme funktionsfaehig, AC7 `favicon.ico`-Auslassung dokumentiert.

### Blast Radius
Neu: `src/mcp-server-info.js`, `public/brand/hermes-icon.png`, `test/mcp-server-icon.test.js`. Geaendert: `src/mcp-server.js` (2 Zeilen), `src/server.js` (3 kleine, isolierte Stellen: Import, Konstruktion, eine `||`-Bedingung in der Basic-Auth-Ausnahmeliste). Unangetastet: `src/mcp-tools.js`, `src/claude.js`, `src/bridge.js`, alle Regel-1-Gates, Disclosure, Widget-HTML, `package.json`.

## Impl-Zusammenfassung

T3 exakt gemaess Plan umgesetzt (Ausgangs-Branch `phase/widget-branding-t3`, Commit `f56a0c6`, spaeter per Fix-Runde konsolidiert auf `phase/widget-branding-t3-fix1`, Commit `06e50a4`):

- Neues seiteneffektfreies Modul `src/mcp-server-info.js` (`HERMES_SERVER_INFO` + `BRAND_ASSETS_PREFIX`) als EINE Quelle fuer `serverInfo`, verdrahtet in beiden `new McpServer(...)`-Stellen (`src/mcp-server.js` stdio fuer Claude Desktop UND `src/server.js` HTTP `/mcp`-Handler, der live von claude.ai/ChatGPT genutzte Pfad).
- Icon-Asset `public/brand/hermes-icon.png` (1024x1024 PNG, byte-identische Kopie) committet.
- Neuer Test `test/mcp-server-icon.test.js` (5 Tests wie im Plan: AC1 PNG-Signatur, AC2 stdio-Wiring statisch, AC3 echter `initialize`-Request gegen `POST /mcp`, AC6a statische Auslieferung, AC6b Basic-Auth-Ausnahme + Gegenprobe).
- Volle Suite (json- und pglite-Backend) gruen; manueller Smoke zusaetzlich durchgefuehrt (Server lokal gestartet, echter curl-`initialize`-Request zeigt `serverInfo.icons`, `GET /brand/hermes-icon.png` liefert 200 + `image/png`; Server danach saeuberlich gestoppt, kein Reststprozess).
- `node --check` auf allen 4 betroffenen/neuen Dateien gruen. Kein neues npm-Dependency, kein Versions-Bump, keine Aenderung an `claude.js`/`bridge.js`/Safety-Gates.
- Kopf-Commit (finale Impl-Meldung): `f56a0c6b321c440977afe20d14229f19d71a882e`; Tests: 1476/1476 (0 fail).

### Deviations
- Asset-Quelle `apps/hermes-studio/public/hermes-logo.png` existierte im isolierten Worktree nicht (dort nur uncommitted/untracked im Haupt-Arbeitsverzeichnis) — read-only vom Haupt-Arbeitsverzeichnis kopiert (gleiches Dateisystem, keine Aenderung dort); Inhalt/Groesse/Format exakt wie im Plan beschrieben, nur der Kopier-Pfad war ein anderer als im Plan woertlich vorgeschlagen.
- Kleiner Grammatik-Tippfehler im Basic-Auth-Kommentar korrigiert ("empirisch gepruefte" -> "empirisch geprueft"), trivial gemaess CLAUDE.md-Ausnahmeliste.
- `favicon.ico` wie in Plan Abschnitt 4 empfohlen NICHT umgesetzt (bewusste, im Plan begruendete Auslassung, hier bestaetigt).

### Fix-Runde 1 (r1, Commit `06e50a4`, Branch `phase/widget-branding-t3-fix1` auf `phase/widget-branding-t3`/`f56a0c6` aufgesetzt)
Alle 3 Blocker der Clean-Code-Review adressiert. **Blocker 1 (Basic-Auth-Gate-Ausnahme in `server.js`) — VOLL BEHOBEN:** die Basic-Auth-Ausnahme fuer `BRAND_ASSETS_PREFIX` (12 Zeilen im Gate-Middleware-Block) wurde komplett entfernt. Ergebnis: `server.js` ist danach byte-identisch zu `master` bis auf die eine `serverInfo`-Zeile (Import + Konstruktion); der Basic-Auth-Middleware-Block selbst ist unveraendert. Bekannte, bewusst vertagte Folge: sobald `DASHBOARD_PASSWORD` in Produktion gesetzt ist, bleibt `/brand/hermes-icon.png` weiterhin hinter Basic-Auth — funktionale Luecke (Icon evtl. nicht sichtbar fuer externe MCP-Hosts in Produktion), kein Sicherheitsproblem, explizit als eigene Folge-Aenderung dokumentiert statt verschwiegen.

## Safety-Urteil

**APPROVED** (`safety final`)

- `testsPassIndependently`: true — eigener frischer Worktree, `npm test` selbst ausgefuehrt: 1475/1475 gruen, 0 fail/skip/cancelled (~334s), deckt json- und pg-Backend (pglite) ab. Zusaetzlich `node --check` auf allen 4 geaenderten/neuen JS-Dateien.
- `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `behaviorAsIntended`, `scopeRespected`: alle true. Keine Blocker.
- Diff betrifft exakt 5 Dateien: `public/brand/hermes-icon.png` (neu, verifiziert per Signatur-Bytes + `file`, kein Secret-Leak per strings-Scan), `src/mcp-server-info.js` (neu, sicherheitsleeres Konstanten-Modul, keine Gate-/Auth-/Disclosure-Logik), `src/mcp-server.js` (2 Zeilen: Import + `serverInfo`-Swap), `src/server.js` (2 Zeilen: Import + `serverInfo`-Swap in der `POST /mcp`-Route; der Basic-Auth-Middleware-Block selbst Byte-fuer-Byte gegen `master` verglichen und identisch), `test/mcp-server-icon.test.js` (1 Testdatei). `src/claude.js`/`src/bridge.js` unberuehrt. Kein neues npm-Dependency; installierte SDK-Version unterstuetzt `icons` bereits nativ. `serverInfo` bleibt `{name:'hermes', version:'0.2.0'}` unveraendert, `icons` ist rein additiv.
- Concerns (keine Blocker): (1) Diff beruehrt 5 statt woertlich 3 Dateien — bewertet als sicherheitsleere, notwendige Ausnahme (Auftrag nennt fuer `server.js` explizit nur "kein Gate-Code", nicht "kein `server.js` ueberhaupt"). (2) Runde-1-Ueberschreitung (Basic-Auth-Gate-Ausnahme) wurde in fix1 vollstaendig entfernt und Byte-fuer-Byte gegen `master` verifiziert. (3) Bekannte, dokumentierte Einschraenkung: Icon bleibt in Produktion (`DASHBOARD_PASSWORD` gesetzt) weiterhin hinter Basic-Auth fuer externe MCP-Hosts — funktionale Luecke, kein Safety-Problem, bewusst als Folge-Aenderung vertagt.

## Clean-Code-Audit (S1-S4)

**Verdict: PASS** — keine S1/S2-Findings.

- **S1:** [] (leer)
- **S2:** [] (leer)
- **S3:** [] (leer)
- **S4:** [] (leer)
- `blocker`: false

**PassNotes:** `config.publicUrl` korrekt verwendet (trailing-slash-strip in `src/config.js`, `BRAND_ASSETS_PREFIX="/brand/"` hat leading slash — kein Slash-Bug, verifiziert). `sizes:['1024x1024']` gegen SDK-`IconSchema` verifiziert (Format `WxH`-String, kein Magic-Number-Verstoss) UND stimmt mit den echten PNG-Dimensionen des Assets ueberein. `T-T3-AC3` ist ein echter `POST /mcp initialize`-Request mit vollstaendigem, SDK-schema-konformem Body, geprueft gegen echtes Serververhalten — sowohl isoliert (4/4 gruen) als auch volle Suite (1475/1475, selbst nachgefahren). `src/mcp-server-info.js` loest eine echte, vorbestehende G5/S2-Duplizierung auf (identisches `{name,version}`-Literal in beiden Dateien) und begruendet nachvollziehbar, warum kein Re-Export moeglich ist (Top-Level-`await`, verbindet `StdioServerTransport`). `BRAND_ASSETS_PREFIX` ist eine reine, verwaisungsfreie Modul-Konstante (per grep verifiziert). Entfernter `externalIp`-Import in der Testdatei ist saubere Aufraeumarbeit, kein Dead Code in `helpers.js`. Bemerkenswert diszipliniert: Commit `06e50a4` hat einen vorherigen Scope-Creep (Basic-Auth-Ausnahme fuer `/brand/*`) bewusst wieder entfernt, wodurch `server.js` bis auf die eine `serverInfo`-Zeile byte-identisch zu `master` ist; die bekannte Folge (Icon bleibt hinter Basic-Auth, sobald `DASHBOARD_PASSWORD` gesetzt ist) ist explizit im Code-Kommentar UND in der Commit-Message dokumentiert statt verschwiegen — bewusste, nachvollziehbare Scope-Entscheidung, kein Clean-Code-Verstoss.

**Top-TODOs (nicht blockierend, fuer Folge-Tasks vorgemerkt):**
1. Folge-Task: eine Basic-Auth-Ausnahme fuer `/brand/*` (oder eine andere Ausliefer-Loesung) ergaenzen, sonst bleibt das Icon in Produktion (`DASHBOARD_PASSWORD` gesetzt) fuer externe MCP-Hosts per 401 unerreichbar und der T3-Zweck (Branding im `initialize`-Handshake) greift live nicht.
2. Optional/vorbestehend: `src/mcp-server.js` (stdio) ruft `assertConfig()` nicht auf — fehlt `PUBLIC_URL` fuer den stdio-Pfad, wird `icons[0].src` zu einem relativen Pfad statt einer absoluten URL.
3. Optional/vorbestehend: `version:'0.2.0'` in `mcp-server-info.js` ist unabhaengig von `package.json` `version` `'0.1.0'` — vorbestehende Drift, durch diesen Diff nur verschoben (nicht verursacht), bei Gelegenheit auf eine Quelle vereinheitlichen.

## Fix-Runden

**r1** (Commit `06e50a4`, Branch `phase/widget-branding-t3-fix1`, aufgesetzt auf `phase/widget-branding-t3`/`f56a0c6`): Alle 3 Blocker der Clean-Code-Review adressiert.

- **Blocker 1 (Basic-Auth-Gate-Ausnahme in `server.js`) — VOLL BEHOBEN:** die Basic-Auth-Ausnahme fuer `BRAND_ASSETS_PREFIX` (12 Zeilen im Gate-Middleware) wurde komplett entfernt; `server.js` danach Byte-fuer-Byte identisch zu `master` bis auf Import + `serverInfo`-Swap in der `POST /mcp`-Route.
- (Quelltext der Fix-Meldung brach nach "ebenso" ab — weitere Details zu Blocker 2/3 lagen der Berichtsquelle nicht vollstaendig vor; laut finalem Safety- und Clean-Code-Review sind nach dieser Runde keine S1/S2-Findings und keine Blocker mehr offen, Gate = PASS.)

Nach r1: Safety = APPROVED (0 Blocker), Clean-Code = PASS (0 S1/S2). Kein weiterer Fix-Zyklus notwendig.
