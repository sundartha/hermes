# Phase 0 — Entscheidungen D0-1 bis D0-8 (OpenAI-Einreichung)

Stand: 2026-09-20. Grundlage: sechs lesende Messberichte der P0-Welle plus eigene
Gegenproben (unten je Punkt ausgewiesen). Phase 0 hat keinen Produktionscode und keine
Konfiguration angefasst.

**Belegregel dieses Dokuments:** jede Zeile traegt Datei:Zeile, einen Testnamen oder ein
ausgefuehrtes Kommando. Wo nur ein Indiz vorliegt, steht das Wort *indiziert* — das ist
ausdruecklich KEIN Beleg. Wo nichts vorliegt, steht UNKNOWN mit Grund.

**Namens-Abweichung zum Plan:** das Abnahmekriterium in `tasks/PLAN-OPENAI-TECHNIK.md`
(Abschnitt 1) nennt als Ablageort `tasks/openai-mess-0.md`. Die Ergebnisse liegen in DIESER
Datei. Wer das Abnahmekriterium prueft, liest hier.

---

## 1. Entscheidungstabelle

| # | Frage | Ergebnis | Beleg | Status | Betroffene Phasen |
|---|---|---|---|---|---|
| **D0-1** | UI ja / nein | **Ist-Zustand MIT UI.** `MCP_UI_ENABLED` hat Default `true` und ist der einzige Enable-Gate-Punkt, identisch fuer HTTP `/mcp` und stdio. `MCP_UI_ENABLED=false` bricht nichts: die gesamte Spawn-Suite faehrt schon heute mit `false`, und ohne Renderer liefert `enableWidgetUi()` ein leeres Objekt — kein `_meta`-Rest im Protokoll. P8 wird vorbereitet; **T-34 ist dabei NICHT additiv** (eigene Zeile unten). | `src/config.js:1638` (`fallback: true`); `src/routes/mcp.js:150`; `src/mcp-server.js:19,27`; `src/ui/registry.js:45` (`if (!hostHint?.enabled) return null;`); `src/mcp-tools.js:718-724` (`return {}`); `test/helpers.js:363` (`MCP_UI_ENABLED: "false"` im BASE_ENV); `grep -rln MCP_UI_ENABLED test/` = nur `test/helpers.js`. Eigene Gegenprobe: `sed -n '1636,1640p' src/config.js`, `sed -n '40,55p' src/ui/registry.js`, `sed -n '715,728p' src/mcp-tools.js` — deckungsgleich. | **ENTSCHIEDEN** (Ausgang A, Ist-Zustand). Das Umlegen des Schalters bleibt Owner-Sache (OWNER-Zeile O-1). | P8 |
| **D0-2** | search/fetch (Deep Research / Company Knowledge) ja / nein | **Nicht angestrebt.** Keine Produktabsicht im Repo, kein `search`-/`fetch`-Tool im Code. T-24/T-25 gegenstandslos. | `grep -rniE "deep research\|company knowledge"` ueber Produktcode/-doku = 0 Treffer (einziger Repo-Treffer `tasks/OPENAI-MCP-READINESS.md:463` ist selbst ein Anforderungs-Zitat, keine Absicht); `grep '"search"\|"fetch"' src/mcp-tools.js` = 0 Treffer. | **ENTSCHIEDEN** (Ausgang A) | keine (T-24/T-25 entfallen) |
| **D0-3** | Legacy-Token-Pfad abschalten ja / nein | **Produktion nutzt Legacy nicht** (frisch gemessen, nicht abgeschrieben): `POST /mcp` ohne Authorization liefert 401 **mit** `WWW-Authenticate` — diesen Header setzt ausschliesslich `deny401()` aus `verifyOauth()`; kein anderer Modus sendet ihn je. Der Pfad wird **gehaertet, nicht entfernt** (additive Boot-Sperre in Produktion ueber den bestehenden `PRODUCTION_FOOTGUNS`-Mechanismus). | **Frisch nachgemessen 2026-09-20T15:31:09Z** (die urspruengliche P0-Zeile fuehrte dasselbe Kommando ohne Zeitstempel und ohne Header-Mitschnitt - als *Beleg* war sie damit nicht nachpruefbar; s. NACHTRAG N-4): `curl -s -i -X POST https://app.sundartha.com/mcp -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` -> `HTTP/2 401`; `www-authenticate: Bearer resource_metadata="https://app.sundartha.com/.well-known/oauth-protected-resource", error="invalid_token", error_description="Kein Token"`; `date: Sun, 20 Sep 2026 15:31:09 GMT`; `rndr-id: e0b09e4e-c50b-43b9`; Body `{"error":"Kein Token"}`. Konsistenz-Indiz aus derselben Messung: `GET /.well-known/oauth-protected-resource` -> `{"resource":"https://app.sundartha.com/mcp","authorization_servers":["https://fearless-network-26.authkit.app"],"bearer_methods_supported":["header"]}` (**indiziert**, kein Ersatz: es belegt, dass `OAUTH_ISSUER_URL` gesetzt ist, nicht welchen Zweig `mcpAuth` nimmt). Code: `src/auth.js:66-71` (eigene Gegenprobe gelesen), `:73-90`, `:100-116` (Token-/Legacy-Zweige setzen nie `WWW-Authenticate`); `src/config.js:2416-2427` (`PRODUCTION_FOOTGUNS`, `off`-Zeile), `:2469-2470` (`if (!isProduction) return [];`); `src/auth.js:14-20` (`legacyLocalBypassAllowed`); `test/helpers.js:571` (`RENDER_EXTERNAL_URL: ""`). Gruen gefahren: `NODE_ENV=test node --test --test-concurrency=4 test/auth-mcp-bypass.test.js test/boot-prod-footguns.test.js test/config-prod-footguns.test.js` -> `tests 30 / pass 30 / fail 0`. | **ENTSCHIEDEN** (Ausgang A). Der DEPLOY der Haertung ist Owner-Sache (OWNER-Zeile O-2). | P6 |
| **D0-4** | CORS server- oder browserseitig | **UNKNOWN in der Sache — und genau deshalb entschieden: es wird keine Zeile CORS gebaut.** Ist-Zustand belegt: fremder Origin -> 403 `cross_origin_blocked`; **auch bei erlaubtem Origin (Status 200) setzt der Server nie `Access-Control-Allow-Origin`**. Es gibt keine Quelle, die sagt, ob OpenAIs `/mcp`-Client einen `Origin` sendet; die vorhandenen Indizien (T-3 IP-Allowlist, T-17 mTLS) sprechen fuer server-seitig, beweisen es aber nicht (*indiziert*). | Eigener Probe-Lauf (lokaler Server, `PORT=0`, sauber gestoppt): `POST /mcp` mit `Origin: https://agent.test` -> 200, Header-Liste ohne jedes `access-control-*`; mit `Origin: https://chatgpt.com` -> 403, Body `{"error":"cross_origin_blocked"}`. `node --test test/s2-mcp-origin.test.js` -> 41 pass / 0 fail. `src/middleware.js:203-217`; `grep -rn "access-control\|cors(" src/` = 0 Treffer; kein `cors`-Paket in `package.json`. Indizien: `tasks/openai-audit/00-openai-anforderungen.md:36` (T-3), `:50` (T-17). | **OWNER** (nur OW-4 entscheidet). Fail-closed-Default: heutige Strenge bleibt unveraendert. | P9 (bleibt ungebaut) |
| **D0-5** | SDK-Grenze fuer `securitySchemes` (T-15) | **Weg B: Low-Level-Override des ListTools-Handlers.** Weg A (SDK-Anhebung) ist tot: `securitySchemes` existiert weder im installierten SDK 1.29.0 noch irgendwo im `node_modules`-Baum noch in der neuesten Version 1.30.0. `registerTool()` destrukturiert eine feste Feldliste und verwirft alles andere **still**; der ListTools-Handler baut den Deskriptor erneut aus einer festen Feldliste. `_meta` ist echter Passthrough (offener `z.record`) und in Hermes bereits live bewiesen — deckt aber T-15 nicht, weil OpenAI das Feld auf Top-Level zeigt (*indiziert*, s. Absatz D0-5). | `package.json:49` (`^1.12.0`) vs. installiert `1.29.0` (eigene Gegenprobe: `node -p "require('./node_modules/@modelcontextprotocol/sdk/package.json').version"` -> `1.29.0`); `grep -rl "securitySchemes" node_modules/ \| wc -l` -> `0` (eigene Gegenprobe, identisch); `node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js:703` (Destructuring), `:67-96` (ListTools-Handler); `:703-704` + `dist/esm/types.js:1266 ff.` (`_meta` als `z.record(z.string(), z.unknown())`); Live-Beleg `_meta`-Passthrough in Hermes: `src/ui/contract.js:105`, `src/mcp-tools.js:724`; 1.30.0 lesend via `npm pack` (kein Install): `grep -rln securitySchemes package/` -> leer, `package/dist/esm/server/mcp.js:699/703/704` und `:71` identisch zu 1.29.0. | **ENTSCHIEDEN** (Ausgang B) | P3 (Weg fixiert), P2 (T-18/T-22, s. Absatz) |
| **D0-6** | Gibt es fuer T-14 einen Ausloesepfad? | **Nein, auf keinem der beiden Transportwege.** `mcpAuth` laeuft einmal pro HTTP-Request VOR dem Handler; Auth scheitert immer dort mit **401**, bevor ein Tool existiert (die `WWW-Authenticate`-Challenge traegt dabei nur der `oauth`-Zweig). Danach prueft kein Tool-Handler je ein Token. stdio hat gar keine Auth-Schicht, nutzt aber dieselben Handler. T-14 waere ein Feld, das kein Code je setzt = toter Code (CLAUDE.md, hart verboten). | `src/routes/mcp.js:112` (`router.post("/mcp", mcpAuth, ...)`); `src/auth.js:66-71`, `:73-90`; `grep -n "401\|403\|Unauthorized\|forbidden\|permission denied\|nicht erlaubt\|nicht berechtigt" src/mcp-tools.js` -> keine Treffer; `src/mcp-tools.js:84` (`errText`), `:733-750` (generischer catch), `src/i18n/mcp-texts.js:20-29` (genau 4 Fehlercodes, keiner auth-bezogen); `src/mcp-tools.js:73` (`err.httpStatus` gesetzt) **wird sehr wohl ausgelesen**, aber ausschliesslich auf Consult-Statuscodes (`:1070`, `:1072`) - nie auf 401/403; `src/auth.js:66-71` vs. `:103`/`:110`/`:114`; `src/mcp-server.js:1-30` (stdio ohne Auth-Import). | **ENTSCHIEDEN** (Ausgang B) -> T-14 **GEGENSTANDSLOS** | P7 (schrumpft) |
| **D0-7** | T-12 Scope: kommt ein Scope im Token an? | **Keine Scope-Pruefung bauen (Ausgang B).** Zwei Teilbefunde: (a) **belegt** — Hermes konsumiert nirgends einen `scope`/`scp`-Claim; (b) **belegt** — der Anbieter bewirbt nur generische Identitaets-Scopes. Ob ein tatsaechlich ausgestelltes Token ein `scope`-Feld traegt, bleibt **UNKNOWN (Anbieter/Owner)**. Stattdessen sind zwei Ersatzpruefungen bereits produktiv und fail-closed: Audience-Pruefung und Tenant-Bindung ueber `sub`. | `src/auth.js:74-92` (jwtVerify mit `issuer`+`audience`, `clockTolerance:30`), `:23` (`audience()`); `grep -rn "scope\|scp" src/auth.js` -> 0 Treffer; `grep -rn "req.auth.claims\|payload.scope\|payload.scp" src/` -> 0 Treffer; `src/routes/_tenant.js:148,156-163` (`resolveTenant(sub)`, `TENANT_REJECT` fail-closed). Anbieter, live 2026-09-20: `curl -sS https://fearless-network-26.authkit.app/.well-known/openid-configuration` und `.../oauth-authorization-server` -> beide HTTP 200, `scopes_supported: [email, offline_access, openid, profile]`. | **ENTSCHIEDEN** (Ausgang B). Scope-Achse selbst bleibt UNKNOWN (OWNER-Zeile O-3). | P7 (schrumpft) |
| **D0-8** | Deklariert OpenAIs realer Client `text/html+skybridge`? (U-7) | **UNKNOWN — kein Beleg in den massgeblichen Quellen.** Die Anforderungsliste kennt weder `skybridge` noch `mimeTypes` noch `io.modelcontextprotocol/ui`. Der String existiert nur in Hermes' eigenem Code; die Audit-Berichte beschreiben nur diesen Code und zitieren keine externe Quelle. Es ist eine eingebaute Annahme, keine belegte Anforderung. | `grep -in skybridge tasks/openai-audit/00-openai-anforderungen.md` = 0 Treffer; `grep -inE "mimeTypes\|io.modelcontextprotocol/ui" tasks/openai-audit/00-openai-anforderungen.md` = 0 Treffer; `src/ui/contract.js:48` (`CHATGPT_UI_MIME = "text/html+skybridge"`); `src/ui/registry.js:48` (einzige Bedingung fuer `chatgptRenderer`, eigene Gegenprobe gelesen); `tasks/openai-audit/01-protokoll-transport.md:186`, `tasks/openai-audit/17-resources-flaeche.md:21,56` (beschreiben nur den Code). | **OWNER** (nur OW-4 entscheidet) | P8 (ChatGPT-Adapter-Teil bleibt ungestartet) |

---

## 2. Je Entscheidungspunkt: was gemessen wurde, was herauskam, was sich am Plan aendert

### D0-1 — UI ja / nein

Gemessen wurde: Default und Reichweite des Schalters, das Verhalten bei `false`, die
Testabhaengigkeit, und ob die im Plan als "additiv" gefuehrten P8-Teilaufgaben das
tatsaechlich sind.

Herausgekommen: der Schalter ist genau ein Gate-Punkt fuer beide MCP-Einstiege; bei `false`
faellt der gesamte Rich-UI-Pfad weg, ohne `_meta`-Reste und ohne Testbruch. Drei der
P8-Teilaufgaben sind sauber additiv (T-30/T-31 betreffen nur `chatgpt.js`; `mcp-native` hat
sie ueber `uiSubmissionMeta()` bereits). **Zwei sind es nicht:**

1. **T-34 (Sprach-Suffix in der Resource-URI) ist NICHT additiv.** `uiResourceUri()` sitzt in
   der von BEIDEN Renderern geteilten Fabrik (`src/ui/contract.js:21`, genutzt in `:92`,
   `:96`, `:105`). Der im Plan als "eine Funktion plus ihre zwei Aufrufer" beschriebene
   Eingriff aendert die URI **auch fuer Claude**, obwohl der zu loesende Cache-Befund
   ausdruecklich ChatGPT-spezifisch zitiert ist
   (`tasks/openai-audit/00-openai-anforderungen.md:67`: *"ChatGPT may continue serving cached
   resource contents for up to one hour."*). Verschaerfend: der Code selbst haelt die
   Sprachfreiheit als bewusste Entscheidung fest — *"Die `ui://`-URI bleibt bewusst sprachfrei
   (ein live etablierter Wire-Bezeichner)"* (`src/ui/contract.js:93-95`, eigene Gegenprobe
   gelesen). Und es existiert eine konkrete Asymmetrie, die ein unsauberer Fix sofort
   auseinanderlaufen liesse: `registerResource()` bekommt `language` als Parameter,
   `toolMeta()` **nicht** — obwohl der einzige Aufrufer beides zur Hand haette
   (`src/mcp-tools.js:723-724`, eigene Gegenprobe gelesen). Laufen URI-Erzeugung in Resource
   und `_meta` auseinander, rendert **kein** Widget mehr, auch nicht bei Claude.
2. **T-23 + X-7 verlangen mehr als einen `_meta`-Schluessel pro Tool-Deskriptor.** Die Fabrik
   liefert strukturell genau einen (`src/ui/contract.js:105`:
   `toolMeta: (widgetId) => ({ [metaKey]: buildMeta(uiResourceUri(widgetId)) })`). Das ist
   kein Nachruesten, sondern eine Struktur-Entscheidung.

**Was sich am Plan aendert:** D0-1 bleibt bei Ausgang A (MIT UI, P8 wird vorbereitet), aber
die Pauschalaussage "P8 ist additiv" faellt. P8 bekommt zwei Bauvorgaben und ein Gate (s.
PLANAENDERUNGEN). Zusaetzlich ist die Plan-Formulierung *"es gibt keinen Code-Pfad, der
ChatGPT- von Claude-Clients trennt"* (Zeile 43) im Wortlaut falsch: `src/ui/registry.js:48`
waehlt sehr wohl je nach Client-Capability zwischen zwei Renderern. Gemeint war nur der
Enable-/Disable-Schalter — die Owner-Schlussfolgerung bleibt gleich, die Formulierung ist zu
korrigieren.

### D0-2 — search/fetch

Gemessen wurde: repo-weite Textsuche nach Produktabsicht und Code-Suche nach den beiden
Tool-Namen. Herausgekommen: 0 Treffer in beiden Richtungen.
**Was sich am Plan aendert: nichts.** T-24/T-25 bleiben wie vorgesehen gegenstandslos. Die
formelle Owner-Bestaetigung (OW-10) bleibt eine Hoeflichkeitszeile — Textabwesenheit im Repo
ist ein starkes Indiz, aber kein Beweis ueber eine Roadmap.

### D0-3 — Legacy-Token-Pfad

Gemessen wurde: der tatsaechliche Live-Auth-Modus (verhaltensbasiert, weil kein lesendes
Render-Tool die Env-Werte des Services liefert), die tatsaechliche Testabhaengigkeit, und ob
ein bestehender Mechanismus existiert, den Pfad nur in Produktion zu sperren.

Herausgekommen: Produktion laeuft im `oauth`-Zweig (belegt ueber den `WWW-Authenticate`-Header,
den nur `verifyOauth()`/`deny401()` je setzt — `src/auth.js:66-71`, gerufen aus `:78`/`:90`;
die uebrigen Zweige antworten mit nacktem 401 ohne Header, `:103`/`:110`/`:114`). Der `PRODUCTION_FOOTGUNS`-Mechanismus existiert
bereits und sperrt heute `mcpAuth === "off"` in Produktion — **aber nicht `""` (Legacy) und
nicht `"token"`**. Eine zusaetzliche Zeile in dieser Tabelle waere eine weitere geschlossene
Tuer ueber einen etablierten Mechanismus: kein Code-Entfernen, kein neuer Bypass, kein
abgeschalteter Schutz. Sie beruehrt keine Testdatei, weil `productionFootguns()` bei
`isProduction === false` immer `[]` liefert und keine der betroffenen Spawn-Tests
`RENDER_EXTERNAL_URL` setzt.

**Was sich am Plan aendert:** D0-3 bleibt bei "haerten statt entfernen", bekommt aber einen
konkreten, code-belegten Mechanismus statt einer Absichtserklaerung — und eine bisher nirgends
notierte Luecke (s. UEBERRASCHUNGEN U-1). Der Plan-Wert *"37 von 53 `/mcp`-Testdateien"* (Zeile
45) ist ueberzaehlt und wird auf **8 von 21** korrigiert (Widerspruch W-1 unten).

### D0-4 — CORS

Gemessen wurde: der Ist-Zustand am echten HTTP-Response (lokal, `PORT=0`), die Quellenlage zur
server-/browserseitigen Frage, und wer die entscheidende Messung fahren kann.

Herausgekommen: die Wache ist rein ablehnend und setzt **nie** einen CORS-Header, auch nicht
bei erlaubtem Origin — ein browserseitiger Aufrufer wuerde also selbst dann an der
Browser-eigenen CORS-Pruefung scheitern. Zur Kernfrage gibt es nur *indizierte* Evidenz.

**Was sich am Plan aendert: nichts.** Fail-closed: keine Zeile CORS, bis OW-4 vorliegt. P9
bleibt ungebaut. Die Mess-Anleitung steht in der OWNER-Liste.

### D0-5 — SDK-Grenze fuer `securitySchemes`

Gemessen wurde: deklarierte vs. installierte SDK-Version, repo-weites Vorkommen des Feldes,
der Destructuring-Punkt in `registerTool()`, die Feldliste des ListTools-Handlers, das
Passthrough-Verhalten von `_meta`, die neueste Version 1.30.0 (lesend per `npm pack`), und die
von OpenAI erwartete JSON-Position.

Herausgekommen: Weg A ist tot (1.30.0 ist im relevanten Code byte-identisch zu 1.29.0 — selbe
Zeilennummern, selber Inhalt, und `securitySchemes` kommt auch dort nicht vor). Weg B
(Low-Level-Override des ListTools-Handlers nach `registerTools()`) ist der einzige Weg.
`_meta` ist zwar echter Passthrough und in Hermes bereits live bewiesen, traegt T-15 aber
nicht: OpenAIs Doku zeigt `securitySchemes` als Top-Level-Geschwister von `inputSchema`. **Das
ist *indiziert*, nicht belegt** — die Quelle ist eine WebFetch-Zusammenfassung, kein selbst
gelesener Rohtext. Sie deckt sich mit dem Wortlaut in
`tasks/openai-audit/00-openai-anforderungen.md:48` ("security schemes set on their tool
metadata"), der den Pfad selbst offen laesst.

**Was sich am Plan aendert:** U-1 (JSON-Pfad) faellt von UNKNOWN auf *indiziert Top-Level*; U-2
(kennt 1.30.0 das Feld?) ist mit **nein** geschlossen. P3 legt den Override direkt auf
Top-Level aus und liest vor dem Bauen einmal den Rohtext der OpenAI-Seite gegen — als
Bestaetigung, nicht als offene Frage. Zusatzbefund mit Planwirkung ausserhalb von D0-5:
**T-18 hat gar kein SDK-Problem** — `title` wird bereits nativ als Top-Level-Feld
destrukturiert und ausgeliefert (`mcp.js:703` bzw. `:71`); das ist ein reines
Nutzungsdefizit in Hermes und gehoert unveraendert zu P2. **T-22 ist ueber den bewiesenen
`_meta`-Weg ohne SDK-Upgrade baubar.**

### D0-6 — Ausloesepfad fuer T-14

Gemessen wurde: wo `mcpAuth` sitzt, ob der 401 vor dem Tool-Aufruf faellt, ob irgendein
Tool-Handler eine Berechtigung prueft, wie der einzige Fehler-Ergebnis-Pfad aussieht, und ob
das Ganze auch fuer stdio gilt.

Herausgekommen: nein, auf keinem der beiden Pfade. Auth scheitert immer auf Transport-Ebene mit
**401**; danach existiert keine Stelle, die einen Auth-Fehler als Tool-Ergebnis erzeugen
koennte. Zwei Praezisierungen gegenueber der ersten Fassung dieses Absatzes, beide am Code
nachgeprueft:

1. **Der 401 faellt immer, die Challenge nicht.** Den `WWW-Authenticate`-Header setzt
   ausschliesslich `deny401()` (`src/auth.js:66-71`), und `deny401()` wird nur aus
   `verifyOauth()` gerufen (`:78`, `:90`). Der `token`-Zweig und der Legacy-Zweig antworten
   mit einem **nackten 401 ohne diesen Header** (`src/auth.js:103`, `:110`, `:114`; am
   laufenden Live-System gemessen: im `oauth`-Zweig ist der Header da, s. D0-3). Fuer T-14
   selbst ist das folgenlos — der 401 faellt in jedem Modus VOR dem Tool. Fuer **P7 ist es
   wesentlich**: der Satz *"der Transport-Pfad deckt die Anforderung materiell ab"* gilt nur,
   solange Produktion im `oauth`-Zweig laeuft. Faellt sie auf `""`/`token` zurueck, faellt die
   Challenge weg (das ist exakt der T-13-Verstoss aus U-1). P7 fuehrt den Satz deshalb mit
   dieser Bedingung, nicht pauschal.
2. **`err.httpStatus` ist kein toter Aufhaengepunkt.** Die erste Fassung behauptete, das Feld
   werde repo-weit nirgends ausgelesen. **Das ist falsch:** es wird produktiv gelesen
   (`src/mcp-tools.js:1070`, `:1072`), und der Kommentar an der Setzstelle (`:70-72`) sieht
   genau dieses Auslesen vor. Das Ergebnis von D0-6 aendert sich dadurch **nicht**, aber die
   Begruendung: die beiden Leser vergleichen gegen `CONSULT_ANSWER_REJECTED_STATUS` und
   `CONSULT_ANSWER_CONFLICT_STATUS`, also gegen Consult-Statuscodes — **kein Auth-Status**. In
   `src/mcp-tools.js` existiert ueberhaupt kein Auth-Fehlerzweig
   (`grep -nE "401|403|Unauthorized" src/mcp-tools.js` -> keine Ausgabe, eigene Gegenprobe),
   und `src/i18n/mcp-texts.js:20-29` kennt genau vier Fehlercodes, keinen auth-bezogenen. Ein
   401 vom internen REST-Hop waere strukturell ein interner Bug, kein Fall, den eine Re-Auth
   loest.

**Was sich am Plan aendert:** T-14 wandert endgueltig nach "wird nicht gebaut". P7 schrumpft.
Die im Plan als Option B beschriebene Dokumentationspflicht bleibt: P7 belegt, dass der
Transport-Pfad die Anforderung materiell abdeckt, und haelt das als bewusste Abweichung fest.
Die Plan-Regel "doppelte Pfade muessen beide erfuellt sein" ist hier trivial erfuellt — auf
keinem existiert ein Ausloeser.

### D0-7 — Scope (T-12), mit T-9 / T-11 / T-16

Gemessen wurde: was `verifyOauth()` tatsaechlich prueft, ob irgendwo ein Scope-Claim gelesen
wird, was der Anbieter bewirbt, und wo die drei geforderten AS-Metadata-Felder liegen.

Herausgekommen: (a) geprueft werden Signatur (JWKS), `iss`, `aud`, `exp`/`nbf`; ein Scope wird
nirgends gelesen. (b) Der Anbieter bewirbt nur generische Identitaets-Scopes. (c) **Zwei
Ersatzpruefungen sind bereits produktiv und fail-closed** — die Audience-Pruefung und die
Tenant-Bindung ueber `sub` mit `TENANT_REJECT`. (d) **Alle drei geforderten Metadata-Felder
fehlen nicht nur bei uns, sondern auch beim Anbieter**: `resource_indicators_supported`,
`authorization_response_iss_parameter_supported` und `claims_supported` sind in beiden
Well-known-Dokumenten des Issuers abwesend (HTTP 200, Felder nicht vorhanden). Unsere eigene
Route (`src/auth.js:121-129`) liefert ausschliesslich RFC-9728-Felder (`resource`,
`authorization_servers`, `bearer_methods_supported`). (e) Der UserInfo-Teil von T-16 ist
**UNKNOWN**: ohne gueltiges Token nicht messbar; ein unauthentifizierter GET liefert
erwartungsgemaess 401 `{"error":"unauthorized"}` — fail-closed, aber ohne Aussage ueber
`email_verified`.

**Was sich am Plan aendert:** T-12 wird nicht gebaut und im Report als *durch Audience- und
Tenant-Bindung teilweise erfuellt, Scope-Achse UNKNOWN (Anbieter)* gefuehrt. **T-9, T-11 und
T-16 (Metadata-Teil) werden aus P7 als Bauaufgaben herausgenommen und gemeinsam als
Anbieter-Luecke dokumentiert** — sie sind fuer uns nicht baubar, weil es AS-Metadata-Felder
sind. T-9 verschiebt sich dabei zusaetzlich von "Bauaufgabe" nach "Beleg-Sammlung": die
Audience-Pruefung existiert produktiv und getestet; unbelegt ist nur, ob WorkOS den
`resource`-Parameter 1:1 in `aud` kopiert (Anbieterverhalten, nur am echten Token pruefbar).
P7 schrumpft damit auf: Dokumentation, Beleg-Sammlung und die Abweichungs-Eintraege.

### D0-8 — `text/html+skybridge`

Gemessen wurde: ob die massgebliche Anforderungsliste den mimeType oder die UI-Capability
ueberhaupt kennt, und woher der String im Repo stammt.

Herausgekommen: die Liste kennt beides nicht; der String stammt aus Hermes' eigenem Code, und
die Audit-Berichte beschreiben nur diesen Code. Es gibt keinen Beleg, dass der reale
ChatGPT-Client die Capability so deklariert — und sie ist die **einzige** Bedingung, unter der
`chatgptRenderer` je gewaehlt wird.

**Was sich am Plan aendert: nichts.** D0-8 bleibt Owner-Messung (OW-4); der ChatGPT-Adapter-Teil
von P8 bleibt ungestartet. Neu ist die Trennschaerfe: **T-34 am mcp-nativen Pfad haengt NICHT
an D0-8** und ist unabhaengig davon zu entscheiden (s. PLANAENDERUNGEN P8).

---

## 3. PLANAENDERUNGEN

Das ist der Abschnitt, den die naechsten Phasen lesen.

### Entfaellt

| Was | Grund | Beleg |
|---|---|---|
| **T-14** (`_meta["mcp/www_authenticate"]`) | Kein Ausloesepfad auf beiden Transportwegen; ein Feld, das kein Code je setzt, ist toter Code (CLAUDE.md) | D0-6 |
| **T-12** (Scope-Pruefung) | Pruefung gegen einen Claim, den niemand ausstellt: wirkungslos oder Totalausfall | D0-7 |
| **T-24 / T-25** (search/fetch) | Deep Research nicht angestrebt | D0-2 |
| **Weg A in P3** (SDK-Anhebung) | 1.30.0 kennt `securitySchemes` nicht; im relevanten Code identisch zu 1.29.0 | D0-5 |
| **T-9 / T-11 / T-16 (Metadata-Teil)** als *Bauaufgaben* | AS-Metadata-Felder, die nur der Anbieter ausliefern koennte; fehlen dort nachweislich | D0-7 |

### Schrumpft

- **P7 (Auth II)** verliert T-14 und T-12 vollstaendig und T-9/T-11/T-16 als Bauaufgaben. Es
  bleibt: die Abweichungen belegt dokumentieren (Transport-Pfad deckt T-14 ab;
  Audience+Tenant-Bindung decken T-12 teilweise ab; drei Metadata-Felder als Anbieter-Luecke)
  und T-9 als Beleg-Sammlung statt Code. **P7 ist danach eine Dokumentationsphase, keine
  Auth-Umbauphase** — das senkt ihr Risiko von "hoch (Auth)" auf niedrig, solange kein Code
  in `src/auth.js` faellt.
- **P6 (Auth I)** muss die 8 betroffenen Testdateien **nicht** anfassen: die Haertung laeuft
  ueber `PRODUCTION_FOOTGUNS` und greift nur bei `isProduction === true`, was in keinem
  Spawn-Test gesetzt ist.

### Waechst / bekommt Bauvorgaben

- **P3** baut Weg B (Low-Level-Override des ListTools-Handlers nach `registerTools()`),
  Platzierung **Top-Level** (indiziert). Neue Pflichtvorgabe: der Abnahmetest prueft den
  tatsaechlichen `tools/list`-Output, **nicht** nur dass `registerTool()` nicht wirft — denn
  unbekannte Config-Felder verschwinden dort still und ohne Log.
- **P8** bekommt zwei ausdrueckliche Bauvorgaben statt der Pauschale "additiv":
  1. **T-23 + X-7:** mehrere `_meta`-Schluessel am selben Deskriptor. Erweiterung **nur im
     ChatGPT-Adapter**, nicht in der geteilten Fabriksignatur, wo technisch moeglich.
  2. **T-34:** Entscheidung zwischen (a) Sprach-Suffix nur im ChatGPT-Renderer — Claude-URI
     unveraendert, mehr Code, wirklich additiv — und (b) geteilter Weg mit bewusst
     dokumentierter URI-Aenderung fuer Claude. Diese Entscheidung wird **nicht stillschweigend
     in der Implementierung getroffen** (OWNER-Zeile O-4).
  Abnahmekriterium: beide Adapter in **einem** Testlauf — das ist hier keine Formalitaet,
  sondern die einzige Absicherung gegen das "kein Widget rendert mehr"-Szenario.

### Neue Vorbedingungen / Gates

| Phase | Gate | Zustand |
|---|---|---|
| P9 (CORS) | OW-4 (Origin-Header-Messung) | **ungebaut**, fail-closed; keine Zeile CORS |
| P8, ChatGPT-Adapter-Teil (T-30/T-31/T-23/X-7/X-3) | OW-4 (`mimeTypes`-Ablesung, D0-8) | **ungestartet** |
| P8, T-34 | Owner-Designentscheidung O-4 (Live-Wirkung auf bestehende Claude-Widgets) | **gegated, nicht additiv** |
| P6, Deploy der Legacy-Haertung | Owner-Freigabe O-2 | Bauen und Testen ja, Deploy nein |
| P3, Top-Level-Platzierung | Rohtext-Gegenlesung der OpenAI-Auth-Seite | Bestaetigung, kein Blocker |

### Text-Korrekturen im Plan (kein Inhalt, aber sonst fuehrt es die naechste Phase in die Irre)

| Planstelle | Steht dort | Richtig |
|---|---|---|
| Zeile 43 (D0-1) | "es gibt keinen Code-Pfad, der ChatGPT- von Claude-Clients trennt" | Gilt nur fuer den Enable-Schalter; `src/ui/registry.js:48` waehlt sehr wohl per Capability zwischen zwei Renderern |
| Zeile 45 (D0-3) | "37 von 53 `/mcp`-Testdateien" | **8 von 21** echten `/mcp`-HTTP-Aufrufern brauchen den Bypass als Erreichbarkeits-Bequemlichkeit |
| Zeile 47 (D0-5) | "oder Ablage unter `_meta`" als gleichwertige Variante | `_meta` traegt T-15 nicht (Top-Level gefordert, indiziert); `_meta` bleibt der Weg fuer **T-22** |
| Abnahmekriterium Phase 0 | `tasks/openai-mess-0.md` | `tasks/openai-p0-entscheidungen.md` (diese Datei) |
| P8-Zusammenfassung | "P8 ist additiv" | Gilt fuer T-30/T-31; **nicht** fuer T-34 und nicht fuer T-23/X-7 |

### Baseline fuer alle folgenden Phasen (gemessen, nicht geschaetzt)

- **Testkommando:** nur `npm test -- -- --test-concurrency=4` reicht das Flag durch (doppeltes
  `--`). Einfaches `--` verwirft es still; npm konsumiert seinen eigenen Trenner und reicht
  kein literales `--` weiter, weshalb `extraArgsFrom()` (`test/i18n-catalog-run.mjs:103-106`)
  keinen Trenner findet und `[]` liefert. Belegt am echten Lauf: `ps aux` zeigte die
  Kindprozesse mit `--test-concurrency=4`.
- **Suite-Stand:** roh `tests 6173 / pass 6172 / fail 1`, korrigiert (Datei-Wrapper abgezogen)
  **`tests 6153 / pass 6152 / fail 1`**, ~7,1 Minuten.
- **Der eine rote Test war ein Flake, nicht ein Defekt.** `test/sec-p4-mandanten-token.test.js`
  scheiterte im vollen Lauf mit `SyntaxError: Unexpected token W, "WebSockets"... is not valid
  JSON` (Antwort kam nicht vom erwarteten Handler). **Eigene Gegenprobe in dieser Phase,
  isoliert gefahren:** `NODE_ENV=test node --test test/sec-p4-mandanten-token.test.js` ->
  `tests 18 / pass 18 / fail 0`. Damit gilt die Lehre "rot zaehlt nur, wenn isoliert rot":
  **die Regressionsbank ist effektiv gruen.** Folgephasen kalibrieren auf 6153/6152 gruen.
- **Tool-Flaeche: eine Staffelung, keine einzelne Zahl.** Im Code stehen **12
  Registrierungen** (`src/mcp-tools.js`, 12x `uiTool(`/`tool(`), davon **3 bedingt**:
  `get_calendar` an `profile.allowCalendar` (`src/mcp-tools.js:1295-1296`),
  `await_call_event` + `answer_consult` an `consultAllowedFor(profile)`
  (`src/mcp-tools.js:968-969`, `:1003-1004`, `src/consult/gate.js:19-25`); verdrahtet in
  `src/routes/mcp.js:137,154-155`. Daraus ergibt sich:

  | Fall | Tools | Beleg |
  |---|---|---|
  | `DEFAULT_PROFILE` (authentifiziert, ohne Profil) | **9** | `src/store/defaults.js:1069-1078` (`allowCalendar:false`, `allowConsult:false`) |
  | `OWNER_PROFILE` **und alle Master-Schalter an** | **12** | `src/store/defaults.js:1056-1065` (`allowCalendar:true`, `allowConsult:true`) |
  | Jeder **zahlende** Plan (starter/business) | **hoechstens 11** | `PAID_PLAN_PROFILE.allowCalendar:false` (`src/plans.js:107-111`), beide Slugs darauf gepinnt (`:147-148`). **12 ist fuer einen zahlenden Tarif nicht erreichbar.** |
  | **Produktion heute** (`CONSULT_ENABLED=false`) | **10** Owner / **9** alle uebrigen | `render.yaml:424-425`, Code-Default `false` (`src/config.js:1663`). `consultAllowedFor()` ist eine Schnittmenge (`src/consult/gate.js:19-25`) — Master-Schalter aus = die beiden Consult-Werkzeuge werden gar nicht erst registriert, kein Tenant-Flag ueberstimmt das. Der Live-Wert ist Dashboard-gepflegt und aus dem Repo nicht lesbar (O-6): `render.yaml` + Code-Default sind hier **indiziert**, die Rechnung "Master aus -> 10/9" dagegen belegt. |
  | stdio-Transport | **10** | `registerTools()`-Defaults `allowCalendar = true`, `consultAllowed = false` (`src/mcp-tools.js:657-666`), Aufruf ohne beide Felder (`src/mcp-server.js:26-28`) |

  **Die fruehere Zeile hier ("Reviewer-Account 9, Owner/Subscriber 12", Beleg
  `defaults.js:1055-1064` vs. `:1067-1077`) war an drei Stellen falsch:** die Zeilennummern
  waren verschoben (richtig `:1056-1065` / `:1069-1078`); der zitierte Beleg deckte nur
  OWNER gegen DEFAULT ab und trug das Wort "Subscriber" gar nicht; und fuer einen Subscriber
  ist die Aussage **sachlich falsch** (Zeile 3 der Tabelle: hoechstens 11). Die heutige
  Produktionskonfiguration (Zeile 4) fehlte ganz. Relevant fuer P1/P10 — dort haette die
  Zahl falsch weitergewirkt. Folge fuer O-9/OW-9: s. NACHTRAG N-1.
- Die in `CLAUDE.md` genannte Zahl (2930 + 114 = 3044) ist veraltet. Nicht Teil dieser Phase,
  aber bei Gelegenheit nachzuziehen.

### Widersprueche zwischen Messberichten und Plan — ausdruecklich benannt

| # | Widerspruch | Wer gewinnt und warum |
|---|---|---|
| W-1 | Plan: "37 von 53 Testdateien"; Messung: "8 von 21" | **Messung.** Sie nennt die engere Suche (`grep -rlE '/mcp`\|"/mcp"\|'/mcp''`) und hat in 6 der 8 Dateien hineingesehen; der Plan-Wert stammt aus einer Suche, die jede Datei mit der Zeichenkette `/mcp` matched, auch Imports und Kommentare. |
| W-2 | Plan/Kickoff: T-34 ist "ein kleiner Eingriff, additiv"; Messung: nicht additiv | **Messung.** Sie nennt die geteilte Fabrik mit Datei:Zeile (`src/ui/contract.js:21/92/96/105`) und die `language`-Asymmetrie (`src/mcp-tools.js:723-724`); eigene Gegenprobe bestaetigt beides, inklusive des Code-Kommentars, der die Sprachfreiheit als bewusste Entscheidung festhaelt. |
| W-3 | Kickoff/Memory als Tatsache: "npm test Exit-Code luegt"; Messung: Exit 1 bei `# fail 1`, korrekt | **Keine Entscheidung noetig, beide koennen stimmen.** Die aeltere Beobachtung ist nicht widerlegt, nur nicht reproduziert. Die Vorsichtsregel *zaehle `# pass`/`# fail`, nie den Exit-Code* bleibt Praxis; die Formulierung "der Exit-Code luegt" als Naturgesetz ist nach dieser Messung zu stark. |
| W-4 | Plan beschreibt den Verwerfungsmechanismus von `npm test -- --test-concurrency=4` so, als verwerfe `extraArgsFrom` ein vorhandenes `--` | **Messung.** Ergebnis identisch (Flag verworfen), Begruendung im Plan ungenau: npm reicht bei einfachem `--` gar kein literales `--` durch. Nur Textkorrektur. |
| W-5 | `tasks/openai-audit/00-mcp-spec.md` widerspricht bei `destructiveHint` | **Nicht massgeblich** (andere Norm, laut Auftrag). Massgeblich ist `00-openai-anforderungen.md`. Hier nur vermerkt, damit P1 nicht darueber stolpert. |

---

## 4. OWNER

Nichts davon blockiert die Kette. Jede Zeile nennt die Folge, wenn sie nicht geliefert wird.

| # | Was nur der Owner kann | Folge fuer den Plan ohne Lieferung |
|---|---|---|
| **O-1** | **Produktentscheidung D0-1: UI MIT oder OHNE.** Ausschalten nimmt heutigen Claude-Nutzern die Live-Karte — Nutzenfolge, keine Einstellung. | Keine. Ist-Zustand MIT UI bleibt, P8 wird vorbereitet, der Schalter wird nicht angefasst. |
| **O-2** | **Freigabe fuer den DEPLOY jeder Aenderung an der `mcpAuth`-Verzweigung** (Legacy-Haertung). Es gibt keinen Flag-Zwischenschritt: die Aenderung wird mit dem naechsten Deploy scharf. | P6 baut und testet, deployt nicht. Die Haertung liegt gruen im Repo und wartet. |
| **O-3** | **Ein echtes Access-Token aus einem abgeschlossenen WorkOS-Login dekodieren** (traegt es `scope`/`scp`?) **und mit demselben Token den UserInfo-Endpunkt abrufen** (liefert er `email` UND `email_verified: true`? = T-16). Kein Agent darf einen Login fahren. | Keine. D0-7 bleibt bei Ausgang B (keine Scope-Pruefung), T-16-UserInfo bleibt UNKNOWN mit Grund im Report. |
| **O-4** | **Designentscheidung T-34:** Sprach-Suffix nur im ChatGPT-Renderer (wirklich additiv) **oder** geteilter Weg mit dokumentierter URI-Aenderung fuer Claude. Live-Wirkung auf bestehende Widgets. | P8 startet den T-34-Teil nicht. Die uebrigen P8-Teile bleiben davon unberuehrt. |
| **O-5 (= OW-4)** | **Die eine Messung fuer D0-4 UND D0-8:** `https://app.sundartha.com/mcp` als Developer-Mode-Connector in ein echtes ChatGPT-Konto haengen und am selben Mitschnitt drei Dinge ablesen: (1) traegt der Request einen `Origin`-Header und welchen, (2) von welcher IP kommt er, (3) was steht im `initialize`-Request unter `params.capabilities.extensions["io.modelcontextprotocol/ui"].mimeTypes`. | Keine. P9 bleibt ungebaut (fail-closed, heutige Strenge bleibt), der ChatGPT-Adapter-Teil von P8 bleibt ungestartet. Beides ist im Plan als abschaltbar vorgesehen. |
| **O-6** | **Render-Dashboard nachsehen** (aus dem Repo nicht lesbar, und das einzige verfuegbare Render-Tool fuer Env-Vars schreibt — P0 ist lesend): traegt `MCP_AUTH_TOKEN` aktuell einen Wert? Steht `MCP_UI_ENABLED` abweichend vom Code-Default? Ist `CONSULT_ENABLED` wie in `render.yaml:424` auf `false`? | Keine. `MCP_AUTH_TOKEN` betrifft nur die Groesse des Risikos aus U-1, nicht dessen Existenz; `MCP_UI_ENABLED` und `CONSULT_ENABLED` betreffen nur die Groesse der Tool-Varianz, nicht die Entscheidung. |
| **O-7** | **Entscheidung, ob die `PRODUCTION_FOOTGUNS`-Luecke (U-1) in dieser Kette geschlossen** oder bewusst als Risiko in `PLAN-SECURITY.md` aufgenommen wird. Sicherheitsentscheidung nach der Pre-Mortem-Pflicht. | Keine fuer die Kette. Bleibt sie offen, wird sie als Risiko in `PLAN-SECURITY.md` eingetragen — nicht verschwiegen. |
| **O-8 (= OW-10)** | **Formelle Bestaetigung, dass Deep Research / Company Knowledge nicht auf der Roadmap steht.** | Keine. D0-2 bleibt bei Ausgang A; 0 Repo-Treffer sind ein starkes Indiz. |
| **O-9** | **Token fuer `/.well-known/openai-apps-challenge`** eintragen (Route existiert und ist gruen getestet, nur der Wert fehlt). | Betrifft die Einreichung, nicht die Bauphasen. |

---

## 5. UEBERRASCHUNGEN

Was die Messer gefunden haben, wonach niemand gefragt hat.

**U-1 — Die `PRODUCTION_FOOTGUNS`-Tabelle hat ein Loch, das genau den Fall nicht deckt, um den
es hier geht.** Der Boot-Guard blockt `mcpAuth === "off"` in Produktion (gruen getestet), aber
**nicht `""` (Legacy) und nicht `"token"`** (`src/config.js:2416-2427`). Faellt `MCP_AUTH` im
Dashboard je auf `""` zurueck — etwa durch einen Blueprint-Resync, der `render.yaml:353`
(`value: ""`) uebernimmt — und existiert ein `MCP_AUTH_TOKEN` (`render.yaml:357`:
`generateValue: true`, aktueller Wert UNKNOWN), faellt Produktion **still** auf den statischen
Bearer-Token-Pfad zurueck: 401 **ohne** `WWW-Authenticate` (T-13-Verstoss) und ein
Auth-Mechanismus, der kein OAuth 2.1 ist (T-5-Verstoss) — ohne dass ein Test oder ein Boot-Guard
das faengt. Das ist der eigentliche, konkrete Grund, warum die Haertung mehr als Kosmetik ist,
obwohl Produktion heute schon auf `oauth` laeuft. Im Plan und im Kickoff nirgends erwaehnt.

**U-2 — `registerTool()` verwirft unbekannte Config-Felder still.** Kein Fehler, kein Log
(`mcp.js:703`). Wer in P3 naiv `config.securitySchemes` anhaengt, sieht **kein** Symptom — das
Feld verschwindet klaglos. Ein Test faengt das nur, wenn er den echten `tools/list`-Output
prueft.

**U-3 — `_meta`-Passthrough ist in Hermes kein SDK-Detail, sondern live bewiesen.** Das
Widget-Feature liefert ueber genau diesen Mechanismus bereits produktiv Namespaced-Keys unter
`_meta` aus (`src/ui/contract.js:105`, `src/mcp-tools.js:724`). Das ist der staerkste
verfuegbare Beleg dafuer, dass T-22 ohne SDK-Upgrade baubar ist — staerker als jede statische
SDK-Lektuere, weil es in diesem Server laeuft.

**U-4 — T-18 hat gar kein SDK-Problem.** `title` wird bereits nativ als Top-Level-Feld
destrukturiert und ausgeliefert (`mcp.js:703`, `:71`). Das im Kickoff notierte Problem ("heute
nur `annotations.title`") ist ein reines Hermes-Nutzungsdefizit. Gehoert zu P2, nicht zu P3.

**U-5 — Es gibt kein `CHANGELOG.md` in den SDK-Tarballs.** Weder in 1.29.0 noch in 1.30.0. Die
im Auftrag vorgesehene "Changelog im Paket lesen"-Pruefung geht technisch ins Leere — die Datei
existiert dort schlicht nicht (nicht: uebersehen).

**U-6 — Die `ui://`-Sprachfreiheit ist eine dokumentierte Entscheidung, kein Versehen.** Der
Code haelt sie ausdruecklich fest: *"Die `ui://`-URI bleibt bewusst sprachfrei (ein live
etablierter Wire-Bezeichner)"* (`src/ui/contract.js:93-95`). T-34 kippt also eine bewusst
getroffene Entscheidung um, nicht eine Nachlaessigkeit — das gehoert in die Begruendung von O-4.

**U-7 — Es gibt keinen Integrationstest fuer die Verdrahtung `MCP_UI_ENABLED` (Env) ->
`config.tenancy.mcpUiEnabled` -> `uiHost.enabled` ueber einen echten HTTP-Request.**
`test/mcp-ui.test.js` konstruiert `uiHost: {enabled: true}` direkt und geht am Env-Pfad vorbei.
Kein Blocker, aber eine Abdeckungsluecke an einem Schalter, den der Owner umlegen koennte.

**U-8 — Ein Testname luegt ueber den geprueften Modus.**
`test/auth-p3-bootstrap-fallback.test.js:280` traegt "(MCP_AUTH=off)" im Namen, setzt das Flag
aber nicht — der Test laeuft im Legacy-Default. Sachlich folgenlos (das Ergebnis ist fuer beide
Modi gleich), aber ein Beleg dafuer, dass Testnamen in dieser Suite kein Beweis fuer den
geprueften Modus sind.

**U-9 — `src/mcp-tools.js` kennt ueberhaupt keinen Auth-Fehlerzweig.**
`grep -nE "401|403|Unauthorized" src/mcp-tools.js` liefert **keine Ausgabe**, und
`src/i18n/mcp-texts.js:20-29` kennt genau vier Fehlercodes, keinen auth-bezogenen. Ein
Auth-Fehler kann in diesem Modul also nicht einmal formuliert werden — das ist die eigentliche
Ueberraschung, und sie traegt D0-6 staerker als jedes Argument ueber ein einzelnes Feld.
*Korrektur der ersten Fassung dieser Zeile:* dort stand, `err.httpStatus`
(`src/mcp-tools.js:73`) werde "repo-weit nirgends ausgelesen" und sei "heute ohne jede
Bedeutung". **Das war falsch** — das Feld wird produktiv gelesen (`:1070`, `:1072`), und der
Kommentar an der Setzstelle (`:70-72`) sieht das ausdruecklich vor. Es ist damit **kein**
freier Aufhaengepunkt fuer einen Auth-Ausloeser, sondern ein belegtes Feld mit genau einem
Zweck: `answer_consult` unterscheidet damit "verworfen" (400) von "nicht mehr offen" (409),
ohne den Fehlertext zu parsen.

**U-10 — Parallele P0-Messer teilten sich ein Scratchpad-Verzeichnis.** Ein Messer sah einen
fremden `npm test`-Hintergrundlauf in sein eigenes Scratchpad schreiben, obwohl er das Kommando
nie ausgefuehrt hatte. Echtes Kollisionsrisiko fuer kuenftige parallele Wellen. Ausserdem lief
ein Server `node src/server.js` (PID 7382, Port 3999, gestartet 17:19) schon **vor** der Welle
und gehoerte keinem Messer. **Stand am Ende dieser Phase:** dieser eine Prozess laeuft noch
(`ps aux` gegengeprueft), sonst keine verwaisten Testserver; der isolierte Testlauf dieser
Phase hat nichts zurueckgelassen.

---

## 6. NACHTRAG — Korrekturlauf 2026-09-20

Vier Stellen fuehrten einen Beleg, den es so nicht gab. **Kein Status hat sich gedreht:** D0-1
bis D0-8 stehen unveraendert, T-14 bleibt gegenstandslos, D0-3 bleibt bei "haerten statt
entfernen". Korrigiert wurden Begruendungen, Zeilenverweise und eine Baseline-Zahl. Was unten
einen Statuswechsel *ausloesen koennte*, steht hier ausdruecklich und wurde **nicht** still
gedreht.

**N-1 — O-9 / OW-9 (Reviewer-Demo-Account) verlangt mehr als bisher notiert. Kein
Statuswechsel, aber eine Verschaerfung der Owner-Aufgabe.** Die bisherige Formulierung
("Demo-Account mit vollem Flag-Satz provisionieren, `allowConsult=true`, `allowCalendar=true`")
ist so nicht ausfuehrbar:

- Ein Demo-Account auf einem **bezahlten** Plan bekommt bei der Aktivierung
  `PAID_PLAN_PROFILE` mit `allowCalendar: false` (`src/plans.js:107-111`, `:147-148`) — er
  sieht `get_calendar` nie, egal was vorher im Profil stand.
- `allowConsult` allein genuegt ebenfalls nicht: `consultAllowedFor()` ist eine Schnittmenge aus
  `CONSULT_ENABLED` x `ASSISTANT_CONTEXT_ENABLED` x `profile.allowConsult`
  (`src/consult/gate.js:19-25`). Steht `CONSULT_ENABLED` in Produktion auf `false`
  (`render.yaml:424-425`, Code-Default `false`, `src/config.js:1663`), ist kein Tenant-Flag
  wirksam.

Der Reviewer saehe damit heute **10** Tools (Owner-Tenant) bzw. **9** (jeder andere), nicht 12.
Ob das fuer die Einreichung genuegt, ist eine Owner-/Produktfrage (N-5/N-6-Risiko) und wird hier
**nicht** entschieden. O-9/OW-9 bleibt offen, bekommt aber diese Praezisierung.

**N-2 — Der Pruefer lag bei den Zeilenverweisen richtig, das Dokument war verschoben.**
Nachgezaehlt: `OWNER_PROFILE` steht auf `src/store/defaults.js:1056-1065`, `DEFAULT_PROFILE` auf
`:1069-1078`. Die alten Angaben (`:1055-1064` / `:1067-1077`) trafen beide daneben. Dieselben
falschen Verweise stehen in `tasks/PLAN-OPENAI-TECHNIK.md` (I-4, OW-9, DP-5) und sind dort
mitkorrigiert.

**N-3 — Wo der Pruefer ungenau war.** Er nennt fuer `answer_consult` die Fundstelle
`src/mcp-tools.js:968`; das ist die `if (consultAllowed)`-Zeile bzw. die Registrierung von
`await_call_event` (`:969`). `answer_consult` selbst wird auf `:1003-1004` registriert. Sachlich
folgenlos — beide haengen an derselben Bedingung; hier nur, damit P1/P10 die richtige Zeile
oeffnet.

**N-4 — Der Pruefer hatte bei D0-3 recht ueber das Dokument, nicht ueber die Sache.** Die alte
Zeile fuehrte ein `curl`-Ergebnis ohne Zeitstempel und ohne Header-Mitschnitt: als *Beleg* nicht
nachpruefbar, also zu Recht beanstandet. Statt den Beleg auf *indiziert* herunterzustufen, ist er
in diesem Lauf **nachgemessen** worden — dasselbe Kommando, vollstaendiger Response-Mitschnitt,
Zeitstempel `2026-09-20T15:31:09Z`, `rndr-id: e0b09e4e-c50b-43b9` (s. D0-3-Zeile). Er ist damit
**belegt**, nicht indiziert. Der Schluss bleibt derselbe und haengt ohnehin nicht daran: Legacy
wird gehaertet, nicht entfernt — die fail-closed Richtung.

**N-5 — Was noch fehlt, damit die Baseline-Staffelung in jeder Zeile *belegt* ist.** Die Zeile
"Produktion heute" rechnet auf `render.yaml` plus Code-Default. Die Render-Services sind
Dashboard-gepflegt (Live != `render.yaml`), also ist der Live-Wert von `CONSULT_ENABLED`
weiterhin **UNKNOWN (nur im Dashboard lesbar, O-6)**. Zu *belegt* wuerde die Zeile durch genau
eine Messung: ein `tools/list` mit einem echten Token gegen `https://app.sundartha.com/mcp` und
die Zahl der zurueckgegebenen Tools zaehlen. Das setzt einen abgeschlossenen WorkOS-Login voraus
(O-3) und kann kein Agent fahren.
