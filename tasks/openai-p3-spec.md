# P3 — `securitySchemes` an der SDK-Grenze (Weg B: Low-Level-Override)

**ID:** T-15. **Dateien (Soll):** `src/mcp-security-schemes.js` (neu), `src/routes/mcp.js`,
`src/mcp-server.js`, `test/openai-p3-security-schemes.test.js` (neu). **Kein** `package.json`,
**keine** neue Env-Variable, **keine** Aenderung an `src/mcp-tools.js`.

**Grundlinie vor der Phase:** master, 6160 gruen / 0 rot
(`npm test -- -- --test-concurrency=4`; nur `# pass`/`# fail` zaehlen, der Exit-Code luegt).

---

## 0. Was vor dem Bauen gemessen wurde (und den Plan korrigiert)

### 0.1 Der Rohtext von OpenAI — U-1 ist geschlossen, aber anders als geplant

`curl -sS -L https://developers.openai.com/apps-sdk/build/auth` folgt auf
`https://developers.openai.com/plugins/build/auth` (HTTP 200, 462552 Bytes, Stand 2026-09-21).
Drei Fundstellen, woertlich aus dem HTML entnommen (Tags entfernt):

Fundstelle 1 — vollstaendiger Tool-Deskriptor (JSON), `securitySchemes` steht **top-level
zwischen `annotations` und `_meta`**:

```json
  "annotations": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "openWorldHint": false
  },
  "securitySchemes": [
    {
      "type": "oauth2",
      "scopes": []
    }
  ],
  "_meta": {
    "openai/profile": true
  }
```

Fundstelle 2 — Fliesstext:

> "Describe each tool's auth policy with securitySchemes. Declaring securitySchemes per tool
> tells ChatGPT which tools require OAuth versus which can run anonymously. **Stick to per-tool
> declarations even if the entire server uses the same policy**; server-level defaults make it
> difficult to evolve individual tools later."
> "Two scheme types are available today, and you can list more than one to express optional auth:
> noauth ... oauth2 ... **If you omit the array entirely, the tool inherits whatever default the
> server advertises.**"

Fundstelle 3 — TypeScript-Beispiel (`server.registerTool`-Konfig):

```ts
    securitySchemes: [{ type: "oauth2", scopes: ["docs.write"] }],
```

**Folge:** Der Wert ist ein **ARRAY** von Schema-Objekten. Plan und P0 schreiben ihn als
einzelnes Objekt (`{"type":"oauth2","scopes":[]}`). Gebaut wird das Array
`[{ "type": "oauth2", "scopes": [] }]` — s. Widerspruch W1.

### 0.2 Die SDK-Naht — selbst nachgemessen, nicht aus P0 uebernommen

| Messung | Befund |
|---|---|
| `node -p "require('./node_modules/@modelcontextprotocol/sdk/package.json').version"` | `1.29.0` (package.json deklariert `^1.12.0`, `package-lock.json` haelt 1.29.0) |
| `npm view @modelcontextprotocol/sdk version` (2026-09-21) | `1.30.0` — unveraendert zur P0-Messung, Weg A bleibt tot |
| `registerTool()` destrukturiert | `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:702-703`: `{ title, description, inputSchema, outputSchema, annotations, _meta }` — alles andere faellt **still** weg |
| ListTools-Handler | `mcp.js:67-95` baut den Deskriptor aus einer festen Feldliste neu |
| `grep -rl securitySchemes node_modules/ \| wc -l` | `0` |

### 0.3 Zwei eigene Messungen, die im Plan und in P0 fehlen (beide entscheidend)

Ausgefuehrt mit einem Wegwerf-Skript im Repo-Wurzelverzeichnis (danach geloescht, `git status`
gegengeprueft): echter `McpServer`, ein Tool per `registerTool` registriert, Original-Handler
eingefangen, Ergebnis angereichert, `InMemoryTransport` + echter `Client`.

**Messung A — der Andockpunkt ist ein PRIVATES Feld.**
`server.server._requestHandlers` ist eine `Map` und traegt nach der Tool-Registrierung
`['ping','initialize','tools/list','tools/call']`. Das ist die **einzige** Stelle, an der der
Original-Handler erreichbar ist: `setRequestHandler()` ueberschreibt nur
(`shared/protocol.js:886-892`), `removeRequestHandler()` (`:897`) loescht, gibt aber nichts
zurueck. Die Plan-Bauvorgabe "anreichern statt neu bauen" ist also **nur ueber den privaten
Zugriff** erfuellbar. Der Plan nennt diesen Preis nicht (W4).

**Messung B — der typisierte SDK-Client STRIPPT das Feld.** Derselbe Lauf, zwei Abfragen auf
denselben Server:

```
client.listTools() -> {"name":"t1","description":"d","inputSchema":{...},"execution":{...}}
roh (client.request(..., z.object({tools:z.array(z.any())}))) ->
   {"name":"t1", ... ,"securitySchemes":[{"type":"oauth2","scopes":[]}]}
```

Ursache: `ToolSchema` (`types.js:1229-1273`) ist ein `z.object(...)` **ohne** `.passthrough()`,
und zod 3.25.76 strippt unbekannte Schluessel beim Parsen.

Das hat zwei Konsequenzen, die diese Phase tragen:
1. **Jeder Beleg muss rohes JSON-RPC-JSON lesen.** Ein Test ueber `client.listTools()` waere
   rot, obwohl der Code stimmt (oder — schlimmer — gruen aus dem falschen Grund, wenn jemand
   die Erwartung daraufhin abschwaecht).
2. **Gemessen ist das Risiko nur fuer SDK-basierte Clients: null.** Ein SDK-basierter Client
   (`@modelcontextprotocol/sdk`, typisiert ueber `ToolSchema`) sieht das neue Feld gar nicht,
   weil zod es beim Parsen strippt. **Der heute produktiv genutzte claude.ai-Connector ist
   NICHT gemessen** — er ist kein Instanz dieses SDK-Clients, und ob er Tool-Deskriptoren
   strikt validiert (z.B. `additionalProperties:false`) und deshalb die ganze
   `tools/list`-Antwort verwerfen wuerde, ist unbekannt. Der erste Deploy dieser Phase muss
   deshalb von einem Connector-Smoke begleitet werden: einmal `tools/list` ueber den echten
   claude.ai-Connector ansehen, bevor der Rollout als abgeschlossen gilt.

### 0.4 Zeilen aus dem Plan, die heute anders liegen

| Plan sagt | tatsaechlich |
|---|---|
| `registerTools()` bei `src/mcp-tools.js:657-667` (DP-1-Tabelle) | `src/mcp-tools.js:792`; die Registrier-Fabrik `uiTool()` bei `:894-895` (P2 hat verschoben) |
| `src/mcp-server.js:19-28` | `registerTools(server, {...})` steht bei `:26-28`, `new McpServer(...)` bei `:22` — passt |
| `src/routes/mcp.js:151` | passt: `registerTools(server, {...})` `:151-158`, Transport `:159` |
| `src/routes/mcp.js:112` (ein Auth-Mount-Punkt) | passt sinngemaess: `router.post("/mcp", mcpAuth, ...)` steht heute bei `:110` |

---

## 1. Entscheidungen dieser Phase (mit Begruendung)

**E1 — Wert: einheitlich `[{ "type": "oauth2", "scopes": [] }]` fuer alle Werkzeuge.**
Kein Werkzeug von `/mcp` ist ohne Token erreichbar; es gibt genau einen Auth-Mount-Punkt
(`src/routes/mcp.js:110`). `noauth` waere falsch (Pre-Mortem des Plans). Die Scope-Liste bleibt
**leer**, solange der Anbieter keinen fachlichen Scope ausstellt (D0-7: kein `scope`-Claim wird
irgendwo gelesen, der Anbieter bewirbt nur `email/offline_access/openid/profile`); eine
erfundene Scope-Liste waere eine Falschangabe (N-5). **Keine Tabelle mit zwoelf identischen
Zeilen** — eine Tabelle mit zwoelf gleichen Werten laedt zur Drift ein, ohne einen Unterschied
abzubilden, den es nicht gibt. Die Forderung "per-tool declarations" ist erfuellt: das Feld
steht an **jedem** Deskriptor.

**E2 — Der Wert wird NICHT aus `config.auth.mcpAuth` abgeleitet.** Der Modus kann `oauth`,
`token`, `""` (Legacy, ausserhalb Produktion localhost-Bypass) oder `off` sein
(`src/config.js:2056`, `src/auth.js:92-115`). Eine Ableitung haette drei Wirkungen, alle
schlecht: sie koppelt ein Metadatenfeld an die Betriebskonfiguration, sie laesst die Tests
etwas anderes beweisen als die Produktion ausliefert (die Spawn-Tests laufen ohne Token ueber
den Legacy-Bypass), und sie erzeugt einen zweiten, nie gefahrenen Pfad. Die Deklaration
beschreibt das **Produkt**; `MCP_AUTH=off` traegt bereits einen eigenen Boot-Befund
("im Hosting unzulaessig", `src/config.js:2426-2427`). Als bewusstes Restrisiko notiert.

**E3 — stdio traegt denselben Wert.** Der Plan laesst offen, ob stdio den Override bekommt.
Entschieden: ja. Gruende: (a) die Betriebsregel "was ueber HTTP gilt, gilt ueber stdio" wird
buchstaeblich erfuellt, statt eine Abweichung zu erzeugen, die der naechste Leser fuer ein
Versehen haelt; (b) es entsteht **eine** Wahrheit statt zweier, die auseinanderlaufen koennen;
(c) die Aussage ist ueber stdio inert — Messung B zeigt, dass ein SDK-Client das Feld
wegwirft, Claude Desktop sieht es nie. Die gegenteilige Option (`noauth` fuer stdio, weil der
Prozess keine Auth-Schicht hat, D0-6) waere fachlich verteidigbar, aber sie schafft einen
zweiten Wert fuer denselben Satz und waere fatal, falls diese Liste je ueber HTTP
ausgeliefert wuerde.

**E4 — Andockpunkt: die beiden Zusammenbau-Stellen, NICHT `registerTools()`.**
`registerTools()` bekaeme den Override an einer Stelle statt an zweien (DP-1), aber die
Funktion wird in 14 Testdateien mit einem Attrappen-Server aufgerufen, der nur
`registerTool`/`registerResource` kennt (z.B. `test/mcp-tools.js:27-36`,
`test/openai-p2-tool-metadaten.test.js:182-190`). Der Override braeuchte dort entweder einen
**stillen Uebersprung** bei fehlendem `server.server` — genau die Art abgeschalteter Sicherung,
die CLAUDE.md verbietet und die das Feld spaeter lautlos verschwinden liesse — oder 14
angepasste Attrappen. Deshalb: **eine** Implementierung in einem eigenen Modul, **zwei**
Aufrufzeilen an den Stellen, an denen ein echter `McpServer` gebaut wird. Der stdio-Einstieg
bekommt zusaetzlich einen Naht-Pin (Schritt 7), weil `src/mcp-server.js` nicht importierbar ist
(Top-Level-Seiteneffekt).

**E5 — Fehlende SDK-Naht wirft LAUT.** Findet der Override keinen Original-Handler, wird
geworfen statt still weiterzulaufen. Ueber stdio bricht der Start ab (sichtbar). Ueber HTTP
faellt der Wurf in den bestehenden `try` von `src/routes/mcp.js:166-171` und wird zu einem
500er auf `/mcp` — deterministisch, nicht datenabhaengig, und vor jedem Deploy vom Lerntest
(Schritt 2) rot gefangen. Der Wurf ist mit dem heutigen Aufbau unerreichbar (`registerTools()`
registriert immer mindestens zehn Werkzeuge, damit existiert der Handler immer); er ist die
Sicherung gegen ein SDK-Update, das das private Feld umbenennt.

---

## 2. Arbeitsschritte

### Schritt 1 — Rohtext-Gegenprobe festhalten (kein Code)

**Was:** Die drei Zitate aus §0.1 gehen woertlich in den Phasenbericht (`tasks/openai-p3-report.md`),
mit URL, Abrufdatum und HTTP-Status. Damit ist U-1 (JSON-Pfad) von "indiziert" auf **belegt**
gehoben und zugleich die Werteform korrigiert (Array, nicht Objekt).
**Pfade:** keine (Beleg).
**Beweis (c):** `curl -sS -L -o /tmp/oa.html -w "%{http_code} %{url_effective}\n"
https://developers.openai.com/apps-sdk/build/auth` -> `200 https://developers.openai.com/plugins/build/auth`;
danach `python3 -c "import re,html,sys;s=open('/tmp/oa.html').read();
[print(html.unescape(re.sub(r'<[^>]+>','',s[m.start()-400:m.end()+300]))) for m in re.finditer('securitySchemes',s)]"`
zeigt an allen Fundstellen eine eckige Klammer hinter `securitySchemes`.

### Schritt 2 — Lerntest auf die SDK-Naht (neue Datei, zuerst schreiben)

**Was:** `test/openai-p3-security-schemes.test.js` beginnt mit einem Test, der **nur das SDK**
prueft, nicht Hermes. Drei Zusicherungen an einem Wegwerf-`McpServer` mit genau einem Tool, dessen
Konfig `securitySchemes` bereits enthaelt:
1. `server.server._requestHandlers` ist eine `Map` und enthaelt `"tools/list"` (der Andockpunkt).
2. Im rohen `tools/list`-Ergebnis fehlt `securitySchemes` — **das** ist der Beleg, dass
   `registerTool()` unbekannte Konfigfelder still verwirft und der Override noetig ist.
3. `client.listTools()` liefert fuer denselben Server ein Tool-Objekt **ohne** ein per Override
   gesetztes Zusatzfeld, `client.request({method:"tools/list"}, z.object({tools:z.array(z.any())}))`
   liefert es **mit** — der Beleg fuer Messung B und die Begruendung, warum Schritt 5/6 rohes
   JSON lesen.
**Datei:** `test/openai-p3-security-schemes.test.js:1` (neu).
**Pfade:** SDK-Naht, gilt fuer HTTP und stdio gleichermassen.
**Beweis (b):** `npx node --test test/openai-p3-security-schemes.test.js` — der Fall ist gruen.
Der Pruefer liest den Test und sieht, dass Zusicherung 2 gegen den **rohen** Response geht.
Gegenprobe fuer den Pruefer: wird `.passthrough()` gedanklich unterstellt, muesste Zusicherung 3
rot sein.

### Schritt 3 — Das Modul `src/mcp-security-schemes.js` (neu)

**Was:** Neue Datei, drei Elemente, alle Kommentare deutsch ohne Umlaute:

```js
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export const TOOL_SECURITY_SCHEMES = Object.freeze([
  Object.freeze({ type: "oauth2", scopes: Object.freeze([]) }),
]);

const LIST_TOOLS_METHOD = "tools/list";

const mitSecuritySchemes = (tool) => ({ ...tool, securitySchemes: TOOL_SECURITY_SCHEMES });

export function applyToolSecuritySchemes(server) {
  const protokoll = server.server;
  const original = protokoll._requestHandlers?.get(LIST_TOOLS_METHOD);
  if (!original)
    throw new Error(
      "MCP-SDK-Naht verloren: kein tools/list-Handler zum Anreichern (securitySchemes, T-15)",
    );
  protokoll.setRequestHandler(ListToolsRequestSchema, async (request, extra) => {
    const ergebnis = await original(request, extra);
    return { ...ergebnis, tools: ergebnis.tools.map(mitSecuritySchemes) };
  });
}
```

Der Kommentarkopf haelt fest: (a) warum es keinen SDK-Andockpunkt gibt (`mcp.js:702-703` und
`:67-95`, `grep` = 0 Treffer), (b) dass der Original-Handler **aufgerufen und angereichert**
wird und die Liste NICHT neu gebaut werden darf (sonst gehen Zod-Normalisierung und
`outputSchema` verloren), (c) warum `_requestHandlers` privat ist und der Lerntest aus Schritt 2
die Naht pinnt, (d) warum der Wert einheitlich ist und `scopes` leer bleibt (E1, D0-7).
`Object.freeze` steht dort, weil **dasselbe** Array in jedem der zwoelf Deskriptoren steckt.
**Datei:** `src/mcp-security-schemes.js:1` (neu).
**Pfade:** HTTP `/mcp`, stdio, mcp-nativ und ChatGPT-Adapter gleichzeitig — der Override sitzt
unterhalb der Adapterwahl, die nur `_meta` betrifft.
**Beweis (a):** die Datei; `node --check src/mcp-security-schemes.js` laeuft durch;
`grep -n "original(request, extra)" src/mcp-security-schemes.js` belegt den Aufruf des
Original-Handlers (die Bauvorgabe des Plans). Ein Pruefer, der stattdessen eine selbstgebaute
Liste sieht, lehnt ab.

### Schritt 4 — Beide Zusammenbau-Stellen verdrahten

**Was:** Je eine Zeile `applyToolSecuritySchemes(server);` unmittelbar nach dem
`registerTools(...)`-Aufruf, plus der Import.
- `src/routes/mcp.js`: Import neben `registerTools` (heute `:26`), Aufruf nach `:158`, also vor
  `new StreamableHTTPServerTransport(...)` (`:159`).
- `src/mcp-server.js`: Import neben `registerTools` (heute `:9`), Aufruf nach `:28`, also vor
  `new StdioServerTransport()` (`:30`).
Ein einzeiliger Kommentar an beiden Stellen nennt T-15 und verweist auf das Modul; an der
stdio-Stelle steht zusaetzlich, dass der Wert dort bewusst derselbe ist (E3).
**Pfade:** HTTP `/mcp` **und** stdio — beide, keine Ausnahme.
**Beweis (a):** `grep -n applyToolSecuritySchemes src/routes/mcp.js src/mcp-server.js` liefert je
zwei Zeilen (Import + Aufruf); `grep -rn applyToolSecuritySchemes src/ | wc -l` = `5`
(Definition + 2x Import + 2x Aufruf). `node --check` auf beide Dateien.

### Schritt 5 — Beleg ueber die echte HTTP-Route (AC1 + AC2 in EINEM Response)

**Was:** Zweiter Test in `test/openai-p3-security-schemes.test.js`. Startet den Server als
Kindprozess (`startServer` aus `test/helpers.js`, Muster
`test/openai-p2-tool-metadaten.test.js:96-104`) mit
`env: { MCP_UI_ENABLED: "true", CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" }`,
setzt `POST /mcp` mit `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` ab und liest den
**rohen** Response ueber `readToolResult` (parst `JSON.parse`, strippt nichts). Zusicherungen:
1. **AC1:** fuer **jedes** Werkzeug der gelieferten Liste (nicht ueber eine Namensliste
   iterieren): `assert.deepEqual(tool.securitySchemes, [{ type: "oauth2", scopes: [] }])`.
   Die Erwartung steht als **Literal** im Test, entnommen dem Zitat aus §0.1 — nicht aus `src`
   importiert.
2. Menge: `tools.length === 12` (Owner + beide Consult-Schalter an, P0-Baseline).
3. **AC2 (Nicht-Regression im selben Response):** `outputSchema` bei genau **10** Werkzeugen,
   `inputSchema` bei allen 12 ein Objekt mit `type === "object"`, `annotations` vorhanden,
   `title` ein nicht-leerer String, `_meta["openai/toolInvocation/invoking"]` ein String, und
   `place_call._meta.ui.resourceUri === "ui://hermes/call"`. Das ist der Beleg, dass der
   Override die SDK-Normalisierung und die P1/P2-Felder nicht zerschossen hat.
**Datei:** `test/openai-p3-security-schemes.test.js` (neu).
**Pfade:** HTTP `/mcp`, mcp-nativer Adapter.
**Beweis (b):** `npx node --test test/openai-p3-security-schemes.test.js` gruen. Der Pruefer
liest den Test und bestaetigt: er spricht die echte HTTP-Route an und parst deren JSON — kein
Konfigobjekt, kein typisierter Client.

### Schritt 6 — Beleg fuer stdio und fuer den ChatGPT-Adapter (echtes SDK, rohes JSON)

**Was:** Zwei weitere Tests, Harness wie `test/openai-p2-tool-metadaten.test.js:246-262`
(echter `McpServer` + `InMemoryTransport` + echter `Client`), aber die Liste wird **roh**
abgefragt:
`client.request({ method: "tools/list" }, z.object({ tools: z.array(z.any()) }))` — `z` ist
bereits Dependency (`zod ^3.24.0`). Ein Helfer kapselt das einmal fuer beide Faelle.
- **6a stdio:** `registerTools(server, { uiHost: { enabled: true } })` wie `src/mcp-server.js:26-28`,
  danach `applyToolSecuritySchemes(server)`. Zusicherungen: 10 Werkzeuge (ohne Consult-Faehigkeit,
  P0-Baseline), jedes mit demselben Literal wie in Schritt 5, dazu die `outputSchema`-Bilanz auf
  diesem Pfad.
- **6b ChatGPT-Adapter:** derselbe Aufbau mit
  `uiHost: { enabled: true, capabilities: { extensions: { "io.modelcontextprotocol/ui": { mimeTypes: ["text/html+skybridge"] } } } }`
  (Muster `test/openai-p2-tool-metadaten.test.js:276-300`). Zusicherung: `securitySchemes` liegt
  auch hier an jedem Werkzeug und **neben** `_meta["openai/outputTemplate"]` — der Beleg, dass das
  Feld nicht an der Adapterwahl haengt.
**Pfade:** stdio, ChatGPT-Adapter, mcp-nativer Adapter.
**Beweis (b):** derselbe Testlauf, beide Faelle gruen. Der Pruefer sieht im Test, dass **nicht**
`client.listTools()` benutzt wird, und findet im Lerntest aus Schritt 2 die Begruendung.

### Schritt 7 — Naht-Pin fuer den stdio-EINSTIEG

**Was:** Ein vierter, sehr kleiner Test liest `src/mcp-server.js` als Text und sichert zu, dass
dort `applyToolSecuritySchemes(` vorkommt **und** hinter dem `registerTools(`-Aufruf steht
(Index-Vergleich). Begruendung im Testkommentar: `src/mcp-server.js` ist nicht importierbar
(Top-Level-`await server.connect(...)` an stdin/stdout), Schritt 6a belegt deshalb nur den
**Mechanismus**, nicht die **Verdrahtung des Einstiegs**. Ohne diesen Pin koennte die stdio-Zeile
geloescht werden, ohne dass ein Test rot wird.
**Datei:** `test/openai-p3-security-schemes.test.js`.
**Pfade:** stdio.
**Beweis (b):** Testlauf gruen; Gegenprobe fuer den Pruefer: Zeile in `src/mcp-server.js`
auskommentieren -> Test rot (danach zuruecknehmen).

### Schritt 8 — Lint, Suite, Bilanz

**Was:** Kein Code, nur die Abnahme.
**Pfade:** alle.
**Beweis (c):**
1. `npx eslint src/mcp-security-schemes.js src/routes/mcp.js src/mcp-server.js test/openai-p3-security-schemes.test.js`
   -> keine Ausgabe (0 Probleme). Wichtig, weil `test/check-staged-suppressions.test.js` die
   eingefrorenen Verstosszahlen je Datei pinnt: eine neue Datei mit Befunden laesst diesen Test
   rot werden. Erwartete Stolpersteine: G36 (Demeter, max. 4 verkettete Zugriffe —
   `server.server` wird deshalb in eine Variable gelegt) und `id-length >= 2`.
2. `npm test -- -- --test-concurrency=4` (nur der **doppelte** `--`-Trenner kommt an) ->
   `# fail 0` und `# pass` = 6160 + Zahl der neuen Faelle (5: Schritt 2, 5, 6a, 6b, 7). Der Exit-Code wird ignoriert.
   Die Ausgabe wird **vollstaendig** in den Bericht uebernommen, nicht abgeschnitten.
3. Ein roter Fall zaehlt erst, wenn er **isoliert** erneut rot ist:
   `NODE_ENV=test npx node --test test/<datei>.test.js`.

---

## 3. Welcher bestehende Test bricht?

**Erwartung: keiner.** Nachgesehen wurde gezielt nach Zusicherungen, die eine neue
Top-Level-Eigenschaft am Tool-Deskriptor stoeren koennten:
- Kein Test vergleicht ein Tool-Objekt aus `tools/list` per `deepEqual` oder ueber
  `Object.keys(tool)` — die `deepEqual`-Treffer in `test/mcp-ui.test.js` betreffen
  `structuredContent`, Extensions und Texte, nicht den Deskriptor.
- Die 14 Attrappen-Server-Tests rufen `registerTools()` direkt auf; sie sehen den Override
  nicht (E4) und bleiben unveraendert.
- `test/openai-p2-tool-metadaten.test.js` liest rohes JSON und prueft nur Anwesenheit von
  Feldern — ein zusaetzliches Feld stoert nicht. Diese Datei bleibt bewusst unangetastet und
  ist damit der **unabhaengige** Regressionswaechter fuer P1/P2 neben Schritt 5.
- `test/check-staged-suppressions.test.js` kann rot werden, wenn die neue Datei Lint-Befunde
  hat — deshalb Schritt 8.1 vor dem Suitelauf.

**Neues Verhalten, neuer Test:** Schritte 2, 5, 6a/6b, 7.

---

## 4. Was diese Phase NICHT baut

1. **Keine SDK-Anhebung (Weg A).** `npm view` liefert am 2026-09-21 weiterhin `1.30.0`, und
   1.30.0 kennt das Feld nicht (P0 D0-5, im relevanten Code zeilengleich zu 1.29.0). Eine
   Anhebung braeuchte laut Plan einen Drei-Stellen-Diff als Beleg und loest T-15 trotzdem nicht.
2. **Keine Ablage unter `_meta`.** Der Rohtext zeigt das Feld top-level; `_meta` ist dort der
   **Laufzeit**-Kanal (`_meta["mcp/www_authenticate"]`, das ist T-14). Zwei Orte waeren zwei
   Wahrheiten.
3. **Keine per-Werkzeug unterschiedlichen Schemata und keine Scope-Namen.** Kein Werkzeug hat
   eine abweichende Auth-Anforderung; D0-7 hat belegt, dass nirgends ein Scope gelesen wird und
   der Anbieter nur generische Identitaets-Scopes fuehrt. Erfundene Scopes waeren eine
   Falschangabe.
4. **Kein T-14** (`_meta["mcp/www_authenticate"]` im Fehlerergebnis). D0-6 hat es als
   gegenstandslos geschlossen (401 faellt immer auf Transportebene); es gehoert zu P7. Siehe
   aber Widerspruch W8 — der Rohtext verlangt fuer die Verknuepfungs-UI **beide** Haelften.
5. **Kein Feature-Flag, keine Env-Variable.** Ein Schalter erzeugte einen vierten, nie
   gefahrenen Pfad fuer ein Metadatenfeld, das SDK-Clients ohnehin wegwerfen (Messung B). Damit
   entfaellt auch die Vier-Orte-Pflicht (`config.js`/`.env.example`/`render.yaml`/`BASE_ENV`).
6. **Kein Umbau von `registerTools()` und keine gemeinsame Server-Fabrik** fuer
   `routes/mcp.js` + `mcp-server.js`. Waere strukturell schoener (ein Andockpunkt statt zwei),
   ist aber ein eigener Umbau mit eigenem Risiko und nicht beauftragt (SCOPE). Der Naht-Pin aus
   Schritt 7 deckt die Luecke, die dadurch offen bleibt.
7. **Kein Oeffnen von `tools/list`/`initialize` fuer unauthentifizierte Aufrufe.** Der
   T-15-Wortlaut beschreibt das fuer *Mixed* Auth; wir fahren einheitliche Auth. `mcpAuth` wird
   nicht angefasst — das waere eine Aufweichung eines Gates.
8. **Kein Eintrag in `PLAN-SECURITY.md`.** Es aendert sich keine Durchsetzung: kein Gate, kein
   Token-Pfad, keine Route. Es entsteht eine **Beschreibung** der bestehenden Auth.
9. **Kein Deploy, kein echter ChatGPT-Verbindungsversuch, kein Anruf, keine SMS.**

---

## 5. Pre-Mortem — ein Jahr spaeter war P3 ein Fehler

1. *Der Override hat die Liste selbst gebaut.* `outputSchema` und die Zod-zu-JSON-Normalisierung
   gingen verloren; alle Tools liefen weiter, aber ohne Ausgabeschema — sechs Wochen unbemerkt.
   **Entschaerfung:** die Bauvorgabe (Original-Handler aufrufen, nur anreichern, Schritt 3) und
   AC2 **im selben Response** (Schritt 5.3): `outputSchema` genau 10 von 12, `inputSchema` als
   `type: "object"`.
2. *Ein SDK-Update hat `_requestHandlers` umbenannt.* Der Wurf aus E5 legte `/mcp` fuer alle
   Mandanten lahm (500), auch fuer den zahlenden Claude-Connector — wegen eines Feldes, das nur
   ChatGPT liest. **Entschaerfung:** `package-lock.json` haelt 1.29.0 und Renders `buildCommand`
   ist `npm install` gegen genau diesen Lock; der Lerntest aus Schritt 2 wird rot, bevor
   irgendetwas deployt wird; der Wurf ist deterministisch (nicht datenabhaengig) und faellt beim
   allerersten Aufruf. **Bewusst akzeptiert:** lauter Ausfall statt stiller Auslassung — eine
   stille Auslassung fuehrt laut Rohtext dazu, dass ChatGPT den Server-Default annimmt und
   Werkzeuge anonym aufruft.
3. *Der Beleg war `client.listTools()`.* Der Test war rot, jemand "reparierte" ihn, indem er die
   Erwartung abschwaechte — am Ende bewies er nur noch, dass ein Feld irgendwo existiert.
   **Entschaerfung:** Messung B ist als Lerntest (Schritt 2.3) festgeschrieben; alle Belege lesen
   rohes JSON-RPC-JSON.
4. *Das Feld wurde als Objekt statt als Array gesetzt* (so stehen Plan und P0), ChatGPT ignorierte
   es, die Einreichung fiel durch — und der Test war gruen, weil er exakt das erwartete, was der
   Code schrieb. **Entschaerfung:** die Erwartung steht als Literal aus dem **zitierten Rohtext**
   im Test, nie als Import aus `src`; §0.1 haelt das Zitat fest.
5. *stdio trug den Override nie.* `src/mcp-server.js` ist nicht importierbar, niemand merkte es,
   und beim naechsten Transportwechsel fehlte das Feld dort, wo es zaehlt. **Entschaerfung:**
   Naht-Pin Schritt 7 plus In-Memory-Beleg Schritt 6a.
6. *Wir haben `oauth2` deklariert, waehrend eine Instanz mit `MCP_AUTH=off` oder dem
   Legacy-localhost-Bypass lief* — ein Pruefer rief ein Werkzeug ohne Token auf und meldete eine
   Falschangabe. **Entschaerfung:** die Deklaration beschreibt die Produktionskonfiguration
   (D0-3: live laeuft der `oauth`-Zweig), `MCP_AUTH=off` traegt bereits einen Boot-Befund, und der
   Modulkommentar sagt ausdruecklich, worauf sich die Aussage bezieht. **Restrisiko bewusst
   akzeptiert** (E2).
7. *Der Override lief bei JEDEM `/mcp`-Request fuer JEDEN Mandanten und hat den Live-Connector
   beschaedigt.* **Entschaerfung:** Messung B zeigt, dass SDK-basierte Clients das Feld
   wegstrippen — fuer Claude aendert sich nachweislich nichts; der Override fasst ausschliesslich
   `result.tools` an und laesst Handler, Schemata und `_meta` unberuehrt.
8. *Die Phase galt als "fertig", weil `securitySchemes` da war — aber ChatGPT zeigte die
   Verknuepfung nie an,* weil die zweite Haelfte (T-14) fehlte. **Entschaerfung:** W8 steht unten
   ausdruecklich als offener Punkt fuer P7; P3 behauptet **nicht**, die OAuth-Verknuepfungs-UI zu
   liefern.

---

## 6. Widersprueche zwischen Plan/P0 und der eigenen Messung

| # | Widerspruch | Aufloesung |
|---|---|---|
| W1 | Plan (§Werte) und P0 (D0-5) nennen den Wert als **Objekt** `{"type":"oauth2","scopes":[]}`; das Abnahmekriterium 1 formuliert "traegt `{"type":"oauth2"}`". Der Rohtext zeigt an allen drei Fundstellen ein **Array**. | Gebaut wird das Array `[{type:"oauth2",scopes:[]}]`. AC1 wird sinngemaess geprueft: Array mit genau einem `oauth2`-Eintrag und leerer Scope-Liste. |
| W2 | P0 fuehrt U-1 (JSON-Pfad) als *indiziert, nicht belegt* (WebFetch-Zusammenfassung). | Selbst geladener Rohtext (HTTP 200, 462552 Bytes) mit drei Fundstellen — U-1 ist **geschlossen**: top-level, Geschwister von `annotations`/`_meta`. |
| W3 | Plan-Bauvorgabe: "nach `registerTools()` den `ListToolsRequestSchema`-Handler neu setzen ... ruft den urspruenglichen Handler auf". Der Plan sagt nicht, **wie** man an den urspruenglichen Handler kommt. | Gemessen: nur ueber das private `server.server._requestHandlers` (`setRequestHandler` ueberschreibt, `removeRequestHandler` gibt nichts zurueck). Preis benannt (E5), gepinnt (Schritt 2), lauter Wurf statt stillem Uebersprung. |
| W4 | Plan-DP-1 sagt, eine Aenderung in `registerTools()` genuege fuer beide Transporte. | Stimmt technisch, ist hier aber nicht baubar ohne stillen Uebersprung oder 14 angepasste Attrappen-Server. Entschieden: zwei Aufrufstellen + Naht-Pin (E4). |
| W5 | Plan: "Alle 12 Tools laufen hinter derselben Auth (`mcpAuth`, ein Mount-Punkt, `src/routes/mcp.js:112`)". | Mount-Punkt stimmt (heute `:110`), die **Strenge** haengt aber an `MCP_AUTH` (`oauth`/`token`/`""`/`off`). Die Deklaration wird trotzdem nicht aus der Konfiguration abgeleitet — Begruendung und Restrisiko in E2. |
| W6 | Plan laesst offen, ob stdio den Override traegt ("oder der Report haelt fest, dass stdio ihn bewusst nicht traegt"). D0-6 belegt, dass stdio **gar keine** Auth-Schicht hat — `oauth2` ist dort streng genommen unwahr. | Entschieden: stdio traegt denselben Wert (E3). Gruende: eine Wahrheit statt zweier, Betriebsregel "alle Pfade", und die Aussage ist ueber stdio inert (Messung B: SDK-Clients strippen das Feld). |
| W7 | Plan-Zeilenangabe `src/mcp-tools.js:657-667` fuer `registerTools()`. | Veraltet (P2 hat verschoben): `registerTools()` steht bei `:792`, `uiTool()` bei `:894`. Fuer P3 folgenlos, da `mcp-tools.js` nicht angefasst wird. |
| W8 | **Fund mit Wirkung ausserhalb P3:** der Rohtext sagt woertlich: *"Triggering the tool-level OAuth flow requires both metadata (securitySchemes and the resource metadata document) and runtime errors that carry `_meta["mcp/www_authenticate"]`. Without both halves ChatGPT will not show the linking UI for that tool."* P0/D0-6 hat T-14 als **gegenstandslos** geschlossen. | P3 liefert Haelfte eins; Haelfte zwei fehlt weiterhin. Das entwertet D0-6 nicht (der 401 faellt tatsaechlich vor jedem Tool), stellt aber die **Schlussfolgerung** in Frage, T-14 brauche keinen Ausloeser. **Gehoert zu P7**, nicht zu P3 — hier nur als UNKNOWN notiert: *ob ChatGPT ohne die zweite Haelfte die Verknuepfung anbietet, ist aus den Quellen nicht entscheidbar; der Text sagt fuer den Mixed-Auth-Fall nein.* |
| W9 | Plan-AC1 verlangt die Pruefung "am tatsaechlich ueber die Leitung gegangenen JSON". | Bestaetigt und verschaerft: **muss** so sein, weil der typisierte SDK-Client das Feld strippt (Messung B). Der Plan nennt diesen Grund nicht. |

---

## 7. UNKNOWN (mit Grund, nicht klaerbar ohne Owner/Anbieter)

- **U-P3-1:** Ob ChatGPT ein leeres `scopes: []` als "keine Scopes noetig" oder als
  unvollstaendige Angabe wertet. Der Rohtext sagt nur "include the scopes you will request so the
  consent screen is accurate" und zeigt im Beispiel selbst `"scopes": []`. Quelle sagt nicht mehr.
- **U-P3-2:** Ob die Einreichung `tools/list` ohne Auth erwartet. T-15 beschreibt das nur fuer
  Mixed Auth; ein eigener Anforderungspunkt existiert nicht. Nicht aus den Quellen entscheidbar.
- **U-P3-3:** W8 (Verknuepfungs-UI ohne die zweite Haelfte). Gehoert zu P7.
