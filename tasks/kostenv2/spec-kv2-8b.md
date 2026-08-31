<!-- Nachbesserung zu KV2-8. ENGER Auftrag: genau zwei Punkte, sonst nichts. -->

# Auftrag

Der KV2-8-Review hat nach zwei Fix-Runden einen Code-Blocker stehen lassen. Der Lead hat
ihn gegen `master` verifiziert - er ist echt. Behebe genau ihn, plus die Testluecke, durch
die er gerutscht ist. **Kein weiterer Umbau, kein Aufraeumen, kein Scope daneben.**

Basis ist `phase/kv2-8-impl-fix2`; alles andere aus KV2-8 bleibt, wie es ist.

## B1 - der Riegel fehlt im no-estimate-Zweig

`src/billing/cost-truing.js`, Funktion `truedSourceOf` (Zeile ~698). Erste Zeile:

```js
if (!isBookableCents(call.estimatedCostCents)) return projektion.vollBelegt ? COST_TRUING_SOURCE.NO_ESTIMATE : measured.source;
```

Bei fehlendem Schaetzbetrag UND unvollstaendigem Buch faellt `measured.source`
unveraendert durch - und das kann `telnyx_detail_records` sein, also eine BEWEISENDE
Herkunft. Damit verletzt die Zeile die Invariante, die drei Zeilen tiefer im selben
Rumpf ausformuliert ist ("Ohne vollstaendiges Buch darf NIE eine BEWEISENDE Herkunft
entstehen", Abnahme (e)) - der Riegel steht nur im Zweig MIT Schaetzbetrag.

**Das ist eine Regression gegen `master`.** Dort (`cost-truing.js:643-648`) lautete der
no-estimate-Zweig `measured.source === DETAIL_RECORDS ? NO_ESTIMATE : measured.source` -
eine beweisende Herkunft konnte hier nie durchfallen. Der master-Kommentar sagt es
woertlich: "Beide sind nicht 'telnyx_detail_records'."

Vom Review am laufenden Sweep reproduziert (telnyx_budget, `estimatedCostCents=null`,
vollstaendiger Pflicht-Typ-Pool, Betrag 4.010.000, `billedSec=0`, Belegzeile bleibt
vorlaeufig): persistiert wird `telnyx_detail_records`, `istBeweisendeHerkunft=true`,
und `isDriftSample` (`src/billing/cost-calibration.js:63`) nimmt den Anruf als
Stichprobe - mit einem Betrag, der nur einen Teil des Anrufs traegt. Kein Geldeffekt,
aber ein falscher Tarif-Drift-Alarm auf der Beobachtungsachse: genau die Datenluecke,
die KV2-8 schliessen sollte.

Fix (vom Review benannt, uebernimm ihn oder etwas nachweislich Gleichwertiges):

```js
if (!isBookableCents(call.estimatedCostCents))
  return projektion.vollBelegt
    ? COST_TRUING_SOURCE.NO_ESTIMATE
    : (istBeweisendeHerkunft(measured.source) ? COST_TRUING_SOURCE.INCOMPLETE : measured.source);
```

## B1-T - die Testluecke, durch die es gerutscht ist

Abnahme (e) verlangt woertlich, JEDEN Wert von `COST_TRUING_SOURCE` einmal durch
`truedSourceOf` zu schicken. `test/kv2-8-settlement.test.js` prueft aber nur
`istBeweisendeHerkunft` ueber den Enum plus zwei Einzelfaelle - `truedSourceOf` selbst
wird ueber seinen Eingaberaum nie durchgefahren. Genau deshalb blieb B1 unentdeckt.

Schliesse die Luecke: ein Tabellentest, der `truedSourceOf` ueber das Kreuzprodukt
{jeder Enum-Wert} x {Schaetzbetrag vorhanden / fehlt} x {Buch vollbelegt / unvollstaendig}
faehrt und in JEDER Zeile prueft, dass ohne vollstaendiges Buch nie eine beweisende
Herkunft herauskommt. Die Kombination "kein Schaetzbetrag + unvollstaendiges Buch" fehlt
bisher auch in den Gegenproben (Gegenprobe 3 faehrt no-estimate nur mit VOLLSTAENDIGEM
Pool) - sie muss dazu.

## Was der Lead bereits erledigt hat - NICHT nochmal anfassen

Der zweite KV2-8-Blocker (B2, die Spec-Sperre KV2-5(d)) ist geklaert. Der Lead hat die
fehlende Positiv-Kontrolle am 2026-08-31 selbst gegen Prod-DB und Telnyx-API gefahren;
Ergebnis in `tasks/kostenv2/befunde-kette.md`, Abschnitt M-1. Kurz:

- `sip-trunking` liefert 7 Belege (HTTP 200), deren `sip_call_id` exakt die sieben
  juengsten Prod-DB-Anrufe matcht. `call-control`, `inference`, `amd`, `conference`,
  `media_storage` liefern bei ebenfalls HTTP 200 je 0 - die Nullen sind echte Nullen.
- **Q1 = `["sip-trunking"]` ist damit unabhaengig bestaetigt**, die Pflicht-Typmenge von
  `el_convai_sip` ist gemessen und nicht mehr geraten.

Daraus folgt fuer dich NUR: das Entfernen des Stoppschild-Satzes in
`src/billing/kostenarten.js` ist jetzt gedeckt. Aendere den Wert der Pflicht-Typmenge
NICHT auf eigene Faust - steht er noch auf `PFLICHTTYPEN_UNGEMESSEN`, LASS IHN SO und
melde es im Report. Ihn scharf zu stellen ist eine eigene Entscheidung des Owners.

## Randbedingungen

1. Safety-Gates, Offenlegungssatz und `callee_is_owner` werden NICHT angefasst. Ein
   gepinntes Lint-Budget wird gemeldet, nicht selbst angehoben.
2. `npm test` muss gruen bleiben. Fahre ihn mit `npm test -- --test-timeout=300000`:
   ohne Timeout haengen unter Last einzelne Spawn-Worker unbegrenzt (Befund F-3).
3. Der Fix ist klein. Wird er gross, stimmt die Diagnose nicht - dann melden statt bauen.
