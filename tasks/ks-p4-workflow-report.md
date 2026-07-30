# KS-P4 — Anzeige an die Gate-Achse binden: Detailbericht

**Gate: PASS**
**finalBranch:** `phase/ks-p4-anzeige-gate-achse-fix1`

## Ziel der Phase

Der negative Fehlbetrag ("es fehlen -1.77 EUR") in den Ablehnungstexten (`tenantBudgetDenial`,
`tenantReserveDenial` in `src/telephony/outbound-gates.js`) wird strukturell unmoeglich gemacht:
`tenantBudgetSnapshot` (`src/store/state-ops.js`) liest kuenftig dieselbe aufgeloeste
Gate-Groesse wie die Gate-Praedikate `budgetExceeded`/`reserveExceedsBudget`, statt der rohen
Lebenszeit-Zahl.

## Spec-Lage (bindend)

`tasks/ks-chain-spec.md` enthaelt fuer KS-P4 keinen eigenen Abschnitt — nur KS-P9, KS-P10, KS-P5a.
Autoritativ waren daher die generischen Regeln am Kopf der Spec (Regel 0: Branch von `master`
zuerst, dann `git rev-parse HEAD == git rev-parse master`, dann erst lesen/testen; kein
Render-Env/Deploy/Prod-DB-Schreibzugriff; nur die eigene Phase; `npm test` gruen,
`test:gates` darf rot sein; neues Verhalten braucht einen Test, der den Bestand rot faerbt) plus
der Abschnitt `### KS-P4` in `PLAN-KOSTEN-STEUERUNG.md`.

## Befund am echten Code (Basis master, 7d5e119)

`tenantBudgetSnapshot` war die einzige Stelle im Modul, die an der Flag-Aufloesung vorbeigriff und
`usageFor(s, tenantId).costCents` (Lebenszeit) statt `gateUsageCents` (Perioden-/Spend-Monat-Fenster)
las. Konsumenten von `spentCents`/`remainingCents` sind repo-weit genau zwei Stellen, beide in
`src/telephony/outbound-gates.js` (`tenantBudgetDenial`, `tenantReserveDenial`).
`src/routes/api-read.js` liest aus dem Snapshot nur `capCents`; `costEur` kommt dort aus
`store.usageOf(...)`, nicht aus dem Snapshot — der Blast-Radius der Phase ist ausschliesslich der
Ablehnungstext.

Reproduktion (strukturell): Gate denies gdw. `spent_gate + reservationFor + reserveCents > cap`.
Gerendert wurde `reserveCents - (cap - spent_snapshot - reservationFor)`. Nur bei
`spent_snapshot === spent_gate` sind beide Aussagen identisch. Der live gemessene Zustand
(4,23 EUR Lebenszeit / 12,84 EUR Spend-Monat, durch `bookCostCorrectionCents` mit negativem
Delta — senkt laut Code nur `costCents`) erzeugte exakt das beobachtete negative Vorzeichen.

## Plan (gekuerzt)

- **Edit A** (`state-ops.js`): neue private Funktion `tenantUsageAxes(s, tenantId, cfg, nowIso)` als
  EINE Quelle (G5) fuer `gateCents` (`gateUsageCents`) und `lifetimeCents`
  (`usageFor(...).costCents`, unabhaengige Gegenprobe). `tenantSpendOrDeny` delegiert darauf.
- **Edit B**: der zweiseitige D7-Riegel wird als log-freies Praedikat `usageAxesBookable({gateCents,
  lifetimeCents})` herausgezogen (G5/G28); `spendOrDeny` delegiert, Log-Verhalten (Feldname+Wert)
  bleibt byte-identisch.
- **Edit C**: `tenantBudgetSnapshot` bekommt `nowIso`-Parameter, liest ueber `tenantUsageAxes` +
  `usageAxesBookable`; bei unbuchbarem Zustand `{spentCents: null, remainingCents: null}`
  (ziffernfreier Sperrtext beim Aufrufer), sonst `spentCents = axes.gateCents`.
- **F1-Ausnahme** (>3 Argumente): `tenantBudgetSnapshot(s, tenantId, cfg, nowIso)` folgt der
  bestehenden Modul-Konvention zeitfreier ops-Funktionen (`budgetExceeded`,
  `reserveExceedsBudget`) — bewusst dokumentierte Ausnahme, kein neues Muster.
- `src/store/json.js` / `src/store/pg.js`: `nowIso` wird an der IO-Grenze per
  `new Date().toISOString()` erzeugt und durchgereicht; Fassaden-Signatur nach aussen unveraendert
  (Wrapper-Parity).
- Nicht angefasst: `src/store.js`, `src/telephony/outbound-gates.js` (Konsumenten bleiben
  zeilengleich), `src/routes/api-read.js`, `src/config.js`, `.env.example`, `render.yaml`,
  `public/*`. Kein neuer Env-Schluessel, keine neue Dependency.
- `PLAN-SECURITY.md`: Restrisiko 3 (GAP-01/P6) als aufgeloest markiert, Folgephase-Verweis
  nachgezogen, neuer Abschnitt `## KS-P4` am Dateiende (Was sich aendert, bewiesene Invariante
  `Gate-Denial ⟺ reserveCents - remainingCents > 0`, Unberuehrtes, getragene Fassaden-Uhr-Kante).
- Test: neue Datei `test/ks-p4-snapshot-gate-axis.test.js` (T1-T7, offline, ops+Gate-Ebene,
  Mutationsprobe gegen master); `test/budget-month-flip.test.js` T10 um `tenantBudgetSnapshot`
  ergaenzt, T11 (Zaehl-Invariante `budgetMonthEnabled` == 2x im Modul) bewusst unveraendert.
- Nicht Teil der Phase: `/api/state`-Anzeige-Semantik (KS-P8), Gutschriften-Asymmetrie (KS-P5),
  0-Boden von `spendMonthCostCents` (KS-P5).

## Impl-Zusammenfassung

- **headCommit:** `2f548eff411b5b958ab2071f6c0fc87fe67a89cf`
- `node --check` fuer alle drei geaenderten `src`-Dateien: PASS
- `npm test`: 3558 pass / 0 fail
- **filesEdited:** `src/store/state-ops.js`, `src/store/json.js`, `src/store/pg.js`,
  `test/budget-month-flip.test.js`, `PLAN-SECURITY.md`
- **filesCreated:** `test/ks-p4-snapshot-gate-axis.test.js`
- **testsAddedOrChanged:** `test/ks-p4-snapshot-gate-axis.test.js` (T1-T7 + T5b, neu);
  `test/budget-month-flip.test.js` T10 (Snapshot in die `countingCfg`-Instrumentierung
  aufgenommen)
- **Smoke-Test:** Server lokal gestartet (json-Backend, `SKIP_TWILIO_SIGNATURE_CHECK=true`),
  `/healthz` → `ok:true`, `GET /api/state` (Basic-Auth) lieferte fehlerfrei den `usageView`-Pfad
  ueber `tenantBudgetSnapshot`. Server danach gestoppt.
- **Ergebnis-Zahlen:** vor dem Fix waren 6/8 Faelle in `ks-p4-snapshot-gate-axis.test.js` rot
  (inkl. dem beobachteten negativen Fehlbetrag), nach dem Fix alle 8 gruen.

### Deviations

1. T5b (Gegenprobe zu T5 — vergiftete Gate-Groesse bei gesundem Lebenszeit-Zaehler) als
   zusaetzlicher eigener `test()`-Block ergaenzt statt implizit im selben Testpunkt — klarere
   Fehlermeldung, kein Verhaltens-/Scope-Unterschied.
2. T7-Regex fuer "kein negativer EUR-Betrag im Text" von `/-\d/` auf `/-\d[\d.]*\s*EUR/`
   praezisiert, weil die naive Fassung faelschlich das Spend-Monat-Enddatum
   (`2026-07-31`) getroffen hatte — reiner Test-Fix, keine Plan-Abweichung in der Aussage.

## Safety-Urteil (final)

**approved: true** — alle Gates intakt (`safetyGatesIntact`, `disclosureIntact`,
`authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`,
`testsPassIndependently`), **keine Blocker**.

Zentrale adversariale Frage (kann die Aenderung einen zuvor blockierten Anruf durchlassen?):
Nein — `tenantBudgetSnapshot` ist rein lesend und wird in `outbound-gates.js` ausschliesslich
NACH einer bereits erfolgten Gate-Ablehnung aufgerufen; der neue D7-Riegel ist eine echte
Obermenge der alten Bedingung (`isBookableCents(gate) && isBookableCents(lifetime)` statt nur
`isBookableCents(lifetime)`), also strukturell kein Fail-Open moeglich. Der Invarianzbeweis
haelt algebraisch (`missing = gateCents + reservationFor + reserveCents - cap`, identisch zur
Gate-Bedingung).

Unabhaengiger Review-Lauf (frischer Worktree, `master` als Vorfahre bestaetigt): `npm test`
3559/3559 gruen; gezielter pg-Fassaden-Zusatzlauf 92/92 gruen; `test:gates` 129/126 pass / 3 fail
(GAP-05, GAP-15×2) — identisch zur Baseline auf frischem `master`-Branch, also keine
Gates-Regression durch die Phase; `git diff --numstat` bestaetigt engen Scope (nur die
gelisteten Dateien, keine neue Dependency); Secret-Grep im Diff: 0 Treffer.

### Concerns (unterhalb Blocker-Schwelle)

1. Kommentar-Anschluss verrutscht in `state-ops.js` (der alte ~20-zeilige Doc-Block zu
   `spendOrDeny` geht ohne Leerzeile in den neuen `usageAxesBookable`-Kommentar ueber) — rein
   optisch, kein Verhalten.
2. Getragene Kante (bewusst, dokumentiert, per Test gepinnt): `store.reserveExceedsBudget` und
   `store.tenantBudgetSnapshot` erzeugen an der Fassade je ein eigenes
   `new Date().toISOString()`. Faellt zwischen beide Aufrufe eine UTC-Monatsgrenze UND steht
   `BUDGET_MONTH_ENABLED` auf `true`, kann der Ablehnungstext theoretisch noch einen (dann nur
   zu grossen, nie negativen) Fehlbetrag zeigen. Live-Wert des Flags sollte vor der Aussage
   "Owner-Befund geschlossen" frisch gemessen werden (Memory-Notiz "Flip-Flag seit 07-25 AN"
   widerspricht `render.yaml`-Default `false`).
3. Spec-Satz "Lebenszeit vergiftet, Gate-Zaehler gesund → ziffernfreier Sperrtext" ist nur
   kompositionell abgedeckt (ops-Ebene T5/T5b + Bestands-Stubs in
   `test/deny-diagnosability.test.js`), kein Test treibt genau diesen vergifteten Zustand durch
   die echte Gate-Kette bis in den gerenderten Text.
4. Entlastender Nebenbefund: das befuerchtete TOD "Dashboard zeigt nach KS-P4 andere Zahlen"
   tritt nicht ein — `usageView` liest aus dem Snapshot nur `capCents`.
5. eslint im Worktree nicht lauffaehig (`MODULE_NOT_FOUND` durch node_modules-Symlink) — Status
   unverifiziert, `node --check` fuer alle drei Dateien aber gruen.

## Clean-Code-Audit (final)

**verdict: PASS**, **blocker: false**, s1/s2/s3/s4 alle leer (keine Befunde).

`tenantUsageAxes` ist die eine Quelle (G5) fuer beide Verbrauchsgroessen, genutzt sowohl vom
Gate (`tenantSpendOrDeny`) als auch von der Anzeige (`tenantBudgetSnapshot`) — die Divergenz ist
damit strukturell (G27) statt per Konvention geschlossen. `usageAxesBookable` kapselt den
D7-Riegel als reines Praedikat (G28), bewusst ohne Log an der Anzeige-Kante (Begruendung:
Log-Flut bei `/api/state`-Polls auf einem dauerhaft vergifteten Bucket). Store-Fassaden erzeugen
`nowIso` konsistent an der IO-Grenze, Wrapper-Parity gewahrt. Das dokumentierte Restrisiko
(zwei Fassaden-Uhren) ist in `PLAN-SECURITY.md` UND per Test gepinnt statt verschwiegen — genau
das geforderte Vorgehen. Die 4-Parameter-Signatur ist ein im Modul bereits etabliertes Muster
(`gateUsageCents`, `reserveExceedsBudget`), keine neue F1-Verletzung. Keine Magic Numbers ausser
benannten Testkonstanten, kein toter/auskommentierter Code, keine abgeschaltete Sicherung.

**topTodos:** kein offener TODO aus dem Audit — Phase mergefaehig. Optional/spaeter (ausserhalb
Scope): durchgereichtes `nowIso` durch die Store-Fassade koennte das dokumentierte
Sub-Millisekunden-Restrisiko strukturell schliessen — erfordert eine Signaturaenderung an beiden
Backends, bewusst als eigene Folgephase ausgeklammert.

## Fix-Runden

**r1** — einzigen gelisteten Review-Blocker behoben: `PLAN-SECURITY.md`, Abschnitt KS-P4, Absatz
"Getragene Kante" hatte faelschlich behauptet, die Divergenz der zwei Store-Fassaden-Uhren
(`store.reserveExceedsBudget` vs. `store.tenantBudgetSnapshot`, je eigenes
`new Date().toISOString()`) koenne nur einen zu GROSSEN Fehlbetrag erzeugen — Formulierung
korrigiert. Finaler Branch nach r1: `phase/ks-p4-anzeige-gate-achse-fix1`.
