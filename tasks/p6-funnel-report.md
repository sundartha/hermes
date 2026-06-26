# Phase p6-funnel — Onboarding-Funnel-Fix + dedizierte Plan-Auswahl

| Feld | Wert |
|---|---|
| Phase | p6-funnel |
| Ergebnis | **Gate = PASS** (dualer Review bestanden, keine Fix-Runde noetig) |
| finalBranch | `phase/p6-onboarding-funnel-plan-selection` |
| headCommit | `8c3621d77b15f6c500ca7879717dc17f0a51af2b` |
| Tests | 1036 pass / 0 fail (Exit 0); gezielte Regression 66/66 |
| node --check | gruen auf allen geaenderten JS-Dateien |
| Smoke | bestanden (scoped: `GET /tenant.html` -> 200) |
| committed | ja (genau 5 Dateien, kein `node_modules`) |

## Ziel

Zwei Defekte im Web-Onboarding-Funnel beheben:

1. **Status-Default-Fix (Part A):** Ein frischer Web-Signup muss `suspended` werden und bleiben (403 am `/state`-Gate), damit der Funnel das Payment-Gate nicht umgeht. Der Lebenszyklus-`status` eines Tenants gehoert kuenftig **ausschliesslich der accounts-Schicht** — der Store-Mirror-Flush darf ihn nicht mehr ueberschreiben.
2. **Dedizierte Plan-Auswahl (Part B):** Im 403-Aktivierungszweig zwei Plan-Karten **Starter / Business** mit Preisen zeigen — **KEIN Free-Plan**.

---

## Plan (gekuerzt)

### Root-Cause (code-gegroundet + empirisch reproduziert)

Reproduktion gegen pglite (Wegwerf-Skript, geloescht):

| Schritt | Ergebnis |
|---|---|
| `upsertOnFirstLogin({sub})` -> `accounts.resolve(sub).status` | **`suspended`** (korrekt) |
| plain `store.save()` (Flush, Mirror kennt `t_<sub>` nicht) | `suspended` (kein Effekt) |
| `registerTenant(mirror, t_<sub>, active)` + `store.save()` | **`active`** ← Clobber |

Befund: Auf `master` liefert der *reine* Web-Signup bereits korrekt `suspended`/403 (`webAuthMw` liest active-only, `src/web-auth.js:408`). Die live beobachtete `200`/Dashboard-Landung stammt vom **aelteren deployten Gateway-Commit** (P0/P5 sind unpushed).

Die **eine Stelle**, die einen frischen Tenant faelschlich `active` werden laesst (latenter Footgun): `flushTenants` in `src/store/pg.js` — `ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, ...` schreibt den In-Memory-Mirror-Status in die DB. Mirror-Default fuer einen frisch registrierten Tenant ist `ACTIVE` (`registerTenant`, `src/store/state-ops.js:576`). Damit gibt es **zwei unkoordinierte Schreiber** der Spalte `tenant.status`:

- accounts-Schicht (direktes SQL): `upsertOnFirstLogin` (suspended bei Anlage), `setStatus` (Admin/Aktivierung/Webhook), `seedDefaults` (Owner).
- Store-Mirror-Flush: Full-Upsert, Status aus dem Mirror -> kann `suspended` faelschlich auf `active` kippen (und symmetrisch `active` degradieren / `closed` reaktivieren).

Sekundaerer Footgun: Schema-Default `tenant.status = 'active'` (`src/db/schema.sql`) — jeder status-lose INSERT wird fail-open `active`.

### Fix-Strategie (Ownership-Modell)

Der DB-Lebenszyklus-`status` gehoert **ausschliesslich der accounts-Schicht**. Der Store-Mirror-Flush ueberschreibt den `status` einer **bestehenden** Zeile NICHT mehr (kein Clobber, keine Degradierung, keine Reaktivierung). Plus fail-safe Schema-Default `'suspended'` + expliziter Owner-`active`. `registerTenant` behaelt den Mirror-Default `ACTIVE` (unveraendert — das W5-Gate `tenantActiveSubscriber` braucht ihn). Mirror↔DB-Status-Divergenz ist Bestand (I8) und nicht Scope.

### Geplante Edits

**Part A (Status-Default-Fix, Kern):**

- A1 `src/db/schema.sql` — Default `active` -> `suspended` (CREATE + ALTER, fail-safe).
- A2 `src/db/migrate.js` `seedDefaults` — Owner-INSERT explizit `status='active'` (Invariante O, Lockout-Schutz), `ON CONFLICT DO NOTHING` haelt idempotent.
- A3 `src/store/pg.js` `flushTenants` — `status=EXCLUDED.status` aus der `ON CONFLICT`-SET-Liste entfernen; `status` bleibt nur im INSERT (neuer Mirror-only-Tenant erhaelt seinen Status, bestehende Zeile behaelt den accounts-gesetzten).

**Part B (dedizierte Plan-Auswahl, Starter/Business, KEIN Free):**

- B1 `public/tenant.html` CSS — Plan-Karten-Styles (`.plans`/`.plan`/`.plan-price`/...).
- B2 `public/tenant.html` Markup — `#subButtons` zu zwei statischen Plan-Karten (Starter/Business) mit Preis-Spans; `data-plan`-Buttons bleiben statisch im Markup.
- B3 `public/tenant.html` JS — benannte Preis-Konstante `PLAN_PRICES` (`Object.freeze`, G25 keine Magic Number) + `fillPlanPrices()`; `refresh()` -> `fillPlanPrices(); refresh();`. Der bestehende `[data-plan]`-Subscribe-Handler bleibt **unveraendert**.

**Tests:** neue Datei `test/p6-onboarding-funnel.test.js` — reines pglite + `fs`-Read, offline, F.I.R.S.T., kein Server-Spawn. 5 Tests:

- A1 Clobber-Regression: frischer suspended-Signup + Mirror active + Flush -> bleibt `suspended`.
- A2 Owner-Lockout-Schutz: Bootstrap-Tenant nach migrate `active`.
- A3a Keine Degradierung: aktiver Tenant + stale Mirror suspended + Flush -> `active`.
- A3b Keine Reaktivierung: closed-Tenant + Mirror active + Flush -> `closed`.
- B Plan-Markup: genau zwei `data-plan` (starter/business), Preise 4,99/9,99, `PLAN_PRICES` vorhanden, kein Free/Kostenlos/Gratis.

Falsifizierbarkeit: 4/5 Tests rot gegen unveraenderten master, alle gruen nach Fix.

---

## Impl-Zusammenfassung

Phase exakt gemaess Plan umgesetzt.

- **Part A:** Tenant-`status`-Ownership liegt allein bei der accounts-Schicht. `schema.sql` Default `active` -> `suspended` (fail-safe, CREATE + ALTER). `migrate.seedDefaults` setzt Owner explizit `active` (Invariante O). `pg.flushTenants` schreibt `status` NICHT mehr per `ON CONFLICT` (kein Clobber / keine Degradierung / keine Reaktivierung).
- **Part B:** `tenant.html` mit zwei dedizierten Plan-Karten Starter/Business (KEIN Free), Preise via benannter Konstante `PLAN_PRICES`; `data-plan`-Handler unveraendert (`querySelectorAll('[data-plan]')` trifft weiterhin genau die 2 Buttons).
- **Tests:** neue `test/p6-onboarding-funnel.test.js`, 5/5 gruen; Falsifizierbarkeit verifiziert (4/5 rot gegen unveraenderten master).

**Verifikation:**

- `node --check` gruen auf allen geaenderten JS-Dateien.
- Gesamtsuite 1036/1036 gruen (Exit 0), beide Backends (json-Default + pg via pglite).
- Gezielte Regressions-Suites 66/66.
- Scoped Smoke `/tenant.html`: HTTP 200, genau 2 `data-plan` (starter+business), Preise 4,99 und 9,99, KEIN `data-plan=free`, `PLAN_PRICES` present.

**Dateien (5, Commit `8c3621d`):**

```
geaendert: src/db/schema.sql
geaendert: src/db/migrate.js
geaendert: src/store/pg.js
geaendert: public/tenant.html
neu:       test/p6-onboarding-funnel.test.js
```

### Deviations

1. **Euro-Zeichen:** literales UTF-8 `€` statt des im Plan gezeigten `€`-Escape geschrieben — funktional/laufzeit-identisch und konsistent mit den bereits vorhandenen literalen Non-ASCII-Zeichen der Datei (Em-Dash, Ellipse); der Test prueft ohnehin nur `4,99`/`9,99`.
2. **npm-Wrapper-Artefakt:** `npm test` zeigte im Sandbox-Worktree bei Datei-Redirect/Pipe keine Ausgabe (Exit 194 als Redirect-Artefakt). Das zugrunde liegende `NODE_ENV=test node --test "test/*.test.js"` lief sauber: 1036 pass, 0 fail, Exit 0 — kein Test-/Code-Fehler, reines Display-Artefakt der Umgebung.

---

## Safety-Urteil — APPROVED

| Check | Status |
|---|---|
| approved | true |
| testsPassIndependently | true (eigene Runs im frischen Worktree, 1036/0; p6 isoliert 5/0 auf pg) |
| safetyGatesIntact | true |
| disclosureIntact | true (`claude.js` + `bridge.js` byte-identisch) |
| authFailClosedIntact | true (active-only 403 / `webAuthAllowPending` / `safeEqual`) |
| noSecretsLeaked | true |
| behaviorAsIntended | true |
| scopeRespected | true |

**Verdict:** Enge, fokussierte Phase (5 Dateien, keine neue npm-Dep, keine neuen Endpunkte). Die Kern-Aenderung ist eine **Sicherheits-Haertung, kein Risiko**: Schema-Default `active` -> `suspended` = fail-closed; `flushTenants` ueberschreibt den autoritativen Lebenszyklus-`status` nicht mehr per `ON CONFLICT` -> behebt einen **fail-OPEN-Bug** (Mirror konnte einen frischen suspended Web-Signup still reaktivieren und so Funnel/Payment-Gate umgehen; bewiesen durch Test A1). Owner-Lockout durch `seedDefaults('active')` verhindert (Test A2). Safety-Gates, `disclosureSentence`, Auth-Middleware und das json-Backend (live Default) unangetastet. Keine Secrets geleakt. Plan-Auswahl-Invariante (genau 2 Plaene, kein Free, Preise aus benannter Konstante, Handler unveraendert) durch Test B abgedeckt.

**Concerns (non-blocking):**

1. Auf bereits deployten pg-DBs ueberspringt `ALTER TABLE ADD COLUMN IF NOT EXISTS` die existierende `status`-Spalte -> deren DEFAULT bleibt `active` (kein Backfill). Funktional harmlos, da alle 4 `INSERT INTO tenant` `status` explizit setzen; der Schema-Default ist reine Defense-in-Depth. Im Kommentar bewusst vermerkt.
2. `PLAN_PRICES` (Anzeige-Strings `4,99 €`/`9,99 €`) muessen manuell konsistent zu den Stripe-Preisen hinter `PLAN_SLUGS` (`src/billing/subscribe.js`) gehalten werden -> Display/Billing-Drift-Risiko. Im Kommentar geflaggt; tatsaechliche Belastung laeuft serverseitig ueber Stripe, daher kein Sicherheits-/Kostenrisiko.

---

## Clean-Code-Audit — PASS (kein Blocker)

| Severity | Findings |
|---|---|
| S1 (Blocker) | keine |
| S2 (Blocker) | keine |
| S3 (Hinweis) | 3 |
| S4 (Nit) | keine |

**Verdict:** PASS — keine S1/S2. Fokussierter Diff (5 Dateien), 5 neue Tests gruen, 51 bestehende pg-Tests gruen (keine Regression durch die `flushTenants`-Status-Entfernung). Fail-closed-Sicherheitslage sauber.

**S3-Findings (nicht blockierend):**

- **S3-1 · `public/tenant.html:173` · G35/G22 Drift-Risiko (wichtigster To-do):** Anzeige-Preis `4,99 €`/`9,99 €` hartkodiert in der View; muss manuell zum Stripe-Price (`config.stripeStarterPriceId`/`stripeBusinessPriceId`, aufgeloest in `subscribe.js`) passen. Kein Repo-internes Source-of-Truth fuer den Betrag -> stiller Mismatch moeglich. Fix: Betrag aus Backend liefern (z.B. `/api/plans` gibt slug+Betrag aus config/Stripe), Frontend daraus rendern.
- **S3-2 · `tenant.html:145/150/173` vs `src/billing/subscribe.js:15` · Shotgun-Surgery (G5-nah, ueber Runtime-Grenze):** gueltige Plan-Menge lebt an 3 Stellen (`PLAN_SLUGS`, die zwei `data-plan`-Attribute, die `PLAN_PRICES`-Keys); ein dritter Plan zwingt zu Edits in beiden Schichten. Frontend/Backend-Split ohne Build-Step -> keine harte Duplizierung, aber drift-anfaellig. Fix: Plan-Liste ueber EINEN Endpoint exponieren ODER bewusst als akzeptierte Vereinfachung fuer 2 statische Plaene festhalten.
- **S3-3 · `test/p6-onboarding-funnel.test.js:64-70` · Test-Brittleness:** B-Test matcht Wortlaut/Format (`4,99`, `Kostenlos|Gratis`) statt struktureller Invarianten; reines Reword/Reformat bricht den Test ohne Verhaltensaenderung. Akzeptabel (HTML-Optik sonst nur Smoke-pruefbar), Format-toleranter waere robuster.

**Pass-Notes:** (1) Status-Default `suspended` ist fail-closed; Owner-Lockout durch `seedDefaults`-INSERT mit explizit `active` + `ON CONFLICT DO NOTHING` verhindert (Test A2). (2) `flushTenants` entfernt `status=EXCLUDED.status` korrekt — alle Status-Uebergaenge laufen ausschliesslich ueber den accounts-Seam; kein in-memory-Status wird ueber den Store-Flush autoritativ persistiert. Clobber/Degrade/Reactivate durch A1/A3a/A3b abgedeckt und gruen. (3) Alle drei `INSERT INTO tenant`-Pfade setzen `status` explizit -> geaenderter Column-Default ist rein defensiv. (4) Plan-Card-Umbau bewahrt Event-Verdrahtung: `querySelectorAll('[data-plan]')` trifft weiterhin genau die 2 Buttons. `PLAN_PRICES` als `Object.freeze`-Konstante (G25). Kommentare deutsch ohne Umlaute.

---

## Fix-Runden

Keine. Beide Reviews (Safety + Clean-Code) waren beim ersten Durchlauf PASS/APPROVED — kein Self-Fix-Zyklus noetig.

## Top-To-dos (Folge-Arbeit, NICHT Teil p6-funnel)

1. **S3-1:** Anzeige-Preis nicht in `tenant.html` hartkodieren — Betrag aus Backend (config/Stripe) liefern, sonst Drift Anzeige vs. tatsaechliche Abbuchung (wichtigster Punkt).
2. **S3-2:** Vor dem naechsten Plan-Tier entscheiden, ob die Plan-Liste ueber EINEN Endpoint zentralisiert wird (gegen Shotgun-Surgery).
3. **Bewusstsein (kein Fix noetig):** Neuer Schema-DEFAULT `suspended` greift auf Bestands-DBs NICHT (`ADD COLUMN IF NOT EXISTS` ueberspringt; Default bleibt dort `active`). Harmlos, da alle INSERTs `status` explizit setzen — im Kommentar dokumentiert.
4. **Vorab-Inkonsistenz bestaetigen:** `config.js:131` kommentiert die Stripe-Price-Ids aktuell als „USD", `PLAN_PRICES` zeigt EUR — als Vorab-Inkonsistenz zu pruefen (nicht p6-funnel-Scope).
