# Schnitt S6: Domain-Ownership-Challenge und Widget-Pflichtfelder
Blocker: P0-2, P1-50 | Anforderungs-IDs: O-4, O-5, T-30, T-31 | Kategorie: A

## Der Wortlaut, aus dem dieser Schnitt folgt

O-4 (`tasks/openai-audit/00-openai-anforderungen.md:99`), Anforderung und Zitat-Kern:

> **Domain-Ownership**: exaktes Token unter `https://<challenge-base-host>/.well-known/openai-apps-challenge`;
> nur dieses eine Token, **kein** JSON, keine Liste
> -- "The challenge endpoint must return only that plugin's verification token. Do not return
> JSON, a list of tokens, or multiple tokens"

O-5 (`:100`):

> Challenge-Base ist MCP-Hostname oder ein Parent-Host; **Pfade werden ignoriert** - zwei
> Plugins auf demselben Host mit unterschiedlichem Pfad teilen die Challenge-URL
> -- "You cannot verify them separately by putting different tenant paths in the Challenge Base
> URL, because the path is ignored."

Daraus folgen drei Festlegungen ohne Ermessen:
1. **Pfad** = `/.well-known/openai-apps-challenge` (woertlich aus O-4, kein Praefix, kein Suffix).
2. **Koerper** = der Token und NICHTS sonst. Kein JSON, kein Array, kein Objekt-Wrapper, kein
   abschliessender Zeilenumbruch (ein `\n` waere ein zusaetzliches Byte am "exakten Token").
   Content-Type damit `text/plain; charset=utf-8` - ein `application/json` waere genau die von
   O-4 verbotene Form, und ein `text/html` waere eine Seite, kein Token.
3. **Genau EIN Wert** auf diesem Host (O-5: der Pfad wird ignoriert, es zaehlt der Host). Die
   Route liefert deshalb einen Skalar, keine Liste und keinen Mandanten-Schluessel.

T-30 (`:63`): "Bei UI: **CSP zwingend**, die exakt die Domains erlaubt, von denen die Komponente
laedt (`_meta.ui.csp` mit `connectDomains`, `resourceDomains`, optional `frameDomains`)" --
"you defined a content security policy (CSP) that allows the exact domains the component fetches from".
T-31 (`:64`): "Bei UI: eigener, pro Plugin eindeutiger Origin `_meta.ui.domain` erforderlich" --
"required when submitting a plugin with UI; must be unique per plugin".

## Owner-Entscheidungen, die hier NICHT neu aufgerollt werden

| ID | Entscheidung | Folge in diesem Schnitt |
|---|---|---|
| E-1 | Origin = `https://app.sundartha.com` (`PLAN-OPENAI.md:18`) | Die Challenge-Route liegt auf diesem Host. Der Parent `sundartha.com` wird NICHT beplant (offene Frage OF-1). |
| Owner 2026-09-18 | Token kommt aus `OPENAI_APPS_CHALLENGE_TOKEN`; leer/ungesetzt -> **404**, als gaebe es die Route nicht | A1/A2. Kein Boot-Riegel, kein Produktions-Footgun: der Token existiert noch nicht, ein Riegel wuerde den Dienst blockieren. |
| Owner 2026-09-18 | `_meta.ui.domain` traegt den Server-Origin | A10: abgeleitet aus `config.server.publicUrl`, keine zweite Wahrheit, kein neues Env. |
| Owner 2026-09-18 | Genau EIN Plugin auf diesem Host | Eine Route, ein Wert. Ein zweites Plugin braucht eine eigene Subdomain - kuenftige Entscheidung, nicht Teil dieses Schnitts. |

## Ist-Zustand

**Challenge-Route (P0-2).** Es gibt sie nicht: `grep -rn "openai-apps-challenge" src/ apps/web` = 0
Treffer (`tasks/OPENAI-MCP-READINESS.md:67`). Das Muster fuer eine oeffentliche Well-Known-Route
existiert vollstaendig und dreifach verzahnt:

- Registrierung: `src/auth.js:121-129` (`registerWellKnown`, RFC-9728-PRM), gerufen aus
  `src/app.js:167` innerhalb von `registerPublicRoutes` (`src/app.js:144`), das seinerseits VOR
  `registerPathRedirects` und VOR dem statischen Serving laeuft (`src/app.js:470-471`).
- Politik: `src/route-policy.js:86-95`, zwei Eintraege mit Begruendung "muss per Spezifikation
  ohne Login erreichbar sein".
- Zwei weitere Zwangspunkte, die der Audit-Bericht nicht nennt und die jede neue Route mitnimmt:
  `ROUTE_FINGERPRINT` in `test/route-auth-inventory.test.js:174-240` (gepinnte Gesamtliste aller
  Routen) und die Erwartungstabelle der Live-Probe `scripts/probe-auth.sh:88-119`, die
  `test/probe-auth-table.test.js:106-120` gegen `PUBLIC_ROUTES` auf Vollstaendigkeit prueft.
  Fehlt einer der drei Eintraege, ist `npm test` rot.
- Der Dienst antwortet unter JEDEM auf ihn gerichteten Host - es gibt keine Host-Bindung am
  Routengraph (`tasks/openai-audit/18-host-und-origin.md` PP-D18-02, Beleg
  `src/routes/mcp.js:51`). Die Route ist damit ab dem Deploy unter `app.sundartha.com` UND unter
  `vodafone-agent.onrender.com` erreichbar.

**Widget-Pflichtfelder (P1-50).** `_meta` traegt heute ausschliesslich die Resource-URI:
- `src/ui/contract.js:65-83` (`makeUiRenderer`) baut `toolMeta: (widgetId) => ({ [metaKey]: buildMeta(uri) })`.
- MCP-nativ: `src/ui/adapters/mcp-native.js:10-14`, `buildMeta: (uri) => ({ resourceUri: uri })`
  -> `_meta.ui = { resourceUri }`.
- ChatGPT/Skybridge: `src/ui/adapters/chatgpt.js:8-12`, `buildMeta: (uri) => uri` -> flacher String
  unter `_meta["openai/outputTemplate"]`.
- Konsumiert an EINER Stelle: `src/mcp-tools.js:679-685` (`enableWidgetUi`), fail-closed `{}` wenn
  der Renderer das Widget nicht kennt.
- `grep` nach `ui.csp`, `ui.domain`, `connectDomains`, `resourceDomains` in `src/` = 0 Treffer
  (`tasks/OPENAI-MCP-READINESS.md:213`).

**Welcher Adapter liefert die Deskriptoren, die ein ChatGPT-Host sieht?** Der MCP-native. Beleg,
nicht Annahme: `src/ui/registry.js:43-49` waehlt `chatgptRenderer` nur, wenn der Host den
Skybridge-mimeType in `capabilities.extensions` deklariert; `src/routes/mcp.js:104` speist diese
Capabilities aus `req.body?.params?.capabilities`, und laut `src/ui/registry.js:11-14` traegt im
Stateless-Modus (`sessionIdGenerator: undefined`, `src/routes/mcp.js:22`) **nur der
initialize-POST** dieses Feld, "der spaetere tools/list-POST nicht" (dort als lokal end-to-end
reproduziert dokumentiert). Auf genau dem Request, der die Tool-Deskriptoren ausliefert, ist der
ChatGPT-Zweig also unerreichbar - es gewinnt der Default `mcpNativeRenderer`. Dazu passt T-23
(zitiert in `tasks/openai-audit/17-resources-flaeche.md:56`): "Prefer `_meta.ui.resourceUri` ...
`openai/outputTemplate` nur als Kompatibilitaets-Alias". **Folge fuer diesen Schnitt: die zwei
Pflichtfelder gehoeren in die MCP-native `_meta.ui`-Form; der ChatGPT-Adapter bleibt unberuehrt.**
Das haelt zugleich den Pin `test/mcp-ui.test.js:562` (`assert.ok(!meta.ui)`) gruen.

**Flag.** Der gesamte Widget-Pfad haengt an `MCP_UI_ENABLED` -> `config.tenancy.mcpUiEnabled`
(`src/config.js:1626`, `boolEnv(..., { fallback: true })`, Namespace-Zuordnung
`src/config.js:2265`), dokumentiert `.env.example:322-326`. Konsumiert: `src/routes/mcp.js:93,104`
und `src/mcp-server.js:19,27`; das Tor selbst ist `src/ui/registry.js:45`
(`if (!hostHint?.enabled) return null`). **`MCP_UI_ENABLED` steht NICHT in `render.yaml`**
(`grep` = 0 Treffer) - und der Gateway-Service ist dashboard-verwaltet ("Werte hier sind
REFERENZ/Doku - die Quelle der Wahrheit ist das Render-Dashboard", `render.yaml:14-17`). Der
Live-Wert ist damit **UNKNOWN**. Bedeutung fuer die Einreichung: ist der Schalter live aus,
liefert `tools/list` GAR KEIN `_meta.ui` - dann traegt kein Deskriptor ein Widget, T-30/T-31 sind
gegenstandslos und O-12 ("Screenshots nur bei UI") verbietet Screenshots. Die Messung dieses einen
Wertes entscheidet also, ob mit oder ohne UI eingereicht wird; sie ist Owner-Aufgabe O-A5, kein Code.

**Messung: von wo laden die Widgets?** Vollstaendig ueber die 5 Widget-Quellen
(`src/ui/widgets/{agent-status,my-number,calls,calendar,call}.html`) UND alle zur Ladezeit
injizierten Bausteine (`src/ui/widget-bind.js`, `src/ui/wing-canvas-engine.js`,
`src/ui/wing-canvas-mount-idle.js`, `src/ui/widget-i18n.js`, `src/ui/hud-card-css.js`,
`src/ui/wing-markup.js`, `src/ui/wing-image-data.js`; Zusammensetzung
`src/ui/widget-catalog.js:146-168`):

| Gemessen | Ergebnis |
|---|---|
| `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `importScripts`, `navigator.geolocation` | **0 Treffer in JEDER der 12 Dateien** |
| `@font-face` | 0 Treffer; Schrift nur ueber CSS-Variable `var(--font-sans)` (`src/ui/hud-card-css.js:41`, `src/ui/wing-markup.js:39,120`) |
| absolute URLs (`http(s)://...`) | **genau 1**, und die ist kein Ladevorgang: `http://www.w3.org` als SVG-XML-Namespace INNERHALB eines `data:`-URI (`src/ui/widgets/call.html:114`) |
| Bilder | 2 `data:`-URIs (`call.html:114`; das Wing-PNG aus `src/ui/wing-image-data.js`, eingebettet via `src/ui/wing-markup.js:16`) |
| `<iframe>`, `<frame>`, `<embed>`, `<object>` | 0 Treffer |
| Aussenkanal ueberhaupt | ausschliesslich `parent.postMessage(...)` (`src/ui/widget-bind.js:120-125`) - JSON-RPC an den Host, kein Netz-Ladevorgang, von einer CSP nicht adressiert |

**Die Widgets laden von NIRGENDWO.** Sie sind self-contained (so auch der Kopfkommentar
`src/ui/widget-catalog.js:140-142`: "Iframe-Sandbox: kein @import/Linkback").

## Soll-Zustand

1. `GET https://app.sundartha.com/.well-known/openai-apps-challenge` liefert bei gesetztem
   `OPENAI_APPS_CHALLENGE_TOKEN` **200** mit `text/plain; charset=utf-8` und als Koerper **exakt
   den Token-Wert** - kein JSON, keine Liste, kein Zeilenumbruch.
2. Ist die Variable leer, nur Whitespace oder ungesetzt, antwortet die Route **404** mit dem
   Standard-Fall-through - von aussen nicht von "Route existiert nicht" unterscheidbar.
3. Die Route ist in `src/route-policy.js` als oeffentlich begruendet, im `ROUTE_FINGERPRINT`
   gepinnt und in der Erwartungstabelle der Live-Probe vertreten;
   `test/route-auth-inventory.test.js` und `test/probe-auth-table.test.js` bleiben gruen.
4. Jeder Tool-Deskriptor, der heute `_meta.ui.resourceUri` traegt, traegt zusaetzlich
   `_meta.ui.csp = { connectDomains: [], resourceDomains: [] }` und - sofern
   `config.server.publicUrl` gesetzt ist - `_meta.ui.domain = <publicUrl>`.
5. Der ChatGPT-Adapter, der Widget-Katalog, das Widget-HTML und die Resource-Registrierung
   bleiben **byte-identisch**.

## Aenderungen

### A1 - `src/config.js`: der Token als zentralisierte Konfiguration
**Stelle:** neuer Schluessel im Config-Objekt, Muster `elevenLabsToolToken` (`src/config.js:780`)
bzw. `initWebhookToken` (`:893`) - beide mit `.trim()`.
**Was:** `openaiAppsChallengeToken: (process.env.OPENAI_APPS_CHALLENGE_TOKEN || "").trim()`.
Aufnahme in `CONFIG_NAMESPACES` (`src/config.js:2251-2273`) unter **`server`** (`:2267`).
**Warum so:** `.trim()` aus demselben Grund wie bei den Anbieter-Tokens - ein beim Einfuegen
mitgenommener Zeilenumbruch waere sonst Teil des "exakten Tokens" und die Verifikation schlaegt
fehl, ohne dass man den Grund sieht. Namespace `server` und nicht `auth`: der Wert authentifiziert
niemanden und autorisiert nichts; er ist ein statischer Eigentumsnachweis fuer den HOST, und genau
dort liegen `publicUrl`/`isProduction`/`deployedCommit`.
**Bewusst NICHT:** kein Boot-Guard, kein Produktions-Footgun. Der Token existiert erst nach der
Portal-Eingabe; ein Riegel wuerde den Dienst an einer Einreichungs-Vorbereitung sterben lassen.
**Folge, die im Spec stehen muss:** der Wert wird beim Prozessstart gelesen. Ein spaeter im
Render-Dashboard eingetragener Token wirkt mit dem naechsten Start des Dienstes (OF-7).

### A2 - `src/app.js`: die Route (~12 Zeilen)
**Stelle:** in `registerPublicRoutes` (`src/app.js:144-179`), direkt VOR `registerWellKnown(app)`
(`:167`).
**Was:**
```js
// ---- GET /.well-known/openai-apps-challenge: Domain-Ownership (O-4/O-5) -------
// AUTH-AUSNAHME (Regel 3, begruendet): OpenAI ruft diesen Pfad ohne jede Identitaet ab -
// der Zweck IST die unauthentifizierte Abholbarkeit. Eintrag in src/route-policy.js.
// Antwortet NUR mit dem zugewiesenen Klartext-Token: kein JSON, keine Liste, kein
// Zeilenumbruch (O-4 woertlich). Leerer/ungesetzter Wert -> 404 wie eine nicht
// existierende Route: fail-closed und ohne zu verraten, dass hier etwas vorbereitet ist.
// EIN Wert, weil der Pfad laut O-5 ignoriert wird - die Challenge gilt fuer den HOST.
app.get(OPENAI_CHALLENGE_PATH, (_req, res) => {
  const token = config.server.openaiAppsChallengeToken;
  if (!token) return res.status(HTTP_NOT_FOUND).end();
  res.type("text/plain").send(token);
});
```
`OPENAI_CHALLENGE_PATH` als benannte Konstante im Kopf von `src/app.js` (G25: der Pfad steht sonst
doppelt - hier und in `src/route-policy.js`; Import-Muster wie `ELEVENLABS_INIT_PATH`, das
`src/route-policy.js:28` aus dem Routenmodul importiert). `HTTP_NOT_FOUND` ebenfalls benannt
(Muster `HTTP_FORBIDDEN`, `src/middleware.js:62`).
**Warum hier und nicht in `src/auth.js`:** `registerWellKnown` ist der OAuth-Resource-Server
(RFC 9728, eigener Kopfkommentar `src/auth.js:119-120`); eine Einreichungs-Challenge hat mit Auth
nichts zu tun. `registerPublicRoutes` ist per eigenem Kommentar (`src/app.js:145-147`) genau der
Ort fuer "Routen, die vor jeder Identitaet erreichbar sein muessen", jede einzeln begruendet - und
`config` liegt dort schon in der Signatur. Kein neues Modul fuer 12 Zeilen.
**Warum Laufzeit-Pruefung und nicht bedingte Registrierung:** eine nur-bei-Token gemountete Route
wuerde aus dem geprueften Routengraph verschwinden (`src/route-policy.js:19-21` nennt genau diese
Klasse als BLIND) - der Inventar-Test saehe sie nie.

### A3 - `src/route-policy.js`: Politik-Eintrag
**Stelle:** `PUBLIC_ROUTES` (`:83`), neben den zwei `.well-known`-Eintraegen (`:86-95`).
**Was:** `{ method: "GET", path: OPENAI_CHALLENGE_PATH, reason: "..." }` mit Begruendung:
oeffentlich per Anforderung O-4/O-5; liefert einen einzigen, von OpenAI zugewiesenen
Verifikations-Token und sonst nichts; keine Tenant-Daten, kein Zustand, kein Schreibpfad; bei
leerer Env 404.
**Warum so:** ohne diesen Eintrag ist `test/route-auth-inventory.test.js` rot (Klasse
`UNPROTECTED`, `src/route-policy.js:263-269`). Pfad importiert statt Literal - dieselbe Regel, die
`src/route-policy.js:24-26` fuer bereits benannte Pfade aufstellt.

### A4 - `test/route-auth-inventory.test.js`: Fingerprint
**Stelle:** `ROUTE_FINGERPRINT` (`:174-240`), alphabetisch bei den `.well-known`-Zeilen (`:177-178`).
**Was:** `"GET /.well-known/openai-apps-challenge"` mit Kurzkommentar (Muster der
IEL-B6/INBOX-P2-Zeilen dort).

### A5 - `scripts/probe-auth.sh`: Erwartungszeile der Live-Probe
**Stelle:** Tabellenblock `:88-119`, bei den `.well-known`-Zeilen (`:90-91`).
**Was:** `oeffentlich|GET|/.well-known/openai-apps-challenge|404|keine|Domain-Ownership-Token nicht gesetzt; Route existiert (O-4)`
**Warum 404:** die Probe misst den DEPLOYTEN Zustand, und dort ist der Token noch nicht
eingetragen. Praezedenz fuer eine oeffentliche Route mit erwartetem 404:
`scripts/probe-auth.sh:109` (`/voice/tts/:token`). Die Widerspruchsregeln von
`test/probe-auth-table.test.js:122-156` binden den Status nur fuer `ART=sitzung` (401/403) und
`ART=fehlt` (404) - fuer `oeffentlich` ist jeder Code zulaessig, 404 und 200 sind beide gueltig.
**Folgeschritt (Owner-Aufgabe O-A3):** nach dem Eintragen des Tokens wandert die Zeile auf `200`.
Ohne diesen Schritt meldet die Probe eine Abweichung - das ist dann ein korrekter Befund, kein
Fehlalarm.

### A6 - `test/config-namespaces.test.js`: Zaehler
**Stelle:** `EXPECTED_NAMESPACE_COUNTS.server` und `EXPECTED_TOTAL_KEYS` (`:203`).
**Was:** `server` +1, Gesamt **196 -> 197**, mit einer Kommentarzeile im dortigen Stil
("S6: openaiAppsChallengeToken (server) ergaenzt -> 197").
**Warum:** `test/config-namespaces.test.js:184-219` pinnt beide Zahlen; ohne Nachziehen ist
`npm test` rot. **Achtung Merge (gemessen, nicht gerechnet):** der Kommentarblock dort warnt
ausdruecklich, dass zwei Ketten unabhaengig ausgezaehlt und beide "-> 185" geschrieben haben, Git
die identische Zeile stillschweigend zusammenfuehrte und die Summe dadurch um 2 zu niedrig war. Vor
dem Merge dieses Schnitts ist die Zahl am gemergten Stand **neu zu messen**, nicht aus diesem Spec
zu uebernehmen.

### A7 - `test/helpers.js`: `BASE_ENV`-Pin
**Stelle:** `BASE_ENV` (`:55-561`), bei den Token-Pins (Muster `ELEVENLABS_INIT_WEBHOOK_TOKEN: ""`,
`:292`).
**Was:** `OPENAI_APPS_CHALLENGE_TOKEN: ""` mit Begruendung im Bestandsstil.
**Warum:** Lehre "Test-BASE_ENV-Drift" - `dotenv` fuellt nur ungesetzte Variablen; ohne diesen Pin
leakt ein lokal eingetragener Token in JEDEN Spawn-Test, und der 404-Fall (der Normalfall der
Suite) waere dort still ein 200.

### A8 - `.env.example`: Dokumentation
**Stelle:** eigener Block, Muster `.env.example:322-326` (MCP Rich-UI).
**Was:** `OPENAI_APPS_CHALLENGE_TOKEN=` (leer) mit Erklaerung: von OpenAI im Einreichungsformular
erzeugt; wird unveraendert unter `/.well-known/openai-apps-challenge` als Klartext ausgeliefert;
leer = Route antwortet 404; genau EIN Wert je Host (O-5).
**Warum:** Konvention aus CLAUDE.md ("Env-Variablen immer in `src/config.js` zentralisieren UND in
`.env.example` dokumentieren").

### A9 - `render.yaml`: Blueprint-Referenz
**Stelle:** Gateway-Block, Muster `render.yaml:156-157` (`ELEVENLABS_INIT_WEBHOOK_TOKEN` /
`sync: false`).
**Was:** `- key: OPENAI_APPS_CHALLENGE_TOKEN` / `sync: false` plus Kommentarzeile.
**Warum `sync: false`:** der Wert wird im Dashboard gesetzt (der Dienst ist dashboard-verwaltet,
`render.yaml:14-17`), der Blueprint ist Referenz. Ein `value:` hier waere eine zweite Wahrheit.

### A10 - `src/ui/contract.js`: die zwei Pflichtfelder, EINE Quelle
**Stelle:** neben den bestehenden Protokoll-Konstanten (`:12-20`); `contract.js` ist per eigenem
Kopfkommentar (`:1-6`) "EINZIGE Stelle, die die Protokoll-Strings kennt".
**Was:**
```js
// T-30 (00-openai-anforderungen.md:63): die CSP muss EXAKT die Domains nennen, von denen die
// Komponente laedt. Gemessen ueber alle 5 Widget-Quellen und alle injizierten Bausteine: sie
// laden von NIRGENDWO - 0 Treffer fuer fetch/XHR/WebSocket/EventSource/sendBeacon/
// importScripts, kein @font-face, keine absolute URL (die einzige, http://www.w3.org, ist der
// SVG-Namespace INNERHALB eines data:-URI, widgets/call.html:114), Bilder nur als data:-URI,
// kein iframe. Beide Listen sind deshalb LEER - eine weitere Angabe waere eine Falschangabe.
// frameDomains entfaellt (laut T-30 optional, 0 Frames). Der einzige Aussenkanal ist
// parent.postMessage (widget-bind.js:120-125) und wird von einer CSP nicht adressiert.
export const UI_CSP = Object.freeze({
  connectDomains: Object.freeze([]),
  resourceDomains: Object.freeze([]),
});

// T-31 (:64): pro Plugin eindeutiger Origin. Owner-Entscheidung 2026-09-18: der Server-Origin,
// abgeleitet aus config.server.publicUrl - KEIN eigenes Env, damit es keine zweite Wahrheit
// ueber den eigenen Origin gibt (derselbe Wert speist Token-Audience und PRM, src/auth.js:23).
// Fehlt publicUrl (lokal), entfaellt das Feld statt einen falschen Origin zu behaupten.
export function uiSubmissionMeta() {
  const domain = config.server.publicUrl;
  return domain ? { csp: UI_CSP, domain } : { csp: UI_CSP };
}
```
Dazu der Import von `config`.
**Warum ein Objekt und keine Streuung ueber den Katalog:** die Messung ist fuer alle fuenf Widgets
identisch (alle laden von nirgendwo), also gibt es keine per-Widget-Daten. Ein Feld pro
Katalog-Eintrag (`src/ui/widget-catalog.js:105-111`) waere fuenfmal derselbe Wert - genau die
Duplizierung, die der Katalog verhindern soll. **Naht fuer spaeter:** laedt ein kuenftiges Widget
tatsaechlich von aussen, wandert der Wert als Feld in `WIDGET_DEFS` und `uiSubmissionMeta` bekommt
die `widgetId` als Argument; die Aufrufstelle (A11) bleibt dieselbe.

### A11 - `src/ui/adapters/mcp-native.js`: Anhaengen an `_meta.ui`
**Stelle:** `:13`, `buildMeta`.
**Was:** `buildMeta: (uri) => ({ resourceUri: uri, ...uiSubmissionMeta() })`.
**Warum genau hier und nur hier:** `_meta.ui` ist die Form, die T-30/T-31 woertlich nennen, die
T-23 bevorzugt - und es ist die Form, die ein ChatGPT-Host auf dem `tools/list`-Request tatsaechlich
bekommt (Beleg im Ist-Zustand: `src/ui/registry.js:11-14,43-49`, `src/routes/mcp.js:22,104`).
**Bewusst NICHT im ChatGPT-Adapter:** dessen `_meta` ist ein flacher String
(`src/ui/adapters/chatgpt.js:11`), ein verschachteltes `ui` daneben waere eine zweite Meta-Form fuer
dieselbe Aussage, und der Pin `test/mcp-ui.test.js:562` (`!meta.ui` = "das ist mcp-nativ") muesste
gedreht werden - ein Rueckbau ohne Live-Beleg gegen einen echten ChatGPT-Host, also genau das
Muster, das `src/ui/registry.js:17-34` als schon einmal live gebrochen dokumentiert.

### A12 - Tests (neu)
- `test/openai-s6-challenge.test.js` (neu, Spawn-Muster `test/oauth.test.js:17-40`): die
  HTTP-Faelle der Route inkl. Log-Negativkontrolle.
- `test/mcp-ui.test.js`: zwei Faelle fuer `_meta.ui.csp`/`domain` und die Gegenprobe "ChatGPT-Meta
  unveraendert". Die in-process-Tests dort setzen `config.server.publicUrl` EXPLIZIT (Muster
  `test/route-auth-inventory.test.js:56`) - sonst entscheidet die lokale `.env` ueber das
  Ergebnis.

## Nicht Code, sondern Formular-Eingabe (Owner-Aufgaben)

| ID | Aufgabe | Wo |
|---|---|---|
| O-A1 | Token aus dem Einreichungsformular als `OPENAI_APPS_CHALLENGE_TOKEN` am Gateway-Service eintragen | Render-Dashboard (Wert wirkt mit dem naechsten Prozessstart, OF-7) |
| O-A2 | Challenge Base URL im Formular = `https://app.sundartha.com` | OpenAI-Portal |
| O-A3 | Nach O-A1 die Erwartungszeile in `scripts/probe-auth.sh` von `404` auf `200` ziehen | Repo, eigener Ein-Zeilen-Commit |
| O-A4 | Name, Kurz-/Langbeschreibung, Logo, Kategorie, Starter-Prompts, Lokalisierung, Laenderverfuegbarkeit, Release Notes, Policy-Attestationen (O-11), Support-Kontakt (O-8), Website-/Support-/Privacy-/Terms-URL (O-7) | OpenAI-Portal - KEINE Codeaenderung in diesem Schnitt |
| O-A5 | Live-Wert von `MCP_UI_ENABLED` am Dienst messen, BEVOR mit UI eingereicht wird (entscheidet ueber T-30/T-31 und O-12) | Render-Dashboard / Live-`tools/list` |

## Erwartungsergebnis und Verifikation

| Aenderung | deterministisches Erwartungsergebnis | Verifikationsbefehl/Testdatei |
|---|---|---|
| A2 Token gesetzt | `GET /.well-known/openai-apps-challenge` = **200**, `await res.text()` === `"s6-token-abc"` (byte-exakt, kein `\n`), `content-type` beginnt mit `text/plain`, kein `www-authenticate` | `test/openai-s6-challenge.test.js`, `startServer({ env: { OPENAI_APPS_CHALLENGE_TOKEN: "s6-token-abc" } })` |
| A2 Koerperform (O-4) | derselbe Aufruf: `JSON.parse(text)` wirft, und `text` enthaelt weder `{` noch `[` noch `"` | dito |
| A2 Env leer | ohne die Env-Variable (BASE_ENV pinnt `""`): **404**, Koerper enthaelt den String `openai` nicht | dito |
| A1 `.trim()` | `OPENAI_APPS_CHALLENGE_TOKEN: "   "` -> **404**; `OPENAI_APPS_CHALLENGE_TOKEN: " s6-token-abc\n"` -> 200 mit Koerper genau `s6-token-abc` | dito |
| A2 kein Schreibpfad | `POST` auf denselben Pfad (Token gesetzt) = **404** (Express-Fall-through, nur `app.get` registriert), Koerper enthaelt den Token nicht | dito |
| A1/A4 Secret-Disziplin | die gesammelte Server-Ausgabe (`srv.output`) enthaelt den Testtoken NICHT; `/healthz`-`configHash` ist mit und ohne gesetzten Token identisch (der Fingerabdruck fasst nur 7 Achsen, `src/config-fingerprint.js:26-34`) | dito |
| A3 Politik-Eintrag | `PUBLIC_ROUTES` enthaelt genau einen Eintrag mit diesem Pfad, mit nicht-leerer `reason`; Klasse = `PUBLIC` | `node --test test/route-auth-inventory.test.js` |
| A4 Fingerprint | Routengraph und `ROUTE_FINGERPRINT` sind deckungsgleich (der Test vergleicht die vollstaendige Liste) | dito |
| A5 Probe-Tabelle | jede Route aus `PUBLIC_ROUTES` steht in der Tabelle; `ART=oeffentlich`, `ANTWORTET=keine`, Begruendung nicht leer | `node --test test/probe-auth-table.test.js` |
| A6 Zaehler | `EXPECTED_TOTAL_KEYS` = 197, `server` = 9, alle Blaetter disjunkt | `node --test test/config-namespaces.test.js` |
| A8 Doku | `grep -c "^OPENAI_APPS_CHALLENGE_TOKEN=" .env.example` = 1 (im neuen Test mitgeprueft, Muster `test/iel-b1-schalter.test.js`) | `test/openai-s6-challenge.test.js` |
| A10/A11 CSP | mcp-nativer Host, `place_call`: `_meta.ui.csp` ist per `deepEqual` **exakt** `{ connectDomains: [], resourceDomains: [] }`; `"frameDomains" in csp` = `false` | `test/mcp-ui.test.js` (neuer Fall bei T-P3-AC1, `:538`) |
| A10/A11 domain | mit `config.server.publicUrl = "https://s6.test"`: `_meta.ui.domain` === `"https://s6.test"`; `_meta.ui.resourceUri` unveraendert | dito |
| A10 fail-safe | mit `config.server.publicUrl = ""`: `"domain" in _meta.ui` = `false`, `csp` weiterhin vorhanden | dito |
| A11 Nicht-Regression ChatGPT | ChatGPT-Host: `_meta["openai/outputTemplate"]` ist weiterhin der flache URI-String und `!_meta.ui` gilt weiter | `test/mcp-ui.test.js:551-562` (T-P3-AC2, **unveraendert** gruen) |
| A10 Widget-HTML unberuehrt | die 5 ausgelieferten HTML-Fassungen sind byte-identisch zum Bestand (der Katalog wird nicht angefasst) | bestehende `test/mcp-ui.test.js`-Faelle + `test/mcp-ui-wing-dedup.test.js` bleiben gruen |
| Gesamtlauf | keine Regression | `npm test -- --test-concurrency=4` (Lehre: volle Parallelitaet macht die Bank rot) |
| Syntax | - | `node --check src/app.js && node --check src/config.js && node --check src/ui/contract.js && node --check src/ui/adapters/mcp-native.js && bash -n scripts/probe-auth.sh` |
| Smoke lokal | `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true OPENAI_APPS_CHALLENGE_TOKEN=abc npm start`, dann `curl -i localhost:3999/.well-known/openai-apps-challenge` -> `200`, `text/plain`, Koerper `abc` ohne Zeilenumbruch (`curl -s ... \| xxd \| tail -1`) | manuell |

## Blast Radius

**Beruehrte Dateien (12).** `src/config.js` (1 Schluessel + 1 Namespace-Eintrag), `src/app.js`
(1 Konstante + 6 Codezeilen), `src/route-policy.js` (1 Eintrag), `src/ui/contract.js`
(1 Konstante + 1 Funktion + 1 Import), `src/ui/adapters/mcp-native.js` (1 Zeile), `.env.example`,
`render.yaml`, `scripts/probe-auth.sh` (1 Zeile), `test/route-auth-inventory.test.js` (1 Zeile),
`test/config-namespaces.test.js` (2 Zahlen), `test/helpers.js` (1 Zeile),
`test/openai-s6-challenge.test.js` (neu) + Faelle in `test/mcp-ui.test.js`.

**Was NICHT beruehrt wird.** Kein Anruf-, SMS- oder Kostenpfad. Kein Gate. Keine Auth-Middleware.
Kein Widget-HTML, kein Katalog, kein ChatGPT-Adapter, keine Resource-Registrierung. Keine
DB-Migration. Keine neue Dependency.

**Reichweite der Route.** Da `/` keinerlei Host-Bindung kennt (`18-host-und-origin.md` PP-D18-02),
ist die Challenge ab dem Deploy unter ALLEN auf den Dienst gerichteten Hosts erreichbar, also auch
unter `vodafone-agent.onrender.com`. Das ist fuer O-4 folgenlos (es ist derselbe eine Token, und nur
wir koennen ihn setzen), aber es heisst: wer den onrender-Host im Portal eintraegt, verifiziert
ebenfalls erfolgreich. Bewusst akzeptiert - eine Host-Weiche waere eine zweite Wahrheit ueber den
eigenen Origin und widerspraeche E-1.

**Reichweite der `_meta`-Aenderung.** `_meta` ist ein Ignore-if-unknown-Feld; heutige Hosts
(claude.ai) lesen `resourceUri` und ignorieren Unbekanntes. Das Risiko ist nicht "ein Host bricht",
sondern "ein Host validiert strenger als erwartet" - deshalb ist der Wert die gemessene Wahrheit
(leere Listen) und keine grosszuegige Angabe.

**Was der Rate-Limiter tut.** Die Route liegt hinter dem globalen Limiter
(`src/app.js:131-136`, `config.safety.rateLimitPerMin`). Ein Verifikations-Abruf ist ein einzelner
GET; bewusst akzeptiert, keine Ausnahme gebaut.

## Pre-Mortem (ein Jahr spaeter, die Entscheidung war falsch)

**PM-1 - Der Token steht im Log und damit in einem Support-Ticket.** Kette: jemand ergaenzt beim
Debuggen ein `console.log(config.server...)` -> der Token liegt in der Render-Log-Historie -> ein
Dritter kann die Domain-Verifikation nachspielen. Entschaerfung: die Log-Negativkontrolle in der
Verifikationstabelle ist ein Test, nicht eine Bitte; der `.env.example`-Text sagt ausdruecklich,
dass der Wert nur an EINER Stelle ausgeliefert wird.

**PM-2 - Die Route liefert 404, obwohl der Token eingetragen ist.** Kette: Owner traegt den Wert
ein -> Render startet den Prozess nicht neu -> Verifikation schlaegt fehl -> Suche im Code statt im
Betrieb. Entschaerfung: OF-7 benennt es, O-A1 nennt den Prozessstart als Bedingung, und der
404-Fall ist per Test von "Route fehlt" unterscheidbar (die Route steht im `ROUTE_FINGERPRINT`,
also ist "nicht gemountet" ausgeschlossen).

**PM-3 - Die CSP war zu eng und der Reviewer sieht eine leere Karte.** Kette: ein spaeteres Widget
laedt doch etwas (Font, Bild, Ping) -> die leeren Listen blocken es -> das Widget ist im Review
kaputt. Entschaerfung: die Messung ist auf 12 Dateien benannt und reproduzierbar; die Naht in A10
sagt, wohin der Wert wandert, wenn ein Widget doch laedt. Zusaetzliche Absicherung waere ein Test,
der die 12 Quellen erneut auf Netz-APIs grept - **nicht Teil dieses Schnitts** (Scope), aber als
Kandidat hier festgehalten.

**PM-4 - `_meta.ui.domain` zeigt auf den falschen Host.** Kette: `PUBLIC_URL` ist live nicht
festgeschrieben -> `publicUrl` faellt auf `RENDER_EXTERNAL_URL` -> `domain` meldet den
onrender-Host, waehrend im Portal `app.sundartha.com` steht -> Ablehnung. Entschaerfung: genau
dieselbe Variable speist schon Token-Audience und PRM (`src/auth.js:23,123`) - der Defekt waere
nicht neu, sondern derselbe, den S2-A9 schliesst. Abhaengigkeit unten notiert.

## Beruehrte absolute Regeln

- **Regel 3 (AUTH FAIL-CLOSED):** eine neue oeffentliche Route. Die drei von CLAUDE.md verlangten
  Stuecke sind geplant: eigene Absicherung (es gibt nichts zu schuetzen - ein einzelner, fuer die
  Oeffentlichkeit bestimmter Verifikations-Token; kein Zustand, kein Schreibpfad, kein
  Tenant-Bezug), Begruendungs-Kommentar im Code (A2) und Eintrag in `src/route-policy.js` (A3);
  dazu die zwei weiteren Zwangspunkte A4/A5.
- **Regel 4 (SECRETS):** der Token kommt ausschliesslich aus der Env und wird NIE geloggt, NIE in
  eine andere Antwort geschrieben, NIE in eine MCP-Ausgabe gelegt. Besonderheit, die benannt sein
  muss: seine Bestimmung IST die oeffentliche Auslieferung an genau diesem einen Pfad - das ist
  keine Aufweichung der Regel, sondern die Anforderung O-4. Er fliesst nicht in
  `configFingerprint` (`src/config-fingerprint.js:26-34`) und nicht nach `/healthz`.
- **Regel 6 (SCOPE):** X-5 (`ui/initialize`-Handshake, `protocolVersion "2026-01-26"`) ist
  Bestandteil von P1-50, aber NICHT dieses Auftrags ("Widget-Pflichtfelder") - bewusst nicht
  geplant, siehe OF-8.
- **Regeln 1, 2, 5, 7:** unberuehrt. Kein Gate, kein Offenlegungssatz, kein Audio, kein Ratespiel
  (jede Aussage oben mit `datei:zeile`).

## Abhaengigkeiten

1. **E-1 ist Voraussetzung und erfuellt** (`PLAN-OPENAI.md:18`). Ohne sie saesse die Route
   moeglicherweise auf dem falschen Host.
2. **S2-A9 (`PUBLIC_URL` festschreiben) sollte vor oder mit A10 landen.** `_meta.ui.domain` leitet
   sich davon ab. Live gemessen am 18.09. traegt `PUBLIC_URL` bereits
   `https://app.sundartha.com` (`PLAN-OPENAI.md:94-95`) - es ist ein Soll-Ist-Vergleich, kein
   Neutippen. A2/A3/A4/A5 (die Challenge-Route) haengen NICHT daran und koennen ohne A9 landen.
3. **O-A5 (Live-Wert `MCP_UI_ENABLED`) entscheidet, ob A10/A11 fuer die Einreichung ueberhaupt
   relevant sind.** Der Code-Teil ist davon unabhaengig korrekt; ist der Schalter live aus, traegt
   kein Deskriptor `_meta.ui` und es wird ohne UI eingereicht (dann gilt O-12: keine Screenshots).
4. **Keine Abhaengigkeit zu S1-S5.** Der Schnitt beruehrt keine Datei, die dort geaendert wird -
   ausser `test/helpers.js` (BASE_ENV) und `test/config-namespaces.test.js` (Zaehler), beide
   klassische Merge-Konflikt-Kandidaten. A6 deshalb am gemergten Stand neu messen.

## Offene Fragen

- **OF-1: Akzeptiert OpenAI `sundartha.com` als Parent-Host fuer eine Challenge zu
  `app.sundartha.com`?** UNKNOWN. O-5 sagt "MCP-Hostname oder ein Parent-Host", ohne "Parent" zu
  definieren (`00-openai-anforderungen.md:100`, gleichlautend
  `tasks/OPENAI-MCP-READINESS.md:549`). Dieser Schnitt plant AUSSCHLIESSLICH
  `app.sundartha.com`. Faellt die Verifikation dort durch, ist die Route auf dem Parent
  nachzuziehen - dieselben 12 Zeilen auf dem Web-Service (`apps/web`), das ist ein eigener Schnitt.
- **OF-2: Erfuellt der Server-Origin T-31 "pro Plugin eindeutig"?** UNKNOWN. T-31
  (`:64`) verlangt einen "eigenen, pro Plugin eindeutigen Origin" und zitiert "must be unique per
  plugin"; unser Origin ist zugleich MCP-Endpunkt und Dashboard-Host. Owner-Entscheidung
  2026-09-18: bewusst so einreichen und eine etwaige Ablehnung als Messung nehmen, statt vorab eine
  eigene Widget-Subdomain aufzubauen.
- **OF-3: Gelten T-30/T-31 fuer einen reinen Developer-Mode-Connector oder nur fuer die
  oeffentliche Einreichung?** Nicht auffindbar - die Anforderungsdoku trennt es selbst nicht
  (`00-openai-anforderungen.md:180-182` Punkt 10; uebernommen in
  `tasks/openai-audit/17-resources-flaeche.md:70`).
- **OF-4: Erwartet OpenAI `csp`/`domain` am TOOL-`_meta` oder am RESOURCE-`_meta`?** UNKNOWN.
  T-30/T-31 nennen `_meta.ui.csp`/`_meta.ui.domain` ohne Traeger; `17-resources-flaeche.md:56`
  fuehrt sie als "UI-Resource-Anforderungen", belegt die Luecke aber an den Adaptern, also am
  Tool-`_meta`. Dieser Schnitt setzt sie dort, wo `resourceUri` schon liegt (EINE Stelle). Stellt
  sich das Resource-`_meta` als der erwartete Ort heraus, ist die Ergaenzung ein Ein-Zeilen-Nachzug
  in `makeUiRenderer.registerResource` (`src/ui/contract.js:76-82`).
- **OF-5: Akzeptiert der Validator LEERE `connectDomains`/`resourceDomains`, und muss das
  `data:`-Schema deklariert werden?** UNKNOWN. T-30 spricht von "Domains"; `data:` ist ein Schema,
  keine Domain, und die Widgets nutzen es fuer zwei Bilder. Falls der Validator eine nicht-leere
  Liste oder eine `data:`-Deklaration verlangt, ist die Aenderung ein Wert in `UI_CSP` - die
  Struktur bleibt.
- **OF-6: Live-Wert von `MCP_UI_ENABLED`.** UNKNOWN am Repo (kein Eintrag in `render.yaml`,
  dashboard-verwaltet, `render.yaml:14-17`). Loeser: Owner (O-A5).
- **OF-7: Wirkt ein im Render-Dashboard nachgetragener Token ohne manuelles Zutun?** Der Wert wird
  beim Prozessstart gelesen (A1, Konvention aus CLAUDE.md). Ob Render bei einer Env-Aenderung
  selbst neu startet, ist im Repo NICHT belegt -> UNKNOWN. Praktischer Weg, falls nicht:
  manueller Deploy/Restart. Ein Per-Request-`process.env`-Lesen waere die Alternative, wurde aber
  bewusst verworfen (zweite Konfigurationsquelle neben `src/config.js`).
- **OF-8: X-5 (`ui/initialize`-Handshake, `protocolVersion "2026-01-26"`) bleibt offen.** Teil von
  P1-50 (`PLAN-OPENAI.md:167`), aber nicht Teil dieses Auftrags. `grep "ui/initialize" src/ui/*` =
  0 Treffer (`tasks/OPENAI-MCP-READINESS.md:527`). Braucht einen eigenen Schnitt MIT Live-Beleg
  gegen einen echten Host - die Warnung in `src/ui/registry.js:29-34` (ungetesteter Brueckenbau hat
  schon einmal live gebrochen) gilt genau hier.
- **OF-9: Zweites Plugin auf demselben Host.** Nach O-5 unmoeglich (ein Host, ein Token). Braucht
  eine eigene Subdomain; kuenftige Entscheidung, hier ausdruecklich nicht geplant.
