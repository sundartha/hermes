# P1 — Single-Origin-Unifizierung: Implementierungs-Spec

Read-only erkundet gegen den echten Code. Ziellinie: lokal gruen im Test-Mode (Chrome-e2e).
Track-B (Prod-Domain / OIDC-Redirect-URIs / render.yaml) bleibt DRAUSSEN. Owner-Defaults verriegelt:
**tenant.html -> Redirect auf /app** (nicht loeschen); **No-Abo-Hinweis bleibt Phase 2** (P1 = nur Unifizierung).

## Leitprinzip (HART)
Das gesamte neue Verhalten haengt an EINEM Pfad-Flag `WEB_DIST_DIR` (leer = AUS). AUS -> exakt heutiges
Verhalten, byte-identisch (bestehende Tests wie `root-redirect.test.js` bleiben gruen). GESETZT -> unified
Serving. Fail-closed, gleiches Muster wie `MULTI_TENANT`/`PAYMENT_ENABLED`/`mcpUiEnabled`. **render.yaml NICHT
anfassen, apps/web NICHT veraendern (kein Code-Delta dort).**

## Fakten (Belege aus der Erkundung)
- apps/web baut via `astro build` (`output:"static"`) nach `apps/web/dist/`. Erzeugt Marketing (`/`, `/preise`,
  `/registrieren`, `/so-funktionierts`, `/agb`, `/datenschutz`, `/impressum`, `404.html`) + App (`/app` = `app/index.html`)
  + Assets (`/_astro/*`, `/assets/*`, `/favicon.svg`, `/robots.txt`, `/sitemap.xml`).
- Build-Pflicht-Env: `apps/web/src/lib/routes.js:17-25` liest `PUBLIC_GATEWAY_URL` (wirft fail-closed wenn leer);
  `LOGIN_URL = ${PUBLIC_GATEWAY_URL}/auth/login`. Lokal auf den Gateway-Origin zeigen lassen (= same-origin).
- API-Calls von apps/web: `apps/web/src/lib/api.js:44-54` nutzt RELATIVE Pfade + `credentials:"same-origin"`,
  HttpOnly-Session-Cookie. Same-origin heilt das ohne Code-Aenderung.
- Dashboard `apps/web/src/pages/app/index.astro`: zeigt bereits `CallsIsland` (Anrufverlauf) + `AgentChip`
  (zugeordnete Nummer aus `data.agent.number`), Daten aus `GET /api/self-service/state` (`webAuthMw`, active-only).
  -> P1 braucht KEINEN Dashboard-UI-Code.
- Gateway-Middleware-Reihenfolge `src/server.js`: oeffentlich `/healthz` (:160), `/api/plans` (:168),
  `/.well-known/*` (:170); `GET "/" -> 302 /auth/login` (:176); Web-Login-Block im `guardedBoot` (:182-305:
  `/auth/*` :207, `/api/portal` :229, Admin :243, `/api/self-service/*` :253-266, `/webhooks/stripe` :275);
  **Basic-Auth Catch-all :307-336** (no-op ohne `dashboardPassword`; exempt: `/tenant.html` wenn
  selfService&multiTenant :315, `/voice`, `/mcp`, `/.well-known`, `/webhooks/stripe`, `/healthz`, localhost);
  `express.static(publicDir=public/)` :337 (nur tenant.html); danach Basic-Auth-geschuetzt: `/voice/*`,
  Owner-Legacy-API (`/api/calls`,`/api/settings`,`/api/billing/*`,`/api/onboard`,Profile), `/mcp`.
- OIDC-Login: `/auth/login` -> WorkOS; `/auth/callback` (`web-auth.js:124`) -> `sessions.create` -> Cookie
  (`cookieAttrs`, immer `Secure`, `SameSite=Lax`, :62) -> Redirect `postLoginPath`. `postLoginPath` =
  `CUSTOMER_PORTAL_PATH` (/tenant.html) wenn selfService&multiTenant (`server.js:220-221`), sonst `/`.
- Basic-Auth existiert nach Owner-Removal WEITER (:307) und schuetzt jetzt v.a. die Owner-Legacy-API.
  -> apps/web MUSS VOR diese Schicht gemountet werden, sonst verlangt die Marketing-Site das Admin-Passwort.

## Design (datei-fuer-datei)

### src/config.js
- `webDistDir: process.env.WEB_DIST_DIR || ""` (neben `publicDir`, ~:346).
- `devLoginEnabled: process.env.DEV_LOGIN_ENABLED === "true" && !process.env.RENDER_EXTERNAL_URL` (neben
  `selfServiceEnabled`, ~:239). Doppelt fail-closed: explizites Opt-in UND nicht auf Render.
- In `productionFootguns()` (:368): wenn `isProduction && process.env.DEV_LOGIN_ENABLED === "true"` -> einen
  FATAL-Eintrag pushen -> Boot wird verweigert (:427). Zweite, unabhaengige Sperre.
- Optionaler Boot-Hinweis/Guard: `webDistDir` gesetzt, aber `<webDistDir>/index.html` fehlt -> sichtbarer
  Fehler statt stiller 401.

### src/server.js
- Benannte Konstante `APP_PATH = "/app"` (kein Magic-String, G25).
- `GET "/"` (:176) in `if (!config.webDistDir)` wickeln (mit Flag faellt `/` durch auf `dist/index.html`).
- `postLoginPath` (:220-221) flag-abhaengig: `config.webDistDir ? APP_PATH : (selfService&&multiTenant ?
  CUSTOMER_PORTAL_PATH : undefined)`.
- `makeWebAuthRoutes({ ..., devLoginEnabled: config.devLoginEnabled })` (Dep durchreichen).
- Block NACH dem guardedBoot-Web-Login-Block (nach :305), VOR Basic-Auth (:307), alle `if (config.webDistDir)`:
  1. `app.get("/tenant.html", (_req,res) => res.redirect(302, APP_PATH))` (shadowt die public-Datei, erhaelt Bookmarks).
  2. `app.use(express.static(config.webDistDir, { extensions: ["html"] }))`.
  3. `app.get("/app/*", (_req,res) => res.sendFile(path.join(config.webDistDir, "app", "index.html")))` (SPA-Fallback).
  Auth-Begruendung als Code-Kommentar (Regel 3): Marketing + /app-Shell sind oeffentlich; jede Tenant-Sicht
  kommt NUR ueber /api/self-service/* (webAuthMw active-only) -> kein Datenleck. `/api/*`,`/auth/*`,`/.well-known/*`
  sind oben bereits gematcht (Reihenfolge) -> kein Shadowing; Owner-Legacy-API liegt hinter Basic-Auth -> unberuehrt.
  (`path` ggf. importieren, falls noch nicht vorhanden.)

### src/web-auth.js
- In `makeWebAuthRoutes` optionale Route hinter `deps.devLoginEnabled`:
  `POST /auth/dev-login` -> `sub`/`email` aus Body (Defaults dev-user/dev@local.test) -> `accounts.upsertOnFirstLogin`
  -> `sessions.create` -> Set-Cookie (`cookieAttrs` + `signValue`) -> `res.redirect(302, postLoginPath)`.
  REUSED dieselbe Session-Mint-Quelle wie der echte Callback (G5, kein paralleler Auth-Pfad). KEINE Aktivierung
  im Shim (Tenant bleibt suspended; Aktivierung/Seed macht das Harness). Liegt unter /auth/* = vor Basic-Auth +
  hinter dem /auth-Rate-Limiter (server.js:206) -> keine zusaetzliche Basic-Auth-Ausnahme noetig.

### .env.example
- `WEB_DIST_DIR=` (leer = aus; lokal `apps/web/dist`) + `DEV_LOGIN_ENABLED=false` (Kommentar: NUR lokal; auf
  Render verweigert der Boot). Beide bei den Web-Login-/Frontend-Vars.

### Tests (neu, node:test)
- static-Serving vor Basic-Auth: Marketing-Pfad 200 OHNE Auth (mit `WEB_DIST_DIR` auf ein Test-dist mit
  index.html); Negativ: `/api/calls` ohne Auth weiter 401 (Owner-Legacy-API bleibt geschuetzt).
- `/tenant.html` -> 302 `/app` mit Flag.
- `root-redirect.test.js` (ohne Flag) bleibt gruen (byte-identisch).
- `postLoginPath` = `/app` mit Flag gesetzt.
- dev-login: mintet Session-Cookie + 302 `/app` (mit devLoginEnabled); ohne Flag -> Route existiert nicht (404).
- dev-login Boot-Refusal: `isProduction`(RENDER_EXTERNAL_URL) + `DEV_LOGIN_ENABLED=true` -> assertConfig/Boot
  verweigert. (Test gegen die config-Guard-Funktion, Muster wie bestehende config-guard-Tests.)

## Pre-Mortem / Risiken (im Code/Tests adressieren)
- Cookie `Secure` ueber http://localhost: Chrome akzeptiert Secure-Cookies auf localhost/127.0.0.1 -> im
  Chrome-Loop frueh verifizieren (Cookie gesetzt + faehrt mit). Bei Quirk `localhost` statt `127.0.0.1`.
- Kein Freilegen der Owner-Legacy-API: Mount NUR vor Basic-Auth; Test `/api/calls` -> 401 pinnt das.
- `WEB_DIST_DIR` gesetzt aber Build fehlt -> sichtbarer Boot-Fehler statt stiller 401 (Guard s.o.).
- `PUBLIC_GATEWAY_URL`/`PUBLIC_URL` lokal auf DENSELBEN Origin (127.0.0.1:PORT), sonst zeigt LOGIN_URL cross-origin.

## Verifikation
- Layer 0: `node --check` der 3 src-Dateien + `npm test` (inkl. neuer Tests + bk5-smoke-e2e) gruen.
- Layer 1 (Lead, Chrome-e2e same-origin): apps/web mit `PUBLIC_GATEWAY_URL=http://127.0.0.1:3000` bauen; Gateway
  mit `WEB_DIST_DIR=apps/web/dist`, `DEV_LOGIN_ENABLED=true`, pg + SESSION_SECRET + MULTI_TENANT + SELF_SERVICE_ENABLED
  + PUBLIC_URL + Stripe-Test-Keys; Harness seedet aktiven Tenant + Nummer + Calls. Chrome: (1) `/` Marketing
  same-origin (KEINE onrender-Weiterleitung); (2) Login same-origin; (3) `POST /auth/dev-login` -> Cookie + 302
  `/app`; (4) `/app` zeigt Anrufverlauf + Nummer (state 200); (5) `/tenant.html` -> 302 `/app`; (6) `/api/calls`
  ohne Auth = 401. GIF fuer den Owner.
