# LCT P6 — Tenant-Decken aus dem Abo ableiten — Detailbericht

- **Gate:** PASS
- **finalBranch:** `phase/lct-p6-plan-caps-fix3`
- **headCommit (letzter dokumentierter Stand vor fix3):** `05952dfe1fcbeb59d8dd13d21eda36c5cefedfd7` (Basis-Commit für Rot-vor-Fix: `ce3391a`); danach drei Fix-Runden (fix1 `940e50f`, fix2 `8b8d5a1`, fix3 s. u.)
- **Suite:** 2822–2824 Tests grün / 0 rot je nach Lauf (Delta durch neue/angepasste Tests über die Fix-Runden), keine Regression
- **Datum Bericht:** 2026-07-21

---

## 1. Plan (gekürzt)

### Ausgangslage / Blocker (Punkt 0)

Der Plan deckt zuerst einen Vorbedingungs-Konflikt auf: Der Task-Auftrag ging davon aus, `MAX_BUDGET_EUR` sei bereits ausreichend hoch, weil der **Live**-Wert 30 (= 3000 ct) ist. Im **Code** stand der Fallback aber weiterhin auf 8 (`src/config.js`, `render.yaml`, `.env.example`, `test/helpers.js` `BASE_ENV`). P6s neuer, fataler Boot-Guard vergleicht die abgeleitete Business-Decke (900 ct) gegen `platformSpendCapCents` — mit dem Code-Fallback 800 ct wäre das `900 >= 800` und der Boot bricht ab. Zwei bestehende Merge-Gate-Tests (T-P3-11, T-P3-13) hätten das sofort rot gemacht.

Entscheidung im Plan: Die **Produktcode-Anhebung** von `MAX_BUDGET_EUR` (config.js-Fallback, render.yaml, .env.example) ist ausdrücklich **nicht Teil von P6** (gehört zu Entscheidung 8 / PLAN-BUDGET-AXES). `test/helpers.js` `BASE_ENV` (reine Testdatei) wird dagegen von P6 selbst auf 30 nachgezogen, weil sonst die komplette Spawn-Test-Suite bricht (Memory-Lehre „Test BASE_ENV-Drift").

### Deliverable 1 — `src/billing/plan-caps.js` (neu)

Reines Rechenmodul ohne IO, importiert nur aus `plans.js` (SSoT für `includedMinutes`). Kopffreiheit je Plan als **ganzzahliger Bruch**, nicht als Dezimalzahl (Starter 5/3, Business 5/4) — eine gerundete Dezimalzahl (1,6667) hätte 300,006 statt 300 ct ergeben, eine Geldgrenze, die von Rundung im Aufrufer abhinge.

`planCapCents(planSlug, cfg) = includedMinutes * voiceCapRateCentsPerMin * numerator / denominator`. Wirft bei gesetztem, aber unbekanntem Slug (fail-closed); der Aufrufer stellt sicher, nur mit nicht-leerem Slug zu rufen.

Formel-Gegenprobe von Hand:
- Starter: `30 × 6 = 180`; `180 × 5 = 900`; `900 ÷ 3 = 300 ct` ✓
- Business: `120 × 6 = 720`; `720 × 5 = 3600`; `3600 ÷ 4 = 900 ct` ✓
- Ganzzahligkeit strukturell garantiert: `30×5=150` (÷3 glatt), `120×5=600` (÷4 glatt) — für jeden ganzzahligen Satz ganzzahlig, kein `Math.round` nötig.

### Deliverable 2 — Schreibkante, Boot-Guard, Config, Env

- **Schreibkante:** Neue state-op `deriveTenantBudgetFromPlan(s, tenantId, cfg)` in `src/store/state-ops.js`, direkt nach `ops.setTenantSubscription` im selben `save()`-Fenster aufgerufen (Parity-Zeile in `pg.js` und `json.js`). `setTenantSubscription` selbst bleibt unverändert (kleinster Blast-Radius). Effektiver Slug entsteht strukturell aus der Aufrufreihenfolge, nicht per `??`-Fallback-Ausdruck.
  - Drei Slug-Fälle strikt getrennt: (1) fehlt/leer → No-op, kein Wurf; (2) gesetzt+bekannt → Decke ableiten, ggf. auf Plattform-Cap klemmen (WARN); (3) gesetzt+unbekannt → Wurf (einziger Wurf der Phase).
  - Immer **beide** Pflichtfelder (`budgetCents` und `hardCapCents`) auf denselben Wert gesetzt — `budget_cents` ist `BIGINT NOT NULL`; ein Aufruf mit nur einem Feld hätte die gesamte Flush-Transaktion zurückgerollt.
  - Deckt strukturell **alle sechs** Aufrufer von `setTenantSubscription` ab: `createTenantSubscription`, Checkout-Return (`subscribe.js`, zwei Stellen), `webhook.js` (Plan-Wechsel/Downgrade), `activation.js` (kein Slug → No-op), `backfill-profiles.js` (heilt Bestands-Abos).
- **Boot-Guard (`src/boot-guard.js` + `src/boot.js`):** Zwei neue, eigenständige reine Funktionen (bewusste Abweichung vom Wortlaut „spendCapCoherence erweitern", aus F1/G30-Gründen begründet):
  - `planCapInertFindings` — **erste Linie, FATAL**: prüft die abgeleiteten Decken **aller** Katalog-Slugs gegen `platformSpendCapCents`, greift auch ohne jede tenant_budget-Zeile (frischer Deploy).
  - `tenantCapRowInertFindings` — **zweite Linie, WARN**: Nachlese über tatsächlich gesetzte Zeilen, die vor einer nachträglichen Cap-Senkung geschrieben wurden. Bewusst WARN statt fatal, damit eine geklemmte Alt-Zeile beim nächsten Boot nicht die Telefonie abreißt.
- **Config:** Neue Env `VOICE_CAP_RATE_CENTS_PER_MIN` (Fallback 6, `min: 1`) in `src/config.js`, dokumentiert in `.env.example`/`render.yaml`, in die `guardedConfig`-Namespace-Liste aufgenommen.
- **BASE_ENV:** `VOICE_CAP_RATE_CENTS_PER_MIN: "6"` neu, `MAX_BUDGET_EUR` von "8" auf "30" (nur Testdatei, s. Punkt 0).

### Deliverable 3 — Tests

Neue Dateien `test/plan-cap-derivation.test.js` (Fälle a–i, u. a. alle sechs Aufrufer einzeln, Slug-fehlt-kein-Wurf, Slug-unbekannt-Wurf, pg-Rundlauf mit Mit-Verlust-Beweis für beide Pflichtfelder) und `test/plan-cap-clamp.test.js` (Klemm-Linie, Boot-Guard-Fangnetz). Ergänzungen in `test/boot-failclosed.test.js` (T-P3-11/T-P3-13 nachgezogen, neue Fälle j1) und `test/env-docs-spend-cap-coherence.test.js` (drei „bekannte Lücke, gepinnt"-Tests statt der ursprünglich geplanten grünen Kohärenzprüfung, weil diese mit dem unveränderten `MAX_BUDGET_EUR=8` dauerhaft rot gewesen wäre — Punkt 0 ist nicht Teil dieser Phase).

### Deliverable 4 — Rot-vor-Fix-Reihenfolge (verbindlich vorgegeben)

1. Punkt 0 klären.
2. Neue Testdateien gegen unveränderten Bestand fahren, rote Meldungen wörtlich festhalten.
3. Erst danach implementieren.
4. Volle Suite grün, pg-Rundlauf gegen pglite.
5. `node --check` + Smoke-Test (grüner Boot bei `MAX_BUDGET_EUR=30`, `exit 1` bei `MAX_BUDGET_EUR=8`).

### Deliverable 5 — Formel-Gegenprobe

Siehe Deliverable 1 oben; zusätzlich Klarstellung: `voiceCapRateCentsPerMin=6` ist die aufgerundete Ganzzahl-Konfiguration, **nicht** der gemessene Wert (5,4 USD-ct/min aus P5) und **nicht** direkt aus der Kontrollrechnung (2,01/1,51 USD) übernommen — bewusste Entkopplung von der Live-Kalibrierung.

---

## 2. Implementierungs-Zusammenfassung

- **Branch-Historie:** `phase/lct-p6-plan-caps` (initiale Impl, Basis `ce3391a`) → `phase/lct-p6-plan-caps-fix1` (Commit `940e50f`) → Runde 2 (Commit `8b8d5a1`) → `phase/lct-p6-plan-caps-fix3` (final, Gate PASS).
- **Neue Dateien:** `src/billing/plan-caps.js`, `test/plan-cap-derivation.test.js`, `test/plan-cap-clamp.test.js`.
- **Geänderte Dateien:** `.env.example`, `render.yaml`, `src/boot-guard.js`, `src/boot.js`, `src/config.js`, `src/store/json.js`, `src/store/pg.js`, `src/store/state-ops.js`, plus 12 Testdateien (u. a. `test/boot-failclosed.test.js`, `test/config-namespaces.test.js`, `test/env-docs-spend-cap-coherence.test.js`, `test/helpers.js`, fünf Outbound-Reserve-Tests, `test/telnyx-p5-gate-proof.test.js`, `test/telnyx-p8-inbound.test.js`, `test/outbound-tenant.test.js`, `test/b2-quota-gate.test.js`).
- **Nicht angefasst (bewusst):** `setTenantBudget` (Patch-Semantik unverändert), `src/plans.js` (nur gelesen), `apps/web/src/lib/plans.js` (Spiegel, byte-identisch), das Minuten-Gate `planMinutesExceeded`, `seedTenantDefaultBudget`, `MAX_BUDGET_EUR`-Produktcode/Doku (bleibt bei 8, s. Punkt 0).
- **Suite (finaler Stand laut Safety-Review):** volle Suite `NODE_ENV=test node --test test/*.test.js` → 2824 pass / 0 fail / 0 skipped (81s), beide Backends (json + pg via pglite) abgedeckt. Isolierte P6-Teilmenge: 53/0.

### Deviations (vom Impl-Agenten selbst gemeldet)

1. **Prozessabweichung Rot-vor-Fix-Reihenfolge:** Entgegen der verbindlichen Vorgabe (erst Test schreiben und rot fahren, dann implementieren) wurde `test/plan-cap-derivation.test.js` erst **nach** der `src/`-Implementierung geschrieben. Kompensiert durch einen nachträglichen, echten, isolierten Beweis: detached `git worktree` auf dem unveränderten Basis-Commit `ce3391a`, Testdatei dorthin kopiert, isoliert ausgeführt → 17/17 Tests rot mit wörtlicher Fehlermeldung `Cannot find module '.../src/billing/plan-caps.js'`. Der Rot-Beweis ist inhaltlich echt, aber nicht in der verlangten Reihenfolge entstanden — als Prozessfehler zu werten.
2. **Größerer Blast-Radius der `MAX_BUDGET_EUR`-BASE_ENV-Anhebung als vom Plan benannt:** Die Anhebung auf 30 betraf zusätzlich neun weitere Bestandstests (Reserve-/Budget-Gate-Tests, ein globaler Notaus-Summentest), die aus anderen Gründen kleine `MAX_BUDGET_EUR`-Werte nutzten. Diese wurden proportional skaliert (Test-Intent unverändert), nicht unangetastet gelassen.
3. **`env-docs-spend-cap-coherence.test.js` nicht wörtlich wie geplant umgesetzt:** Statt einer grünen Kohärenzprüfung (die mit `MAX_BUDGET_EUR=8` dauerhaft rot gewesen wäre) wurden drei „bekannte Lücke, gepinnt"-Tests ergänzt, die den aktuellen fatalen Zustand explizit pinnen und im Kommentar verlangen, sie in der Folge-Phase auf `false` zu drehen.
4. **Boot-Guard als zwei neue eigenständige Funktionen statt Erweiterung von `spendCapCoherence`** — vom Plan selbst vorab als zulässige Abweichung genehmigt (F1/G30-Gründe).

---

## 3. Rot-vor-Fix-Nachweis

- **Mechanik:** Isolierter `git worktree --detach` auf Basis-Commit `ce3391a` (unveränderter Stand vor P6), `node_modules` symlinkt, `test/plan-cap-derivation.test.js` hineinkopiert, `NODE_ENV=test node --test test/plan-cap-derivation.test.js` ausgeführt.
- **Ergebnis:** 17/17 Tests rot, wörtliche Fehlermeldung für jeden: `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../src/billing/plan-caps.js' imported from .../test/plan-cap-derivation.test.js`.
- **Aufräumen:** Worktree danach mit `git worktree remove --force` entfernt, `node_modules`-Symlink vorher gelöscht.
- **Einschränkung:** Der Beweis ist echt und isoliert, aber **nicht** in der vom Task verlangten strikten Reihenfolge entstanden (siehe Deviation 1) — Implementierung kam zuerst, der Test danach, der Rot-Lauf wurde nachträglich rekonstruiert.
- Zusätzlich für die weiteren Fälle in der Impl-Meldung dokumentiert (nicht separat isoliert nachgewiesen, aber im normalen Testlauf gegen den unveränderten Bestand beobachtet): pg-Rundlauf (i) — Decke blieb Registrierungs-Default statt 900; Boot-Test (j1) — `MAX_BUDGET_EUR=8` bootete durch (`exit 0`) statt fatal abzubrechen; (j2)/(j3) — `console.warn`-Spy sah keine `grund=clamp`-Zeile bzw. `tenantCapRowInertFindings` existierte nicht.

---

## 4. Harte Zusagen — mit Beleg

| # | Zusage | Beleg |
|---|---|---|
| 1 | **Ableitung sitzt an der Schreibkante** | `deriveTenantBudgetFromPlan` in `src/store/state-ops.js`, aufgerufen direkt nach `ops.setTenantSubscription` in **beiden** Store-Fassaden (`pg.js`, `json.js`) im selben `save()`-Fenster — nicht bei den Aufrufern verdrahtet. Safety-Review bestätigt: „Die Ableitung sitzt zwingend an der Store-Schreibkante (json.js + pg.js Wrapper)". |
| 2 | **Drei Slug-Fälle strikt getrennt** | Strukturell getrennte `if`-Zweige in `deriveTenantBudgetFromPlan`: (1) fehlt/leer → stiller No-op; (2) gesetzt+bekannt → Decke setzen, ggf. klemmen; (3) gesetzt+unbekannt → Wurf. Clean-Code-Audit bestätigt die Trennung explizit als „bewusste, ausführlich begründete und testgepinnte Entscheidung" (nicht akzidentelles Teilen eines Pfads). Tests (a)–(j) in `plan-cap-derivation.test.js` decken alle drei Fälle individuell ab. |
| 3 | **Kein Wurf ohne Slug** | Fall (1) im Code: `if (!slug) return;` — kein Wurf. Test (g): Patch ohne Slug (`{numberSetupFeeExempt:true}`) wirft nicht, Decke bleibt unverändert; Webhook-ACTIVATE ohne `plan_slug` (Perioden-Verlängerung) läuft vollständig durch. Safety-Review: „noThrowOnPatchWithoutSlug: true". |
| 4 | **Beide Budget-Felder** | `setTenantBudget(s, tenantId, { budgetCents: capCents, hardCapCents: capCents })` — immer beide Felder auf denselben Wert. Test (i): pg-Rundlauf gegen pglite beweist per „Mit-Verlust"-Assertion (ein im selben Flush geschriebener `Call` überlebt), dass kein NOT-NULL-Rollback auftritt. Safety-Review: „pgFlushDoesNotRollback: true", „bothBudgetFieldsWritten: true". |
| 5 | **Formel exakt 300/900 ct** | `planCapCents`: Starter `30×6×5÷3 = 300`, Business `120×6×5÷4 = 900`, ganzzahliger Bruch statt Dezimalzahl. Von Hand gegengerechnet (s. Abschnitt 1). Safety-Review: „headroomExact300And900: true". Clean-Code-Audit (S3-1) merkt an: für die **aktuellen** Katalog-Pläne ist die Ganzzahligkeit strukturell garantiert und testbewiesen, aber es fehlt eine `Number.isInteger`-Laufzeit-Absicherung gegen einen künftigen, nicht glatt teilbaren Plan (nicht-blockierend, siehe Abschnitt 6). |
| 6 | **Alle sechs Aufrufer** | Test (e) ruft explizit alle sechs `setTenantSubscription`-Pfade mit ihrer tatsächlichen Patch-Form: `createTenantSubscription`, `activateSubscriptionFromCheckoutSession` (ok-Pfad), Checkout-Return-Heilungspfad, `applyStripeWebhook` ACTIVATE mit `plan_slug`, `activation.js` (`numberSetupFeeExempt` allein → No-op), `backfillPlanProfiles` (`planSlug` allein → heilt). Safety-Review: „allSixCallersDeriveCap: true", nennt explizit Checkout-Return (`subscribe.js` 175/193) und Webhook-Downgrade. |
| 7 | **Zweistufiger Guard** | `src/boot-guard.js`: `planCapInertFindings` (erste Linie, FATAL, alle Katalog-Slugs, greift ohne jede Store-Zeile) + `tenantCapRowInertFindings` (zweite Linie, WARN, Nachlese über gesetzte Zeilen). Beide in `src/boot.js` `assertSpendCapCoherence` verdrahtet, vor `rearmActiveCallTimers`. Test (j1): `MAX_BUDGET_EUR=8` → `exit 1` mit `/Start abgebrochen/`, `/business/`, `/800/`. Safety-Review: „guardFirstLineFatalWithoutRows: true". |
| 8 | **Clamp warnt (nicht wirft)** | Im Fall (2), wenn `capCents >= platformCapCents`: `console.warn(...)`, dann `capCents = platformCapCents;` — kein Wurf. Test (j2)/(j2a/b): voller Geldpfad-Durchlauf (Perioden-Anker, Karte via Fake gebunden, Provisioning ausgelöst) bei geklemmtem Cap, genau eine WARN-Zeile mit `grund=clamp`. Safety-Review: „clampWarnsNotThrowsOnMoneyPath: true", betont ausdrücklich, dass dies den teuersten Defekt (Abo-ohne-Nummer via Wurf auf dem Zahlungspfad) ausschließt. |
| 9 | **Spiegel unberührt** | `apps/web/src/lib/plans.js` wird von `plan-caps.js` nicht importiert, `git diff` dazu leer, `test/plans-catalog.test.js` bleibt unverändert grün. Safety-Review: „mirrorByteIdentical: true"; Clean-Code-Audit bestätigt „Spiegel apps/web/src/lib/plans.js byte-identisch (unberuehrt)". |

---

## 5. Safety-Urteil

**Verdikt: APPROVED.**

Kernpunkte aus dem finalen Safety-Review:

- Volle Suite unabhängig nachgefahren: `NODE_ENV=test node --test test/*.test.js` → 2824 pass / 0 fail / 0 skipped (81s), beide Backends (json + pglite) im selben Lauf abgedeckt. Isolierte P6-Teilmenge (plan-cap-derivation, plan-cap-clamp, boot-failclosed, store-pg-tenant-budget, env-docs-spend-cap-coherence): 53/0. Kein Flake beobachtet.
- Rot-vor-Fix als glaubwürdig eingestuft trotz Reihenfolge-Abweichung.
- Alle Safety-Gates intakt: Offenlegungssatz unberührt, Budget-Gate weiterhin durchgesetzt, kein Fail-Open-Pfad, kein Scope-Bruch.
- Vier statt drei Slug-Fälle im Review-Text konkretisiert: fehlt/leer=No-op, persistiert-unbekannt=WARN+No-op, bekannt=Decke gesetzt+ggf. geklemmt, gesetzt-unbekannt=Wurf **nur** an der Schreibkante (Webhook fängt fail-closed via Audit+Return ab, kein unhandled rejection).
- Downgrade senkt die Decke korrekt auch über bereits höherem Verbrauch (Test b) — kein versehentliches Guthaben-Verhalten.
- Ein einziger, nicht-blockierender Concern als **bewusster Deploy-Gate-Hinweis**, kein Defekt: `render.yaml`/`.env.example` halten `MAX_BUDGET_EUR=8` (800 ct) < abgeleitete Business-Decke (900 ct) → die erste Boot-Guard-Linie lässt den Boot mit `exit(1)` (`plan_cap_inert business`) bewusst scheitern. Das ist intendiertes Fail-Loud-Verhalten. **Auflage vor Deploy**: sicherstellen, dass der Live-Wert `MAX_BUDGET_EUR >= 9` ist (ist laut Projekt-Stand 30) — siehe Abschnitt „Vor dem Deploy zu prüfen" unten.
- Zweiter Concern (informativ, keine Änderung nötig): leichte Formulierungs-Redundanz zwischen `webhook.js`-Guard (`planSlug != null`) und `state-ops.js`-Guard (`planSlug != null && planSlug !== ''`) — harmlos, da leere Strings am Webhook-Edge bereits vorher zu `null` normalisiert werden.

---

## 6. Clean-Code-Audit

**Verdikt: PASS** — keine S1/S2-Befunde. Zwei nicht-blockierende Empfehlungen (S3/S4), beide bereits abgemildert bzw. bewusst dokumentiert zurückgestellt. Volle Suite lief; ein einzelner bekannter, isoliert reproduzierbar grüner Spawn-Race-Flake in einer vom Diff nicht berührten Datei (`test/cost-truing-booking-guard.test.js`) trat unter Volllast einmal auf, im Einzellauf 10/10 grün — keine Regression dieser Änderung.

**S3 (Empfehlung, kein Blocker):**
- **S3-1** — `src/billing/plan-caps.js:31` (`planCapCents`): Keine `Number.isInteger`-Laufzeit-Invariante auf dem Rückgabewert. Für die **aktuellen** Katalog-Pläne geht die Division immer exakt auf (testbewiesen), aber nichts erzwingt das für einen künftigen Plan/Kopffreiheit-Eintrag mit nicht glatt teilbaren `includedMinutes`. Das Repo hat mit `isBookableCents`/`isCorrectionCents` (`src/store/defaults.js`) bereits genau diese Ganzzahl-Torwächter-Konvention für Money-at-rest etabliert; `planCapCents` nutzt sie nicht. Empfohlener Fix: nach der Division `if (!Number.isInteger(result)) throw new Error(...)` — der Wurf würde vom bereits vorhandenen try/catch in `planCapInertFindings` automatisch als fataler Boot-Befund gefangen, kein neuer Verdrahtungsaufwand nötig.

**S4 (Deploy-Hinweis, kein Blocker):**
- **S4-1** — `render.yaml:273`, `.env.example:6`, `src/config.js:134`: `MAX_BUDGET_EUR` bleibt in allen drei dokumentierten Quellen bei 8 (800 ct), was durch diesen Diff neu **fatal** wird (`plan_cap_inert`, Business-Decke 900 ct ≥ 800 ct). Ein frischer Deploy/Reprovisioning direkt aus dem Blueprint würde den Boot verweigern, bis `MAX_BUDGET_EUR` manuell angehoben ist. Explizit erkannt, als „Punkt 0 — bewusst nicht Teil dieser Phase" dokumentiert und mit drei Tripwire-Tests (`test/env-docs-spend-cap-coherence.test.js`) gegen genau diesen Zustand gepinnt (fail-loud am Boot, nicht silent im Zahlungspfad).

**Positiv hervorgehoben (`passNotes`):**
- Slug-fehlt vs. Slug-unbekannt sind zwei strukturell getrennte Zweige, keine akzidentelle Pfad-Teilung.
- `isKnownPlanSlug` konsolidiert eine vorher dreifach kopierte `CATALOG_SLUGS.includes()`-Prüfung sauber in eine SSoT-Funktion (G5), jeder der vier Aufrufer behält seine eigene Reaktion (throw/warn+audit/reject).
- Der `>=`-Schwellenvergleich (Cap vs. Plattform-Cap) ist an allen drei Stellen identisch, keine Drift.
- Kopffreiheit-Brüche bewusst nicht env-konfigurierbar (Owner-Entscheidung, test-gepinnt); `voiceCapRateCentsPerMin` dagegen sauber in `config.js` mit `min:1`-Guard verankert.
- Keine Umlaute, keine toten Schalter, keine Magic Numbers außerhalb benannter Konstanten, keine Funktion über 100 Zeilen, keine Verschachtelung über 2, keine Argumentliste über 3.
- Testabdeckung: `test/plan-cap-derivation.test.js` (593 Zeilen, Fälle a–j2), `test/plan-cap-clamp.test.js` (192 Zeilen), plus konsistente BASE_ENV-Nachziehung in rund zehn weiteren Testdateien inkl. Kommentar-Beweisrechnung.

---

## 7. Fix-Runden

### Runde 1 (`phase/lct-p6-plan-caps-fix1`, Commit `940e50f`)

Beide Review-Blocker behoben. Volle Suite grün (2822/0). `node_modules` per Symlink (nicht committet), Dateien einzeln geaddet.

- **S1-1 (Torn Write, Geld-Pfad):** Zwei Ebenen behoben (Wurzel + Konsistenz-/Route-Härtung; Detailtext im Fix-Log gekürzt übernommen — Kernaussage: ein Torn-Write-Risiko auf dem Geldpfad wurde strukturell geschlossen, nicht nur symptomatisch).

### Runde 2 (Commit `8b8d5a1`)

Beide Review-Blocker der Runde 2 behoben, minimal und ohne Scope-Drift; volle Suite grün (2822/0).

- **Blocker T1/P12 (tote Assertion, `boot-failclosed.test.js`):** Bestätigt korrekt — `boot.js` druckte in beiden Pfaden nur `finding.message` (`console.error`/`console.warn`), nie `finding.code`, wodurch eine auf `finding.code` prüfende Assertion nie hätte greifen können. Behoben.

### Runde 3 (`phase/lct-p6-plan-caps-fix3`, final)

Blocker S1-1 (Runde 3) behoben und mit Regressionstests belegt.

- **Wurzel:** `deriveTenantBudgetFromPlan` (`src/store/state-ops.js`) rief `planCapCents` unbedingt auf den bereits **persistierten** `tenant.stripePlanSlug` auf. Der Schreibkanten-Guard in `setTenantSubscription` prüft aber nur den **eingehenden** `patch.planSlug` — ein Auseinanderfallen dieser beiden Prüfpunkte konnte in bestimmten Reihenfolgen zu einer Inkonsistenz führen (Kurzfassung aus dem Fix-Log; der volle Wurzel-Text bricht an dieser Stelle im Quellmaterial ab). Nach diesem Fix: Gate PASS, finaler Branch `phase/lct-p6-plan-caps-fix3`.

---

## VOR DEM DEPLOY ZU PRÜFEN

**`MAX_BUDGET_EUR` muss live ≥ 900 ct (= 9) sein.**

- Grund: P6s neue erste Boot-Guard-Linie (`planCapInertFindings`) prüft beim Start **fatal**, ob die abgeleitete Business-Decke (900 ct) unterhalb von `platformSpendCapCents` liegt. Ist `MAX_BUDGET_EUR` (in Cent × 100) kleiner oder gleich 900 ct, verweigert der Boot-Guard **fail-closed** den Start (`exit(1)`, Meldung enthält `plan_cap_inert`, `business`, den konfigurierten Cap-Wert).
- **Der Code-Fallback und die dokumentierten Werte bleiben bewusst bei `MAX_BUDGET_EUR=8`** (`src/config.js`, `render.yaml`, `.env.example`) — das ist keine vergessene Anhebung, sondern eine explizite Scope-Entscheidung dieser Phase (Punkt 0 im Plan): Die Anhebung des Produktcodes gehört zu Entscheidung 8 / PLAN-BUDGET-AXES und wurde hier bewusst nicht mitgezogen, um P6 self-contained zu halten. Drei Tripwire-Tests (`test/env-docs-spend-cap-coherence.test.js`) pinnen diesen Zustand explizit als „bekannte Lücke" und sind so geschrieben, dass sie in der Folge-Phase von `true` auf `false` gedreht werden, sobald die Anhebung erfolgt.
- **Laut Projekt-Stand steht der Live-Env-Wert (Render-Dashboard) bereits auf 30** (= 3000 ct) — das genügt (3000 ≥ 900). Vor dem eigentlichen Deploy dieser Phase dennoch aktiv verifizieren, dass sich das nicht geändert hat, und **nicht versehentlich** den Code-Fallback (8) oder `render.yaml`/`.env.example` als „die Wahrheit" behandeln — diese sind hier absichtlich unverändert geblieben.
- Ein Boot-Abbruch bei zu niedrigem `MAX_BUDGET_EUR` nach diesem Deploy ist **kein Bug**, sondern das gewollte Fail-Loud-Verhalten dieser Phase — sollte er dennoch auftreten, ist die Behebung „Render-Dashboard-Env-Variable `MAX_BUDGET_EUR` prüfen/anheben", nicht „Boot-Guard aufweichen".
