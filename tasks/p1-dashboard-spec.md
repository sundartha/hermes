# Phase P1 — Dashboard auf Sundartha-Brand + radikal vereinfachen

Autoritative Scope-/Design-/Invarianten-Definition fuer Phase **P1**. Umbrella-Kontext: `PLAN-ONBOARDING.md` (§5 Phase 1). Betroffene Datei: `public/tenant.html` (statisches HTML/JS, pollt `GET /api/self-service/state`).

## Ziel

Der eingeloggte Nutzer sieht nur noch (1) seine zugeteilte **Agent-Rufnummer** und (2) die **Historie der letzten Anrufe** — im **Sundartha-Branding**, sodass sich das Dashboard wie dieselbe Webseite anfuehlt wie der Marketing-Auftritt (`apps/web`). Das aktuelle Dashboard ist Vodafone-Rot (`#e60000`) + Inter — das muss weg.

## Reiner Frontend-Schnitt

KEINE Backend-/Auth-/Gate-/API-Aenderung. Nur `public/tenant.html` (HTML/CSS/Client-JS). Der Endpoint `GET /api/self-service/state` bleibt unveraendert und darf weiter `calendar`/`actionItems` liefern — diese werden nur nicht mehr gerendert.

## Entfernen (UI-Cards + zugehoeriges JS, sauber — kein toter Code, keine ungenutzten Funktionen/Refs)

- **Begruessung-Dropdown** (aktuell ~`tenant.html:136-137`, `#greeting`) inkl. `renderGreetings()`.
- **Card "Einstellungen meines Agenten"** komplett: Agent-Name (`#agentName`), Permissions (`#perms`), Sprache (`#language`), Speichern (`#save`). Inkl. JS: `PERMS`-Array, `renderPerms()`, `collectPatch()`, `save()`, `$("save").onclick`, alle zugehoerigen DOM-Refs und der Aufruf an `POST /api/self-service/settings`.
- **Card "Kalender"** (~`:151-156`, `#cal`) inkl. `renderCal()`.
- **Card "Action Items"** (~`:185-189`, `#ai`) inkl. `renderAi()`.

Hinweis: Zeilennummern sind nur Orientierung — per Symbol/Selektor greppen, nicht per Zeile.

## Behalten (nicht brechen)

- **Auth-State:** Login/Logout, `showAuth()`, `refresh()`-Grundgeruest, `/auth/login`, `/auth/logout`, die `401`/`403`/`!ok`-Pfade. Der 403-Text auf Deutsch: `"Waehle einen Plan, um dein Konto zu aktivieren."`
- **Agent-Rufnummer** (aus `state.agent.number`) — prominent dargestellt (eigene Anzeige, nicht nur Chip).
- **Anrufe-Liste** (`#calls`, `renderCalls()` — Logik unveraendert) — read-only Historie.
- **Billing/Abo-Block** (`#billingCard`, `renderBilling()`/`renderSubscription()`, `addCard`/`subscribe`-Handler) BEHALTEN. Bleibt wie bisher hinter `PAYMENT_ENABLED` versteckt (`state.hasCard` ist nur dann ein Boolean -> sonst `display:none`). NICHT entfernen, nur ins neue Brand-Styling uebernehmen. Wird in P3 gebraucht.

## API-Contract (unveraendert)

`GET /api/self-service/state` weiter konsumieren. Genutzte Felder: `agent.number`, `calls`, `hasCard`, `subscription`. Keine neuen Endpunkte. Backend nicht anfassen.

## Brand-Tokens (aus `apps/web` Marketing-Auftritt — "wie dieselbe Seite")

- **Font:** `Space Grotesk` via Google Fonts (ersetzt Inter). Fallback: `"Space Grotesk","Helvetica Neue",Arial,sans-serif`.
- **Palette Navy (Hero):** Hintergrund dunkel-navy Verlauf `#0a2245` -> `#0f2d52` (Akzent `#1b4f86`); Cards/Surfaces `#13335c` mit Border `#1b4f86`; Text `#ffffff` (stark) / `rgba(255,255,255,.7)` (muted). KEIN Vodafone-Rot mehr.
- **Buttons:** weisse Pill — bg `#fff`, color `#10305a`, `border-radius:99px`, shadow `0 10px 26px -12px rgba(7,18,40,.7)`. Ghost: transparent + border `rgba(255,255,255,.82)`, color `rgba(255,255,255,.96)`.
- **Logo/Wordmark wie Marketing:** gefluegelte Sandale (bestehendes Inline-SVG aus `tenant.html` wiederverwenden, weiss) + Wortmarke `HERMES` (Space Grotesk 600, weiss) + Subline `by Sundartha` (uppercase, muted).
- **Live-Dot:** gruen `#1faa59` aktiv / `rgba(255,255,255,.3)` off. Status-Pills lesbar auf Navy halten.
- **Vibe:** dunkel-navy, minimal, modern, abgerundet — premium, identisch zum Marketing-Hero.

Farb-Hexwerte als benannte CSS-Custom-Properties in `:root` definieren (keine verstreuten Magic-Hex im Markup).

## Constraints (CLAUDE.md / clean-code.md — harte Gates)

- ESM, kein Build-Step, kein TypeScript. Kommentare Deutsch OHNE Umlaute (ue/oe/ae).
- Safety-Gates, Offenlegungssatz, Auth unangetastet (Frontend-only — diese Datei beruehrt sie nicht).
- Keine Magic Numbers ausser 0/1/-1 ohne benannte Konstante. Kein toter/auskommentierter Code, keine ungenutzten Funktionen/Imports/Refs nach dem Entfernen. Keine abgeschalteten Checks.

## Abgrenzung (NICHT in P1)

- Keine Backend-Aenderung, kein `/api/self-service/state`-Trim, keine Domain-/Auth-/Payment-Arbeit (das ist P2/P3).
- Kein Service-Merge, kein Astro-Umzug. `tenant.html` bleibt eigenstaendige Seite auf dem Gateway-Origin.

## Verifikation (deterministisch)

1. `npm test` gruen (beide Backends json + pglite). VORHER pruefen, ob Tests Inhalte von `tenant.html` asserten (`"Action Items"` / `"Kalender"` / `"Begruessung"` / `greeting`); falls ja, Tests konsistent an das neue Verhalten anpassen (anpassen, NICHT abschwaechen/ueberspringen).
2. Smoke: Server lokal `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true`, `curl http://localhost:3999/tenant.html` liefert die neue Seite (enthaelt `Space Grotesk` + `HERMES`, NICHT mehr `Kalender`/`Action Items`/`#e60000`).
3. Erwartetes Ergebnis: drei Zustaende rendern sauber — nicht-angemeldet (Anmelden), 403 (Plan-Hinweis + Abmelden), angemeldet (Nummer + Anrufe).

## Push/Deploy

NICHT pushen. Arbeit bleibt im Worktree/Branch (manual-push-Protokoll). Im Report: Diff-Summary, Test-Ergebnis, und was Jonas zum Live-Schalten tun muss (merge + Render-Deploy des Gateway-Service).
