# E7 - Domain-Challenge und Widget-Pflichtfelder (Implementierungs-Spec)

**Grundlage:** `tasks/openai-fix/S6-challenge-und-metadaten.md`, `PLAN-OPENAI.md` Etappe 7.
**Zielstand:** `master` am Merge-Commit `87b8ec1` (E8 gelandet). Alle Ist-Zahlen in dieser Spec
sind AN DIESEM STAND gemessen, nicht aus S6 uebernommen.
**Blocker, die fallen:** P0-2 (Anforderungen O-4, O-5); bei Einreichung MIT UI zusaetzlich der
`_meta`-Teil von P1-50 (T-30, T-31).
**Nicht Teil dieses Auftrags:** X-5 (`ui/initialize`-Handshake) - eigener Schnitt, s. Verbote.

Diese Spec ist so geschrieben, dass sie ohne Rueckfrage abgearbeitet werden kann. Wo eine Frage
offen bleibt, steht sie unter "UNKNOWN" - dort wird gebaut, was fail-closed ist, und der Befund
wandert in den Report.

---

## 0. Bindende Vorgaben (Owner-entschieden, NICHT neu diskutieren)

Diese sechs Punkte sind entschieden. Wer sie beim Bauen in Frage stellt, hat den Auftrag
verfehlt; die Begruendungen stehen in S6 und werden hier nicht wiederholt, sondern angewandt.

1. **Challenge-Route.** `GET /.well-known/openai-apps-challenge`. Content-Type `text/plain`.
   Antwortkoerper = **exakt der Token-Wert**, kein Whitespace drumherum, kein Zeilenumbruch, kein
   JSON, keine Liste. Der Wert kommt aus der Env-Variablen `OPENAI_APPS_CHALLENGE_TOKEN`. Ist sie
   leer, nur Whitespace oder ungesetzt: **404** (fail-closed; von aussen nicht von "Route existiert
   nicht" unterscheidbar). Die Route ist oeffentlich und braucht deshalb einen Eintrag in der
   Oeffentlich-Liste `src/route-policy.js` PLUS Begruendungs-Kommentar im Code (absolute Regel 3).
2. **`_meta.ui.domain` = `https://app.sundartha.com`.**
3. **`_meta.ui.csp` mit LEEREN Listen.** Gemessen (s. Abschnitt 1.2): die Widgets laden von
   nirgendwo. Jede zusaetzlich eingetragene Domain waere eine Falschangabe.
4. **Genau EIN Plugin auf diesem Host.** O-5 ignoriert den Pfad; die Challenge gilt dem HOST. Die
   Route liefert einen Skalar - keine Liste, kein Mandanten-Schluessel, kein Pfad-Parameter.
5. **`MCP_UI_ENABLED` ist im Live-Betrieb UNKNOWN.** Der Code-Teil A9/A10 ist davon unabhaengig
   korrekt. Die Umsetzung MUSS im Report ausdruecklich vermerken, dass offen bleibt, ob die Widgets
   ueberhaupt ausgeliefert werden (Details in Abschnitt 6).
6. **Formular-Eingaben sind KEIN Code.** Name, Kurz-/Langbeschreibung, Logo, Kategorie,
   Starter-Prompts, Support-URL, Terms-URL, Privacy-URL, Website-URL, Release Notes,
   Policy-Attestationen, Laenderverfuegbarkeit: alles Owner-Aufgabe im OpenAI-Portal. In diesem
   Schnitt wird dafuer **nichts gebaut** - keine Route, keine Datei, kein Feld, kein Platzhalter.

### 0.1 Aufloesung zu Vorgabe 2 (damit die Umsetzung nicht raet)

`_meta.ui.domain` wird **aus `config.server.publicUrl` abgeleitet** und NICHT als zweite
Env-Variable gefuehrt. Das erfuellt Vorgabe 2 woertlich, weil der Live-Wert von `PUBLIC_URL` genau
`https://app.sundartha.com` ist (Owner-Entscheidung E-1, festgeschrieben in `render.yaml:713-714`)
und `PUBLIC_URL` seit E5/E8 boot-gesichert ist:

- `src/config.js:2506-2508` - leerer oder `CHANGE-ME`-haltiger `PUBLIC_URL` verweigert in
  Produktion den Boot.
- `src/config.js:2447` + `src/boot-guard.js:933,939` - die Audience-Divergenz gegen
  `kanonischeAudience(cfg.server.publicUrl)` ist fatal.

Ein eigenes `OPENAI_UI_DOMAIN` waere eine zweite Wahrheit ueber den eigenen Origin und ist
**verboten** (Abschnitt 8). Fehlt `publicUrl` (nur lokal moeglich), entfaellt das Feld, statt einen
falschen Origin zu behaupten.

---

## 1. Ist-Zustand, am Zielstand gemessen

### 1.1 Challenge-Route

Es gibt sie nicht (`grep -rn "openai-apps-challenge" src/` = 0 Treffer). Das Muster fuer eine
oeffentliche Well-Known-Route existiert vollstaendig und ist dreifach verzahnt:

| Stelle | Datei:Zeile | Inhalt |
|---|---|---|
| Registrierung | `src/auth.js:121-129` (`registerWellKnown`), gerufen aus `src/app.js:167` | zwei PRM-Routen, beide als **Stringliteral** |
| Politik | `src/route-policy.js:83-95` | zwei Eintraege, Begruendung "muss per Spezifikation ohne Login erreichbar sein" |
| Fingerprint | `test/route-auth-inventory.test.js:177-178` | `"GET /.well-known/oauth-protected-resource"` und `.../mcp` |
| Live-Probe | `scripts/probe-auth.sh:90-91` | zwei `oeffentlich|GET|...|200|keine|...`-Zeilen |

`registerPublicRoutes` (`src/app.js:144-179`) ist per eigenem Kopfkommentar der Ort fuer "Routen,
die vor jeder Identitaet erreichbar sein muessen", laeuft vor `registerPathRedirects` und vor dem
statischen Serving, und hat `config` bereits in der Signatur.

Konstanten am Dateikopf von `src/app.js`: `LOGIN_PATH` (`:66`), `VOICE_PATH_PREFIX` (`:72`),
`HTTP_FOUND` (`:76`), `HTTP_BAD_REQUEST` (`:77`), `HTTP_SERVER_ERROR` (`:78`). Ein `HTTP_NOT_FOUND`
existiert dort **nicht**.

### 1.2 Widget-Ladeverhalten (Gegenmessung an `87b8ec1`, nicht aus S6 uebernommen)

Gemessen ueber die 5 Widget-Quellen `src/ui/widgets/{agent-status,my-number,calls,calendar,call}.html`
und die injizierten Bausteine `src/ui/widget-bind.js`, `wing-canvas-engine.js`,
`wing-canvas-mount-idle.js`, `widget-i18n.js`, `hud-card-css.js`, `wing-markup.js`,
`wing-image-data.js`:

| Gemessen | Ergebnis am Zielstand |
|---|---|
| `fetch(`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`, `importScripts`, `@font-face`, `<iframe`, `<embed`, `<object` | **0 Treffer** in allen 12 Dateien |
| absolute URLs (`https?://...`) | **genau 1**: `http://www.w3.org` in `src/ui/widgets/call.html:114` - SVG-XML-Namespace INNERHALB eines `data:`-URI, kein Ladevorgang |

Positiv-Kontrolle des Suchbefehls mitgefuehrt (`grep -rlE "fetch\(" src/` liefert
`src/web-auth.js`, `src/mcp-tools.js`, `src/auth.js`) - "nichts gefunden" ist hier also ein Befund
und kein blindes Kommando (Lehre `pruefkommando-ohne-positiv-kontrolle`).

**Folge: beide CSP-Listen sind leer. Das ist die gemessene Wahrheit, keine Bequemlichkeit.**

### 1.3 `_meta` heute

- `src/ui/contract.js:60-78` (`makeUiRenderer`) baut `toolMeta: (widgetId) => ({ [metaKey]: buildMeta(uri) })`.
- MCP-nativ: `src/ui/adapters/mcp-native.js:10-14`, `buildMeta: (uri) => ({ resourceUri: uri })` -> `_meta.ui = { resourceUri }`.
- ChatGPT/Skybridge: `src/ui/adapters/chatgpt.js:8-12`, flacher String unter `_meta["openai/outputTemplate"]`.
- Konsumiert an EINER Stelle: `src/mcp-tools.js:718-725` (`enableWidgetUi`), fail-closed `{}`.

**Korrektur zu S6 (dort aus einem veralteten Testkommentar uebernommen):** `enableWidgetUi` wird
an **fuenf** Stellen aufgerufen, nicht an einer - `src/mcp-tools.js:929` (`place_call`, `WIDGET_CALL`),
`:1194` (`WIDGET_MY_NUMBER`), `:1223` (`WIDGET_CALLS`), `:1303` (`WIDGET_CALENDAR`), `:1343`
(`WIDGET_AGENT_STATUS`). Die Aenderung A9/A10 wirkt also auf **fuenf** Tool-Deskriptoren. Der
Kommentar bei `test/mcp-ui.test.js:525-528` ("ausschliesslich place_call") ist am Zielstand falsch;
er wird in diesem Schnitt **nicht** angefasst (Scope), aber der Report nennt ihn als Befund.

Welcher Adapter liefert die Deskriptoren, die ein ChatGPT-Host sieht? Der **MCP-native**.
`src/ui/registry.js:43-49` waehlt `chatgptRenderer` nur bei deklariertem Skybridge-mimeType;
`src/routes/mcp.js:104` speist die Capabilities aus `req.body?.params?.capabilities`, und im
Stateless-Modus (`src/routes/mcp.js:22`) traegt nur der initialize-POST dieses Feld. Auf genau dem
Request, der die Tool-Deskriptoren ausliefert, gewinnt also der Default `mcpNativeRenderer`.
**Deshalb: die zwei Pflichtfelder gehoeren in die MCP-native `_meta.ui`-Form; der ChatGPT-Adapter
bleibt unberuehrt** (haelt zugleich den Pin `test/mcp-ui.test.js:562` gruen).

### 1.4 Gemessene Zwangspunkt-Ist-Werte (Stand `87b8ec1`)

| Zwangspunkt | Datei | IST | SOLL nach diesem Schnitt |
|---|---|---|---|
| Namespace-Zaehler `server` | `test/config-namespaces.test.js:141` | `server: 8` | `server: 9` |
| Namespace-Gesamtzahl | `test/config-namespaces.test.js:203` | `EXPECTED_TOTAL_KEYS = 198` | `199` |
| Routen-Fingerprint | `test/route-auth-inventory.test.js:174-248` | **65** Eintraege | **66** |
| Oeffentlich-Liste | `src/route-policy.js:83` (`PUBLIC_ROUTES`) | **31** Eintraege | **32** |
| Probe-Erwartungstabelle | `scripts/probe-auth.sh:86-159` | **71** Zeilen | **72** |
| `BASE_ENV`-Pin | `test/helpers.js:55-561` | kein `OPENAI_APPS_CHALLENGE_TOKEN` | 1 Zeile ergaenzt |
| Env-Doku | `.env.example` (1119 Zeilen) | 0 Treffer | 1 Block ergaenzt |
| Blueprint-Referenz | `render.yaml` (Gateway-Block, Muster `:156-157`) | 0 Treffer | 1 `key`/`sync: false` ergaenzt |
| Config-Schluessel | `src/config.js:2289` (`server: [...]`) | 8 Keys | 9 Keys |

**Pflicht vor dem Merge:** die beiden Zahlen in `test/config-namespaces.test.js` am dann
gemergten Stand **neu messen**, nicht aus dieser Tabelle uebernehmen. Der Kommentarblock dort
(`test/config-namespaces.test.js:189-192`) dokumentiert einen realen Vorfall: zwei Ketten zaehlten
unabhaengig aus, schrieben beide dieselbe Zahlzeile, Git fuehrte sie stillschweigend zusammen und
die Summe war um 2 zu niedrig.

---

## 2. Soll-Zustand (Abnahme des Gesamtschnitts)

1. `GET /.well-known/openai-apps-challenge` liefert bei gesetztem `OPENAI_APPS_CHALLENGE_TOKEN`
   **200**, `content-type` beginnt mit `text/plain`, Koerper = byte-exakt der Token, ohne `\n`.
2. Bei leerer, nur-Whitespace oder ungesetzter Variable: **404**, Koerper enthaelt weder den Token
   noch den String `openai`.
3. Die Route steht in `src/route-policy.js` mit Begruendung, im `ROUTE_FINGERPRINT` und in der
   Erwartungstabelle der Live-Probe. `npm test` ist gruen.
4. Jeder Tool-Deskriptor, der heute `_meta.ui.resourceUri` traegt (fuenf Stueck), traegt
   zusaetzlich `_meta.ui.csp = { connectDomains: [], resourceDomains: [] }` und - sofern
   `config.server.publicUrl` gesetzt ist - `_meta.ui.domain = <publicUrl>`.
5. ChatGPT-Adapter, Widget-Katalog, Widget-HTML und Resource-Registrierung bleiben
   **byte-identisch**.

---

## 3. Aenderungen, einzeln abarbeitbar

Reihenfolge ist die Abarbeitungsreihenfolge. Jeder Punkt: Datei - konkrete Aenderung -
Abnahmekriterium.

### A1 - `src/config.js`: Token zentralisieren

**Datei:** `src/config.js`
**Aenderung:** Neuer Schluessel im Config-Objekt, Muster `elevenLabsToolToken` (`:785`) bzw.
`initWebhookToken` (`:898`) - beide mit `.trim()`:

```js
openaiAppsChallengeToken: (process.env.OPENAI_APPS_CHALLENGE_TOKEN || "").trim(),
```

Ablageort im Objekt: im `server`-nahen Block bei `publicUrl`/`deployedCommit` (`:1497-1509`).
Kommentar auf Deutsch ohne Umlaute, der drei Dinge sagt: (a) `.trim()`, weil ein beim Einfuegen
mitgenommener Zeilenumbruch Teil des "exakten Tokens" waere und die Verifikation unsichtbar
scheitern liesse; (b) der Wert wird beim Prozessstart gelesen - ein spaeter im Render-Dashboard
eingetragener Token wirkt erst mit dem naechsten Start; (c) er authentifiziert niemanden, er ist
ein statischer Eigentumsnachweis fuer den HOST.

Zusaetzlich Aufnahme in `CONFIG_NAMESPACES` (`src/config.js:2289`) unter **`server`** (nicht
`auth`): der Wert autorisiert nichts; er gehoert zu `publicUrl`/`isProduction`/`deployedCommit`.

**Bewusst NICHT:** kein Boot-Guard, kein Eintrag in `PRODUCTION_FOOTGUNS`, kein Pflichtfeld. Der
Token existiert erst nach der Portal-Eingabe; ein Riegel wuerde den Dienst an einer
Einreichungs-Vorbereitung sterben lassen (und damit `/voice`, also Inbound-Telefonie, mit).

**Abnahme:** `node --check src/config.js`; `config.server.openaiAppsChallengeToken` ist bei
gesetzter Env der getrimmte Wert und sonst `""`; `node --test test/config-namespaces.test.js` gruen
nach A5.

### A2 - `src/app.js`: die Route

**Datei:** `src/app.js`
**Aenderung 1 (Kopf, bei `:76-78`):** `const HTTP_NOT_FOUND = 404;` ergaenzen. Magic Number ist
verboten; das Muster steht direkt daneben (`HTTP_FOUND`, `HTTP_BAD_REQUEST`, `HTTP_SERVER_ERROR`).

**Aenderung 2 (Kopf, bei `:66-72`):** benannte Pfad-Konstante ergaenzen:

```js
// O-4: der Pfad ist woertlich vorgeschrieben - kein Praefix, kein Suffix, kein Tenant-Segment.
const OPENAI_CHALLENGE_PATH = "/.well-known/openai-apps-challenge";
```

**Aenderung 3:** in `registerPublicRoutes` (`:144-179`), **direkt vor** `registerWellKnown(app)`
(`:167`):

```js
// ---- GET /.well-known/openai-apps-challenge: Domain-Ownership (O-4/O-5) -------
// AUTH-AUSNAHME (Regel 3, begruendet): OpenAI ruft diesen Pfad ohne jede Identitaet ab -
// der Zweck IST die unauthentifizierte Abholbarkeit. Eintrag in src/route-policy.js.
// Antwortet NUR mit dem zugewiesenen Klartext-Token: kein JSON, keine Liste, kein
// Zeilenumbruch (O-4 woertlich). Leerer/ungesetzter Wert -> 404 wie eine nicht
// existierende Route: fail-closed und ohne zu verraten, dass hier etwas vorbereitet ist.
// EIN Wert, weil der Pfad laut O-5 ignoriert wird - die Challenge gilt dem HOST.
app.get(OPENAI_CHALLENGE_PATH, (_req, res) => {
  const token = config.server.openaiAppsChallengeToken;
  if (!token) return res.status(HTTP_NOT_FOUND).end();
  res.type("text/plain").send(token);
});
```

**Warum hier und nicht in `src/auth.js`:** `registerWellKnown` ist der OAuth-Resource-Server
(RFC 9728, eigener Kopfkommentar `src/auth.js:119-120`); eine Einreichungs-Challenge hat mit Auth
nichts zu tun. Kein neues Modul fuer 12 Zeilen.

**Warum Laufzeit-Pruefung und nicht bedingte Registrierung:** eine nur-bei-Token gemountete Route
verschwaende aus dem geprueften Routengraph - `src/route-policy.js:19-21` nennt genau diese Klasse
als BLIND; der Inventar-Test saehe sie nie.

**Abnahme:** `node --check src/app.js`; die HTTP-Faelle aus Abschnitt 4.

### A3 - `src/route-policy.js`: Politik-Eintrag

**Datei:** `src/route-policy.js`
**Aenderung:** in `PUBLIC_ROUTES` (`:83`), direkt nach den zwei `.well-known`-Eintraegen
(`:86-95`):

```js
{
  method: "GET",
  path: "/.well-known/openai-apps-challenge",
  reason:
    "Domain-Ownership-Challenge der OpenAI-Einreichung (O-4/O-5) - der Zweck IST die " +
    "unauthentifizierte Abholbarkeit. Liefert einen einzigen, von OpenAI zugewiesenen " +
    "Verifikations-Token als Klartext und sonst nichts: keine Tenant-Daten, kein Zustand, " +
    "kein Schreibpfad, kein Query-Echo. Bei leerer Env antwortet sie 404.",
},
```

**Pfad als Literal, nicht als Import - Entscheidung, nicht Versehen.** Beide benachbarten
`.well-known`-Routen stehen ebenfalls als Literal in `src/auth.js:127-128` UND in
`src/route-policy.js:89,94`; es gibt fuer sie keine benannte Konstante. Die Regel in
`src/route-policy.js:24-26` verlangt einen Import nur fuer Pfade, fuer die es bereits eine
exportierte Konstante gibt. `OPENAI_CHALLENGE_PATH` in `src/app.js` ist modul-lokal; ein Export
plus Import wuerde `src/route-policy.js` (bewusst ohne Laufzeit-Konsument, `:10-14`) an den
kompletten `src/app.js`-Modulgraph haengen und eine spaetere Zyklus-Falle aufstellen. Die
Duplizierung ist zudem **mechanisch bewacht**: weicht eines der beiden Literale ab, faellt die
Route in Klasse `UNPROTECTED` und `ROUTE_FINGERPRINT` weicht ab - `npm test` ist sofort rot.
**Naht fuer spaeter:** braucht ein dritter Ort den Pfad, wandert er nach dem Muster von
`src/portal-paths.js` in ein Blatt-Konstantenmodul.

**Abnahme:** `node --test test/route-auth-inventory.test.js` gruen; `PUBLIC_ROUTES.length === 32`;
genau ein Eintrag mit diesem Pfad, `reason` nicht leer.

### A4 - `test/route-auth-inventory.test.js`: Fingerprint nachziehen

**Datei:** `test/route-auth-inventory.test.js`
**Aenderung:** in `ROUTE_FINGERPRINT` (`:174-248`) **nach** `"GET /.well-known/oauth-protected-resource/mcp"`
(`:178`) einfuegen - alphabetisch korrekt, weil `oa` < `op`:

```js
// E7: Domain-Ownership-Challenge der OpenAI-Einreichung (O-4/O-5). Klasse PUBLIC,
// Eintrag in src/route-policy.js. Ohne gesetzten Token antwortet sie 404 - gemountet
// ist sie trotzdem immer (bedingte Registrierung waere im Graph unsichtbar).
"GET /.well-known/openai-apps-challenge",
```

**Ist -> Soll:** 65 -> 66 Eintraege.

**Abnahme:** `node --test test/route-auth-inventory.test.js` gruen (der Test vergleicht die
vollstaendige Liste gegen den realen Graph).

### A5 - `test/config-namespaces.test.js`: Zaehler nachziehen

**Datei:** `test/config-namespaces.test.js`
**Aenderung 1:** `EXPECTED_NAMESPACE_COUNTS.server` (`:141`) von `8` auf `9`, mit Kommentarzeile im
dortigen Stil, z.B.: `// E7: openaiAppsChallengeToken ergaenzt (Domain-Ownership-Token) -> 9.`
**Aenderung 2:** `EXPECTED_TOTAL_KEYS` (`:203`) von `198` auf `199`, mit Kommentarzeile:
`// E7: openaiAppsChallengeToken (server) ergaenzt -> 199.`

**Ist -> Soll:** `server` 8 -> 9; Gesamt 198 -> 199. **Vor dem Merge neu messen** (s. 1.4).

**Abnahme:** `node --test test/config-namespaces.test.js` gruen.

### A6 - `test/helpers.js`: `BASE_ENV`-Pin

**Datei:** `test/helpers.js`
**Aenderung:** in `BASE_ENV` bei den Token-Pins (Muster `ELEVENLABS_INIT_WEBHOOK_TOKEN: ""`,
`:300`):

```js
// E7: neutral LEER, sonst leakt ein lokal in .env eingetragener Challenge-Token via dotenv
// in JEDEN Spawn-Test (Lehre test-base-env-drift) - der 404-Fall (Normalfall der Suite)
// waere dort still ein 200. Der Positiv-Test setzt den Wert per env-Override.
OPENAI_APPS_CHALLENGE_TOKEN: "",
```

**Das ist nicht optional.** `dotenv` fuellt nur ungesetzte Variablen; ohne den Pin ist der
Negativ-Test auf der Maschine des Owners gruen und in CI rot (oder umgekehrt).

**Abnahme:** ein Spawn-Test ohne expliziten Override sieht 404.

### A7 - `.env.example`: Dokumentation

**Datei:** `.env.example`
**Aenderung:** eigener Block, Muster `.env.example:322-326` (MCP Rich-UI). Inhalt:

```
# ---- OpenAI-Einreichung: Domain-Ownership-Challenge (E7 / O-4, O-5) ----
# Von OpenAI im Einreichungsformular erzeugter Verifikations-Token. Wird UNVERAENDERT unter
# GET /.well-known/openai-apps-challenge als Klartext ausgeliefert - das ist seine Bestimmung
# (Regel 4 gilt trotzdem: NIE loggen, NIE in eine andere Antwort, NIE in eine MCP-Ausgabe).
# Leer/ungesetzt = die Route antwortet 404. Genau EIN Wert je Host: O-5 ignoriert den Pfad,
# die Challenge gilt dem HOST. Wird beim Prozessstart gelesen - ein nachgetragener Wert
# wirkt erst mit dem naechsten Start des Dienstes.
OPENAI_APPS_CHALLENGE_TOKEN=
```

**Abnahme:** `grep -c "^OPENAI_APPS_CHALLENGE_TOKEN=" .env.example` = 1 (im neuen Test mitgeprueft,
Muster `test/iel-b1-schalter.test.js`).

### A8 - `render.yaml`: Blueprint-Referenz

**Datei:** `render.yaml`
**Aenderung:** im Gateway-`envVars`-Block, Muster `render.yaml:156-157`
(`ELEVENLABS_INIT_WEBHOOK_TOKEN` / `sync: false`):

```yaml
      # E7 (O-4/O-5): Domain-Ownership-Token der OpenAI-Einreichung. Wird im Dashboard
      # gesetzt (der Dienst ist dashboard-verwaltet, s. Kopf dieser Datei) - ein value:
      # hier waere eine zweite Wahrheit. Leer = die Challenge-Route antwortet 404.
      - key: OPENAI_APPS_CHALLENGE_TOKEN
        sync: false
```

**Abnahme:** YAML parst; `grep -c "OPENAI_APPS_CHALLENGE_TOKEN" render.yaml` >= 1.

### A9 - `src/ui/contract.js`: die zwei Pflichtfelder, EINE Quelle

**Datei:** `src/ui/contract.js`
**Aenderung:** neben den bestehenden Protokoll-Konstanten (`:9-20`) - `contract.js` ist per
Kopfkommentar (`:1-6`) "EINZIGE Stelle, die die Protokoll-Strings kennt". Dazu ein
`import { config } from "../config.js";` (kein Zyklus: `src/config.js` importiert nichts aus
`src/ui/` - gepruefte Importliste `src/config.js:1-29`).

```js
// T-30: die CSP muss EXAKT die Domains nennen, von denen die Komponente laedt. Gemessen
// ueber alle 5 Widget-Quellen und alle injizierten Bausteine (12 Dateien): sie laden von
// NIRGENDWO - 0 Treffer fuer fetch/XHR/WebSocket/EventSource/sendBeacon/importScripts,
// kein @font-face, keine absolute URL (die einzige, http://www.w3.org, ist der
// SVG-Namespace INNERHALB eines data:-URI, widgets/call.html:114), Bilder nur als
// data:-URI, kein iframe. Beide Listen sind deshalb LEER - eine weitere Angabe waere eine
// Falschangabe. frameDomains entfaellt (laut T-30 optional, 0 Frames). Der einzige
// Aussenkanal ist parent.postMessage (widget-bind.js) - kein Netz-Ladevorgang, von einer
// CSP nicht adressiert.
export const UI_CSP = Object.freeze({
  connectDomains: Object.freeze([]),
  resourceDomains: Object.freeze([]),
});

// T-31: pro Plugin eindeutiger Origin. Owner-Entscheidung: der Server-Origin, abgeleitet aus
// config.server.publicUrl - KEIN eigenes Env, damit es keine zweite Wahrheit ueber den eigenen
// Origin gibt (derselbe Wert speist Token-Audience, PRM und die /mcp-Herkunftswache). Live ist
// das https://app.sundartha.com (E-1, render.yaml); leerer PUBLIC_URL verweigert in Produktion
// ohnehin den Boot (config.js PRODUCTION_FOOTGUNS). Fehlt er lokal, entfaellt das Feld, statt
// einen falschen Origin zu behaupten.
export function uiSubmissionMeta() {
  const domain = config.server.publicUrl;
  return domain ? { csp: UI_CSP, domain } : { csp: UI_CSP };
}
```

**Warum ein Objekt und keine Streuung ueber den Katalog:** die Messung ist fuer alle fuenf Widgets
identisch. Ein Feld pro Katalog-Eintrag (`src/ui/widget-catalog.js`) waere fuenfmal derselbe Wert.
**Naht fuer spaeter:** laedt ein kuenftiges Widget tatsaechlich von aussen, wandert der Wert als
Feld in `WIDGET_DEFS` und `uiSubmissionMeta` bekommt die `widgetId` als Argument; die Aufrufstelle
(A10) bleibt dieselbe.

**Wichtig:** `uiSubmissionMeta()` liest `config.server.publicUrl` **zur Aufrufzeit**, nicht zur
Modul-Ladezeit. Das ist Pflicht - die Namespace-Getter in `src/config.js` sind Getter auf einen
gemeinsamen Speicher-Slot, und die In-Process-Tests setzen den Wert nach dem Import.

**Abnahme:** `node --check src/ui/contract.js`; die `_meta`-Faelle aus Abschnitt 4.

### A10 - `src/ui/adapters/mcp-native.js`: anhaengen an `_meta.ui`

**Datei:** `src/ui/adapters/mcp-native.js`
**Aenderung:** `:13`, `buildMeta`, plus Import:

```js
import { UI_MIME, UI_META_KEY, makeUiRenderer, uiSubmissionMeta } from "../contract.js";
...
  buildMeta: (uri) => ({ resourceUri: uri, ...uiSubmissionMeta() }),
```

**Warum genau hier und nur hier:** `_meta.ui` ist die Form, die T-30/T-31 woertlich nennen, die
T-23 bevorzugt, und die ein ChatGPT-Host auf dem `tools/list`-Request tatsaechlich bekommt (Beleg
in 1.3).
**Bewusst NICHT im ChatGPT-Adapter:** dessen `_meta` ist ein flacher String
(`src/ui/adapters/chatgpt.js:11`); ein verschachteltes `ui` daneben waere eine zweite Meta-Form
fuer dieselbe Aussage, und der Pin `test/mcp-ui.test.js:562` (`!meta.ui`) muesste gedreht werden -
ein Rueckbau ohne Live-Beleg gegen einen echten ChatGPT-Host, also genau das Muster, das
`src/ui/registry.js:17-34` als schon einmal live gebrochen dokumentiert.

**Abnahme:** die `_meta`-Faelle aus Abschnitt 4; `test/mcp-ui.test.js` T-P3-AC2 bleibt
**unveraendert** gruen.

### A11 - `scripts/probe-auth.sh`: Erwartungszeile der Live-Probe

**Datei:** `scripts/probe-auth.sh`
**Aenderung:** im Tabellenblock (`:86-159`), direkt nach den zwei `.well-known`-Zeilen (`:90-91`):

```
oeffentlich|GET|/.well-known/openai-apps-challenge|404|keine|Domain-Ownership-Token nicht gesetzt; Route existiert (O-4)
```

**Ist -> Soll:** 71 -> 72 Tabellenzeilen.

**Warum 404 und nicht 200:** die Probe misst den DEPLOYTEN Zustand, und dort ist der Token noch
nicht eingetragen. Praezedenz fuer eine oeffentliche Route mit erwartetem 404:
`scripts/probe-auth.sh:97` (`/voice/tts/:token`). Die Widerspruchsregeln von
`test/probe-auth-table.test.js:124-158` binden den Status nur fuer `ART=sitzung` und `ART=fehlt`;
fuer `oeffentlich` ist jeder gueltige HTTP-Code zulaessig. `ANTWORTET=keine` ist Pflicht (eine als
oeffentlich begruendete Route antwortet selbst).
**Folgeschritt (Owner-Aufgabe, Abschnitt 6):** nach dem Eintragen des Tokens wandert die Zeile auf
`200`. Bis dahin ist eine Abweichung ein korrekter Befund, kein Fehlalarm.

**Abnahme:** `bash -n scripts/probe-auth.sh`; `node --test test/probe-auth-table.test.js` gruen.

---

## 4. Tests

Neues Verhalten braucht einen Test (CLAUDE.md). Diese Faelle sind Pflicht, keine Auswahl.

### 4.1 Neue Datei `test/openai-e7-challenge.test.js`

Spawn-Muster wie `test/oauth.test.js:17-40` (`startServer` aus `test/helpers.js`, `PORT=0`,
`DATA_DIR`-Override). Faelle:

| # | Fall | Erwartung (deterministisch) |
|---|---|---|
| T1 | `startServer({ env: { OPENAI_APPS_CHALLENGE_TOKEN: "e7-token-abc" } })`, `GET /.well-known/openai-apps-challenge` | Status **200**; `(await res.text()) === "e7-token-abc"` byte-exakt (kein `\n`); `content-type` beginnt mit `text/plain`; **kein** `www-authenticate`-Header |
| T2 | derselbe Aufruf, Koerperform (O-4) | `JSON.parse(text)` wirft; `text` enthaelt weder `{` noch `[` noch `"` |
| T3 | Server ohne die Variable (BASE_ENV pinnt `""`) | Status **404**; Koerper enthaelt den String `openai` nicht |
| T4 | `OPENAI_APPS_CHALLENGE_TOKEN: "   "` | Status **404** (`.trim()` greift) |
| T5 | `OPENAI_APPS_CHALLENGE_TOKEN: " e7-token-abc\n"` | Status **200**, Koerper genau `e7-token-abc` |
| T6 | `POST` auf denselben Pfad bei gesetztem Token | **404** (Express-Fall-through, nur `app.get` registriert); Koerper enthaelt den Token nicht |
| T7 | Secret-Disziplin (Regel 4) | die gesammelte Server-Ausgabe (`srv.output`) enthaelt den Testtoken NICHT |
| T8 | `/healthz`-`configHash` | mit und ohne gesetzten Token identisch (der Fingerabdruck fasst nur die Achsen aus `src/config-fingerprint.js`) |
| T9 | Doku-Pin | `grep`-Aequivalent in Node: `.env.example` enthaelt genau eine Zeile `^OPENAI_APPS_CHALLENGE_TOKEN=` (Muster `test/iel-b1-schalter.test.js`) |

### 4.2 Erweiterung `test/mcp-ui.test.js`

In-Process (die Datei importiert Module direkt). **`config.server.publicUrl` MUSS in jedem dieser
Faelle explizit gesetzt werden** (Muster `test/route-auth-inventory.test.js:56`) - sonst entscheidet
die lokale `.env` ueber das Ergebnis. Dazu `import { config } from "../src/config.js";` ergaenzen
und den Vorwert im `finally`/`after` wiederherstellen.

| # | Fall | Erwartung |
|---|---|---|
| T10 | mcp-nativer Host, `place_call`, `config.server.publicUrl = "https://e7.test"` | `_meta.ui.csp` per `deepEqual` **exakt** `{ connectDomains: [], resourceDomains: [] }`; `"frameDomains" in _meta.ui.csp === false` |
| T11 | wie T10 | `_meta.ui.domain === "https://e7.test"`; `_meta.ui.resourceUri` unveraendert (`ui://hermes/call`) |
| T12 | fail-safe: `config.server.publicUrl = ""` | `"domain" in _meta.ui === false`; `csp` weiterhin vorhanden |
| T13 | Nicht-Regression ChatGPT | ChatGPT-Host: `_meta["openai/outputTemplate"]` ist weiterhin der flache URI-String und `!_meta.ui` gilt weiter - **bestehender Fall T-P3-AC2 (`:551-562`) bleibt unveraendert gruen**, nicht umschreiben |

### 4.3 Bestehende Tests, die gruen bleiben MUESSEN

`test/route-auth-inventory.test.js`, `test/probe-auth-table.test.js`,
`test/config-namespaces.test.js`, `test/mcp-ui.test.js` (alle Bestandsfaelle),
`test/mcp-ui-wing-dedup.test.js`, `test/s2-mcp-origin.test.js`.

### 4.4 Verifikationsbefehle

```
node --check src/app.js
node --check src/config.js
node --check src/ui/contract.js
node --check src/ui/adapters/mcp-native.js
bash -n scripts/probe-auth.sh
npm test -- --test-concurrency=4
```

`--test-concurrency=4` ist Pflicht: bei voller Parallelitaet ist die Bank aus Ressourcengruenden
rot (Lehre `sec-testbank-parallel-race`). Ein roter Test zaehlt nur, wenn er **isoliert** rot ist.

### 4.5 Manueller Smoke (zusaetzlich, nicht statt der Tests)

```
PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true OPENAI_APPS_CHALLENGE_TOKEN=abc npm start
curl -i localhost:3999/.well-known/openai-apps-challenge
curl -s localhost:3999/.well-known/openai-apps-challenge | xxd | tail -1
```

Erwartung: `200`, `content-type: text/plain...`, Koerper `abc`, und im `xxd`-Dump **kein** `0a` am
Ende. Danach den Prozess beenden (verwaiste Testserver, Lehre `leaked-test-servers-overheat`).

---

## 5. Blast Radius und Pre-Mortem

**Beruehrte Dateien (12):** `src/config.js`, `src/app.js`, `src/route-policy.js`,
`src/ui/contract.js`, `src/ui/adapters/mcp-native.js`, `.env.example`, `render.yaml`,
`scripts/probe-auth.sh`, `test/route-auth-inventory.test.js`, `test/config-namespaces.test.js`,
`test/helpers.js`, `test/mcp-ui.test.js` + die neue `test/openai-e7-challenge.test.js`.

**Was NICHT beruehrt wird:** kein Anruf-, SMS- oder Kostenpfad. Kein Safety-Gate. Keine
Auth-Middleware. Kein Widget-HTML, kein Katalog, kein ChatGPT-Adapter, keine
Resource-Registrierung. Keine DB-Migration. Keine neue Dependency.

**Reichweite der Route:** der Dienst kennt keine Host-Bindung am Routengraph. Die Challenge ist ab
dem Deploy unter ALLEN auf ihn gerichteten Hosts erreichbar, also auch unter
`vodafone-agent.onrender.com`. Fuer O-4 folgenlos (derselbe eine Token, nur wir koennen ihn
setzen); bewusst akzeptiert, weil eine Host-Weiche eine zweite Wahrheit ueber den eigenen Origin
waere und E-1 widerspraeche.

**Rate-Limiter:** die Route liegt hinter dem globalen Limiter (`src/app.js:129-136`). Ein
Verifikations-Abruf ist ein einzelner GET; bewusst akzeptiert, keine Ausnahme bauen.

**PM-1 - Der Token steht im Log und damit in einem Support-Ticket.** Kette: jemand ergaenzt beim
Debuggen ein `console.log(config.server...)` -> der Token liegt in der Render-Log-Historie -> ein
Dritter spielt die Domain-Verifikation nach. Entschaerfung: T7 ist ein Test, keine Bitte; der
`.env.example`-Text sagt ausdruecklich, dass der Wert an genau EINER Stelle ausgeliefert wird.

**PM-2 - Die Route liefert 404, obwohl der Token eingetragen ist.** Kette: Owner traegt den Wert
ein -> der Prozess startet nicht neu -> Verifikation schlaegt fehl -> Suche im Code statt im
Betrieb. Entschaerfung: A1 und A7 nennen den Prozessstart als Bedingung; A4 haelt die Route im
`ROUTE_FINGERPRINT`, also ist "nicht gemountet" als Ursache ausgeschlossen.

**PM-3 - Die CSP war zu eng und der Reviewer sieht eine leere Karte.** Kette: ein spaeteres Widget
laedt doch etwas (Font, Bild, Ping) -> die leeren Listen blocken es -> das Widget ist im Review
kaputt. Entschaerfung: die Messung ist auf 12 Dateien benannt und mit Positiv-Kontrolle
reproduzierbar (1.2); die Naht in A9 sagt, wohin der Wert wandert. Ein Regressions-Test, der die 12
Quellen erneut auf Netz-APIs grept, waere die zusaetzliche Absicherung - **nicht Teil dieses
Schnitts** (Scope), als Kandidat hier festgehalten.

**PM-4 - `_meta.ui.domain` zeigt auf den falschen Host.** Kette: `PUBLIC_URL` driftet -> `domain`
meldet den onrender-Host, waehrend im Portal `app.sundartha.com` steht -> Ablehnung. Entschaerfung:
dieselbe Variable speist bereits Token-Audience, PRM und die `/mcp`-Herkunftswache, und seit E5/E8
verweigert ein leerer oder divergenter Wert in Produktion den Boot (0.1). Der Defekt waere nicht
neu, sondern derselbe.

**Beruehrte absolute Regeln:**
- **Regel 3 (AUTH FAIL-CLOSED):** eine neue oeffentliche Route. Alle drei verlangten Stuecke sind
  geplant - eigene Absicherung (es gibt nichts zu schuetzen: ein einzelner, fuer die
  Oeffentlichkeit bestimmter Token; kein Zustand, kein Schreibpfad, kein Tenant-Bezug),
  Begruendungs-Kommentar im Code (A2) und Eintrag in `src/route-policy.js` (A3); dazu die zwei
  weiteren Zwangspunkte A4/A11.
- **Regel 4 (SECRETS):** der Token kommt ausschliesslich aus der Env, wird NIE geloggt, NIE in eine
  andere Antwort geschrieben, NIE in eine MCP-Ausgabe gelegt, fliesst nicht in `configFingerprint`
  und nicht nach `/healthz`. Besonderheit, die benannt sein muss: seine Bestimmung IST die
  oeffentliche Auslieferung an genau diesem einen Pfad - das ist Anforderung O-4, keine
  Aufweichung.
- **Regeln 1, 2, 5, 6, 7:** unberuehrt. Kein Gate, kein Offenlegungssatz, kein Audio, kein
  Scope-Zuwachs, kein Ratespiel (jede Aussage oben mit `datei:zeile`).

---

## 6. Was die Umsetzung NICHT baut (Owner-Aufgaben) und was in den Report gehoert

### 6.1 Owner-Aufgaben - ausdruecklich KEIN Code

| ID | Aufgabe | Wo |
|---|---|---|
| O-A1 | Token aus dem Einreichungsformular als `OPENAI_APPS_CHALLENGE_TOKEN` am Gateway-Service eintragen; Prozess neu starten | Render-Dashboard |
| O-A2 | Challenge Base URL im Formular = `https://app.sundartha.com` | OpenAI-Portal |
| O-A3 | Nach O-A1 die Erwartungszeile in `scripts/probe-auth.sh` von `404` auf `200` ziehen | Repo, eigener Ein-Zeilen-Commit |
| O-A4 | Name, Kurz-/Langbeschreibung, Logo, Kategorie, Starter-Prompts, Lokalisierung, Laenderverfuegbarkeit, Release Notes, Policy-Attestationen, Support-Kontakt, Website-/Support-/Privacy-/Terms-URL | OpenAI-Portal |
| O-A5 | Live-Wert von `MCP_UI_ENABLED` am Dienst messen, BEVOR mit UI eingereicht wird | Render-Dashboard / Live-`tools/list` |

Fuer O-A4 wird in diesem Schnitt **nichts** gebaut - kein Feld, keine Datei, kein Platzhalter, kein
TODO im Code.

### 6.2 Pflicht-Vermerke im Umsetzungs-Report

Der Report der Umsetzung MUSS diese Punkte ausdruecklich nennen:

1. **`MCP_UI_ENABLED` ist im Live-Betrieb UNKNOWN.** Der Schalter steht NICHT in `render.yaml`
   (0 Treffer) und der Gateway-Service ist dashboard-verwaltet (`render.yaml:14-17`). Ist er live
   aus, liefert `tools/list` GAR KEIN `_meta.ui` - dann traegt kein Deskriptor ein Widget, T-30/T-31
   sind gegenstandslos und O-12 verbietet Screenshots. **Es bleibt offen, ob die Widgets ueberhaupt
   ausgeliefert werden.** Loeser ist O-A5, nicht Code.
2. Der veraltete Kommentar `test/mcp-ui.test.js:525-528` ("ausschliesslich place_call traegt ein
   Widget-_meta") stimmt am Zielstand nicht - es sind fuenf Aufrufstellen (1.3). Bewusst nicht
   angefasst (Scope).
3. Die nachgemessenen Zaehler (Ist -> Soll je Zwangspunkt) und ob sie am gemergten Stand erneut
   geprueft wurden.
4. Offene Fragen, die dieser Schnitt nicht beantwortet: ob OpenAI `sundartha.com` als Parent-Host
   akzeptiert; ob der Server-Origin T-31 "pro Plugin eindeutig" erfuellt; ob der Validator LEERE
   `connectDomains`/`resourceDomains` akzeptiert und ob `data:` deklariert werden muss; ob
   `csp`/`domain` am TOOL- oder am RESOURCE-`_meta` erwartet werden. Alle vier sind UNKNOWN; alle
   vier aendern im Trefferfall nur einen Wert, nicht die Struktur.

---

## 7. UNKNOWN (nicht klaerbar, bewusst offengelassen)

| ID | Frage | Warum UNKNOWN | Was stattdessen gebaut wird |
|---|---|---|---|
| U-1 | Akzeptiert OpenAI `sundartha.com` als Parent-Host fuer eine Challenge zu `app.sundartha.com`? | O-5 sagt "MCP-Hostname oder ein Parent-Host", ohne "Parent" zu definieren | ausschliesslich `app.sundartha.com`. Faellt die Verifikation durch, sind dieselben 12 Zeilen auf dem Web-Service nachzuziehen - eigener Schnitt |
| U-2 | Erfuellt der Server-Origin T-31 "pro Plugin eindeutig"? | unser Origin ist zugleich MCP-Endpunkt und Dashboard-Host; die Anforderung definiert "unique" nicht | bewusst so einreichen, eine etwaige Ablehnung als Messung nehmen (Owner-Entscheidung), statt vorab eine Widget-Subdomain aufzubauen |
| U-3 | Akzeptiert der Validator LEERE Listen? Muss `data:` deklariert werden? | T-30 spricht von "Domains"; `data:` ist ein Schema, keine Domain | leere Listen (die gemessene Wahrheit). Im Trefferfall aendert sich EIN Wert in `UI_CSP`, nicht die Struktur |
| U-4 | Erwartet OpenAI `csp`/`domain` am TOOL- oder am RESOURCE-`_meta`? | T-30/T-31 nennen die Felder ohne Traeger | dort, wo `resourceUri` schon liegt (EINE Stelle). Im Trefferfall ist die Ergaenzung ein Ein-Zeilen-Nachzug in `makeUiRenderer.registerResource` |
| U-5 | Live-Wert von `MCP_UI_ENABLED` | dashboard-verwaltet, nicht im Repo belegt | nichts - Messung ist O-A5. Pflicht-Vermerk im Report (6.2) |
| U-6 | Wirkt ein im Dashboard nachgetragener Token ohne manuelles Zutun? | ob Render bei einer Env-Aenderung selbst neu startet, ist im Repo nicht belegt | Wert wird beim Prozessstart gelesen (Konvention). Ein Per-Request-`process.env`-Lesen ist **verboten** (zweite Konfigurationsquelle) |
| U-7 | Gelten T-30/T-31 fuer einen reinen Developer-Mode-Connector oder nur fuer die oeffentliche Einreichung? | die Anforderungsdoku trennt es selbst nicht | beide Felder setzen - sie sind in beiden Faellen korrekt und schaden im Developer-Mode nicht |

---

## 8. Verbote

Hart, nicht verhandelbar. Ein Verstoss ist ein Review-Blocker.

1. **Kein Scope-Zuwachs.** Gebaut wird genau A1-A11 plus die Tests aus Abschnitt 4. Insbesondere
   NICHT: X-5 (`ui/initialize`-Handshake, `protocolVersion "2026-01-26"`) - eigener Schnitt, der
   einen Live-Beleg gegen einen echten Host braucht; kein Regressions-Grep-Test ueber die 12
   Widget-Quellen (PM-3, als Kandidat notiert); kein Parent-Host-Nachbau auf `apps/web`; keine
   Widget-Subdomain; kein zweites Plugin.
2. **Keine zweite Env-Variable ueber `OPENAI_APPS_CHALLENGE_TOKEN` hinaus.** Kein
   `OPENAI_UI_DOMAIN`, kein `OPENAI_CHALLENGE_ENABLED`, kein `OPENAI_CSP_*`. `domain` kommt aus
   `config.server.publicUrl` (0.1), `csp` ist eine gefrorene Konstante.
3. **Keine Aufweichung der absoluten Regeln.** Kein Gate anfassen; keine Route ohne
   `route-policy.js`-Eintrag; kein Secret loggen; kein `eslint-disable`-artiger Marker; kein
   uebersprungener Check; keine bedingt registrierte Route (waere im Inventar-Test blind).
4. **Kein `--no-verify`.** Der Lint-Hook prueft auch untrackte Dateien - vor dem Commit sauberen
   Worktree herstellen, nicht den Hook umgehen (Lehre `lint-hook-prueft-untrackte-dateien`).
5. **Kein Push, kein Merge nach `master`, kein Deploy.** Der Schnitt endet auf dem Arbeitsbranch.
6. **Keine Formular-Inhalte bauen** (Vorgabe 6 / O-A4): kein Name, keine Beschreibung, kein Logo,
   keine Support-/Terms-/Privacy-URL als Code, Datei, Route oder Platzhalter.
7. **Den ChatGPT-Adapter nicht anfassen** und `test/mcp-ui.test.js:551-562` (T-P3-AC2) nicht
   umschreiben. Ein `_meta.ui` im ChatGPT-Zweig ist ohne Live-Beleg ein Rueckbau.
8. **Den Token nicht per Request aus `process.env` lesen.** Zweite Konfigurationsquelle neben
   `src/config.js` - verboten, auch wenn es U-6 bequem loesen wuerde.
9. **Keine Magic Numbers und keine Magic Strings ausser dem einen bewussten Pfad-Literal-Paar aus
   A3** (dort begruendet und mechanisch bewacht). `404` wird als `HTTP_NOT_FOUND` benannt.
10. **Nicht raten.** Jede Zahl in dieser Spec ist am Stand `87b8ec1` gemessen; wer sie aendert,
    misst neu und schreibt das Messkommando in den Report.
