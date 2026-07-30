# KS-Kette — Scope-Spec je Phase (autoritativ vor dem Plan-Doc)

Autoritative Quelle fuer Befund, Herleitung und Abnahmekriterien bleibt
`PLAN-KOSTEN-STEUERUNG.md`. Diese Datei ergaenzt **nur** die Abgrenzungen, die dort
verstreut stehen und in der Umsetzung erfahrungsgemaess verloren gehen.

Fuer JEDE Phase dieser Kette gilt:

- **Regel 0 — Basis herstellen, DANN lesen.** Ein frischer Worktree sitzt hier
  erfahrungsgemaess auf einem alten Commit (gemessen: 57adf4a, 75 Commits hinter master).
  Das ist normal und harmlos — solange du in dieser Reihenfolge arbeitest:

  1. **Zuerst** den Arbeitsbranch von `master` anlegen: `git checkout -b <branch> master`
     (Reviewer: `git checkout -b <review-branch> <ziel-branch>`). Refs sind zwischen
     Worktrees geteilt, `master` loest immer korrekt auf.
  2. **Danach** verifizieren: `git rev-parse HEAD` muss `git rev-parse master` entsprechen
     (bzw. `git merge-base --is-ancestor master HEAD` fuer einen Ziel-Branch). Erst wenn
     das stimmt, ist der Baum aussagekraeftig.
  3. **Erst dann** Quelldateien lesen oder Tests fahren.

  Wer Schritt 3 vor Schritt 1 macht, liest einen veralteten Stand und zieht daraus falsche
  Schluesse. Genau das ist im KS-P10-Lauf passiert: der Review-Agent hat aus seinem eigenen
  noch nicht umgestellten Worktree gefolgert, die Phase sei auf veralteter Basis gebaut
  worden — beide vorangegangenen Impl-Laeufe hatten nachweislich die korrekte Basis.
  Ein veralteter HEAD **vor** dem Checkout ist KEIN Blocker und wird nicht als solcher
  gemeldet. Ein falscher HEAD **nach** dem Checkout ist einer.
- **Keine Env-Aenderung im Render-Dashboard**, kein Deploy, kein schreibender Zugriff auf
  die Prod-DB. Aenderungen an `.env.example` und `render.yaml` sind Code und gehoeren in
  die Phase; das Setzen des Live-Werts ist Owner-Sache.
- **Nur die eigene Phase.** Befunde aus Nachbarphasen werden im Bericht notiert, nicht
  nebenbei gefixt.
- **`npm test` muss gruen sein.** `npm run test:gates` darf rot sein (i18n-Launch-Katalog).
- Neues Verhalten braucht einen Test, der den Bestand **rot** faerbt (Mutationsprobe).

---

## KS-P9 — Plattform-Achse verliert die Sperrwirkung

Abschnitt `### KS-P9` in `PLAN-KOSTEN-STEUERUNG.md` ist die Spec. Zusaetzlich bindend:

### Diese Phase setzt eine bereits getroffene Owner-Entscheidung um

Der Owner hat am 2026-07-30 entschieden (E10), dass `MAX_BUDGET_EUR` kein geschuetztes Gate
mehr ist. **CLAUDE.md Absolute Regel 1 ist bereits entsprechend geaendert** — die Regel
nennt seitdem "die pro-Tenant-Kostendecke" statt des globalen Topfs, und die Begruendung
steht als Owner-Entscheidung im Regelwerk selbst.

Fuer den Safety-Review heisst das: das Entfernen der Plattform-Sperrwirkung ist hier
**kein** unautorisiertes Aufweichen eines Gates, sondern der Auftrag. Zu pruefen ist
stattdessen, ob die Umsetzung *genau* das tut und nicht mehr:

- Die **pro-Tenant-Decke** bleibt in voller Schaerfe erhalten. Wird sie mit angefasst,
  ist das ein Blocker.
- Abo+KYC vor Outbound, Denylist, Land-Gate, Stundenlimit, Max-Gespraechsdauer,
  Signaturpruefung, `OUTBOUND_FROZEN`: alle unangetastet.
- Der Beobachtungspfad (`platformSpendObservedCents`, `claimPlatformSpendWarning`,
  `PLATFORM_SPEND_WARN_PERCENT`) bleibt funktionsfaehig. Die Plattform-Summe wird weiter
  gemessen — nur ihre Sperrentscheidung entfaellt.

### Die Boot-Guards: trennen, nicht pauschal senken

`spendCapCoherence` und `planCapInertFindings` begruenden sich woertlich damit, dass "der
globale Cap immer zuerst bindet". Dieser Halbsatz wird durch die Phase falsch. Trenne am
Code sauber:

- Klauseln, die eine Tenant-/Plan-Decke gegen die **Plattform-Zahl** halten: Praemisse
  entfaellt -> entfernen oder neu ausrichten, mit Begruendung im Bericht.
- Klauseln, die die **Worst-Case-Reserve gegen die Tenant-Decke** halten: unberuehrt,
  bleiben FATAL.

Eine pauschale Absenkung `fatal: true -> false` ist NICHT die Loesung — genau daran ist
der erste KS-P5a-Lauf gescheitert (D-1). Wenn eine Aussage nicht mehr stimmt, wird sie
entfernt, nicht leiser gestellt.

### Was mit `MAX_BUDGET_EUR` als Env-Wert passiert

Der Key bleibt bestehen und wird weiter gelesen — er ist nach der Phase die Bezugsgroesse
der Schwellenwarnung, nicht mehr die einer Sperre. `.env.example` und `render.yaml`
beschreiben ihn danach wahrheitsgemaess als Beobachtungs-/Warnschwelle. Den Live-Wert
aendert der Owner, nicht die Phase.

---

## KS-P10 — Inbound wird nie budget-gesperrt

Abschnitt `### KS-P10` in `PLAN-KOSTEN-STEUERUNG.md` ist die Spec. Zusaetzlich bindend:

- Auch diese Phase setzt eine dokumentierte Owner-Entscheidung um (E11, CLAUDE.md Regel 1).
- **Die Richtungsunterscheidung ist das ganze Feature.** Outbound behaelt seine
  Sperrwirkung vollstaendig — Dial-Gate, Reserve, Mid-Call-Abbruch. Ein Test, der
  beweist, dass Outbound bei erschoepfter Decke weiterhin 402 bekommt, ist Pflicht und
  nicht optional.
- `call.direction` ist die einzige zulaessige Unterscheidung, spiegelbildlich zu
  `metering.js:69`. Kein neuer Env-Schalter, kein Setting, das Inbound-Sperren wieder
  einschaltet.
- Ein Call ohne aufloesbare Richtung wird wie **Outbound** behandelt (fail-closed).

---

## KS-P5a — Starter-Kunde bekommt die verkauften Minuten

Abschnitt `### KS-P5a` in `PLAN-KOSTEN-STEUERUNG.md` ist die Spec. Zusaetzlich bindend:

### Reihenfolge-Realitaet

KS-P6 (Code-Fallback `voiceTariffDefaultCents` 300 -> 30) ist **noch nicht gemergt**. Im
Code steht der Fallback also weiterhin auf 300, live im Render-Dashboard auf 30 (E1,
erledigt). Die Decken-Ableitung muss **mit beiden Werten** kohaerent bleiben:

- mit Fallback 300 (heutiger Code, Testumgebung) MUSS der Dienst gruen booten,
- mit 30 (Live-Wert, und ab KS-P6 auch Code) ebenfalls.

Wenn die neue Ableitung an einem der beiden Werte einen **fatalen** Boot-Guard ausloest,
ist das ein Blocker: melden, nicht durch Absenken eines Gates umgehen.

### Der Plattform-Cap ist bereits erledigt (KS-P9)

**KS-P9 laeuft VOR dieser Phase** und hat der Plattform-Achse die Sperrwirkung genommen
(E10). Damit ist die Kollision aus dem ersten Lauf gegenstandslos: eine Business-Decke von
4500 ct kollidiert mit nichts mehr, und `PLAN_CAP_INERT` existiert in seiner alten Form
nicht mehr.

**D-1 aus dem ersten Lauf ist damit hinfaellig.** Kein Boot-Guard wird in dieser Phase von
FATAL auf WARN gesenkt. Faellt die Decken-Ableitung trotzdem gegen einen fatalen Guard,
ist das ein Blocker: melden, nicht das Gate leiser stellen.

`MAX_BUDGET_EUR` wird in dieser Phase **nicht** angefasst — weder Code-Default noch
`.env.example` noch `render.yaml`. Die Aufstellung unten bleibt trotzdem Pflicht: sie ist
die Groessenordnung, an der der Owner die Warnschwelle ausrichtet.

Zu pruefen und im Bericht zu beantworten: ob `deriveTenantBudgetFromPlan`
(`state-ops.js:1348`) die Plan-Decke nach KS-P9 ueberhaupt noch auf den Plattform-Wert
klemmen darf. Die Klemmung existiert, weil der Plattform-Cap zuerst band — bindet er nicht
mehr, verkuerzt sie die verkaufte Leistung ohne Gegenwert. Faellt die Klemmung in KS-P9
bereits weg, hier nur feststellen; steht sie noch, gehoert sie in diese Phase.

### Pflicht-Artefakt: die Aufstellung

Erster Schritt der Phase ist eine Rechnung, und sie ist ein **Liefergegenstand**, kein
Zwischenergebnis. Sie gehoert in den Phasenbericht `tasks/ks-p5a-report.md` unter der
Ueberschrift `## Aufstellung (Grundlage fuer Owner-Entscheidung E9)` und beantwortet:

1. Welcher Satz wird tatsaechlich **gebucht** — je Fall: Inland vs. Ausland
   (`isDomesticLeg`), Assistant-Pfad an vs. aus. Mit Fundstelle.
2. Welche **Decke** folgt daraus je Plan aus `CATALOG_SLUGS` (verkaufte Minuten,
   Kopffreiheit, resultierende Decke in Cent).
3. Welcher **Plattform-Cap** traegt N gleichzeitig ausschoepfende zahlende Kunden — als
   Tabelle fuer N = 1, 3, 5, 10, getrennt nach Starter und Business.
4. Was der heutige Wert 3000 ct davon traegt, und ab welchem N er klemmt.

Ohne diese Tabelle ist die Phase nicht fertig, auch wenn der Code stimmt.

### E5a woertlich nehmen

Es darf **einen** Satz geben. `voiceCapRateCentsPerMin` entfaellt als eigene Groesse —
das ist Teil der Aenderung, nicht ihr Nebenprodukt. Eine Loesung, die beide Zahlen am
Leben laesst und sie nur synchronisiert, erfuellt E5a **nicht**.

### Absolute Regel 1

Die Decke wird angehoben, nicht abgeschafft. Die Schnittmenge Tenant-Decke UND
Plattform-Notaus bleibt bestehen. `PLAN-SECURITY.md`: geaenderte Decken-Herleitung mit
Zahlen eintragen.
