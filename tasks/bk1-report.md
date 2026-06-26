# Phase BK1 — Detailbericht: Pricing-Ansicht im Dashboard

**Gate:** PASS
**finalBranch:** `phase/bk1-pricing-view-fix2`
**Scope:** Frontend-only — `public/tenant.html` + 2 Test-Files. Null `src/`-Aenderungen, null `package.json`/`package-lock`-Aenderungen.

---

## 1. Ziel & Ausgangslage

BK0 ist gemerged. `GET /api/plans` liefert `PLAN_CATALOG` (`src/plans.js`) verbatim, public/pre-Basic-Auth wie `/healthz`. Das Tenant-Dashboard hatte bereits zwei Plan-Kacheln aus dem P6-Funnel, aber **hartkodiert**: `PLAN_PRICES = {starter:"4,99 €", business:"9,99 €"}` + `fillPlanPrices()`, statische `.plan`-Kacheln mit `data-plan`/`data-price`, **keine** Leistungs-Liste, **kein** Popular-Badge.

**Realer BK1-Delta:** die Kacheln katalog-getrieben aus `GET /api/plans` rendern (Preis aus `amountCents` via `Intl.NumberFormat` de-DE, Leistungs-Liste, Popular-Badge), die lokalen Preis-Literale killen (SSoT → kein Drift zur Marketing-Seite `preise.astro`), und Subscribe-Verdrahtung + Aktiv-Abo-Logik verhaltensgleich erhalten. **Kein Geld-Pfad geaendert.**

### Verifizierter Ist-Zustand (Grounding gegen master)

| Fakt | Quelle |
|---|---|
| BK0 gemerged. `GET /api/plans` liefert `PLAN_CATALOG` verbatim, public/pre-Auth. | `src/server.js`, `src/plans.js` |
| Katalog-Felder: `slug, name, amountCents, currency, cadence, includedMinutes, numberCount, featured, features[]`. `starter` 499 / `business` 999, `currency:"eur"`, genau `business.featured===true`. | `src/plans.js` |
| Dashboard hatte schon 2 Kacheln, aber hartkodiert (`PLAN_PRICES`/`fillPlanPrices`), ohne Leistungs-Liste/Badge. | `public/tenant.html` |
| Subscribe-Verdrahtung existiert (W4/P5): `[data-plan]` → `POST /api/self-service/billing/subscribe`, no_card → gefuehrter Checkout. | `public/tenant.html`, `src/self-service-routes.js` |
| Aktiv-Abo-Logik existiert: `renderSubscription` zeigt `#subStatus` + versteckt `#subButtons`. | `public/tenant.html` |
| Block ist payment-gegated: `renderBilling` versteckt `#billingCard`, wenn `hasCard` kein Boolean (PAYMENT_ENABLED aus → byte-identisch). | `public/tenant.html`, `paymentView()` |
| CSP `/tenant.html`: `default-src 'self'`, `script-src 'self' 'unsafe-inline'`, `connect-src 'self'`. | `src/middleware.js`, `test/headers.test.js` |
| Einziger Markup-pinnender Test: `test/p6-onboarding-funnel.test.js` Block (B). | `test/` |

---

## 2. Plan (gekuerzt)

**In Scope:** `public/tenant.html` — Kacheln aus `/api/plans` rendern (Preis via `Intl.NumberFormat` de-DE, Leistungs-Liste, Popular-Badge); `PLAN_PRICES`/`fillPlanPrices` raus; CTA-Klick auf Event-Delegation umstellen; `#subStatus`-Aktiv-Logik beibehalten.

**Out (Folge-Phasen):** Checkout-Chain-Verfeinerung (BK2), Auto-Provisioning (BK3), Kontingent-Anzeige (BK4). Kein Plan-Wechsel-Surface bei aktivem Abo (Spec §7.5/§10 = Folge-Ticket).

**Neue Dateien:** keine. Reiner Frontend-Edit + Test-Anpassung. Kein separates JS-Modul (ohne Build-Step nicht aus der Inline-Shell importierbar → toter Code/over-engineering). Keine neue npm-Dependency (`Intl` ist Browser-Built-in).

### Edits an `public/tenant.html`

- **Edit A — CSS:** `.plan` bekommt `position:relative`; additive Regeln `.plan--featured`, `.plan-badge` (Popular-Pill), `.plan-features`/`.plan-feature` (Checkmark-Liste via `::before content:"\2713"`).
- **Edit B — Markup:** statische Kacheln → leerer Render-Container `<div id="subButtons" class="plans"></div>` (gefuellt von `renderPlanCards`).
- **Edit C — JS:** `PLAN_PRICES`/`fillPlanPrices` → Katalog-Funktionen: `CENTS_PER_EURO=100` (benannte Konstante), `formatPlanPrice(amountCents, currency)` (Intl de-DE), `loadPlanCatalog()` (fail-soft Fetch + Memoize-Cache), `planName(slug)` (Name aus Katalog, Slug-Capitalize-Fallback), `planCard(plan)` (eine escaped Kachel inkl. Badge), `renderPlanCards(plans)`.
- **Edit D — `renderSubscription`:** Aktiv-Zweig nutzt jetzt `planName` (statt lokaler Capitalize); No-Plan-Zweig rendert Katalog-Kacheln. `#subStatus`-Logik unveraendert.
- **Edit E — CTA:** Per-Button-Binding → Event-Delegation am stabilen Container; Subscribe-Body 1:1 in `subscribePlan(plan)` extrahiert (`POST /api/self-service/billing/subscribe`, 409 no_card → gefuehrter Checkout, 401 → neu anmelden).
- **Edit F — Init:** `fillPlanPrices(); refresh();` → `loadPlanCatalog().then(refresh)` (Katalog vor erstem Render gecacht, fail-soft).

### Tests (Plan)

- **Test-Edit 1 (PFLICHT):** `test/p6-onboarding-funnel.test.js` Block (B) umschreiben — vom Literal-Pin (`data-plan="starter"`, `4,99`, `PLAN_PRICES`) zum Drift-Guard: `/api/plans` als Datenquelle, `doesNotMatch PLAN_PRICES/4,99/9,99`, `match Popular/plan-features`, weiterhin kein Free.
- **Test-Edit 2 (PFLICHT, P11):** `test/plans-catalog.test.js` +1 Test — `features[]` nichtleer je Plan, genau ein `featured` (Kachel-Render-Kontrakt).
- **Keine DOM-/Render-Tests:** kein jsdom im Repo; gerenderte Kacheln bleiben dokumentierte Smoke-Ausnahme. Deterministisch geprueft: Datenquelle + Drift-Guard (file-level) + Daten-Shape — Repo-Muster wie `p1-dashboard-brand.test.js`.

---

## 3. Implementierungs-Zusammenfassung

| Feld | Wert |
|---|---|
| headCommit (Basis) | `c1b0e54041c08f6c062b593402c3f74c8acb7fd4` |
| `node --check` | PASS (beide Test-Files + inline `tenant.html`-Script) |
| Tests | PASS — 1047 pass / 0 fail (BK0-Baseline 1046 + 1 neuer Katalog-Test; Block (B) in-place umgeschrieben, nicht zusaetzlich) |
| committed | ja (Commit `c1b0e54`, Branch `phase/bk1-pricing-view`); `node_modules`-Symlink nicht committed |
| filesCreated | keine |
| filesEdited | `public/tenant.html`, `test/p6-onboarding-funnel.test.js`, `test/plans-catalog.test.js` |
| smoke | PASS |

Edits A–F exakt nach Plan umgesetzt: CSS fuer Popular-Badge/Featured/Leistungs-Liste, leerer Render-Container, `formatPlanPrice`/`loadPlanCatalog`/`planName`/`planCard`/`renderPlanCards`, `renderSubscription` nutzt `planName` + rendert Katalog-Kacheln im No-Plan-Zweig, CTA via Event-Delegation + extrahiertes `subscribePlan`, Init laedt Katalog vor erstem Render. Aktiv-Abo-Logik und PAYMENT_ENABLED-Gate verhaltensgleich.

**Smoke-Note:** Server lokal gebootet (`PORT=3999`, `SKIP_TWILIO_SIGNATURE_CHECK=true`, OWNER_NUMBER_SEED + Dummy-Env, `DATA_DIR`=Temp). `/healthz`=200; `GET /api/plans` liefert 2 Plaene mit `features[]` und `business.featured=true`; `/tenant.html`: `PLAN_PRICES`-Count=0, `/api/plans`-Referenz vorhanden, `plan-features` vorhanden. Browser-Optik (gerenderte Kacheln/Badge) bleibt die dokumentierte manuelle Smoke-Ausnahme (node:test hat kein DOM).

### Deviations (1)

- **Plan-interne Inkonsistenz:** Die in Edit C vorgegebene Kommentar-Zeile enthielt das Literal `4,99 €`, das der in Test-Edit 1 vorgegebene Drift-Guard (`assert.doesNotMatch(html, /4,99/)`) verbietet → der Test schlug zunaechst fehl. Aufgeloest, indem der Kommentar **ohne** Preis-Literal umformuliert wurde ("ueber Intl.NumberFormat im de-DE-Format lokalisiert (Komma-Dezimaltrenner + Euro-Symbol)"). Haelt die load-bearing Invariante (kein hartkodiertes Preis-Literal in `tenant.html`) gruen und ist mit der Kommentar-Aussage selbst konsistent ("Kein lokales Preis-Literal mehr"). Alle uebrigen Edits A–F und Test-Edit 2 exakt wie geplant.

---

## 4. Safety-Urteil

**APPROVED.** BK1 (Pricing-Kacheln im Tenant-Dashboard) ist sauber und scope-treu. Geaenderte Files: NUR `public/tenant.html` + 4 Test-Files (2 neue BK1-Regression-Tests, 2 verstaerkte Bestands-Tests). Null `src/`-Aenderungen, null `package.json`/`package-lock`-Aenderungen → keine neue npm-Dependency. Die konsumierte Route `GET /api/plans` stammt aus BK0 (Commit `4c1eac1`), nicht aus BK1.

| Absolute Regel | Status |
|---|---|
| Safety-Gates (numberGate/Budget/Allowlist/Land/Stunde/Max-Dauer/Signatur) | **intakt** — kein Telefonie-/Gate-Code im Diff; Subscribe-Flow ruft unveraenderten Endpoint mit unveraendertem `{plan}`-Payload; kein neuer Calls/SMS/Geld-ausloesender Endpoint |
| Offenlegung (`claude.js`/`bridge.js`) | **intakt** — nicht im Diff, `disclosureSentence` unveraendert |
| Auth fail-closed (Basic-Auth, `/voice`-Signatur, MCP, `safeEqual`) | **intakt** — kein Auth-Code beruehrt; `/api/plans` per BK0 dokumentiert auth-exempt (read-only, keine Secrets/PII); Lese-View bleibt `webAuthMw`-gegated |
| Secrets / PII | kein Leak — Kacheln zeigen nur den oeffentlichen Katalog (`slug/name/amountCents/currency/cadence/includedMinutes/numberCount/featured/features`); keine `cus_`/`sub_`/`pm_`/Stripe-Price-IDs; kein neues Logging |
| XSS | alle dynamischen Katalog-Werte in `planCard` via `esc()` escaped (name, price, slug, features); Badge statisch — Defense-in-depth, obwohl Quelle server-vertrauenswuerdig (frozen catalog) |
| PAYMENT_ENABLED-Gate | erhalten — `renderBilling` versteckt den Block byte-identisch, wenn `hasCard` kein Boolean |
| Stack / Scope | ESM/kein Build-Step/kein TS; Kommentare deutsch ohne Umlaute; keine neue Dependency; nur BK1 (keine Checkout-/Provisioning-/Kontingent-Arbeit) |

**Verhalten wie spezifiziert:** Kacheln aus Katalog-SSoT statt Preis-Literalen; `formatPlanPrice` teilt Cents/100 + de-DE-Intl; `loadPlanCatalog` ist fail-soft (rejectet nie → Bootstrap `.then(refresh)` laeuft immer, Dashboard haengt nicht am Katalog-Fetch); Aktiv-Plan-Name via `planName()` mit identischem Slug-Fallback; kein-Free-Invariante erhalten. Beide Test-Anpassungen sind **staerker** (Drift-Guard statt Literal-Assertion), nicht aufgeweicht.

**Unabhaengige Verifikation:** Frischer Worktree, `node_modules`-Self-Symlink-Trap auf echtes Parent umgebogen. JSON-Backend volle Suite: 1054 pass / 0 fail / 0 skipped. PG-SQL-Pfad (`web-auth-pg.test.js` via `@electric-sql/pglite`) + 2 neue BK1-Test-Files isoliert: 26 pass / 0 fail. BK1-Tests extrahieren die ausgelieferte Logik aus `tenant.html` und fuehren sie im vm-Kontext aus (keine Kopien) → pruefen Divisor /100, de-DE-Lokalisierung, currency-Honoring, Popular-Badge, Slug-im-CTA, Fail-soft-Promise-Semantik.

**Nicht-blockierende Concerns:**
1. `loadPlanCatalog().then(refresh)` gated den ersten Render am `/api/plans`-Fetch ohne expliziten Timeout → ein echter Server-HANG (keine Rejection) wuerde den Render verzoegern. Mitigation: `/api/plans` liefert eine eingefrorene Konstante VOR der Auth (Hang extrem unwahrscheinlich), fail-soft faengt alle Fehler/Rejections/non-JSON ab, no-timeout-fetch entspricht dem Bestand (`refresh()` selbst). Akzeptables Risiko.
2. `STORE_BACKEND=pg` global gesetzt laesst ~5 Test-Files rot laufen (kein echtes Postgres); `helpers.js` pinnt `STORE_BACKEND=json`, PG-Pfad ist via PGlite in `web-auth-pg.test.js` abgedeckt und gruen. Reines Env-Override-Artefakt, KEINE BK1-Regression.

---

## 5. Clean-Code-Audit (S1–S4)

**Verdict: PASS** (Blocker: nein; S1/S2 leer).

- **S1 (Blocker):** keine.
- **S2 (Blocker):** keine.
- **S3 (sollte-fix):**
  - **BK1-S3a** · `public/tenant.html` `formatPlanPrice` · `new Intl.NumberFormat(... currency: String(currency).toUpperCase())` wirft `RangeError` bei unbekanntem Currency-Code. Nicht erreichbar (currency aus eingefrorenem, server-kontrolliertem `PLAN_CATALOG` → nur `'eur'`), daher non-blocking. Fix optional bei kuenftig user-/tenant-konfigurierbarer Waehrung (try/catch oder Whitelist). Reine Robustheits-Notiz.
- **S4 (nit/Wartung):**
  - **BK1-S4a** · `test/bk1-plan-catalog-failsoft.test.js` / `bk1-plan-price-format.test.js` · Tests extrahieren Live-Funktionen per Regex aus `tenant.html` und fuehren sie in `vm.runInNewContext` aus; Anker ist die spaltenbuendige schliessende Klammer (`\n\}`). Pragmatisch + dokumentiert (kein DOM-Harness im Repo), prueft ausgelieferte Logik statt Kopie → bewusst akzeptiert. Fragilitaets-Hinweis: bei Reformatierung von `tenant.html` (Einrueckung der Funktions-Schlussklammer) brechen die Regex-Anker. Kein Verstoss, nur Wartungs-Risiko.

**Pass-Notes (Auszug):** Duplizierung ENTFERNT statt geschaffen (G5/S2) — Preise/Leistungen aus einer Quelle (`GET /api/plans` → `src/plans.js`); lokale `PLAN_PRICES`/`fillPlanPrices` + statisches Markup weg (kein toter Code). Geld bleibt Ganzzahl-Cents (G26), Division nur an der Anzeige-Grenze ueber benannte `CENTS_PER_EURO` (G25). XSS: `esc()` konsistent wie `renderCalls` (G11); `data-plan` in doppelten Quotes. Auth: `/api/plans` bewusst Basic-Auth-exempt (read-only, keine Secrets/PII). Fail-soft `loadPlanCatalog` rejectet nie. Event-Delegation am stabilen Container statt Per-Button-Binding (kein Listener-Leak, G5). Capitalize-Fallback in EINER Quelle `planName()` konsolidiert (vorher in `renderSubscription` dupliziert). N7-Seiteneffekt im Namen (`loadPlanCatalog`), Memoize-Cache korrekt von P15-Lazy-Init abgegrenzt. Funktionen klein, single-purpose (G30), ≤2 Args.

**topTodos:** Keine Blocker — Branch merge-faehig. Optional: kurzer Kommentar an den Regex-Ankern (Funktions-Schlussklammer MUSS auf Spalte 0). Optional/spaeter: `formatPlanPrice` gegen unbekannte Currency haerten (heute n.z., frozen catalog).

---

## 6. Fix-Runden

- **r1 — BK1-1 (root cause):** `loadPlanCatalog` in `public/tenant.html` kapselt `fetch`+`parse` jetzt in try/catch und resolved auf JEDEM Fehlerpfad zu `[]` (HTTP `!ok`, fetch-Rejection bei offline/DNS/Reset, `r.json()`-Wurf bei 200/non-JSON-Body eines Proxy/Interstitial). Die Funktion rejectet nie mehr → Bootstrap `.then(refresh)` laeuft immer, Dashboard haengt nicht am Katalog-Fetch.
- **r2 — BK1-S1-1:** neue Regressions-Testdatei `test/bk1-plan-price-format.test.js` (vm-Extraktion wie `bk1-plan-catalog-failsoft`) verifiziert die bisher ungetestete Geld-Anzeige-Logik in `public/tenant.html`. Drei Tests, je ein Konzept (P14): `formatPlanPrice` pinnt 499/`'eur'`→`'4,99 €'`, 999→`'9,99 €'`, currency-Honoring.

**Resultat nach Fix-Runden:** Branch `phase/bk1-pricing-view-fix2`, s1/s2 leer, alle Tests gruen, Gate = PASS.

---

## Relevante Pfade

- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/public/tenant.html`
- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/test/p6-onboarding-funnel.test.js`
- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/test/plans-catalog.test.js`
- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/test/bk1-plan-catalog-failsoft.test.js`
- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/test/bk1-plan-price-format.test.js`
- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/src/plans.js`
- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/src/self-service-routes.js`
- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/src/server.js`
- `/Users/jonaskroh/Larry/deliverables/vodafone-agent/src/middleware.js`
