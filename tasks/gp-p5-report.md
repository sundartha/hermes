# GP-P5 — Detailbericht

**Gate: PASS** · finalBranch: `gp/p5`

Phase GP-P5: R4-Kommentar auf das korrigieren, was der Code tut (reine Kommentarkorrektur in `src/onboarding.js`, keine Verhaltensaenderung).

---

## 1. Plan (gekuerzt)

Charakter der Phase: reine Kommentarkorrektur in **genau einer** Datei (`src/onboarding.js`), kein Verhalten, keine Signatur, keine Konfiguration, kein Test. Blast-Radius = 1 Kommentarblock.

**Ausgangsbefund:** Der bestehende `R4-PRAEZISIERUNG (GAP-11)`-Kommentar behauptete, die Einrichtungsgebuehr sei per Konfiguration abgeschaltet und der Kunde zahle nur sein Abo. Das ist falsch: `settleSetupFeeHold` zieht die Gebuehr ein, sofern der Mandant nicht `numberSetupFeeExempt` ist; bei `PAYMENT_ENABLED=true` erzwingt der Boot-Waechter einen ganzzahligen `NUMBER_SETUP_FEE_CENTS > 0`; der tatsaechlich gebuchte Betrag kommt aus `holdAmountForProviderPrice` (Provider-Einmalpreis, sonst Pauschale) und ist nie 0; die Befreiung stammt aus `invoiceTotal === 0` in `retrieveSubscription` (fail-closed); der Betrag wird dem Kunden vor dem Checkout angezeigt (`numberSetupFeeCentsFor`).

**Edit:** Ersetzung des Kommentarblocks unmittelbar vor `import { ... } from './store/state-ops.js'` — nichts davor/danach angefasst. Der neue Text nimmt die ueberholte R4-Position vom 2026-07-28 explizit zurueck, referenziert die Owner-Entscheidung vom 2026-09-11 (Geldpfad-Plan 3.2) und erhaelt die drei weiterhin wahren Aussagen (searchNumbers read-only, "kein KAUF ohne reserviertes Geld", akzeptiertes Restrisiko).

**Tests:** keine neue/geaenderte Testdatei — bewusst, das ist Abnahmekriterium 4 (Bestandssuite bleibt ohne Test-Aenderung gruen). Betroffene Dateien: `test/gap-05-number-hold.test.js`, `test/p4-setup-fee-hold.test.js`, `test/onboarding-service.test.js`, `test/p4-billing-hold-gate.test.js`.

**Deterministische Abnahme:** `node --check`, Grep auf beide verbotenen Zeichenketten (0 Treffer erwartet), gefilterter `git diff` ohne Nicht-Kommentar-Zeilen (0 erwartet), `git diff --stat` (nur `src/onboarding.js`), Bank-gefilterter Testlauf (13/13 gruen erwartet), `npm run lint`.

**Abgrenzung (NICHT Teil der Phase):** keine Aenderung an der Befreiungs-Signalquelle, kein `payment_method_types`, keine Coupon-Allowlist, kein Anfassen von `captureHold`/`cancelHold`/`placeSetupFeeHold`/`settleSetupFeeHold`/`holdAmountForProviderPrice`, keine Config-/Security-Doku-Aenderung, kein Provider-Call.

**Gemeldete, nicht gebaute Befunde:** `placeSetupFeeHold`-Kommentar verengt Befreiung faelschlich auf "100-%-Gutschein" (out of scope); `test/gap-05-number-hold.test.js` ist auf `master` in der Gates-Bank bereits rot (Bestand, kein GP-P5-Regress); stale Kopien der Datei unter `.claude/worktrees/` bleiben unangetastet.

---

## 2. Impl-Zusammenfassung

- headCommit: `d69ff9f5b75b608bfc081316d04e620a1e8cda6a`
- `node --check src/onboarding.js`: PASS
- Tests: 13 pass / 0 fail
- committed: ja
- filesEdited: `src/onboarding.js` (einzige Datei)
- filesCreated: keine
- testsAddedOrChanged: keine (nur gefahren zur Verifikation: `test/gap-05-number-hold.test.js`, `test/p4-setup-fee-hold.test.js`, `test/onboarding-service.test.js`, `test/p4-billing-hold-gate.test.js`)

Der falsche Kommentarblock ("Einrichtungsgebuehr ist per Konfiguration abgeschaltet") wurde exakt gemaess Plan ersetzt durch die korrekte Beschreibung: Gebuehr wird eingezogen sofern nicht exempt (`settleSetupFeeHold`), Betragsquelle `holdAmountForProviderPrice` (nie 0, Boot-Waechter erzwingt >0 bei `PAYMENT_ENABLED=true`), Einzug/Storno ueber `numberSetupFeeExempt`, Befreiungsquelle `invoiceTotal === 0` fail-closed aus `retrieveSubscription`. Die drei bereits wahren Aussagen (searchNumbers read-only, "kein KAUF ohne reserviertes Geld", akzeptiertes Restrisiko) blieben unveraendert.

Verifiziert: 0 Nicht-Kommentar-Diff-Zeilen (gefiltertes `git diff -U0`), genau 1 Datei geaendert, beide verbotenen Zeichenketten 0 Treffer, keine Nicht-ASCII-Zeichen, laengste Zeile 88 Zeichen (<=100). `npm run lint`: 0 Fehler. Kein Anbieter-Call, kein neues Verhalten, keine Safety-Gate-Beruehrung.

### Deviations

Keine (`deviations: []`).

---

## 3. Safety-Urteil

**PASS / approved: true**

- testsPassIndependently: true (unabhaengig nachgefahren im Review-Worktree; zusaetzlich `test/outbound-e1-onboarding-rollback-guard.test.js` einbezogen: 16 Tests, 15 pass, 1 fail)
- safetyGatesIntact: true
- disclosureIntact: true
- authFailClosedIntact: true
- noSecretsLeaked: true
- scopeRespected: true
- behaviorAsIntended: true

Einziger roter Test: `GAP-05 SOLL: allow_promotion_codes darf nicht bedingungslos gesetzt sein (nur mit expliziter Coupon-Allowlist)` — durch Gegenprobe auf detached `master` (fe7e1bd) als **Bestandsbefund** bestaetigt (dort ebenfalls rot, identischer Testname), kein GP-P5-Regress. Das Katalog-Praefix `GAP-05` matcht `config.i18nCatalogPattern`, gehoert also in die Gates-Bank, die rot sein darf; `npm test` schliesst ihn aus.

Abnahmekriterien 1–3 unabhaengig nachgefahren: beide verbotenen Grep-Treffer = 0 (Positiv-Kontrolle auf `master` = 1), Nicht-Kommentar-Filterkommando = 0 Zeilen, `git diff --name-only` nennt ausschliesslich `src/onboarding.js`, `package.json`/`package-lock.json` 0 Zeilen Diff.

Jede Sachaussage des neuen Kommentartexts wurde einzeln gegen den Code verifiziert (Betragsquelle, Boot-Waechter, Anzeige vor Checkout, Einzug-/Storno-Zweig, Befreiungsquelle samt fail-closed-Default) — alle tragen.

### Concerns (nicht blockierend)

1. **Ortsangabe zweideutig:** "entscheidet `holdAmountForProviderPrice` weiter oben" ist streng genommen ungenau — die Funktion wird erst unterhalb des Kommentarblocks importiert/aufgerufen. Korrekt nur in der Lesart "frueher im Ablauf" (Betrag steht bei Zeile ~117 fest, lange vor `placeSetupFeeHold`/`settleSetupFeeHold`). Vorschlag: "weiter oben" -> "weiter unten im Ablauf (:117)".
2. Der rote Bestandstest (`GAP-05` allow_promotion_codes) liegt inhaltlich auf derselben Achse (Befreiungsquelle/Dauergutschein-Risiko aus `PLAN-GELDPFAD.md` 3.4) — vom Owner am 11.09. bewusst offen gelassen, nicht Auftrag von GP-P5.
3. Alle Sachaussagen einzeln am Code belegt (Fundstellen in `stripe.js`, `activation.js`, `state-ops.js`, `provisioning-geo.js`, `worker/provisioning-orchestrator.js`, `config.js`, `self-service-routes.js`).
4. Abnahmekriterium 4 nur zur Haelfte durch den Safety-Reviewer gedeckt (keine Testdatei angefasst ist bewiesen); der volle `npm test`-Lauf bleibt laut Laufregel Aufgabe des Leads.

---

## 4. Clean-Code-Audit

**Verdict: PASS**, `blocker: false`

- s1: []
- s2: []
- s3: []
- s4: []

Diff = nur Kommentar (35 Zeilen, +22/-13), keine Logikaenderung, kein neuer Codepfad. Verifiziert gegen den tatsaechlichen Code: `holdAmountForProviderPrice`, `numberSetupFeeExempt`, `settleSetupFeeHold`, `retrieveSubscription`/`invoiceTotal === 0` existieren exakt wie im Kommentar beschrieben. Kein `payment_method_types` im Diff, kein neues Befreiungssignal, kein Denylist gegen `link` — bestehendes Signal wird nur dokumentiert, nicht veraendert. `node --check` gruen. Keine Tests noetig, da kein Verhalten geaendert wurde. Der Vorher-Kommentar war stale (widersprach `settleSetupFeeHold`/`numberSetupFeeExempt`) — genau das verlangt C2 ("Ueberholte Kommentare") zu fixen; dieser Diff tut das korrekt.

topTodos: keine offenen Punkte aus diesem Diff — reiner Dokumentations-Fix, sauber.

---

## 5. Fix-Runden

Keine. Die Phase erreichte PASS ohne Fix-Runde (Safety und Clean-Code beide direkt PASS, keine Blocker).
