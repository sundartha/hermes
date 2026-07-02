# PLAN — Hermes-Branding fuer die MCP-Widgets + MCP-Server-Icon

Strategie-Doc (Analyse-only, KEIN Code). Erstellt 2026-07-01 aus Live-Forensik (echte
Widgets gelesen), Code-Recherche (`design-system/`, `apps/web/src/styles/tokens/`,
`apps/hermes-animation-lab/`) und einem Live-Check in Claude ueber die Chrome-Extension
(Connector-Icon, Proxy-Topologie). Umgesetzt wird sequenziell ueber die Lean-Phasen-Kette
in `tasks/mcp-widget-branding-chain.md` (Muster wie [[mcp-ui-strategy]]).

Verwandt: [[mcp-ui-strategy]] (P0-P5, die Widgets existieren), das bereits lokal gemergte
`live-widget-w0..w3` (EIN vereintes `call.html`-Widget, siehe unten Abschnitt 1),
[[deploy-repo-split]] (Live-Verifikation des Icons braucht Push upstream, NICHT Teil
dieser Kette).

---

## 1. Ausgangslage (verifiziert, nicht angenommen)

**Die "ein Widget pro Anruf"-Anforderung ist bereits umgesetzt.** Die Ketten
`live-widget-w0` bis `w3` (siehe Git-Log: `00e2041`/`f37780e`/`6423e22`/`acc993b`, alle
Gate=PASS, 0 Fix-Runden) haben `place_call` bereits auf EIN sich selbst aktualisierendes
Widget (`src/ui/widgets/call.html`, Zustandsmaschine dialing->in_progress->completed/
failed/cancelled, Self-Poll, Cancel) umgestellt; die fruehere 1-Karte-pro-Tool-Aufruf-
Kaskade (`get_call_status` alle ~10s = neue Karte) existiert nicht mehr. Das ist bereits
in `master`, aber noch **nicht** nach `origin`/`upstream` gepusht.

**Das eigentliche Problem ist rein optisch.** Alle 5 aktuell existierenden Widgets
(`call.html`, `agent-status.html`, `my-number.html`, `calls.html`, `calendar.html`) tragen
identische, **ad-hoc erfundene** Inline-Tokens:

```css
--color-red-600:#e60000; --color-ink-900:#25282b; --color-gray-500:#7e7e7e;
--color-gray-150:#ececec; --color-white:#fff; --color-green-500:#1faa59;
--radius-md:12px; --font-sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
```

`system-ui`, flache weisse Karte ohne Schatten, Rot/Gruen als Status-Akzent, kein Wing,
keine Marke — das erklaert den Owner-Eindruck ("sieht absolut beschissen aus"). Der
Kommentar ueber diesem Block behauptet faelschlich "Subset aus
`design-system/_shared/tokens.css` (Werte identisch)" — das ist bereits im W1-Review als
S3-Nit dokumentiert und **falsch** (siehe Abschnitt 2).

## 2. Wurzel-Recherche: welche Tokens sind eigentlich echt?

`design-system/` selbst warnt vor Drift ("Token provenance (avoid drift)") und nennt die
kanonische Quelle: **`apps/web/src/styles/tokens/{primitives,semantic}.css`** — das ist der
Code der echten, live deployten Marketing-/Tenant-Seite (sundartha.com). Gegen diese Quelle
verifiziert (nicht gegen `design-system/README.md`, das stellenweise veraltet ist — siehe
unten):

- **Rebrand bereits vollzogen** (`primitives.css:8`: *"Rebrand Rot -> Navy"*). Die aktuelle,
  live Marke hat **keine** Rot-/Gruen-Statusfarben mehr: `--color-status-positive` und
  `--color-status-critical` sind beide monochrom (Navy bzw. Ink), Kommentar wortwoertlich
  *"status — monochrom Navy + Neutral (kein Rot/Gruen)"*. Die Widgets nutzen also gerade
  die **abgeloeste Vor-Rebrand-Palette** (`#e60000`/`#1faa59`) — ein zweiter, bisher
  unentdeckter Drift-Grund neben der fehlenden Marke.
- Marken-Aktionsfarbe: `--color-navy-700:#1b4f86` (die EINE Aktionsfarbe im ganzen System).
- Neutrale Farben (bereits korrekt in den Widgets): `--color-ink-900:#25282b`,
  `--color-gray-500:#7e7e7e`, `--color-gray-150:#ececec`, `--color-white:#fff`.
- Radien: `--radius-lg:18px` (= `--radius-card`), `--radius-sm:12px` (= `--radius-control`),
  `--radius-pill:99px`. Die Widgets nutzen `12px` **fuer die Karte selbst** — das ist die
  Control-, nicht die Card-Radius.
- Schatten: `--shadow-soft:0 6px 18px rgba(0,0,0,.07)` (= `--shadow-card`) — fehlt in den
  Widgets komplett (flach, keine Elevation).
- Font: `--font-sans:"Space Grotesk","Helvetica Neue",Arial,sans-serif` (Body/UI). Kein
  Hinweis auf Inter fuer diese Ebene — das stand nur in der veralteten README-Prosa.
- `design-system/tokens/*.css` (der Mirror) stimmt mit `apps/web` ueberein — **nur
  `design-system/README.md`** ist stellenweise stale (beschreibt eine fruehere
  Rot-/Inter-Markenphase). Das README selbst wird in dieser Kette NICHT angefasst
  (separates Dokupflege-Thema, ausserhalb des Scopes).

**Konsequenz fuer T1:** Tokens der Widgets 1:1 auf die echten `apps/web`-Werte ziehen.
Kein Rot/Gruen mehr; Navy als einzige Akzentfarbe; `radius-card`/`radius-control`
unterscheiden; Schatten ergaenzen; Font-Stack auf den echten Fallback (kein eingebettetes
Webfont — neue Kosten pro Widget-Datei ohne klaren Gegenwert, siehe Abschnitt 6).

## 3. Der Wing: zwei Implementierungen, eine sichere Wahl

`design-system/README.md` (Iconographie-Abschnitt) und der Code kennen **zwei** Wing-
Formen:

1. **`WingMark`** (`design-system/components/brand/WingMark.jsx`) — reine CSS-Keyframe-
   Animation ueber ein einzelnes `<img>` (PNG als Data-URI, `wing-image.js`). Fuenf States,
   1:1 aus dem Animation-Lab uebernommen: `idle` (Perpetual-Hover), `connecting` (zwei
   vorsichtige Schlaege), `working` (rhythmisches Flattern), `success` (Schnapp-Ueberschwing-
   Ansatz), `error` (Stottern, dann Haenge-Lassen). **Kein Build-Step, kein CDN, kein
   Canvas** — ein `<span>` mit injizierten `@keyframes` + einem `<img>`.
2. **`LiveWing`/`wing-engine.js`** — der "echte" Pixi-Mesh-Deform-Wing (16x24 MeshPlane +
   GSAP-Timelines), verbatim aus `apps/hermes-animation-lab` portiert. Laedt Pixi v8 + GSAP
   **von einem CDN** (`unpkg.com`) zur Laufzeit. Genau dieses Muster nutzt das
   `design-system/mcp/wing-status.html`-Mockup fuer den "Live-Beacon" (den grossen,
   animierten Wing IM Chat).

**Entscheidung (Lead, dokumentiert statt gefragt — Begruendung unten): `WingMark` (CSS-
only) fuer das MCP-Widget, NICHT `LiveWing`/Pixi-CDN.**

Begruendung (Pre-Mortem: was waere in einem Jahr schiefgegangen, haette ich Pixi gewaehlt?):
- `src/ui/widget-catalog.js` dokumentiert seit W1 explizit die Invariante *"Iframe-Sandbox:
  kein `@import`/Linkback"* fuer ALLE Widgets — ein CDN-`<script src="https://unpkg.com/...">`
  bricht genau diese Invariante als Erster.
- Ob ein MCP-Host (Claude/ChatGPT) das Nachladen von Fremd-Skripten aus einem Widget-Iframe
  ueberhaupt zulaesst, ist **unbewiesen** — dieselbe Art Unsicherheit wie U1 in der
  Live-Widget-Kette, nur ohne den dort gebauten Fallback-Mechanismus. Schlaegt der CDN-Load
  fehl (CSP des Hosts, Netzwerk, Rate-Limit von unpkg), bleibt im schlimmsten Fall ein
  kaputter/leerer Wing statt gar keiner Animation — schlechter als der Status quo.
- CLAUDE.md: *"Wenige Dependencies, bewusst gehalten - neue nur mit Begruendung"*. Eine
  Laufzeit-Abhaengigkeit von unpkg.com fuer ein dekoratives Element ist fuer eine
  Kern-Produktoberflaeche (nicht das isolierte `hermes-studio`-Marketing-Tool) nicht
  begruendet, wenn `WingMark` **alle funktional geforderten States** (idle/connecting/
  working/success/error = exakt "Flügel, der sich fürs Erfolg/Fehler speziell animiert")
  bereits ohne jede neue Abhaengigkeit liefert.
- `design-system/README.md` selbst nennt `WingMark` explizit fuer "cheap CSS
  approximations" — das ist keine Notloesung, sondern ein im System bereits vorgesehener,
  legitimer Pfad.

`LiveWing`/Pixi bleibt eine dokumentierte, bewusst deferrte Option (z.B. falls ein
spaeterer Live-Test zeigt, dass CDN-Loads in Widget-Iframes zuverlaessig funktionieren) —
in dieser Kette NICHT gebaut.

## 4. MCP-Server-Icon: Wurzel gefunden, kein Render-Zusammenhang

Live-Check ueber die Chrome-Extension in `claude.ai/customize/connectors`:

- Die registrierte URL ist bereits `https://app.sundartha.com/mcp` — **keine**
  `onrender.com`-Domain. Die urspruengliche Owner-Vermutung ("Render-Logo") ist als
  Erklaerung widerlegt.
- Das tatsaechlich angezeigte Icon ist ein **generischer grauer Wuerfel/Box-Platzhalter**
  (Claudes Default fuer Connectoren ohne Icon-Info) — sichtbar im Vergleich zu z.B.
  "Higgsfield" (ebenfalls `BENUTZERDEFINIERT`), das ein echtes eigenes Icon zeigt. Custom-
  Connectoren KOENNEN also ein eigenes Icon tragen.
- Der Browser spricht NICHT direkt mit `app.sundartha.com` — Claude proxied MCP-Traffic
  server-seitig (`claude.ai/v1/toolbox/shttp/mcp/<uuid>`, per Netzwerk-Tab bestaetigt).
  Ein Icon-Fix ist daher nur ueber das MCP-Protokoll selbst (nicht ueber Browser-seitiges
  Favicon-Scraping) sicher wirksam.
- **Root Cause:** `src/mcp-server.js:21` setzt `new McpServer({ name: "hermes", version:
  "0.2.0" }, ...)` **ohne `icons`**. Das SDK in `package.json` ist auf `^1.12.0` gepinnt;
  tatsaechlich installiert (und mit diesem Range kompatibel, **kein Versions-Bump noetig**)
  ist `1.29.0` — dessen `ImplementationSchema` (= `serverInfo`) hat laengst ein
  `icons: [{src, mimeType, sizes, theme}]`-Feld (Typdefinition verifiziert in
  `node_modules/@modelcontextprotocol/sdk/dist/esm/types.d.ts`).

**Fix:** `icons` in der `serverInfo` setzen, `src` = absolute URL auf ein selbst gehostetes
Hermes-Wing-Asset unter `config.publicUrl` (kein Data-URI im Protokoll-Handshake — haelt
die `initialize`-Antwort klein). Zusaetzlich defensiv ein `public/favicon.ico` (Browser-
Fallback fuer jeden anderen Kontext, z.B. direkter Aufruf der Domain) — kostet nichts,
kann nur helfen.

**Wichtige Einschraenkung:** ob Claude das neue Icon nach diesem Fix tatsaechlich zieht,
ist erst nach einem **Deploy** (Push `upstream`, siehe [[deploy-repo-split]]) und einem
erneuten `initialize`-Handshake/"Tool-Liste aktualisieren" pruefbar — das ist NICHT
autonom (Owner-Gate, siehe Kette Abschnitt T3-AC5). Lokal verifizierbar ist nur, dass die
`initialize`-Response das `icons`-Feld korrekt trägt.

## 5. Scope-Abgrenzung (bewusst NICHT Teil dieser Kette)

- `apps/hermes-studio/` (Video-/Social-Media-Tool) — beruehrt laut eigenem README den
  MCP-Server nicht, eigene Gold/Navy-"Studio-Bibel"-Aesthetik fuer Reels, komplett
  getrennter Kontext. NICHT anfassen.
- Die offene `tasks/todo.md`-Aufgabe "Animierten Wing auf sundartha.com" (Marketing-Site,
  `apps/web`) — eigener, vom Owner noch nicht final entschiedener Track (CSP/Pixi-Frage).
  NICHT Teil dieser Kette, keine Ueberlappung im Dateibaum.
- `design-system/README.md` selbst NICHT korrigieren (die dortige Rot/Inter-Beschreibung
  ist stale) — reine Dokupflege, kein Produktcode, ausserhalb des Auftrags.
- ChatGPT-Apps-SDK-Icon-Mechanismus — nicht empirisch pruefbar ohne ChatGPT-Session; die
  `serverInfo.icons`-Aenderung ist protokoll-/host-agnostisch und kann dort nur helfen,
  wird aber nicht separat fuer ChatGPT verifiziert.

## 6. Bewusste Vereinfachungen (dokumentiert statt versteckt)

- **Kein selbst gehostetes Webfont fuer "Space Grotesk".** Ein `@font-face` mit
  Data-URI-`woff2` waere pro Widget-Datei ~15-50 KB zusaetzlich (kein Sharing-Mechanismus
  zwischen den self-contained Widget-Dateien). Der Token-Fallback-Stack selbst
  (`"Space Grotesk","Helvetica Neue",Arial,sans-serif`) wird 1:1 uebernommen; die meisten
  Hosts zeigen mangels installierter Schrift den Fallback — identisch zum heutigen
  Verhalten, nur korrekt deklariert. Farbe/Radius/Schatten/Wing sind die groesseren Hebel
  fuer den optischen Eindruck.
- **`cancelled`-Wing-Status** ist im Animation-Lab/`WingMark` nicht als eigener State
  vorgesehen (nur 5 States). Mapping in T2: `cancelled` -> `error`-Keyframe (kein sechster,
  erfundener State).
- **1024x1024-PNG als Server-Icon**, kein Resizing (keine neue Bildbearbeitungs-
  Dependency). Hosts skalieren selbst; die Datei ist ein einmalig geladenes, kein
  Hot-Path-Asset.

## 7. Phasen-Ueberblick (Details in `tasks/mcp-widget-branding-chain.md`)

| Phase  | Autonom? | Kurz                                                                         |
| ------ | -------- | ----------------------------------------------------------------------------- |
| **T1** | ja       | Design-Tokens in allen 5 Widgets auf die echten `apps/web`-Werte ziehen (Navy statt Rot/Gruen, radius-card/-control, Schatten, Font-Stack) |
| **T2** | ja       | `WingMark`-CSS-Keyframes nach `call.html` portieren, an die Status-Zustandsmaschine gekoppelt; statische idle-Marke in den 4 anderen Widget-Headern |
| **T3** | ja       | `serverInfo.icons` in `src/mcp-server.js` setzen, Hermes-Wing-Asset unter `public/`, defensives `favicon.ico` |
| **V**  | **nein (Lead + Owner)** | Visuelle Verifikation via Chrome (lokale Widgets im Browser, `initialize`-Response), Screenshot-Vergleich mit `design-system/mcp/`-Mockups, Feedback-Loop. Live-Connector-Icon-Check braucht Deploy (Owner-Gate) |

Reihenfolge T1 -> T2 -> T3 (T2 baut auf den in T1 normalisierten Tokens auf; T3 ist
dateimaessig unabhaengig, laeuft aus Einfachheit trotzdem sequenziell). Jede Phase = ein
`phase-impl-lean`-Lauf (gepinntes Skript, siehe [[phase-impl-workflow-args]]), dualer
Sonnet-Review als Gate (S1/S2=Blocker), Merge im Lead.

## 8. Harte Invarianten (die Kette darf sie NIE verletzen)

- `src/ui/widget-bind.js` bleibt byte-identisch.
- Kein `innerHTML` in Widgets (nur `textContent`/statisches Markup fuer die neue
  Wing-`<img>`, die NIE Tool-Daten traegt), kein `@import`/`<link>`/CDN-`<script>`.
- Safety-Gates (`src/server.js` `/api/calls`), Disclosure (`claude.js`/`bridge.js`),
  Tenant-Isolation — in dieser Kette ohnehin nicht im Diff-Pfad (nur Widget-HTML +
  `mcp-server.js`-Servername/-Icon + `public/`-Assets).
  `place_call`/`get_call_status`/`get_transcript`/`cancel_call`-Handler unangetastet.
  `src/mcp-tools.js` wird in dieser Kette NICHT editiert.
- Kein neuer npm-Dependency (SDK-Icons sind bereits im installierten `1.29.0`
  verfuegbar, kein Bump).
- `MCP_UI_ENABLED=false`-Byte-Invarianz bleibt unberuehrt (diese Kette aendert nur Inhalt
  bereits existierender Widget-Dateien + den `serverInfo`, nicht das Gate selbst).

## 9. Deploy / Verifikation

- Lokal pruefbar (autonom): `npm test` gruen, `node --check`, Widget-HTML direkt im
  Browser (file:// oder ueber einen lokal gestarteten Server) neben den
  `design-system/mcp/*.html`-Mockups verglichen, `/mcp`-`initialize`-Response traegt
  `serverInfo.icons`.
- NICHT autonom: `git push upstream master` (macht live, [[deploy-repo-split]]) + erneuter
  Live-Check des Connector-Icons in Claude. Das ist ein Owner-Gate, exakt wie W4 in der
  Live-Widget-Kette — wird NICHT in dieser Kette automatisch ausgefuehrt.
