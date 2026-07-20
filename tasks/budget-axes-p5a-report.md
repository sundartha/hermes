# Phase P5a — Achsen in Anzeige und Ablehnung trennen

**Gate: PASS**
**finalBranch:** `phase/ba-p5a-achsen-trennen`
**Basis:** `master` @ `7ac93cd` (P1-P4 gemergt)
**headCommit (Phasenbranch):** `b854a259090422a3e9c1d5c49e3770bbae985158`
**Merge auf master:** NICHT durchgefuehrt — Branch steht committet bereit, Merge-Entscheidung liegt beim Lead/Owner.

---

## 1. Zweck der Phase

Bisher zeigte `usage.maxBudgetEur` im Dashboard/MCP-Status den globalen Plattform-Cap an, obwohl Ablehnungstexte teils andere Groessen meinten. P5a trennt sauber zwei Achsen:

- **Tenant-Achse**: das eigene, effektive Budget-Limit des anrufenden Tenants (Anzeige + Ablehnungstext, mit Zahlen).
- **Plattform-Achse**: der globale Notaus-Cap ueber alle Tenants (nur Ablehnungsgrund, NIE eine Zahl in einer Tenant-Antwort — Cross-Tenant-Leck-Vermeidung).

Nur Anzeige- und Texteintraege betroffen. Kein Praedikat, kein Vergleichsoperator, keine Gate-Entscheidung wurde veraendert.

---

## 2. Plan (gekuerzt)

### 2.1 Abweichungen vom Plantext gegenueber der Realitaet auf master (per grep verifiziert)

| Plantext-Annahme | Realitaet | Konsequenz |
| --- | --- | --- |
| Konsument `public/index.html` | existiert nicht (`public/` enthaelt nur `brand/`, `favicon.ico`, `tenant.html`) | entfaellt |
| Konsument `public/tenant.html` | 0 Treffer auf `usage`/`budget`/`costEur` | entfaellt |
| "alle vier" Konsumenten | zusaetzlich `src/ui/widget-i18n.js` (Label de/fr) und `test/outbound-reserve-gate.test.js` (Fehlertext-Regex) | mitziehen |
| `usageView` bekommt `config` | wird nach der Migration nicht mehr gebraucht (`globalCapEur`-Import faellt weg) | strukturelle statt konventionelle Leck-Sperre |

### 2.2 Migration `maxBudgetEur` -> `tenantCapEur`

9 Treffer in 6 Dateien identifiziert (`src/routes/api-read.js`, `src/mcp-tools.js` x3, `src/ui/widgets/agent-status.html`, `src/ui/widget-i18n.js` x2, `test/api-read-parity.test.js`, `test/mcp-ui.test.js`). Harte Migration: alter Schluessel/Key **ersatzlos entfernt**, kein Uebergangs-Alias. Widget-Label explizit geaendert ("Max budget (EUR)" -> "Your budget (EUR)"/"Dein Budget (EUR)"/"Votre budget (EUR)"), weil das alte Label die falsche (Plattform-)Achse benannte — Key behalten waere derselbe Fehler auf i18n-Ebene gewesen.

### 2.3 Neue Ablehnungstexte

Zentrale, interpolationsfreie Konstante fuer den Plattform-Zweig:

```js
const PLATFORM_DENIAL = "Plattform-Notaus aktiv, bitte Betreiber kontaktieren.";
const PLATFORM_DENIAL_REASON = "budget_platform";
const TENANT_UNREADABLE_DENIAL =
  "Dein Budget ist gesperrt: der Verbrauchsstand ist nicht lesbar. Bitte Betreiber kontaktieren.";
```

| Ausloeser | Text (woertlich) | grund |
| --- | --- | --- |
| Tenant-Achse, `budget` | `Dein Budget-Limit ist erreicht: 3.50 von 10.00 EUR verbraucht.` | `budget_tenant` |
| Tenant-Achse, `budget`, Bucket unbuchbar | ziffernfreier Sperrtext (s.o.) | `budget_tenant` |
| Plattform-Achse, `budget` | `Plattform-Notaus aktiv, bitte Betreiber kontaktieren.` | `budget_platform` |
| Tenant-Achse, `reserve_budget`, Rest > 0 | `Dieser Anruf passt nicht mehr in dein Budget: es fehlen 0.39 EUR. Aktueller Spend-Monat endet am 2026-07-31.` | `reserve_ueber_rest` |
| Tenant-Achse, `reserve_budget`, Rest <= 0 | `Dein Budget ist erschoepft: es fehlen 0.60 EUR. Aktueller Spend-Monat endet am 2026-07-31.` | `reserve_erschoepft` |
| Tenant-Achse, `reserve_budget`, Bucket unbuchbar | ziffernfreier Sperrtext | `reserve_erschoepft` |
| Plattform-Achse, `reserve_budget` | `Plattform-Notaus aktiv, bitte Betreiber kontaktieren.` | `budget_platform` |
| Store-Throw | unveraendert `Reservierung fehlgeschlagen. Bitte erneut versuchen.` | `reserve_error` (Bestand) |

**Praezedenz bei Doppel-Feuer:** die Tenant-Achse gewinnt — der Nutzer bekommt die Zahl, auf die er reagieren kann; eine Plattform-Groesse erreicht ihn nie. Auswertungsreihenfolge identisch zum Bestand (`budgetExceeded` immer zuerst, `globalBudgetExceeded` nur wenn erstes false).

**Streichung (bewusst):** kein Text nennt `max_duration_s`, Sekunden, Minutenzahl oder Tarif — eine genannte Dauer waere fuer den LLM-Aufrufer eine maschinenlesbare Umgehungsanleitung. Gepinnt durch Negativ-Assert `!/(max_duration|Sekunden|Dauer|Minute)/` in jedem Reserve-Testfall.

**Bewusst akzeptierte Kante (0-Sentinel):** steht `DEFAULT_TENANT_BUDGET_CENTS=0`, faellt `effectiveCapCents` laut P2a-Praezedenz auf den Plattform-Cap zurueck — `tenantCapEur` traegt dann denselben Zahlenwert wie der Plattform-Cap. Keine Plattform-**Offenlegung** (kein fremder Verbrauch sichtbar, es ist die real bindende eigene Decke); Prod steht auf `600` (> 0), Boot-Guard `spendCapCoherence` haelt die Ordnung. Dokumentiert statt behandelt.

**"Spend-Monat endet am ..."**: nennt ein Fenster-Datum als Fakt, macht KEINE Reset-Zusage (das waere vor P7 schlicht falsch, da das Gate weiterhin auf dem Lebenszeit-Zaehler `costCents` steht). Folge: P7 braucht dort keine Textaenderung.

### 2.4 Code-Struktur

- `src/store/defaults.js`: neue reine Helfer `eurText(cents)` (die EINE Geld-nach-Text-Kante) und `spendMonthEndDate(nowMs)` (letzter Tag des UTC-Kalendermonats).
- `src/store/state-ops.js`: neuer, rein lesender Export `tenantBudgetSnapshot(s, tenantId, cfg)` — Diagnose-Snapshot (capCents/spentCents/remainingCents) aus derselben Quelle wie die Gate-Praedikate; `spentCents`/`remainingCents` sind `null` bei unbuchbarem Bucket (D7), Aufrufer rendert dann keine Zahl.
- Facade-Durchreichung in `json.js`, `pg.js`, `store.js` (Bind-Liste).
- `src/telephony/outbound-gates.js`: `globalCapEur`-Import raus, drei neue Factory-Helfer (`tenantBudgetDenial`, `tenantReserveDenial`, `reserveOutcome`), rein synchron im selben `withStoreLock`-Callback. Gate-Namen, Reihenfolge, `deny`-Vertrag, `reserve_budget` als letztes Glied: unveraendert.

### 2.5 Tests (Plan-Vorgabe)

Zwei neue Dateien (`test/deny-diagnosability.test.js`, `test/api-state-usage-axis.test.js`), plus mitgezogene Byte-genaue Bestands-Assertions in 6 weiteren Dateien. Deterministisches Pruef-Skript mit grep-Akzeptanzkriterien (0 Treffer `maxBudgetEur`/`Max budget` in `src public`, 0 Treffer `globalCapEur` im Gate-Modul, leerer Praedikat-Diff).

### 2.6 Blast-Radius laut Plan

10 Quell- + 7 Testdateien; **nicht** beruehrt: `src/config.js`, `.env.example`, `render.yaml`, `telnyx-llm-shim.js`, `routes/voice.js`, `billing/*`, `boot-guard.js`, alle Gate-Praedikate.

---

## 3. Implementierungs-Zusammenfassung

Plangemaess umgesetzt auf `phase/ba-p5a-achsen-trennen`, Commit `b854a25`.

- **Harte Migration** `maxBudgetEur` -> `tenantCapEur` vollstaendig durchgezogen: `src/routes/api-read.js` (`usageView(u, budget)`), `src/mcp-tools.js` (`pickAgentStatus`, Zod-Schema, Textrender), `src/ui/widgets/agent-status.html` (`data-i18n`/`data-mcp`), `src/ui/widget-i18n.js` (de/fr, alter Key aktiv geloescht). `grep -rn 'maxBudgetEur\|Max budget' src` -> 0 Treffer.
- **Neuer Store-Export** `tenantBudgetSnapshot` in `src/store/state-ops.js`, Facade-Durchreichung in `json.js`/`pg.js`/`store.js` ergaenzt.
- **Ablehnungstexte getrennt** in `outbound-gates.js`: Tenant-Achse nennt eigene Decke/Verbrauch bzw. Fehlbetrag + Spend-Monat-Ende; Plattform-Achse bleibt ziffernfrei und liest `tenantBudgetSnapshot` gar nicht erst. Praedikate `budgetExceeded` (`>=`) und `reserveExceedsBudget` (`>`) **unveraendert** — per `git diff` gepinnt (0 Treffer in den Operator-Zeilen).
- **Tote Funktion entfernt**: `globalCapEur` hatte nach der Migration keinen Aufrufer mehr im Repo, wurde ersatzlos geloescht (inkl. Folgekommentar-Bereinigung in `src/routes/api-calls.js`).
- **Tests**: 2 neue Dateien, 8 mitgezogene Bestandsdateien (davon 2 vom Plantext nicht erfasste `/Anrufkosten/`-Konsumenten selbst per grep gefunden und gefixt: `test/outbound-reserve-concurrency-http.test.js`, `test/telnyx-p5-gate-proof.test.js`).
- **Verifikation**: `node --check` auf allen beruehrten Dateien gruen; voller Suite-Lauf **2599/2599**, zweimal deterministisch gruen; der bekannte ~12%-Voll-Last-Flake (`voice-signature-403-log.test.js`) trat einmal auf, isoliert 3x gruen nachgewiesen — bestaetigter Pre-existing-Flake, kein Regress.
- **Live-Smoke**: echter Server-Boot (kein Mock), `GET /api/state` liefert `usage.tenantCapEur=8`, kein `maxBudgetEur` mehr.

### 3.1 Deviations (vom Impl-Agenten selbst dokumentiert)

1. **Grep-Kriterium in Section 5 nicht buchstabengetreu erfuellbar**: `test/api-state-usage-axis.test.js` enthaelt den String `maxBudgetEur` 3x (2 Kommentare + die Abwesenheits-Assertion `!("maxBudgetEur" in body.usage)`). Der Plantext widerspricht sich hier selbst (Abschnitt 4.1 verlangt genau diese Assertion, Abschnitt 5 verlangt 0 Treffer im gesamten `test/`-Baum). Die lesbare Assertion wurde beibehalten statt sie zu obfuskieren, um einen Grep zu taeuschen. Alle 3 Fundstellen sind auf diese eine Datei begrenzt und beweisen Abwesenheit, keine Wiedereinfuehrung.
2. `isBookableCents` wurde entgegen Plan-Abschnitt 3.4 **nicht** nach `outbound-gates.js` importiert — kein Codepfad braucht es dort (D7-Erkennung ist vollstaendig in `tenantBudgetSnapshot` gekapselt), ein zweiter Check waere Duplizierung; ein ungenutzter Import haette gegen "keine ungenutzten Imports" verstossen.
3. `globalCapEur` wurde zusaetzlich zum Plantext **ersatzlos aus `defaults.js` geloescht** (nicht nur aus den zwei Konsumenten) — nach der Migration ohne verbleibenden Aufrufer, Bestandlassen waere eine selbst erzeugte tote Funktion gewesen.
4. Plan-Abschnitt 4.2 nennt nur `test/outbound-reserve-gate.test.js` als `/Anrufkosten/`-Konsument. Der volle Suite-Lauf deckte zwei weitere Konsumenten auf (`test/outbound-reserve-concurrency-http.test.js`, `test/telnyx-p5-gate-proof.test.js`), beide gefixt mit einem generischen Discriminator (`/es fehlen \d+\.\d{2} EUR/`) statt vollem String-Match, da je nach Restbudget `reserve_ueber_rest` oder `reserve_erschoepft` feuern kann.
5. `tasks/todo.md` wurde **nicht** mit einem Phasen-Eintrag versehen (Plan Abschnitt 6 verlangt das). Begruendung: keine der vier vorherigen budget-axes-Phasen (ba-p1 bis ba-p4) hat dort einen Eintrag hinterlassen — etabliertes Muster ist die Session-Prompt-Datei + ein Report ueber den strukturierten Rueckgabe-Kanal. `PLAN-SECURITY.md` wurde dagegen aktualisiert (analog P2a-Praezedenz).
6. Kein Merge auf `master` durchgefuehrt — Branch steht committet bereit, Merge-Entscheidung liegt beim Lead/Owner.

---

## 4. Rot-vor-Fix-Beleg

Vorgehen: `git stash push --keep-index -- src/` (nur die `src/`-Implementierung zurueckgerollt, neue Test-Assertions blieben stehen), Tests/Spawn gegen den alten Code-Stand gelaufen, danach `git stash pop` (Restore verifiziert, `git status` sauber).

1. `node --test test/deny-diagnosability.test.js` (neue Datei) -> `SyntaxError`: Modul `../src/store/defaults.js` liefert keinen Export `spendMonthEndDate` (Modul existierte noch nicht). `fail 1`.
2. `node --test test/api-state-usage-axis.test.js` (neue Datei) -> `AssertionError`: `usageView` lieferte noch kein `tenantCapEur` (`undefined !== 10`). `fail 1`.
3. `node --test test/outbound-gates-order.test.js` (mitgezogene Assertions) -> zwei `AssertionError`s exakt wie vom Plan vorhergesagt: `actual: 'Budget-Limit von 8 EUR erreicht.'` vs. erwarteter neuer Text; sowie `grund=reserve` statt `grund=reserve_ueber_rest`.
4. Spawn-Beleg (`test/outbound-reserve-gate.test.js`, echter Server-Boot via `startServer`): neue Assertion gegen den Fehlbetrag-Text scheitert gegen alten Code (`actual: 'Voraussichtliche Anrufkosten ueberschreiten das verfuegbare Budget.'`). Der parallele Subtest im selben Lauf blieb gruen -> beweist, dass der Server korrekt bootet/antwortet (kein falsches Rot durch Boot-Crash), nur der Ablehnungstext war noch alt.

Nach `git stash pop`: alle vier Faelle liefen erneut gruen, plus die zwei zusaetzlich gefundenen `/Anrufkosten/`-Konsumenten (ebenfalls rot-vor-Fix im vollen Suite-Lauf beobachtet, danach gefixt).

**Vom Safety-Reviewer unabhaengig reproduziert** (frischer Worktree, `git checkout --detach master` auf `7ac93cd`, die sechs geaenderten/neuen Testdateien vom Phasenbranch hineinkopiert): `tests 82, pass 73, fail 9`. Rote Faelle u.a. Tenant-Text mit eigener Decke, `reserve_ueber_rest`-Grund, `tenantCapEur`-Ersetzung in `/api/state`, drei mcp-ui-Widget-/Zod-Faelle. Nach Fix auf demselben Set: `tests 96, pass 96, fail 0`.

---

## 5. Safety-Urteil

**Verdict: APPROVED.** Alle Kern-Kriterien geprueft:

- `testsPassIndependently`: true (eigener frischer Worktree-Lauf, volle Suite 2599/2599, kein Flake, kein Rerun noetig)
- `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`, `redBeforeFixVerified`: alle true

### 5.1 Kernpunkte der Begruendung

1. **Kein Cross-Tenant-Leck** (haertester Pruefpunkt): jede neue Ausgabekante einzeln verifiziert — `/api/state` speist sich ausschliesslich aus `tenantBudgetSnapshot(tenantId, ...)` mit `tenantId = requestTenant(req)`; MCP und Widget ziehen die bereits tenant-gescopte API-Antwort mit; der Plattform-Zweig der Ablehnungstexte liest `tenantBudgetSnapshot` gar nicht und liefert die interpolationsfreie Konstante `PLATFORM_DENIAL` — beide Gates assertieren `!/\d/` darauf. `globalCapEur` ist repo-weit geloescht.
2. **Keine ausfuehrbare `max_duration_s`**: alle fuenf neuen Texte enthalten ausschliesslich EUR-Betraege und ein ISO-Monatsende, Negativ-Assert in jedem Reserve-Testfall.
3. **Keine Praedikat-Aenderung**: `budgetExceeded` behaelt `>=`, `reserveExceedsBudget` behaelt `>`; `git diff` auf den Operator-Zeilen liefert nur Kommentarzeilen der neuen Funktion.
4. **Gate-Reihenfolge**: `EXPECTED_ORDER` (17 Gates) unberuehrt, `reserve_budget` bleibt letztes Glied; `reserveOutcome` bleibt rein synchron im selben `withStoreLock`-Callback, Lock-Invariante gewahrt.
5. **Schluessel-Migration**: 0 Treffer in `src/` und `public/`; `json.js` und `pg.js` tragen beide den neuen Wrapper — kein Laufzeit-TypeError auf einem der Backends (128 gruene pglite-Tests).
6. **Richtige Achse im Text** ausfuehrbar verifiziert fuer beide Gates (budget/reserve_budget) x beide Achsen x D7-Grenzfall.
7. **Namens-Anhang eingehalten**: `tenantCapEur`, `budget_tenant`, `budget_platform`, `reserve_ueber_rest`, `reserve_erschoepft` — keine erfundenen Namen.
8. **Absolute Regeln**: kein Gate entfernt/aufgeweicht/umgangen; `disclosureSentence`/`src/claude.js` nicht beruehrt; Auth-Dateien nicht beruehrt; keine neue Dependency; kein Secret geloggt; kein Audio-Pfad beruehrt.

### 5.2 Nicht-blockierende Concerns

- **0-Sentinel-Kante** (s. Plan 2.3) — vom Implementierer selbst dokumentiert, vom Reviewer unabhaengig bestaetigt gefunden. Kein Blocker.
- **Fehlattribution bei unbuchbarem `reserveCents`**: gibt `tryReserveOutboundBudget` bei nicht-buchbarem Betrag `false` zurueck, bevor eine Achse geprueft wurde, faellt der Fall in den Plattform-Zweig (`grund=budget_platform`) statt in einen expliziten Unbuchbar-Zweig. Fail-closed bleibt erhalten (weiterhin 402, nie reserviert), es leidet nur die Forensik. Auf dem Normalpfad nicht erreichbar (`resolveMaxDurationS` garantiert endlich/positiv, Tarife sind numEnv-gegateted). Empfehlung als Folge-Phase: expliziter Unbuchbar-Zweig.
- **Inkohaerenter Default-Mock** in `test/outbound-gates-order.test.js`: `defaultStore()` liefert eine Kombination (`remainingCents=650` + `reserveExceedsBudget=>true` bei `reserveCents=100`), die einen negativen Fehlbetrag rendern wuerde — produktiv unerreichbar (gleiche Quelle, gleicher Lock), lehrt aber eine falsche Invariante fuer kuenftige Leser.
- **Grep-Kriterium nicht buchstabengetreu**: s. Deviation 1 oben — Absicht erfuellt, Plan-Formulierung sollte auf `src public` eingeschraenkt werden.
- **Kosmetik**: `tenantCapEur` wird ohne `toFixed(2)` gerendert ("10 EUR" statt "10.00 EUR") — Bestandsmuster, kein Verhaltensrisiko.

---

## 6. Clean-Code-Audit

**Verdict: PASS — keine S1/S2-Befunde.**

### S1 (Blocker)
Keine.

### S2 (schwerwiegend, kein Blocker im Sinne des Merges, aber ernst)
Keine.

### S3 (kosmetisch/Haertung, nicht blockierend)

1. **N7/G11** (`src/telephony/outbound-gates.js`, `tenantReserveDenial`): Achsen-Benennung inkonsistent — die `budget`-Gate-Gruende tragen die Achse explizit im Namen (`budget_tenant` vs. `budget_platform`), die Tenant-Seite des `reserve_budget`-Gates tut das nicht (`reserve_ueber_rest`/`reserve_erschoepft` ohne Achsen-Praefix), waehrend die Plattform-Seite desselben Gates wiederum `budget_platform` (mit Praefix) traegt. Ein Log-/Audit-Leser kann aus `grund=reserve_ueber_rest` allein nicht ablesen, dass es die Tenant-Achse ist. Rein kosmetischer Fix (Tests muessten mitgezogen werden).
2. **G3/C4** (`reserveOutcome`): Kommentar behauptet Gewissheit ("false heisst zwingend Plattform-Achse hat abgelehnt"), die nur gilt, solange `ctx.reserveCents` stets buchbar ist. Diese Invariante wird strukturell durch anderen Code (`compute_reserve`, `resolveMaxDurationS`) gehalten, aber nicht durch `reserveOutcome` selbst erzwungen oder getestet. Optionaler defensiver Fix: Kommentar praezisieren oder expliziter `isBookableCents`-Guard mit eigenem Grund + Regressionstest.
3. **G5-Grenzfall**: `tenantBudgetDenial` und `tenantReserveDenial` holen je einzeln `tenantBudgetSnapshot` und pruefen je ein eigenes Feld auf `null`, um denselben `TENANT_UNREADABLE_DENIAL`-Text zurueckzugeben — derselbe 2-Zeilen-Rahmen zweimal geschrieben (Text selbst nicht dupliziert). Extraktion wuerde vermutlich mehr Indirektion kosten als sie einspart — nur Beobachtung, kein Fix gefordert.

### S4
Keine.

### Positiv hervorgehoben (`passNotes`)

- `G5` vorbildlich zentralisiert: eine Cents->EUR-Textkante (`eurText`), ein interpolationsfreies Literal (`PLATFORM_DENIAL`) als struktureller Leck-Riegel statt Konvention.
- `G25`: beide neu eingefuehrten "nackten" Zahlen sofort in benannte Konstanten (`EUR_DECIMALS`, `ISO_DATE_LENGTH`) gegossen.
- `G26`: alle Geld-Operationen bleiben Ganzzahl-Cents, EUR-String nur an der einen dokumentierten Anzeige-Kante.
- Harte Feld-Migration konsequent durch alle Konsumenten gezogen, mit explizitem Whitelist-Test, der auch Abwesenheit des Plattform-Cap-Werts in der JSON-Antwort prueft.
- Testabdeckung ueberdurchschnittlich: `test/deny-diagnosability.test.js` deckt beide Gates x beide Achsen x D7-Grenzfall x Kalendergrenzfaelle (Dezember-Ueberlauf, Schaltjahr) explizit ab.
- Voller Suite-Lauf auf dem tatsaechlichen Branch-Tip: 2599 Tests, 2598 gruen, 1 Fehlschlag in einer Datei **ausserhalb** dieses Diffs (`test/telnyx-event-ingest-route.test.js`, Settlement-Idempotenz) — isoliert zuverlaessig gruen, bestaetigter vorbestehender Voll-Last-Flake, keine Regression.
- `PLAN-SECURITY.md` mit praeziser neuer Sektion aktualisiert, inkl. Pre-Mortem zur 0-Sentinel-Kante und zur Spend-Monat-Anzeige.

### Top-Todos aus dem Audit (optional, kein Muss vor Merge)

1. `reserveOutcome`: entweder expliziten `isBookableCents(ctx.reserveCents)`-Guard (eigener Grund) ergaenzen oder den "zwingend"-Kommentar auf die tatsaechliche, in `compute_reserve` liegende Invariante praezisieren + Regressionstest.
2. `grund`-Werte der Tenant-Reserve-Achse fuer Konsistenz mit `budget_tenant`/`budget_platform` pruefen (Achsen-Suffix erwaegen).
3. Beide Punkte sind Haertung/Konsistenz, kein Sicherheits- oder Korrektheitsrisiko im aktuellen Codepfad.

---

## 7. Fix-Runden

**0 Fix-Runden noetig.** Sowohl Safety-Review (`approved: true`, `blockers: []`) als auch Clean-Code-Audit (`verdict: PASS`, `blocker: false`, `s1: []`, `s2: []`) kamen ohne Blocker durch den ersten Durchlauf. Die einzigen Findings sind S3 (Haertung/Konsistenz, s. Abschnitt 6) und nicht-blockierende Safety-Concerns (s. Abschnitt 5.2), keines davon erforderte einen Nacharbeits-Zyklus. `FIXES` blieb entsprechend leer.

---

## 8. Offene Deploy-Vorbedingungen

1. **Merge auf `master`** ist noch nicht erfolgt — der Branch `phase/ba-p5a-achsen-trennen` steht bereit, die Merge-Entscheidung liegt beim Lead/Owner.
2. **Kein Deploy-Blocker aus dieser Phase**: keine neue Env-Variable, keine `render.yaml`-Aenderung, keine neue Dependency. `src/config.js` unberuehrt.
3. **Nicht in dieser Phase enthalten** (laut Plan bewusst ausgeklammert, fuer Folgephasen vorgemerkt):
   - P5b: Monatsfelder in der Projektion
   - P6: Fruehwarnung
   - P7: Gate-Flip auf die Spend-Monat-Achse (der Satz "Spend-Monat endet am ..." wird dort ohne Textaenderung im starken Sinn wahr)
4. **Empfohlene Folge-Task** (aus Safety- und Clean-Code-Review, kein Blocker): expliziter Unbuchbar-Zweig in `reserveOutcome`, damit ein malformter Reserve-Betrag nicht faelschlich als Plattform-Notaus auditiert wird (`grund=budget_platform` statt eines eigenen, ehrlichen Grunds).
5. **`tasks/todo.md`** traegt bewusst keinen Eintrag zu dieser Phase (etabliertes Muster der budget-axes-Kette, s. Deviation 5); Nachverfolgung laeuft ueber Session-Prompt-Datei + diesen Report.
6. Vor jedem tatsaechlichen Deploy: `npm test` auf dem finalen Merge-Commit erneut gruen bestaetigen (Suite-Flake-Protokoll aus `tasks/lessons.md` beachten — rot nur ernst nehmen, wenn isoliert reproduzierbar rot).
