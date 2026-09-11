# Kettenstand: Geldpfad-Behebungskette (GP-P0..GP-P6)

Manifest: `PLAN-GELDPFAD.md`. Kickoff: `tasks/geldpfad-kickoff.md`.
Diese Datei ist die Uebergabe an die naechste Session. Sie bleibt kurz.

## Baseline vor dem ersten Lauf (11.09.2026, master `438a231`)

`npm test`: **5887 pass / 1 fail**, gemessen 16:04-16:07 Uhr.

Der eine rote Fall ist **erklaert und kein Code-Defekt**: `P14: public/tenant.html existiert
nicht mehr`. Die Datei liegt als **untrackte Owner-Arbeit** im Arbeitsbaum (`?? public/tenant.html`,
16 KB, 11.09. 16:01) und ist in `master` nicht getrackt. Frische Worktrees sehen sie nicht, dort
ist die Bank gruen. Der Fall ist der Kette **nicht** anzulasten und wird nicht angefasst.

**Erwartung fuer jede Phase:** 5887 pass + die von der Phase neu eingefuehrten Faelle, 1 fail
(ebendieser). Eine andere Zahl ist zu erklaeren, bevor gemergt wird.

Bekanntes Rennen (Memory `sec-testbank-parallel-race`): voll parallel kann die Bank rot werden,
mit `--test-concurrency=4` gruen. Sporadisch rote Faelle erst so gegenpruefen.

## Lauf-Werkzeug

Per-run Kopie: `.claude/workflows/runs/geldpfad-lean.js` (Original `phase-impl-lean.js` bleibt
unberuehrt). Fuenf Abweichungen, alle aus dem Effizienz-Riegel des Kickoffs:

1. Impl/Fix fahren **nur betroffene Testdateien**, nicht die volle Suite (workflow.md 2a Regel 2).
2. Safety-Review faehrt die vom Impl-Agenten genannten Dateien selbst nach, nicht die Suite.
3. **Warteverbot** in jedem arbeitenden Prompt (kein `sleep`/Poll - 20 % der Turns des
   260-Mio-Ausreissers waren Pollen).
4. **Turn-Budget 60** als sauberer Abbruch in Impl und Fix.
5. **Verbotsliste** (kein `payment_method_types`, keine Denylist gegen `link`, kein
   Signalwechsel an `invoiceTotal===0`, kein echter Anbieter-Call) - bewusst auch im
   **Plan**-Agenten, denn was er nicht plant, baut niemand.

Modell-Pins unveraendert: Plan + Safety = Opus, Impl/Clean-Code/Fix/Report = Sonnet; bei
`highStakes:true` zusaetzlich Impl = Opus und Safety = xhigh.

## Phasenstand

| Phase | Groesse | maxFixRounds | highStakes | Lauf-ID | Gate | Merge | Abnahme |
|---|---|---|---|---|---|---|---|
| GP-P0 | S | 1 | false | `wf_d61a47d9-23d` | PASS (0 Fix-Runden) | `a60168c` | **erfuellt** |
| GP-P1 | S | 1 | false | - | - | - | - |
| GP-P2 | L | 3 | **true** | - | - | - | - |
| GP-P3 | M | 2 | **true** | - | - | - | - |
| GP-P4 | M | 2 | **true** | - | - | - | - |
| GP-P5 | S | 1 | false | - | - | - | - |
| GP-P6 | M | 2 | **true** | - | - | - | - |

## Offene Befunde

- **GP-P0, Zeitanker ueber Stripe statt ueber Zustandsalter.** Der Plan nennt nur
  `PAID_WITHOUT_NUMBER_GRACE_MS`; gebaut ist der Anker als Beginn der laufenden
  Stripe-Abrechnungsperiode (`resolvePeriodStartIso`), fail-closed ohne Anker. Ein Mandant
  ohne Stripe-Anker (Owner/Bootstrap) wird also **nie** gemeldet. Das deckt sich mit
  Abnahme 4 ("kein aktives Abo -> null Befunde") und ist als Testfall gepinnt, geht aber
  ueber den Plantext hinaus. Bewusst so belassen: Schweigen ist bei einem reinen
  Beobachtungsselektor die sichere Richtung.
- **Lauf-Kosten ueber dem Richtwert.** GP-P0 (die kleinste Phase) kostete 52,2 Mio Token bei
  348 Turns; Richtwert war unter 40 Mio und unter 150 Turns je Agent. Der teuerste Agent lag
  bei 157 Turns / 27,5 Mio - dicht dran, nicht weggelaufen (kein 86-Prozent-Ausreisser, das
  Verhaeltnis ist gesund). Bei den groesseren Phasen im Auge behalten.

## Wirkung fuer den Kunden (das, was am Ende zaehlt)

- **GP-P0:** der Zustand "zahlt, hat keine Nummer" erzeugt jetzt von selbst genau eine
  Betreiber-Notiz je Zustandsaenderung, statt nur bei manueller DB-Forensik sichtbar zu
  werden. Fuer den Kunden aendert sich noch nichts - aber der Fall vom 11.09. faellt kuenftig
  ohne Zutun auf.

## Owner-Blocker (nur melden, nicht baubar)

1. **`+4921194289148`** seit 01.09.2026 auf `requirement-info-pending` - Telnyx erwartet
   Nachweisdokumente. Kein Code-Pfad loest das auf.
2. **Link im Stripe-Dashboard deaktivieren** (Owner-Entscheidung 11.09.: nur Karte). Reiner
   Dashboard-Schritt. Ausdruecklich **nicht** per `payment_method_types` im Code zu ersetzen.

Erledigt: Telnyx-Guthaben auf 6,79 USD aufgeladen (knapp, nicht reichlich - vor einer Phase mit
echtem Kauf erneut messen). Der Mandant des Vorfalls ist ein internes Konto: keine Erstattung,
kein Backfill, keine Kundenkommunikation.

Restunsicherheit, bewusst stehengelassen: das Stripe-Lese-Scope fuer `GET /v1/prices/{id}` ist
im Testmodus belegt, im Live-Modus nur wahrscheinlich. Scheitert der erste Live-Aufruf in GP-P6
mit 403, ist das Scope die Ursache und kein Codefehler.
