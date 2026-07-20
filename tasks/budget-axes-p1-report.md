# P1 — NaN-Riegel (Geld-Schreib-, Lese- und Hydrierungskante fail-closed): Detailbericht

**Datum:** 2026-07-19
**Basis:** `master` @ `cd2a611`
**Finaler Branch:** `phase/ba-p1-nan-riegel-fix1`
**Head-Commit (urspruengliche Implementierung, Branch `phase/ba-p1-nan-riegel`, vor Fix-Runde):** `93b7784d18d1fdcb814347ad7e89d2ff1ac65d92`
**Gate:** **PASS**

Behebt Befund **D7** aus dem uebergeordneten Plan `PLAN-BUDGET-AXES.md`. Keine Abhaengigkeiten zu anderen Phasen (schema-frei).

---

## 1. Zusammenfassung

Vier (plus zwei Zusatz-) Geld-Kanten liessen einen nicht-endlichen (`NaN`/`Infinity`) oder fraktionalen Geldwert unbemerkt durch: die Wurzel `voiceMinutesOf` in `src/billing/metering.js` konnte bei kaputten Zeitstempeln `NaN`-Minuten liefern, die nachgelagerten `minutes <= 0`-Riegel liessen `NaN` durch (`NaN <= 0` ist `false`), die Schreibkanten (`trackUsage`, `addVoiceUsageCostCents` in `src/store/state-ops.js`) schrieben `NaN` ungeprueft in den Bucket, und die Lesekanten (`budgetExceeded`, `globalBudgetExceeded` sowie — als selbst verifizierter Zusatzbefund — `reserveExceedsBudget`/`globalReserveExceedsBudget`) wurden dadurch **fail-open**: `NaN >= cap` ist immer `false`, das Budget-Gate haette also nie ausgeloest. Zusaetzlich hielt Postgres `cost_eur` als NUMERIC auch den String `'NaN'` fest, sodass ein einmal vergifteter Bestand nach jedem Neustart wieder aktiv gewesen waere (Hydrierungskante `rowToUsage` in `src/store/pg.js`).

P1 fuehrt dafuer **eine** einzige Geldwert-Gueltigkeitsquelle ein (`isBookableCents` in `src/store/defaults.js`, nach einer Fix-Runde: `Number.isFinite(x) && Number.isInteger(x) && x >= 0`) und haertet damit alle sechs betroffenen Kanten fail-closed, inklusive eines eigenen Audit-/Log-Grunds `usage_korrupt` (Konstante `USAGE_CORRUPT_REASON`), der einen vergifteten Bestand von einem echten "Budget erschoepft" unterscheidbar macht. Das alte, an einer einzigen Stelle bereits existierende Inline-Idiom `!(x>=0)` (in `tryReserveOutboundBudget`) ist auf dieselbe Quelle umgestellt und schliesst dabei zusaetzlich eine reale Altluecke (`+Infinity >= 0` war `true`).

Beide finalen Reviews (Safety und Clean-Code) haben die Phase **ohne Blocker** freigegeben. Eine erste Review-Runde fand zwei Blocker (u. a. eine G26-Luecke: fraktionale Cent-Betraege wie `0.5` wurden vom urspruenglichen Guard noch als "buchbar" akzeptiert), die in einer einzigen Fix-Runde (`r1`, Branch `phase/ba-p1-nan-riegel-fix1`) minimal und gezielt geschlossen wurden.

---

## 2. Plan (gekuerzt)

### Verifizierter Ist-Zustand vor der Phase (Beweiskette laut Plan)

| Kante | Datei · Symbol | Ist-Verhalten (verifiziert) |
| --- | --- | --- |
| Wurzel | `src/billing/metering.js` · `voiceMinutesOf` | `Math.ceil((new Date('kaputt') - …)/60000)` -> `NaN` |
| Wurzel-Durchlass | `metering.js` · `recordVoiceMinuteMeter`, `reconcileOutboundVoiceBudget` | `if (minutes <= 0) return;` — `NaN <= 0` ist `false` -> durchgelassen |
| Schreibkante | `src/store/state-ops.js` · `addVoiceUsageCostCents` | `usage.costCents += costCents;` ungeprueft |
| Schreibkante | `state-ops.js` · `trackUsage` | Token-Zaehler steigen **vor** der Kostenrechnung, kein Guard |
| Lesekante | `state-ops.js` · `budgetExceeded` | `costCents >= effectiveCapCents(...)` — `NaN >= 800` ist `false` -> fail-**offen** |
| Lesekante | `state-ops.js` · `globalBudgetExceeded` | Summe wird `NaN` -> fail-**offen** |
| Lesekante (Zusatzbefund) | `state-ops.js` · `reserveExceedsBudget`, `globalReserveExceedsBudget` | `NaN + … > cap` ist `false` -> ebenfalls fail-**offen** (Abweichung D-3) |
| Hydrierung | `src/store/pg.js` · `rowToUsage` | NUMERIC `'NaN'` -> `NaN` bei jedem Boot |
| Einzige Geld-Idiom-Stelle vor der Phase | `state-ops.js` · `tryReserveOutboundBudget` | `if (!(reserveCents >= 0)) return false;` |

Betroffene Nicht-Gate-Leser von `budgetExceeded`: `src/telnyx-llm-shim.js` (legt mid-call auf), `src/routes/voice.js` (weist kostenlosen Inbound ab), `src/telephony/outbound-gates.js` (Gate `budget`).

### Kernentscheidung

Eine EINE Quelle (`isBookableCents`) in `src/store/defaults.js`, direkt neben den bestehenden Geld-Konstanten `CENTS_PER_EUR`/`MICRO_CENTS_PER_CENT`. Plan-Fassung: prueft **ausschliesslich** Endlichkeit und Nicht-Negativitaet (`Number.isFinite(x) && x >= 0`), bewusst **ohne** Kleinheitspruefung — ein Sub-Cent-Turn (Haiku-Kosten deutlich unter 0,5 Cent, laeuft ueber `costMicroCentsRem`) und ein legitimer 0-Betrag muessen buchbar bleiben (P1-Safety-BLOCKER).

Geplante Edits:

- **`src/billing/metering.js`** (`voiceMinutesOf`): kaputtes `answeredAt`/`endedAt` normalisiert auf `0` statt `NaN` weiterzugeben (`Number.isFinite`, nicht `isBookableCents` — das ist die Minuten-, keine Cent-Achse).
- **`src/store/state-ops.js`**: zwei geteilte Helfer `discardCorruptWrite` (Schreibkante, gibt den Bucket bit-identisch zurueck) und `denyCorruptUsage` (Lesekante, liefert immer `true` = blockieren), plus `turnIncrementsBookable` (kapselt die zusammengesetzte Bedingung fuer `trackUsage`). `trackUsage` und `addVoiceUsageCostCents` verwerfen unbuchbare Schreibversuche alles-oder-nichts; `budgetExceeded`, `globalBudgetExceeded`, `reserveExceedsBudget`, `globalReserveExceedsBudget` sperren fail-closed mit Grund `usage_korrupt`; `tryReserveOutboundBudget` wechselt von seinem Inline-Idiom auf `isBookableCents`.
- **`src/store/pg.js`** (`rowToUsage`, ueber neuen Helfer `hydratedCostCents`): heilt einen korrupten `cost_eur='NaN'`-Bestand bei jedem Boot zu `costCents=0`, mit lautem Log (keine stille Heilung).
- Keine neue Env-Variable, keine neue Dependency, keine Aenderung an `store.js`/`json.js`/Routen/Config/Schema.

### Zusatzbefund im Plan (Abweichung D-3, bereits vom Plan selbst vorgesehen)

`reserveExceedsBudget` und `globalReserveExceedsBudget` waren beim urspruenglichen Ist-Zustand NICHT in den vier Kern-Plan-Kanten, aber vom Plan-Autor selbst als zusaetzlicher, derselben D7-Klasse zugehoeriger Befund identifiziert und in den Plan aufgenommen: bei `costCents = NaN` liefern beide `false`, `tryReserveOutboundBudget` wuerde also reservieren. Heute schattet nur die Gate-**Reihenfolge** das ab — genau die "Invarianten-per-Konvention"-Fragilitaet aus dem vorherigen Clean-Code-Audit.

### Testplan (Kernpunkte)

Neue Datei `test/budget-nan-fail-closed.test.js` (10 Faelle: Wurzel, Schreib-/Lesekante, Reserve-Lesekanten, Randwerttabelle UNBOOKABLE/BOOKABLE, echter pglite-Hydrierungsfall, Grep-Regressionstest gegen Wiederkehr des alten Inline-Idioms) plus ein zusaetzlicher Regressionstest in `test/tenant-budget-cap.test.js` (P1-Safety-BLOCKER in Gegenrichtung: 200 Sub-Cent-Turns muessen weiterhin exakt 1 Cent + 4400 Mikro-Cent-Rest ergeben, damit der neue Riegel keinen legitimen Sub-Cent-Umsatz verwirft).

Rot-vor-Fix ist im Plan als Pflichtschritt vorgeschrieben (VOR den Quell-Edits nur die zwei Testdateien schreiben und ausfuehren), Erwartung: alle 10 neuen Faelle rot.

### Abweichungen, die der Plan selbst bereits benennt (Auswahl, vollstaendige Liste s. Originaldokument)

| ID | Kern |
| --- | --- |
| D-1 | `.env.example`/`render.yaml` bleiben bei `MAX_BUDGET_EUR=8` — der in einer Vorphase geplante Nachzug auf `12` wurde vom Owner nicht ausgefuehrt (P0 nicht umgesetzt) und wird hier **nicht** nachgeholt; bindende Owner-Entscheidung. |
| D-2 | Der unterscheidbare Ablehnungsgrund `usage_korrupt` erreicht in dieser Phase nur `console.error`, **nicht** den persistierten Audit-`grund` in `outbound-gates.js` (bleibt `budget`) — bewusster Phasenschnitt, volle Vereinheitlichung ist Sache einer spaeteren Phase (P5a laut Plan-Anhang). |
| D-3 | Reserve-Lesekanten zusaetzlich gehaertet (s. o.). |
| D-4 | `console.error` in `state-ops.js` (sonst als "kein IO" dokumentiertes Modul) und `pg.js` als bewusste, eng begrenzte Ausnahme. |
| D-5/D-6/D-7 | Benennungs- und Abstraktionsentscheidungen (`isBookableCents` auch auf Token-Zaehler angewandt; Minuten-Achse bleibt bei `Number.isFinite`; das neue Praedikat weist strenger ab als das abgeloeste Idiom — reine Verschaerfung, kein Blocker). |
| D-8 | Kein `PLAN-SECURITY.md`-Eintrag — P1 haertet nur, entfernt/lockert keine Sicherung. |

---

## 3. Implementierung — Zusammenfassung

Phase exakt gemaess Plan umgesetzt, in isoliertem Worktree auf Branch `phase/ba-p1-nan-riegel`, Head-Commit `93b7784`.

**Bearbeitete Dateien:**
- `src/store/defaults.js` — neue Konstante `USAGE_CORRUPT_REASON = "usage_korrupt"` und Funktion `isBookableCents(x)`.
- `src/store/state-ops.js` — Import erweitert; Helfer `discardCorruptWrite`, `denyCorruptUsage`, `turnIncrementsBookable`; `trackUsage` und `addVoiceUsageCostCents` verwerfen unbuchbare Schreibversuche alles-oder-nichts; `budgetExceeded`, `globalBudgetExceeded`, `reserveExceedsBudget`, `globalReserveExceedsBudget` sperren fail-closed; `tryReserveOutboundBudget` auf `isBookableCents` umgestellt.
- `src/billing/metering.js` — `voiceMinutesOf` normalisiert ein kaputtes Zeit-Delta auf `0`.
- `src/store/pg.js` — neuer Helfer `hydratedCostCents`; `rowToUsage` heilt korrupten `cost_eur` zu `costCents=0` mit Log.
- `test/tenant-budget-cap.test.js` — ein neuer Regressionstest (Sub-Cent-Gegenrichtung).

**Neue Datei:** `test/budget-nan-fail-closed.test.js` (10 Faelle inkl. eines echten pglite-Hydrierungsfalls).

**Ergebnis der Implementierungsrunde:** `node --check` auf allen vier geaenderten Quelldateien bestanden; volle Suite **2549/2549** (Baseline 2538 + 11 neue Faelle), 0 fail. Manueller Smoke-Test (`PORT=3999 SKIP_TWILIO_SIGNATURE_CHECK=true npm start`, Dummy-Twilio-Creds nur als Shell-Env) bestaetigt `/healthz` = 200 mit den neuen Kanten aktiv; `.env` wurde nur lokal temporaer kopiert und danach wieder geloescht (nie gestaged/committed).

`git diff --stat` beruehrte genau die im Plan vorhergesagte Dateiliste — keine weiteren Dateien.

### Deviations (laut Implementierungsbericht)

1. **P0-Nachzug nicht ausgefuehrt** (Owner-Entscheidung, vom Auftrag vorgegeben): `.env.example`/`render.yaml` bleiben bei `MAX_BUDGET_EUR=8`.
2. **Zwei Kommentartexte umformuliert, keine Logik-/Namensaenderung:** der Plantext gab woertlich an zwei Stellen (`tryReserveOutboundBudget`-Kommentar, `isBookableCents`-Kommentar) die Zeichenkette `!(x>=0)` als Kommentarinhalt vor — genau die Zeichenkette, die derselbe Plan per Grep-Regressionstest aus dem Code verbannt sehen will. Beide Kommentare inhaltsgleich umformuliert, damit sowohl der automatisierte Grep-Test als auch die manuelle Pruefung im Abnahmekriterium sauber durchlaufen.
3. **Abweichung D-3 umgesetzt** (Reserve-Lesekanten zusaetzlich gehaertet) — vom Plan selbst als bewusste, im Scope liegende Erweiterung vorgegeben, kein eigenmaechtiger Scope-Ausbruch.

### Clean-Code-Selbstpruefung des Implementierers (Auszug)

G5 (keine Duplizierung): drei geteilte Helfer statt sechs Inline-Kopien derselben Pruefung. G25 (keine Magic Numbers): alle Werte benannt. G28 (Bedingungen kapseln): `turnIncrementsBookable`. F1 (<=3 Argumente): eingehalten. G12 (keine ungenutzten Importe): per grep verifiziert. G4 (keine abgeschalteten Sicherungen): keine — im Gegenteil, vier Lesekanten zusaetzlich gehaertet. Kommentare Deutsch ohne Umlaute (per grep auf den Diff verifiziert).

---

## 4. Rot-vor-Fix-Beleg

### Beleg aus der Implementierungsrunde

Vor jeder Quell-Aenderung (nur die zwei Testdateien geschrieben) ausgefuehrt:

```
node --test test/budget-nan-fail-closed.test.js test/tenant-budget-cap.test.js
```

Ergebnis: Modul-Ladefehler — die staerkste Form von Rot, das gesamte Testfile scheitert vor dem ersten Einzelfall:

```
SyntaxError: The requested module '../src/store/defaults.js' does not provide an export named 'USAGE_CORRUPT_REASON'
tests 14 / pass 13 / fail 1   (das eine fail = budget-nan-fail-closed.test.js komplett)
```

`test/tenant-budget-cap.test.js` lief zu diesem Zeitpunkt bereits gruen inkl. des neuen Sub-Cent-Regressionstests (erwartungsgemaess — der ist schon vor dem Fix gruen, kein Rot-Fall, reiner Schutz).

Nach vollstaendiger Implementierung: `tests 23 / pass 23 / fail 0` (alle 10 neuen D7-Faelle + der Regressionstest gruen).

### Unabhaengiger Rot-vor-Fix-Beweis durch den Safety-Reviewer (staerker als die reine Agenten-Behauptung)

Der Safety-Reviewer hat den Rot-Zustand selbst nachgestellt statt sich auf den obigen Beleg zu verlassen: `git checkout master -- src/` plus eine **eigene** Probe-Datei, die nur bereits auf `master` existierende Exporte importiert (ein reiner Lauf der neuen Testdatei gegen `master` waere sonst nur ein Import-Fehler wegen des fehlenden Exports gewesen — kein Verhaltensbeweis). Ergebnis gegen `master`-Quellcode: **6 von 7 eigenen Proben rot**:

- PROBE a — `reconcileOutboundVoiceBudget(endedAt='kaputt')` vergiftet den Bucket: **ROT**
- PROBE b — `budgetExceeded(NaN-Bucket)` liefert `false` statt `true`: **ROT**
- PROBE b2 — `globalBudgetExceeded(NaN)`: **ROT**
- PROBE b3 — `reserveExceedsBudget(NaN)`: **ROT**
- PROBE c — `addVoiceUsageCostCents(NaN)` zerstoert einen bestehenden Bucket-Stand von 790: **ROT**
- PROBE d — `trackUsage(NaN)` erzeugt einen Teil-Schreibeffekt: **ROT**
- PROBE e (Gegenprobe, Sub-Cent: 200 Turns -> exakt 1 Cent + 4400 Mikro-Cent-Rest): **GRUEN** bereits auf `master` (das ist beabsichtigt — kein Rot-Fall)

Dieselbe Probe gegen den Implementierungsstand (`fix1`-Quellcode): **7/7 gruen**. Die identische gruene Gegenprobe (Werte `1` und `4400` byte-identisch auf beiden Seiten) ist der harte Beleg, dass der neue Riegel nicht auf Kleinheit prueft und der Sub-Cent-Uebertrag unangetastet bleibt.

---

## 5. Safety-Urteil

**`approved: true`** (finale Review-Runde, nach Fix-Runde r1). Alle Einzelpruefungen bestanden: `testsPassIndependently`, `safetyGatesIntact`, `disclosureIntact`, `authFailClosedIntact`, `noSecretsLeaked`, `scopeRespected`, `behaviorAsIntended`, `redBeforeFixVerified`. **`blockers: []`**.

**Unabhaengige Testverifikation:** eigener Voll-Lauf `npm test` im frischen Worktree — **2550 Tests, 2550 pass, 0 fail**, Exit 0, Laufzeit ca. 75,5 s, erster Lauf bereits gruen (kein Flake-Gegenlauf noetig). `node --check` auf allen vier geaenderten `src`-Dateien bestanden.

### Verdikt (zusammengefasst)

Alle Phasen-Invarianten aus dem Plan geprueft und erfuellt:

1. **Kein Kleinheits-Guard:** `isBookableCents = Number.isFinite && Number.isInteger && x >= 0`. `0` bleibt explizit buchbar; der P1-Safety-BLOCKER (KI-Kostenanteil faellt aus dem Gate) ist nicht ausgeloest — durch die eigene Gegenprobe auf beiden Seiten (master/fix1) bewiesen.
2. **Sub-Cent-Uebertrag unangetastet:** 200 Sub-Cent-Turns = exakt 1 Cent + 4400 Mikro-Cent-Rest, identisch auf `master` und `fix1`.
3. **`isBookableCents` ist die einzige Geld-Gueltigkeitsquelle:** vollstaendiger Grep ueber `src/` — alle verbliebenen `Number.isFinite`-Stellen sitzen auf Nicht-Geld-Achsen (Minuten, Sekunden, Zeitstempel, SMS-Zaehler, Config-Parsing). Das alte Inline-Idiom in `tryReserveOutboundBudget` ist umgestellt; ein Regressionstest verbietet dessen Rueckkehr aktiv.
4. **Lesekante liefert `grund=usage_korrupt`**, unterscheidbar von `budget` — vier Lesekanten ueber die zwei geteilten Helfer, kein Copy-Paste.
5. **pg-Hydrierungskante heilt** `cost_eur='NaN'` zu `0` mit lautem Log — per pglite-Test gegen eine echte re-hydrierte DB-Instanz verifiziert (nicht nur In-Memory).
6. **Byte-Identitaet auf gesunden Werten** verifiziert (die Verschiebung der Kostenberechnung vor die Token-Inkremente in `trackUsage` ist sicher, weil die Kostenfunktion keinen Bucket-State liest).
7. `.env.example`/`render.yaml` unangetastet (`git diff master HEAD` = 0 Zeilen dort) — korrekt priorisierte Owner-Anweisung ueber den (aelteren) Plantext.
8. Benennungs-Vorgaben eingehalten (`isBookableCents`, `USAGE_CORRUPT_REASON = "usage_korrupt"`), nichts erfunden.

Absolute Regeln: alle vier (plus zwei Zusatz-) Aenderungen machen Gates ausschliesslich **strenger**, nie schwaecher. Diff beruehrt ausschliesslich `metering.js`/`defaults.js`/`pg.js`/`state-ops.js` plus zwei Testdateien — keine Auth-, Voice-, Signatur- oder Disclosure-Datei betroffen. Logs sind secret-frei (nur Kante, Tenant-Bezug, Zahl). `package.json`/`package-lock.json`: 0 Zeilen Diff. Kein Scope-Creep.

### Concerns (nicht-blockierend, alle vermerkt)

1. `Number.isInteger` in `isBookableCents` ist eine Verschaerfung ueber den urspruenglichen Plantext hinaus (Plan verlangte nur Nicht-Endlichkeit/Negativitaet-Pruefung). Kein Blocker: keine Kleinheitspruefung, mit G26 begruendet; alle Geldwert-Erzeuger im Code liefern bereits Ganzzahlen (Tarif x Ganzzahl-Minuten, `Math.round`, API-Ganzzahlen, `pg`-Rundung). Kein realistischer Pfad gefunden, auf dem ein legitimer fraktionaler Betrag verworfen wuerde.
2. **Der persistierte Audit-Eintrag zeigt weiterhin `grund=budget`**, auch wenn die eigentliche Ursache ein vergifteter Bucket ist — der unterscheidbare Grund `usage_korrupt` erreicht nur `console.error` an der Lesekante (D-2, bewusster Phasenschnitt). Die Phasen-Invariante ist damit formal erfuellt, aber der Operator muss Log und Audit zeitlich korrelieren — Kandidat fuer eine Folgephase.
3. **Achsen-Asymmetrie bei fraktionalem (nicht-NaN-) Bucket:** `globalUsageTotals` leitet `costCents` ueber `Math.floor` neu ab, ein fraktionaler Tenant-Bucket floort dort implizit und erreicht den Riegel auf der Plattform-Achse nie fraktional. Kein fail-open: alle drei Aufrufstellen wurden geprueft, die Tenant-Achse wird ueberall mitgefragt und sperrt.
4. `recordUsageEvent` (Stripe-Ledger, `costCents`) ist nicht gegen unbuchbare Werte gesichert — bewusst ausserhalb der deklarierten P1-Kanten, speist laut Code nicht das Budget-Gate. Scope-konform, aber offene Geld-Kante fuer spaeter.

---

## 6. Clean-Code-Audit

**Verdikt: PASS** — `blocker: false`. Keine S1-, keine S2-Befunde.

- **S1 (Blocker):** keine.
- **S2 (Fragilitaet):** keine.
- **S3 (nicht-blockierende Beobachtungen):**
  1. `src/store/state-ops.js` (`turnIncrementsBookable`) — `isBookableCents` wird auch auf `tokens.inputTokens`/`tokens.outputTokens` angewandt, obwohl der Funktionsname die Cents-Domaene verspricht (Token-Zaehler sind keine Cents). Im Kommentar direkt darueber bewusst begruendet, bleibt aber ein Name-vs-Nutzung-Mismatch an der Aufrufstelle. Optionaler Fix: generischerer Name (z. B. `isBookableInteger`) oder `isBookableCents` als duenner Domain-Wrapper.
  2. `src/store/state-ops.js` (`discardCorruptWrite`, `denyCorruptUsage`) + `src/store/pg.js` (`hydratedCostCents`) — drei unterschiedliche Log-Formate/Praefixe (`usage`/`budget`/`pg`) fuer denselben `usage_korrupt`-Sachverhalt an drei Stellen; jede hat unterschiedliche, nachvollziehbar begruendete Kontextdaten, aber eine gemeinsame Log-Helferfunktion wuerde Konsistenz erzwingen statt sie der Disziplin zu ueberlassen. Optional, nicht dringend bei aktuell nur drei Stellen.
- **S4:** keine.

**Pass-Notes (Auszug):** G5 (Kernziel der Phase) sauber erfuellt — `isBookableCents` ist die einzige Quelle der Invariante, alle Geld-Kanten (Schreiben, Lesen, Hydrierung, plus Reserve-Zusatzbefund) routen ausschliesslich darueber. Das alte Inline-Idiom ist komplett verschwunden **und** per Regex-Regressionstest gegen Wiederauftreten abgesichert. Die erste Review-Runde hatte bereits eine echte G26-Luecke gefunden (fraktionale Cents wie `0.5` wurden vor dem Fix durchgelassen) und mit eigenem Regressionstest geschlossen; `Number.isInteger` wurde sauber nachgezogen. G25 (keine Magic Strings): der Audit-Grund ist eine benannte Konstante. `trackUsage` ist jetzt alles-oder-nichts (Guard vor jeder Mutation). Volle Suite gruen (2550/2550, hier reproduziert). Die Auslassung von `.env.example`/`render.yaml` ist explizit als bindende Owner-Entscheidung dokumentiert, keine stille Luecke — daher nicht geflaggt.

**Top-Todos (alle optional, kein Merge-Blocker):**
- Kein Blocker vorhanden — Merge kann erfolgen.
- Optional: Namensmismatch von `isBookableCents` bei Token-Zaehler-Nutzung in `turnIncrementsBookable` adressieren.
- Optional: die drei leicht unterschiedlichen `usage_korrupt`-Log-Formate bei Gelegenheit vereinheitlichen, falls ein weiterer Aufrufer dazukommt.

---

## 7. Fix-Runden

**Eine Runde (`r1`).** Die erste Review-Runde (Safety + Clean-Code, vor der hier dokumentierten finalen Runde) fand **zwei Blocker**, die in einer einzigen, minimalen Fix-Runde behoben wurden — neuer Branch `phase/ba-p1-nan-riegel-fix1` (von `phase/ba-p1-nan-riegel`).

Aus der vorliegenden Fix-Zusammenfassung dokumentiert:

- **G26/D7 (`src/store/defaults.js`):** `isBookableCents(x)` prueft seither `Number.isFinite(x) && Number.isInteger(x) && x >= 0` statt nur Endlichkeit und Nicht-Negativitaet. Damit werden fraktionale Cent-Betraege (z. B. `0.5`) als nicht mehr buchbar eingestuft — die reale Luecke, die die erste Review-Runde fand (ein fraktionaler Wert war zuvor als "buchbar" durchgerutscht). Der zugehoerige Doku-Kommentar wurde entsprechend aktualisiert.
- Der zweite in der Fix-Zusammenfassung genannte Blocker ist in der hier vorliegenden Quelle nur als "beide Review-Blocker sauber und minimal behoben" benannt; der Wortlaut der Fix-Beschreibung ist an dieser Stelle abgeschnitten. Aus den Folgeartefakten (finale Safety- und Clean-Code-Review, s. o.) laesst sich ableiten, dass nach dieser Fix-Runde keine weiteren S1/S2-Befunde bzw. Safety-Blocker mehr bestanden — die finale Runde attestiert `blockers: []` bzw. `blocker: false`.

Nach der Fix-Runde: **finale Safety-Review = APPROVED**, **finale Clean-Code-Review = PASS** (s. Abschnitte 5 und 6), Testsuite bei **2550/2550**. Damit erreichte die Phase das Gate `PASS` nach genau einer Fix-Runde.

---

## 8. Offene Deploy-Vorbedingungen

1. **`.env.example`/`render.yaml` bleiben bewusst bei `MAX_BUDGET_EUR=8`** (Abweichung D-1) — kein Nachzug auf `12` im Rahmen dieser Phase; falls ein spaeterer P0-Nachzug beschlossen wird, ist das eine gesonderte, vom Owner zu treffende Entscheidung.
2. **Persistierter Audit-Grund bleibt `grund=budget`** auch bei einem durch `usage_korrupt` ausgeloesten Deny (Concern 2 aus der Safety-Review) — der unterscheidbare Grund ist derzeit nur im Server-Log sichtbar, nicht im gespeicherten Audit-Eintrag. Empfohlener Kandidat fuer eine Folgephase (im Plan bereits als P5a-Anschluss vorgezeichnet), kein Blocker fuer diesen Merge.
3. **`recordUsageEvent` (Stripe-Ledger)** ist weiterhin nicht gegen unbuchbare Werte gehaertet — bewusst ausserhalb des P1-Scopes, da diese Kante laut Code nicht das Budget-Gate speist. Offene Geld-Kante fuer eine spaetere Betrachtung.
4. **Kein neuer `PLAN-SECURITY.md`-Eintrag** noetig (Abweichung D-8) — die Phase haertet ausschliesslich, entfernt/lockert keine bestehende Sicherung.
5. Vor einem produktiven Deploy: regulaerer Deploy-Prozess laut `render.yaml`/Runbook beachten; diese Phase selbst hat keine Env-Variablen oder Infrastruktur veraendert, die einen Sonderschritt erfordern wuerden.

---

*Hinweis zum PII-Schutz dieses Berichts: alle Tenant-Bezuege in Plan/Tests sind generische Platzhalter (`tenant_a`, `BOOTSTRAP_TENANT_ID`); keine echten Kunden-/Tenant-Identifikatoren, Telefonnummern oder Secrets aus den Quellartefakten wurden in diesen Bericht uebernommen.*
