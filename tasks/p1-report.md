# Phase P1 — Dashboard Sundartha-Brand + Vereinfachung (nur Nummer + Anrufe)

> **Gate: PASS** · **finalBranch: `phase/p1-dashboard-sundartha`** (1 Commit ueber `master`, NICHT gepusht — manual-push-Protokoll)
> Commit: `961bbace74dfe54e6ab50303d1e5893c216d2dab` · Tests: 1004 pass / 0 fail (json + pglite) · Smoke: HTTP 200, Brand-Marker da, 0× `#e60000`

## 1. Auftrag

`public/tenant.html` (Tenant-Self-Service-Dashboard) von Vodafone-Rot auf Sundartha-Navy umstellen und auf das Wesentliche reduzieren: **prominente Agent-Rufnummer + Anrufe-Historie**. Settings-, Kalender- und Action-Items-Cards entfernen. Billing-Block (Karte/Abo) behalten, nur restylen. Reiner Frontend-Schnitt — kein Backend, keine Safety-Gates, keine Auth, keine API-/Endpoint-Aenderung, keine neue Dependency.

## 2. Plan (gekuerzt)

**Grounding (auf `master` verifiziert):**

- Betroffen: **nur** `public/tenant.html` (387 Zeilen, statisches HTML/CSS/JS).
- Backend `GET /api/self-service/state` liefert `settings`, `greetingTemplates`, `calls`, `actionItems`, `calendar`, `agent.number`, optional `hasCard`/`subscription` — bleibt **unveraendert** (Felder werden nur nicht mehr gerendert).
- Spec-Hexwerte sind 1:1 die Marketing-Tokens aus `apps/web/src/styles/tokens/hero.css` (`--hero-navy-900:#0a2245`, `-800:#0f2d52`, `-700:#1b4f86`, `-card:#13335c`, `--hero-blue-ink:#10305a`, `--hero-shadow-pill`).
- Wortmarke `HERMES` + `by Sundartha` + gefluegelte Sandale aus `apps/web/src/layouts/Site.astro`.
- Font: **bewusst Google-Fonts-CDN** fuer Space Grotesk (wie der Bestand schon Inter via Google laedt). CSP whitelistet `fonts.googleapis.com` + `fonts.gstatic.com` bereits serverseitig (`test/headers.test.js:25-26`) → **CSP unberuehrt, gruen**.
- Alle zu entfernenden Symbole (`renderGreetings/renderCal/renderAi/collectPatch/save/PERMS`, IDs `#greeting/#agentName/#perms/#language/#save/#cal/#ai`) sind **client-lokal** — keine externen Caller. Kein Test asserted die entfernten Strings oder den englischen 403-Text (`git grep` bestaetigt).

**Invarianten:** kein `src/`-Touch, kein Disclosure/Auth/Gate-Touch, keine neue npm-Dependency, `GET /api/self-service/state` byte-identisch.

**Vorgehen:**
1. `public/tenant.html` als **komplette Neufassung** (statt 30 fragmentierter Edits — ~80% der Zeilen sind Token-/Struktur-/JS-Bezug, Vodafone→Navy ist pervasiv).
2. Neuer Inhalts-Test `test/p1-dashboard-brand.test.js` — deterministisch, offline, in-process via `startServer()`-Harness (Muster aus `headers.test.js`). Pixel-Optik bleibt manueller Smoke (dokumentierte Ausnahme); Inhalts-/Struktur-Invarianten werden gepinnt.
3. Bestandssuite unveraendert gruen (`headers`/`i9-self-service`/`web-auth`).

**Change-Log (Kern):** `<link>` Inter→Space Grotesk · `:root` Vodafone-Tokens (`--vf-red/#e60000`) raus → benannte Navy-Tokens + `--bg`/`--shadow-pill` · Header `Mein Bereich`-`<h1>`+`.agent-chip` → `.brand` (Sandale-SVG wiederverwendet + `HERMES`/`by Sundartha`) · Agent-Nummer als eigene prominente Card (34px), IDs `#liveDot`/`#agentNum` erhalten · Settings-/Kalender-/Action-Items-Cards + zugehoeriges JS + CSS geloescht · `refresh()` getrimmt auf `agent.number`/`calls`/Billing · 403-Text **englisch→deutsch** (`"Waehle einen Plan, um dein Konto zu aktivieren."`) · `.btn-red`→`.btn-primary` (weisse Pill) · Billing-Block (`#billingCard`, `renderBilling/renderSubscription`, addCard/subscribe/showCardReturn) unveraendert behalten, `c8`→`c12` fuer Anrufe-Card · Status-Pills/`.dir`/`.msg` auf Navy retokenisiert, `renderCalls` byte-identisch.

## 3. Implementierung — Zusammenfassung

`public/tenant.html` komplett neugefasst: Navy-Tokens 1:1 aus `apps/web` `hero.css`, Space Grotesk via Google-CDN, Wortmarke `HERMES`/`by Sundartha`, Sandale-SVG wiederverwendet. Vereinfacht auf Nummer + Anrufe. Entfernt: Settings-/Kalender-/Action-Items-Cards inkl. JS. Agent-Rufnummer jetzt als prominente eigene Card. 403-Text englisch→deutsch. `.btn-red`→`.btn-primary` (weisse Pill). Billing-Block (Karte/Abo) unveraendert, nur Brand-Styling. Backend / `GET /api/self-service/state` unberuehrt.

**Verifikation:** `node --check` OK · `npm test` 1004 pass / 0 fail (json + pglite) · Smoke: Server `PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true` + Dummy-Env, `curl /tenant.html` HTTP 200; Marker `HERMES` + `Space+Grotesk` + `by Sundartha` vorhanden; `grep -c '#e60000'` = 0; `grep -Ec 'Kalender|Action Items|Begruessung'` = 0. Boot-Log bestaetigt Safety-Gates aktiv (Allowlist leer → Outbound gesperrt, Land-Gate +49/+33/+44, max 6 Calls/h, Notruf-/Premium-Denylist).

**Dateien:**
- geaendert: `public/tenant.html`
- neu: `test/p1-dashboard-brand.test.js`

**Deviations:**
- Worktree-Setup Schritt 1 (`ln -s ./node_modules node_modules`) war self-referential/zirkulaer. Stattdessen Symlink auf das echte `node_modules` des Haupt-Repos gesetzt. Funktional aequivalent, **nicht committet** (bleibt untracked). Implementierung der beiden Dateien folgt dem Plan exakt — keine inhaltlichen Abweichungen.

## 4. Safety-Urteil — APPROVED

| Check | Ergebnis |
|---|---|
| Tests laufen unabhaengig | PASS — 1004/0 (json+pglite); `web-auth-pg.test.js` (PGlite, echtes Schema) 7/0; neuer Test standalone 1/0 |
| Safety-Gates intakt | PASS — kein `src/`-Touch; `numberGateError`-Kette (Denylist/Allowlist/Land/Stundenlimit/Budget/Max-Dauer) + Twilio-HMAC/Telnyx-Ed25519-Signaturpruefung unberuehrt |
| Disclosure intakt | PASS — `disclosureSentence`-Quellen (`claude.js`+`bridge.js`) nicht im Diff |
| Auth fail-closed | PASS — keine neuen Endpunkte; `refresh()` behandelt 401→Login, 403→Plan, !ok→Hinweis ohne Tenant-Datenleck; ID-Paritaet sauber (keine dangling Refs → kein Null-Deref, der fail-closed aushebelt) |
| Keine Secrets geleakt | PASS — nur nicht-sensible Call-Metadaten (to/from/goal/status) hinter Session; kein Transkript, kein Audio; `esc()` auf user-kontrollierte Felder, Rest via `textContent` |
| Verhalten wie beabsichtigt | PASS — Billing-Block verborgen wenn `PAYMENT_ENABLED` aus (`typeof s.hasCard !== "boolean"`) → Payment-Teil byte-identisch zum Bestand; CSP-kompatibel (gleiche Google-Origins) |
| Scope eingehalten | PASS — nur `public/tenant.html` + neuer Test; kein `package.json`, kein `render.yaml`, kein `claude.js/bridge.js/auth/config` |

Die gefetchten Routen sind eine echte **Teilmenge** von `master` (master rief zusaetzlich `POST /api/self-service/settings`, das die neue Version entfernt; `setup-checkout`/`subscribe` sind Bestand und byte-identisch). Entfernte Settings-Card steuerte nur Konversations-Permissions (`allowCalendar/allowBooking/allowPersonalData/allowBankData`), **nicht** die absoluten Gates — Server-Endpunkt bleibt erhalten, nur das UI-Control faellt weg.

**Concerns (kein Blocker):**
1. `src/middleware.js:4` Kommentar nennt noch "Inter", obwohl `tenant.html` jetzt Space Grotesk laedt. `middleware.js` bewusst NICHT angefasst (src/-Touch waere Scope-Creep) — Kommentar-Drift akzeptabel, ggf. spaeter nachziehen.
2. Prozess-Hinweis: die zuvor unter `tasks/p1-report.md` liegende Datei war ein stale Report einer **anderen** Phase (F1 Geo-Felder). Scope-Autoritaet ist Commit-Message + `rebrand-sundartha.md` A.5. Dieser Bericht ersetzt den stale Report.

## 5. Clean-Code-Audit — PASS (kein Blocker)

| Severity | Findings |
|---|---|
| **S1 (Blocker)** | keine |
| **S2 (Blocker)** | keine |
| **S3 (sollte)** | **S3-1** · `tenant.html:25` · G25/DRY — `--bg`-Gradient hardcodet die drei Navy-Hex (`#1b4f86`/`#0f2d52`/`#0a2245`), die direkt darueber schon als `--navy-700/-800/-900` benannt sind. Fix: `var(--navy-700/-800/-900)` im Gradient nutzen (schliesst zugleich S4-1). |
| **S4 (nice)** | **S4-1** · `tenant.html:14` · G12 — Token `--navy-800` definiert, aber 0× via `var()` referenziert. Fix: entfernen ODER im `--bg`-Gradient verwenden. · **S4-2** · `tenant.html:48-49` · G9 — nach dem Cutover nutzen alle 4 Cards `c12`; `.c4/.c6/.c8` + Media-Query `@media(max-width:980px)` sind ungenutzt. Fix: entfernen oder als bewusste Grid-Skala kommentieren (Grenzfall: wiederverwendbare Utility). |

**Verdict:** PASS — saubere, gut abgesicherte Brand-/Vereinfachungs-Phase. Der Diff entfernt mehr Code als er hinzufuegt; keine S1/S2-Verstoesse. Nur kosmetische S3/S4-Reste (ungenutzte CSS-Token/Klassen), nicht blockierend.

**Pass-Notes:** Settings/Kalender/Action-Items inkl. JS (`renderPerms/renderGreetings/renderAi/renderCal/collectPatch/save/PERMS`, `$("save").onclick`) restlos raus — alle via `$("id")` referenzierten IDs existieren weiter im Markup, kein dangling DOM-/Funktions-Ref (grep + `node --test`). XSS-Escaping (`esc()`) auf der Anrufe-Liste erhalten; keine Auth-/Safety-/Secret-Pfade beruehrt. Neuer Test pinnt die Invarianten deterministisch+offline (Space Grotesk/HERMES/by Sundartha da; `#e60000`/`--vf-`/Inter weg; entfernte Cards weg; Rufnummer/Anrufe/Zugang/Billing intakt). 403-Meldung englisch→deutsch lokalisiert (G11). Billing-/Subscription-Logik unangetastet.

## 6. Fix-Runden

Keine. Beide Reviewer gaben in **Runde 1** PASS/APPROVED ohne Blocker. Die S3/S4-Findings sind explizit nicht-blockierend dokumentiert und als Folge-Aufraeumung offen gelassen (kein Code geaendert in diesem Bericht-Task).

**Offene Top-Todos (optional, Folge-Ticket):**
1. Ungenutztes Token `--navy-800` (`tenant.html:14`) entfernen — oder zusammen mit S3-1 die benannten Navy-Vars im `--bg`-Gradient wiederverwenden statt der Hex-Literale.
2. Tote Grid-Utilities `.c4/.c6/.c8` + Media-Query (`tenant.html:48-49`) entfernen oder als bewusste Skala kommentieren (alle Cards sind jetzt `c12`).
3. `src/middleware.js:4` "Inter"→"Space Grotesk"-Kommentar nachziehen (separat, da `src/`-Touch).

## 7. Blast-Radius & Live-Schalten

- **Geaendert:** `public/tenant.html` (1 Datei). **Neu:** `test/p1-dashboard-brand.test.js`. **Unberuehrt:** gesamtes `src/`, `apps/web/`, alle Gates/Auth/Disclosure/Secrets, `GET /api/self-service/state`, `render.yaml`, `.env.example`. Null neue npm-Dependency.
- **Pre-Mortem:** Groesstes Risiko "leeres Dashboard wirkt kaputt" — gemindert, weil Nummer-Card + Anrufe-Empty-States ("Noch nicht verbunden." / "Keine Anrufe.") erhalten bleiben und `#liveDot/#agentNum`-IDs unveraendert von `refresh()` bedient werden. Zweites Risiko (CSP bricht Font) ausgeschlossen durch identische Google-Origins + gepinnten `headers.test.js`.
- **Live-Schalten:** merge `phase/p1-dashboard-sundartha` → `master` + Render-Deploy des **Gateway**-Service `vodafone-agent` (statisches `public/` wird vom Node-Gateway ausgeliefert; hermes-web/Astro ist nicht betroffen). **Aktuell NICHT gepusht.**
