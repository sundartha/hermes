# Phase BK0 — Plan-Katalog als Single Source of Truth

| Feld | Wert |
| --- | --- |
| **Phase** | BK0 — Plan-Katalog als Single Source of Truth |
| **Gate** | **PASS** |
| **finalBranch** | `phase/bk0-plan-catalog` |
| **headCommit** | `4c1eac16a57a50b5c1c5e783f63b2c3d7f45bed2` (`4c1eac1`) |
| **Tests** | 1046 pass / 0 fail (Root), 62/62 pass (apps/web seriell) |
| **node --check** | gruen (9 JS-Dateien) |
| **Commit** | 1 Commit, 10 Files, +296/-42, Working Tree clean |

---

## 1. Kernentscheidung (Architektur)

**Zwei physische Katalog-Kopien, per Drift-Test gepinnt — kein importierter Single-File.** Begruendung aus dem echten Deploy-Modell (`render.yaml`):

- Gateway-Service `vodafone-agent`: `buildFilter.ignoredPaths: ["apps/web/**"]` -> ein `src/`-Commit deployt den Gateway.
- Static-Site `hermes-web`: `buildFilter.paths: ["apps/web/**"]` -> nur `apps/web/**`-Commits deployen das Frontend (eigenes npm-Paket, eigene Lockfile, `rootDir: apps/web`, `npm ci`).

**Konsequenz:** Kein einzelner File kann beide Render-Services deployen. Ein importierter Single-File (`src/plans.js` -> in Astro gezogen) loeste bei einem Preis-Edit **keinen** Web-Deploy aus -> Static-Site bliebe stale = genau der Preis-Drift, den BK0 killt.

**Loesung = etablierte Repo-Konvention** (`SETTINGS_LANGUAGES`/`SETTINGS_FREE_FIELDS` sind ebenfalls drift-getestet gespiegelt): Backend-SSoT `src/plans.js` + Marketing-Spiegel `apps/web/src/lib/plans.js`, beide identisch, automatischer Drift-Test macht Divergenz zum roten Build. Datenduplikat ist durch Paket-Isolation erzwungen und durch den Test abgesichert.

**Endpoint-Wahl:** dediziertes, oeffentliches `GET /api/plans` (statt `/api/self-service/state` zu erweitern). Public read-only Katalog gehoert NICHT hinter `webAuthMw` (kein Tenant-Bezug); `src/self-service-routes.js` wird nicht angefasst.

**Marketing-Seite konsumiert den Spiegel zur BUILD-Zeit** (zero-JS SSG, strikte CSP) — NICHT via `fetch`. Der Endpoint existiert fuer In-App/BK1 (same-origin, authed Dashboard). Kein CORS in BK0/BK1.

---

## 2. Plan (gekuerzt)

### Neue Dateien

| Datei | Zweck |
| --- | --- |
| `src/plans.js` | Backend-SSoT: `PLAN_CATALOG` (starter 499 / business 999 Cents EUR, eingefroren) + `CATALOG_SLUGS`. Reines Daten-Modul, KEINE Imports/IO (kein Lazy-Init, keine Kopplung). |
| `apps/web/src/lib/plans.js` | Marketing-Spiegel (1:1) + `formatPlanPrice(amountCents, currency)` (Ganzzahl-Cents -> "EUR4.99", fail-soft bei unbekannter Waehrung). KEIN `import.meta.env` (muss aus Node-Test + Astro-Build importierbar bleiben). |
| `test/plans-catalog.test.js` | Katalog-Daten, Slug-Identitaet (`PLAN_SLUGS === CATALOG_SLUGS`), Slug/Price-Coverage, **Cross-Package-Drift** (`deepEqual WEB_CATALOG == PLAN_CATALOG`). |
| `test/plans-route.test.js` | Endpoint-Beweis: `GET /api/plans` -> 200 (2 Plaene); Auth-Exemption-Kontrast ueber `externalUrl` (`/api/plans` ohne Creds -> 200 vs `/api/profiles` -> 401). |
| `apps/web/test/plans.test.js` | `formatPlanPrice`-Grenzwerte (Sub-Euro 99, runder Euro 100, unbekannte Waehrung ohne Symbol), Spiegel-Form, self-contained. |

### Edits

| Datei | Aenderung |
| --- | --- |
| `src/billing/subscribe.js` | Slug-Quelle vereinheitlicht: `PLAN_SLUGS = CATALOG_SLUGS` (Import aus `../plans.js`). Reiner Refactor, Wert byte-identisch `["starter","business"]`; `priceIdForPlan`/`createTenantSubscription` unveraendert. |
| `src/server.js` | 1 Import (`PLAN_CATALOG`) + 1 Route `app.get("/api/plans", ...)`, gemountet nach `/healthz` und VOR der Basic-Auth — begruendeter Auth-Exemption-Kommentar (Regel 3). |
| `apps/web/src/pages/preise.astro` | Lokales `$`-Plans-Array geloescht, rendert aus `PLAN_CATALOG` + `formatPlanPrice` (EUR statt `$`). Class-Namen/CTA/`site.css` unberuehrt. |
| `apps/web/test/pages.test.js` | 1 Assertion: EUR-Render aus Katalog, kein `$\d`-Preis, beide Tarifnamen. |
| `src/config.js` | Optional/trivial: Kommentar "USD" -> "EUR" (adjazent zur Waehrungs-Vereinheitlichung). |

### Bewusst NICHT gebaut
`planForSlug()`-Helper weggelassen (kein Aufrufer in BK0 -> waere toter Code, F4/G9). Beide Exports werden konsumiert.

---

## 3. Impl-Zusammenfassung

BK0 vollstaendig und exakt gemaess Plan umgesetzt. Backend-SSoT `src/plans.js` (`PLAN_CATALOG` + `CATALOG_SLUGS`) + Marketing-Spiegel `apps/web/src/lib/plans.js` (+ `formatPlanPrice`), beide drift-getestet. Neuer oeffentlicher read-only Endpoint `GET /api/plans` (vor Basic-Auth wie `/healthz`, keine PII/Secrets). `subscribe.js` nutzt jetzt `CATALOG_SLUGS` als EINE Slug-Quelle (reiner Refactor, Bestandssuite ohne Aenderung gruen). `preise.astro` rendert EUR aus dem Katalog statt lokaler `$`-Literale.

**Verifikation:**
- Root `npm test`: **1046 pass / 0 fail** (json-Default + pglite, 65 Test-Files erzwingen `STORE_BACKEND=pg` -> beide Backends in EINEM Lauf; inkl. 10 neue Tests).
- apps/web-Suite seriell: **62/62 pass**.
- `node --check` auf alle 9 JS-Dateien gruen.
- `astro build` (exit 0): `preise/index.html` zeigt "EUR4.99 per month" / "EUR9.99 per month", 0 Dollar-Preise.

**Smoke:** Public-Mount von `/api/plans` automatisiert bewiesen (statt manuellem curl): `test/plans-route.test.js` spawnt den echten Server, `GET /api/plans` -> 200 (2 Plaene, ohne Login), Kontrast `GET /api/profiles` -> 401 ueber `externalUrl` mit gesetztem `DASHBOARD_PASSWORD`.

**Committed:** `4c1eac1` (10 Dateien, kein node_modules-Symlink im Tree, Working Tree clean).

### Deviations

1. **node_modules-Symlink-Trap (Worktree):** `ln -s "./node_modules" node_modules` erzeugte einen zirkulaeren self-referenziellen Symlink. Direkter `node --test` lief (Modulaufloesung wanderte zum Parent-node_modules hoch), aber der `npm test`-Wrapper folgte der Schleife -> Exit 194 ohne Test-Output. Fix: Symlink per absolutem Pfad auf das echte Parent-`node_modules` umgebogen. Gitignored, NICHT committed (bekannte Trap aus MEMORY.md).
2. **apps/web ohne node_modules im Worktree:** fuer die Web-Suite temporaer auf Parent-`apps/web/node_modules` verlinkt, danach Symlink + dist-Artefakte wieder entfernt (NICHT committed).
3. **Web-Suite Parallel-Build-Race (PRE-EXISTING):** unter Default-Parallel 4 Fehler durch Concurrency-Race zwischen parallelen `astro build`-Aufrufen (geteilter `.vite/deps`-Cache, `ENOTEMPTY`). Serialisiert (`--test-concurrency=1`) -> 62/62 pass. Nicht durch BK0 verursacht (pristine HEAD zeigt denselben Race).
4. **Prettier-Drift (PRE-EXISTING):** `apps/web/test/pages.test.js` failt `prettier --check` bereits am pristine HEAD (printWidth-100-Drift). Hinzugefuegter Test-Block ist prettier-clean; bestehende Zeilen bewusst NICHT umformatiert (out of scope, vermeidet Diff-Noise).
5. **config.js-Kommentarfix** (USD -> EUR) umgesetzt — im Plan als optional markiert.

---

## 4. Safety-Urteil

**APPROVED** — alle absoluten Regeln erfuellt, unabhaengige Tests gruen (Root 1046/1046 ueber beide Backends, apps/web 62/62 seriell). Branch-Delta = EIN Commit `4c1eac1`, 10 Files, +296/-42.

| Pruefung | Status |
| --- | --- |
| testsPassIndependently | true |
| safetyGatesIntact | true |
| disclosureIntact | true |
| authFailClosedIntact | true |
| noSecretsLeaked | true |
| scopeRespected | true |
| behaviorAsIntended | true |
| **blockers** | **keine** |

- **SAFETY-GATES:** unberuehrt — keine Telephony/numberGate/Budget/Allowlist/Land/Stundenlimit/Max-Dauer/Signatur-Logik im Diff. `subscribe.js` aendert nur die Slug-Quelle auf `CATALOG_SLUGS` (referenzielle Identitaet, byte-identischer Wert), alle fail-closed-Gates (`unknown_plan`/`plan_unconfigured`/`already_subscribed`/`no_card`) intakt.
- **DISCLOSURE:** `claude.js`/`bridge.js` nicht im Diff -> Offenlegungssatz unveraendert.
- **AUTH FAIL-CLOSED:** `/voice`-Signatur, Basic-Auth-Middleware, MCP-Auth, `safeEqual` unberuehrt. Neuer `GET /api/plans` ist eine im Code begruendete read-only Public-Ausnahme (Regel 3), vor der Basic-Auth gemountet wie `/healthz`, liefert NUR oeffentliche Tarif-Daten — kein Tenant/Secret/PII, kein Schreibpfad, loest weder Calls/SMS noch Geld aus. Exemption per 200-vs-401-Test gepinnt.
- **SECRETS:** `/api/plans` gibt nur `PLAN_CATALOG` zurueck; keine echten Secrets/Env/Logging neu. Secret-Treffer waren Kommentare + Test-Fixtures (`price_s`/`price_b`, `s3cret`). Audio weiterhin nicht durch MCP.
- **SCOPE:** nur BK0 — kein Checkout, keine Dashboard-UI, keine neue npm-Dependency (kein `package.json`/Lockfile im Diff).

### Concerns (nicht-blockend)
1. **PRE-EXISTING Parallel-Build-Race** (`apps/web`): `npm test` unter Default-Concurrency bricht sporadisch mit `ENOTEMPTY` (geteilter `.vite/deps`-Cache). Seriell gruen. BK0 fuegte kein neues Build-File hinzu. Folge-Ticket-Kandidat: `.vite`-Cache pro `outDir` isolieren.
2. **Scope-Wahl (korrekt):** `GET /api/plans` in `src/server.js` gemountet, nicht in `src/self-service-routes.js` (das liegt hinter `webAuthMw`; Endpoint muss public/pre-auth sein wie `/healthz`). Spec erlaubt das explizit.

---

## 5. Clean-Code-Audit (s1–s4)

**Verdict: PASS** — `blocker: false`. Disziplinierte, kleine Phase ohne S1/S2-Befunde.

| Severity | Befunde |
| --- | --- |
| **S1** (Blocker) | — keine — |
| **S2** (Blocker) | — keine — |
| **S3** (Minor) | `apps/web/src/lib/plans.js:50` — `formatPlanPrice` nutzt nacktes Literal `2` in `padStart(2, "0")` fuer die Cent-Stellenzahl (G25-Grenzfall). Optional `MINOR_DIGITS=2` benennen; sehr niedrig, im Cent-Kontext selbsterklaerend, kein echter Verstoss. |
| **S4** (Nit) | — keine — |

**Begruendung PASS:**
- Geld als Ganzzahl-Cents (`amountCents` 499/999, G26 — kein Float); `formatPlanPrice` an Grenzwerten getestet (Sub-Euro 99, runder Euro 100, unbekannte Waehrung fail-soft).
- Duplizierung aktiv REDUZIERT: `PLAN_SLUGS = CATALOG_SLUGS` (referenzielle Identitaet, getestet) ersetzt das fruehere zweite Slug-Literal.
- Die bewusste 1:1-physische Katalog-Kopie ist eine begruendete Ausnahme (Deploy-Isolation: getrennte Render-Services/npm-Pakete/Lockfiles) UND durch einen Rot-Build-Drift-Guard abgesichert (`test/plans-catalog.test.js`, einziger Ort der beide Pakete importiert, `deepEqual`) — laeuft root-seitig in CI.
- Neuer Endpoint korrekt vor Basic-Auth gemountet wie `/healthz`, begruendeter Kommentar (Regel 3), read-only, weiterhin rate-limited; Auth-Exemption per Test bewiesen mit 401-Kontrast.
- Voller Root-Suite-Lauf 1046 pass / 0 fail — keine Regression durch die `subscribe.js`-Aenderung.

### Top-Todos (Prozess, kein Code-Blocker)
1. **CI-Luecke (vorbestehend):** `.github/workflows/ci.yml` laeuft nur `test/*.test.js`; die web-seitigen Tests (`apps/web/test/plans.test.js` + EUR-Render-Assertion) laufen NICHT in CI, nur via `apps/web npm test`. Empfehlung: apps/web-Suite in CI einhaengen. Der zentrale Drift-Guard liegt aber root-seitig und laeuft bereits.
2. Optional S3: `MINOR_DIGITS=2` in `formatPlanPrice` benennen.
3. Restrisiko bewusst halten: `amountCents` (Anzeige) vs. Stripe-Price-Currency ist Owner-Verantwortung (Katalog liest Stripe nicht, dokumentiert) — bei BK2/Checkout erneut pruefen, dass Anzeige-EUR und tatsaechlicher Abbuch nicht divergieren.

---

## 6. Fix-Runden

**Keine.** Gate war bei erstem dualem Review gruen: Safety = APPROVED (0 Blocker), Clean-Code = PASS (0 S1/S2). Kein Self-Fix-Durchlauf noetig — die `FIXES`-Sektion ist leer.
