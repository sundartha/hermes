# Kettenstand: Geldpfad-Behebungskette (GP-P0..GP-P6) — ABGESCHLOSSEN 2026-09-11

**Alle sieben Phasen gebaut, abgenommen und gemergt. Nichts offen ausser den Owner-Blockern
unten. Nicht gepusht, nicht deployt** (Render deployt aus dem Upstream-Repo; ein Push hier
waere ein Release, kein Test).

Manifest: `PLAN-GELDPFAD.md`. Kickoff: `tasks/geldpfad-kickoff.md`.
Diese Datei ist die Uebergabe an die naechste Session. Sie bleibt kurz.

## Baseline vor dem ersten Lauf (11.09.2026, master `438a231`)

`npm test`: **5887 pass / 1 fail**, gemessen 16:04-16:07 Uhr.

**Fahre die Bank mit `--test-concurrency=4`.** Der Wrapper reicht Zusatzargumente durch
(`node test/testbaenke-run.mjs regression --test-concurrency=4`). Voll parallel meldet sie ihr
bekanntes Rennen mit **wechselnden Namen und wechselnder Zahl** - nach GP-P2 erst vier, dann
neun rote Faelle, beim gedrosselten Lauf null. Ein roter Fall zaehlt erst, wenn er **isoliert**
rot ist.

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
| GP-P1 | S | 1 | false | `wf_d94f1a66-399` | PASS (0 Fix-Runden) | `fe6d90a` | **erfuellt** |
| GP-P2 | L | 3 | **true** | `wf_8fb281ac-282` | PASS + 1 Lead-Fix | `2acb189` | **erfuellt** |
| GP-P3 | M | 2 | **true** | `wf_84056221-3a0` | PASS (0 Fix-Runden) | `001d394` | **erfuellt** |
| GP-P4 | M | 2 | **true** | `wf_87e78031-dda` | PASS (0 Fix-Runden) | `46c0e26` | **erfuellt** |
| GP-P5 | S | 1 | false | `wf_2f4805f0-e2b` | PASS (0 Fix-Runden) | `3f409ed` | **erfuellt** |
| GP-P6 | M | 2 | **true** | `wf_2e0ff9f5-6c6` | PASS (0 Fix-Runden) | `805966e` | **erfuellt** |

## Offene Befunde

- **Der Effizienz-Riegel hat einen Preis, und er ist eingetreten.** Weil Impl, Fix und Safety
  nur die betroffenen Testdateien fahren, faellt ein gebrochener BESTANDStest erst beim Lead
  auf. Bei GP-P2 waren es zwei (Altlast-Ratsche gegen die bewegten eslint-Pins, ein
  Reconcile-Fixture ohne Kartenangabe) - beide isoliert rot, also echt, beide an der Wurzel
  nachgezogen. Die Abwaegung bleibt richtig: der Riegel spart drei volle Suiten je Lauf, und
  das Netz des Leads faengt genau diesen Fall. Aber der Lead-Lauf ist damit **Pflicht**, nicht
  Kuer - ein Merge auf das PASS des Workflows hin waere hier falsch gewesen.
- **GP-P2 hat einen Stripe-Nachschlag ergaenzt, den der Plan nicht nennt.**
  `retrievePaymentMethodType` liest `GET /v1/payment_methods/<id>`. Noetig, weil der
  Webhook-Schreibpfad (eine der vier vom Plan geforderten Bindestellen) kein Checkout-Objekt
  hat, an dem sich etwas expandieren liesse. Der Test pinnt: genau ein Nachschlag je Bindung,
  nur der Enum verlaesst die Funktion, kein Schluessel in der Fehlermeldung, und scheitert der
  Nachschlag, entsteht die Bindung trotzdem - mit unbekanntem Typ, der dann fail-closed nicht
  provisioniert. Ein zusaetzlicher Anbieter-Aufruf je Webhook-Bindung ist der Preis.

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

### Befunde aus GP-P3 bis GP-P5

- **Die Dashboard-Tests laufen NICHT in `npm test`.** Der Wrapper sucht `test/*.test.js`;
  `apps/web/test/**` bleibt draussen und braucht einen eigenen Lauf:
  `cd apps/web && PUBLIC_GATEWAY_URL=https://vodafone-agent.onrender.com node --test "test/**/*.test.js"`.
  Wer eine Phase mit Dashboard-Anteil nur ueber `npm test` abnimmt, hat den Dashboard-Anteil
  NICHT geprueft. Stand nach GP-P3: 196 pass / 3 fail, gegenueber 180/18 davor - die drei
  verbliebenen betreffen `renderPlanChoice`/`dismissPlanChoice` und lagen schon vorher auf
  master. Bestandsbefund, nicht diese Kette.
- **Ein Commit auf master waehrend eines laufenden Workflows ist vermeidbarer Laerm.** Der
  Kettenstand-Commit nach GP-P2 fiel in den Start von GP-P3; der Plan-Agent bemerkte die
  Abweichung und musste sie erklaeren. Folgenlos, aber unnoetig: Kettenstand VOR dem Start
  schreiben.

## Wirkung fuer den Kunden (das, was am Ende zaehlt)

- **GP-P2:** wer mit einer Zahlungsmethode bezahlt, die keine Vorautorisierung traegt,
  bekommt jetzt eine klare Ablehnung mit dem Typ als Grund - statt eine Abbuchung ohne
  Gegenleistung und eine Meldung ueber angeblich fehlende Deckung.
- **GP-P3:** wer danach eine brauchbare Karte hinterlegt, bekommt seine Nummer ohne
  Operator-Eingriff. Nach drei Versuchen endet der Weg in der manuellen Klaerung statt in
  unbegrenzter Carrier-Miete.
- **GP-P4:** derselbe Wiederanlauf laeuft auch ohne Zutun des Kunden - aber nie gegen eine
  Zahlungsmethode, die per Konstruktion nie besteht.
- **GP-P5:** kein Kundeneffekt. Der Kommentar im Geldpfad behauptet nicht mehr das Gegenteil
  dessen, was der Code tut.
- **GP-P6:** kein Kundeneffekt heute. Kuenftig faellt eine Abweichung zwischen angezeigtem und
  abgebuchtem Preis auf, bevor sie jemand bezahlt.
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

## Kosten der Kette (gemessen mit `scripts/workflow-kosten.mjs`, nicht `subagent_tokens`)

| Phase | Token | Turns |
|---|---|---|
| GP-P0 | 52,2 Mio | 348 |
| GP-P1 | 54,2 Mio | 377 |
| GP-P2 | 58,2 Mio | 363 |
| GP-P3 | 60,6 Mio | 415 |
| GP-P4 | 44,7 Mio | 312 |
| GP-P5 | 11,5 Mio | 144 |
| GP-P6 | 56,1 Mio | 355 |
| **Summe** | **337,5 Mio** | **2314** |

Dazu ein Lead-Fix-Agent nach GP-P2 (52 Werkzeug-Aufrufe). Der Richtwert des Kickoffs lag bei
unter 40 Mio je Phase; gehalten hat ihn nur GP-P5 (reine Kommentarkorrektur, 11,5 Mio) und
knapp GP-P4. **Kein Lauf ist weggelaufen** - der groesste Einzelagent lag bei 206 Turns
(GP-P3), weit entfernt vom 687-Turn-Ausreisser der Vergangenheit, und kein Lauf brauchte auch
nur eine Fix-Runde. Die Kosten liegen in der Groesse der Phasen, nicht in Warteschleifen.

## Was eine Nachfolge-Session zuerst wissen muss

1. **Nicht gepusht.** Alles liegt lokal auf `master`. Der Geldpfad ist LIVE unveraendert.
2. **Vor dem Deploy:** der neue Boot-Guard `assertPricedPlans` beendet den Start, wenn bei
   `PAYMENT_ENABLED=true` ein Katalog-Tarif (`starter`, `business`) keine Stripe-Price-Id hat.
   Beide sind live sehr wahrscheinlich gesetzt - am 11.09. erreichten beide Tarife Stripe
   (starter 200, business 402 wegen Deckung, nicht wegen fehlender Price) - aber das ist eine
   Schlussfolgerung aus dem Vorfall, **kein Blick ins Render-Dashboard**. Vor dem Deploy dort
   nachsehen.
3. **Der Dienst startet lokal nicht**, und das ist Bestand seit dem 20.07.2026 (lct-p4):
   `COST_TRUING_REQUIRED_RECORD_TYPES ist leer`. Kein Befund dieser Kette.
4. **Die Dashboard-Suite laeuft nicht in `npm test`** (s.o.), und drei ihrer Faelle sind seit
   vor dieser Kette rot (`renderPlanChoice`/`dismissPlanChoice`).
