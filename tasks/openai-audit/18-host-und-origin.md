# Host und Origin des MCP-Endpunkts
Dimension: D18 | Quelle: Code auf Branch master (nur Lesen)

## Kurzfassung
Die Kritiker-Behauptung ist in der Sache BESTAETIGT, in einem Punkt aber praezisierungsbeduerftig.
Bestaetigt: `PUBLIC_URL` fehlt im Gateway-Block von `render.yaml` (ausdruecklicher Kommentar
`render.yaml:686`), die Kette in `src/config.js:1443` faellt damit auf `RENDER_EXTERNAL_URL`
zurueck, und genau dieser Wert speist Token-Audience (`src/auth.js:23`, geprueft `:83`),
`PRM.resource` (`:123`), den `WWW-Authenticate`-Metadaten-Verweis (`:24`, `:69-71`) und die
https-Icon-URL (`src/mcp-server-info.js:66`). Ein repo-interner Messbefund vom 2026-07-02 belegt,
dass `PUBLIC_URL` real auf `onrender.com` zeigte, waehrend der Connector unter
`app.sundartha.com` lief (`src/mcp-server-info.js:13-17`) - die beiden Origins divergieren also
nicht hypothetisch, sondern belegt.
Praezisierung: `publicUrl` entscheidet NICHT, welcher Host `/mcp` bedient. Es gibt keine
Host-Pruefung und keine `allowedHosts`-Bindung am Endpunkt (`grep allowedHosts|
enableDnsRebindingProtection|req.hostname` in `src/` = 0 Treffer am `/mcp`-Pfad;
`src/routes/mcp.js:51` bindet nur `mcpAuth`) - der Dienst antwortet unter JEDEM auf ihn gerichteten
Host. `publicUrl` bestimmt den ANGEKUENDIGTEN kanonischen Origin, der eingereichte Origin ist eine
Portal-Eingabe des Owners. Genau daraus entsteht der Defekt: kuendigt der Server
`resource=https://vodafone-agent.onrender.com/mcp` an, waehrend im Portal
`https://app.sundartha.com/mcp` steht, passen `aud`-Erwartung und Client-`resource` nicht zusammen.
T-32 (Unveraenderlichkeit des Origins) ist KEINE Annahme des Kritikers: sie steht mit Quelle und
Wortlaut in `tasks/openai-audit/00-openai-anforderungen.md:65`. Die Challenge-Route fehlt
vollstaendig.

## Pruefpunkte

### PP-D18-01 Variablen-Kette und tatsaechlicher Fallback
- Status: FAIL
- Evidenz: `src/config.js:1443` `publicUrl: stripTrailingSlash(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "")`.
  Im Gateway-Block von `render.yaml` (Service `vodafone-agent`, `render.yaml:4-690`) gibt es
  KEINEN `PUBLIC_URL`-Eintrag; `render.yaml:686` sagt es ausdruecklich: "PUBLIC_URL nicht noetig:
  Render setzt RENDER_EXTERNAL_URL automatisch". Der Boot-Guard prueft nur Vorhandensein und den
  ngrok-Platzhalter, nicht den Host: `src/config.js:2417-2418`
  (`!config.server.publicUrl || .includes("CHANGE-ME")`), Platzhalter in `.env.example:921`.
  `RENDER_EXTERNAL_URL` ist zugleich der Produktions-Diskriminator (`src/config.js:200`,
  `:1447`).
- Wirksamer Wert: nach `render.yaml` = die von Render gesetzte Dienst-URL, also der
  `onrender.com`-Host. Ein repo-interner Messbefund bestaetigt das empirisch:
  `src/mcp-server-info.js:15` "die http(s)-Icon-URL zeigte via PUBLIC_URL auf onrender.com"
  (Befund 2026-07-02, Connector lief ueber `app.sundartha.com`). Der Host-Name
  `https://vodafone-agent.onrender.com` ist als Gateway-Origin im Code fixiert
  (`src/elevenlabs/init-webhook-ziel.js:23`), ebenso in der HSTS-Liste
  (`src/middleware.js:28`).
- Einschraenkung (nicht am Repo entscheidbar): der Gateway-Service ist DASHBOARD-MANAGED
  (`render.yaml:14-17`: "Werte hier sind REFERENZ/Doku - die Quelle der Wahrheit ist das
  Render-Dashboard"). `PUBLIC_URL` KANN live per Dashboard auf `https://app.sundartha.com`
  gesetzt sein; `src/elevenlabs/init-webhook-ziel.js:84,103-137` existiert genau dafuer - es liest
  `PUBLIC_URL` per Render-API und urteilt gegen `HERMES_GATEWAY_ORIGINS`. Der Live-Wert ist damit
  UNKNOWN und muss vor jeder Einreichung am Dienst gelesen werden, nicht aus `render.yaml`
  geschlossen.
- Risiko: der angekuendigte kanonische Origin haengt an einer Variable, die im Blueprint
  ausdruecklich als unnoetig markiert ist. Niemand im Code erzwingt, dass er dem Connector-Origin
  entspricht.
- Empfehlung: `PUBLIC_URL` explizit auf den Origin setzen, unter dem eingereicht wird, und den
  Boot-Guard von "gesetzt" auf "gleich dem erwarteten Origin" verschaerfen.
- Prioritaet/Kategorie: P0 / B

### PP-D18-02 Welcher Host bedient `/mcp`
- Status: PARTIAL
- Evidenz: `/mcp` ist als Route ohne jede Host-Bindung montiert: `src/routes/mcp.js:51`
  `router.post("/mcp", mcpAuth, ...)`, Transport stateless `src/routes/mcp.js:22,36-44`
  (`sessionIdGenerator: undefined`). Ein Grep nach `allowedHosts`,
  `enableDnsRebindingProtection`, `req.hostname`, `req.headers.host` trifft in `src/`
  ausschliesslich die CSRF-Origin-Pruefung (`src/middleware.js:88-97`), die fuer fehlenden
  `Origin`-Header bewusst durchfaellt. Es gibt keinen Vergleich gegen `config.server.publicUrl`
  im Request-Pfad.
- Folge: BEIDE Hosts bedienen `/mcp`, sobald sie auf den Dienst zeigen - `app.sundartha.com` ist
  dem Dienst als verifizierte Custom-Domain zugeordnet (belegt durch die Zielpruefung in
  `src/elevenlabs/init-webhook-ziel.js:10-12,23`, die genau das verlangt, und durch
  `render.yaml:22` `PUBLIC_GATEWAY_URL=https://app.sundartha.com`).
- Risiko: die Divergenz faellt im Betrieb nicht auf (der Endpunkt funktioniert unter beiden
  Hosts), sondern erst in der Token-Pruefung und in der Submission.
- Empfehlung: keine Code-Pflicht; die Entscheidung liegt in PP-D18-06.
- Prioritaet/Kategorie: P1 / B

### PP-D18-03 Was von `publicUrl` abhaengt (vollstaendige Liste im MCP-Pfad)
- Status: FAIL
- Evidenz je Abhaengigkeit:
  - Token-Audience: `src/auth.js:23` `audience() = config.auth.oauthAudience || ${publicUrl}/mcp`;
    erzwungen in `jwtVerify` `src/auth.js:83`. Der Override ist ein freier String ohne Pruefung
    (`src/config.js:1980`) und steht NICHT in `render.yaml` (Grep `OAUTH_AUDIENCE` in
    `render.yaml` = 0 Treffer), Default also leer -> Fallback greift. Live-Wert UNKNOWN.
  - `PRM.resource` (RFC 9728): `src/auth.js:123` `resource: audience()`, ausgeliefert unter
    `src/auth.js:127` `/.well-known/oauth-protected-resource` und `:128` `.../mcp`.
  - Metadaten-Verweis im 401: `src/auth.js:24` `metadataUrl()`, gesetzt als
    `WWW-Authenticate ... resource_metadata=` in `src/auth.js:69-71`.
  - Oeffentliche Routen-Erklaerung dieser Metadaten: `src/route-policy.js:86-95`, registriert in
    `src/app.js:167` `registerWellKnown(app)`.
  - serverInfo-Icon: `src/mcp-server-info.js:66` `src: ${config.server.publicUrl}/brand/hermes-icon.png`.
    Der Kommentar `:13-17` haelt fest, dass genau diese URL wegen der Origin-Divergenz vom Host
    verworfen wurde; `icons[0]` ist deshalb ein data-URI (`:61`).
- Nicht abhaengig (gegengeprueft, entlastet den Befund):
  - Widget-/Resource-URIs sind origin-frei: `src/ui/contract.js:19` `UI_URI_PREFIX = "ui://hermes/"`,
    bezeichnet `:17` als "Tenant-freier, statischer URI".
  - In Tool-Ausgaben sichtbare URLs: KEINE. Grep nach `http|url|sundartha` in `src/mcp-tools.js`
    trifft nur `err.httpStatus` (`:73`, `:956`, `:958`).
  - Die uebrigen `publicUrl`-Verbraucher liegen ausserhalb des MCP-Kanals (Voice-Webhooks
    `src/routes/api-calls.js:500-501`, `src/routes/voice.js:502`, TTS
    `src/tts/directive-synth.js:120`, Stripe-Rueckkehr `src/routes/api-billing.js:105-106`,
    OIDC-Redirect `src/wiring/web-login.js:263,279`, Newsletter
    `src/newsletter-recipients.js:73-78`). Sie teilen aber DIESELBE Variable - ein Origin-Wechsel
    bewegt sie alle mit.
- Risiko: ein Umsetzen von `PUBLIC_URL` nach der Einreichung aendert `aud`-Erwartung und
  `PRM.resource` gleichzeitig mit allen Webhook-/Redirect-Zielen. Umgekehrt: bleibt der Wert auf
  dem `onrender.com`-Host, waehrend im Portal der Marken-Host eingereicht wird, sendet der Client
  `resource=<Marken-Host>/mcp` und der Server erwartet `<onrender-Host>/mcp` - Token-Ablehnung
  (T-9, vgl. `tasks/openai-audit/06-authentifizierung.md:69`).
- Empfehlung: den Origin an EINER Stelle festlegen (`PUBLIC_URL`) und `OAUTH_AUDIENCE` beim Boot
  gegen `${publicUrl}/mcp` validieren, statt ihn frei zu lassen.
- Prioritaet/Kategorie: P0 / B

### PP-D18-04 T-32: Unveraenderlichkeit des Origins - Quelle oder Annahme?
- Status: PASS (Behauptung des Kritikers bestaetigt, KEINE Annahme)
- Evidenz: `tasks/openai-audit/00-openai-anforderungen.md:65` (T-32, Kategorie A, Quelle
  `https://developers.openai.com/plugins/deploy/app-review`, Wortlaut-Kern: "To change the origin,
  create a new plugin, then complete its scan, submission, review, and publication flow.").
  Der Eintrag nennt ausdruecklich `scheme`, `hostname`, `port`. Ergaenzend
  `00-openai-anforderungen.md:64` (T-31: eigener, pro Plugin eindeutiger UI-Origin,
  Kategorie A) und `:69` (T-36: Template-URLs nur fuer "trusted developers").
- Gegenprobe zum Projektstand: der offene Infra-/URL-Cutover (Track B) ist in `CLAUDE.md`
  (Abschnitt "Naming", Satz "der Infra-/URL-Cutover (Track B) steht separat aus") dokumentiert,
  ebenso das Repo-/Service-Namens-Erbe `vodafone-agent`. Die Kollision "Einreichung friert einen
  Origin ein, der laut Plan noch wechseln soll" ist damit an beiden Enden belegt.
- Risiko: eine Einreichung unter `vodafone-agent.onrender.com` bindet das Plugin dauerhaft an
  einen Host, dessen Name die Marke nicht traegt; ein spaeterer Wechsel erzwingt ein NEUES Plugin
  mit vollem Scan/Review - inklusive Verlust der bereits erreichten Publikation.
- Empfehlung: keine (Entscheidung, s.u.).
- Prioritaet/Kategorie: P0 / A

### PP-D18-05 Domain-Ownership-Challenge: existiert ein Mechanismus?
- Status: FAIL
- Evidenz: Anforderung: `tasks/openai-audit/00-openai-anforderungen.md:99` (O-4, Kategorie A):
  exaktes Token unter `https://<challenge-base-host>/.well-known/openai-apps-challenge`, "Do not
  return JSON, a list of tokens, or multiple tokens"; `:100` (O-5): "Challenge-Base ist
  MCP-Hostname oder ein Parent-Host; Pfade werden ignoriert".
  Bestand: `grep -rn "openai-apps-challenge"` ueber das Repo (ohne `node_modules`/`.git`) trifft
  AUSSCHLIESSLICH Audit-Dokumente (`tasks/OPENAI-MCP-READINESS.md:17,65,66`,
  `tasks/openai-audit/14-deployment-domain-submission.md:5,32,34`) - keinen Treffer in `src/`
  oder `apps/`. Die einzigen `.well-known`-Routen sind `src/auth.js:127-128`
  (OAuth-PRM), deklariert in `src/route-policy.js:86-95`. Statisch ausgeliefert wird nur
  `public/favicon.ico` und `public/brand/` (`ls public/`); kein Token-Artefakt, kein
  TXT-Record-Hinweis in `render.yaml` oder `.env.example` (`grep openai` dort = 0 Treffer).
- Kopplung zum Origin: weil O-5 den Pfad ignoriert und den MCP-Hostnamen oder einen Parent-Host
  verlangt, muss die Challenge-Datei unter DEM Host liegen, unter dem `/mcp` eingereicht wird.
  Bei `onrender.com` ist der Parent-Host fremd (Render), es bleibt nur der exakte Host; bei
  `app.sundartha.com` ist zusaetzlich `sundartha.com` als Parent moeglich. Das ist ein
  belegbarer, praktischer Unterschied zwischen den beiden Optionen.
- Risiko: ohne diese Route ist keine Einreichung moeglich (harter formaler Blocker, deckungsgleich
  mit `14-deployment-domain-submission.md` PP-D14-04).
- Empfehlung: Route erst bauen, NACHDEM der Origin entschieden ist - sie gehoert auf denselben
  Host wie `/mcp` bzw. dessen Parent, und der Bau vor der Entscheidung erzeugt Wegwerf-Arbeit.
- Prioritaet/Kategorie: P0 / A

## Entscheidung, die der Owner treffen muss
Die Entscheidung ist NICHT "Code aendern", sondern: **unter welchem Host und Origin wird `/mcp`
eingereicht** - und zwar VOR der Einreichung, weil T-32 sie danach einfriert
(`00-openai-anforderungen.md:65`). Alle drei Optionen sind zulaessig; keine ist eine
OpenAI-Pflicht.

Vorbedingung fuer jede Option (keine Option fuer sich): den LIVE-Wert von `PUBLIC_URL` und
`OAUTH_AUDIENCE` am Dienst lesen, nicht aus `render.yaml` schliessen (`render.yaml:14-17`
dashboard-managed; Leseweg existiert: `src/elevenlabs/init-webhook-ziel.js:84,103-137`).

- **Option A - unter `app.sundartha.com` einreichen (Marken-Host, heute schon Connector-Origin).**
  Notwendig: `PUBLIC_URL=https://app.sundartha.com` im Render-Dashboard explizit setzen (heute im
  Blueprint abwesend, `render.yaml:686`), `OAUTH_AUDIENCE` konsistent halten
  (`src/config.js:1980` leer -> Fallback `${publicUrl}/mcp`), Challenge-Route unter diesem Host
  oder dem Parent `sundartha.com` bereitstellen (O-5, `:100`).
  Konsequenz: der eingefrorene Origin ist markenstabil; Track B (Repo-/Service-Rename) beruehrt
  ihn nicht mehr, weil er schon auf der Marken-Domain liegt. Preis: der Origin-Wechsel bewegt
  alle uebrigen `publicUrl`-Verbraucher mit (Voice-Webhooks `src/routes/api-calls.js:500-501`,
  Stripe-Rueckkehr `src/routes/api-billing.js:105-106`, OIDC-Redirect
  `src/wiring/web-login.js:263,279`) - das ist ein Deploy-Vorgang mit Beleg, kein Nebeneffekt.

- **Option B - unter `vodafone-agent.onrender.com` einreichen (heutiger Fallback).**
  Notwendig: nichts an der Konfiguration, Challenge-Route unter diesem exakten Host (ein
  Parent-Host steht nicht zur Verfuegung, er gehoert Render).
  Konsequenz: eingefroren wird ein Host mit dem alten, markenfremden Namen und einer
  Fremdanbieter-Domain. Der in `CLAUDE.md` als offen dokumentierte Track-B-Cutover erzwingt dann
  spaeter ein NEUES Plugin mit vollem Scan/Review (T-32). Zusaetzlich bindet die Einreichung den
  Dienst an die Erreichbarkeit einer Render-Subdomain, die nicht dem Betreiber gehoert.

- **Option C - Einreichung verschieben, bis Track B abgeschlossen ist.**
  Notwendig: nichts jetzt; die formalen Blocker (PP-D18-05, und ausserhalb dieser Dimension
  `14-deployment-domain-submission.md` PP-D14-03/08/09) bleiben ohnehin offen.
  Konsequenz: kein eingefrorener Origin, kein Doppelarbeit-Risiko - dafuer keine Publikation im
  Zeitraum. Diese Option ist nur dann sinnvoll, wenn Track B tatsaechlich ansteht; steht er
  nicht an, ist Option A die gleiche Wirkung ohne Wartezeit.

Was in JEDEM Fall gilt, unabhaengig von der Wahl: Server-angekuendigter Origin
(`src/auth.js:23,123`) und im Portal eingereichter Origin MUESSEN identisch sein, sonst scheitert
die Token-Pruefung (`src/auth.js:83`). Heute erzwingt das nichts im Code - der Boot-Guard prueft
nur, DASS `PUBLIC_URL` gesetzt und kein Platzhalter ist (`src/config.js:2417-2418`).

## Offene Fragen
- Live-Wert von `PUBLIC_URL` am Render-Service `srv-d8m0fhflk1mc73bno570`
  (`src/elevenlabs/init-webhook-ziel.js:24`): `render.yaml` zeigt ihn nicht, der Service ist
  dashboard-managed (`render.yaml:14-17`). UNKNOWN - entscheidet, ob PP-D18-01 heute wirksam
  FAIL ist oder nur unbewacht.
- Live-Wert von `OAUTH_AUDIENCE`: nicht in `render.yaml`, Default leer (`src/config.js:1980`).
  UNKNOWN - bei gesetztem Nicht-Standardwert haengt der eingereichte Origin nicht mehr allein an
  `PUBLIC_URL`.
- Akzeptiert OpenAI `sundartha.com` als Parent-Host fuer eine Challenge zu `app.sundartha.com`?
  O-5 (`00-openai-anforderungen.md:100`) sagt "MCP-Hostname oder ein Parent-Host", die genaue
  Parent-Definition steht dort nicht.
- Gilt T-32 auch fuer einen Host-Wechsel VOR der Publikation (nur Scan/Submission erfolgt)? Der
  Wortlaut in `:65` bezieht sich auf "publication"; die Vorstufen sind dort nicht geregelt.
- Existiert `hermes-web-staging` als eigener Dienst mit eigenem Origin, der als Review-Ziel
  dienen koennte? `render.yaml` kennt nur `vodafone-agent` und `hermes-web`
  (`render.yaml:4`, `:694`); CLAUDE.md nennt den Staging-Dienst, das Repo belegt ihn nicht.
