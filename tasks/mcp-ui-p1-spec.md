# P1 Spec — MCP Rich-UI: duenne vertikale Scheibe (EIN Tool, EIN Host)

Umbrella: `docs/mcp-ui-strategy.md`. Ketten-Spec: `tasks/mcp-ui-chain.md` (autoritativ fuer Scope).
Status: **Spec, KEIN Code.** Phase laeuft (sobald gestartet) als gepinnter `phase-impl-lean`-Workflow,
Baseline `master`, dualer Review als hartes Gate (S1/S2 = Blocker).

## Voraussetzung (P0 muss entschieden sein)

- **Q4 erstes Widget = ENTSCHIEDEN**: `get_call_status` (read-only, kein Callback) — vom Owner
  bestaetigt.
- **Q5 Resource-Format = ENTSCHIEDEN**: P1-Referenz-Impl ist MCP-nativ (`ui://`-Resource, Claude MCP
  Apps); der Port bleibt host-abstrakt, aber der ChatGPT-Apps-Adapter kommt erst in P3.
- **Q2 Host-Erkennung = P0-Forschungsauftrag (keine Owner-Entscheidung)** — P0 belegt empirisch (Stand
  2026), welcher real existierende Host das `ui://`-Format rendert. Bis dahin fail-closed: unbekannt
  -> Stufe 0. P1 darf den Erkennungs-Mechanismus minimal halten (z.B. EIN expliziter Host-Hinweis),
  darf aber NIE fail-open werden.
- **Q3 Callback = ENTSCHIEDEN als Architektur-Invariante (greift erst in P4)**: Callbacks laufen ueber
  den authentisierten `/mcp`+`mcpAuth`-Eingang, kein offener Postback. In P1 **nicht relevant**
  (Widget ist read-only, kein Tool-Callback).

## P0-Befund (2026-06-26, BELEGT mit Quellen — konkretisiert Q5/Q2)

P0 hat den realen Stand geklaert: Es existiert ein offizieller, von Anthropic UND OpenAI getragener
Standard **SEP-1865 "MCP Apps"** (`modelcontextprotocol/ext-apps`, Spec-Version `2026-01-26`, in die
Spec-RC `2026-07-28` gefaltet). Claude (Web + Desktop) rendert `ui://`-HTML real, gesandboxt in einer
permission-gated Iframe. Das ersetzt die folgenden urspruenglichen Spec-Annahmen durch den
belegten Standard-Vertrag — **P1 baut gegen SEP-1865, nicht gegen eine Eigenkonstruktion**:

- **mimeType der Resource = exakt `text/html;profile=mcp-app`** (SDK-Konstante `RESOURCE_MIME_TYPE`).
  NICHT `text/html`, NICHT `text/html+skybridge` (letzteres ist OpenAI-Apps-SDK, kommt in P3).
- **Tool->Resource-Verknuepfung = `_meta.ui.resourceUri`** am Tool-Deskriptor, zeigt auf die
  `ui://`-Resource. (`_meta["openai/outputTemplate"]` ist nur ChatGPT-Kompat-Alias -> P3.)
- **Einbettungs-Modell = resource-template-basiert, NICHT "Resource-Block neben dem Text".** Der Tool-
  Handler haengt der Antwort KEINEN Resource-Content-Block an. Stattdessen: das Tool deklariert vorab
  `_meta.ui.resourceUri`, der Host holt die Resource per `resources/read` (Preload) und rendert sie;
  das Tool-Result (Stufe 0: `text`+`structuredContent`) wird der App per Notification gepusht. Das
  korrigiert den Datenfluss in Abschnitt 3/4 unten (siehe dort die Klammer-Hinweise).
- **Host-Erkennung (Q2) = GELOEST, sauberer Laufzeit-Mechanismus:** Der Client deklariert im
  `initialize`-Handshake die Capability `capabilities.extensions["io.modelcontextprotocol/ui"]` mit
  REQUIRED-Feld `mimeTypes: [...]`. Der Server prueft per SDK-Helper `getUiCapability()`, ob
  `text/html;profile=mcp-app` enthalten ist. Faehig -> UI-Tool mit `_meta.ui.resourceUri` registrieren;
  nicht-faehig / Capability fehlt -> text-only (Stufe 0). Das IST das fail-closed-Muster. Ein expliziter
  Config-Override bleibt als zusaetzliches Sicherheitsnetz erlaubt, ist aber nicht mehr der
  Primaer-Mechanismus.
- **SDK:** `@modelcontextprotocol/ext-apps` (`registerAppTool`, `registerAppResource`,
  `RESOURCE_MIME_TYPE`, `getUiCapability`). **OWNER-ENTSCHEIDUNG 2026-06-26: KEIN Dep — Option A
  (schlank nachbilden).** Der Vertrag wird ohne `@modelcontextprotocol/ext-apps` ueber das bereits
  vorhandene Core-`@modelcontextprotocol/sdk` nachgebildet: eine Konstante
  `UI_MIME = "text/html;profile=mcp-app"` + den `ui://`-URI, ein `supportsUi(clientCapabilities)`-
  Lookup in `capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes`, Resource-Registrierung
  und `_meta.ui.resourceUri` ueber das vorhandene `McpServer`-API. Begruendung: treu zur Repo-Regel
  "wenige Dependencies", junges SDK auf dem Sicherheits-(fail-closed-)Pfad vermeiden, Vertrag ist
  klein und der `UiRenderer`-Port kapselt ihn ohnehin. Nachruesten in P2/P3 bleibt moeglich.
- **Caveat (untermauert fail-closed):** Mehrere offene Claude-Render-Bugs (Apr-Mai 2026, Iframe-
  Handshake startet nach Tool-Call teils nicht, App bleibt blank). Daher MUSS Stufe 0 immer
  eigenstaendig vollwertig sein; Live-Render in Claude ist ein Smoke-Gate, kein Test-Ersatz.

Quellen: blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/ ; modelcontextprotocol.io/extensions/apps/{overview,build} ;
github.com/modelcontextprotocol/ext-apps (spec `2026-01-26/apps.mdx`) ; SEP-1865 PR ; developers.openai.com/apps-sdk/reference .

## 1. Ziel

Beweise die gesamte Zwei-Stufen-Architektur an EINEM read-only-Tool end-to-end:

1. Das Tool gibt **Stufe 0** zurueck: `content[{type:'text'}]` (wie heute) **plus**
   `structuredContent` (schema-validierte Daten).
2. Das Tool haengt **Stufe 1** an: eine `ui://`-UI-Resource (MCP-nativ), erzeugt ueber den neuen
   `UiRenderer`-Seam aus den bereits gefilterten Stufe-0-Daten.
3. EIN faehiger Host rendert die Resource (Widget = `design-system/mcp/call-status.html`-Entwurf).
4. Ein nicht-faehiger Host bekommt **keine** Resource und faellt automatisch auf Stufe 0 zurueck
   (getestet).

Wenn P1 steht, sind Seam, Fallback, Daten-Kontrakt und Token-Wiederverwendung bewiesen; alle
weiteren Widgets/Hosts sind Verbreiterung ohne Architektur-Risiko.

## 2. Welches Tool

**`get_call_status`** (`src/mcp-tools.js:136-151`). Begruendung:
- read-only -> **kein Callback**, kleinste Angriffsflaeche (Q3 entfaellt in P1).
- Existierender Widget-Entwurf `design-system/mcp/call-status.html` (Zeile 1 `@dsCard`).
- Klare, kleine Datenform: `{status, duration_s, last_transcript_lines}` -> leicht zu whitelisten.
- Kein DSGVO-Purge-Konflikt wie bei `get_transcript` (das kommt in P2).

## 3. Stufe-0-Basis (Pflicht, additiv)

- Der heutige Text-Pfad (`{content:[{type:'text', text:...}]}`) bleibt **erhalten** (Legacy/stdio
  byte-kompatibel).
- Zusaetzlich: `structuredContent` mit den **gewhitelisteten** Feldern (Abschnitt 5). Das ist die
  Single Source of Truth; Text und Widget sind Sichten darauf.
- **Impl-Hinweis (MCP):** `structuredContent` ist nur dann echt schema-validiert, wenn das Tool bei
  der Registrierung ein `outputSchema` deklariert. Ohne `outputSchema` ist es ein unvalidiertes
  Objekt. P1 deklariert daher fuer `get_call_status` ein `outputSchema` ueber genau die Whitelist
  (Abschnitt 5), damit "schema-validiert" nicht nur Prosa ist.
- Fehlerform bleibt `{..., isError:true}` mit generischem, provider-freiem Text (`requireFields`,
  `src/mcp-tools.js:39-64, 89-99`). Bei Fehler: KEINE UI-Resource.

## 4. Seam-Skelett (Port/DIP, analog `src/telephony/`)

Konzeptionelle Schnittstelle (Impl im Workflow, hier nur Form):

- Ein `UiRenderer`-Port mit (konzeptionell):
  - `supports(hostHint) -> bool`
  - `renderResource(widgetId, filteredData) -> resourceBlock | null` (`null` = nicht faehig)
- Eine Registry (analog `src/telephony/registry.js`), die anhand des Host-Hinweises (Q2) genau
  EINEN Renderer waehlt; unbekannt -> `null` (Stufe 0).
- EIN MCP-nativer Adapter (`ui://`-Resource) — der Kern. KEIN ChatGPT-Adapter in P1 (das ist P3).

Datenfluss im Handler (siehe Strategie-Doc Abschnitt 3, **korrigiert durch P0-Befund**):
`structuredData -> Whitelist-Filter -> text + structuredContent (Stufe 0, immer)`. Stufe 1 wird
NICHT als Resource-Block an das Tool-Result gehaengt, sondern ueber den Seam als **registrierte
`ui://`-App-Resource** bereitgestellt und am Tool-Deskriptor per `_meta.ui.resourceUri` referenziert —
NUR wenn die Client-Capability `io.modelcontextprotocol/ui` (mimeType `text/html;profile=mcp-app`)
vorhanden ist (sonst kein `_meta.ui.resourceUri`, text-only). Der Whitelist-Filter sitzt VOR Text und
Resource (eine Filter-Stelle). Die Resource liest dieselben gefilterten Stufe-0-Daten, keine zweite
Datenquelle.

Seam minimal halten: nur so viel Port wie `get_call_status` braucht. Keine Renderer-Plugin-
Maschinerie, keine generische Template-Engine auf Vorrat (Regel 6 / kein BDUF).

## 5. Daten-Kontrakt (Whitelist) fuer get_call_status

Erlaubt ins `structuredContent`/Widget (NUR diese):
- `call_id`
- `status` (bereits normalisiert: active+answeredAt -> in_progress, active+!answeredAt -> dialing)
- `duration_s`
- `last_transcript_lines` **nur sofern noch vorhanden** (nie persistieren, nie aus geloeschtem
  Roh-Transkript rekonstruieren).

Verboten: Secrets/Keys/Tokens, Provider-Interna, Roh-Gateway-Responses, fremde Tenant-Daten,
Klartext-Identitaet/`email`, Audio/Stream-URLs. Tenant-Isolation kommt aus der bestehenden Kette
(`identity -> profile -> X-Internal-Identity -> requestTenant`, fail-closed); P1 fuegt nur den
Filter NACH der Tenant-Aufloesung hinzu, umgeht sie NIE.

## 6. Token / CSS

- Widget nutzt `design-system/_shared/tokens.css` (kanonisch, aus `apps/web/src/styles/tokens/`).
  **Kein zweiter Token-Satz.**
- Self-contained: KEIN `@import`, kein Linkback ins Mono-Repo (Iframe-Sandbox-Constraint, identisch
  zum claude.ai/design-Gate, `design-system/README.md:21-30`). Token-Variablen werden inline
  gebuendelt.
- `@dsCard`-Marker in Zeile 1 bleibt (DesignSync-Index).

## 7. Akzeptanzkriterien

- **AC1 (Stufe 0 additiv):** `get_call_status` gibt weiterhin einen `{type:'text'}`-Block UND neu
  `structuredContent` mit exakt den gewhitelisteten Feldern zurueck. Bestehende Text-Erwartungen
  bleiben gruen. Das Tool deklariert dazu ein `outputSchema` ueber genau die Whitelist (Abschnitt 5)
  — nur so ist `structuredContent` MCP-seitig wirklich schema-validiert (siehe Impl-Hinweis
  Abschnitt 3), nicht bloss ein freies Objekt.
- **AC2 (Stufe 1):** Bei faehigem Host (Capability `io.modelcontextprotocol/ui` mit mimeType
  `text/html;profile=mcp-app` im `initialize`) wird genau EINE `ui://`-App-Resource registriert und am
  Tool per `_meta.ui.resourceUri` referenziert, erzeugt ueber den Seam; mimeType exakt
  `text/html;profile=mcp-app`.
- **AC3 (Fallback, KERN-TEST):** Bei nicht-faehigem / unbekanntem Host (Capability fehlt oder enthaelt
  `text/html;profile=mcp-app` nicht) wird KEINE Resource registriert und KEIN `_meta.ui.resourceUri`
  gesetzt; Stufe 0 (Text+structuredContent) ist vollstaendig und unveraendert. Fail-closed:
  unbekannter Host wird wie nicht-faehig behandelt.
- **AC4 (Whitelist, SICHERHEITS-TEST):** Ein Test beweist, dass nicht-gewhitelistete Felder weder
  im `structuredContent` noch in der Resource auftauchen (insbesondere keine Secrets/Identitaet/
  fremde Tenant-Daten).
- **AC5 (Fehlerpfad):** Bei Tool-Fehler `isError:true`, generischer Text, KEINE Resource.
- **AC6 (Token self-contained):** Widget-Resource enthaelt kein `@import` und keinen Mono-Repo-
  Linkback; `@dsCard`-Marker vorhanden.
- **AC7 (Auth unberuehrt):** `/mcp` bleibt hinter `mcpAuth`; kein neuer offener Endpunkt; stateless-
  Cleanup (`res.on('close')`) unberuehrt.
- **AC8 (Legacy/stdio):** stdio-Pfad (identity=null -> Owner-Profil) funktioniert unveraendert;
  Stufe 0 byte-kompatibel zum heutigen Text, soweit Tests es pruefen.

## 8. Test-Anforderungen (node:test, ohne Netz/.env)

- Unit/Integration fuer AC1-AC6 (Seam, Fallback, Whitelist, Fehlerpfad, self-contained).
- Fallback-Test (AC3) und Whitelist-Test (AC4) sind **Pflicht** und blockierend.
- Keine echte Telefonie/kein echter Host noetig: Host-Faehigkeit ueber den Host-Hinweis (Q2)
  simulieren (faehig vs. nicht-faehig vs. unbekannt).
- Lokaler Smoke optional fuer das visuelle Rendern (claude.ai/design-Preview des `call-status.html`).
- `node --check` der geaenderten Dateien; `npm test` gruen.

## 9. Bewusste Auslassungen (NICHT in P1)

- KEIN Callback/Schreib-Widget (das ist P4, hartes Gate).
- KEIN zweiter Host-Adapter / ChatGPT Apps SDK (P3).
- KEINE weiteren Widgets (`call-result`, `transcript`, `agent-status` -> P2/spaeter).
- KEINE generische Template-/Plugin-Maschinerie, kein neuer npm-Dep ohne Spec-Freigabe.
- KEIN Token-Sync-Automatismus/CI-Gate (das ist P5); in P1 nur manueller self-contained-Check.
- KEINE Aenderung am Call-Pfad / an der Offenlegung / an den Safety-Gates.
