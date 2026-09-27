# Schnitt S2: MCP-Protokoll-Haertung - Origin-Pruefung und angekuendigter Origin
Blocker: P0-12, P0-10 | Anforderungs-IDs: T-06 (MCP-Spec, Pflicht), T-32 (OpenAI, Origin nach Publikation unveraenderlich), T-09/RFC 9728 nur mittelbar | Kategorie: P0-12 = B, P0-10 = B

## Ist-Zustand

**Origin-Pruefung (P0-12).**
- `src/routes/mcp.js:51` `router.post("/mcp", mcpAuth, ...)` - einzige Middleware ist `mcpAuth`. `:128` GET und `:129-131` DELETE antworten 405 OHNE jede Pruefung.
- `src/routes/mcp.js:113` `new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` - keine `allowedOrigins`/`allowedHosts`/`enableDnsRebindingProtection`. Der Node-Transport ist ein Durchreicher (`node_modules/@modelcontextprotocol/sdk/dist/esm/server/streamableHttp.js:51` gibt `options` unveraendert an den Web-Standard-Transport), dessen Default aus ist (`.../webStandardStreamableHttp.js:70` `?? false`) und der die Pruefung dann komplett ueberspringt (`:108-110`). SDK-Version 1.29.0.
- Die vorhandene Herkunftswache ist NICHT vor `/mcp` geschaltet: `src/middleware.js:93` `createSameOriginGuard` wird ausschliesslich in `src/self-service-routes.js:1014` benutzt. Ihr Praedikat `crossOriginRequest` (`src/middleware.js:76-87`) vergleicht gegen `req.headers.host`, nicht gegen eine Allowlist, und laesst fehlenden Origin bewusst durch (`:79`).
- Konstanten, die wiederverwendet werden koennen: `src/middleware.js:58` `CROSS_ORIGIN_ERROR = "cross_origin_blocked"`, `:62` `HTTP_FORBIDDEN = 403`; Forensik-Kanal `src/util.js:76-78` `auditAuthFailed(req, grund)` (nur `console.log`, `src/util.js:48-50` - keine DB-Zeile), Grund-Vokabular `src/util.js:66-74`.
- Kein Aufrufer sendet heute einen Origin an `/mcp`: der Test-Helfer setzt keinen (`test/helpers.js:1294-1304` `mcpPost`), die Widgets rufen `/mcp` nicht aus dem Browser (kein `fetch(` in `src/ui/`), `apps/web` verlinkt `/mcp` nur als Text (`apps/web/src/pages/index.astro:38`, `apps/web/src/pages/so-funktionierts.astro:7`).

**Angekuendigter Origin (P0-10).**
- `src/config.js:1494` `publicUrl: stripTrailingSlash(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || "")`.
- `src/config.js:2031` `oauthAudience: process.env.OAUTH_AUDIENCE || ""` - freier String, keine Pruefung.
- Abhaengige Werte: `src/auth.js:23` `audience() = oauthAudience || ${publicUrl}/mcp` (erzwungen in `jwtVerify`, `:83`), `src/auth.js:24` `metadataUrl() = ${publicUrl}/.well-known/oauth-protected-resource` (im 401-Header, `:66-71`), `src/auth.js:123` `resource: audience()` (PRM, ausgeliefert `:127-128`), `src/mcp-server-info.js:66` Icon-URL.
- Boot-Riegel prueft nur Vorhandensein und Platzhalter: `src/config.js:2468` `!config.server.publicUrl || .includes("CHANGE-ME")`.
- `render.yaml:698` "PUBLIC_URL nicht noetig: Render setzt RENDER_EXTERNAL_URL automatisch"; der Gateway-Service ist dashboard-managed (`render.yaml:14-17`).
- Repo-Konstante mit beiden Kandidaten-Origins: `src/elevenlabs/init-webhook-ziel.js:23` `HERMES_GATEWAY_ORIGINS = ["https://app.sundartha.com", "https://vodafone-agent.onrender.com"]`; `render.yaml:22` baut das Frontend mit `PUBLIC_GATEWAY_URL=https://app.sundartha.com`.
- Tests pinnen `PUBLIC_URL=https://agent.test` (`test/helpers.js:107`), die kanonische Audience daraus (`test/helpers.js:1240` `MCP_AUDIENCE = "https://agent.test/mcp"`).

**Live-Messung 2026-09-18 (belegt, nicht geraten, ohne Dashboard-Zugriff).**
- `curl -s https://app.sundartha.com/.well-known/oauth-protected-resource` -> `{"resource":"https://app.sundartha.com/mcp", "authorization_servers":["https://fearless-network-26.authkit.app"], ...}`. Dieselbe Antwort ueber `https://vodafone-agent.onrender.com/...` - der Wert ist serverweite Konfiguration, nicht hostabhaengig.
- `curl -i -X POST https://app.sundartha.com/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` -> `401` mit `www-authenticate: Bearer resource_metadata="https://app.sundartha.com/.well-known/oauth-protected-resource"`. Dieser Header haengt AUSSCHLIESSLICH an `config.server.publicUrl` (`src/auth.js:24`, kein `oauthAudience`-Anteil).
- **Folgerung:** der wirksame `publicUrl` ist LIVE `https://app.sundartha.com`, und `audience()` ist LIVE `https://app.sundartha.com/mcp`. Die Divergenz aus dem Audit-Befund von 2026-07-02 (`src/mcp-server-info.js:13-17`) besteht heute NICHT mehr.
- UNKNOWN bleibt: ob dieser Wert aus `PUBLIC_URL` oder aus `RENDER_EXTERNAL_URL` stammt, und ob `OAUTH_AUDIENCE` leer ist oder exakt denselben String traegt. Beides ist von aussen nicht unterscheidbar und wird durch diesen Schnitt gegenstandslos (Aenderung 5 + 6).

## Soll-Zustand

1. Ein POST/GET/DELETE auf `/mcp` mit vorhandenem, nicht erlaubtem `Origin`-Header wird mit `403` und Body `{"error":"cross_origin_blocked"}` abgelehnt - vor `mcpAuth`, also unabhaengig von Token-Gueltigkeit (T-06 erfuellt).
2. Ein Request OHNE `Origin`-Header verhaelt sich byte-identisch zu heute (Server-zu-Server; T-06 verlangt die Ablehnung nur fuer "vorhanden und ungueltig").
3. Die Allowlist ist NIE leer-gleich-alles-erlaubt: eine leere Liste lehnt jeden vorhandenen Origin ab. Sie entsteht aus `config.server.publicUrl` (immer genau ein Eintrag, per Boot-Riegel nicht leer) plus optional `MCP_ALLOWED_ORIGINS` (additiv).
4. Der Boot verweigert den Start, wenn der angekuendigte Origin nicht eindeutig ist: `OAUTH_AUDIENCE` gesetzt und != `${publicUrl}/mcp`; `PUBLIC_URL` mit Pfad/Query/Fragment; in Produktion `PUBLIC_URL` nicht https; ein Eintrag in `MCP_ALLOWED_ORIGINS`, der kein absoluter http(s)-Origin ist.
5. `PUBLIC_URL` ist am Live-Dienst ausdruecklich gesetzt (nicht mehr ueber `RENDER_EXTERNAL_URL` geerbt) und in `render.yaml` als Referenz dokumentiert.
6. Die Owner-Entscheidung "welcher Origin wird eingereicht" ist danach das Setzen EINES Env-Werts (`PUBLIC_URL`); kein Codepfad nennt einen der beiden Hosts.

## Aenderungen

**A1 - Praedikat + Wache (`src/middleware.js`, neben `crossOriginRequest`, nach `:87`).**
Zwei reine Funktionen und eine Fabrik, Muster wie `crossOriginRequest`/`createSameOriginGuard`:
- `normalisierterOrigin(wert)` -> `new URL(wert).origin` kleingeschrieben, oder `null` bei unparsbar / fehlendem Protokoll. `URL.origin` streicht Default-Ports und Pfade - damit sind `HTTPS://Agent.Test/` und `https://agent.test` derselbe Eintrag.
- `mcpOriginErlaubt(originHeader, erlaubteOrigins)` -> `true`, wenn kein Header vorhanden ist (Soll 2); sonst `false`, wenn der Header unparsbar ist ("null" aus sandboxed iframe, Muell); sonst Mengenvergleich auf normalisierten Werten. Leere Liste -> jeder vorhandene Origin `false` (Soll 3). Warum nicht die SDK-Option: sie ueberspringt bei leerer Liste (`webStandardStreamableHttp.js:113,122`) - genau die fail-open-Form, die die Repo-Lehre verbietet -, sie echot den angreifer-kontrollierten Origin in den Response-Body (`:125`) und sie umgeht den bestehenden Forensik-Kanal.
- `originLogWert(originHeader)` -> der Host des Origins, wenn er `^[a-z0-9.:-]{1,64}$` erfuellt, sonst `"unlesbar"`. Grund: ohne diesen Wert ist ein Aussperren nicht diagnostizierbar; roher Fremdtext gehoert nicht ins Log (Begruendung `src/middleware.js:99-101`).
- `createMcpOriginGuard({ erlaubteOrigins })` -> benannte Middleware `mcpOriginOnlyMiddleware`, die bei Ablehnung `auditAuthFailed(req, AUTH_FAILED_GRUND.MCP_CROSS_ORIGIN, \`origin=${originLogWert(...)}\`)` schreibt und `res.status(HTTP_FORBIDDEN).json({ error: CROSS_ORIGIN_ERROR })` liefert (bestehende Konstanten, keine zweite Vokabel). Die Liste wird EINMAL bei der Fabrik normalisiert, nicht pro Request.
KEIN `allowedHosts`/Host-Vergleich: T-06 verlangt nur den Origin, ein Host-Vergleich braeche die Tests (`127.0.0.1:0`) und den Zwei-Host-Betrieb (beide Hosts bedienen den Dienst, `18-host-und-origin.md` PP-D18-02).

**A2 - Mount (`src/routes/mcp.js`, in `makeMcpRoutes` vor `:51`).**
`router.use("/mcp", createMcpOriginGuard({ erlaubteOrigins: mcpErlaubteOrigins(config) }));` - pfadgebunden, weil der Router in `src/app.js:420` auf `/` gemountet ist und ein `router.use(guard)` ohne Pfad jeden Request des Gateways sehen wuerde. Deckt POST, GET und DELETE in einer Zeile, auch eine spaeter ergaenzte Methode (fail-closed). Bewusster Preis: eine `use`-Schicht erscheint nicht in `handlerNames` von `test/route-auth-inventory.test.js:130` - der Nachweis liegt deshalb im neuen HTTP-Test (T2/T5), nicht im Fingerprint.
`mcpErlaubteOrigins(config)` ist eine reine Funktion in `src/middleware.js`: `[config.server.publicUrl, ...config.safety.mcpAllowedOrigins]`. EINE Stelle, die die Liste bildet.

**A3 - Kommentare korrigieren (`src/routes/mcp.js:13-14`, `src/app.js:416`).**
Beide sagen heute "mcpAuth ... bleibt die EINZIGE Absicherung auf POST". Nach A2 ist das falsch: `mcpOriginOnlyMiddleware` laeuft davor. Satz praezisieren (mcpAuth bleibt die einzige IDENTITAETS-Pruefung; die Origin-Wache ist DNS-Rebinding-Schutz und ersetzt sie nicht). Pflicht, weil ein Kommentar, der eine Invariante behauptet, sonst kuenftige Leser in die Irre fuehrt.

**A4 - Forensik-Vokabel (`src/util.js:66-78`).**
`AUTH_FAILED_GRUND.MCP_CROSS_ORIGIN = "mcp_cross_origin"` ergaenzen (eigener Token, damit die `/mcp`-Ablehnung im Log nicht mit der Self-Service-CSRF-Wache verwechselt wird). `auditAuthFailed(req, grund, detail = "")` um den optionalen dritten Parameter erweitern: `... grund=${grund}${detail ? " " + detail : ""}`. Rueckwaertskompatibel; die vier Bestandsaufrufer (`src/web-auth.js:831,835,873`, `src/middleware.js:102`, `src/wiring/internal-only.js:26`) bleiben unveraendert.

**A5 - Konfiguration (`src/config.js`).**
- Neuer Schluessel im `rawConfig` neben den uebrigen Sicherheits-Werten: `mcpAllowedOrigins: csvEnv(process.env.MCP_ALLOWED_ORIGINS)` (`csvEnv` existiert, `src/config.js:267`). Eintrag in `CONFIG_NAMESPACES.safety` (`src/config.js:2245`, wo `csrfEnforce` steht).
- KEIN Abschalt-Flag. Begruendung: CLAUDE.md verbietet neue abgeschaltete Sicherungen; das Heilmittel gegen ein Aussperren ist das ADDITIVE Eintragen des blockierten Origins in `MCP_ALLOWED_ORIGINS`, nicht das Abschalten der Pruefung. Ein Flag mit Default `true` waere zudem in Produktion nur dann nuetzlich, wenn man es dort auf `false` setzen darf - genau das soll es nicht.

**A6 - Boot-Riegel (`src/boot-guard.js` + `src/boot.js`).**
Reine Funktion `angekuendigterOriginFindings({ publicUrl, oauthAudience, allowedOrigins, isProduction })` in `src/boot-guard.js` (Muster `sttProfileFindings`, `src/boot-guard.js:93`), Rueckgabe `[{ fatal, message }]`:
- `oauthAudience` gesetzt und != `${publicUrl}/mcp` -> fatal. Warum: heute koennen `aud`-Erwartung (`src/auth.js:23`) und Metadaten-Verweis (`:24`) auseinanderlaufen, ohne dass es jemand merkt - der Client erfaehrt aus der PRM die `resource`, der Server prueft eine andere `aud`.
- `publicUrl` traegt Pfad, Query oder Fragment -> fatal. Warum: T-32 friert `scheme`/`hostname`/`port` ein; ein `PUBLIC_URL` mit Pfad erzeugt eine Audience, die kein Origin ist.
- `isProduction` und `publicUrl` nicht `https:` -> fatal (im Hosting ist http ein MITM-Footgun; gleiche Linie wie `isInsecureHttpIssuer`, `src/config.js:2405`).
- ein Eintrag in `allowedOrigins`, der nicht als absoluter http(s)-Origin parsbar ist -> fatal. Warum: ein Tippfehler in der Allowlist sperrt still den gemeinten Partner aus.
Verbraucher: `assertAngekuendigterOrigin(config)` in `src/boot.js` neben `assertSttProfile` (`src/boot.js:231-235`), gleiches Muster `console.error("[boot] Start abgebrochen: ...") + process.exit(1)`.
Bewusst NICHT geprueft: ob `publicUrl` einem bestimmten Host gleicht. Das waere die Owner-Entscheidung im Code (Soll 6). `HERMES_GATEWAY_ORIGINS` (`src/elevenlabs/init-webhook-ziel.js:23`) wird NICHT importiert - das Modul haengt an `routes/webhooks-elevenlabs-init.js` und `render-api.js`, ein Import aus `boot-guard.js` zoege den ElevenLabs-Strang in den Boot-Pfad.

**A7 - Doku (`.env.example`, `render.yaml`).**
- `.env.example:938` (`PUBLIC_URL`): ergaenzen, dass dieser Wert der ANGEKUENDIGTE kanonische Origin ist (Token-Audience, PRM-`resource`, 401-Metadaten-Verweis) und dass er in Produktion ausdruecklich gesetzt sein muss, nicht geerbt.
- `.env.example:984-986` (`OAUTH_AUDIENCE`): ergaenzen, dass ein gesetzter Wert exakt `${PUBLIC_URL}/mcp` sein muss, sonst Boot-Refusal.
- neuer Block `MCP_ALLOWED_ORIGINS=` mit Erklaerung (additiv, leer = nur `PUBLIC_URL`; kein Abschalter).
- `render.yaml:698`: den Satz "PUBLIC_URL nicht noetig" ersetzen durch einen `- key: PUBLIC_URL`-Eintrag mit dem entschiedenen Wert plus Hinweis, dass die Wahrheit das Dashboard ist (`render.yaml:14-17`). Der Eintrag ist Doku; wird das Blueprint je synchronisiert, setzt er genau den gewollten Wert.

**A8 - Test-Baseline (`test/helpers.js`).**
`MCP_ALLOWED_ORIGINS: ""` in `BASE_ENV` (`test/helpers.js:55-120`, neben `CSRF_ENFORCE: "true"`). Pflicht wegen der Bestandslehre BASE_ENV-Drift: ohne die Zeile leckt eine lokale `.env` via dotenv in jeden Spawn-Test.

**A9 - Betriebsschritt (kein Code): Live-Wert feststellen und festschreiben.**
1. Feststellen ohne Raten, in dieser Reihenfolge: (a) die zwei oeffentlichen Reads oben (zeigen den WIRKSAMEN Wert - das ist der Wert, auf den es ankommt); (b) autoritativ, welche Variable ihn traegt: GET der Env-Var `PUBLIC_URL` am Service `srv-d8m0fhflk1mc73bno570` ueber die Render-API - der Leseweg existiert schon (`src/elevenlabs/init-webhook-ziel.js:82-88` `lesePublicUrlEnv`, Transport `src/render-api.js`), braucht `RENDER_API_KEY` und ist nur GET; (c) dasselbe fuer `OAUTH_AUDIENCE`.
2. Festschreiben: `PUBLIC_URL` im Render-Dashboard explizit auf den entschiedenen Origin setzen; `OAUTH_AUDIENCE` entweder leeren oder exakt auf `${PUBLIC_URL}/mcp` setzen (A6 erzwingt das danach beim Boot).
3. Gegenprobe nach dem Deploy: die zwei Reads aus "Live-Messung" liefern denselben Origin wie gesetzt.

## Erwartungsergebnis und Verifikation

| Aenderung | deterministisches Erwartungsergebnis | Verifikationsbefehl/Testdatei |
|---|---|---|
| A1/A2 fremder Origin, POST | `POST /mcp`, `Origin: https://evil.example`, GUELTIGES Token -> `403`, Body exakt `{"error":"cross_origin_blocked"}`, keine JSON-RPC-Antwort | neu `test/s2-mcp-origin.test.js` (Spawn-Server wie `test/oauth.test.js`); `node --test --test-concurrency=4 test/s2-mcp-origin.test.js` |
| A1/A2 fremder Origin, ohne Token | derselbe Request ohne Authorization -> `403` (nicht `401`) - die Wache laeuft vor `mcpAuth` | dito |
| A1/A2 kein Origin | `POST /mcp` ohne `Origin`, gueltiges Token -> `200` mit `tools/list`-Ergebnis wie heute | dito + `npm test` (rund 20 Bestandsdateien rufen `/mcp` ohne Origin) |
| A1 eigener Origin | `Origin: https://agent.test` (= `BASE_ENV.PUBLIC_URL`) -> nicht `403`; ohne Token `401`, mit Token `200` | dito |
| A1 Normalisierung | `Origin: HTTPS://Agent.Test` und `https://agent.test/` -> nicht `403`; `Origin: null` -> `403`; `Origin: https://agent.test:8443` -> `403` | dito |
| A2 GET/DELETE | `GET /mcp` mit `Origin: https://evil.example` -> `403` (nicht `405`); `GET /mcp` ohne Origin -> unveraendert `405` | dito + `test/mcp-method-not-allowed.test.js` bleibt gruen |
| A1/A5 additive Liste | Server mit `MCP_ALLOWED_ORIGINS=https://chatgpt.com` -> dieser Origin nicht `403` UND `https://agent.test` weiter nicht `403` | dito |
| A1 leere Liste ist Deny-all | Unit: `mcpOriginErlaubt("https://x.test", [])` -> `false`; `mcpOriginErlaubt(undefined, [])` -> `true` | dito (Unit-Faelle im selben File, Muster `test/sec-p3-eingabegrenzen-csrf.test.js:178-196`) |
| A4 Forensik | abgelehnter Request erzeugt genau eine Zeile `[audit] auth_failed ... grund=mcp_cross_origin origin=evil.example`; bei `Origin: null` `origin=unlesbar`; nie der rohe Header-Wert | dito (stdout des Spawn-Servers lesen, Muster `test/audit.test.js:104`) |
| A6 Audience-Divergenz | Boot mit `PUBLIC_URL=https://agent.test` + `OAUTH_AUDIENCE=https://andere.test/mcp` -> Exit-Code `1`, stderr enthaelt `Start abgebrochen` | dito (Spawn mit erwartetem Exit != 0, Muster `test/boot-prod-footguns.test.js`) |
| A6 Pfad in PUBLIC_URL | Boot mit `PUBLIC_URL=https://agent.test/gateway` -> Exit-Code `1` | dito |
| A6 Muell in der Allowlist | Boot mit `MCP_ALLOWED_ORIGINS=agent.test` (kein Schema) -> Exit-Code `1` | dito |
| A6 Happy Path | Boot mit `PUBLIC_URL=https://agent.test`, `OAUTH_AUDIENCE=""` -> startet, `findings` leer | dito + gesamte Suite |
| A9 Live | nach dem Deploy: `curl -s https://<origin>/.well-known/oauth-protected-resource` -> `"resource":"<origin>/mcp"`; `curl -i -X POST https://<origin>/mcp -H 'Origin: https://evil.example' -d '{}'` -> `403 cross_origin_blocked`; derselbe POST ohne Origin -> `401` | manueller Smoke-Test (zwei curls, keine Kosten, kein Anruf) |
| A9 Connector lebt | ein MCP-Werkzeugaufruf des heute verbundenen Connectors (z.B. `get_my_number`) nach dem Deploy -> liefert wie vorher | manueller Smoke-Test |

## Blast Radius

- **Dateien (10 + 1 neu):** `src/middleware.js` (4 neue Funktionen), `src/routes/mcp.js` (1 Mount-Zeile + Kommentar), `src/app.js` (1 Kommentar), `src/util.js` (1 Enum-Eintrag, 1 Signatur), `src/config.js` (1 Schluessel + 1 Namespace-Eintrag), `src/boot-guard.js` (1 Funktion), `src/boot.js` (1 Assert + Aufruf), `.env.example` (3 Stellen), `render.yaml` (1 Stelle), `test/helpers.js` (1 BASE_ENV-Zeile), neu `test/s2-mcp-origin.test.js`.
- **Aufrufer `/mcp`:** rund 20 Testdateien (`grep -rn "/mcp" test/`), alle ohne `Origin` (`mcpPost`, `test/helpers.js:1294-1304`) -> unberuehrt. Kein Browser-Aufrufer (`src/ui/` ohne `fetch(`, `apps/web` nur Textlink).
- **`route-policy.js` / `route-auth-inventory`:** unveraendert. Die Wache ist eine `use`-Schicht ohne eigene Route, der Fingerprint (`test/route-auth-inventory.test.js:174-245`) und die vier gepinnten Auth-Middleware-Namen (`:298-308`) bleiben gleich. POST/GET/DELETE `/mcp` behalten ihre Einordnung (`src/route-policy.js:239,244`).
- **`auditAuthFailed`-Signatur:** 5 Bestandsaufrufer (s. A4), alle zweiargumentig und damit unveraendert gueltig. `test/`-Treffer auf `AUTH_FAILED_GRUND` pruefen, ob eine Testdatei die Enum-Vollstaendigkeit pinnt.
- **`publicUrl` ausserhalb des MCP-Kanals:** Voice-Webhooks (`src/routes/api-calls.js:500-501`, `src/routes/voice.js:502`), TTS (`src/tts/directive-synth.js:120`), Stripe-Rueckkehr (`src/routes/api-billing.js:105-106`), OIDC-Redirect (`src/wiring/web-login.js:263,279`), Newsletter (`src/newsletter-recipients.js:73-78`), Icon (`src/mcp-server-info.js:66`). Dieser Schnitt AENDERT den Wert nicht (Option A = der live wirksame Wert), er schreibt ihn nur fest. Nur wenn die Owner-Entscheidung auf den anderen Host fiele, bewegen sich alle diese Ziele mit - dann ist ein Deploy mit Gegenprobe je Ziel faellig (Telnyx-`voice_url`, Stripe-Rueckkehr-URL, WorkOS-Redirect-URI).
- **Was kaputtgehen KANN:** (1) ein MCP-Client, der einen `Origin` sendet, den wir nicht kennen, wird ausgesperrt - fuer den heute verbundenen Connector unbelegt, fuer ChatGPT UNKNOWN; Diagnose ueber `grund=mcp_cross_origin origin=<host>`, Heilung additiv per Env. (2) Ein bestehendes Access-Token bricht, sobald `audience()` sich aendert (`src/auth.js:83`): bei Option A aendert sich nichts (live schon `https://app.sundartha.com/mcp`), bei Option B brechen ALLE bestehenden Connector-Verbindungen und muessen neu autorisiert werden. (3) Boot-Refusal bei einer heute unbemerkt divergenten `OAUTH_AUDIENCE` - das ist gewollt, kann aber den ersten Deploy scheitern lassen; deshalb A9 Schritt 1c VOR dem Deploy.
- **Flags:** ein neues Env `MCP_ALLOWED_ORIGINS` (Default leer), kein neuer Schalter. `CSRF_ENFORCE` bleibt unberuehrt (andere Wache, andere Routen).

## Beruehrte absolute Regeln

- **Regel 3 (Auth fail-closed):** beruehrt, aber gestaerkt. `mcpAuth` bleibt unveraendert die Identitaetspruefung auf POST `/mcp`; die Origin-Wache kommt DAVOR und lehnt zusaetzlich ab. Es kommen strikt weniger Requests durch. Keine Route wird geoeffnet, kein Bypass ergaenzt, `src/route-policy.js` bleibt gleich.
- **Regel 4 (Secrets/Logging):** beruehrt. Ins Log geht nur der zeichenklassen-gefilterte HOST des Origins (max. 64 Zeichen) oder `unlesbar`, nie der rohe Header und nie ein Token.
- **Regel 6 (Scope):** die Challenge-Route (`/.well-known/openai-apps-challenge`, P0-2) ist NICHT Teil dieses Schnitts, obwohl sie am selben Host haengt.
- Safety-Gates (Regel 1), Offenlegung (Regel 2) und Audio (Regel 5) sind nicht beruehrt: dieser Schnitt loest keinen Anruf aus und veraendert keinen Gespraechspfad.
- Keine geplante Aufweichung. Der einzige Punkt, der eine Owner-Entscheidung braucht, ist der WERT von `PUBLIC_URL` - nicht die Existenz einer Pruefung.

## Abhaengigkeiten

- **Owner-Entscheidung (P0-11), muss VOR A9 Schritt 2 stehen:** unter welchem Origin wird eingereicht. Beide Zweige sind hier vollstaendig geplant und unterscheiden sich NUR im Wert:
  - *Zweig A `https://app.sundartha.com`*: Wert setzen = Bestaetigung des live wirksamen Zustands. Keine Token brechen, keine Webhook-/Redirect-Ziele bewegen sich, das Marketing nennt diese URL schon (`apps/web/src/pages/index.astro:38`).
  - *Zweig B `https://vodafone-agent.onrender.com`*: `PUBLIC_URL` auf diesen Wert setzen. Folge: `audience()` und `PRM.resource` wechseln -> alle bestehenden Connector-Tokens werden abgelehnt (`src/auth.js:83`), und die uebrigen `publicUrl`-Verbraucher (Voice-`voice_url`, Stripe-Rueckkehr, OIDC-Redirect) wechseln mit - dort ist je Ziel eine Gegenprobe faellig. Zusaetzlich muss die WorkOS-Resource-Registrierung nachgezogen werden.
  Der Code ist in beiden Zweigen identisch; kein `if`, kein Hostname im Quelltext.
- **Kein Zweig braucht diesen Schnitt zuerst:** die Origin-Pruefung (A1-A6) ist unabhaengig von der Entscheidung und kann vor ihr gebaut und deployed werden - die Allowlist folgt automatisch dem gesetzten `PUBLIC_URL`.
- **Nachfolger, nicht Vorgaenger:** die Domain-Challenge-Route (P0-2) gehoert auf den hier festgeschriebenen Host bzw. dessen Parent (O-5); sie wartet auf die Entscheidung, nicht auf diesen Code.
- **Fremde Schnitte:** ein Schnitt, der `src/routes/mcp.js` umbaut (z.B. Protokoll-/Fehlercode-Arbeit an T-05/T-19), kollidiert textlich mit A2/A3.

## Offene Fragen

1. Sendet der ChatGPT-MCP-Client einen `Origin`-Header, und mit welchem Wert? UNKNOWN, aus dem Repo nicht entscheidbar. Wird erst beim ersten Verbindungsversuch sichtbar (dann als `grund=mcp_cross_origin origin=<host>` im Render-Log) und ist additiv heilbar. Nicht wegplanbar.
2. Sendet der heute verbundene Claude-Connector einen `Origin`? UNKNOWN; der Smoke-Test "Connector lebt" nach dem Deploy beantwortet es in einem Aufruf.
3. Traegt `RENDER_EXTERNAL_URL` am Live-Dienst den Marken-Host, oder ist `PUBLIC_URL` dort bereits gesetzt? UNKNOWN bis A9 Schritt 1b; fuer das Ergebnis dieses Schnitts gleichgueltig (danach ist `PUBLIC_URL` gesetzt).
4. Ist `OAUTH_AUDIENCE` live gesetzt? UNKNOWN (von aussen nicht unterscheidbar). Entscheidet, ob A6 beim ersten Deploy den Boot verweigert - deshalb A9 Schritt 1c vorher.
5. Gilt T-06 aus Sicht des OpenAI-Pruefers als geprueft? Unbelegt (`01-protokoll-transport.md`, Offene Fragen). Aendert nichts: die MCP-Spec-Pflicht besteht unabhaengig davon.

## Pre-Mortem

Nachgeprueft am Code (Branch master, 2026-09-18) und mit zwei eigenen Live-Reads. Die
Ist-Behauptungen des Spec stimmen bis auf die unten genannten Punkte; die SDK-Belege sind exakt
(`node_modules/@modelcontextprotocol/sdk/dist/esm/server/webStandardStreamableHttp.js:70`
`?? false`, `:109` Skip ohne Flag, `:122` Skip bei leerer Liste, `:125` Echo des fremden Origins
in der Fehlermeldung, `:124` `includes` ohne Normalisierung).

**Korrekturen am Ist-Teil (belegt):**
- `CONFIG_NAMESPACES.safety` steht auf `src/config.js:2254`, nicht `:2245`.
- Blast Radius: nicht "rund 20", sondern **47** Testdateien nennen `/mcp`
  (`grep -rl "/mcp" test/ | wc -l` = 47). Der Schluss bleibt gueltig: keine sendet einen Origin
  (`grep -rn "Origin:" test/*.test.js` trifft nur Self-Service/CSRF, `test/sec-p3-eingabegrenzen-csrf.test.js:119,295`).
- **Soll 6 ist falsch:** es gibt zwei Codepfade, die die Hosts nennen UND `publicUrl` gegen sie
  richten: `src/elevenlabs/init-webhook-ziel.js:23` (`INIT_WEBHOOK_ORIGIN = "https://app.sundartha.com"`,
  `HERMES_GATEWAY_ORIGINS`) und das reine Urteil `:137-141`
  (`wirksam = publicUrlEnv || serviceUrl`, dann `HERMES_GATEWAY_ORIGINS.includes(wirksamerOrigin)`
  -> sonst `ORIGIN_NICHT_ERLAUBT`). A6 verzichtet bewusst auf den Import - das Urteil existiert
  aber trotzdem und A9 Schritt 2 laeuft hinein.
- Die `publicUrl`-Verbraucherliste im Blast Radius ist unvollstaendig. Zusaetzlich (grep
  `publicUrl` in `src/`): `src/routes/voice.js:502` (Eingabe der Provider-Signaturpruefung -
  heute ungenutzt, `src/telephony/adapters/telnyx/signature.js` liest kein `url`),
  `src/billing/payment-gate.js:26` (`requirePublicUrl` - Checkout-Riegel),
  `src/elevenlabs/init-webhook-ziel.js:137`, `src/telephony/voice-render.js:32`,
  `src/elevenlabs/inbound-rueckfall.js:134,138`, `src/server.js:316`,
  `src/self-service-routes.js:201,212,602`, `src/telephony/call-finish.js:138`,
  `src/billing/cancellation-mail.js:113`, `src/boot.js:901-904`.

### PM-1 (schwerste): A9 setzt PUBLIC_URL von Hand -> gut geformter Tippfehler -> Mensch wird angerufen und hoert Stille, ohne Offenlegung

Kette: A9 Schritt 2 setzt `PUBLIC_URL` erstmals ausdruecklich im Dashboard -> ein
gut geformter, aber falscher Host (`https://app.sundhartha.com`) passiert JEDE Pruefung aus A6
(https ja, kein Pfad, `OAUTH_AUDIENCE` leer) und auch `src/config.js:2468` (nur leer/CHANGE-ME)
-> `src/routes/api-calls.js:500-501` baut daraus `voice_url` und `statusCallback` -> Telnyx waehlt
den echten Menschen, unser Answer-Webhook wird nie erreicht, der Angerufene hoert Stille und den
Offenlegungssatz nie; `/voice/status` faellt aus, der Anruf wird nie abgeschlossen/gebucht.
Parallel brechen OIDC-Redirect (`src/wiring/web-login.js:263`), Stripe-Rueckkehr
(`src/routes/api-billing.js:105-106`) und die TTS-URL (`src/tts/directive-synth.js:120`).
Bewertung: **OFFEN.** A6 prueft Form, nicht Identitaet, und verbietet den Host-Vergleich
ausdruecklich ("Bewusst NICHT geprueft"). Die A9-Gegenprobe prueft nur zwei `/.well-known`-Reads
und einen MCP-Aufruf - kein Schritt beruehrt den Voice-Pfad. Entlastend: die Gespraechsdauer ist
provider-seitig geklemmt (`src/telephony/adapters/telnyx/voice.js:660` `TimeLimit`,
`src/telephony/adapters/telnyx/render.js:207`), der Schaden ist also pro Anruf begrenzt - aber
Regel 2 ist im Feld ausgehebelt, ohne dass Code angefasst wurde. Vorhandene, ungenutzte
Gegenmassnahme: `HERMES_GATEWAY_ORIGINS` (`src/elevenlabs/init-webhook-ziel.js:23`) ist genau die
Kandidatenliste, gegen die A6 pruefen koennte.

### PM-2: Origin-Wache sperrt den live verbundenen Connector aus -> Connector tot, Rollback nur per Deploy

Kette: A2 mountet `mcpOriginOnlyMiddleware` vor `mcpAuth` (`src/routes/mcp.js:51`) -> der heute
verbundene Client sendet einen `Origin`, der nicht `https://app.sundartha.com` ist -> jeder
Werkzeugaufruf 403 -> der Owner merkt es erst beim naechsten Versuch; `check_inbox`/`place_call`
sind tot. Bewertung: **TEILWEISE.** Offene Frage 2 benennt es, Diagnose
(`grund=mcp_cross_origin origin=<host>`) und additive Heilung sind geplant. Nicht geplant ist die
REIHENFOLGE: die einzige Messung ist eine NACHmessung ("Connector lebt", A9), und weil A5 jeden
Schalter verbietet, ist der schnelle Notaus kein Env-Flip, sondern das Erraten des richtigen
Origins - der echte Rollback ist ein Code-Revert plus Deploy. Wichtiges Gegengewicht, das das
Spec nicht nennt und das die Risikoabwaegung dreht: der Sicherheitsgewinn LIVE ist nahe null.
Es gibt nirgends CORS (`grep -rn "Access-Control" src/` = 0 Treffer), also scheitert jeder
Browser-Request mit `Authorization`/`application/json` schon am Preflight, und
`MCP_AUTH=oauth` ist live belegt (s.u.). Der Nutzen ist Konformitaet mit T-06
(`tasks/openai-audit/00-mcp-spec.md:44`) plus Absicherung des Dev-Bypasses
(`src/auth.js:19` `legacyLocalBypassAllowed`) und des Footgun-Falls `MCP_AUTH=off`
(`src/config.js:2396` - nur WARN, kein Boot-Riegel). Kleiner Nutzen gegen realen
Connector-Tod heisst: messen vor sperren.

### PM-3: A6 wird fatal -> ein spaeterer Dashboard-Edit -> naechster Render-Neustart startet nicht -> Gateway tot, Inbound stumm

Kette: A6 ruft `process.exit(1)` -> irgendwann setzt jemand `PUBLIC_URL` mit Pfad, auf `http`,
oder vertippt sich in `MCP_ALLOWED_ORIGINS` -> der naechste Neustart (Render ersetzt Instanzen
auch OHNE Deploy) faellt aus -> `/voice/incoming` antwortet nicht, Anrufer hoeren nichts, EL-Bein
und `/voice/status` laufen ins Leere. Bewertung: **TEILWEISE, Begruendung fehlt.** Das Repo hat
den Gegen-Praezedenzfall im selben File: `src/boot-guard.js` (`llmFallbackFindings`) waehlt
ausdruecklich WARN statt fatal, weil "ein Boot-Refusal einen Tippfehler gegen einen
Telefonie-Totalausfall tauschte" - fuer genau denselben Fall (Env-Wert aus dem Dashboard). Das
Spec waehlt fatal, ohne diesen Praezedenzfall zu nennen oder zu widerlegen. Fuer den ERSTEN
Deploy ist das Risiko dagegen am eigenen Messwert widerlegt (s. Live-Annahmen) - der Aufwand aus
A9 1b/1c ist dafuer nicht noetig.

### PM-4: Allowlist wird EINMAL bei der Fabrik gebildet -> Snapshot -> dauerhaftes Deny-all bis zum Neustart

Kette: A1/A2 normalisieren die Liste "EINMAL bei der Fabrik" und `mcpErlaubteOrigins(config)`
laeuft zur Mount-Zeit -> ist `config.server.publicUrl` in diesem Moment leer oder unparsbar
(Bestand: `test/telephony-registry.test.js:120` setzt `""`; `buildApp` ohne `src/boot.js` laeuft
OHNE jeden Boot-Riegel; `src/config.js:2468` greift nur im Boot-Pfad) -> Allowlist `[]` oder
`[""]` -> jeder Request MIT Origin dauerhaft 403, und keine Env-Aenderung hilft, nur ein
Neustart. Bewertung: **TEILWEISE.** Soll 3 will "leer = deny-all" gewollt, aber die Tabelle
"Erwartungsergebnis und Verifikation" hat keine Zeile fuer "publicUrl leer" und keine fuer
unparsbare LISTENeintraege zur Laufzeit (A6 deckt sie nur im Boot). Der Fall ist genau der, in
dem der Connector stirbt, ohne dass jemand einen Origin falsch geraten hat.

### PM-5: Eine zweite Origin-Semantik neben der ersten -> spaetere "Vereinheitlichung" -> Gate wirkt nur noch scheinbar

Kette: A1 legt `mcpOriginErlaubt` (Anker: konfigurierte Allowlist) direkt neben
`crossOriginRequest` (`src/middleware.js:76-87`, Anker: `req.headers.host`) -> ein spaeterer
Aufraeumer sieht zwei fast gleiche Praedikate im selben File und fasst sie zusammen -> bekommt
`/mcp` den Host-Echo-Anker, ist die Wache bei jeder Custom-Domain wirkungslos (jeder Origin, der
dem angesprochenen Host gleicht, passiert); bekommen die Self-Service-Routen die Allowlist, sperrt
das lokale Dashboard sich selbst aus (`test/sec-p3-eingabegrenzen-csrf.test.js:119` nutzt
`http://127.0.0.1:<port>` als eigenen Origin, waehrend `PUBLIC_URL=https://agent.test` ist,
`test/helpers.js:107`). Bewertung: **OFFEN.** Das Spec begruendet die Ablehnung der SDK-Option,
aber nicht die Koexistenz der zwei Praedikate und nicht, woran ein Leser sie auseinanderhaelt
(Lehre `clean-code-audit-2026-07`: Fragilitaet = Invarianten-per-Konvention).

### PM-6: Neue Log-Zeile je Ablehnung -> Log-Flut -> der echte Befund geht unter

Kette: A4 schreibt je Ablehnung eine `auth_failed`-Zeile -> ein Scanner sendet dauerhaft
Origin-Header -> der eine Zeile, die zaehlt (der Origin des echten Clients), ist nicht mehr
findbar. Bewertung: **GEDECKT, aber unbelegt.** Der globale Rate-Limiter laeuft VOR dem Router und
schliesst `/mcp` ein (`src/app.js:130-136`; ausgenommen sind nur `/voice` und
`isTrustedLocalCaller`) - der Deckel ist `rateLimitPerMin` je IP. Das Spec nennt diesen Schutz
nicht; wer `/mcp` spaeter aus dem Limiter nimmt, oeffnet den Pfad, ohne es zu merken.

### PM-7: Pfadloses `router.use` -> Wache sieht jeden Request -> gesamtes Gateway sperrt fremde Origins aus

Kette: A2 wird ohne das Pfadargument umgesetzt oder es faellt bei einem spaeteren Refactor weg
(der Router ist auf `/` gemountet, `src/app.js:420`) -> jeder Request des Gateways laeuft durch die
MCP-Allowlist -> jede Browser-Route mit fremdem Origin 403, und in lokalem Betrieb auch das eigene
Dashboard. Bewertung: **TEILWEISE.** A2 nennt das Risiko in seiner Begruendung ausdruecklich -
aber die Verifikationstabelle enthaelt KEINEN Test dafuer. Der gefaehrlichste Fehler der Aenderung
hat damit keine Positiv-Kontrolle.

### Live-Annahmen: was belegt ist und was offen bleibt

Eigene Reads am 2026-09-18 (read-only, keine Kosten):
`curl https://app.sundartha.com/.well-known/oauth-protected-resource` und derselbe Read ueber
`vodafone-agent.onrender.com` -> beide `{"resource":"https://app.sundartha.com/mcp",
"authorization_servers":["https://fearless-network-26.authkit.app"]}`;
`curl -i -X POST https://app.sundartha.com/mcp -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`
-> `401` mit `www-authenticate: Bearer resource_metadata="https://app.sundartha.com/.well-known/oauth-protected-resource"`.
Das bestaetigt die Live-Messung des Spec und ergaenzt sie um drei Schluesse, die das Spec nicht
zieht:
1. **`MCP_AUTH=oauth` ist live belegt.** Nur `verifyOauth` -> `deny401` setzt diesen Header
   (`src/auth.js:66-71`); der Token-Zweig antwortet `{"error":"unauthorized"}` ohne Header
   (`src/auth.js:100-103`). Damit ist auch der `MCP_AUTH=off`-Footgun live ausgeschlossen.
2. **Offene Frage 4 ist beantwortet, soweit sie fuer A6 zaehlt.** `PRM.resource` ist
   `audience() = oauthAudience || publicUrl + "/mcp"` (`src/auth.js:23,123`), der 401-Header ist
   reines `publicUrl` (`src/auth.js:24`). Gemessen gilt `resource === publicUrl + "/mcp"`, also ist
   `OAUTH_AUDIENCE` entweder leer ODER exakt gleich - **A6 kann beim ersten Deploy nicht fatal
   werden.** Das Spec haelt dieses Risiko offen und plant dafuer einen Render-API-Leseschritt
   (A9 1b/1c, `RENDER_API_KEY`), den seine eigenen Daten erledigt haben.
3. **Unbelegt bleibt**, welche Variable den Wert traegt. Solange `PUBLIC_URL` nicht gesetzt ist,
   folgt `publicUrl` still `RENDER_EXTERNAL_URL` (`src/config.js:1494`) - eine Render-seitige
   Umbenennung/Domain-Aenderung verschiebt dann Audience, Allowlist und alle Webhook-Ziele
   gleichzeitig. Genau das schliesst A9 Schritt 2; A9 ist aber NICHT vor den Merge/Deploy von A6
   gestellt.
Zusaetzlich ungeprueft: `app.sundartha.com` antwortet ueber Cloudflare (`server: cloudflare`,
`cf-ray` im gemessenen Response). Dass der `Origin`-Header dort unveraendert durchgeht, ist
plausibel, aber von diesem Spec nicht belegt - UNKNOWN, relevant nur fuer PM-2.
`render.yaml` bleibt korrekt als Doku behandelt (`render.yaml:14-17`, `:698`); das Spec verlaesst
sich an keiner Stelle darauf.

### Absolute Regeln: unbenannte Beruehrung

- **Regel 3** ist korrekt eingeordnet (gestaerkt, strikt weniger Requests kommen durch).
- **Regel 2 (Offenlegung) ist beruehrt und im Spec als "nicht beruehrt" gefuehrt.** Nicht durch
  Code, sondern durch A9 Schritt 2: derselbe Wert traegt den Voice-Rueckweg
  (`src/routes/api-calls.js:500-501`), ueber den der Offenlegungssatz ueberhaupt erst gesprochen
  wird (PM-1). Das gehoert benannt, nicht weggeplant - die Aenderung selbst bleibt zulaessig.
- **Regel 1** bleibt unberuehrt im Code. Randnotiz: derselbe Wert riegelt den Checkout ab
  (`src/billing/payment-gate.js:26`) - ein leerer Wert ist dort fail-closed, also unkritisch.
- **Regel 6 (Scope):** A4 aendert eine von vier Modulen geteilte Signatur; vertretbar und
  rueckwaertskompatibel, aber es ist eine Bestandsaenderung ausserhalb des `/mcp`-Pfads.
- Keine geplante Aufweichung gefunden. A5 (kein Abschalter) ist die richtige Lesart von CLAUDE.md;
  die Folge - der einzige Rollback ist Revert plus Deploy - steht im Spec nicht und ist eine
  Owner-relevante Tatsache, keine Fussnote.

### Verifikation: was nicht falsifizierbar ist

- **"A9 Connector lebt" ist nicht falsifizierbar.** Sendet der Client keinen Origin, ist die Zeile
  gruen, auch wenn die Wache voellig kaputt waere (z.B. `next()` in jedem Fall). Nur das PAAR
  macht sie falsifizierbar: derselbe Live-Endpunkt muss im selben Durchgang `403` auf
  `Origin: https://evil.example` UND `401`/`200` ohne Origin liefern. Beide curls stehen im Spec,
  ihre Kopplung als Positiv-/Negativ-Kontrolle nicht (Lehre
  `pruefkommando-ohne-positiv-kontrolle`).
- **Fehlende deterministische Zeilen:** (a) `POST /api/...` mit `Origin: https://evil.example`
  verhaelt sich unveraendert (Positiv-Kontrolle der Pfadbindung, PM-7); (b) `publicUrl` leer ->
  definiertes Verhalten (PM-4); (c) zwei `Origin`-Header im Request (Node fasst sie zu
  `"a, b"` zusammen) -> `403`, nicht versehentlich geparst; (d) `PUBLIC_URL=HTTPS://Agent.Test`
  (Normalisierung auf der ALLOWLIST-Seite, im Spec nur fuer die Header-Seite zugesagt);
  (e) `/mcp/foo` mit fremdem Origin -> `403` statt `404` (harmlos, aber undeklariert).
- Die Suite-weite Zeile nennt `npm test` ohne `--test-concurrency=4`; die Bestandslehre
  (`sec-testbank-parallel-race`) verlangt es, sonst ist ein rotes Ergebnis nicht deutbar.

### Mergefaehigkeit

A1-A8 sind in EINER Phase mergefaehig: die Wache ist inert, solange kein Request einen Origin
traegt, und keine der 47 `/mcp`-Testdateien sendet einen. Kein Zwischenzustand im Repo ist kaputt.
Operativ ist der Schnitt aber NICHT abgeschlossen: A6 ist fatal, waehrend A9 Schritt 2 ein
Handgriff im Dashboard ist. Wird A1-A8 deployed, bevor `PUBLIC_URL` ausdruecklich gesetzt ist,
haengt die Allowlist am implizit geerbten Wert (heute identisch, morgen nicht garantiert). Saubere
Reihenfolge: A9 Schritt 2 (PUBLIC_URL explizit setzen, Gegenprobe) VOR dem Deploy von A6 - oder
A6s Audience-Befund in der ersten Phase als WARN.

### Nachzubessern im Spec

1. **PM-1 schliessen:** A6 muss den gesetzten `PUBLIC_URL` gegen eine Kandidatenliste pruefen, nicht
   nur gegen die Form. Einfachste Loesung: `HERMES_GATEWAY_ORIGINS` aus
   `src/elevenlabs/init-webhook-ziel.js:23` nach `src/config.js` heben (reine Konstante, zieht
   keinen EL-Strang in den Boot-Pfad) und A6 gegen sie pruefen - dieselbe Liste, gegen die
   `zielUrteil` (`:137-141`) schon heute urteilt. Ersatzweise, wenn das abgelehnt wird: A9 um
   einen Pflicht-Smoke des Voice-Pfads ergaenzen (ein Testanruf an die eigene Owner-Nummer, mit
   gehoerter Offenlegung) und das als Betriebsschritt VOR jedem PUBLIC_URL-Wechsel festschreiben.
2. **Soll 6 korrigieren:** "kein Codepfad nennt einen der beiden Hosts" ist falsch
   (`init-webhook-ziel.js:23`, Urteil `:137-141`). Dazu die Folge fuer Zweig B ergaenzen:
   `INIT_WEBHOOK_ORIGIN` ist auf `https://app.sundartha.com` hart gesetzt, ein Wechsel auf den
   onrender-Host laesst das IEL-Init-Ziel und den angekuendigten Origin auseinanderlaufen.
3. **PM-2 entscheiden statt offen lassen:** die Reihenfolge festschreiben - entweder (a) eine erste
   Phase, die den Origin NUR protokolliert (A4 ohne A2-Ablehnung), einen echten Connector-Aufruf
   abwartet und erst dann sperrt, oder (b) ausdruecklich als Owner-Entscheidung notieren:
   "der Connector kann nach dem Deploy tot sein, Heilung = Origin aus dem Render-Log in
   `MCP_ALLOWED_ORIGINS` nachtragen, schlimmster Fall Revert plus Deploy". Dazu die Abwaegung
   nennen, die das rechtfertigt: der Live-Sicherheitsgewinn ist nahe null (kein CORS in `src/`,
   `MCP_AUTH=oauth` live belegt), der Nutzen ist T-06-Konformitaet.
4. **PM-3 begruenden oder abschwaechen:** den Praezedenzfall `llmFallbackFindings`
   (`src/boot-guard.js`, WARN statt fatal gegen einen Dashboard-Tippfehler) nennen und entweder
   widerlegen oder den Audience-Befund in der ersten Phase als WARN fuehren. Mit Beleg aus den
   Live-Reads gilt: A6 kann heute nicht fatal werden - A9 1b/1c (Render-API, `RENDER_API_KEY`)
   entfaellt damit als Pflichtschritt und wird optional.
5. **Offene Frage 4 streichen und durch den Schluss ersetzen:** `PRM.resource === publicUrl + "/mcp"`
   (gemessen) beweist `OAUTH_AUDIENCE` leer ODER exakt gleich (`src/auth.js:23,123`); zusaetzlich
   ist `MCP_AUTH=oauth` live belegt (`src/auth.js:66-71` gegen `:100-103`).
6. **PM-4 schliessen:** festlegen, dass `mcpErlaubteOrigins` unparsbare Eintraege verwirft, und
   eine Tabellenzeile fuer `publicUrl` leer ergaenzen (Erwartung: deny-all fuer Requests MIT
   Origin, unveraendert fuer Requests OHNE - deterministisch als Unit-Fall).
7. **PM-7 schliessen:** Tabellenzeile "`POST /api/self-service/...` mit `Origin: https://evil.example`
   verhaelt sich unveraendert" als Positiv-Kontrolle der Pfadbindung, im selben neuen Testfile.
8. **A9 falsifizierbar machen:** die zwei Live-curls ausdruecklich als Paar (Negativ 403 +
   Positiv 401/200 ohne Origin) und den Connector-Aufruf erst DANACH als Aussage ueber den
   Client, nicht ueber die Wache.
9. **Verifikationstabelle ergaenzen:** doppelter `Origin`-Header -> 403; `PUBLIC_URL` mit
   Grossbuchstaben im Host -> nicht 403; `/mcp/foo` mit fremdem Origin -> 403 (erwartet und
   deklariert); Suite-Zeile auf `npm test` mit `--test-concurrency=4` korrigieren.
10. **PM-5 entschaerfen:** im Kommentar zu `mcpOriginErlaubt` den Unterschied zu
    `crossOriginRequest` benennen (konfigurierte Allowlist vs. Host-Echo, und warum die
    `/mcp`-Wache den Host-Anker NICHT verwenden darf), damit eine spaetere Zusammenlegung als
    Aufweichung erkennbar ist.
11. **PM-6 belegen:** den Rate-Limiter vor dem Router (`src/app.js:130-136`) als Deckel der neuen
    Log-Zeile im Blast Radius nennen - und dass `/mcp` dort nicht ausgenommen werden darf.
12. **Zahlen korrigieren:** 47 statt "rund 20" Testdateien, `CONFIG_NAMESPACES.safety` `:2254`,
    und die `publicUrl`-Verbraucherliste um `voice.js:502`, `payment-gate.js:26`,
    `init-webhook-ziel.js:137`, `voice-render.js:32`, `inbound-rueckfall.js:134,138`,
    `server.js:316`, `self-service-routes.js:201,212,602`, `call-finish.js:138`,
    `cancellation-mail.js:113` erweitern.

## Pre-Mortem - zweiter, unabhaengiger Durchgang (2026-09-18)

Der erste Durchgang oben bleibt unveraendert stehen. Dieser Abschnitt hat seine Belege am Code
nachgezogen (Branch `master`, Stand `3d32492`) und drei eigene Live-Reads ergaenzt. Ergebnis: die
SDK-Belege, die Mount-Topologie, die Forensik-Konstanten und die Praezedenz `llmFallbackFindings`
(`src/boot-guard.js:107-117`, WARN mit exakt der Begruendung "ein Boot-Refusal tauschte einen
Tippfehler gegen einen Telefonie-Totalausfall") stimmen. Vier Belege stimmen NICHT - einer davon
dreht die Risikoabwaegung des Schnitts.

### Korrekturen (belegt)

- **K-1 (wichtig): `MCP_AUTH=off` ist in Produktion KEIN WARN, sondern Boot-Refusal.** Der erste
  Durchgang fuehrt "`src/config.js:2396` - nur WARN, kein Boot-Riegel" als eine der zwei
  Rechtfertigungen fuer den Restnutzen der Wache. Falsch: der Eintrag steht in
  `PRODUCTION_FOOTGUNS` (`src/config.js:2387`, Off-Zeile `:2396`), `productionFootguns()`
  (`:2423-2428`) liefert im Hosting jeden Treffer, und `fatalConfigFindings` faltet ihn in die
  Fatal-Liste (`src/config.js:2543`) -> Boot verweigert. Der Kommentar bei `csrfEnforce` sagt es
  woertlich: "BEWUSST NICHT in PRODUCTION_FOOTGUNS: jeder Treffer dort ist FATAL"
  (`src/config.js:1941-1942`). **Folge:** der Live-Sicherheitsgewinn der Origin-Wache ist noch
  kleiner als der erste Durchgang schreibt - kein CORS (`grep -rn "Access-Control" src/` = 0),
  `MCP_AUTH=oauth` live belegt, `MCP_AUTH=off` in Produktion unmoeglich, `legacyLocalBypassAllowed`
  nur ausserhalb Produktion (`src/auth.js:18-20`). Bleibt: T-06-Konformitaet. Das ist der ganze
  Nutzen, gegen den PM-2 (Connector-Tod) abzuwaegen ist.
- **K-2: `CONFIG_NAMESPACES.safety` steht auf `src/config.js:2252`** (`export const
  CONFIG_NAMESPACES` auf `:2251`). Spec sagt `:2245`, erster Durchgang `:2254` - beide falsch.
- **K-3 (wichtig): A5 ("KEIN Abschalt-Flag") widerspricht der naechstliegenden Praezedenz im
  Bestand, ohne sie zu nennen.** `csrfEnforce` (`src/config.js:1937-1943`) ist DIESELBE Bauform
  (Herkunftspruefung, Default AN) und hat einen Schalter, mit dieser Begruendung: "Der Schalter
  existiert ALS RUECKFALL, nicht als Bequemlichkeit: bricht ein Deployment die Annahme
  'Origin-Host == Request-Host' (z.B. ein Proxy, der den Host-Header umschreibt), ist das
  Dashboard sonst nicht mehr bedienbar." Genau dieser Fall ist PM-2, nur mit dem Connector statt
  dem Dashboard. Die Abschaltform existiert ebenfalls schon und ist nicht fail-open:
  `enforce !== false` (`src/middleware.js:91-94`) - nur der Literalwert `false` schaltet ab.
  A5s Begruendung ("CLAUDE.md verbietet neue abgeschaltete Sicherungen") trifft einen Default-AUS-
  Schalter, nicht einen Default-AN-Rueckfall.
- **K-4: PM-4s Beleg traegt nicht, der Mechanismus schon.** `test/telephony-registry.test.js:120`
  setzt `config.server.publicUrl = ""` - dieser Test baut aber keine App und bildet keine
  Allowlist. Der echte in-repo-Trigger ist `test/route-auth-inventory.test.js`: es ruft `buildApp`
  direkt (in-process, ohne `src/boot.js` und damit ohne jeden Boot-Riegel). Der Fabrik-Snapshot
  entsteht dort aus der real geladenen `.env`.

### Neue Schadenspfade

#### N-1 (schwerster neuer): 403 vor `mcpAuth` -> kein 401-Challenge -> Re-Autorisierung unmoeglich -> Connector dauerhaft tot, Owner kann NICHTS reparieren

Kette: A2 setzt die Wache vor `mcpAuth` -> ein Client, der einen Origin sendet, bekommt auf JEDEN
Request 403, auch auf den ersten unauthentifizierten -> damit sieht er nie den
`WWW-Authenticate: Bearer resource_metadata=...`-Header, der der EINZIGE Zeiger auf den
Authorization Server ist (`src/auth.js:66-73`, live gemessen) -> die OAuth-Discovery startet nicht
-> auch "Connector neu verbinden" im Host scheitert. Bewertung: **OFFEN.** Die Tabelle deklariert
`403 (nicht 401)` als GEWOLLT und begruendet es richtig (Wache vor Auth); die Folge - der
client-seitige Reparaturweg ist mitgesperrt - steht nirgends. Genau das verwandelt PM-2 von
"Werkzeugaufrufe scheitern" in "von aussen nicht heilbar": es bleibt nur ein Env-Nachtrag im
Dashboard mit geratenem Origin oder Revert plus Deploy. Mit K-3 ist es ein Flag-Flip.

#### N-2: Deploy waehrend eines laufenden Anrufs -> Consult-Schleife stirbt -> der fremde Mensch am Telefon bekommt keine Antwort, der Anruf laeuft kostenpflichtig weiter

Kette: A1-A8 werden deployed, waehrend ein Outbound-Anruf laeuft (oder der Origin des Connectors
ist nicht erlaubt) -> der Long-Poll `await_call_event` (`src/mcp-tools.js:588-603`, `pollConsult`
mit `CONSULT_POLL_ABORT_MS`) liefert 403 statt eines Events -> `answer_consult` kommt nie ->
der Agent am Telefon wartet, laeuft in den Fallback "der Auftraggeber kommt darauf zurueck", das
Ziel wird verfehlt, die Minuten sind gebucht. Bewertung: **OFFEN.** Der Blast Radius nennt
"`check_inbox`/`place_call` sind tot", aber keine Zeile betrifft einen Anruf IM FLUG, und es gibt
keine Deploy-Fenster-Regel. Billigste Entschaerfung: vor dem Deploy `list_calls` auf aktive Anrufe
pruefen - ein Read, keine Kosten.

#### N-3: `OPTIONS /mcp` kippt von 200 auf 403, undeklariert und ungetestet

Kette: heute gemessen `curl -X OPTIONS https://app.sundartha.com/mcp` -> **200** (Express'
Auto-OPTIONS aus den drei Routen `src/routes/mcp.js:51,128,129`) -> `router.use("/mcp", guard)`
sieht ALLE Methoden, und A1 uebernimmt die `SAFE_METHODS`-Ausnahme der Schwesterwache NICHT
(`src/middleware.js:53,96`) -> `OPTIONS` mit fremdem Origin antwortet 403. Bewertung:
**TEILWEISE.** Fail-closed ueber alle Methoden ist ausdruecklich gewollt (A2), und der Schaden ist
klein (ohne `Access-Control-*` scheitert jeder Preflight ohnehin). Aber es ist eine undeklarierte
Vertragsaenderung an einem live verbundenen Endpunkt: die Tabelle hat Zeilen fuer POST/GET/DELETE,
keine fuer OPTIONS, und `test/mcp-method-not-allowed.test.js:10` pinnt nur GET/DELETE.

#### N-4: A9 Schritt 2 "PUBLIC_URL erstmals ausdruecklich setzen" ist fuer Zweig A vermutlich ein No-op - und damit reiner PM-1-Einsatz ohne Gegenwert

Kette: A9 formuliert das Setzen als Pflichtschritt -> jemand tippt den Wert von Hand neu ->
PM-1 (gut geformter Tippfehler -> `voice_url` ins Leere -> Anruf ohne Offenlegung). Der Gegenwert
ist aber wahrscheinlich null: gemessen ist `publicUrl` live `https://app.sundartha.com`, waehrend
`RENDER_EXTERNAL_URL` die dienst-eigene Adresse traegt - das Repo trennt beide Begriffe selbst
(`src/elevenlabs/init-webhook-ziel.js:110` `serviceUrl` vs. `:137` `publicUrlEnv || serviceUrl`),
und `HERMES_GATEWAY_ORIGINS` (`:23`) fuehrt den onrender-Host als den ANDEREN Kandidaten. Daraus
folgt: `PUBLIC_URL` ist am Live-Dienst hoechstwahrscheinlich schon gesetzt und schon richtig.
Bewertung: **OFFEN, mit UNKNOWN.** Nicht beweisbar ohne einen Env-Read (in dieser Session kein
lesender Render-Zugang: es existiert nur `update_environment_variables`, kein Leser). Konsequenz
fuer das Spec: A9 Schritt 2 muss "pruefen, und nur bei Abweichung anfassen" heissen, nicht
"festschreiben".

#### N-5: die Wache ist fuer das Inventar-Gate unsichtbar -> ein spaeterer Refactor entfernt sie, kein Bestandstest merkt es

Kette: `collectRoutes` (`test/route-auth-inventory.test.js:126-140`) sammelt ausschliesslich
`layer.route`-Schichten -> ein `router.use("/mcp", guard)` erscheint in keinem `handlerNames` und
in keinem Fingerprint (`:172ff`) -> faellt der Mount weg, bleibt das Gate, das jede Route auf ihre
Absicherung festnagelt, gruen. Bewertung: **TEILWEISE.** A2 nennt die Unsichtbarkeit als bewussten
Preis, zieht aber keine Folge: `test/s2-mcp-origin.test.js` ist damit der EINZIGE Regressionsanker
der Aenderung. Das gehoert als Satz ins Spec (nicht loeschbar, nicht skip-bar), sonst ist die
Invariante wieder per Konvention gesichert (Lehre `clean-code-audit-2026-07`).

### Eigene Live-Reads (2026-09-18, read-only, keine Kosten)

| Read | Ergebnis |
|---|---|
| `GET /.well-known/oauth-protected-resource` (beide Hosts) | `{"resource":"https://app.sundartha.com/mcp","authorization_servers":["https://fearless-network-26.authkit.app"],"bearer_methods_supported":["header"]}` |
| `POST /mcp` ohne Origin, ohne Token | `401`, `www-authenticate: Bearer resource_metadata="https://app.sundartha.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="Kein Token"` |
| `POST /mcp` mit `Origin: https://evil.example` | **`401`** - Baseline heute, die A1/A2 auf `403` dreht |
| `OPTIONS /mcp` mit fremdem Origin | **`200`** (N-3) |
| `GET /mcp` | `405` (unveraendert) |

Damit unabhaengig belegt: `MCP_AUTH=oauth` live (nur `verifyOauth`->`deny401` setzt diesen Header,
`src/auth.js:66-73`; der Token-Zweig antwortet ohne Header, `:100-103`), `OAUTH_AUDIENCE` leer ODER
exakt `${publicUrl}/mcp` (`src/auth.js:22-23,123-128`) - **A6 kann beim ersten Deploy nicht fatal
werden**, A9 1b/1c ist damit kein Pflichtschritt. Der Dienst antwortet ueber Cloudflare
(`server: cloudflare`, `cf-ray`), CSP live `frame-ancestors 'none'` - dass Cloudflare den
`Origin`-Header unveraendert durchreicht, bleibt UNKNOWN und ist nur fuer PM-2/N-1 relevant.

### Mergefaehigkeit (Bestaetigung mit Einschraenkung)

A1-A8 sind in einer Phase mergefaehig - bestaetigt: keine Testdatei sendet einen Origin an `/mcp`
(`grep -rn "Origin:" test/*.test.js` trifft nur Self-Service/CSRF), `mcpPost`
(`test/helpers.js:1293-1304`) setzt keinen. Einschraenkung gegenueber dem ersten Durchgang: der
Zwischenzustand ist nicht im Repo, sondern im BETRIEB kaputt, wenn N-1 eintritt - ohne Schalter
(K-3) ist die mittlere Reparaturzeit ein Deploy, nicht ein Env-Flip.

### Nachzubessern im Spec

Die Punkte 1-12 des ersten Durchgangs bleiben gueltig; diese kommen hinzu.

13. **A5 gegen die `csrfEnforce`-Praezedenz entscheiden (K-3).** Entweder `MCP_ORIGIN_ENFORCE`
    mit Default `true` und der Bauform `enforce !== false` (`src/middleware.js:91-94`) aufnehmen -
    drei Zeilen, dieselbe Begruendung wie `src/config.js:1937-1943` -, oder die Praezedenz im Spec
    woertlich nennen und widerlegen. Ohne eine der beiden ist A5 eine Behauptung gegen den
    Bestand. Mit Schalter loesen sich N-1, N-2 und PM-2 auf einen Env-Flip auf.
14. **Restnutzen korrekt beziffern (K-1).** `MCP_AUTH=off` ist in Produktion Boot-Refusal
    (`src/config.js:2387,2396,2423-2428,2543`), nicht WARN. Die Abwaegung im Spec lautet damit:
    Nutzen = T-06-Konformitaet, Risiko = Connector-Tod ohne client-seitigen Reparaturweg (N-1).
    Diese zwei Saetze gehoeren unter "Beruehrte absolute Regeln" oder in die Abhaengigkeiten, weil
    sie eine Owner-Entscheidung tragen.
15. **N-1 in der Tabelle als Folge deklarieren:** die Zeile "fremder Origin, ohne Token -> 403
    (nicht 401)" um den Satz ergaenzen, dass damit auch die PRM-/Discovery-Antwort entfaellt und
    eine Neu-Autorisierung vom Client aus unmoeglich ist. Erwartungsergebnis bleibt `403`; was
    fehlt, ist die benannte Konsequenz.
16. **Deploy-Fenster festschreiben (N-2):** "Deploy nur, wenn kein Anruf laeuft (Read: `list_calls`
    bzw. `GET /api/calls`)" als Betriebsschritt in A9, mit dem Grund (Consult-Long-Poll,
    `src/mcp-tools.js:588-603`).
17. **OPTIONS deklarieren (N-3):** Tabellenzeile `OPTIONS /mcp` mit fremdem Origin -> `403`
    (heute gemessen `200`), ohne Origin -> unveraendert `200`. Zusaetzlich im Text festhalten, dass
    A1 die `SAFE_METHODS`-Ausnahme der Schwesterwache (`src/middleware.js:53,96`) bewusst NICHT
    uebernimmt.
18. **A9 Schritt 2 umformulieren (N-4):** "PUBLIC_URL lesen; nur bei Abweichung vom entschiedenen
    Wert setzen". Begruendung: gemessener Live-Wert `https://app.sundartha.com` + die Trennung
    `publicUrlEnv`/`serviceUrl` (`src/elevenlabs/init-webhook-ziel.js:110,137`) machen ein Setzen
    fuer Zweig A hoechstwahrscheinlich zum No-op, waehrend jedes Neutippen der Wert-Eingang von
    PM-1 ist. Dass `PUBLIC_URL` gesetzt ist, bleibt UNKNOWN (kein lesender Render-Env-Zugang).
19. **Regressionsanker benennen (N-5):** einen Satz, dass `test/s2-mcp-origin.test.js` der einzige
    Nachweis der Wache ist, weil `collectRoutes` (`test/route-auth-inventory.test.js:126-140`)
    `use`-Schichten nicht sieht - Datei nicht loeschbar, kein `--test-skip-pattern`, keine
    Katalog-ID am Namensanfang (sonst wandert sie in `test:gates` und `npm test` haelt sie nicht
    mehr fest).
20. **Zeilenangaben korrigieren:** `CONFIG_NAMESPACES.safety` = `src/config.js:2252` (K-2);
    PM-4s Beleg von `test/telephony-registry.test.js:120` auf
    `test/route-auth-inventory.test.js` (ruft `buildApp` ohne Boot-Riegel) umstellen (K-4);
    `auditAuthFailed` hat 4 Aufrufer an 5 Stellen (`src/web-auth.js:831,835,873`,
    `src/middleware.js:102`, `src/wiring/internal-only.js:26`) - A4 sagt "vier" und listet fuenf.
