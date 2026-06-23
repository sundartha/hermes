# Strategie: Rewrite `sundartha.com` — vollstaendige SaaS-Website (Hermes by Sundartha)

> **Scope.** Visueller + Seiten-Rewrite der Produkt-Website auf dem **bereits bestehenden, bewaehrten Fundament** aus `apps/web/` (Astro, `output: static`). Kein Wegwerf der funktionierenden Technik (Token-System, Islands, Same-Origin-Cookie-Modell, strikte CSP) — ein Rewrite der **Sicht-Schicht, des Seiten-Sets und der Hero-Erfahrung**, plus Ausbau von Dashboard und Abo-Storefront.
>
> **Bauen auf, nicht gegen** `docs/strategy/hermes-frontend.md` (Geruest W0–W5 ist umgesetzt) und `docs/strategy/hermes-w5-domain-cutover.md` (Domain/Same-Origin).
>
> **Kernaenderung Hero:** Die scroll-getriggerte „MCP-Connection"-Animation wird **nicht mit Three.js** gebaut, sondern aus **Higgsfield-AI-generierten** Assets — als Frame-Sequenz auf `<canvas>`, scroll-gescrubbt, unter unveraenderter strikter CSP.
>
> Branche: Deutsch. Produkt = **Hermes**, Firma = **Sundartha** (`sundartha.com`). Repo-Verzeichnis/Render-Service heissen weiter `vodafone-agent` (nicht aendern — Infra-Cutover ist Track B, separat).

---

## 0. Reality-Check — Auftrag vs. verifizierter Code

Per Agent-Team am Working-Tree verifiziert (Befunde im Anhang). Mehrere Auftrags-Annahmen treffen den IST-Zustand **nicht** — diese Luecken werden hier dokumentiert, nicht zurueckgefragt (Auftrags-Regel: nicht mitigierbare Risiken dokumentieren).

| # | Auftrags-Annahme | Verifizierter IST-Zustand | Konsequenz fuer die Strategie |
|---|---|---|---|
| R1 | „User koennen zwei Abos buchen ($4.99/mo und $9.99/mo)" | **Es gibt keine Subscription-Endpunkte und keine Preis-Tiers.** Billing = Stripe **`setup`-Mode** (nur Karte hinterlegen, kein Abbuchen) + nutzungsbasiertes Metering + einmalige Nummern-Setup-Gebuehr. Kein `PRICE_ID`, kein `subscription`-Checkout, kein Customer-Portal. | Echte wiederkehrende Abrechnung ist **frontend-only nicht baubar** unter „keine neuen Endpunkte". Wir liefern die **Storefront + Karten-Hinterlegung** (bestehender Endpunkt) und **flaggen** die Recurring-Billing-Verdrahtung als benannten Backend-Follow-up (§2.6). Keine vorgetaeuschte Abbuchung. |
| R2 | „User koennen sich registrieren" | **Keine Self-Service-Registrierung.** Konto entsteht beim **ersten OIDC-Login** (`/auth/login`), Tenant wird `status='suspended'` angelegt, Zugriff erst nach **Admin-Freigabe** (`403` bis dahin). | „Registrieren" = gestylter Funnel auf `/auth/login` + polierter „Konto in Pruefung"-Zustand im App-Shell (§2.7). |
| R3 | „Dashboard … verbleibende Nutzung" | **Roh-Nutzung (Minuten/Tokens/Budget) ist NICHT in `/api/self-service/state`.** `usageOf`/Budget sind serverseitig (Rate-Limit/Metering), nicht im Public-State. | Dashboard zeigt **Verlauf + clientseitig abgeleitete Statistik** aus `calls[]`. Praezise „Rest-Kontingent"-Anzeige braucht ein neues Feld in `/state` → Backend-Follow-up, geflaggt (§2.8). |
| R4 | „Designsystem fuer Sundartha (nicht Vodafone)" | Token `--color-red-600: #e60000` = **woertlich Vodafone-Rot**. Im `src/`-Code/HTML kein String „vodafone", aber die **Brand-Farbe** ist es. | §2.5 definiert eine **Sundartha-Palette**; finale Markenfarben sind Owner-Entscheidung (§8). |
| R5 | „Higgsfield … authentifiziert mit Token" | Auf diesem Host fuer den `clawcode`-User **nicht eingeloggt** (`account status`, `generate list`, `model list` → „Not authenticated"); Token liegt vermutlich unter `root`. Jede `generate create`-Aktion **kostet Credits** (irreversibel). | Higgsfield-Generierung ist ein **mensch-gegateter, kostenpflichtiger Schritt** — nie autonom. Trockenlauf via `generate cost` + `--enhance-only`, vorher `account status` pruefen (§2.4, §5). |
| R6 | „SSG static (wie bisher)" + Cookie-Auth | Bestaetigt: `output: static`, strikte CSP `default-src 'self'`. **Cookie-Auth funktioniert nur Same-Origin** mit der API. | Same-Origin ist harte Leitplanke (§2.9). Hero-Animation muss unter unveraenderter CSP laufen (kein `unsafe-inline`, kein `data:`-Relax). |

---

## 1. Ziel & Akzeptanzkriterien

### Ziel
`sundartha.com` wird die vollstaendige, moderne SaaS-Praesenz fuer Hermes: eine cineastische, einheitlich gestaltete Marketing-Website mit scroll-getriggerter Higgsfield-Hero-Animation, ein klarer Anmelde-/Abo-Funnel und ein eingeloggtes Dashboard (Anruf-Verlauf, abgeleitete Statistik, Karten-/Abo-Status) — komplett gegen das **bestehende** Backend, **ohne neue Endpunkte**, unter unveraenderter strikter CSP, Same-Origin.

### Akzeptanzkriterien („Done", deterministisch pruefbar)
1. **Build gruen, CSP unangetastet:** `cd apps/web && npm run build` erzeugt `dist/` ohne Inline-Styles/-Scripts; `default-src 'self'`-Header in `render.yaml` unveraendert; kein `data:`/`unsafe-*` neu in der CSP.
2. **Einheitlicher Stil:** Jede Unterseite (`/`, `/so-funktionierts`, `/preise`, `/registrieren`, `/app/`, Legal) nutzt **dieselbe** Sundartha-Token-Schicht; kein `#e60000`/Vodafone-Rot mehr als Brand-Akzent (grep-Gate).
3. **Hero-Animation:** `/` zeigt die scroll-getriggerte Frame-Sequenz; bei `prefers-reduced-motion`, ohne JS und auf langsamer Verbindung faellt sie auf ein statisches Poster zurueck (kein Layout-Bruch, kein Block des LCP).
4. **Auth-Funnel klickbar:** „Jetzt starten"/„Registrieren" fuehrt nach `/auth/login`; nach Login zeigt `/app/` genau **einen** Zustand (Shell / „in Pruefung" `403` / anonym `401` / Fehler) — verifiziert mit den drei bestehenden `node:test`-Suites + Smoke gegen lokalen Server.
5. **Abo-Storefront:** `/preise` zeigt die zwei Tiers ($4.99/$9.99) plus „Karte hinterlegen" ueber den **bestehenden** `POST /api/self-service/billing/setup-checkout`; die fehlende Recurring-Abbuchung ist im Doc als Backend-Follow-up sichtbar (kein Fake-Charge).
6. **Dashboard:** `/app/` rendert Anruf-Verlauf + clientseitig abgeleitete Statistik (Anzahl, in/out, mit Summary) aus `/api/self-service/state`; Karten-Status via `hasCard`.
7. **Same-Origin verifiziert:** Cookie-Auth funktioniert, weil Frontend und API unter einer Origin ausgeliefert werden (Smoke: eingeloggter `GET /api/self-service/state` → `200` von der Site-Origin).
8. **Keine Secrets im Frontend, keine neuen Endpunkte:** grep nach Tokens/Keys in `apps/web/` leer; Netz-Calls ausschliesslich gegen `/api/self-service/*` und `/auth/*`.

---

## 2. Architektur

### 2.1 Verhaeltnis zu `hermes-frontend.md` — Rewrite des Sicht-Layers, nicht des Fundaments

Das Geruest (W0–W5 aus `hermes-frontend.md`) **existiert und funktioniert**: `apps/web/` mit Astro `output: static`, 3-Schicht-Token-System (`primitives→semantic→components`), Marketing-Layout + App-Shell, sieben Islands (Auth/Calls/ActionItems/Calendar/Billing/Settings/AgentChip), `lib/api.js` + `lib/render.js` (XSS-sicher, getestet), strikte CSP via `render.yaml`. Ein „Rewrite from scratch" waere Wegwerf-Code gegen die Vision in `CLAUDE.md` („nachhaltig, kein Wegwerf").

**Entscheidung:** Wir **reusen** das technische Fundament unveraendert und schreiben **Sicht-Schicht + Seiten-Set + Hero-Erfahrung** neu:
- **bleibt** (wiederverwendet): Astro-Static-Setup, Same-Origin-Cookie-Modell, CSP, `lib/api.js`/`lib/render.js`, die getesteten Daten-Extraktoren, das Island-Muster, der Settings-Write-Whitelist-Pfad.
- **wird neu** (Rewrite): Token-Werte (Sundartha-Palette + cineastisches Dark-Theme), Marketing-CSS + alle Marketing-Seiten, Hero (Higgsfield-Animation statt statischer Hero), Dashboard-Layout/Statistik-Sicht, neue Seiten (Registrieren-Funnel, Legal, Statistik-Panel), responsives Mobile-Layout.

### 2.2 Seiten-Landkarte

| Route | Typ | Status | Inhalt |
|---|---|---|---|
| `/` | Marketing SSG | **Rewrite** | Cineastische Hero + Higgsfield-Scroll-Animation (MCP-Connection), Feature-Sektionen, CTA → `/auth/login` |
| `/so-funktionierts` | Marketing SSG | Rewrite (Stil) | 3-Schritt-Erklaerung im neuen Stil |
| `/preise` | Marketing SSG | **Rewrite** | Zwei Tiers $4.99/$9.99 + „Karte hinterlegen"-Funnel (§2.6) |
| `/registrieren` | Marketing SSG | **Neu** | Gestylter Funnel → `/auth/login` (OIDC); erklaert Approval-Schritt (§2.7) |
| `/app/` | App-Shell | **Rewrite/Ausbau** | Dashboard: Verlauf + Statistik + Kalender + Karten-/Abo-Status (§2.8) |
| `/datenschutz`, `/impressum`, `/agb` | Marketing SSG | **Neu** | Legal (DE-Pflicht) — Platzhalter mit Owner-Text (§8) |
| `404` | Marketing SSG | **Neu** | Gestylte Fehlerseite |

Login selbst (`/auth/login`, `/auth/callback`, `/auth/logout`) ist **Gateway-serviert** (OIDC-Redirect, kein Frontend-Formular) — die Site verlinkt nur dorthin.

### 2.3 Datenfluss — ausschliesslich bestehende Endpunkte

```
Browser (sundartha.com, static)
  ├─ GET  /auth/login      → OIDC-Redirect (Gateway)   [Auth-Funnel]
  ├─ POST /auth/logout      → 204 (Gateway)             [AuthIsland]
  ├─ GET  /api/self-service/state                       [alle Lese-Islands + Dashboard]
  │        → { settings, greetingTemplates, privateNumber, hasCard?,
  │            calls[], actionItems[], calendar[], agent{number,owner} }
  ├─ POST /api/self-service/settings                    [SettingsIsland, Whitelist]
  ├─ POST /api/self-service/private-number              [optional: SMS-Summary-Nummer]
  └─ POST /api/self-service/billing/setup-checkout      [Karte hinterlegen → Stripe-URL]
```
Keine neuen Endpunkte. Statistik wird **clientseitig** aus `calls[]` abgeleitet. Auth-Status nicht JS-lesbar (HttpOnly-`session`-Cookie) → ueber HTTP-Status von `/state` (`200`/`401`/`403`) bestimmt (bestehendes Muster in `AuthIsland`).

### 2.4 Hero-Animation — Higgsfield-Pipeline (Build-Zeit), Canvas-Scrub (Laufzeit)

**Ziel-Wirkung:** abstrakte, cineastische „MCP-Connection" — Knoten verbinden sich, Datenfluss materialisiert, ein Assistent entsteht. Scroll-gescrubbt wie Apples AirPods-Seiten.

**Bewertete Optionen** (Higgsfield-Agent verifiziert):

| Option | Generierung | Laufzeit | CSP | iOS | Kosten | Verdikt |
|---|---|---|---|---|---|---|
| A — N Einzelbilder → Canvas-Sprite | N× `generate create` (teuer, Stil-Drift-Risiko) | Canvas + scroll | **0 Relax** | robust (Apple-Technik) | hoch (N Credits) | gut, aber teuer/inkonsistent |
| B — 1 Video, `currentTime`-Scrub | 1× Video (billig, kohaerent) | `<video>` scrubben | **0 Relax** | **jankig** (Safari `currentTime`-Seeks) | niedrig | kohaerent, aber Scrub unsauber auf iOS |
| C — Lottie/JSON | N Bilder + lottie-web | Lottie | **braucht `img-src data:`** ⚠ | ok | hoch | verworfen (CSP-Relax) |

**Entscheidung — Hybrid „B→A":** **Ein** Higgsfield-**Video** generieren (1 Credit-Charge, garantierte temporale Kohaerenz) → **zur Build-Zeit** mit `ffmpeg` in eine optimierte **AVIF/WebP-Frame-Sequenz** (~48–72 Frames) zerlegen → zur **Laufzeit** als **Canvas-Scroll-Scrubber** abspielen.

Begruendung: vereint billige, kohaerente Generierung (Bs Vorteil) mit robuster, iOS-sicherer Wiedergabe (As Vorteil) — **null CSP-Relaxierung**, kein `currentTime`-Jank. Das Video ist nur ein Build-Input; ausgeliefert werden statische Frames + ein gebundeltes `.js`-Scrub-Modul (CSP-konform, kein Inline-Script).

```
Higgsfield-Video (1 gen)  →  ffmpeg -r 24 frames/%04d.webp  →  apps/web/public/hero/seq/*.webp
                                                                +  hero-scrub.js (gebundelt)
                                                                +  hero-poster.webp (Fallback)
```

**Laufzeit-Regeln:** `IntersectionObserver` (nur im Viewport laden/animieren) · `requestAnimationFrame`-Throttle · Frames progressiv dekodieren · **Graceful Degradation**: `prefers-reduced-motion` / kein JS / Save-Data → statisches `hero-poster.webp` (kein LCP-Block). Budget: Sequenz ≤ ~2.5 MB (WebP/AVIF, mobil-first ein kleinerer Satz).

**Stil-Referenz auf „letzte Generierungen"** (Auftrags-Wunsch): read-only `higgsfield generate list --video --json` bzw. `--image --json` liefert Prompts/Seeds/Output-URLs vergangener Jobs; `generate get <id> --json` fuer Details. Denselben **Seed + Prompt + Referenzbild** wiederverwenden → Stil-Konsistenz. Alles read-only, **kein** Credit-Verbrauch.

**Kosten-Gate (Pflicht, §5):** vor jeder echten Generierung `higgsfield account status` (Credits pruefen) + `higgsfield generate cost <model> --prompt …` (Schaetzung) + `--enhance-only` fuer Prompt-Trockenlauf. Echte `generate create` nur nach Owner-Freigabe und mit verifiziertem Auth/Guthaben.

### 2.5 Design-System / Sundartha-Branding (Token-Schicht)

Die 3-Schicht-Token-Architektur **bleibt** (Komponenten referenzieren nur `semantic`, nie `primitives` — Rebrand = nur `primitives.css` tauschen). Der Rewrite:
1. **Ersetzt** `--color-red-600: #e60000` (Vodafone-Rot, R4) durch eine **Sundartha-Palette** (Markenfarben Owner-Entscheidung, §8) + ein cineastisches **Dark-Theme** als Marketing-Grundton (passend zur Higgsfield-Aesthetik).
2. **Erweitert** die `semantic`-Schicht um Marketing-Rollen (Hero-Gradient, Glow/Akzent, Surface-Layer fuer Dark).
3. **Vereinheitlicht** Typo/Spacing/Radii ueber alle Seiten; laedt **Inter** korrekt (selbst-gehostet, `font-display: swap`, same-origin — aktuell referenziert, aber nicht geladen).
4. Grep-Gate: kein `#e60000` mehr als Brand-Akzent.

### 2.6 Subscriptions — ehrlicher Befund + Optionen

**Befund (R1):** Backend hat **keine** Subscription-/Preis-Tiers — nur `setup`-Mode-Karten-Hinterlegung + Usage-Metering + einmalige Nummern-Gebuehr. „Keine neuen Endpunkte" verbietet, das jetzt zu bauen.

**Optionen:**
- **(A) Storefront + Karte (empfohlen, constraint-konform):** `/preise` zeigt die zwei Tiers als Auswahl-UI; „Abonnieren" funnelt in den **bestehenden** `POST /api/self-service/billing/setup-checkout` (Karte hinterlegen). Die **wiederkehrende Abbuchung** (Stripe `subscription`-Mode, zwei `PRICE_ID`s, neue Route, Plan-Persistenz) ist ein **benannter Backend-Follow-up**, der die „keine neuen Endpunkte"-Schranke verletzt → **out-of-scope, geflaggt**, nicht still gefaket.
- **(B) Nur Marketing-Anzeige:** Tiers rein informativ, CTA → `/auth/login`. Ehrlich, aber liefert keinen Zahlungspfad.
- **(C) Echtes Subscription-Billing:** verletzt „keine neuen Endpunkte" → **nicht in diesem Scope**.

**Entscheidung:** **(A)**. Wir liefern Storefront + Karten-Capture heute; das Recurring-Wiring ist als praezise umrissener Backend-Task (`STRIPE_PRICE_ID_BASIC`/`_PRO`, `createSubscriptionCheckoutSession`, neue Self-Service-Route) im Doc sichtbar fuer den Owner (§8). Kein vorgetaeuschter Charge im Frontend.

### 2.7 Registrierung & Login (OIDC + Approval)

**Befund (R2):** Kein Self-Service-Signup. Erst-Login via `/auth/login` (OIDC Auth-Code + PKCE) legt Tenant `status='suspended'` an → Zugriff erst nach Admin-Freigabe (`403` bis dahin).

**Umsetzung:** `/registrieren` ist eine gestylte Marketing-Seite, die den Ablauf erklaert („Anmelden → Konto wird geprueft → Freischaltung") und nach `/auth/login` funnelt. Der App-Shell rendert die `403`-Antwort von `/state` als polierten **„Konto in Pruefung"**-Zustand (bestehende Region `#region-pending`), `401` als anonym, `200` als Dashboard. Kein Frontend-Login-Formular (OIDC-Redirect bleibt Gateway-Sache).

### 2.8 Dashboard — Verlauf, Statistik, Nutzung aus `/state`

Alles aus `GET /api/self-service/state`, **clientseitig** aufbereitet:
- **Anruf-Verlauf:** `calls[]` (Richtung, Gegenstelle, Status-Badge, Summary) — bestehender `CallsIsland`/`render.js`, visuell neu.
- **Statistik (abgeleitet):** Anzahl gesamt / diesen Monat / in vs. out / mit Summary — reine Client-Berechnung aus `calls[]` (neue pure Helfer in `lib/api.js`, `node:test`-getestet, DOM-frei).
- **Kalender / Action-Items:** `calendar[]` / `actionItems[]` (bestehend).
- **Karten-/Abo-Status:** `hasCard` (nur wenn `PAYMENT_ENABLED`).
- **„Verbleibende Nutzung" (R3):** Roh-Kontingent (Minuten/Budget) ist **nicht** im State. Heute liefern wir eine **abgeleitete** Aktivitaets-Anzeige (Anrufe diesen Monat). Eine **praezise** Rest-Kontingent-Anzeige braucht ein neues Feld in `/state` (z.B. `usage: { callsThisMonth, minutesUsed, capRemaining }`) → Backend-Follow-up, **geflaggt** (§8). Kein erfundenes Kontingent.

### 2.9 Same-Origin / Domain / CSP

- **Same-Origin Pflicht (R6):** HttpOnly-`session`-Cookie (`SameSite=Lax`) wird cross-origin nicht gesendet; `connect-src 'self'` blockt Cross-Origin-Fetch. → Frontend **muss** unter derselben Origin wie die API ausgeliefert werden. Muster (bestehend): gebautes `dist/` als statische Assets vom Gateway servieren bzw. beide Services hinter einer Domain/Reverse-Proxy (Detail in `hermes-w5-domain-cutover.md`).
- **CSP unangetastet:** `default-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'`. Hero-Pipeline (§2.4) ist so gewaehlt, dass **kein** `unsafe-inline`/`data:`/extern noetig ist. `inlineStylesheets: "never"` bleibt.
- **Domain:** `sundartha.com` ist Brand-URL; Render-Service/Repo bleiben `vodafone-agent` (Track B, nicht hier).

---

## 3. Pre-Mortem (Risiken benannt + entschaerft)

### Hoch
- **H1 — Higgsfield-Credits autonom verbrannt.** `generate create` ist irreversibel kostenpflichtig; Auth fuer `clawcode` fehlt. → **Mensch-Gate** (§5): nie autonom generieren; `account status` + `generate cost` + `--enhance-only` zuerst; Owner-Freigabe vor echter Generierung.
- **H2 — Abo-Versprechen ohne Backend.** Zwei Tiers suggerieren Abbuchung, die es nicht gibt (R1). → Option A (§2.6): Storefront + Karte, Recurring explizit geflaggt; **kein** Fake-Charge.
- **H3 — Cross-Origin bricht Cookie-Auth (R6).** → Same-Origin als harte Akzeptanz (§2.9, §5); Smoke-Test eingeloggter `/state` von Site-Origin.
- **H4 — Hero killt Performance/LCP.** Frame-Sequenz/Video zu schwer auf Mobile. → Hybrid B→A (§2.4), Frame-Budget ≤ ~2.5 MB, `IntersectionObserver`, `prefers-reduced-motion`-Poster, mobil-first kleinerer Satz; LCP ist das Poster, nicht die Animation.

### Mittel
- **M1 — Stil-Drift ueber Higgsfield-Frames.** Einzelbilder inkonsistent. → Video-Generierung (eine kohaerente Quelle) statt N Einzelbilder; Seed/Referenz aus „letzten Generierungen" (§2.4).
- **M2 — CSP versehentlich relaxt.** Lottie/`data:`/Inline schleicht sich ein. → Option C verworfen; CSP-Diff-Gate in Akzeptanz (§1.1).
- **M3 — „Rest-Nutzung" suggeriert Praezision, die das State nicht hat (R3).** → nur abgeleitete Aktivitaet zeigen, exakte Quote geflaggt.
- **M4 — Vodafone-Rot bleibt versehentlich (R4).** → Sundartha-Palette + grep-Gate (§1.2, §2.5).

### Niedrig
- **N1 — Legal-Seiten ohne echten Text** (DE-Pflicht). → Platzhalter-Geruest, Owner liefert Text (§8).
- **N2 — Mobile-Nav fehlt** (heute nur 1 Breakpoint). → Hamburger/Responsive in W5.
- **N3 — OG/Favicon/Sitemap fehlen.** → SEO-Politur in W5.

---

## 4. Phasenplan (W1–W5)

Jede Phase: deterministisches **Erwartetes Ergebnis** + **Verifikation** (workflow.md Regel 7). Disjunkte Datei-Mengen → parallelisierbar.

### W1 — Branding + Marketing-Layout + Hero-Geruest (mit Animations-Platzhalter)
- **Dateien:** `apps/web/src/styles/tokens/primitives.css` (Sundartha-Palette/Dark), `tokens/semantic.css` (Marketing-Rollen), `styles/marketing.css`, `layouts/Marketing.astro`, `pages/index.astro` (+ `so-funktionierts`, `preise` Stil), Inter selbst-hosten.
- **Erwartetes Ergebnis:** `npm run build` gruen; kein `#e60000` als Brand-Akzent (grep leer); Hero zeigt **statisches Poster** als Platzhalter; CSP-Header unveraendert.
- **Verifikation:** `cd apps/web && npm run build`; `grep -ri '#e60000' apps/web/src` leer; CSP-Diff `render.yaml` leer; visueller Smoke `npm run preview`.

### W2 — Auth-Funnel + Registrieren-Seite + Abo-Storefront (frueh klickbar)
- **Dateien:** `pages/registrieren.astro` (neu), `pages/preise.astro` (zwei Tiers + Karte-Funnel), `components/app/AuthIsland.astro` (Zustaende), `components/app/BillingIsland.astro` (Karte-Setup, bestehend).
- **Erwartetes Ergebnis:** „Registrieren"/„Abonnieren" → `/auth/login`; `403` rendert „Konto in Pruefung"; „Karte hinterlegen" ruft `POST …/billing/setup-checkout`; **keine** Subscription-Endpunkte erfunden.
- **Verifikation:** `apps/web` `node --test` (api/settings-Suites gruen); Smoke gegen lokalen Server (`SELF_SERVICE_ENABLED`, `SKIP_TWILIO_SIGNATURE_CHECK=true`): `401`/`403`/`200`-Pfade von `/state`; grep `apps/web` enthaelt nur erlaubte Endpunkte.

### W3 — Dashboard: Verlauf + abgeleitete Statistik + Kalender
- **Dateien:** `pages/app/index.astro` (Layout/Statistik-Panel), `lib/api.js` (pure Statistik-Helfer aus `calls[]`), `lib/render.js` (Statistik-Render), `styles/app.css`; `components/app/CallsIsland/CalendarIsland/ActionItemsIsland` (Stil).
- **Erwartetes Ergebnis:** Dashboard rendert Verlauf + Statistik (Anzahl/in-out/mit-Summary, diesen Monat) **nur** aus `/state`; keine Roh-Quote erfunden (R3).
- **Verifikation:** neue `node:test`-Faelle fuer die Statistik-Helfer (DOM-frei, deterministische Inputs → erwartete Zahlen); `render.test.js` XSS-Kontrakt bleibt gruen; Smoke mit Seed-Daten.

### W4 — Higgsfield-Hero-Animation (scroll-getriggert) — KOSTEN-GATE
- **Dateien:** `public/hero/seq/*.webp` (Build-Output aus Video+ffmpeg), `public/hero/hero-poster.webp`, `components/.../HeroAnimation.astro` + gebundeltes `hero-scrub.js`, `pages/index.astro` (Einbindung).
- **Vorbedingung (Pflicht):** Owner-Freigabe + `higgsfield account status` (Credits) + `generate cost`/`--enhance-only`-Trockenlauf; Stil aus „letzten Generierungen" (`generate list --json`).
- **Erwartetes Ergebnis:** Scroll scrubt die Frame-Sequenz auf `<canvas>`; `prefers-reduced-motion`/kein-JS/Save-Data → Poster; CSP unveraendert; Sequenz ≤ ~2.5 MB.
- **Verifikation:** `npm run build` gruen; `du -sh dist/hero` ≤ Budget; CSP-Diff leer; manueller Scroll-Smoke + Reduced-Motion-Toggle; Lighthouse-LCP < 2.5 s (Poster als LCP).

### W5 — Politur: Same-Origin-Smoke, Mobile, Legal, SEO, Fehlerseiten
- **Dateien:** `layouts/Marketing.astro` (OG/Favicon/Mobile-Nav), `pages/datenschutz|impressum|agb.astro`, `pages/404.astro`, Sitemap-Integration; Domain/Same-Origin-Verdrahtung gem. `hermes-w5-domain-cutover.md`.
- **Erwartetes Ergebnis:** Mobile-Nav funktioniert; Legal-Geruest vorhanden; OG/Favicon/404 da; eingeloggter `/state` `200` von Site-Origin.
- **Verifikation:** `npm run build`; Responsive-Smoke (DevTools), `curl` eingeloggt gegen `/state` Same-Origin → `200`; grep keine Secrets in `apps/web/`.

### Abhaengigkeitsgraph & Parallelisierung
```
W1 (Tokens/Marketing) ──┬─► W2 (Auth/Abo)  ──┐
                        ├─► W3 (Dashboard)  ──┼─► W5 (Politur/Same-Origin/SEO)
W4 (Hero) ── nach W1, parallel zu W2/W3, EIGENES Kosten-Gate ─┘
```
- **W1 zuerst** (Token-Schicht ist Basis aller Seiten).
- **W2 ∥ W3 ∥ W4** danach disjunkt (Auth/Abo vs. Dashboard vs. Hero-Assets) → drei parallele Straenge.
- **W5 zuletzt** (integriert, braucht Same-Origin-Infra-Schritt).

---

## 5. Sicherheits-Leitplanken (fuer JEDE Phase)
1. **Keine neuen Backend-Endpunkte.** Nur `/api/self-service/*` + `/auth/*`. grep-Gate in jeder Phase.
2. **Keine Secrets im Frontend.** Kein Token/Key in `apps/web/`; Higgsfield-Token nie in Assets/Code/Logs. grep-Gate.
3. **CSP unangetastet** (`default-src 'self'`, kein `unsafe-inline`/`data:`/extern); `inlineStylesheets: "never"` bleibt. CSP-Diff-Gate.
4. **Same-Origin-Cookie-Modell** (HttpOnly `session`, `SameSite=Lax`) nicht brechen — Cross-Origin-Calls verboten.
5. **Higgsfield = Kosten-Gate.** Nie autonom `generate create`/`workflow`/`*-create`. Read-only ok (`list`/`get`/`cost`/`account status`/`--enhance-only`). Vor echter Generierung: Owner-Freigabe + Guthaben-Check.
6. **Kein Fake-Billing.** Keine vorgetaeuschte Abbuchung; fehlendes Recurring ehrlich flaggen.
7. **`CLAUDE.md`, `.claude/refs/workflow.md`, `.claude/refs/clean-code.md` nicht aendern.** Repo-Name `vodafone-agent` nicht aendern.
8. **XSS-Kontrakt** aus `render.js` (`textContent`, nie `innerHTML`) in jeder neuen Render-Funktion erhalten + testen.

---

## 6. Restrisiko-Tabelle

| ID | Restrisiko | Schwere | Gegenmassnahme / Status |
|---|---|---|---|
| RR1 | Recurring-Abbuchung fehlt → Abo nicht „echt" abrechenbar | mittel | Storefront+Karte heute; Backend-Follow-up geflaggt (§2.6, §8) — bewusst out-of-scope |
| RR2 | Higgsfield-Credits/Auth nicht verfuegbar fuer `clawcode` | mittel | Kosten-Gate; Owner generiert/gibt frei; bis dahin Poster-Platzhalter (W1) statt Animation |
| RR3 | Exakte Rest-Nutzung nicht im `/state` | niedrig-mittel | Abgeleitete Aktivitaet heute; `usage`-Feld als Backend-Follow-up geflaggt (§2.8, §8) |
| RR4 | Video-`currentTime`-Scrub-Jank | niedrig | durch Hybrid B→A (Canvas-Frames) vermieden |
| RR5 | Legal ohne echten Text | niedrig | Geruest; Owner liefert Inhalt |
| RR6 | Same-Origin-Cutover (Infra) noch offen (Track B) | mittel | `hermes-w5-domain-cutover.md`; W5 verifiziert, Infra-Schritt bleibt Mensch-Freigabe |

---

## 7. Bewusst spaeter / Out-of-Scope (begruendet)
- **Echtes Subscription-Billing** (zwei `PRICE_ID`s, `subscription`-Checkout, Customer-Portal, Plan-Persistenz) — verletzt „keine neuen Endpunkte"; benannter Backend-Task fuer den Owner.
- **`usage`-Feld in `/state`** (praezise Rest-Quote) — Backend-Task, geflaggt.
- **Anruf-Detailseite / Transkript-Drilldown, Inbound-SMS-Summary-Sicht, Rechnungs-Historie, Nummern-Self-Management** — spaetere Dashboard-Iterationen.
- **Self-Service-Signup ohne Admin-Approval** — bewusste Sicherheits-Entscheidung des Backends; nicht aufweichen.
- **Blog/Content/FAQ, Analytics** — nach MVP.

## 8. Offene Owner-Entscheidungen
1. **Sundartha-Markenfarben** (R4): konkrete Palette statt Vodafone-Rot? (Vorschlag: Strategie definiert Default-Dark + Akzent; Owner bestaetigt/ersetzt.)
2. **Recurring-Billing** (R1/RR1): Soll der Backend-Follow-up (zwei `PRICE_ID`s + `subscription`-Checkout) beauftragt werden, oder bleibt es vorerst bei Karte-hinterlegen + Usage-Metering?
3. **`usage`-Feld** (R3/RR3): Rest-Kontingent ins `/state` aufnehmen (Backend) — ja/nein?
4. **Higgsfield-Generierung** (R5/H1): Freigabe + welcher Account/Credits; wer fuehrt die kostenpflichtige `generate create` aus?
5. **Legal-Texte** (N1): Datenschutz/Impressum/AGB-Inhalte liefern.
6. **Two-Tier-Inhalt:** konkrete Feature-Abgrenzung $4.99 vs $9.99 (was ist je Tier enthalten?).

## 9. Einwaende gegen die festen Entscheidungen (begruendet — Strategie baut trotzdem darauf auf)
- **„Three.js waere maechtiger als Frame-Sequenz."** Stimmt fuer Interaktivitaet — aber WebGL/`unsafe-eval`-naehe kollidiert mit der strikten CSP, und der Auftrag fordert explizit Higgsfield. Frame-Sequenz ist CSP-sauber und iOS-robust. Akzeptiert.
- **„Video-Scrub (Option B) waere einfacher."** Ja, aber `currentTime`-Seeks sind auf iOS-Safari jankig; der Hybrid B→A kostet nur einen Build-Schritt (ffmpeg) und beseitigt das Risiko. Akzeptiert.
- **„Rewrite from scratch waere sauberer als Reuse."** Nein — das bestehende Fundament ist getestet und CSP-haertet; Wegwerf widerspricht `CLAUDE.md`. Wir schreiben die Sicht-Schicht neu, behalten die Plumbing. Akzeptiert.
- **„Abo ohne echtes Recurring ist halbgar."** Korrekt, aber „keine neuen Endpunkte" ist harte Schranke; ehrliches Flaggen schlaegt Fake-Charge. Akzeptiert.

---

## Anhang: Agent-Team-Befunde (verifizierte Code-Fakten)

Drei parallele Investigations-Agenten am Working-Tree (`phase/f2-p8-p11`), read-only:

**A — Frontend-Map (`apps/web/`):** Astro 7 `output: static`, keine Framework-Komponenten (vanilla `<script>`-Islands). Seiten: `/`, `/so-funktionierts`, `/preise`, `/app/`. Layouts `Marketing.astro`/`App.astro`. Sieben Islands (Auth/Calls/ActionItems/Calendar/Billing/Settings/AgentChip), alle ueber `document`-Event `hermes:authstate`. 3-Schicht-Tokens (`primitives`→`semantic`→`index`), Brand `--color-red-600: #e60000`. `lib/api.js` (Same-Origin-Fetch, `ApiError`, pure Extraktoren), `lib/render.js` (XSS-sicher via `textContent`). Drei `node:test`-Suites. **Kein** String „vodafone" in `apps/web/src`. Luecken: keine Registrierung/Login-Seite, keine Statistik-/Usage-Sicht, kein Subscription-Flow, keine Legal/SEO/Mobile-Nav.

**B — Backend-Kontrakte:** Self-Service-Routen in `src/self-service-routes.js`, gated `webAuthMw` + `SELF_SERVICE_ENABLED`+`MULTI_TENANT`+`SESSION_SECRET`+`STORE_BACKEND=pg`. `GET /api/self-service/state` → `{settings, greetingTemplates, privateNumber, hasCard?, calls[], actionItems[], calendar[], agent{number,owner}}`. Schreibpfade: `POST …/settings` (Whitelist), `…/private-number`, `…/billing/setup-checkout` (Stripe `setup`-Mode → `{url}`). Auth: OIDC Auth-Code+PKCE, HttpOnly-`session`-Cookie, `POST /auth/logout`. **Kein** Self-Signup (Erst-Login → `suspended` → Admin-Approval, `403`). **Keine** Subscription-/Preis-Tiers; Billing = setup + Usage-Metering + Nummern-Gebuehr. Roh-Usage nicht im State. Same-Origin Pflicht (kein CORS gesetzt, `SameSite=Lax`).

**C — Higgsfield-Pipeline:** CLI 0.2.3 (`higgsfield|higgs|hf`). Read-only: `generate list/get/cost`, `model list`, `account status`, `--enhance-only`. Kostenpflichtig (Credits, irreversibel): `generate create/workflow`, `*-create`, `soul-id create`. Bildmodell `nano_banana_2` (Einzelbild); Video-Modelle existieren (Namen auth-gated). Fuer `clawcode` aktuell **nicht authentifiziert**. Empfehlung: 1 Video → ffmpeg-Frames → Canvas-Scrub (null CSP-Relax, iOS-robust). „Letzte Generierungen" als Stil-Referenz via `generate list --json` (Prompts/Seeds).
