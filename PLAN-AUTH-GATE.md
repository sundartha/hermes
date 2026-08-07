# PLAN-AUTH-GATE.md — das Basic-Auth-Gate aufloesen (Option C)

> **STAND-WARNUNG (Pruefung 2026-08-01) — VOR JEDER UMSETZUNG LESEN.** Dieser Plan wurde am
> 2026-07-28 gegen Commit `a727804` geschrieben; **jede Zeilennummer in diesem Dokument ist
> von DIESEM Stand.** Seither sind 142 Commits gelandet (HEAD `d7aa89d`), im Wesentlichen die
> Umsetzung von PLAN-ASSISTANT-LEAP. Zwei unabhaengige Pruefungen gegen `d7aa89d`
> (2026-08-01) haben ergeben: **keine inhaltliche Aussage ist veraltet**, aber viele
> Zeilennummern sind verschoben — bei `claude.js`, `mcp-tools.js`, `telnyx-llm-shim.js`,
> `boot.js` und `config.js` um bis zu ~220 Zeilen.
>
> **Arbeitsregel fuer jede Session, die diesen Plan umsetzt:** Codestellen IMMER per
> `grep -n` auf den zitierten Funktions-/Variablennamen oder Kommentartext suchen, NIEMALS
> blind der Zeilennummer folgen. An der alten Zeile steht heute plausibel aussehender, aber
> FALSCHER Code. Erwarte weitere Drift: parallele Sessions arbeiten am selben Repo.

> **Fassung 3** — alle Owner-Entscheidungen getroffen (Abschnitt 10), Phasen entsprechend
> festgezurrt. Dieses Dokument ist so geschrieben, dass eine **neue Session es ohne
> Vorwissen umsetzen kann**: Ausgangslage, Belege, Reihenfolge-Begruendung und je Phase
> Vorbedingung/Dateien/Abnahme/Test/Rollback stehen hier. Es wird nichts vorausgesetzt,
> was nur in einem Gespraechsverlauf steht.
>
> Fassung 2 entstand nach adversarischer Pruefung durch drei unabhaengige Pruefer; welcher
> Befund bestaetigt und welcher widerlegt wurde, steht in Abschnitt 11.

## 0. Ausgangslage

**Was passiert ist.** Am 2026-07-28 ging um 16:50 UTC ein Deploy live, der die
Marketing-/App-Oberflaeche (Astro-Build unter `apps/web`) mit neuen Content-Hashes neu
gebaut hat. Um 17:12 UTC forderte der Browser des Owners — mit noch geoeffneter, vor dem
Deploy geladener Seite — einen JavaScript-Chunk des Vorgaenger-Builds an
(`/_astro/subscribe.Du__xz2i.js`). Die Datei existierte nicht mehr. Statt eines `404`
antwortete der Dienst mit `401` und dem Header `WWW-Authenticate: Basic` — woraufhin der
Browser tat, was der Standard vorschreibt: er zeigte mitten in der eingeloggten Anwendung
einen nativen Passwort-Dialog.

**Warum das kein Einzelfall ist.** Ursache ist ein Basic-Auth-Gate
(`src/wiring/auth-gate.js`, gemountet in `src/app.js:264`), das als Sammelsicherung vor
allen uebrigen Routen und **vor dem 404-Handler** sitzt. Jeder Pfad, der weder ausdruecklich
ausgenommen ist noch als Datei im Astro-Build existiert, bekommt darum `401` + Passwort-
Dialog: Tippfehler, alte Bookmarks, `/login`, `/dashboard` — und Bot-Scans, die das
Audit-Log mit rund 90 `auth_failed`-Eintraegen fluten. Fuer ein oeffentliches Produkt ist
das die falsche Antwort auf eine falsche URL.

**Was der Owner entschieden hat.** Das Basic-Auth-Gate wird **vollstaendig aufgeloest**
(Option C). Zielbild: EIN Auth-Mechanismus fuer Menschen — die bestehende
WorkOS/OIDC-Browser-Session — statt zweier paralleler Mechanismen, und spuerbar weniger
Code. Einfachheit ist ausdrueckliches Abnahmekriterium. **Aber:** das Gate ist heute die
einzige Sicherung von 19 Routen (Beleg in Abschnitt 1, Stand Pruefung 2026-08-01; zwei davon
erst nach Fassung 3 dazugekommen); es ersatzlos zu entfernen wuerde
Transkripte offenlegen und anonyme, kostenpflichtige Telefonate ermoeglichen. Der Umbau
laeuft deshalb in neun Phasen, die die Loecher schliessen, **bevor** die Sammelsicherung
faellt. Alle neun Owner-Entscheidungen dazu sind getroffen und in Abschnitt 10 festgehalten.

Dieses Dokument plant den Umbau. Es implementiert nichts. Sicherheitsrelevante Ergebnisse
wandern nach Abschluss als Eintrag in `PLAN-SECURITY.md` (CLAUDE.md, "Vor Edits").

---

## 1. Befund (empirisch, nicht geraten)

**Das Gate.** `makeAuthGate` (`src/wiring/auth-gate.js`) ist in `src/app.js:264` gemountet —
nach der WEB_DIST_DIR-Static-Schicht (`src/app.js:263`), vor `express.static(publicDir)`
(`src/app.js:265`) und vor allen `/api`-Routern. `src/wiring/auth-gate.js:73` ist die einzige
Stelle im Repo, die `WWW-Authenticate: Basic realm="Hermes"` sendet.

**Live verifiziert (2026-07-28, `https://app.sundartha.com`):** `/diese-route-gibt-es-nicht-12345`,
`/login`, `/dashboard` -> 401 + Basic-Challenge. Korrekt dagegen: `/app/` 200, `/api/plans` 200,
`/auth/login` 302, `/tenant.html` 302, `/healthz` 200, `/favicon.ico` 200. `/api/self-service/state`
und `/api/portal/state` -> 401 OHNE `WWW-Authenticate` (eigene Session-Middleware, nicht das Gate).

**`public/` ist leer bis auf zwei gate-exemptierte Dateien.** `ls public/` liefert exakt
`public/favicon.ico` und `public/brand/hermes-icon.png`. Beide sind bereits vom Gate ausgenommen
(`auth-gate.js:61` bzw. `:54`). `express.static(config.server.publicDir)` (`src/app.js:265`)
schuetzt damit **null Dateien**. `public/tenant.html` ist mit P14 (`6b57725`) geloescht. Es
existiert keine menschlich bedienbare HTML-Oberflaeche mehr, die den Basic-Prompt braucht.
(Anmerkung: `CLAUDE.md:59` beschreibt `public/` noch als "Dashboards" — die Zeile ist veraltet.)

**Das Gate ist KEIN Relikt — es ist die einzige Sicherung von 19 Routen** (Stand Pruefung
2026-08-01; die Probe unten wurde am 2026-07-28 gegen 17 Routen gefahren, die beiden seither
dazugekommenen Consult-Routen sind in Abschnitt 3 mit Beleg aufgenommen und tragen dasselbe
Muster — nur `requestTenant`/`requireTenant`, keine eigene Auth-Middleware). Beweis (lokaler
Spawn-Server, `DASHBOARD_PASSWORD=""`, `MULTI_TENANT=true`, Request mit `X-Forwarded-For`
= externer Proxy-Traffic, also genau die Produktions-Topologie):

```
GET  /api/state                     -> 200  {"settings":{"agentName":"Hermes", ...
GET  /api/tenant-data/export        -> 200  {"tenantId":"owner","exportedAt":...
GET  /api/profiles                  -> 200  {}
GET  /api/billing/platform-costs    -> 200  {"currency":"EUR","elevenLabsCents":600,...
POST /api/settings                  -> 200  (Schreibzugriff auf die Agenten-Einstellungen)
POST /api/calls  (gueltige Params)  -> 200  {"ok":true,"callId":"call_...","status":"dialing"}
GET  /nicht-existent-12345          -> 404  Cannot GET /... (Express-Default)
```

Der letzte Fall ist der schwerste: **ein anonymer Request aus dem Internet loest einen echten
Outbound-Anruf aus** (hier mit `FAKE_ORIGINATE`, an derselben Stelle steht in Produktion der
echte Originate). Absolute Regel 1.

**Wurzel dieser Eigenschaft** — nicht Zufall, sondern ein dokumentierter Vertrag:
`requestTenant` (`src/routes/_tenant.js:151`) bindet eine FEHLENDE Identitaet explizit an den
Bootstrap-Tenant (`BOOTSTRAP_TENANT_ID = "owner"`, `src/store/defaults.js:15`). Der Kommentar
dort (`_tenant.js:144-145`) sagt woertlich: *"Das ist KEIN Leck: ohne Identitaet ist dies der
vertraute Owner-/Betreiber-Kanal"*. Dieser Satz ist wahr **genau solange das Basic-Auth-Gate
davor steht**. Faellt das Gate ersatzlos, wird aus dem vertrauten Betreiber-Kanal das offene
Internet. Bei `MULTI_TENANT=false` (`_tenant.js:132`) gilt dasselbe noch direkter.

**Lebende Nutzer der Credentials:** genau einer ausserhalb der Tests —
`scripts/sweep-jetzt.sh:24` (`curl -u "admin:$PW" -X POST .../api/billing/cost-truing/sweep`).
Sonst: `src/config.js:721` (Einlesen), `src/config.js:1296-1298` (Boot-Refusal im Hosting),
`render.yaml:257`, `.env.example:512`, 20 Testdateien. Kein Mensch loggt sich damit in eine
Oberflaeche ein.

**Cache-Header (live gemessen).** Gateway `app.sundartha.com` liefert HTML-Shell UND
fingerprintete Assets mit demselben Header:

```
GET /app/                                   -> cache-control: public, max-age=0
GET /_astro/AuthIsland...Bi7RylB2.js        -> cache-control: public, max-age=0
```

Das ist der express.static-Default (`src/app.js:180`, keine `maxAge`-Option). Der
`immutable`-Header in `render.yaml:516` gehoert zum Static-Service `hermes-web`
(`render.yaml:459`), nicht zum Gateway. Astro nutzt das Default-Assetverzeichnis `_astro/`
(`apps/web/astro.config.mjs` setzt `build.assets` nicht). `src/middleware.js:26` setzt
`no-store` nur fuer `/api/`.

---

## 2. Zwei Ebenen — welche ist die Wurzel

**Ebene I (Ausloeser, Deploy/Cache):** Deploy `76f386c` ging 16:50:28 UTC live, neue
Content-Hashes. Um 17:12:33 UTC forderte ein Browser mit ALTEM HTML den Chunk
`/_astro/subscribe.Du__xz2i.js` des Vorgaenger-Builds an. Die Datei existiert nicht mehr.
Ehrlich benannt: **Cache-Header allein haetten das nicht verhindert.** Eine bereits gerenderte
Seite in einem offenen Tab haelt die alten Chunk-Namen im DOM; kein Header holt sie zurueck.
Ebene I bleibt trotzdem echte Arbeit (der heutige `max-age=0` auf fingerprinteten Assets ist
schlicht falsch herum), sie ist aber nicht die Wurzel des Vorfalls.

**Ebene II (Wurzel des Vorfalls):** Eine fehlende Datei muss `404` ergeben. Sie ergibt heute
`401 + WWW-Authenticate: Basic`, weil das Gate als Sammelsicherung VOR dem 404 sitzt. Der
Browser tut dann genau das, was der Standard verlangt: er zeigt den Passwort-Dialog. Ebene II
ist zugleich das strukturelle Problem eines oeffentlichen Produkts: **jede** Fehl-URL —
Tippfehler, alter Bookmark, Bot-Scan — wirft einen Passwort-Dialog. Das Audit-Log zeigt
~90 `auth_failed`-Treffer aus Bot-Scans (`/.env`, `/wp-json/*`, `/Dockerfile`).

**Wurzel = Ebene II.** Ebene I bekommt trotzdem eine eigene Phase, weil sie unabhaengig richtig
ist.

---

## 3. Routen-Inventar: Schutz NACH dem Wegfall

Vollstaendige Liste dessen, was heute hinter dem Gate liegt (Mount-Reihenfolge `src/app.js`).
Legende: **(a)** bereits eigenstaendig geschuetzt — **(b)** wird ungeschuetzt, Arbeit noetig —
**(c)** soll oeffentlich bleiben.

**Nachtrag (Pruefung 2026-08-01):** nach Fassung 3 sind zwei Routen dazugekommen
(Consult-Kanal aus PLAN-ASSISTANT-LEAP, `routes/api-calls.js:306,331`): `GET
/api/calls/:id/consult` und `POST /api/calls/:id/consult/answer`. Beide haengen heute
allein am Basic-Gate — `GET .../consult` prueft nur `requestTenant`+`callVisibleTo`, keine
eigene Auth-Middleware; `POST .../consult/answer` ruft `requireTenant`, aber anonym greift
weiterhin der Bootstrap-Fallback auf `"owner"` (Abschnitt 1). Sie sind unten mit
aufgenommen. Die Tabelle zaehlt damit **19** statt 17 "nur Gate"-Zeilen (21 echte
HTTP-Endpunkte, weil die Profiles-Zeile drei Methoden buendelt).

| Pfad | Datei:Zeile | heute | nach Wegfall |
| --- | --- | --- | --- |
| `express.static(publicDir)` | `app.js:265` | Gate davor | **(c)** liefert nur `favicon.ico` + `brand/*`, beide schon exempt (`auth-gate.js:54,61`) |
| `/voice/tts/:token` | `routes/voice.js:162` | Einmal-Token | **(a)** Token+TTL, PLAY-TTS in PLAN-SECURITY.md |
| `/voice/*` | `routes/voice.js:173` | Signaturpruefung | **(a)** Telnyx-Ed25519, fail-closed |
| `POST /api/calls` | `routes/api-calls.js:81` | **nur Gate** | **(b1)** |
| `GET /api/calls/:id/consult` | `routes/api-calls.js:306` | **nur Gate** | **(b1)** |
| `POST /api/calls/:id/consult/answer` | `routes/api-calls.js:331` | **nur Gate** | **(b1)** |
| `POST /api/calls/:id/cancel` | `routes/api-calls.js:264` | **nur Gate** | **(b1)** |
| `GET /api/state` | `routes/api-read.js:73` | **nur Gate** | **(b1)** |
| `GET /api/calls/:id` | `routes/api-read.js:111` | **nur Gate** | **(b1)** |
| `GET /api/tenant-data/export` | `routes/api-read.js:128` | **nur Gate** | **(b1)** |
| `POST /api/settings` | `routes/api-tenant-write.js:32` | **nur Gate** | **(b2)** |
| `POST /api/action-items/:id/toggle` | `routes/api-tenant-write.js:41` | **nur Gate** | **(b2)** |
| `POST /api/calendar` | `routes/api-tenant-write.js:47` | **nur Gate** | **(b2)** |
| `GET/POST/DELETE /api/profiles` | `routes/api-profiles.js:26,28,38` | **nur Gate** | **(b2)** |
| `POST /api/billing/flush-meters` | `routes/api-billing.js:42` | **nur Gate** | **(b1)** |
| `POST /api/billing/setup-checkout` | `routes/api-billing.js:56` | **nur Gate** | **(b2)** |
| `POST /api/billing/cost-truing/sweep` | `routes/api-billing.js:85` | **nur Gate** | **(b1)** |
| `GET /api/billing/cost-drift` | `routes/api-billing.js:99` | **nur Gate** | **(b1)** |
| `GET /api/billing/platform-costs` | `routes/api-billing.js:112` | **nur Gate** | **(b1)** |
| `GET /api/billing/checkout-return` | `routes/api-billing.js:128` | **nur Gate** | **(b2)** |
| `POST /api/onboard` | `routes/api-onboard.js:84` | **nur Gate** | **(b1)** |
| `POST /api/onboard/retry` | `routes/api-onboard.js:246` | **nur Gate** | **(b1)** |
| `/mcp` | `routes/mcp.js:42` | `mcpAuth` | **(a)** Bearer/OIDC, gate-exempt (`auth-gate.js:43`) |

Nicht hinter dem Gate (VOR `app.js:264` gemountet) und darum unberuehrt:
`/auth/*` (`web-auth.js:208` login, `:242` callback, `:308` logout, `:333` dev-login — letzterer
nur bei `devLoginEnabled`, fail-closed), `/api/portal/state` (`wiring/web-login.js`, `webAuthMw`),
`/api/admin/*` (`web-auth.js:790,798,817`, `webAuthMw`+`adminMw`),
`/api/self-service/*` (`self-service-routes.js:203,272,306,328,350,398,470`, `webAuthMw`),
`/webhooks/stripe` (HMAC), `/healthz` (`app.js:111`), `/api/plans` (`app.js:121`),
`/v1/chat/completions` (`app.js:140`, eigenes Bearer), `/.well-known/*` (`app.js:123`).

### (b1) — bekommt eigene Auth

1. **`POST /api/calls`, `POST /api/calls/:id/cancel`, `GET /api/state`, `GET /api/calls/:id`,
   `GET /api/calls/:id/consult`, `POST /api/calls/:id/consult/answer`** —
   einziger echter Aufrufer sind die MCP-Tools **in-process ueber localhost**
   (`src/mcp-tools.js`, Funktion `api()`, `fetch(resolveGatewayUrl() + path)`; Pfade fuer die
   ersten vier Routen per `grep -n "resolveGatewayUrl\|await call(" src/mcp-tools.js`).
   **Verifiziert (2026-08-01) fuer die beiden Consult-Routen:** sie werden ausschliesslich
   von den MCP-Tools `await_call_event` (ruft ueber `pollConsult()` `GET
   /api/calls/:id/consult`) und `answer_consult` (ruft ueber `call()`
   `POST /api/calls/:id/consult/answer`) aufgerufen, beide ueber denselben `api()`-Pfad wie
   alle anderen Tools (`grep -n "consult" src/mcp-tools.js`). `apps/web` kennt den
   Consult-Kanal nicht — `grep -rn "consult" apps/web/src/` liefert **keinen** Treffer.
   `apps/web` ruft auch `/api/state` NICHT auf — die einzigen zwei Treffer
   (`apps/web/src/lib/api.js:586`, `components/app/SettingsIsland.astro:30`) sind Kommentare.
   **Vorschlag:** neue benannte Middleware `internalOnly` = `isTrustedLocalCaller(req) ? next() : 403`
   (`routes/_tenant.js:44` ist die bereits definierte, reviewte Vertrauensgrenze). Das ist exakt
   das heutige Verhalten dieser Routen, nur explizit statt als Nebeneffekt des Gates.
2. **`POST /api/onboard`, `POST /api/onboard/retry`** — kauft echte DIDs (Geld). Kein
   Code-Aufrufer, nur manuelles Operator-`curl`. **Entschieden (2):** `webAuthMw` + `adminMw`
   (`web-auth.js:763`, erlaubt `role==='admin'` ODER `ADMIN_EMAILS`-Allowlist).
3. **`GET /api/billing/cost-drift`, `GET /api/billing/platform-costs`,
   `POST /api/billing/flush-meters`, `POST /api/billing/cost-truing/sweep`** — Betreiber-Sicht
   mit **plattformweiten** Zahlen ueber alle Tenants. Genau das, was P5A-ACHSENTRENNUNG
   (PLAN-SECURITY.md) aus Tenant-Antworten verbannt hat. **Entschieden (2):** `webAuthMw` +
   `adminMw`. `scripts/sweep-jetzt.sh` entfaellt dabei ersatzlos (Entscheidung 3).
4. **`GET /api/tenant-data/export`** — DSGVO Art. 15. Kein Aufrufer (`state-ops.js:366` ist
   ein Kommentar). **Entschieden (1): `internalOnly`, KEIN Selbstbedienungs-Export** — der
   Owner beantwortet Auskunftsersuchen von Hand. Mehr passiert in diesem Plan dazu nicht;
   das Werkzeug fuer den manuellen Weg ist bewusst ausgelagert nach `PLAN-TENANT-EXPORT.md`.

### (b2) — ersatzlos loeschen (Beleg fuer "tot")

> **Diese Routen sind nicht nur tot, sie sind scharf.** Zwei von ihnen umgehen den
> Tenant-Resolver vollstaendig und sind darum auch durch das Fail-closed-Machen des
> Bootstrap-Fallbacks (P3) NICHT gedeckt — die beiden Loecher sind unabhaengig:
> - `GET/POST/DELETE /api/profiles` (`api-profiles.js:26,28,38`) ruft `requestTenant`
>   **gar nicht** auf. Ein `POST` mit `{"unrestricted":true}` setzt ein Profil, das in
>   `outbound-gates.js:315` (`if (profile.unrestricted) return null;`) das
>   Verifikations-Gate aufhebt — also Outbound **ohne Abo und ohne KYC**. Die harten
>   Gates davor (`tenantInactive` `:296`, `billingHold` `:308`, Denylist/Land/Limit)
>   bleiben wirksam; das Loch ist die Toll-Fraud-Flaeche, exakt die, die
>   `src/plans.js:84` als solche benennt.
> - `POST /api/action-items/:id/toggle` (`api-tenant-write.js:41`) ruft weder
>   `requireTenant` noch eine Ownership-Pruefung auf — `store.toggleActionItem(req.params.id)`
>   schreibt allein anhand der ID, also cross-tenant.
>
> Daraus folgt die Reihenfolge in Abschnitt 7: **loeschen (P4) vor Gate entfernen (P7)**.

5. **`POST /api/settings`, `POST /api/calendar`, `POST /api/action-items/:id/toggle`** —
   `apps/web` nutzt `/api/self-service/settings`; **kein** MCP-Schreib-Tool existiert
   (`mcp-tools.js` kennt nur `get_calendar` lesend, `mcp-tools.js:711`); der Tool-Dispatch der
   Gespraechs-Engine hat seit P1b **keinen** Kalender-Case mehr (`src/claude.js:317-319`).
   Kein Treffer in `src/`, `scripts/`, `public/`, `apps/web/src/`. -> Datei
   `routes/api-tenant-write.js` entfaellt (75 Zeilen).
6. **`GET/POST/DELETE /api/profiles`** — kein Treffer ausserhalb von Tests und eines
   Kommentars (`src/db/schema.sql:614`). **Achtung:** `routes/api-onboard.js:17` importiert
   `validIdentity`/`IDENTITY_MAX_LEN` aus `routes/api-profiles.js`. Die Helfer muessen umziehen
   (z.B. `routes/_validation.js`), sonst bricht Onboarding. Der Profil-**Mechanismus**
   (`PROFILES_JSON`-Seed, `resolveProfile`) bleibt unangetastet — nur die HTTP-Routen fallen.
7. **`POST /api/billing/setup-checkout` + `GET /api/billing/checkout-return`** — ein
   geschlossenes Legacy-Paar (`api-billing.js:63` setzt die eine als successUrl der anderen),
   vollstaendig ersetzt durch `/api/self-service/billing/setup-checkout`. **Live-Schwanz:**
   eine VOR dem Deploy geoeffnete Stripe-Session traegt die alte Rueckkehr-URL in sich —
   dieselbe Falle, die `LEGACY_PORTAL_PATH` (`src/portal-paths.js:17`) begruendet hat. Deshalb
   Loeschung **nicht** ersatzlos, sondern erst nach einer Karenz mit 302 auf `/app?card=error`.

### (c) — bleibt oeffentlich

`/healthz` (Keep-Alive/Deploy-Wahrheit, nur SHA+Einweg-Hash), `/api/plans` (oeffentlicher
Tarifkatalog, Spiegel von sundartha.com/preise), `/favicon.ico` + `/brand/*` (statische
Markenassets; Icon-Fetcher senden keine Credentials — Begruendung `auth-gate.js:47-60`),
das WEB_DIST_DIR-Serving (`app.js:180`, statisches HTML ohne Tenant-Daten),
`/.well-known/*`, `/auth/login`, `"/"`. Jeder dieser Faelle steht in der expliziten
Oeffentlich-Liste aus Phase 1 — mit Begruendung im Code.

---

## 4. Verworfene Alternativen

- **A — nur den `WWW-Authenticate`-Header verengen.** Beseitigt den Dialog, laesst aber den
  zweiten Auth-Mechanismus samt `DASHBOARD_PASSWORD` bestehen. Verfehlt das Owner-Ziel.
- **B — das Gate auf Praefixe verengen.** Unbekannte Pfade liefen in einen echten 404, aber es
  blieben zwei parallele Mechanismen — und die Sicherung griffe nicht mehr per Default
  (neue Route ausserhalb der Praefixe = still oeffentlich). Verfehlt das Owner-Ziel und kehrt
  zusaetzlich die fail-closed-Richtung um.

---

## 5. Stille Fehler — was kaputtgeht, ohne dass es jemand merkt

Der Owner-Einwand: *"keine blinden Flecken, und nach dem Livegang kriege ich es im schlimmsten
Fall gar nicht mit."* Ein ungeschuetzt gewordener Endpunkt wirft keinen Fehler — er
funktioniert. Darum je Versagensart: (a) Entstehung, (b) Merkmal, (c) Meldemechanismus.

**S1 — eine Route wird oeffentlich erreichbar.**
(a) Eine `(b)`-Route bekommt keine Middleware, oder eine kuenftige Route wird ohne Auth
gemountet. (b) Nichts. Antwort 200, kein Log, Verhalten identisch — nur eben fuer jeden.
(c) **Der Routen-Inventar-Test (Phase 1)** schlaegt beim naechsten `npm test` fehl; **die
Live-Probe (Phase 2)** schlaegt beim naechsten Deploy fehl. Ohne diese beiden: UNENTDECKBAR.

**S2 — ein Provider-Webhook wird geblockt.**
(a) Eine Auth-Middleware wird zu breit gemountet und faengt `/voice/*` oder `/webhooks/stripe`.
(b) Anrufe sterben leise (Telnyx bekommt 401 statt TeXML, der Anrufer hoert Stille), Abos
laufen weiter ohne Zustandsaenderung. (c) Die Live-Probe (Phase 2) prueft `/voice/incoming`
und `/webhooks/stripe` explizit auf **nicht-401**. Zusaetzlich existierender Regressionsschutz:
`test/auth-gate-exemption-order.test.js` friert die Ausnahmekette ein — dieser Test wird durch
den Inventar-Test ERSETZT, nicht ersatzlos geloescht.

**S3 — die Session-Middleware greift auf einer Route nicht.**
(a) `webAuthMw` steht falsch in der Kette, oder der Test fuehrt immer ein gueltiges Cookie mit
und sieht deshalb nie den 401-Zweig. (b) Nichts — der Happy-Path funktioniert. (c) **Jeder
`(b1)`-Test muss den negativen Fall zuerst pinnen: Request OHNE Session MUSS 401 liefern.**
Der Inventar-Test allein reicht nicht (er sieht nur, DASS eine Middleware da ist, nicht dass
sie wirkt). Rot-vor-Fix-Protokoll wie bei P7A-MODELPRICE.

**S4 — SIGNALVERLUST (die unangenehmste).**
(a) `auth-gate.js:72` schreibt heute bei JEDEM Fehlversuch `audit("auth_failed", req, path=...)`.
Mit dem Gate faellt genau dieses Signal weg. (b) Man merkt es nicht — es fehlt ja nur etwas.
(c) **Ohne Ersatz waere das System nach dem Umbau schlechter beobachtbar als vorher.** Loesung:
`internalOnly` und die `(b1)`-Ablehnungen schreiben denselben Audit-Eintrag
(`auth_failed`, Pfad, kein Secret) — die Ablehnungen von `webAuthMw` (`web-auth.js:732`) und
`adminMw` (`web-auth.js:768`) tun das heute **nicht** und muessen ihn bekommen. Nebeneffekt,
der die Bot-Scan-Flut (~90 Treffer) heilt: Bot-Scans auf `/.env` treffen kuenftig einen
404-Pfad ohne Auth-Middleware und erzeugen gar keinen Audit-Eintrag mehr. Das Signal wird
damit sauberer, nicht nur erhalten.

**S5 — der Boot-Guard verschwindet mit.**
(a) `config.js:1296-1298` verweigert heute den Produktionsstart ohne `DASHBOARD_PASSWORD`.
Faellt die Variable, faellt der Guard. (b) Nichts. (c) Der Guard wird nicht geloescht, sondern
**ersetzt** durch eine Pruefung, die im Hosting `SESSION_SECRET` + `STORE_BACKEND=pg` verlangt
(ohne beides existiert `webAuthMw` gar nicht, `app.js:237` — dann waeren die `(b1)`-Routen
nicht gemountet und der Umbau haette ein Loch statt einer Sicherung).

**S6 — der Rettungsweg selbst (B5, Diagnose WIDERLEGT, Fix uebernommen).**
Der Pruefbefund lautete: `auth-gate.js:35` (`if (!config.auth.dashboardPassword) return next();`)
ist fail-open, also reaktiviere ein Rollback nach P7 "ein Gate ohne Passwort = alles offen,
ohne Fehler, ohne Log". **Das trifft in Produktion nicht zu.** Beleg:
`detectProduction()` = `!!process.env.RENDER_EXTERNAL_URL` (`config.js:105-107`);
`productionFootguns` (`config.js:1296-1298`) macht ein fehlendes `DASHBOARD_PASSWORD` **fatal**;
`config.js:1288` sagt woertlich "fail-closed: jeder Treffer ist fatal (Boot-Refusal statt
Warnung)"; `test/boot-prod-footguns.test.js:15` pinnt "Hosting + fehlendes DASHBOARD_PASSWORD
-> Boot verweigert (exit 1)". Ein Rollback ohne die Variable ergibt also **einen lauten
Totalausfall (exit 1), keine stille offene Tuer.**

Der Fix aus dem Befund bleibt trotzdem richtig, aus drei anderen Gruenden:
(a) **Der Rettungsweg ist kaputt.** Genau das Mittel, zu dem man im Vorfall greift, startet
nicht — operativ waehrend eines Incidents schlimmer als ein Rollback, der funktioniert.
(b) **Es gibt ein echtes stilles Fenster, nur ein engeres:** faellt `RENDER_EXTERNAL_URL` je
weg, ist `detectProduction()` false, der Footgun-Check schweigt und das Gate ist fail-open.
Eine einzige Env-Variable traegt das gesamte Signal "wir sind in Produktion".
(c) **Wenn P7 in mehrere Commits zerfaellt** und der Boot-Guard in einem frueheren Commit
faellt als das Gate, trifft ein dazwischen landender Rollback exakt die Kombination
Gate-vorhanden + Guard-weg + Passwort-weg = stilles Offen.
**Konsequenz im Plan:** die Env-Variable faellt erst in P8 nach Karenz und Rollback-Drill;
P7 ist **ein** Commit; der Boot-Guard wird ersetzt, nicht geloescht.

**Ehrliche Luecke:** Es gibt keinen Mechanismus, der eine *semantisch* zu schwache Auth meldet
— z.B. `webAuthMw` statt `webAuthMw+adminMw` auf einer Betreiber-Route. Der Inventar-Test sieht
"eine Auth-Middleware ist da". Die Zuordnung Route -> erforderliche Stufe bleibt eine
Review-Entscheidung. Bewusst als Restrisiko festgehalten.

---

## 6. Pre-Mortem — ein Jahr spaeter, die Entscheidung war falsch

| Szenario | Was passiert waere | Entschaerfung |
| --- | --- | --- |
| **API stand ungeschuetzt im Netz** | Beim Entfernen der Sammelsicherung wurde genau eine Route uebersehen. `GET /api/state` liefert Agenten-Einstellungen; `POST /api/calls` telefoniert auf fremde Rechnung. | P1 (Inventar-Test, gegen den Prod-Graph) + P2 (Live-Probe) **vor** P7. Fail-closed bleibt strukturell: keine Middleware UND kein Eintrag in der Oeffentlich-Liste = roter Test. |
| **Transkripte geleakt** | `GET /api/tenant-data/export` und `GET /api/calls/:id` haengen am Bootstrap-Tenant-Fallback (`_tenant.js:151`). Anonym = Owner-Tenant = alle Gespraeche. | Zwei Schichten: P3 macht den Fallback fail-closed, P5 legt `internalOnly` davor. Negativ-Test (externer Request -> 403) ist Pflicht. |
| **Provider-Webhook stumm geblockt** | Eine zu breit gemountete Middleware toetet `/voice` — der Ausfall ist nur an ausbleibenden Anrufen sichtbar, nicht an einem Fehler. | S2: die Live-Probe prueft `/voice/incoming` und `/webhooks/stripe` auf nicht-401 als Abnahme JEDER Phase. |
| **Spaeter hinzugefuegte Route versehentlich oeffentlich** | Die Default-Sicherung existiert nicht mehr; "hinter Basic-Auth (Bestand deckt `/api/*` ab)" — der Satz steht heute in 6 Modulkommentaren — ist ab dann falsch. | P1 macht den Default maschinell: neue Route ohne Auth und ohne bewussten Oeffentlich-Eintrag = roter `npm test`. Die neue Regel 3 (Abschnitt 9) verlangt den Eintrag ausdruecklich. Die 6 veralteten Kommentare werden in P7 mitkorrigiert. |
| **Kosten explodieren** | Anonymer `POST /api/calls` / `POST /api/onboard` (DID-Kauf). | (b1)-1 und (b1)-2. Die bestehenden Geld-Gates (Budget, Caps, KYC, `OUTBOUND_FROZEN`) bleiben unberuehrt — sie sind die zweite Schicht, nicht die erste. |

---

## 7. Phasen

Reihenfolge-Prinzipien (Fassung 2):

1. **Erst messen koennen, dann umbauen.** P1+P2 sind gruen, bevor irgendetwas faellt.
2. **Erst die Loecher schliessen, dann die Sammelsicherung entfernen.** Die beiden
   anonymen Schreibfenster (Bootstrap-Fallback P3, tote scharfe Routen P4) sind
   geschlossen, BEVOR das Gate faellt (P7). Sonst haette der Umbau ein Zeitfenster, in dem
   das System schwaecher ist als vorher.
3. **Der Rettungsweg wird nicht mit umgebaut.** `DASHBOARD_PASSWORD` bleibt bis P8 in der
   Env stehen (Begruendung: S6/B5 unten).

**Rollback generisch (Repo-Realitaet):** Render-Service ist dashboard-managed, `autoDeploy`
steht aus, Deploys sind manuell. Rollback = im Render-Dashboard den vorherigen Deploy
"Redeploy" bzw. manueller Deploy des Vorgaenger-Commits. Verifikation: `GET /healthz` liefert
`commit` (`app.js:112`) — der Rollback gilt erst als erfolgt, wenn dort der alte SHA steht.
Je Phase unten nur noch das phasenspezifische Abbruchsignal.

### Reihenfolge ist bindend — nicht umsortieren

Die Phasen sehen einzeln harmlos aus. Drei Abhaengigkeiten sind es nicht; wer sie umstellt,
oeffnet ein Zeitfenster, in dem das System **schwaecher ist als heute**:

1. **P3 und P4 muessen vor P7 liegen.** Das Gate ist die einzige Sicherung von 19 Routen.
   Faellt es vorher, sind zwei anonyme Schreibfenster offen — und zwar zwei **unabhaengige**,
   von denen keines das andere deckt:
   - Der Bootstrap-Fallback (`routes/_tenant.js:151`, plus `:132` bei `MULTI_TENANT=false`)
     bindet eine fehlende Identitaet an den Tenant `"owner"`. Anonym = Owner. Betrifft
     alles, was ueber `requestTenant`/`requireTenant` laeuft (`/api/state`, `/api/calls`,
     `/api/tenant-data/export`, `/api/calls/:id/consult`,
     `/api/calls/:id/consult/answer`, ...). **Das schliesst P3.**
   - `/api/profiles` (`routes/api-profiles.js:26,28,38`) und
     `POST /api/action-items/:id/toggle` (`routes/api-tenant-write.js:41`) rufen den
     Tenant-Resolver **gar nicht** auf — P3 wirkt dort nicht. Ein anonymes
     `POST /api/profiles {"unrestricted":true}` haette ueber `outbound-gates.js:315` das
     Verifikations-Gate ausgehebelt: Outbound ohne Abo und ohne KYC. **Das schliesst P4.**
2. **P8 muss nach P7 liegen, mit Karenz dazwischen.** `DASHBOARD_PASSWORD` bleibt nach dem
   Gate-Wegfall zunaechst gesetzt, damit ein Rollback auf einen Commit vor P7 ein scharfes
   Gate vorfindet. Details in S6.
3. **P1 und P2 vor allem anderen.** Sie aendern kein Verhalten, sind aber der einzige
   Meldeweg fuer die Fehler, die dieser Umbau produzieren kann (Abschnitt 5). Ohne sie
   arbeitet man blind.

P9 (Cache-Header, Legacy-Checkout) ist unabhaengig und kann jederzeit laufen.

### Arbeitsregeln fuer die umsetzende Session

- **Testnamen tragen KEIN Katalog-Praefix.** Ein Testname, der mit `GAP-`, `WEB-`, `PAY-`,
  `DID-`, `FMT-`, `OUT-`, `E2E-` oder `PROMPT-` **beginnt**, wird von
  `test/i18n-catalog-run.mjs` automatisch dem `npm run test:gates`-Lauf zugeordnet — und
  dort ist Rot ausdruecklich erlaubt. Ein Sicherheits-Regressionstest, der dort landet,
  meldet nie etwas. Namen hier praefixfrei, z.B. `"Routen-Inventar: jede Route hat Auth oder
  steht in der Oeffentlich-Liste"`.
- **Jede Phase ist ein eigener Commit** (P7 zwingend genau einer, s. S6).
- **Nach jeder Phase:** `node --check` je geaenderter Datei, `npm test` gruen, danach
  `scripts/probe-auth.sh` gegen den frisch deployten Commit.
- **Verwaiste Testserver:** Spawn-Tests hinterlassen `node src/server.js`-Kinder; nach
  Testlaeufen `pkill -f "node src/server.js"`.
- **Vor sicherheitsrelevanten Edits** `PLAN-SECURITY.md` lesen und danach den Eintrag dort
  ergaenzen (CLAUDE.md, "Vor Edits").

### P1 — Routen-Inventar-Test gegen den PRODUKTIONS-Routengraph

- **Vorbedingung:** keine. Aendert kein Laufzeitverhalten.
- **Ziel:** ein Test zaehlt alle registrierten Express-Routen auf und schlaegt fehl, sobald eine
  existiert, die weder eine Auth-Middleware traegt noch in einer im Code stehenden
  Oeffentlich-Liste steht.
- **Technik (verifiziert, Express 4.21):** `buildApp(deps)` liefert `app`; der Stack liegt unter
  `app._router.stack`. Rekursion: `layer.route` -> Route (Pfad `layer.route.path`, Methoden
  `Object.keys(layer.route.methods)`, Handler-Kette `layer.route.stack`); sonst
  `layer.handle.stack` -> gemounteter Router. Erkennung ueber `handler.name`:
  `webAuthGateMiddleware` (`web-auth.js:729`), `adminOnlyMiddleware` (`web-auth.js:765`),
  `mcpAuth` (`auth.js:95`) sind bereits benannte Funktionen; `internalOnly` (P5) wird
  ebenfalls benannt. **Invariante, die der Test mit pinnt: diese Middlewares bleiben benannte
  Funktionen** (eine anonyme Arrow waere im Stack `<anonymous>` und damit unsichtbar).

- **KRITISCH — der Test darf nicht den Testgraph pruefen (B3, bestaetigt).** Der
  Web-Login-Block laeuft nur unter `config.auth.sessionSecret && config.store.storeBackend
  === "pg"` (`app.js:237`). `test/helpers.js:190-191` setzt `STORE_BACKEND: "json"` und
  `DATABASE_URL: ""` — in JEDEM Spawn-Test ist `wireWebLogin` also **nie gelaufen**.
  `/api/self-service/*`, `/api/admin/*`, `/api/portal/state` und `/webhooks/stripe` sind im
  Testgraph **gar nicht vorhanden**. Ein naiv gebauter Inventar-Test waere blind fuer genau
  die Middleware, auf der P5/P6 ruhen — gruen und wertlos.
  **Loesung, dreiteilig:**
  1. `createPortalRunner` wird optionaler `deps`-Parameter von `buildApp` (Default = der
     heute direkt importierte, `app.js:41`). Der Seam existiert konzeptionell schon:
     `wiring/web-login.js` bekommt ihn bereits injiziert und der Modulkommentar dort nennt
     als Grund woertlich "offline fakebar, ohne erreichbare DB"; `test/boot-guard.test.js`
     nutzt dasselbe Muster. Der Test ruft `buildApp` mit einem Fake-Runner und
     `sessionSecret` + `storeBackend:"pg"` -> **voller Prod-Graph ohne Postgres**.
  2. **Positiv-Assertion (beweist, dass der Graph der Prod-Graph IST):** der Test
     verlangt die Anwesenheit von `/api/self-service/state`, `/api/admin/tenants`,
     `/api/portal/state`, `/webhooks/stripe`. Fehlt eine -> rot. Damit kann der Test nicht
     still auf den mageren Testgraph zurueckfallen. Das faengt zugleich W6 (guardedBoot
     hat den Block verschluckt) im Testlauf ab.
  3. **Graph-Fingerprint:** die sortierte Liste `METHODE PFAD` wird als Snapshot gepinnt.
     Jede Route mehr oder weniger erzwingt eine bewusste Aktualisierung.
- **Dateien:** neu `test/route-auth-inventory.test.js`, neu `src/route-policy.js`
  (Oeffentlich-Liste + Praedikat, EINE Quelle fuer Produktion und Test, G5), neu
  `docs/RUNBOOK-AUTH-REVIEW.md` (quartalsweise Checkliste fuer die drei handler-internen
  Faelle, Entscheidung 8); `src/app.js` (optionaler `createPortalRunner`-Dep).
- **Grenze des Tests (W8, teilbestaetigt) — muss im Code stehen:** route-level Middleware ist
  sichtbar, **handler-interne** Auth nicht. Betroffen sind genau drei Faelle, die deshalb
  namentlich mit Begruendung in `route-policy.js` stehen und dort einen Kommentar tragen:
  `/voice/tts/:token` (Einmal-Token im Handler), `/v1/chat/completions` (Bearer im Shim,
  `telnyx-llm-shim.js:327`), `app.use("/voice", ...)` (Praefix-Signatur-MW,
  `routes/voice.js:173`). `express.static`-Schichten ebenso. Fuer diese drei ist die
  handgepflegte Liste die Sicherung — plus der quartalsweise Pruefpunkt in
  `docs/RUNBOOK-AUTH-REVIEW.md` (Entscheidung 8; loest den Pruefer-Dissens R1/R3).
- **Abnahme:** Test gruen; ein absichtlich eingefuegter `app.get("/probe", ...)` macht ihn rot
  (Rot-vor-Fix nachweisen); ein absichtlich auf `json` gedrehtes `storeBackend` macht ihn
  ueber Teilschritt 2 ebenfalls rot.
- **Rollback:** reiner Test + ein optionaler Parameter — Revert des Commits.

### P2 — Live-Probe `scripts/probe-auth.sh`, gepinnt auf Ziel UND Commit

- **Vorbedingung:** keine (P1 empfohlen, aber unabhaengig). Aendert kein Laufzeitverhalten.
- **Ziel:** ausfuehrbarer Nachweis gegen die Live-URL, harte Erwartungen, Exit != 0 bei
  Verletzung. Stil wie das bisherige `scripts/sweep-jetzt.sh` (das in P7 entfaellt) — reines
  `curl` + Statuscode-Vergleich, keine neue Dependency.
- **Ziel-Pin (W7, bestaetigt):** das Skript nimmt URL **und** erwarteten Commit-SHA als
  Pflichtargumente und ruft zuerst `GET /healthz` (`app.js:112` liefert `commit`). Weicht der
  SHA ab -> **sofortiger Abbruch, Exit 2, keine weitere Pruefung**. Ohne das kann die Probe
  gruen gegen Staging oder einen alten Deploy laufen, waehrend Produktion offen steht.
- **Tabelle (ohne Session):** `/healthz` 200 · `/api/plans` 200 · `/favicon.ico` 200 ·
  `/brand/hermes-icon.png` 200 · `/app/` 200 · `/` 200 · `/auth/login` 302 ·
  `/tenant.html` 302 · `/api/state` · `/api/tenant-data/export` · `/api/profiles` ·
  `/api/onboard` · `/api/billing/platform-costs` · `/api/self-service/state` ·
  `/api/portal/state` · `/api/admin/tenants` (Erwartung je Phase, s. H10) ·
  `/voice/incoming` **nicht** 401/404 · `/webhooks/stripe` **nicht** 401/404 ·
  `/diese-route-gibt-es-nicht-12345` **404** · `/login` **404** · `/dashboard` **404**.
- **404 ist ein Fehlschlag, nicht ein Erfolg (W6, bestaetigt).** Fuer jede Route, die
  geschuetzt sein SOLL, gilt "401 oder 403" als bestanden und **404 als Durchfall** — ein 404
  heisst, dass `guardedBoot` (`boot-guard.js:13-25`, fail-open) den Web-Login-Block
  verschluckt hat und die Route gar nicht gemountet ist. `/healthz` bliebe dabei 200 und der
  Ausfall unsichtbar. Die Probe ist der einzige Ort, an dem dieser Zustand auffaellt.
- **Zusatzpruefung auf JEDER Antwort:** Header `WWW-Authenticate` MUSS fehlen (ab P7; davor
  laeuft die Probe im Modus "Ist-Aufnahme").
- **H10 — Erwartungswechsel benennen, nicht wegklicken:** die Erwartung fuer `/api/state`
  wechselt in P5 von 401 (Gate) auf 403 (`internalOnly`), ohne dass ein Defekt vorliegt.
  **Regel: die Erwartungstabelle wird IM SELBEN Commit geaendert wie die Phase, die sie
  aendert.** Eine Probe, die nach einem Deploy "halt anders" ist, trainiert die Geste, rote
  Sicherheitsproben wegzuklicken.
- **Abnahme:** laeuft gegen Live, Exit 0; manipulierter Erwartungswert -> Exit 1; falscher
  Commit -> Exit 2.
- **Diese Probe ist Abnahme-Nachweis JEDER folgenden Phase, die live geht.**

### P3 — Bootstrap-Fallback fail-closed (B2, der offene Boden)

- **Vorbedingung:** P1 und P2 gemergt und gruen.
- **Wurzel:** `requestTenant` (`routes/_tenant.js:151`) bindet eine FEHLENDE Identitaet an
  `BOOTSTRAP_TENANT_ID = "owner"` (`store/defaults.js:15`); bei `MULTI_TENANT=false` tut
  `:132` das sogar unkonditional. Empirisch reproduziert (Abschnitt 1). Solange das gilt,
  ruht jede Folgephase auf einem offenen Boden — deshalb **vor** P5.
- **Ziel:** der Fallback gilt nur noch fuer den genuin lokalen In-Process-Aufrufer.
  Vorgeschlagene Form an beiden Stellen (`:132` und `:151`):
  `isTrustedLocalCaller(req) ? singleTenantBootstrap() : TENANT_REJECT`.
  `isTrustedLocalCaller` (`_tenant.js:44`) ist die bereits definierte und security-reviewte
  Vertrauensgrenze (echtes Loopback UND kein `X-Forwarded-For`) — es kommt keine neue
  Trust-Idee hinzu, die vorhandene wird nur an der letzten Stelle angewandt, an der sie fehlt.
- **Legitime Aufrufer, die NICHT mitsterben duerfen:** die MCP-Tools rufen die eigene REST-API
  in-process ueber localhost (`mcp-tools.js:44`) — echtes Loopback ohne `X-Forwarded-For`,
  also weiterhin `true`. Sie reichen zusaetzlich `X-Internal-Tenant` mit, aber nur
  `if (scopedTenant)` (`mcp-tools.js:42`); der Pfad ohne Header (stdio/Single-Operator) muss
  darum genau ueber `isTrustedLocalCaller` weiterleben.
- **Pflichtschritt vor der Umsetzung:** vollstaendige Aufzaehlung der Konsumenten des
  Fallbacks (`requestTenant`/`requireTenant`-Aufrufer je Route, plus `scripts/*`). Ich habe
  den MCP-Pfad belegt; ich behaupte NICHT, alle Konsumenten gefunden zu haben — diese
  Enumeration ist Teil der Phase, nicht ihrer Voraussetzung.
- **Abnahme:** externer Request (`X-Forwarded-For`) auf `/api/state` -> 403 **auch bei
  entferntem Gate**; in-process MCP-Tool-Aufruf unveraendert 200; `MULTI_TENANT=false` und
  `=true` je ein Test.
- **Abbruchsignal live:** MCP-Tools in claude.ai liefern Fehler statt Daten.

### P4 — tote, aber scharfe Routen loeschen (B1) — VOR dem Gate-Wegfall

- **Vorbedingung:** P3 gemergt (die beiden Loecher sind unabhaengig; die Reihenfolge P3->P4
  ist nur Konvention, beide MUESSEN aber vor P7 liegen).
- **Warum hier und nicht am Ende:** `/api/profiles` und `/api/action-items/:id/toggle`
  umgehen den Tenant-Resolver vollstaendig (Belege in Abschnitt 3, (b2)) und sind darum von
  P3 **nicht** gedeckt. Faellt das Gate vor dieser Phase, steht ein anonymes Schreibfenster
  offen, das ueber `profile.unrestricted` (`outbound-gates.js:315`) das Verifikations-Gate
  aushebelt. Zwei unabhaengige Loecher, zwei Phasen.
- **Ziel / betroffene Dateien:**
  - loeschen: `src/routes/api-tenant-write.js` (75 Z., enthaelt `POST /api/settings`,
    `POST /api/action-items/:id/toggle`, `POST /api/calendar`) und die drei
    `/api/profiles`-Routen in `src/routes/api-profiles.js` (46 Z.)
  - Mounts in `src/app.js:356` (`makeTenantWriteRoutes`) und `:372` (`makeProfileRoutes`)
  - **Umzug (sonst bricht der Boot):** `validIdentity` + `IDENTITY_MAX_LEN` werden von
    `src/routes/api-onboard.js:17` aus `api-profiles.js` importiert -> nach
    `src/routes/_validation.js` verschieben.
  - Tests, die diese Routen fahren, entfallen bzw. werden auf die Nachfolger umgestellt.
- **Entscheidung 4 (bewusst in Kauf genommen):** mit `POST /api/settings` faellt die einzige
  HTTP-Schreibflaeche fuer Settings-Felder **ausserhalb** der engeren Self-Service-Whitelist
  (`src/self-service.js:19`). Solche Felder sind danach nur noch per direktem DB-Eingriff
  aenderbar. Der Owner hat das ausdruecklich akzeptiert.
- **Der Profil-Mechanismus bleibt unangetastet** (`PROFILES_JSON`-Seed, `resolveProfile`,
  `outbound-gates.js`) — nur die HTTP-Schreibflaeche faellt.
- **`setup-checkout`/`checkout-return` NICHT hier**, sondern in P9 nach 30 Tagen Karenz.
- **Abnahme (maschinell):** `POST /api/profiles` -> 404; `POST /api/settings` -> 404;
  `POST /api/action-items/:id/toggle` -> 404; Boot ohne Import-Fehler
  (`node --check` je geaenderter Datei + Server-Start).
- **Testauftrag:** `npm test` gruen; P1-Graph-Fingerprint bewusst aktualisiert.
- **Rollback:** Revert; keine Datenmigration beteiligt.

### P5 — `internalOnly` + Audit-Ersatz

- **Vorbedingung:** P4 gemergt.
- **Ziel:** `internalOnly` (benannte Middleware, `isTrustedLocalCaller(req) ? next() : 403`)
  vor **sieben** Routen: `POST /api/calls`, `POST /api/calls/:id/cancel`, `GET /api/state`,
  `GET /api/calls/:id`, `GET /api/tenant-data/export` (Entscheidung 1 — bewusst
  `internalOnly` statt `webAuthMw`) **sowie den beiden nach Fassung 3 hinzugekommenen
  Consult-Routen `GET /api/calls/:id/consult` und `POST /api/calls/:id/consult/answer`**
  (Beleg und Einstufung: Abschnitt 3, (b1)-1 — ausschliesslicher Aufrufer ist der
  In-Process-MCP-Pfad, `apps/web` hat keinen Treffer fuer `consult`). Zusaetzlich schreiben
  `webAuthMw`/`adminMw`/`internalOnly` bei Ablehnung `audit("auth_failed", req, ...)` (S4).
- **Dateien:** neu `src/wiring/internal-only.js`; `src/routes/api-calls.js`,
  `src/routes/api-read.js`, `src/web-auth.js` (Audit in den Ablehnungszweigen), `src/app.js`.
- **Ausserhalb des Umfangs (bewusst ausgelagert, nicht vergessen):** ein Werkzeug fuer den
  manuellen DSGVO-Auskunftsweg gehoert NICHT in diesen Plan — dieser Plan loest das
  Basic-Auth-Gate ab. Der Merkposten liegt in `PLAN-TENANT-EXPORT.md` (geparkt). Hier
  passiert nur die Einstufung der Route, eine Zeile Klassifikation.
- **W9 (bestaetigt als Risiko, heute nicht realisiert) — per Test pinnen:** `util.audit`
  (`util.js:48-49`) loggt `action`, `req.ip` und `details`. `auth-gate.js:72` uebergibt
  `path=${req.path}` — `req.path` enthaelt **keinen** Query-String, heute leakt also nichts.
  Eine Neuimplementierung mit `req.originalUrl` wuerde den OAuth-`code` (`/auth/callback`)
  und `session_id` (`/api/billing/checkout-return`) mitloggen — Absolute Regel 4.
  **Test: der Audit-Eintrag einer abgelehnten Anfrage mit `?session_id=XYZ&code=ABC` darf
  weder `XYZ` noch `ABC` enthalten.**
- **H11:** `auth_failed` bekommt einen groben, PII-freien Grund (`reason=no_session` /
  `expired` / `not_admin` / `not_local`). Ohne das erzeugt die 1-h-TTL ohne Rolling
  Dauerrauschen, in dem ein echter Angriff untergeht.
- **Abnahme (maschinell):** externer Request (mit `X-Forwarded-For`) auf `/api/state`,
  `/api/tenant-data/export` und `/api/calls/:id/consult` -> 403; in-process MCP-Tool-Aufruf
  -> 200; ein Audit-Eintrag pro Ablehnung; Secret-Leak-Test gruen.
- **Testauftrag:** neuer Spawn-Test (Muster wie die Probe in Abschnitt 1); `npm test` gruen.
- **Rollback:** Revert. **Abbruchsignal live:** MCP-Tools in claude.ai liefern Fehler.

### P6 — (b1)-Routen auf Admin-Session heben (Entscheidung 2)

- **Vorbedingung:** P5 gemergt.
- **Ziel:** `webAuthMw` + `adminMw` (`web-auth.js:763`: `role==='admin'` ODER `ADMIN_EMAILS`)
  vor: `POST /api/onboard`, `POST /api/onboard/retry`, `POST /api/billing/flush-meters`,
  `POST /api/billing/cost-truing/sweep`, `GET /api/billing/cost-drift`,
  `GET /api/billing/platform-costs`. **Nicht** vor `/api/tenant-data/export` (das bekam in
  P5 `internalOnly`, Entscheidung 1).
- **Dateien:** `src/routes/api-onboard.js`, `src/routes/api-billing.js`, `src/app.js`
  (Injektion von `webAuthMw`/`adminMw` — sie entstehen heute nur im `guardedBoot`-Block
  `src/wiring/web-login.js`; ohne Web-Login-Infra duerfen diese Routen **nicht** gemountet
  werden statt ungeschuetzt zu sein).
- **W6-Kopplung:** genau dadurch wird ein verschluckter `guardedBoot` zu einem 404 auf diesen
  Routen — was die Probe aus P2 als Durchfall wertet. Das ist der Meldeweg.
- **Abnahme (maschinell):** je Route ein Negativ-Test OHNE Session -> 401 (S3), einer mit
  Nicht-Admin-Session -> 403, einer mit Admin-Session -> Erfolg.
- **Testauftrag:** `npm test` gruen; P2-Erwartungstabelle im selben Commit nachziehen (H10).
- **Rollback:** Revert. **Abbruchsignal live:** Owner kommt nicht mehr an Onboarding.

### P7 — Gate entfernen (das eigentliche Delta) — Env-Variable BLEIBT

- **Vorbedingung:** P3, P4, P5, P6 gemergt; P1 und P2 gruen gegen den aktuellen Prod-Commit.
  **Ohne diese vier ist P7 verboten** (Abschnitt "Reihenfolge ist bindend").
- **Ziel:** `makeAuthGate` + Mount verschwinden. Unbekannte Pfade liefern 404 ohne
  `WWW-Authenticate`.
- **`DASHBOARD_PASSWORD` bleibt in `render.yaml`, `.env.example` und `config.js` stehen** —
  ungenutzt, aber gesetzt. Begruendung: Rollback-Sicherheit, s. S6 und P8.
- **Dateien:**
  - loeschen: `src/wiring/auth-gate.js` (76 Z.), `test/auth-gate-exemption-order.test.js`
    (186 Z., durch P1 ersetzt), **`scripts/sweep-jetzt.sh` ersatzlos** (Entscheidung 3)
  - aendern: `src/app.js` (`installAuthGate`, Import, Aufruf), **18 Dateien unter `test/`**
    (16 `*.test.js` plus `test/helpers.js` und `test/prod-env.js` — exakt gezaehlt, H12),
    `README.md`, `CLAUDE.md:65` (Regel-3-Neufassung, Abschnitt 9), `CLAUDE.md:59`
    (`public/`-Beschreibung), die 6 Modulkommentare "hinter Basic-Auth"
  - neu: die 302-Umleitungen aus Entscheidung 5 (s.u.)
- **Entscheidung 5 — Sackgassen zu Umleitungen.** `/login` -> 302 `/auth/login`,
  `/dashboard` -> 302 `/app`. Das war der urspruengliche Ausloeser: wer die URL tippt, soll
  im Login landen. Mount VOR dem statischen Serving, Muster wie `LEGACY_PORTAL_PATH`
  (`src/app.js:173`), Pfade als benannte Konstanten in `src/portal-paths.js` (kein
  Magic-String, G25). **Zusaetzlich vorgeschlagen, nicht eigenmaechtig gesetzt** — der Owner
  entscheidet, welche davon mitkommen: `/signin`, `/sign-in`, `/account`, `/portal`
  (-> `/auth/login` bzw. `/app`) und `/admin` (-> `/app`). Deutsche Varianten
  (`/anmelden`, `/konto`) halte ich fuer entbehrlich: Marketing ist englisch und `/app`
  bleibt englisch; nur die Rechtstexte sind deutsch.
- **Diese Phase ist EIN Commit.** Sie darf nicht in Teil-Commits zerfallen (s. S6).
- **Abnahme (maschinell):** P1 gruen; P2 gruen inkl. `WWW-Authenticate`-Abwesenheit auf
  JEDER Antwort; `grep -rn "WWW-Authenticate" src/` leer; `/login` und `/dashboard` -> 302;
  `/diese-route-gibt-es-nicht-12345` -> 404.
- **Testauftrag:** `npm test` gruen; P2 gegen den frisch deployten Commit.
- **Rollback:** Deploy des Vorgaenger-Commits; das alte Gate findet `DASHBOARD_PASSWORD`
  noch vor und ist sofort wieder scharf.
- **Abbruchsignal live:** P2 meldet 200 auf `/api/state` ohne Session -> **sofortiger**
  Rollback (Datenleck-Fall).

### P8 — Env-Variable + Boot-Guard nach Karenz (schliesst die Rollback-Luecke)

- **Vorbedingung: fruehestens 14 Tage nach dem Live-Deploy von P7** (Entscheidung 7) UND
  gruener Rollback-Drill (s.u.). Bis dahin ist ein Rollback auf jeden Commit vor P7
  gefahrlos: das alte Gate findet sein Passwort vor und ist scharf.
- **Ziel:** `DASHBOARD_PASSWORD` faellt aus `config.js:721`, `render.yaml:257`,
  `.env.example:512`. Der Boot-Guard `config.js:1296-1298` wird nicht geloescht, sondern
  **ersetzt**: im Hosting werden `SESSION_SECRET` + `STORE_BACKEND=pg` fatal verlangt (ohne
  beides existiert `webAuthMw` nicht, `app.js:237` — die (b1)-Routen waeren dann nicht
  gemountet, und der Umbau haette ein Loch statt einer Sicherung). Damit bleibt der
  Boot-Refusal-Mechanismus als Klasse erhalten (S5).
- **Rollback-Drill, Pflicht vor P8:** auf Staging (a) den Vorgaenger-Commit von P7 deployen,
  (b) `probe-auth.sh` mit dem Vorgaenger-SHA laufen lassen, (c) nachweisen, dass `/api/state`
  401 liefert und nicht 200. Erst wenn dieser Drill gruen ist, darf die Variable fallen.
- **Abnahme (maschinell):** Boot mit gesetztem `SESSION_SECRET`+`STORE_BACKEND=pg` startet;
  Boot ohne eines von beiden im Hosting -> exit 1 mit Nennung der Variable (Muster
  `test/boot-prod-footguns.test.js`); `grep -rn "DASHBOARD_PASSWORD" src/ render.yaml
  .env.example` leer.
- **Testauftrag:** `npm test` gruen; P2 gegen den neuen Commit.
- **Rollback nach P8:** ein Rollback ueber P8 hinaus erfordert, die Env-Variable im Render-
  Dashboard **wieder zu setzen** — das gehoert in den Runbook-Eintrag
  (`docs/RUNBOOK-AUTH-REVIEW.md`, s. Entscheidung 8), nicht in den Kopf des Diensthabenden.

### P9 — Cache-Header + Legacy-Checkout-Paar

- **Vorbedingung:** fuer den Cache-Teil keine (unabhaengig, jederzeit machbar). Fuer das
  Legacy-Paar: **fruehestens 30 Tage nach dem Live-Deploy von P7** (Entscheidung 6).
- **Cache (unabhaengig von der Gate-Entscheidung richtig):** `express.static` fuer WEB_DIST_DIR
  (`src/app.js:180`) mit `setHeaders`: Pfade unter `/_astro/`
  `Cache-Control: public, max-age=31536000, immutable`; `*.html` `no-cache`. Heute tragen
  beide `public, max-age=0` (Abschnitt 1). `src/middleware.js:26` (`no-store` fuer `/api/`)
  bleibt unberuehrt.
- **Legacy-Paar:** `POST /api/billing/setup-checkout` + `GET /api/billing/checkout-return`
  (`routes/api-billing.js:56,128`) entfallen; `checkout-return` bleibt als 302 auf
  `/app?card=error` (`CHECKOUT_RETURN.CARD_ERROR`, `src/portal-paths.js:26`) bestehen. Grund
  fuer die 30 Tage: eine VOR dem Deploy geoeffnete Stripe-Checkout-Session traegt die alte
  Rueckkehr-Adresse in sich — dieselbe Falle, die `LEGACY_PORTAL_PATH` begruendet hat.
- **Abnahme (maschinell):** `curl -I .../app/` -> `no-cache`;
  `curl -I .../_astro/<chunk>.js` -> `immutable`; `POST /api/billing/setup-checkout` -> 404;
  `GET /api/billing/checkout-return?session_id=x` -> 302 auf `/app?card=error`.
- **Testauftrag:** `npm test` gruen; P2 gruen.
- **Rollback:** Revert; die Cache-Wirkung eines faelschlich als `immutable` ausgelieferten
  Assets ueberlebt den Rollback im Browser — deshalb strikt nur fingerprintete Pfade.

---

## 8. Teststrategie

- **`test/route-auth-inventory.test.js` (P1)** ist der dauerhafte Schutz: er ersetzt die
  Sammelsicherung durch eine maschinelle Vollstaendigkeitspruefung. Rot-vor-Fix nachweisen.
- **Der Inventar-Test MUSS den Produktions-Routengraph pruefen (B3).** Ein Test gegen die
  Default-Testumgebung ist strukturell blind fuer `webAuthMw` — `test/helpers.js:190-191`
  faehrt `STORE_BACKEND: "json"`, `app.js:237` mountet den Web-Login-Block dann nie. Der Test
  konstruiert die App darum mit `sessionSecret` + `storeBackend:"pg"` + gefaktem
  `createPortalRunner` und **verlangt die Anwesenheit** von `/api/self-service/state`,
  `/api/admin/tenants`, `/api/portal/state`, `/webhooks/stripe`. Diese Positiv-Assertion ist
  der Beweis, dass Test- und Prod-Graph identisch sind — ohne sie kann der Test still auf den
  mageren Graph zurueckfallen und gruen bleiben.
- **Negativ-Tests zuerst (S3):** jede `(b1)`-Route braucht "ohne Session -> 401", bevor der
  Happy-Path getestet wird. Ein Test, der immer ein gueltiges Cookie mitfuehrt, beweist nichts.
- **Secret-Leak-Test fuer das Audit (W9):** eine abgelehnte Anfrage mit
  `?session_id=XYZ&code=ABC` darf weder `XYZ` noch `ABC` im Audit-Eintrag erzeugen. Pinnt
  `req.path` gegen ein spaeteres `req.originalUrl` (Absolute Regel 4).
- **`scripts/probe-auth.sh` (P2)** deckt ab, was Tests nicht koennen: die echte Deploy-Topologie
  hinter Render+Cloudflare (`X-Forwarded-For`, `trust proxy`) — und den fail-open-`guardedBoot`,
  den kein Unit-Test sieht (404 statt 401 = Durchfall, W6). Sie pinnt Ziel-URL **und**
  erwarteten Commit (W7).
- **WARNUNG — Katalog-Praefix.** Testnamen duerfen **NICHT** mit `GAP-`, `WEB-`, `PAY-`, `DID-`,
  `FMT-`, `OUT-`, `E2E-` oder `PROMPT-` beginnen. Ein Regressionstest mit Katalog-ID am
  Namensanfang wandert still in den `test:gates`-Lauf, wo Rot erlaubt ist — der Schutz meldet
  dann nie. Namen hier praefixfrei, z.B. `"Routen-Inventar: jede Route hat Auth oder steht in
  der Oeffentlich-Liste"`.
- **Verwaiste Testserver:** Spawn-Tests hinterlassen `node src/server.js`-Kinder. Nach
  Testlaeufen `pkill -f "node src/server.js"`.

---

## 9. Absolute Regel 3 — Neufassung

Die Fassung 1 dieses Plans schlug vor: *"Neue Endpunkte sind hinter der Browser-Session ODER
`internalOnly`"*. Das war eine **Aufweichung** (B4, bestaetigt): es strich "standardmaessig"
(default-deny), die Begruendungspflicht im Code-Kommentar und `safeEqual`. Zurueckgenommen.

**Zu `safeEqual`:** es bleibt in der Regel, weil es weiterhin gebraucht wird. Der Wegfall des
Basic-Gates entfernt genau **einen** von sechs Credential-Vergleichen. Es bleiben:
`web-auth.js:63` (Cookie-Signatur), `auth.js:101` (MCP-Bearer), `telnyx-llm-shim.js:327`
(Shim-Bearer), `bridge.js:272` (Stream-Token). Ein Streichen waere sachlich falsch.

Vorgeschlagener Wortlaut fuer `CLAUDE.md` (ersetzt den heutigen Punkt 3):

> 3. **AUTH FAIL-CLOSED**: Neue Endpunkte sind **standardmaessig** hinter einer
>    authentifizierten Identitaet — Browser-Session (`webAuthMw`, fuer Betreiber-Routen
>    zusaetzlich `adminMw`) oder, fuer den In-Process-MCP-Pfad, `internalOnly`
>    (`isTrustedLocalCaller`). Jede Ausnahme (wie `/voice`, `/mcp`, `/healthz`, `/api/plans`)
>    braucht eine eigene Absicherung, eine Begruendung im Code-Kommentar **und** einen
>    Eintrag in der Oeffentlich-Liste (`src/route-policy.js`); ohne beides schlaegt
>    `test/route-auth-inventory.test.js` fehl. Credential-Vergleiche timing-sicher
>    (`safeEqual`).

Gegenueber heute ist das **strenger**, nicht schwaecher: die Begruendung muss zusaetzlich
maschinenlesbar hinterlegt werden, sonst wird der Test rot. Das ist der Ersatz fuer die
wegfallende Sammelsicherung.

---

## 10. Owner-Entscheidungen (getroffen 2026-07-28)

Alle neun offenen Fragen sind beantwortet. Die Antworten sind **bindend** und in die Phasen
eingearbeitet; die Phase, in der sie wirken, steht jeweils dabei.

**1. `/api/tenant-data/export` — NEIN, kein Selbstbedienungs-Export.** Die Route bekommt in
**P5** `internalOnly` (nicht `webAuthMw`); Auskunftsersuchen nach DSGVO Art. 15 beantwortet
der Owner von Hand. Fuer diesen Plan ist das die ganze Aenderung: eine Einstufung.

Die Frage, **womit** der Owner eine solche Auskunft praktisch erstellt, ist ein eigenes Thema
und vom Owner am 2026-07-28 bewusst zurueckgestellt. Sie liegt als geparkter Merkposten in
**`PLAN-TENANT-EXPORT.md`** — inklusive des dabei aufgefallenen Befunds, dass heute kein
Export-Werkzeug existiert. Dieser Plan baut es ausdruecklich nicht (Absolute Regel 6).

**2. Betreiber-Routen — JA, Admin-Session.** `webAuthMw` + `adminMw` (`role==='admin'` bzw.
`ADMIN_EMAILS`) vor `/api/onboard*` und den vier Billing-Operator-Routen. Wirkt in **P6**.

**3. `scripts/sweep-jetzt.sh` — Variante (c), Skript entfaellt ersatzlos.** Wirkt in **P7**.
- *Begruendung:* der Sweep laeuft ohnehin automatisch — `src/boot.js:493-500` ruft
  `costTruing.runCostTruingSweep({ trigger: SWEEP_TRIGGER.INTERVAL })` in einem
  `setInterval` mit `config.billing.costTruingSweepIntervalMs` (Default 3600000 ms = 1 h,
  `.env.example:280`). Das Skript war nur ein "jetzt sofort statt in bis zu einer Stunde"-
  Ausloeser. Der Owner will ausdruecklich keinen wiederkehrenden manuellen Handgriff.
- *Geprueft — geht eine Faehigkeit verloren?* Der Route-Handler
  (`routes/api-billing.js:85-89`) ruft **dieselbe** Funktion mit denselben Parametern, nur
  mit `trigger: SWEEP_TRIGGER.MANUAL` statt `INTERVAL` (`billing/cost-truing.js:34`). Es gibt
  keine abweichenden Parameter, keinen Nachhol-Modus fuer alte Zeitraeume, keinen anderen
  Umfang. Verloren gehen genau zwei Dinge:
  - **(a) Unmittelbarkeit** — Wartezeit bis zu einer Stunde statt sofort.
  - **(b) Das Label `manual`** verschwindet aus den Sweep-Daten; alle Laeufe tragen kuenftig
    `interval`. Ohne Auswertungsfolgen, aber erwaehnt, damit es niemanden ueberrascht.
- *Restrisiko (benannt, akzeptiert):* das `setInterval` hat **keinen** Lauf beim Boot — der
  erste Sweep kommt erst eine Stunde nach jedem Prozessstart (`grep -n runCostTruingSweep
  src/boot.js` findet nur den Aufruf innerhalb des Intervalls). Bei mehreren Deploys pro
  Stunde kann der Sweep dauerhaft ausbleiben, ohne dass etwas rot wird. Das ist ein
  **bestehender** Zustand, den dieser Plan nicht einfuehrt — aber der Wegfall des Skripts
  nimmt den bisherigen manuellen Notausgang. Eigene kleine Folgephase (Boot-Lauf ergaenzen),
  bewusst nicht in diesen Plan gezogen.

**4. `POST /api/settings` — LOESCHEN.** Wirkt in **P4** (die ganze Datei
`routes/api-tenant-write.js` faellt). Bewusst in Kauf genommen: Settings-Felder ausserhalb
der Self-Service-Whitelist (`src/self-service.js:19`) sind danach nur noch per direktem
DB-Eingriff aenderbar.

**5. `/login` und `/dashboard` — JA, als 302.** Wirkt in **P7**: `/login` -> `/auth/login`,
`/dashboard` -> `/app`. Weitere naheliegende Pfade **vorgeschlagen, nicht gesetzt** —
Owner-Entscheid ausstehend: `/signin`, `/sign-in`, `/account`, `/portal` (-> `/auth/login`
bzw. `/app`), `/admin` (-> `/app`). Deutsche Varianten (`/anmelden`, `/konto`) halte ich fuer
entbehrlich, weil Marketing und `/app` englisch sind und nur die Rechtstexte deutsch.

**6. Karenz Legacy-Checkout — 30 Tage** nach dem Live-Deploy von P7. Wirkt in **P9**.

**7. Karenz `DASHBOARD_PASSWORD` — 14 Tage** nach dem Live-Deploy von P7. Wirkt in **P8**.

**8. Handler-interne Auth — Variante (b): Eintrag PLUS wiederkehrender Pruefpunkt.**
Der Inventar-Test aus P1 sieht route-level Middleware, aber keine Auth, die im Handler-Rumpf
sitzt. Fuer diese drei Faelle gilt daher beides:
- Eintrag mit Begruendungskommentar in `src/route-policy.js` (P1), **und**
- ein wiederkehrender Pruefpunkt in **`docs/RUNBOOK-AUTH-REVIEW.md`** (neue Datei, in P1
  anzulegen), **Takt: quartalsweise**, mit genau dieser Checkliste:

  | # | Route | Was geprueft wird | Beleg-Anker (grep, KEINE Zeilennummer — die drifted) |
  | --- | --- | --- | --- |
  | 1 | `GET /voice/tts/:token` | Token wird weiterhin einmalig verbraucht (`takeOnce`) und die TTL ist gesetzt; die Route liegt weiterhin VOR der Signatur-Middleware und ist nicht versehentlich oeffentlich erweitert worden | Route-Registrierung in `src/routes/voice.js`: `grep -n 'voice/tts/:token' src/routes/voice.js`; Handler ruft `ttsStore.takeOnce(...)`; TTL-Konstante `ELEVENLABS_TTS_TOKEN_TTL_MS` (`grep -n ELEVENLABS_TTS_TOKEN_TTL_MS src/config.js`) |
  | 2 | `POST /v1/chat/completions` | Flag-Gate (404 bei `TELNYX_AI_ASSISTANT_ENABLED` aus) UND `safeEqual`-Bearer-Pruefung gegen das Shim-Secret sind beide noch da; Empty-Secret-Trap weiterhin abgelehnt | Handler `handleChatCompletion` (Rueckgabewert von `makeTelnyxLlmShim`) in `src/telnyx-llm-shim.js`: `grep -n 'safeEqual(bearer' src/telnyx-llm-shim.js` fuer die Bearer-Pruefung, `grep -n 'telnyxAssistant.enabled' src/telnyx-llm-shim.js` fuer das Flag-Gate davor |
  | 3 | `app.use("/voice", ...)` (heute: `router.use("/voice", ...)` in `makeVoiceRoutes`) | Die Ed25519-/HMAC-Signaturpruefung ist weiterhin als Praefix-Middleware VOR allen `/voice`-Handlern montiert und fail-closed (ungueltig -> 403, nicht `next()`) | `grep -n 'router.use("/voice"' src/routes/voice.js`; ruft `inboundSignatureVerifier().verifyInboundSignature(...)` |

  Zusaetzlich in derselben Datei: der Hinweis aus P8, dass ein Rollback ueber P8 hinaus das
  Wiedersetzen von `DASHBOARD_PASSWORD` im Render-Dashboard erfordert.

**9. `SESSION_TTL_SECONDS` — keine eigene Phase.** Eine Stunde bleibt.
- *Randnotiz:* die Variable ist in Render **nicht gesetzt**; es gilt der Code-Default 3600
  (`src/config.js:1042`). Kein Rolling, keine WorkOS-Revalidierung. Ab P7 ist die
  Browser-Session der einzige Auth-Mechanismus fuer Menschen — der Eindruck "tagelang
  eingeloggt" entsteht durch die separate WorkOS-SSO-Session, nicht durch diese TTL.

---

## 11. Pruefung und Einarbeitung

Fassung 1 dieses Plans wurde von drei unabhaengigen Pruefern adversarisch geprueft: einer hat
das Routen-Inventar blind neu hergeleitet, einer die Belege auditiert, einer als
Sicherheitskritiker gegengelesen. Ergebnis fuer Fassung 1: **nicht freigabefaehig.** Die
Bestandsaufnahme (Abschnitte 1-3) wurde bestaetigt; die Blocker sassen in der Uebersetzung von
Bestand in Reihenfolge und Mechanismus. Jeder Befund wurde vor der Einarbeitung am Code
nachgeprueft.

| Befund | Urteil | Beleg / Konsequenz |
| --- | --- | --- |
| **B1** anonymes Schreibfenster P5->P7 | **bestaetigt** | `outbound-gates.js:315` hebt bei `unrestricted` das Verifikations-Gate auf; `api-profiles.js:26,28,38` ruft `requestTenant` nie auf -> von P3 nicht gedeckt. Loeschen ist jetzt **P4, vor** dem Gate-Wegfall. |
| **B2** Bootstrap-Fallback nicht fail-closed | **bestaetigt** (staerkster Befund) | `_tenant.js:151` + `:132`, empirisch reproduziert (Abschnitt 1). Neue **P3** vorgezogen, MCP-in-process bleibt ueber `isTrustedLocalCaller` am Leben. |
| **B3** CI-Routengraph != Prod-Routengraph | **bestaetigt** | `test/helpers.js:190-191` (`STORE_BACKEND: "json"`, `DATABASE_URL: ""`) gegen `app.js:237` -> `wireWebLogin` laeuft in **keinem** Spawn-Test. P1 baut jetzt den Prod-Graph ueber einen injizierten `createPortalRunner` + Positiv-Assertion + Fingerprint. |
| **B4** Aufweichung von Absoluter Regel 3 | **bestaetigt** | Fassung 1 strich default-deny, Begruendungspflicht und `safeEqual`. Neuer Wortlaut in Abschnitt 9, strenger als heute. `safeEqual` bleibt — 4 weitere Nutzer (`web-auth.js:63`, `auth.js:101`, `telnyx-llm-shim.js:327`, `bridge.js:272`). |
| **B5** Rollback-Luecke | **Diagnose widerlegt, Fix uebernommen** | `config.js:105-107` + `:1288` + `:1296-1298` und `test/boot-prod-footguns.test.js:15`: ein Rollback ohne die Variable ergibt **exit 1 (lauter Totalausfall)**, nicht "alles offen, ohne Log". Die drei echten Gruende fuer denselben Fix stehen in S6. Umgesetzt als **P8** (Karenz + Drill) und "P7 ist ein Commit". |
| **W6** guardedBoot fail-open | **bestaetigt** | `boot-guard.js:13-25` schluckt; `/healthz` bleibt 200. Meldeweg: P2 wertet **404 auf einer Soll-geschuetzten Route als Durchfall**; P1 verlangt die Anwesenheit der Web-Login-Routen im Graph. |
| **W7** Probe ohne Ziel-Pin | **bestaetigt** | P2 nimmt URL + erwarteten Commit, prueft `GET /healthz` (`app.js:112`) zuerst, Exit 2 bei Abweichung. |
| **W8** Inventar-Test blind fuer Praefix-MW | **teilweise bestaetigt** | Route-level Middleware **ist** sichtbar (eigenes Express-4.21-Experiment; `mcpAuth` ist eine benannte Funktion, `auth.js:95`). Blind ist der Test nur fuer **handler-interne** Auth — genau drei Faelle, in P1 namentlich gelistet. Offengelegt statt geglaettet; vom Owner mit Entscheidung 8 (Eintrag + quartalsweiser Pruefpunkt) aufgeloest. |
| **W9** Secret-Leak im Audit | **bestaetigt als Risiko, heute nicht realisiert** | `util.js:48-49` loggt `details`; `auth-gate.js:72` uebergibt `req.path` (ohne Query) -> heute kein Leak. `req.originalUrl` waere eines. In P5 per Test gepinnt. |
| **H10** Erwartungswechsel 401->403 | eingearbeitet | P2: Erwartungstabelle wird im selben Commit geaendert wie die Phase. |
| **H11** `auth_failed`-Rauschen | eingearbeitet | P5: PII-freies `reason=`-Feld. |
| **H12** "20 Testdateien" ungenau | **bestaetigt, korrigiert** | Exakt: 16 `test/*.test.js` + `test/helpers.js` + `test/prod-env.js` = **18**. In P7 korrigiert. |
| **H13** `/auth/dev-login` fehlte | eingearbeitet | `web-auth.js:333`, flag-gegatet (`devLoginEnabled`), Einstufung unveraendert oeffentlich. |
| **H14** `toggle` ohne Ownership | **bestaetigt** | `api-tenant-write.js:41` ruft weder `requireTenant` noch eine Ownership-Pruefung; `store.toggleActionItem(req.params.id)` schreibt cross-tenant. Stuetzt "loeschen statt nachruesten" (P4). |

**Was der Plan auch nach dieser Ueberarbeitung NICHT abdeckt:**
- Semantisch zu schwache Auth (Session statt Admin) wird von keinem Mechanismus gemeldet.
- Der Inventar-Test sieht handler-interne Auth nicht; dort traegt ein quartalsweiser
  manueller Pruefpunkt (Entscheidung 8) die Last — ein Mensch, kein Mechanismus.
- Die vollstaendige Enumeration der Bootstrap-Fallback-Konsumenten ist Teil von P3, nicht
  bereits erbracht.
- `RENDER_EXTERNAL_URL` traegt allein das Signal "Produktion" (S6b) — nicht in diesem Plan
  geloest.
- Die Live-Probe bleibt manuell; sie erzwingt sich nicht selbst nach einem Deploy.
- **Aus den Owner-Entscheidungen neu hinzugekommen:**
  - Die DSGVO-Art.-15-Frist haengt an manueller Arbeit (Entscheidung 1) — und es existiert
    heute kein Werkzeug dafuer. Dieser Plan liefert bewusst keines; der Merkposten liegt in
    `PLAN-TENANT-EXPORT.md` (geparkt).
  - Der Cost-Truing-Sweep hat keinen Boot-Lauf; nach dem Wegfall des manuellen Ausloesers
    (Entscheidung 3) kann er bei dichten Deploys still ausbleiben. Bestehender Zustand,
    bewusst nicht in diesen Plan gezogen.
  - Der quartalsweise Pruefpunkt (Entscheidung 8) ist ein Mensch, kein Mechanismus. Wird er
    ausgelassen, meldet nichts.
