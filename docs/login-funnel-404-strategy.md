# Strategie: 404 im Login-Funnel auf sundartha.com (Bug B)

**Status:** Analyse-only (kein Code geaendert). Entscheidungen vorbereitet, Phasen
skizziert. Umsetzung erst nach Owner-Ratifikation der Variante.
**Datum:** 2026-06-24
**Scope:** NUR Bug B (404 der Funnel-Buttons). Bug A (WorkOS `application_not_found`)
ist eine getrennte Baustelle und wird hier ausdruecklich NICHT angefasst.

---

## 1. Befund / Root Cause (code-gegroundet)

Die Funnel-Buttons "Log in" / "Get started" zeigen alle auf die zentrale Konstante:

```
apps/web/src/lib/routes.js:9   export const LOGIN_URL = "/auth/login";
```

Das ist ein **relativer, same-origin Pfad**. Auf der Live-Site loest er zu
`https://sundartha.com/auth/login` auf.

`sundartha.com` ist eine **Render Static Site** (`hermes-web`, `runtime: static`,
`apps/web` -> `dist`, render.yaml ~Z.196-228). Ein statisches CDN hat keinen Server
und keine Seite unter `/auth/login` (es existiert kein `src/pages/auth/login.astro`).
=> **404.**

Der funktionierende Auth-Flow lebt auf einem **anderen Origin**: dem Gateway-Web-Service
`vodafone-agent` (`https://vodafone-agent.onrender.com`). Dort faengt
`makeWebAuthRoutes` (`src/web-auth.js`) `GET /auth/login` ab und startet den
OIDC-Auth-Code-+-PKCE-Flow Richtung IdP.

**Ein-Satz-Wurzel:** Der Funnel verlinkt einen Auth-Pfad als wenn er same-origin
auf der Static Site laege, obwohl Auth/Portal/Session vollstaendig auf dem separaten
Gateway-Origin leben. Frontend und Auth-Backend sind zwei Origins; der relative Link
ueberbrueckt die Grenze nicht.

### Warum es bisher durchrutschte
`apps/web/test/links.test.js:65` ueberspringt `LOGIN_URL` bewusst von der
Existenzpruefung ("Funnel-Einstieg (W3)"). Der Audit-Test, der genau solche toten
Links faengt, hat diese eine Route per Ausnahme nicht abgedeckt. Die 404-Lücke ist
also eine **uneingeloeste W3-Annahme** ("/auth/login wird lauffaehig"), nicht ein
spaeter eingeschleppter Regressionsbug.

---

## 2. Verifizierte Fakten aus der Recherche

### Frontend (apps/web)
- `LOGIN_URL` wird an **11 Stellen** verwendet (alle statisch im Astro-Frontmatter,
  zur Build-Zeit gerendert, keine Client-JS-Umlenkung): `Site.astro:103/104`,
  `index.astro:74/75/86`, `registrieren.astro:40/73`, `preise.astro:74`,
  `AuthIsland.astro:12`, `app/index.astro:41`, plus Definition `routes.js:9`.
- routes.js ist bewusst als **EINE umschaltbare Quelle** angelegt (Kommentar: "an
  genau einer Stelle umschaltbar", abhaengigkeitsfrei). Ein Eingriff genau hier ist
  architektonisch vorgesehen.
- Keine absolute Backend-URL ist heute irgendwo im Frontend hardcoded (nur
  Mail-Adressen).
- Astro kann Build-Zeit-Env ueber `PUBLIC_*`-Vars (`import.meta.env.PUBLIC_*`) ins
  statische HTML inlinen — heute nicht genutzt, waere der saubere Hebel fuer eine
  konfigurierbare absolute URL.

### Deploy / Render (render.yaml)
- `hermes-web` (Static) hat bereits einen `routes:`-Block mit einer Rewrite-Regel
  (`/app/*` -> `/app/index.html`). Render-Static-Routes unterstuetzen `type: redirect`
  AUCH auf externe absolute Ziele (mit `:splat`).
- CSP der Static Site: `default-src 'self'; connect-src 'self'; frame-ancestors 'none';
  base-uri 'self'; object-src 'none'`.
- Backend-Origin/`redirect_uri` kommt aus `PUBLIC_URL` (config.js); fuer Render
  `https://vodafone-agent.onrender.com`. `redirect_uri = config.publicUrl + "/auth/callback"`,
  hardcoded aus Env, NICHT aus `req.host`.

### CSP-Nuance (entscheidend fuer die Bewertung)
`connect-src 'self'` governt nur `fetch`/`XHR`/WebSocket. **Top-Level-Navigation**
(Klick auf `<a href>` oder ein HTTP-302-Redirect) zu einem anderen Origin wird davon
NICHT eingeschraenkt (das regelt `navigate-to`/`form-action`, beide nicht gesetzt).
=> Sowohl ein absoluter Link als auch eine Redirect-Regel sind CSP-konform.

### Rueck-Sprung nach Login (war als Risiko vermutet — entwarnt)
- `/auth/callback` redirectet am Ende relativ auf `postLoginPath`
  (`/tenant.html` bzw. `/`). Relativ => landet auf **dem Backend-Origin**
  (`onrender.com/tenant.html`), nicht auf sundartha.com.
- Das ist **konsistent, kein Bug**: Das Session-Cookie wird auf dem Backend-Origin
  gesetzt (HttpOnly, Secure, SameSite=Lax, KEIN Domain-Flag => an onrender.com
  gebunden), und `tenant.html` wird vom Backend ausgeliefert. Auth + Portal + Cookie
  liegen alle auf demselben Origin.
- Es gibt also **keinen Bedarf**, nach sundartha.com zurueckzuspringen. Der
  Marken-Domain-Cutover (sundartha.com auch fuers Portal) ist das separate **Track B**
  und nicht Teil von Bug B.

---

## 3. Loesungsoptionen

Beide sind CSP-konform und nicht-hardcoded (Config/Env). Die Grenze "Frontend ->
Backend-Origin fuer Auth" bleibt in beiden bewusst bestehen (Track-B-konform).

### Option A (EMPFOHLEN) — Absolute, env-getriebene Login-URL in routes.js
- Neue Build-Zeit-Env-Var `PUBLIC_GATEWAY_URL` (z.B.
  `https://vodafone-agent.onrender.com`), in render.yaml beim `hermes-web`-Service
  gesetzt und in `.env.example` dokumentiert.
- `routes.js`: `LOGIN_URL = ` `${import.meta.env.PUBLIC_GATEWAY_URL}/auth/login`
  (fail-closed: fehlt die Var im Build -> Build-Fehler ODER bewusst sichtbarer
  Default, NICHT stilles relatives Fallback, das wieder 404 erzeugt).
- **Pro:** Trifft exakt die routes.js-Design-Absicht (eine umschaltbare Quelle);
  ein direkter Hop; keine Render-Routing-Magie; spaeterer Track-B-Cutover = nur
  Env-Wert aendern.
- **Contra:** Absolute Origin-URL steht (env-vermittelt) im statischen HTML; Build
  haengt an einer Env-Var.

### Option B — Render-Redirect-Regel /auth/* -> Backend
- In render.yaml `hermes-web` `routes:` ergaenzen:
  `type: redirect, source: /auth/*, destination: https://vodafone-agent.onrender.com/auth/:splat`.
- Links bleiben relativ/same-origin; das CDN antwortet mit 301/302 zum Backend.
- **Pro:** Null Frontend-/Build-Aenderung; deckt alle `/auth/*`-Pfade ab.
- **Contra:** Zusaetzlicher Redirect-Hop; Verhalten "versteckt" in Infra-Config statt
  im Code; Existenz/Backend-URL nicht durch den vorhandenen `links.test.js`
  abdeckbar (Test sieht weiter einen relativen, jetzt absichtlich umgeleiteten Pfad).

**Empfehlung:** **Option A.** Sie ist code-sichtbar, testbar im bestehenden
Frontend-Audit, passt zur ausdruecklichen routes.js-Architektur ("eine umschaltbare
Quelle") und macht den spaeteren Track-B-Cutover zu einer reinen Env-Aenderung. Der
Owner hat die Variantenwahl delegiert ("bitte selbst die beste Loesung waehlen") —
diese Strategie waehlt A; Option B bleibt als Fallback dokumentiert, falls eine
Build-Env-Var auf dem Static-Service unerwuenscht ist.

---

## 4. Phasenplan

Klein genug fuer zwei eng begrenzte Phasen.

### Phase B1 — Funnel-Link auf den funktionierenden Auth-Origin (Option A)
- `PUBLIC_GATEWAY_URL` in render.yaml (`hermes-web`) + `.env.example` + ggf.
  `apps/web/.env`-Beispiel; fail-closed (kein stilles relatives Fallback).
- `apps/web/src/lib/routes.js`: `LOGIN_URL` absolut aus der Env zusammensetzen;
  Kommentar aktualisieren (W3-Annahme aufloesen).
- `apps/web/test/links.test.js`: die `LOGIN_URL`-Skip-Ausnahme (Z.65) entfernen/
  ersetzen durch eine positive Assertion: LOGIN_URL ist absolut, zeigt auf
  `${PUBLIC_GATEWAY_URL}/auth/login`, ist KEIN relativer Static-Pfad mehr.
- `npm run build` (apps/web) gruen; `npm test` (Wurzel + apps/web) gruen.
- Blast-Radius: ~3 Dateien (routes.js, render.yaml, links.test.js) + .env.example.
  Keine der 11 Verwendungsstellen aendert sich (sie konsumieren nur die Konstante).

### Phase B2 — Live-Verifikation (Click-Through)
- Deploy `hermes-web` (autoDeploy=false -> manuell) mit gesetzter `PUBLIC_GATEWAY_URL`.
- Browser-Durchlauf: sundartha.com -> "Log in" und "Get started" -> erwartet:
  KEIN 404 mehr, sondern Landung auf `vodafone-agent.onrender.com/auth/login` und
  weiter der OIDC-Redirect Richtung IdP.
- **Abbruch-/Grenzkriterium:** Der Flow stoppt erwartbar an Bug A
  (WorkOS `application_not_found`). Das ist KEIN Bug-B-Defekt — Bug B gilt als
  behoben, sobald der 404 weg ist und der IdP-Redirect startet. Klar im Report
  vermerken, nicht mit Bug A vermischen.

---

## 5. Risiken / Pre-Mortem (1 Jahr spaeter, Fix war falsch)

- **R1 — `/auth/*` ist backend-seitig gegated.** `/auth/login` registriert sich nur
  bei `config.sessionSecret && config.storeBackend === "pg"` (src/server.js ~Z.159).
  Fehlt eines davon in Prod, ist `/auth/login` **auch auf dem Backend 404** — dann
  haetten wir den 404 nur verschoben. **Vor B2 verifizieren**, dass die Prod-Env des
  Gateways `pg` + `sessionSecret` gesetzt hat (sonst ist Bug B nicht wirklich geloest).
- **R2 — Stilles relatives Fallback.** Wenn `PUBLIC_GATEWAY_URL` im Build fehlt und
  routes.js auf einen relativen Default zurueckfaellt, ist der 404 sofort zurueck und
  niemand merkt es bis zum naechsten Klick. Daher in B1 **fail-closed** (Build-Fehler
  oder lautstark sichtbarer Wert), nie still relativ.
- **R3 — `/app`-SPA + CSP (NICHT Bug B, aber benennen).** Es gibt eine `/app`-Region
  auf der Static Site (`app/index.astro`, `AuthIsland`, Rewrite `/app/*`), die
  same-origin `/api/self-service/*` erwartet. Unter `connect-src 'self'` kann sie das
  Backend-`/api` cross-origin GAR NICHT erreichen. Falls `/app` auf sundartha.com
  produktiv laufen soll, ist das ein eigenes Architektur-Thema (CSP `connect-src`
  erweitern + CORS am Backend + Cookie-Domain) — **separat, nicht in Bug B loesen**.
- **R4 — Cookie-Origin bei kuenftigem Track B.** Wenn spaeter sundartha.com selbst
  Auth/Portal bedienen soll, muessen Cookie-Domain/SameSite und `redirect_uri`
  (`PUBLIC_URL`) sauber nachgezogen werden. Heute irrelevant (alles auf onrender.com),
  aber beim Cutover beachten.

---

## 6. Definition of Done (Bug B)
1. Klick auf "Log in"/"Get started" auf sundartha.com fuehrt nicht mehr zu 404.
2. Stattdessen Landung auf dem Backend-`/auth/login` und Start des OIDC-Redirects.
3. `apps/web/test/links.test.js` deckt LOGIN_URL positiv ab (kein Skip mehr).
4. Build + Tests gruen; render.yaml + .env.example dokumentiert.
5. Report haelt fest, dass der verbleibende Stopp = Bug A ist (getrennt).
