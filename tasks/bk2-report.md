# Phase BK2 — Checkout-Verkettung: Kachel-CTA → Stripe

| Feld | Wert |
| --- | --- |
| Phase | BK2 (Checkout-Verkettung) |
| Ziel | Kachel-CTA → Stripe, Plan-Mitnahme durch den Karten-Umweg |
| Gate | **PASS** |
| finalBranch | `phase/bk2-checkout-wire` |
| headCommit | `e27a3dfca041cb104e1667803ea95072bf509d1f` |
| Tests | 1062 pass / 0 fail (inkl. 8 neue BK2-Faelle) |
| Status | committed, nicht gepusht |

---

## 1. Kernbefund

Der gefuehrte `no_card`-Flow existiert bereits (P5): Kachel-Klick → `subscribePlan(plan)` → `409 no_card` → `startCardSetup` → Stripe-Checkout → `GET …/billing/return` → bindet Karte → Redirect `/tenant.html?card=ok`.

**Die Luecke:** Nach `return` war der urspruenglich gewaehlte Plan verloren — der Kunde landete mit hinterlegter Karte im Dashboard und musste erneut „Abonnieren" klicken. BK2 schliesst genau diese Verkettung: **Plan-Mitnahme durch den Karten-Umweg, sodass `return` ihn direkt bucht.** Karte-on-file → direkter `subscribe` funktionierte bereits (`w4`/`p5`-Tests gruen).

Blast-Radius: **2 Quell-Dateien + 1 neue Test-Datei.** Kein `server.js`-, kein `subscribe.js`-, kein `config.js`-Change, keine neue Dependency.

---

## 2. Plan (gekuerzt)

**Design-Entscheidung — Plan-Carry via Query-Param** (nicht Web-Session): `setup-checkout` haengt den katalog-validierten Slug an die Stripe-`successUrl` (`&plan=starter`); `return` liest `req.query.plan`. Begruendung: Slug ist oeffentliche Katalog-Daten (`GET /api/plans` ist auth-exempt) → kein Id-/PII-Leak. Session-Carry wuerde den Auth-Session-Store schema-erweitern (grosser Blast-Radius). `return` bucht serverseitig.

**Pre-Mortem (1 Jahr spaeter, BK2 ging schief):**
- *„`return` loest ungewollt Geld aus."* → Dieselben fail-closed Gates wie der direkte Subscribe-POST: `PAYMENT_ENABLED` aus → 404; `webAuthPendingMw` (401/403); `createTenantSubscription` fail-closed (unknown/unconfigured/already_subscribed/no_card); idempotent (Idempotency-Key + `already_subscribed`-Guard). Karten-Bind validiert `session_id` gegen den eigenen Customer (`bindCardFromSession`, 403 bei Mismatch).
- *„Getragener Plan ist Muell/getampert."* → `knownPlanSlug()` validiert gegen `CATALOG_SLUGS` (SSoT). Unbekannt/fehlend → null → reiner Karten-Flow (`card=ok`).
- *„Code-Duplizierung der Buchungs-Sequenz."* → Geteilter Helper `subscribeAndActivate` hinter BEIDEN Eingaengen (Subscribe-POST + return-Glue). Subscribe-Route-Umbau verhaltens-erhaltend → `w4`/`p5`-Bestandstests bleiben OHNE Aenderung gruen.

**Neue Symbole (alle modul-privat in `src/self-service-routes.js`):**
- `knownPlanSlug(raw)` — reiner Selektor, untrusted Input → bekannter Slug oder null (SSoT `CATALOG_SLUGS`)
- `returnSuccessUrl(publicUrl, planSlug)` — baut Stripe-successUrl mit optionalem Plan-Query
- `subscribeAndActivate({…})` — geteilte Buchungs+Aktivierungs-Sequenz, kein HTTP/Audit
- Konstanten `SUB_RETURN_OK` / `SUB_RETURN_FAILED`

**Edits laut Plan:**
- `src/self-service-routes.js` (E1–E5): Import `CATALOG_SLUGS`; Redirect-Konstanten; `setup-checkout` haengt Plan an successUrl; `return` bucht getragenen Plan; `subscribe`-Route auf Helper umgestellt (verhaltens-erhaltend)
- `public/tenant.html` (T1–T3): `startCardSetup(msgEl, plan)` traegt Plan im Body; `subscribePlan` no_card-Zweig reicht Plan weiter; Rueckkehr-Renderer um `?sub=ok|failed` erweitert (`showCardReturn`→`showCheckoutReturn`)
- `test/bk2-checkout-return-plan.test.js` (neu): pglite, kein Server-Spawn, Fake-BillingPort, 8 Faelle

---

## 3. Implementierung — Zusammenfassung

BK2 exakt gemaess Plan umgesetzt. Der bei einem `no_card`-Kachel-Klick gewaehlte Plan wird jetzt durch den Karten-Umweg getragen (`setup-checkout` haengt den katalog-validierten Slug an die Stripe-`successUrl`) und nach `billing/return` direkt gebucht + voll aktiviert (status=active + kyc=CARD + idempotentes Provisioning) — der Kunde muss „Abonnieren" nicht erneut klicken. Geteilte Sequenz `subscribeAndActivate` hinter Subscribe-POST + return-Glue; Subscribe-Route verhaltens-erhaltend refactored. `tenant.html` traegt den Plan durch und rendert `?sub=ok|failed`.

**Verifikation:**
- `node --check` gruen auf beiden geaenderten `.js`
- Volle Suite **1062/1062 pass** (Bestand 1054 + 8 BK2), inkl. `w4`/`p5`/`i9` unveraendert gruen (Refactor-Beweis)
- Commit `e27a3df` auf `phase/bk2-checkout-wire`, `node_modules`-Symlink nicht committet

**Betroffene Pfade (master-relativ):**
- `src/self-service-routes.js` (E1–E5)
- `public/tenant.html` (T1–T3)
- `test/bk2-checkout-return-plan.test.js` (neu, 8 Faelle)

**Test-Faelle:** (1) setup-checkout `{plan:"starter"}` → `&plan=starter` in successUrl; (2) ohne Plan → kein `&plan=` (byte-identisch); (3) `{plan:"gold"}` unbekannt → kein `&plan=`; (4) return `?plan=starter` → `302 /tenant.html?sub=ok` + voller Status-Flip; (5) return ohne Plan → `302 /tenant.html?card=ok`, kein Subscribe; (6) return `?plan=gold` unbekannt → `card=ok`; (7) bereits Abo → `sub=failed`, kein Provision; (8) `PAYMENT_ENABLED:false` → `404`.

### Deviations

1. **Test-Harness — suspended-Seed statt active:** Der PG-Account wird suspended geseedet (kein `accounts.setStatus(active)`), NICHT active wie in `w4-setup()`. Grund: Case 4 assertet `accounts.resolve(SUB).status==='active'` nach dem return-Flow — nur beweiskraeftig, wenn der Account vorher suspended ist (sonst trivial wahr). Modelliert den realen gefuehrten Funnel (suspended → no_card → Karte → Auto-Buchung → active) und beweist den Status-Flip echt. Harness-Struktur sonst identisch zu `w4`/`p5`.

2. **Case 4 ruft setup-checkout NICHT vor dem return auf** — der Customer (`cus_b`) ist bereits via `ops.setTenantStripe` geseedet, sodass `bindCardFromSession` standalone matcht. Haelt den Test auf das return-Glue (Plan-Carry-Buchung) fokussiert; der setup-checkout-Pfad ist separat in Case 1–3 abgedeckt.

3. **Smoke-Test nicht-blockierend fehlgeschlagen** (`smokePass:false`): Worktree-Standalone-Server-Boot konnte ohne `.env`/`DATABASE_URL` (gitignored, nicht in Worktrees kopiert) kein volles `healthz` liefern (`healthz 000`). Umgebungs-Limitierung, kein Code-Defekt — der SHARED-Checkout-Server (identische `server.js`) bootete sauber auf `healthz 200`. BK2-Routen sind ohne OIDC/`SELF_SERVICE_ENABLED`+`MULTI_TENANT` ohnehin nicht gemountet. Autoritativ bleibt `node:test`.

---

## 4. Safety-Urteil

**APPROVED.** BK2 ist sauber und scope-treu. Diff = exakt 3 Dateien, keine neue npm-Dependency, keine `render.yaml`/`.env.example`-Aenderung.

| Absolute Regel | Status |
| --- | --- |
| (1) Safety-Gates intakt | Neue Geld-Behavior auf `GET /return` liegt hinter denselben Gates wie W4 (`webAuthPendingMw` + `PAYMENT_ENABLED`-404 + fail-closed `createTenantSubscription` mit unknown_plan/plan_unconfigured/already_subscribed-Guard/no_card + Idempotency-Key); getragener `?plan=` gegen eingefrorenes `CATALOG_SLUGS` re-validiert; Aktivierung nur bei `result.ok`; `numberGate`/Allowlist/Budget unberuehrt (active ≠ outbound-faehig) |
| (2) Disclosure fest verdrahtet | `claude.js`/`bridge.js` unveraendert, `disclosure-regression` 3/3 |
| (3) Auth fail-closed | Identitaet aus `req.tenant` (Session), nicht aus Query/Body; `GET /return` nicht CSRF/prefetch-ausloesbar |
| (4) Keine Secrets geleakt | Kein `console.log` im Prod-Diff; Audit loggt nur tenant/plan-slug/outcome; `successUrl` traegt nur den oeffentlichen Slug; Redirect-Ziele feste Konstanten (kein Open-Redirect) |
| (5) behaviorAsIntended / flag-off byte-identisch | `PAYMENT_ENABLED` aus → 404 (Test 8); Bare-Card-Flow ohne Plan → successUrl ohne `&plan` (Test 2); return → `card=ok` ohne subscribe (Test 5); W4-Sequenz verhaltens-erhaltend extrahiert |

**Unabhaengige Tests:** Canonical `npm test` (JSON-Default-Backend): **1062 pass / 0 fail**, exit 0. BK2 isoliert: 8/8 pass. `disclosure-regression`: 3/3 pass. Forced `STORE_BACKEND=pg`: 12 Fails (1006 Tests) — bewiesen als vorbestehendes Offline-no-Postgres-Boot-Guard-Artefakt, KEIN BK2-Regress (merge-base `e46842c` hatte 15 solcher Fails, BK2 hat 12; keine der 12 fehlenden Dateien wird vom BK2-Diff beruehrt).

**Concerns (akzeptiert, keine Blocker):**
- Setup-Schritt `ln -s "./node_modules" node_modules` ist self-referenziell → ELOOP/exit 194 (bekannter Worktree-Symlink-Trap, Project-Memory). Via Repoint auf `../../../node_modules` umgangen. Kein BK2-Defekt.
- Neue Geld/State-Logik haengt an `GET /api/self-service/billing/return` (Stripe-Browser-Redirect = zwingend GET). GET-for-mutation milder Smell, hier korrekt verteidigt: braucht gueltige Web-Session, tenant-gebundene Einmal-`session_id` (403 bei Mismatch), Katalog-Validierung, `already_subscribed`-Guard + Idempotency-Key. Nicht CSRF/prefetch-ausloesbar; Card-Binding lag bereits auf diesem GET.
- Forced `STORE_BACKEND=pg` offline rot = by-design (boot-guard fail-closed), unabhaengig von BK2; pglite-In-Process-Tests decken den pg-Pfad ab.

---

## 5. Clean-Code-Audit

**Verdict: PASS — sauber. Keine S1/S2-Befunde. blocker: false.**

| Schwere | Befunde |
| --- | --- |
| **S1** (Blocker) | keine |
| **S2** (Blocker) | keine |
| **S3** (sollte) | 1 |
| **S4** (Beobachtung) | 1 |

**S3 — G11 · Inkonsistente Audit-Event-Namen** (`src/self-service-routes.js` ~244 vs ~272): Der Return-Flow emittiert immer `self_service_subscribe` mit `outcome=ok|<reason>`, der W4-Handler dagegen ZWEI Namen (`self_service_subscribe` bei Erfolg, `self_service_subscribe_rejected` bei Fehler). Gleiche fachliche Fehlerursache (z.B. already_subscribed) erzeugt je nach Pfad unterschiedliche Event-Namen → erschwert Audit-Auswertung. Fix: ein einheitliches Schema (entweder ueberall ein Event mit outcome-Feld, oder ueberall getrennte ok/rejected-Events). **Optional, kein Blocker.**

**S4 — G30/G34 (low) · Gewachsener Return-Handler** (~217–250): Der `billing/return`-Handler traegt jetzt zwei Abschnitte (Karte binden + audit, dann optional Plan buchen+aktivieren+audit+redirect). Domaenenlogik sauber nach `subscribeAndActivate` ausgelagert (kein HTTP/Audit im Helper), Handler bleibt unter den Richtwerten und gut lesbar → bewusste, vertretbare Orchestrierung an der HTTP-Grenze, kein echter Verstoss. Nur Beobachtung.

**Positiv hervorgehoben:**
1. **Duplizierungs-Eliminierung statt -Erzeugung** — `subscribeAndActivate` ist die EINE Quelle hinter Return-Flow UND W4 (G5/S2); W4-Refactor verhaltens-erhaltend (gleiche `createTenantSubscription`→activate-on-ok-Reihenfolge, gleiche result-Shape).
2. **Slug-Validierung gegen `CATALOG_SLUGS`-SSoT** via reinem Selektor `knownPlanSlug` (N7, kein Nebeneffekt); nur der oeffentliche Slug wandert in die URL (kein Stripe-Id-Leak).
3. **Money/Safety** — neuer Pfad voll gegatet; Aktivierung idempotent (`tenantHasLiveNumber`-Guard); Webhook-Backup-Pfad bleibt.
4. **Magic-Strings vermieden** — `SUB_RETURN_OK/FAILED` + `CARD_RETURN_OK/CANCELED` benannt (G25).
5. **Tests** — 8 offline-pglite-Cases, F.I.R.S.T., gute Grenzabdeckung.
6. **Client-Wiring vollstaendig** — bare addCard-Button ruft `startCardSetup(m)` ohne Plan → `{}` → card-only (byte-identisch, Test 2); no_card-Pfad reicht Plan durch.

**Top-Todos (alle optional / Doku):**
1. (S3) Audit-Event-Namen im Subscribe-Pfad vereinheitlichen.
2. (Doku) Eine Exception in `activatePaidTenant` NACH erfolgreicher `createSubscription` liefert im Return-Flow rohen 500 statt `sub=failed` (Pre-existing-Risiko, auch in W4; idempotenter Stripe-Webhook faengt die Aktivierung nach) — als akzeptiertes Risiko in `PLAN-SECURITY.md`/`STATUS.md` vermerken, falls noch nicht.
3. `npm test` gegen die BK2-Tests vor Merge laufen lassen (Worktree-Symlink-Trap beim Audit).

---

## 6. Fix-Runden

Keine. Der duale Review (Safety + Clean-Code) ergab beim ersten Durchlauf **PASS** ohne S1/S2-Blocker — keine Self-Fix-Iteration noetig. Die verbliebenen S3/S4-Befunde sind optional und wurden bewusst nicht im Rahmen von BK2 adressiert (Scope-Treue).
