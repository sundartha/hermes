# MCP Rich-UI Strategie

Status: **Kette P0-P5 implementiert & gemergt (Stand 2026-06-27, lokal `master`).** Aktueller
Stand + Restarbeit (v.a. die offene Client-Verdrahtung) in `tasks/mcp-ui-chain.md` (autoritativ,
siehe auch Abschnitt 7). Dieses Doc beschreibt das WARUM und das Zielbild (Architektur/Seam/
Sicherheits-Kontrakt) als bleibende Referenz.

Bezug zu CLAUDE.md: Hermes will diesen Assistenten Millionen Menschen zugaenglich machen. Rich-UI
im Chatbot-Host ist ein Distributions-Hebel (der MCP-Connector ist ein erstklassiger Einstieg in
Claude/ChatGPT), darf aber die absoluten Regeln (Safety-Gates, Offenlegung, Auth fail-closed,
Secrets, Audio-nie-durch-MCP, Scope) NICHT beruehren. Das ist der Kern dieses Dokuments.

---

## 1. Kontext / Ist-Stand (Grounding)

Der MCP-Server exponiert heute **8-9 Tools** ueber zwei Transporte (stdio `npm run mcp` und
HTTP Streamable `/mcp`). Alle Tools geben **ausschliesslich Text** zurueck:

- Normalform: `{ content: [{ type: 'text', text: ... }] }`
- Fehlerform: `{ content: [{ type: 'text', text: ... }], isError: true }`
- Quelle: `src/mcp-tools.js:101-260` (Registrierung + Handler).

Tools (Grounding `src/mcp-tools.js`): `place_call` (`:101-134`, liefert sofort
`{call_id, status:'dialing'}`), `get_call_status` (`:136-151`, `{status, duration_s,
last_transcript_lines}`, ~10s-Poll), `get_transcript` (`:153-176`, nach Gespraechsende
`{transcript:[{role,text,t}], result_summary, objective_achieved}`), `cancel_call`,
`get_my_number`, `list_calls`, `list_action_items`, `get_calendar` (optional, nur bei
`allowCalendar=true`, `:77-81, 233-243`), `get_agent_status`.

**Auth/Tenant-Kette** (`src/server.js:1532-1554`, `src/auth.js:85-106`): `/mcp` laeuft hinter
`mcpAuth` (Modi `oauth` JWT-Verif / `token` Bearer / `off`; Legacy-Fallback localhost-only ohne
Token; RFC 6750/9728 `WWW-Authenticate`). `req.auth = {sub,email,claims}` oder `null`.
`identity = req.auth.email || req.auth.sub || ANON_IDENTITY || null`. `profile =
store.resolveProfile(identity)` setzt das Berechtigungsprofil (`allowCalendar`, `allowedNumbers`,
...). `identity` wird via `X-Internal-Identity`-Header an jeden REST-Call zum Gateway gehaengt
(`src/mcp-tools.js:11-22`), darueber kennt das Gateway den Aufrufer und loest `requestTenant`
fail-closed auf (`TENANT_REJECT` bei Ambiguitaet; `OWNER_ID`/`ANON_IDENTITY` sind Sentinels, nie
`null` -> kein Owner-Fallback-open).

**Schutzschichten bereits vorhanden** (gilt es zu erben, nicht neu zu bauen):
`requireFields`-Result-Guard (`src/mcp-tools.js:39-64, 89-99`, Typ-/Existenz-Check vor Deref,
generische provider-freie Fehlertexte), per-Handler try/catch (`:84-99`, keine process-level
unhandled rejection), PII-Hashing im `[mcp]`-Log (`hashEmail`, `src/server.js:1538-1543`),
**DSGVO-Purge**: das Roh-Transkript wird nach der Summary bewusst geloescht — die Purge passiert
UPSTREAM (P8a-Logik im Call-/Store-Pfad), NICHT im Tool-Handler; `get_transcript` (`:153-176`)
mappt nur `c.transcript`, das bei `completed`-Calls dann bereits leer ist.

**Design-Mockups (heute nicht verdrahtet):** vier reine HTML-Entwuerfe unter
`design-system/mcp/`: `call-result.html` (`place_call`), `call-status.html` (`get_call_status`),
`agent-status.html` (`get_agent_status`), `transcript.html` (`get_transcript`). Jeder traegt in
Zeile 1 den `@dsCard`-Marker (DesignSync-Index fuer claude.ai/design) und die explizite Notiz
"the live MCP returns plain text today; this is how a rich card could render"
(`design-system/mcp/call-result.html:13`, `design-system/README.md:46-51`).

**Tokens:** `design-system/_shared/tokens.css` ist die **kanonische, self-contained Kopie** der
Quelle `apps/web/src/styles/tokens/{primitives,semantic,hero}.css` (Light=`:root`,
Dark/Hero=`.on-dark`-Scope). Self-contained ist ein HARD GATE — kein `@import`, kein Linkback ins
Mono-Repo, weil claude.ai/design die Previews offline/isoliert rendert
(`design-system/README.md:21-30`, `_shared/preview.css`).

**Fazit Ist-Stand:** Die Daten existieren, die Auth-/Tenant-/PII-Schutzkette existiert, die
Design-Tokens existieren, vier Widget-Entwuerfe existieren. Was fehlt, ist (a) ein zweiter
Rueckgabe-Kanal (strukturierte Daten + UI-Resource) und (b) ein Host-abstrakter Seam, der die
UI-Resource in der jeweiligen Host-Konvention ausliefert. Mehr nicht — das ist der Scope.

---

## 2. Zwei-Stufen-Modell (Progressive Enhancement)

### Warum es KEIN universelles MCP-UI gibt

MCP standardisiert das **Tool-Protokoll**, nicht das **Rendering**. Hosts unterscheiden sich
fundamental in dem, was sie aus einer Tool-Antwort machen koennen:

- Reine LLM-/CLI-/IDE-Hosts und Agenten-Workflows (z.B. ein Skript, Gemini-Tooling, ein
  CI-Agent) konsumieren **nur Text/strukturierte Daten** — sie haben keinen Renderer und keine
  Iframe-Sandbox.
- Rich-faehige Hosts (ChatGPT Apps SDK, Claude MCP-Apps) koennen eine **UI-Resource** in einer
  gesandboxten Iframe-Komponente rendern und erlauben dem Widget, Tools **zurueckzurufen**.

Ein einziges Rendering-Format, das ueberall identisch funktioniert, existiert nicht und ist nicht
in Sicht (offene Frage Q1: Konvergenz der Host-Konventionen). Wer auf "ein UI fuer alle" wartet,
liefert nie. Antwort darauf ist Progressive Enhancement.

### Stufe 0 — universell, immer (Pflicht)

**Jedes Tool gibt IMMER zurueck: (a) `content[{type:'text'}]` wie heute UND (b)
`structuredContent`** (maschinenlesbares, schema-validiertes Objekt der gleichen Daten). Das ist
der universelle Vertrag: Gemini, IDEs, CLI, jeder Agenten-Workflow funktioniert wie bisher bzw.
besser (strukturierte Daten statt nur Prosa). Stufe 0 ist die **Quelle der Wahrheit**; die Rich-UI
zeigt nie etwas an, das nicht in `structuredContent` steht.

Wichtig: Stufe 0 ist eine **additive** Erweiterung der heutigen Text-Antwort, keine Ablausung. Der
heutige `{type:'text'}`-Pfad bleibt erhalten (Backward-Compat fuer Legacy/stdio).

### Stufe 1 — optionale Rich-UI-Resource (nur faehige Hosts)

Zusaetzlich haengt das Tool eine **UI-Resource** an (MCP-nativ: eine `ui://`-Resource bzw. ein
Resource-Content-Block neben dem Text). Faehige Hosts rendern sie in ihrer Sandbox; alle anderen
**ignorieren sie und fallen automatisch auf Stufe 0 (Text/structuredContent) zurueck**. Der
Fallback ist kein Sonderpfad, sondern die natuerliche Folge davon, dass die Daten immer in
Stufe 0 vollstaendig vorliegen.

**Invariante:** Stufe 1 darf NIE Daten enthalten, die nicht auch in Stufe 0 stehen, und NIE Daten,
die der Daten-Kontrakt (Abschnitt 5) fuer das Tool verbietet. Das Widget ist eine Sicht auf
Stufe-0-Daten, keine zweite Datenquelle.

---

## 3. Seam-Architektur (Port/DIP, analog Telefonie)

Genau wie die Telefonie ueber Ports von den Providern entkoppelt ist (`src/telephony/ports.js`
Schnittstellen, `registry.js` Dispatch nach Provider, Adapter `adapters/twilio/*` und
`adapters/telnyx/*`), soll Rich-UI ueber einen **Host-abstrakten Seam** von den Host-Konventionen
entkoppelt werden. Der Kern bleibt **MCP-nativ** (eine `ui://`-Resource); die ChatGPT-Apps-Variante
ist EIN Renderer/Adapter daneben, nicht der Kern.

### Konzeptionelle Port-Schnittstelle (keine Implementierung)

Ein `UiRenderer`-Port (analog `ports.js`) beantwortet konzeptionell:

- `supports(host) -> bool` — kann dieser Host Rich-UI? (sonst: kein Resource-Block, Stufe-0-only)
- `renderResource(widgetId, structuredData) -> resourceBlock | null` — erzeugt den
  host-spezifischen Resource-Content-Block aus den **bereits gefilterten** Stufe-0-Daten.
  Rueckgabe `null` = Host nicht faehig -> Aufrufer haengt nichts an (Fallback).
- Optional: Metadaten zur Resource (MIME, `ui://`-URI-Schema, Templating-Konvention) bleiben im
  Adapter gekapselt.

Eine `registry`-Ebene (analog `telephony/registry.js`) waehlt den Renderer anhand eines
Host-Hinweises. **Wichtige offene Frage Q2:** Wie wird der Host erkannt? Kandidaten: ein Header/
Capability-Feld im MCP-Initialize-Handshake, eine Client-Info, oder ein Config-Schalter pro
Connector. Bis das geklaert ist, gilt fail-closed: **unbekannter Host -> kein Resource-Block ->
Stufe 0**. Nie Rich-UI an einen Host schicken, von dem wir nicht wissen, dass er sie sandboxed.

### Datenfluss

```
Tool-Handler
  -> baut structuredData (Stufe 0)         [eine Quelle der Wahrheit]
  -> Daten-Kontrakt-Filter pro Tool        [Abschnitt 5: Whitelist, PII/Tenant/Secrets]
  -> text = renderText(structuredData)      [heutiger {type:'text'}-Pfad, bleibt]
  -> resource = uiRenderers.renderResource(widgetId, filteredData)  [null wenn Host nicht faehig]
  -> return { content: [text, ...(resource ? [resource] : [])], structuredContent: filteredData }
```

Der Filter sitzt **vor** beiden Renderern, nie nur vor der UI. Text, `structuredContent` und
Widget sehen exakt dieselbe, bereits bereinigte Sicht.

### Warum diese Form skaliert

Neue Hosts = neuer Adapter hinter dem Port (wie ein neuer Telefonie-Provider). Neue Widgets =
neuer `widgetId` + Template, ohne den Seam zu aendern. Der Kern (`mcp-tools.js`) kennt nur den
Port, nie ChatGPT-/Claude-Spezifika. Das ist dieselbe DIP-Disziplin wie in CLAUDE.md Abschnitt
"Architektur" gefordert: "Neue Telefonie-/Provider-Logik laeuft ueber die Ports, NICHT direkt im
Server" — analog hier fuer UI.

---

## 4. Token-Strategie (kein zweiter Token-Satz)

Die Widgets verwenden die **kanonischen Tokens** aus `design-system/_shared/tokens.css` (Quelle
`apps/web/src/styles/tokens/`). Es wird **kein zweiter Token-Satz** angelegt — die vier Mockups
nutzen sie bereits, sie sind die Single Source of Truth fuer Farben/Spacing/Radii/Shadows/
Typografie/semantische Rollen.

**Was bereits geloest ist und was nicht (Praezisierung, kein Ueberverkauf):** Die Token-WERTE sind
kanonisch vorhanden und stabil (`design-system/_shared/tokens.css`) — Wiederverwendung statt eines
zweiten Satzes bleibt richtig. **Aber das Inlinen/Buendeln in die Resource ist neue Arbeit.** Die
vier Mockups binden die Tokens NICHT inline ein, sondern per `<link rel="stylesheet"
href="../_shared/tokens.css">` (siehe `design-system/mcp/call-status.html:8`). Das traegt in der
claude.ai/design-Preview, weil dort `_shared/` daneben liegt; eine `ui://`-Resource im
Iframe-Sandbox eines Rich-UI-Hosts hat diesen Pfad NICHT und braucht einen echten
Inlining-/Bundle-Schritt (Token-Variablen inline in die Resource gebuendelt). So sagt es auch
`tasks/mcp-ui-p1-spec.md` Abschnitt 6 korrekt.

**Warum die Iframe-Sandbox self-contained-CSS ohnehin erzwingt:** Rich-UI-Hosts rendern das Widget
in einer **gesandboxten Iframe** ohne Zugriff auf das Mono-Repo oder externe Stylesheets — exakt
dieselbe Constraint, die claude.ai/design schon stellt (offline-Preview, kein Linkback,
`design-system/README.md:21-30, 30`). Das self-contained-CSS-Gate (kein `@import`/`@link`, Tokens
inline gebuendelt) ist damit dieselbe Disziplin, die das Design-System schon kennt — die WERTE sind
da, das Inlinen pro Resource bleibt aber ein Arbeitsschritt der jeweiligen Phase.

**Drift-Risiko (bereits dokumentiert):** Aendert sich `apps/web/src/styles/tokens/`, MUSS
`_shared/tokens.css` nachgezogen werden, sonst driften Widgets vom realen Web-UI ab. Das ist eine
bestehende Pflege-Pflicht (`README.md:21-30`), kein neues Problem — aber die Kette muss sie als
Akzeptanzkriterium fuehren (DesignSync `@dsCard`-Index bleibt gruen).

---

## 5. Sicherheits- / Daten-Kontrakt (Fundament, nicht Nachgedanke)

Widgets laufen in einer Iframe, **zeigen Daten an UND koennen Tools zurueckrufen**. Damit ist
Rich-UI eine neue Angriffs-/Leck-Flaeche. Der Daten-Kontrakt wird PRO TOOL definiert und vor jeder
Phase festgeschrieben. Mapping auf die absoluten Regeln aus CLAUDE.md:

### 5.1 Daten-Kontrakt pro Tool (Whitelist, nicht Blacklist)

Fuer jedes Tool mit Widget wird **explizit aufgelistet, welche Felder ins Widget/`structuredContent`
duerfen** (Whitelist). Alles andere fliegt raus. Leitlinien aus dem Grounding:

- **`get_transcript`:** Roh-Transkript wird serverseitig nach der Summary GELOESCHT (DSGVO
  Datenminimierung) — die Purge passiert UPSTREAM (P8a-Logik), NICHT im Handler; `get_transcript`
  (`mcp-tools.js:153-176`) mappt nur `c.transcript` (bei `completed` bereits leer). Ein Widget darf
  **niemals Roh-Gespraechsdaten
  persistieren oder rekonstruieren** — nur `result_summary` + `objective_achieved`. Das Widget hat
  keinen eigenen Speicher fuer PII. (Regel 5 AUDIO/Transkript-Disziplin, DSGVO.)
- **`place_call` / `get_call_status`:** `call_id`, `status` (normalisiert), `duration_s`, ggf.
  `last_transcript_lines` nur sofern noch nicht gepurged. Keine vollstaendigen Roh-Mitschnitte.
  *Warum `last_transcript_lines` trotz Pre-Mortem #1 erlaubt ist:* es ist der EIGENE aktive Call
  DESSELBEN Tenants (kein Cross-Tenant, kein fremder Datensatz), und genau dieselben Zeilen fliessen
  schon heute durch den Text-Pfad (`get_call_status`, `mcp-tools.js:136-151`). Das Widget ist nur
  eine zweite Sicht auf bereits offengelegte Eigen-Daten — daher KEIN Leck im Sinne von Pre-Mortem
  #1 (das Cross-Tenant- bzw. fremde Daten meint), solange der Tenant-Filter (5.2) davor sitzt.
- **Nummern:** nur Nummern, die dem aufrufenden Tenant gehoeren (`get_my_number`/
  `allowedNumbers`). Nie fremde Tenant-Nummern, nie die Owner-/Provider-Interna.

### 5.2 PII / Tenant-Isolation

- Die **Auth-Tenant-Kette ist CRITICAL** (Abschnitt 1): `identity -> profile -> registerTools ->
  X-Internal-Identity -> Gateway`. Eine gebrochene Kette faellt heute auf Owner-Verhalten zurueck
  (Grounding-Implikation). Rich-UI darf diese Kette **nicht umgehen**: die Daten im Widget sind
  exakt die, die der bereits aufgeloeste Tenant/Profile sehen darf. Der Daten-Kontrakt-Filter
  (Abschnitt 3) sitzt NACH der Tenant-Aufloesung.
- `allowCalendar` (Profil-Gate) MUSS wie heute VOR `registerTools` aufgeloest sein; ein
  Calendar-Widget existiert nur, wenn das Tool registriert ist.
- PII-Hashing im Log (`hashEmail`) bleibt; Widget-Pfade duerfen keine Klartext-Identitaet loggen.

### 5.3 Widget-Callbacks (Tools zurueckrufen)

- Ein Widget-Callback ist **ein normaler MCP-Tool-Call** und durchlaeuft denselben `/mcp`-Eingang
  mit `mcpAuth` + Tenant-Aufloesung + Safety-Gates. Es gibt **keinen privilegierten Seitenkanal**.
  Insbesondere: ein "Call jetzt starten"-Button im Widget loest `place_call` aus, das durch ALLE
  Safety-Gates geht (Allowlist/Denylist/Land/Stundenlimit/Budget global+pro-Tenant/Max-Dauer/
  Signaturpruefung) — **Regel 1, unberuehrt**. (Offene Frage Q3: bestaetigen, dass der
  Host-Callback denselben authentisierten `/mcp`-Eingang nutzt und kein unauthentisierter
  Postback-Kanal existiert.)
- **Regel 2 Offenlegung:** der Offenlegungssatz bleibt fest verdrahtet im Call-Pfad
  (`disclosureSentence`, claude.js/bridge.js). Kein Widget-Setting kann ihn abschalten. Rich-UI
  beruehrt den Call-Pfad nicht.

### 5.4 Auth fail-closed am /mcp-Eingang & Secrets

- **Regel 3:** `/mcp` bleibt hinter `mcpAuth` (OAuth/Token/localhost). Rich-UI fuegt KEINEN neuen
  unauthentisierten Endpunkt hinzu. Der HTTP-Streamable-Transport ist stateless (jeder POST = neue
  McpServer-Instanz, `res.on('close')`-Cleanup essentiell gegen Memory-Leak) — Widget-Resources
  duerfen daran nichts aendern.
- **Regel 4 Secrets:** Keine Keys/Tokens/Bearer/Provider-Interna ins `structuredContent` oder ins
  Widget. Fehlertexte bleiben generisch und provider-frei (`requireFields`,
  "Telefon-Agent hat keine gueltige Antwort geliefert"). Ein Widget zeigt nie Roh-Gateway-
  Responses.
- **Regel 5 AUDIO:** Audio laeuft nie durch MCP — gilt erst recht fuers Widget (nur Transkript/
  Status/Summary, nie Audio-Bytes/Stream-URLs).

### 5.5 Mapping-Tabelle (absolute Regeln)

| CLAUDE.md-Regel | Rich-UI-Konsequenz |
| --- | --- |
| 1 Safety-Gates | Widget-Callbacks = normale Tool-Calls, ALLE Gates greifen; kein Seitenkanal |
| 2 Offenlegung | Call-Pfad unberuehrt; kein Widget-Setting schaltet Disclosure ab |
| 3 Auth fail-closed | `/mcp`+`mcpAuth` bleibt; kein neuer offener Endpunkt; unbekannter Host -> Stufe 0 |
| 4 Secrets | Whitelist-Filter; keine Keys/Provider-Interna in structuredContent/Widget; generische Fehler |
| 5 Audio nie durch MCP | Widget zeigt nur Transkript/Status/Summary, nie Audio |
| 6 Scope | Pro Phase EIN Widget/Host; keine BDUF-UI-Maschinerie vor dem ersten sichtbaren Widget |
| 7 Debug | Seam/Fallback ueber Tests + lokalen Smoke beweisen, nicht raten |

---

## 6. Pre-Mortem (ein Jahr spaeter, Entscheidung war falsch)

1. **Daten-Leck ueber das Widget.** Ein Widget zeigt ein Feld an, das im `structuredContent`
   "mitgerutscht" ist (z.B. fremde Tenant-Daten, ein Roh-Transkript-Fragment, eine interne ID).
   Gemeint ist hier explizit **Cross-Tenant- bzw. fremder/zusaetzlich offengelegter Datensatz** —
   NICHT das `last_transcript_lines` des eigenen aktiven Calls, das schon heute durch den Text-Pfad
   geht (siehe 5.1; gleicher Tenant, keine neue Offenlegung).
   *Wurzel:* Blacklist statt Whitelist, Filter nur vor der UI statt vor allen Renderern.
   *Gegenmassnahme:* Whitelist pro Tool (5.1), EIN Filter VOR Text/structured/Widget (3), Test der
   beweist dass nicht-gewhitelistete Felder fehlen.

2. **Fallback bricht, Stufe-0-Hosts sehen nichts mehr.** Ein nicht-faehiger Host bekommt einen
   Resource-Block, den er nicht rendern kann, und zeigt Leere/Fehler statt Text. *Wurzel:* Rich-UI
   wurde Pflicht statt additiv; Host-Erkennung fail-open. *Gegenmassnahme:* Stufe 0 IMMER zuerst
   und vollstaendig; unbekannter Host -> kein Resource-Block (fail-closed, Q2); expliziter
   Fallback-Test (P1-Akzeptanzkriterium).

3. **Widget-Callback umgeht ein Safety-Gate.** Ein "Anrufen"-Button loest einen Call ueber einen
   Host-Postback aus, der nicht durch `mcpAuth`/Gates lief -> ungewollter Anruf / Kosten-Explosion
   / Toll-Fraud. *Wurzel:* angenommen statt verifiziert, dass Callbacks denselben Eingang nutzen.
   *Gegenmassnahme:* Q3 vor P1 klaeren; Callback = normaler authentisierter Tool-Call; Gate-Tests
   gelten unveraendert; Budget global+pro-Tenant bleibt Schnittmenge (Regel 1).

4. **Token-Drift: Widgets sehen anders aus als das Web-UI / DesignSync 404.** `apps/web`-Tokens
   aendern sich, `_shared/tokens.css` wird nicht nachgezogen, oder ein `@import` schleicht sich ein
   und bricht die Offline-Sandbox. *Wurzel:* Self-contained-Gate nicht als CI-/Review-Kriterium
   gefuehrt. *Gegenmassnahme:* Token-Pull als Akzeptanzkriterium, `@dsCard`-Marker/`@import`-Verbot
   pruefen, kein zweiter Token-Satz (4).

5. **(Bonus) Memory-Leak / Komplexitaets-Explosion.** Resource-Bundling pro Request laeckt
   Speicher, oder ein BDUF-UI-Framework wird vor dem ersten Widget gebaut. *Wurzel:* Stateless-
   Transport-Cleanup ignoriert; YAGNI verletzt. *Gegenmassnahme:* `res.on('close')`-Cleanup-Pfad
   respektieren; P1 ist EINE duenne Scheibe (ein Tool, ein Host), Seam minimal, erst danach
   verbreitern.

---

## 7. Status & Restarbeit (Stand 2026-06-27)

**Kette P0-P5 implementiert & gemergt** (lokal `master`, NICHT origin/upstream/live). Kompakter
Stand, Phasen-Tabelle, Verdrahtungs-Befund und das Muster zum Hinzufuegen weiterer Widgets stehen
jetzt in `tasks/mcp-ui-chain.md` (autoritativ). Hier nur das Wesentliche:

- **Gebaut (Server-Seite, getestet):** Seam `src/ui/` (Port/Registry/2 Adapter mcp-nativ+ChatGPT),
  Stufe-0/Stufe-1 fuer 3 Tools (`get_call_status`, `get_transcript`, `get_call_result`), fail-closed
  Fallback, Whitelist-Filter, Callback durch alle Gates (P4), Token-Sync-Gate (P5). Master-Schalter
  `config.mcpUiEnabled` Default AUS = byte-identisch.
- **OFFEN — die eigentliche Verdrahtung (gilt fuer ALLE Widgets):** Die Widget-HTML traegt
  Platzhalter-Slots (`data-mcp-*` = `—`), aber **kein Widget liest das gepushte `structuredContent`
  und fuellt diese Slots.** In einem echten Host wuerden die Karten heute leer rendern. Restarbeit:
  **W1** gemeinsames Binding (EINMAL, geteilt) -> **W2** Live-Host-Smoke (Render mit echten Daten
  beweisen) -> **W3** weitere Tool-Widgets nach Bedarf -> **W4** Design-Feinschliff / optional
  `place_call`-Callback / origin-Push. Details in `tasks/mcp-ui-chain.md`.

Kein Schritt baut Infrastruktur "auf Vorrat" (Regel 6, kein BDUF).

## 8. Owner-Entscheidungen (gepinnt, umgesetzt)

Alle in der Kette umgesetzt: Q1 zwei Host-Konventionen dauerhaft akzeptiert; Q2 Host-Erkennung via
`initialize`-Capability `io.modelcontextprotocol/ui`, fail-closed (P0 belegt, SEP-1865); Q3 Callback
nur ueber authentisierten `/mcp`, kein offener Postback (P4 bestaetigt); Q4 erstes Widget
`get_call_status`; Q5 Seam-Kern MCP-nativ + ChatGPT als Adapter (P3); Q6 Token-Pull als CI-/Review-
Gate (P5: `scripts/check-token-sync.js`, `npm run check:tokens`).
