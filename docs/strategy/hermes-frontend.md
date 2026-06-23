# Strategie: Produkt-Frontend fuer Hermes (Website + eingeloggte App)

> Status: Strategiedokument (Architektur-Team: Architect + Planner + Safety-Reviewer). KEIN Code, KEINE Implementierung — dies ist der Bauplan in Phasen. Erarbeitet gegen den echten Bestand (CLAUDE.md, render.yaml, src/server.js, src/web-auth.js, src/self-service-routes.js, src/self-service.js, src/onboarding.js, src/billing/, src/store/, public/tenant.html), nicht gegen Annahmen.

---

## 1. Lage & Ziele

**Was.** Hermes ist ein autonomer Telefon-KI-Agent (Node/ESM, Express, kein Build-Step, Multi-Tenant, sicherheitskritisch). Das Backend nimmt echte Anrufe an, loest echte Calls/SMS mit echten Kosten aus, haelt Transkripte, Stripe-Holds und Tenant-Daten mit Postgres-RLS. Wir bauen jetzt das **Produkt-Frontend** mit zwei Gesichtern, aber EINER App:

1. **Oeffentlich/Marketing**: das Produkt vorstellen, Branding, "So funktioniert's", Preise/Abos. SEO-faehig — Google muss die Inhalte sehen → vorgerendertes statisches HTML (SSG).
2. **Eingeloggt/Produkt**: registrieren, einloggen, Zahlungsmethode hinterlegen (spaeter Abo-Lifecycle), und den Anruf-Verlauf + Zusammenfassungen sehen.

**Warum.** Die Vision (CLAUDE.md) ist ein Produkt fuer Millionen Menschen. Login, Abo und Anruf-Daten teilen das Datenmodell des Backends; das Frontend ist die Tuer dazu. Die gesamte Auth-/Billing-/Anruf-Logik **existiert bereits** im Backend (OIDC+PKCE in `web-auth.js`, `/api/self-service/*`, `/api/state`, `src/billing/`, `src/onboarding.js`). Das Frontend dupliziert davon **nichts** — es ist ein duenner Client, der die bestehende API per `fetch()` ruft.

**Fuer wen.** Endkunden (Tenants), die einen eigenen Telefon-Assistenten betreiben. Der Owner-/Admin-Bereich (`public/index.html`) ist NICHT Teil dieses Produkt-Frontends und bleibt am Gateway.

**Wichtigste Bestands-Wahrheit, die alles formt.** Heute bedient **ein** Express-Server alles same-origin: `/voice/*` (Twilio/Telnyx-Webhooks, fail-closed Signaturpruefung), `/api/*`, `/mcp`, `/auth/*` (OIDC Auth-Code + PKCE), `/.well-known/*`, `/healthz` UND die statischen Dashboards aus `public/` via `express.static`. Das `session`-Cookie ist `HttpOnly; Secure; SameSite=Lax; Path=/` und fliesst automatisch bei jedem `fetch("/api/...")` mit. Es gibt **nirgends** CORS-Code. Das neue Frontend loest die `express.static`-Auslieferung der Kundensicht ab — es erweitert sie nicht.

---

## 2. Architektur-Ueberblick

### 2.1 Monorepo-Layout (Frontend nach `apps/web/`, Backend unberuehrt)

Das Frontend zieht als zweites, in sich geschlossenes Paket nach `apps/web/`. Kein Eintrag aus `src/` wird verschoben, kein Build-Step beruehrt den Gateway-Code. Der Gateway laeuft weiter mit `npm install && npm start` aus dem Repo-Root.

```
/ (repo root)
  src/                      # Backend (Gateway) - UNVERAENDERT, build-frei
    server.js  web-auth.js  self-service-routes.js  billing/  store/ ...
  public/                   # Owner-/Tenant-Dashboards (bleiben vorerst am Gateway)
    index.html  tenant.html
  test/                     # Backend-Tests - unberuehrt
  render.yaml               # erweitert um zweiten Service (2.2)
  package.json              # Root: Gateway; optional Workspace-Wurzel
  apps/
    web/
      package.json          # eigenes Paket, eigene devDeps (astro), eigene Lockfile
      astro.config.mjs      # output: 'static'
      public/               # 1:1 ausgelieferte Assets (favicon, og-images)
      src/
        pages/              # dateibasiertes Routing
          index.astro       # Marketing-Landing (SSG)
          preise.astro      # Marketing (SSG)
          app/index.astro   # eingeloggte App-Shell (Insel-Host)
        layouts/            # Marketing.astro, App.astro
        components/
          marketing/        # rein praesentativ, statisch
          app/              # interaktive Inseln (Astro Islands): Auth, Calls, Billing ...
        styles/tokens/      # primitives.css + semantic.css + index.css  (Single Source, 2.5)
        lib/api.*           # duenner fetch-Wrapper (credentials:"same-origin")
```

**Dependency-Trennung.** Die Astro-Toolchain lebt ausschliesslich in `apps/web/package.json` als `devDependencies` und geraet nie in den Laufzeitpfad des Gateways (er importiert sie nicht). Empfehlung: `apps/web/` traegt eine **eigene Lockfile**. Grund ist nicht nur Sauberkeit, sondern die Deploy-Isolation (siehe R8 unten): eine gemeinsame Wurzel-Lockfile wuerde bei einem Frontend-Dependency-Bump den `paths`-Filter des Gateways treffen koennen. Die harte build-frei-Regel der CLAUDE.md gilt fuers Backend und bleibt gewahrt: `src/` wird nie transpiliert oder gebundlet; der einzige Build im Repo ist `astro build`, begrenzt auf `apps/web/`.

### 2.2 Zwei Render-Services + Deploy-Isolation via buildFilter

Heute hat `render.yaml` genau **einen** `web`-Service (`vodafone-agent`, Frankfurt, free, `autoDeploy: true`) **ohne** `buildFilter`. Das ist die gefaehrlichste Stelle des Umbaus: ein reiner Frontend-Commit wuerde den live telefonierenden Prozess neu deployen. Die Loesung sind zwei Services mit komplementaeren Filtern.

```yaml
services:
  # ---- 1) Telefonie-Gateway (bestehend, sicherheitskritisch) ----
  - type: web
    name: vodafone-agent
    region: frankfurt
    runtime: node
    plan: free
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /healthz
    autoDeploy: true
    # NEU: rein-Frontend-/rein-Doku-Commits duerfen diesen Prozess NICHT
    # neu deployen (Blast-Radius - der Prozess telefoniert live).
    buildFilter:
      ignoredPaths:
        - "apps/web/**"
        - "docs/**"
    envVars:
      # ... unveraendert ...
      # ACHTUNG: der Bestands-Kommentar "PUBLIC_URL nicht noetig" wird mit dem
      # Shared-Domain-Cutover FALSCH (siehe 2.4 / Pre-Mortem e). PUBLIC_URL wird
      # dann Pflicht (sync:false, auf die Produktdomain).

  # ---- 2) Produkt-Frontend (neu, Static Site aufs CDN) ----
  - type: web
    runtime: static            # Render-Static-Site (Syntax vor Merge verifizieren, s.u.)
    name: hermes-web
    plan: free
    autoDeploy: true
    buildCommand: npm ci && npm run build --workspace apps/web
    staticPublishPath: apps/web/dist
    buildFilter:
      paths:
        - "apps/web/**"
    routes:
      - type: rewrite          # SPA-Fallback NUR fuer den interaktiven App-Teil
        source: /app/*
        destination: /app/index.html
    headers:                   # Static-Service hat KEINE Express-securityHeaders -> selbst setzen
      - path: /*
        name: X-Frame-Options
        value: DENY
      - path: /*
        name: Content-Security-Policy
        value: "default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'"
```

**Semantik `paths` vs. `ignoredPaths`** (beide entscheiden ueber Auto-Deploys, sie loesen keine aus):

- `buildFilter.paths` (Whitelist): Service deployt **nur**, wenn der Commit mindestens eine passende Datei beruehrt. `hermes-web` baut also nur bei Aenderungen unter `apps/web/**`.
- `buildFilter.ignoredPaths` (Blacklist): Service deployt, **ausser** alle geaenderten Dateien passen ausschliesslich auf die ignorierten Muster. Der Gateway deployt also **nicht**, wenn ein Commit ausschliesslich `apps/web/**`/`docs/**` anfasst.

**Warum das die harte Isolation erfuellt.** Ein *reiner* Frontend-Commit faellt aus dem Gateway-Auto-Deploy → der telefonierende Prozess bleibt unangetastet. Symmetrisch baut das Frontend nicht bei Backend-Commits. **Wichtig:** ein *gemischter* Commit (beruehrt `src/` UND `apps/web/`) deployt **beide** Services. Die Isolation ist also Filter PLUS Commit-Hygiene — Frontend- und Backend-Aenderungen landen als getrennte Commits/PRs.

**Ehrliche Unsicherheiten zur Render-Blueprint-Syntax** (vor dem Merge gegen die aktuelle Render-Doku gegenpruefen — Render benennt Blueprint-Felder gelegentlich um):

- Static Site: heute ueblich `type: web` + `runtime: static`; aeltere Doku nutzt `env: static`; sehr alte `type: static`. Das exakte Schluesselwort ist die wahrscheinlichste Bruchstelle.
- `staticPublishPath: apps/web/dist`, weil als Workspace vom Root gebaut wird. Alternativ `rootDir: apps/web` + `staticPublishPath: dist` — genau **eine** Variante waehlen, nicht beide. Empfehlung: kein `rootDir`, Build als Workspace.
- `headers` pro Static-Service ist unterstuetzt und hier zwingend: die `securityHeaders`-Middleware (`src/middleware.js`) wirkt nur auf Gateway-Antworten; das ausgelieferte Frontend-HTML bekommt sonst gar keine CSP.
- Falls `buildFilter` nicht nachtraeglich per Blueprint auf den bestehenden Service anwendbar ist (analog zur dokumentierten Region-Einschraenkung): den Filter im Render-Dashboard am Gateway setzen; der Blueprint-Wert ist dann Doku + Schutz fuer frische Deploys. **Ein Guard-Test** (analog zum bestehenden Region-Guard) sollte `render.yaml` parsen und assertieren, dass der Gateway `apps/web/**` ignoriert UND `src/**` weiterhin deployt — sonst kippt ein spaeterer YAML-Edit den Schutz lautlos.

### 2.3 Datenfluss: Frontend -> bestehende Agent-API

Der App-Teil (`/app/*`) ist reine View-Schicht — keine Geschaeftslogik, kein Geheimnis, kein privilegierter Status. Er konsumiert exakt die Endpunkte, die heute `public/tenant.html` nutzt:

| Zweck | Aufruf | Bestand |
|---|---|---|
| Login | Link auf `/auth/login` (Server-Redirect zum IdP) | `makeWebAuthRoutes` |
| Lesen | `fetch("/api/self-service/state")` | settings, greetingTemplates, optional hasCard, calls, actionItems, calendar, agent{number,owner} |
| Schreiben | `POST /api/self-service/settings` | strenge Whitelist (2.6) |
| Billing | `POST /api/self-service/billing/setup-checkout` → Stripe-Redirect; `GET .../return` | nur Karte hinterlegen |
| Logout | `POST /auth/logout` | invalidiert Session, loescht Cookie |

**Cookie traegt automatisch.** Im same-origin-Modell (2.4) liegen Frontend und Gateway hinter derselben Domain. Das `session`-Cookie (`HttpOnly; Secure; SameSite=Lax; Path=/`) fliesst bei jedem `fetch("/api/...")` mit — exakt wie bei `tenant.html`. JS kommt wegen `HttpOnly` nie ans Cookie (kein XSS-Token-Diebstahl) und muss es auch nicht. Der einzige defensive Zusatz im fetch-Wrapper ist `credentials: "same-origin"`.

**Das Frontend ist NIE ein "vertrauter Aufrufer".** Das Backend autorisiert **jede** Anfrage selbst: `webAuth` liest das signierte Cookie, verifiziert die HMAC-Signatur timing-sicher (`verifyValue`), laedt die Session aus Postgres, prueft `invalidated_at IS NULL` und `expires_at > now()`, laedt den Account, prueft `status === "active"` und setzt erst dann `req.tenant`. Jeder Self-Service-Handler arbeitet ausschliesslich gegen `req.tenant.tenantId`. Es gibt keinen Frontend-Service-Account, kein geteiltes Secret, keine Allowlist, die das Frontend privilegiert. Genau deshalb ist die Static-Variante **ohne BFF** sicher: ein BFF waere eine neue, zu schuetzende Vertrauensstelle, die hier nicht existiert.

**OIDC-Redirect fuehrt elegant zur SPA.** Nach erfolgreichem `/auth/callback` macht der Gateway `res.redirect(302, "/")`. Im same-origin-Modell zeigt `/` auf die Static Site — der Browser landet nach Login auf der Frontend-Wurzel, jetzt mit gueltigem Cookie, und die App-Shell macht ihren ersten `fetch("/api/self-service/state")`. Kein Token-Handover, kein URL-Fragment, kein localStorage. Will man praeziser auf `/app` landen, ist das eine optionale Ein-Zeilen-Aenderung des Redirect-Ziels in `web-auth.js` — die einzige (optionale) Backend-Beruehrung des App-Teils.

### 2.4 Domain/CORS-Modell

**Empfehlung: same-origin via Pfad-Routing** (z.B. Cloudflare vor beiden Services). Aus Browser-Sicht ist alles EINE Origin:

| Pfad | Ziel | Warum |
|---|---|---|
| `/`, Marketing-Pfade, `/app/*` | Static Site (`hermes-web`) | reines CDN-Ausliefern |
| `/auth/*` | Gateway | OIDC-Flow + Cookie-Ausstellung (`makeWebAuthRoutes`) |
| `/api/*` | Gateway | gesamte REST-/Self-Service-Logik + `webAuth` |
| `/.well-known/*` | Gateway | OAuth-Metadata |
| `/voice/*` | Gateway | Twilio/Telnyx-Webhooks (fail-closed Signatur) |
| `/mcp`, `/healthz` | Gateway | MCP-HTTP, Health |

`/auth/*` und `/api/*` MUESSEN zum Gateway, weil dort und nur dort die Auth-/Geschaeftslogik liegt. Im same-origin-Modell bleibt die CSP `connect-src 'self'` (`src/middleware.js`) gueltig — **keine** Lockerung noetig, weder am Gateway noch in der neuen Frontend-CSP. Das ist der entscheidende Sicherheitsvorteil: same-origin haelt die strikteste CSP intakt, vermeidet jeglichen CORS-Code, behaelt `SameSite=Lax` als impliziten CSRF-Schutz und lebt mit dem bestehenden `res.redirect(302, "/")` ohne Aenderung.

**Caveat `/voice/*` durch Cloudflare:** die Inbound-Signaturpruefung rekonstruiert `config.publicUrl + req.originalUrl` und vergleicht den HMAC ueber den exakten URL-String. Steht Cloudflare davor, muss (a) `/voice/*` von WAF/Bot-Management/Caching ausgenommen sein (reiner Pass-Through), (b) der weitergereichte Host/Protokoll der Signatur-URL exakt entsprechen, (c) `PUBLIC_URL` auf die gemeinsame Domain zeigen. Sonst schlaegt die fail-closed-Pruefung fehl → 403 auf echte Anrufe. Details im Pre-Mortem (e) und Einwand 1.

**Cross-origin-Fallback** (nur falls getrennte Domains unvermeidbar, z.B. `app.*` + `api.*`). Dann ist same-origin gebrochen und es braucht ALLE vier Aenderungen, sonst bricht entweder Auth oder Sicherheit:

1. **CORS-Allowlist am Gateway** (heute nicht vorhanden): exakte Origin (kein Wildcard bei Credentials), `Access-Control-Allow-Credentials: true`, Preflight-Behandlung fuer mutierende Routen.
2. **Cookie `SameSite=None; Secure`** (heute `Lax`): bei `Lax` sendet der Browser das Cookie bei cross-site-`fetch` nicht mit → Dauer-401. `None` oeffnet aber cross-site-Senden generell.
3. **CSRF-Token auf mutierenden Routen** (`POST /api/self-service/settings`, Billing): `None` entfernt den impliziten Lax-CSRF-Schutz; es braucht ein explizites Double-Submit-/Header-Token.
4. **CSP `connect-src` erweitern + Redirect-Ziel aendern**: Frontend-CSP `connect-src 'self' https://api...`; `res.redirect(302, "/")` landet sonst auf der API-Origin statt der App → absolute Frontend-URL noetig.

Jede dieser vier Lockerungen ist fuer sich ein Leak-Vektor. Darum: **same-origin Pfad-Routing**, cross-origin nur als bewusst dokumentierter Notnagel.

### 2.5 Design-Token-Schicht (billig austauschbar)

Design, Farben, Schrift sind **noch unbekannt**. Wir bauen jetzt nur Struktur + Daten-Verdrahtung; die Optik muss spaeter eine Aenderung an EINER Stelle sein. Architektur: zwei Ebenen CSS-Custom-Properties in `apps/web/src/styles/tokens/`.

- **Primitive Tokens** (`primitives.css`): rohe, designgebundene Werte ohne Bedeutung — `--color-blue-600`, `--space-4`, `--font-sans`, `--radius-md`. Einzige Stelle mit konkreten Werten.
- **Semantische Tokens** (`semantic.css`): bedeutungstragende Aliase, die **nur** auf Primitives zeigen — `--color-action: var(--color-blue-600)`, `--color-surface: var(--color-gray-50)`, `--space-section: var(--space-16)`. Komponenten kennen nur diese Ebene.

Komponenten schreiben nie `#1d4ed8` und nie `var(--color-blue-600)`, sondern `color: var(--color-action)`. Damit existiert kein fixer Wert im Komponentenbaum. Ein **Lint-Gate** (stylelint gegen Hex-Literale/Magic-Pixel ausserhalb der Token-Definition) erzwingt die Disziplin — das visuelle Aequivalent zu CLAUDE.mds "keine Magic Numbers". Kommt das echte Branding, aendert man **nur** `primitives.css` (Werte) oder `semantic.css` (Zuordnung); der gesamte Komponentenbaum bleibt invariant. Ein zweites Theme (Dark/White-Label) ist ein `:root[data-theme=...]`-Block in derselben Schicht. Weil es CSS-Custom-Properties sind, ist die Token-Schicht sogar framework-unabhaengig und ueberlebt einen spaeteren Framework-Wechsel. Die heute in `tenant.html` inline lebenden Werte (Markenrot, Ink, Mute, Schatten, Inter) werden als Tokens kanonisiert.

---

## 3. Framework-Empfehlung: Astro

**Astro** ist gegen unsere Constraints die klare Wahl vor Next.js.

- **SSG-Marketing + interaktive Inseln passen exakt.** Das Produkt ist ueberwiegend statisches Marketing plus ein kleiner eingeloggter App-Teil. Astro liefert per Default **null** JavaScript und rendert zu statischem HTML; Interaktivitaet kommt punktuell als "Islands" (`client:load`/`client:visible`) genau dort, wo `/app/*` sie braucht. Minimale Bundle-Groesse fuers Marketing (SEO!), gezielte Hydration fuer die App.
- **Reiner Static-Output ohne Server passt auf "Static Site aufs CDN".** Astros `output: 'static'` produziert ein reines `dist/`, exakt fuer Renders `runtime: static` + `staticPublishPath`. Next.js' Staerken (Server Components, Route Handlers, Middleware, ISR) brauchen einen laufenden Node-Server — genau das ist hier **verboten**, weil Auth/Billing/Call-Logik schon im Backend liegen und nicht dupliziert werden duerfen. Ein Next-Route-Handler/Middleware waere de facto ein BFF, der explizit ausgeschlossen ist.
- **Kein Build-Druck aufs Backend.** Astros Build ist auf `apps/web/` begrenzt und beruehrt `src/` nie — die harte build-frei-Regel bleibt sauber gewahrt.
- **Token-Schicht reibungslos.** Astro-Komponenten sind HTML-nah mit scoped `<style>`; die CSS-Custom-Property-Tokens bindet man global ein, kein CSS-in-JS-Runtime noetig.
- **Geringere Angriffsflaeche.** Weniger ausgeliefertes JS, kein laufender Frontend-Prozess — kongruent mit "Auth bleibt an einem Ort" und der sicherheitskritischen Natur.

Next.js waere richtig, wenn das Frontend selbst serverseitige Logik/eigene API-Routen/ein BFF braeuchte — hier bewusst ausgeschlossen. Unter unseren Constraints ist **Astro** die passgenaue, risikoaermere Wahl.

---

## 4. Phasen

Reihenfolge so, dass frueh etwas Klickbares gegen die ECHTE API steht: nach dem Geruest (W0) laufen Marketing (W1) und Login (W2) parallel, sodass der Login-Roundtrip gegen `/auth/*` frueh echten Mehrwert zeigt.

### W0 — Geruest + Deploy-Isolation
- **Ziel:** Zweiter Render-Static-Service existiert, baut ein minimales `apps/web`-Astro-Geruest, deployt unabhaengig; ein Commit unter `apps/web/` loest **keinen** Gateway-Deploy aus und umgekehrt.
- **Umfang:** Monorepo-Struktur (`apps/web/` mit minimalem Astro-Setup, Platzhalter-Index, eigener Lockfile); `render.yaml` um zweiten Service + `buildFilter` auf BEIDEN Services erweitern. Static laeuft erstmal unter eigener `onrender.com`-URL.
- **NICHT enthalten:** Marketing-Inhalte, Tokens, Auth, API-Calls, Domain-Cutover, Cloudflare, jegliche Backend-Logik-Aenderung.
- **Abhaengigkeiten:** keine (Wurzel-Phase); Render-Workspace-Zugriff.
- **Definition-of-Done:** (1) Commit unter `apps/web/` deployt NUR den Static-Service, Gateway-Deploy-Log unveraendert (per `render list_deploys` beweisen). (2) Commit unter `src/` deployt NUR den Gateway. (3) Static liefert die Platzhalterseite mit HTTP 200. (4) `npm test` gruen, `node --check src/server.js` ok (Beweis: Backend unberuehrt). Guard-Test auf `render.yaml` gruen.
- **Risiken:** `buildFilter` falsch → doppelte Deploys (Gateway startet bei Frontend-Commits neu, kappt aktive Anrufe) oder gar keine. Mitigation: Filter mit Trivial-Commits beider Seiten verifizieren, BEVOR Inhalte kommen.
- **Betroffene Dateien:** `render.yaml` (geteilt), `apps/web/` (neu). **KEIN** `src/**`.
- **Parallelisierbar: nein** — fasst die von allen geteilte `render.yaml` an und legt das Geruest; muss seriell zuerst.

### W1 — Marketing-Seiten (SSG) + Token-Schicht
- **Ziel:** Landing, "So funktioniert's", Preise als statisch generierte Astro-Seiten, getragen von der zentralen Token-Schicht, die alle Folgephasen wiederverwenden.
- **Umfang:** Token-Schicht als EINE Quelle (`styles/tokens/`); Marketing-Seiten als reine SSG ohne API-Call. Preis-Tabelle als Markup (keine Stripe-Anbindung, kein Live-Plan-Fetch). CTAs verlinken nur (spaeter `/auth/login`), buchen nichts.
- **NICHT enthalten:** Login/Auth, App-Shell, jegliche `fetch()` gegen `/api/*` oder `/auth/*`, echte Abo-Buchung.
- **Abhaengigkeiten:** W0.
- **Definition-of-Done:** (1) Drei Marketing-Routen rendern statisch (HTML im Build, kein Client-Fetch), HTTP 200. (2) Alle Marken-/Stilwerte aus Tokens (grep nach Hex-Literalen findet nur `tokens.*`). (3) Build-Output zeigt keinen Runtime-API-Call auf Marketing-Seiten. (4) Gateway-Deploy-Log unveraendert.
- **Risiken:** Token-Schema friert zu frueh ein und passt nicht zur App-Sicht → Doppelpflege. Mitigation: Token-Set so schneiden, dass es die `tenant.html`-Komponenten (Karten, Buttons, Toggles, Status-Badges) bereits mit abbildet.
- **Betroffene Dateien:** `apps/web/src/styles/tokens/*`, `apps/web/src/pages/{index,so-funktionierts,preise}.astro`, `layouts/Marketing.astro`. **KEIN** `render.yaml`, **kein** `src/**`.
- **Parallelisierbar: ja** (mit W2) — DISJUNKT, solange `tokens.*` Eigentum von W1 bleibt und W2 sie nur liest. W2 besitzt `components/app/`, `layouts/App.astro`, `lib/api.*`; W1 besitzt `pages/*.astro` + `tokens.*`. Konfliktpunkt waere allein `tokens.*` — daher die Eigentumsregel.

### W2 — Auth/Login gegen `/auth/*` (frueh klickbar)
- **Ziel:** Echter Login-Roundtrip aus dem neuen Frontend: Login-Button → OIDC ueber den Gateway → Session-Cookie → eingeloggter Zustand mit geschuetzter App-Shell; Logout invalidiert. Erste Phase mit echtem Mehrwert gegen die Bestands-API.
- **Umfang:** same-origin-Pfad-Routing funktional einfuehren (Cloudflare/Proxy: `/auth/*` + `/api/*` → Gateway, Rest → Static, EINE Origin); Auth-Insel (Astro Island): "Anmelden" → `/auth/login`, "Abmelden" → `POST /auth/logout`; Auth-Zustand via `fetch("/api/self-service/state")` (401 → Login, 403 → "wartet auf Freigabe", 200 → App-Shell); leere geschuetzte App-Shell (Header/Karten-Layout aus Tokens), die W4 fuellt.
- **NICHT enthalten:** Anruf-/Item-/Kalender-Rendering (W4), Billing-UI (W3), Settings-Editor (W5), Produktions-Domain-Cutover/DNS (W5). **Keine** Reimplementierung von OIDC/PKCE/Session — lebt im Gateway.
- **Abhaengigkeiten:** W0; **same-origin Pfad-Routing** (ohne das traegt das Cookie nicht); Gateway-Env in Staging: `SESSION_SECRET` + `STORE_BACKEND=pg` + `MULTI_TENANT=true` + `SELF_SERVICE_ENABLED=true` (sonst sind die Routen 404 — verifiziert in `server.js`). Das ist Env-Konfiguration, KEIN Code.
- **Definition-of-Done:** (1) "Anmelden" fuehrt durch den echten IdP und landet same-origin mit gesetztem `session`-Cookie (HttpOnly, in DevTools sichtbar). (2) Eingeloggt liefert `fetch("/api/self-service/state")` 200, Cookie automatisch (kein Authorization-Header). (3) 401/403/Logout-Zustaende reproduzierbar. (4) Kein Auth-/Session-Code im Frontend (grep: kein `pkce`, `jwtVerify`, Token-Handling in `apps/web/`).
- **Risiken (zentral):** Cookie traegt nicht / CORS-Bruch, falls doch zwei Origins → Dauer-401; der Reflex waere, das Backend auf `SameSite=None`/CORS umzubauen — das WEICHT die Sicherheit auf (CLAUDE.md Regel 3). **Entscheidung:** same-origin ist nicht verhandelbar; cross-origin wird NICHT durch Cookie-Lockerung gefixt — dann blockiert W2, statt das Backend aufzuweichen. Zweitens Redirect-Ziel: `config.publicUrl` muss die gemeinsame Origin sein, sonst landet der Nutzer auf der alten `index.html`.
- **Betroffene Dateien:** `apps/web/src/components/app/AuthIsland.*`, `layouts/App.astro`, `lib/api.*`, Pfad-Routing-Konfig. **KEINE** Bearbeitung von `src/web-auth.js`/`server.js` (nur Env/Routing). `tokens.*` nur lesen.
- **Parallelisierbar: ja** (mit W1, Eigentumsregel). **Nein** mit W3/W4, die auf der App-Shell aufsetzen.

### W3 — Billing gegen `/api/self-service/billing/*` (NUR Karte hinterlegen)
- **Ziel:** Im eingeloggten Bereich eine Zahlungsmethode via Stripe Checkout hinterlegen und den Karten-Status sehen — exakt der heute existierende Umfang.
- **Umfang (was API-seitig HEUTE existiert):** Billing-Block analog `tenant.html`, sichtbar NUR wenn `state.hasCard` ein Boolean ist (also `PAYMENT_ENABLED` an; sonst versteckt, byte-identisch zum Bestand). "Zahlungsmethode hinzufuegen" → `POST /api/self-service/billing/setup-checkout` → Redirect zur Stripe-URL; Rueckkehr ueber `?card=ok|canceled` → kurze Rueckmeldung; Karten-Status aus `state.hasCard`.
- **NICHT enthalten / EHRLICHE ABGRENZUNG (Backend-Luecke, NICHT als Frontend gebaut):** Abo buchen/kuendigen/upgraden/downgraden, Plan-/Tier-Wechsel, Rechnungssicht — **existieren API-seitig HEUTE NICHT.** Verifiziert: `BillingPort` (`src/billing/ports.js`) + `stripe.js` decken Hold/Capture/Cancel (Nummern-Provisioning), Metering und Karten-Setup ab. Es gibt **keine** Stripe-Subscriptions-Nutzung, **keine** Subscribe-Routen, **kein** Plan-Modell im Store-View. Diese Operationen sind **offene Backend-Arbeit** (Abhaengigkeit, siehe 6), kein Frontend-Task dieser Welle. Das Frontend darf nichts Nicht-Existentes aufrufen.
- **Abhaengigkeiten:** W2 (App-Shell + Auth + same-origin Cookie); `PAYMENT_ENABLED=true` + Stripe-Keys in Staging. Fuer alles ueber Karte hinaus: separate Backend-Phase (Subscriptions) MUSS vorher existieren.
- **Definition-of-Done:** (1) Mit `PAYMENT_ENABLED` an + Session: "Hinzufuegen" startet eine echte Checkout-Session, `?card=ok` zeigt "Karte hinterlegt", `state.hasCard` flippt auf true. (2) Mit `PAYMENT_ENABLED` aus: Block unsichtbar. (3) Frontend enthaelt KEINE Aufrufe auf nicht-existente Abo-Endpunkte (grep: kein `subscribe`/`cancel-subscription`/`upgrade` gegen `/api/...`).
- **Risiken:** Versuchung, "Abo buchen" zu mocken → toter Pfad gegen 404 (CLAUDE.md Regel 6, kein toter Code). Pre-Mortem: eine UI, die "kuendigen" anbietet aber 404 bekommt, ist ein Vertrauensrisiko (Kunde glaubt gekuendigt, ist es nicht). Mitigation: harte Grenze — nur Karte hinterlegen.
- **Betroffene Dateien:** `apps/web/src/components/app/BillingIsland.*`, nutzt `lib/api.*`. **KEIN** `src/**`.
- **Parallelisierbar: ja** mit W4 (disjunkte Insel-Dateien, beide nur lesend auf `lib/api.*` + Shell-Slots), **nachdem** W2 gemerged ist; **nein** gegenueber W2.

### W4 — Anruf-Verlauf + Zusammenfassungen + Kalender gegen `/api/self-service/state` (read-only)
- **Ziel:** Die geschuetzte App-Shell zeigt echte Tenant-Daten: Anrufliste, Action Items, anstehende Termine, Agent-Rufnummer — read-only aus dem bestehenden State.
- **Umfang:** Datensicht-Inseln, die `GET /api/self-service/state` lesen und rendern: `calls` (Richtung, Gegenstelle, `goal`, Status-Badge active/completed/cancelled/failed), `actionItems` (mit `appointment`-Tag), `calendar` (`upcomingCalendar`), `agent.number` + Live-Dot. Direkte Uebernahme der Render-Logik aus `tenant.html` als Astro-Inseln mit W1-Tokens. **HTML-Escaping** (`esc()` im Bestand — XSS-Schutz fuer Tenant-Strings) muss erhalten bleiben.
- **NICHT enthalten:** Schreibaktionen auf Calls/Items/Kalender (API-seitig nicht vorhanden — read-only), Settings-Editor (W5), Billing (W3).
- **Abhaengigkeiten:** W2 (Auth + App-Shell + same-origin); Tokens aus W1.
- **Definition-of-Done:** (1) Eingeloggt zeigt die App echte `calls/actionItems/calendar/agent.number`; leere Listen → Empty-States. (2) Tenant-Strings escaped (Test mit `<`/`"`). (3) 401 waehrend der Sitzung → zurueck in den Login-Zustand, Datencontainer geleert (kein stale-Daten-Leck). (4) read-only: keine POST/PUT/DELETE gegen Calls/Items/Kalender.
- **Risiken:** Datenleck/stale-Tenant bei fehlerhaftem Auth-Handling → bei jedem Non-200 den Container leeren (Bestandsverhalten). Polling zu aggressiv → unnoetige Gateway-/DB-Last (free plan) → kein oder langsames Intervall.
- **Betroffene Dateien:** `apps/web/src/components/app/{CallsIsland,ActionItemsIsland,CalendarIsland,AgentChip}.*`, `lib/api.*` (lesend). **KEIN** `src/**`.
- **Parallelisierbar: ja** mit W3 (disjunkte Inseln; Bedingung: keine der beiden editiert `layouts/App.astro` gleichzeitig — die Shell-Slots werden in W2 fest definiert, W3/W4 haengen nur eigene Komponenten in vorhandene Slots).

### W5 — Domain-Cutover + Settings-Editor + Politur
- **Ziel:** Produktions-Domain endgueltig auf das neue Frontend (eine Domain: `/` → Static, `/api/*` + `/auth/*` → Gateway), Abloesung der Kundensicht-Auslieferung, plus der einzige existierende Schreibpfad (Settings) als Editor und Schliff.
- **Umfang:** **Domain-Cutover** (Cloudflare-Pfad-Routing produktiv; `PUBLIC_URL`/`redirectUri` auf finale Origin; IdP-Redirect-URI additiv migriert); **Settings-Editor** (`POST /api/self-service/settings` mit der bekannten engen Whitelist — UI bietet AUSSCHLIESSLICH diese Felder an, Server filtert ohnehin via `selfServicePatch`); Politur (Fehlerzustaende, Empty-States, Responsiv, A11y, Lighthouse).
- **NICHT enthalten:** Abo-Lifecycle-UI (haengt an der Backend-Phase), Owner-Admin-Dashboard, neue Settings-Felder ueber die Whitelist hinaus.
- **Abhaengigkeiten:** W2, W4, W1; DNS/Cloudflare- + Gateway-Env-Zugriff.
- **Definition-of-Done:** (1) Unter finaler Domain: `/` liefert die Astro-App, `/api/*` + `/auth/*` erreichen den Gateway, Cookie traegt, Login + alle W3/W4-Sichten funktionieren end-to-end same-origin. (2) Settings-Speichern: erlaubte Felder uebernommen (`changed`), abgelehnte serverseitig verworfen (`rejected`), UI zeigt "Gespeichert" + re-fetcht; restriktiverer Permission-Toggle greift; Freitext-Greeting ist gar nicht erst anbietbar. (3) Gateway-`/healthz` waehrend des Cutovers durchgehend gruen (kein Telefonie-Ausfall).
- **Risiken:** `redirectUri`-Mismatch beim IdP nach Domainwechsel = Login-Totalausfall fuer alle Kunden; same-origin bricht → Dauer-401. Mitigation: IdP-Redirect-URIs additiv VOR dem DNS-Flip eintragen, Cutover im Wartungsfenster, DNS-Rollback bereit. Siehe Pre-Mortem (e) zum `PUBLIC_URL`-Risiko (Twilio-Signatur!). Settings-Risiko: UI bietet versehentlich ein nicht-restriktives Toggle → die Server-Whitelist ist die letzte Verteidigung (kein Vertrauen auf die UI).
- **Betroffene Dateien:** Cloudflare/DNS-Konfig, Gateway-Env (`PUBLIC_URL`, externe IdP-`redirect_uri`), `apps/web/src/components/app/SettingsIsland.*`, ggf. `render.yaml` (finaler Domain-Block). Backend-Code wahrscheinlich unberuehrt (`res.redirect(302, "/")` ist bereits "/").
- **Parallelisierbar: nein** fuer den Cutover (global wirksam: Gateway-Env/DNS, evtl. `render.yaml`). Der Settings-Editor koennte als eigene Insel theoretisch parallel laufen, wird aber bewusst hinter den Cutover gelegt, weil sein Schreibpfad das vollstaendige same-origin-Cookie-Verhalten voraussetzt.

### Parallelisierungs-Karte (disjunkte Datei-Mengen)

| Phase | Schreibt | Liest nur | Parallel mit |
|---|---|---|---|
| W0 | `render.yaml`, `apps/web/`-Geruest | — | nein (Wurzel) |
| W1 | `pages/*.astro`, `styles/tokens/*`, `layouts/Marketing.astro` | — | W2 |
| W2 | `components/app/AuthIsland.*`, `layouts/App.astro`, `lib/api.*`, Routing | `tokens.*` | W1 |
| W3 | `components/app/BillingIsland.*` | `lib/api.*`, `tokens.*`, Shell-Slots | W4 |
| W4 | `components/app/{Calls,ActionItems,Calendar,AgentChip}.*` | `lib/api.*`, `tokens.*`, Shell-Slots | W3 |
| W5 | `SettingsIsland.*`, Cloudflare/DNS/Gateway-Env, ggf. `render.yaml` | alles | nein (Cutover global) |

Serialisierende Konfliktdateien: `render.yaml` (W0, W5) und `layouts/App.astro` (in W2 final geschnitten, danach von W3/W4 nur als Slot-Konsument genutzt). `lib/api.*` (W2) und `tokens.*` (W1) sind Single-Owner und werden danach nur gelesen — das ist die Bedingung der Parallel-Aussagen.

---

## 5. Was bewusst spaeter kommt

- **Finales Design/Branding, Marketing-Texte, Bilder, Pixel-Feinschliff.** Wir bauen jetzt nur Struktur + Daten-Verdrahtung. Die Token-Schicht (2.5) macht den spaeteren Optik-Wechsel zu einer Aenderung an EINER Stelle — die Struktur blockiert das nicht.
- **Abo-/Subscription-Lifecycle** (buchen/kuendigen/upgraden/downgraden, Plan-/Tier-Modell, Rechnungssicht). Existiert API-seitig nicht; ist offene Backend-Arbeit (siehe 6), keine Frontend-Phase. W3 bleibt strikt auf "Karte hinterlegen".
- **Owner-/Admin-Dashboard** (`public/index.html`) ist nicht Teil des Produkt-Frontends und bleibt am Gateway.
- **Produktions-Domain-Cutover** ist bewusst die letzte Phase (W5), damit alle Sichten vorher gegen die echte API verifiziert sind, bevor der riskante `PUBLIC_URL`-Flip ansteht.

---

## 6. Offene Fragen / Owner-Entscheidungen

Vor W2 (Login) zu klaeren:
- **Produktdomain + Cloudflare-Pfad-Routing.** Welche Domain? Steht Cloudflare (oder ein anderer Reverse-Proxy) als Routing-Layer bereit? Ohne same-origin traegt das Cookie nicht.
- **Staging-Gateway mit Feature-Flags an.** `SESSION_SECRET` + `STORE_BACKEND=pg` + `MULTI_TENANT=true` + `SELF_SERVICE_ENABLED=true` (+ IdP/WorkOS-Client) muessen in einer Test-Instanz gesetzt sein.

Vor W3 (Billing) zu klaeren:
- **Abo-Modell + Backend-Phase.** Soll es echte Abos (Stripe Subscriptions) geben? Falls ja, ist eine eigene Backend-Phase (Subscriptions am `BillingPort` + `stripe.js`, neue `/api/self-service/billing/*`-Routen, Plan-Feld in `exportTenantData`/Store-View) Voraussetzung. Das Frontend wartet darauf.

Vor W5 (Cutover) zu klaeren:
- **`PUBLIC_URL`-Cutover-Plan.** Wer fuehrt den gestaffelten Flip aus (IdP-Redirect-URI additiv, Twilio-Test-Nummer zuerst, Signaturtest gegen die neue URL)? Wartungsfenster? Rollback-Pfad? Siehe Pre-Mortem (e).
- **Der `render.yaml`-Kommentar "PUBLIC_URL nicht noetig"** (Zeile 164) wird mit dem Shared-Domain-Modell falsch und MUSS im Cutover-PR korrigiert werden (Einwand 3).
- **Verbleib der alten `public/tenant.html`.** Wird sie nach dem Cutover entfernt oder als Fallback gehalten? (Owner-`index.html` bleibt.)

---

## 7. Pre-Mortem (Pflicht)

Ein Jahr spaeter, der Bau ist gescheitert. Die wahrscheinlichsten Fehlschlaege — und wie die Strategie sie mechanisch verhindert.

**a) Ein Frontend-Deploy hat den live telefonierenden Gateway umgeworfen.** *Ursache:* `render.yaml` hat heute EINEN Service mit `autoDeploy: true` ohne `buildFilter`. Ein CSS-Commit triggert einen Gateway-Deploy; der alte Container wird mitten im Gather/STT-Zyklus SIGTERMed (free plan, ein Replica, kein Blue/Green), der naechste `/voice/*`-Webhook trifft auf einen noch nicht `/healthz`-gruenen Container → Anruf bricht mit einem echten Menschen ab. Schlaegt der Build fehl (Frontend-Dep in der Wurzel-Lockfile), bleibt der Gateway unten. *Verhindert durch:* getrennter Static-Service + `buildFilter` auf beiden (`ignoredPaths: [apps/web/**, docs/**]` am Gateway, `paths: [apps/web/**]` am Frontend). *Bewiesen durch:* `render list_deploys`-Diff (Frontend-Commit erzeugt KEINEN Gateway-Deploy; Gegenprobe: `src/`-Commit MUSS deployen, sonst wuerden Security-Fixes nie ausgerollt) + Guard-Test auf `render.yaml`. *Falle:* eine gemeinsame Wurzel-Lockfile (R8) — daher eigene Lockfile unter `apps/web/`.

**b) Cross-origin-Auth-Fehlkonfiguration hat Sessions/Daten exponiert.** *Ursache (im Parallel-Universum ohne same-origin):* Frontend `app.*`, API `api.*`. Damit das Cookie cross-origin traegt, musste jemand `SameSite=None` setzen (heute korrekt `Lax`) — was den impliziten CSRF-Schutz entfernt, und es gibt nirgends CSRF-Token. Plus CORS mit `credentials: true`; ein Allowlist-Tippfehler (Wildcard-Subdomain oder Origin-Echo) reicht, damit eine fremde Seite mit dem Opfer-Cookie `/api/self-service/state` liest → Transkripte/Kalender leaken. Plus CSP `connect-src` musste geoeffnet werden. *Verhindert durch:* same-origin Pfad-Routing → alles EINE Origin → Cookie bleibt `SameSite=Lax`, KEIN CORS (man kann nicht falsch konfigurieren, was nicht existiert), `connect-src 'self'` bleibt korrekt. **Wichtig:** der Static-Service muss die Sicherheits-Header (CSP, X-Frame-Options, Referrer-Policy) SELBST setzen — `securityHeaders` wirkt nur auf Gateway-Antworten.

**c) Frontend und API-Datenmodell sind auseinandergedriftet.** *Ursache:* Das Frontend rendert `state.subscription.plan` und ruft `POST /api/billing/subscribe` — beides existiert nicht (`/api/self-service/state` liefert verifiziert nur settings/greetingTemplates/[hasCard]/calls/actionItems/calendar/agent). Ergebnis: leere Bloecke, 404-Buttons, kaputtes Dashboard. *Verhindert durch:* Monorepo + EIN-Commit — API-Aenderung und Frontend-Anpassung im selben PR; ein **Contract-Test** (im bestehenden `node:test`-Stil, Server als Kindprozess / `self-service-routes` per pglite) validiert die echte `/api/self-service/state`-Antwort gegen eine versionierte Schema-Definition. Driftet die API, wird der Test im selben PR rot — Drift kann nicht ueber eine Deploy-Grenze schleichen. Das Frontend bleibt duenner Client und nimmt nichts an, was nicht im Contract steht.

**d) Das Design liess sich nicht billig austauschen.** *Ursache:* Tokens existierten, waren aber nicht verpflichtend; Komponenten hartkodierten `#0a84ff`, `padding: 14px` inline (so lebt das heutige `index.html`). Beim Rebrand musste jede Komponente einzeln angefasst werden. *Verhindert durch:* Tokens als einzige Quelle (CSS-Custom-Properties) + ein **Lint-Gate** (stylelint gegen Hex-Literale/Magic-Pixel ausserhalb der Token-Definition), das im CI rot wird — eingerichtet, BEVOR die erste echte Seite gebaut wird, sonst sammelt sich Schuld an, die nie zurueckgezahlt wird.

**e) Der `PUBLIC_URL`-Cutover hat OIDC + Stripe + Twilio-Signatur GLEICHZEITIG gebrochen — echte Anrufe gingen auf 403.** *Das gefaehrlichste Szenario, mechanisch verifiziert.* `config.publicUrl` (gespeist aus `PUBLIC_URL || RENDER_EXTERNAL_URL`) steuert DREI externe Vertraege auf einmal: (1) **Twilio-Inbound-Signatur** `config.publicUrl + req.originalUrl` → `twilio.validateRequest`, fail-closed (ohne publicUrl `false`, bei falschem Host HMAC-Mismatch → `403 invalid inbound signature` auf JEDEN eingehenden Anruf — der Agent ist blind, und das ist "korrektes" fail-closed-Verhalten; nur die Config luegt); (2) **OIDC-redirectUri** `config.publicUrl + "/auth/callback"` → bei IdP-Mismatch kann sich niemand einloggen; (3) **Stripe-Return-URLs** → Karte wird nie gebunden. Same-origin ERZWINGT, `PUBLIC_URL` explizit auf die geteilte Domain zu setzen (der `render.yaml`-Kommentar "nicht noetig" gilt dann NICHT mehr — `RENDER_EXTERNAL_URL` zeigt auf `*.onrender.com`). *Verhindert durch gestaffelten, bewiesenen Cutover, Telefonie zuletzt:* (i) Cloudflare-Routing einrichten, `PUBLIC_URL` noch unveraendert; (ii) neue `/auth/callback`-Redirect-URI beim IdP ADDITIV registrieren (alt + neu gleichzeitig); (iii) Signatur-Pfad gegen die NEUE URL testen, ohne echten Anruf (Test bildet mit echtem `TWILIO_AUTH_TOKEN` eine Signatur ueber die neue URL und bekommt `verifyInboundSignature` gruen) BEVOR die Twilio-Konsole umgestellt wird; (iv) zuerst eine Test-Nummer auf neue URL + neues `PUBLIC_URL` (Staging-Gateway), echter Test-Anruf gruen → dann erst die Produktionsnummer. Niemals die produktive Nummer als ersten Versuch. Der Boot-Guard faengt nur "PUBLIC_URL leer", NICHT "gesetzt aber falscher Host" — dagegen hilft nur der Signaturtest.

**f) Secret-/Tenant-Datenleck uebers Frontend.** *Ursachen:* ein `STRIPE_SECRET_KEY`/`OIDC_CLIENT_SECRET`/`DATABASE_URL` landet im Static-Build (Astro-Env ohne `PUBLIC_`-Disziplin, oder `.env` ins Build-Verzeichnis kopiert) → oeffentlich und CDN-gecacht; ein Transkript landet im CDN-Cache (ueber einen Static-/Edge-Pfad statt `/api/*`); ein Token landet in `localStorage` (statt HttpOnly-Cookie) → XSS-erreichbar. *Verhindert durch:* "keine Secrets im Frontend" (CLAUDE.md Regel 4/5) — nur `PUBLIC_`-praefixierte Env erreicht den Client-Bundle, alles andere ist build-only und darf kein Secret sein; Secret-Scan ueber `apps/web/dist` im CI. `no-store` fuer alle `/api/*`-Antworten (`middleware.js`) — Transkripte kommen ausschliesslich ueber `/api/*` und sind nie cachebar; Cloudflare muss `/api/*` als Cache-Bypass behandeln (R6). HttpOnly-Cookie statt localStorage — der duenne Client braucht kein Token im JS-Zugriff. Die `publicCall`/`exportTenantData`-Filtergrenze (kein `streamToken`/`cus_`/`pm_`-Leak) bleibt; das Frontend bekommt nie eine rohe Store-Sicht.

---

## 8. Restrisiko-Tabelle

| # | Risiko | Schweregrad | Gegenmassnahme |
|---|--------|-------------|----------------|
| R1 | `PUBLIC_URL`-Flip mit falschem Host → Twilio-Signatur 403 auf ALLE Inbound-Anrufe | **Kritisch** | Staging-Signaturtest gegen neue URL VOR Konsolen-Umstellung; Test-Nummer zuerst; Boot-Guard faengt nur "leer" |
| R2 | `buildFilter` fehlt/zu locker → Frontend-Commit redeployt Gateway, kappt aktive Anrufe | **Kritisch** | `ignoredPaths`/`paths` auf beiden Services + Guard-Test; Beweis via `list_deploys`-Diff |
| R3 | Secret im Static-Build (Stripe/DB/OIDC im CDN) | **Kritisch** | `PUBLIC_`-Disziplin, Secret-Scan ueber `dist` im CI, getrennte Env-Grenze |
| R4 | Static-Service liefert HTML ohne CSP/X-Frame-Options | Hoch | Static-Service setzt Header selbst; CSP-Smoke-Test gegen die ausgelieferte Seite |
| R5 | API↔Frontend-Drift (nicht-existente Felder/Endpunkte) | Hoch | geteilter Contract + Contract-Test im selben PR; Frontend bleibt duenner Client |
| R6 | Cloudflare cached `/api/*` → `no-store` umgangen, Transkript-Leak | Hoch | Cache-Bypass fuer `/api/*` + `/auth/*` + `/voice/*`; nur `/` cachebar |
| R7 | IdP-Redirect-URI nicht additiv migriert → Login-Totalausfall im Cutover-Fenster | Mittel | alte + neue URI gleichzeitig registrieren, alte erst nach Verifikation entfernen |
| R8 | Wurzel-Lockfile zieht Frontend-Dep-Bump in den Gateway-`paths`-Filter | Mittel | eigene Lockfile unter `apps/web/` |
| R9 | Design-Token-Erosion (hartkodierte Werte) | Niedrig-Mittel | stylelint-Gate, VOR der ersten Seite |
| R10 | Cloudflare als neue SPOF-/Vertrauensschicht vor der Telefonie | Mittel | Routing versioniert + getestet; `/voice/*` von WAF/Bot/Cache ausgenommen; Monitoring auf 403/5xx-Rate an `/voice/*` |

---

## 9. Sicherheits-Leitplanken fuer JEDE Phase

In jeder Phase, ausnahmslos:

1. **Kein Gateway-Redeploy durch Frontend-Arbeit.** Vor Merge: hat der Commit `src/**`/Wurzel-Deps beruehrt? Wenn nein, MUSS der Gateway-Deploy ausbleiben (per `list_deploys` verifizierbar). `buildFilter`-Guard-Test gruen.
2. **Fail-closed bleibt fail-closed.** Kein Pfad fasst die Signaturpruefung, `webAuth`, `adminOnly` oder den 401/403-Default an. `SKIP_TWILIO_SIGNATURE_CHECK` bleibt in Produktion aus.
3. **Keine Safety-Gate-Beruehrung.** Allowlist/Land-Gate/Stundenlimit/Budget/Max-Dauer/Provider-Signatur werden vom Frontend nur ANGEZEIGT, nie umgangen oder per neuem Endpunkt dupliziert.
4. **Keine Secrets im Frontend.** Nur `PUBLIC_`-Env im Client-Bundle; Secret-Scan ueber `dist`. Stripe-Key/DB/Tokens bleiben Backend.
5. **Tenant-Isolation (RLS) unangetastet.** Frontend liest nur ueber session-gebundene `/api/self-service/*`-Routen (`req.tenant`); `publicCall`/`exportTenantData`-Filtergrenze bleibt.
6. **Cookie-Modell unveraendert.** `HttpOnly; Secure; SameSite=Lax; Path=/`. Kein `SameSite=None`, kein CORS, kein Auth-Material in `localStorage`.
7. **Sicherheits-Header auch am Static-Service.** CSP (`connect-src 'self'`, `frame-ancestors 'none'`), X-Frame-Options DENY, Referrer-Policy no-referrer, no-store fuer sensible Pfade.
8. **`PUBLIC_URL` nur gestaffelt und bewiesen aendern.** Nie blind flippen; Signaturtest gegen die neue URL VOR jeder Konsolen-/Routing-Aenderung; Telefonie zuletzt; Test-Nummer vor Produktionsnummer.
9. **Contract-Test im selben PR.** Jede API-Form-Aenderung kommt mit Frontend-Anpassung und Contract-Test in EINEM Commit.
10. **Neues Verhalten braucht einen Test** (CLAUDE.md). Auth-/Routing-/Signatur-Pfade lassen sich ohne echten Anruf reproduzieren — Pflicht, nicht Kuer.

---

## 10. Einwaende (gegen die festen Entscheidungen — begruendet, Strategie baut trotzdem darauf auf)

**Einwand 1 — Cloudflare-Pfad-Routing macht Cloudflare zum SPOF VOR der Telefonie.** Heute spricht Twilio direkt mit Render. Ein Routing-Layer davor laesst `/voice/*` durch eine NEUE Schicht laufen, deren Fehlkonfiguration (falsche Route, aggressive Bot-/WAF-Regel auf POST-Webhooks, TLS-/Host-Eigenheit, die die Signatur-URL veraendert) die Telefonie kappt — und nach "Twilio-Problem" aussieht, obwohl es das Routing ist. Besonders heikel: aendert Cloudflare Host/Protokoll im weitergereichten Request, passt die rekonstruierte Signatur-URL nicht mehr → 403. *Trotzdem darauf gebaut, WENN:* (a) `/voice/*` von WAF/Bot/Caching ausgenommen ist (Pass-Through), (b) die Signatur-URL explizit gegen die Cloudflare-weitergereichte URL getestet ist, (c) Monitoring die 403/5xx-Rate an `/voice/*` ueberwacht. Die same-origin-Vorteile fuer Auth (Pre-Mortem b) ueberwiegen — aber `/voice/*` ist der teuerste Pfad durch eine neue Schicht und verdient den schaerfsten Test.

**Einwand 2 — same-origin via Proxy fuehrt eine versteckte Kopplung wieder ein, die die Service-Trennung gerade aufloesen sollte.** Wir trennen die Render-Services (gut, Pre-Mortem a), kleben sie aber per Cloudflare-Pfad zu EINER Origin zusammen. *Trotzdem darauf gebaut:* die Kopplung ist gewollt und auf den Browser-Origin-Vorteil begrenzt; sie ist deklarativ (Routing-Regeln, versionierbar, testbar) statt prozessual (geteilter Container). Bedingung: die Routing-Regeln gehoeren in Versionskontrolle und unter denselben Guard-Test-Anspruch wie `render.yaml` — sonst ist es eine unsichtbare, ungetestete Konfiguration vor einem sicherheitskritischen System.

**Einwand 3 — der `render.yaml`-Kommentar "PUBLIC_URL nicht noetig" (Zeile 164) wird zur Falle.** Die feste Entscheidung (shared domain) macht genau diesen Kommentar FALSCH, aber er steht noch da und suggeriert dem naechsten Bearbeiter, `PUBLIC_URL` nicht zu setzen — die wahrscheinlichste Praxis-Ursache fuer Pre-Mortem (e). *Konsequenz:* im selben PR, der den Cutover macht, MUSS dieser Kommentar korrigiert und `PUBLIC_URL` explizit als Pflicht (sync:false, Produktdomain) in `render.yaml` aufgenommen werden. Ein veralteter Kommentar ist hier kein Schoenheitsfehler, sondern ein direkter Pfad zu "403 auf alle Anrufe".

Zusammengefasst: Die festen Entscheidungen sind tragfaehig. Die zwei Stellen, an denen sie scheitern koennen, haengen beide an EINER Variable und EINER neuen Schicht — `PUBLIC_URL` (drei externe Vertraege gleichzeitig) und Cloudflare vor `/voice/*`. Beide sind nicht durch mehr Code zu sichern, sondern durch gestaffelten, bewiesenen Cutover und einen Signaturtest gegen die exakte neue URL, bevor die produktive Telefonie umgestellt wird.
