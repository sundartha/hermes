# KS-Kette — Scope-Spec je Phase (autoritativ vor dem Plan-Doc)

Autoritative Quelle fuer Befund, Herleitung und Abnahmekriterien bleibt
`PLAN-KOSTEN-STEUERUNG.md`. Diese Datei ergaenzt **nur** die Abgrenzungen, die dort
verstreut stehen und in der Umsetzung erfahrungsgemaess verloren gehen.

Fuer JEDE Phase dieser Kette gilt:

- **Regel 0 — Basis pruefen.** Vor der ersten Aenderung: `git merge-base --is-ancestor
  master HEAD` im Worktree. Sitzt der Worktree nicht auf dem aktuellen `master`, ist das
  ein Blocker — melden, nicht weiterarbeiten.
- **Keine Env-Aenderung im Render-Dashboard**, kein Deploy, kein schreibender Zugriff auf
  die Prod-DB. Aenderungen an `.env.example` und `render.yaml` sind Code und gehoeren in
  die Phase; das Setzen des Live-Werts ist Owner-Sache.
- **Nur die eigene Phase.** Befunde aus Nachbarphasen werden im Bericht notiert, nicht
  nebenbei gefixt.
- **`npm test` muss gruen sein.** `npm run test:gates` darf rot sein (i18n-Launch-Katalog).
- Neues Verhalten braucht einen Test, der den Bestand **rot** faerbt (Mutationsprobe).

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

### E9 ist NICHT Teil dieser Phase

`MAX_BUDGET_EUR` (Plattform-Notaus, heute 30 EUR / 3000 ct) wird in dieser Phase **nicht
geaendert** — weder im Code-Default, noch in `.env.example`, noch in `render.yaml`. Die
Zahl ist eine Geschaeftsentscheidung des Owners (E9) und offen.

Erwartetes und ausdruecklich getragenes Verhalten: die Business-Decke laeuft nach der
Umstellung ueber den Plattform-Cap und wird von `deriveTenantBudgetFromPlan`
(`state-ops.js:1348`) darauf **geklemmt**, mit Boot-WARN. Das ist der dokumentierte
Zwischenzustand aus E9, kein Defekt. Ein WARN ist zulaessig, ein FATAL nicht.

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
