<!-- Auftragsblatt KV2-9. Geschnitten aus tasks/PLAN-KOSTEN-V2.md (Zeilen 1685-1793). -->

# Pflichtlektuere vor der Umsetzung

Dieses Blatt ist der Auftrag, aber NICHT der ganze Kontext. Vor dem ersten Edit zu lesen:

- `tasks/PLAN-KOSTEN-V2.md` Abschnitt 2 (Zielbild), Abschnitt 3 (Kostenarten-Tabelle, inkl. 3.5 Einheiten und
  3.6 die ID-Falle), Abschnitt 4 (Architektur-Entscheidung, insbesondere 4.3
  Durchsetzungsstelle, 4.5 Settlement, 4.6 Matrix, 4.7 Schliessregel) und
  **Abschnitt 7 (Eigentuemer-Entscheidungen) vollstaendig**.
- `tasks/kostenv2/befund-code.md`, `befund-elevenlabs.md`, `befund-gate.md`,
  `befund-telnyx.md` - der gemessene Ist-Zustand. Keine Annahme ueber Bestandscode ohne
  Beleg aus diesen Befunden ODER aus dem Code selbst.
- `CLAUDE.md` (Absolute Regeln) und `.claude/refs/clean-code.md`.

# Harte Randbedingungen dieser Kette

1. **Safety-Gates, Offenlegungssatz und `callee_is_owner` werden NICHT angefasst.** Beruehrt
   die Umsetzung eines davon, ist das ein Abbruchgrund mit Meldung an den Lead - keine
   eigenmaechtige Aenderung, auch keine "harmlose" Umformulierung.
2. **Abschnitt 7, Punkte 1-9 und 13 sind entschieden** - umsetzen wie dort festgelegt.
   **Die Punkte 10, 11, 12, 14, 15 und 16 laufen auf Default und sind so gekennzeichnet.**
   Verlangt die Phase, einen davon scharf zu stellen, wird er auf dem dokumentierten
   Default gebaut und der Punkt im Report als Rueckfrage an den Owner gemeldet -
   NICHT eigenmaechtig festgelegt.
3. Neue Env-Variable: sofort in `src/config.js`, `.env.example` UND in `BASE_ENV` der
   Test-Helfer (sonst leakt die echte `.env` in Spawn-Tests).
4. Neues Verhalten braucht einen Test. Geldrechnung braucht einen Test, der die Rechnung
   pinnt, nicht nur ihre Existenz.

---

### KV2-9 - Reifung des EL-Belegs und die nachgeholte O3-Messung

**Ziel.** Ein zweiter Abruf hebt die EL-Zeile von `vorlaeufig` auf `belegt` - erst damit ist
fuer EL-Anrufe ueberhaupt eine Erstattung moeglich. Gleichzeitig ist dieser Abruf die
Messung, die in keinem Vorlauf moeglich war.

**Betroffene Dateien.** `src/billing/cost-truing.js` (Reifungs-Zweig im Sweep, unter
derselben Kandidatenbegrenzung und Drossel wie der Telnyx-Pfad),
`src/elevenlabs/convai.js` (`fetchConversation`, `:235`, existiert - nur Aufrufer neu),
`src/config.js` / `.env.example` (`EL_EVIDENCE_MIN_AGE_MINUTES`, Default 15), Tests.

**Der Phasenschnitt KV2-8 -> KV2-9, benannt statt uebersehen.** Zwischen den beiden Deploys
bleibt jede EL-Belegzeile `vorlaeufig` (so steht es in KV2-8). Laeuft in diesem Fenster die
Frist `COST_SETTLE_DEADLINE_HOURS` (entschieden auf 48 h, Owner-Entscheidung 3) ab, wird der
EL-Anruf ueber Faelligkeitsgrund (b) zwangs-gesettelt, landet nach 4.6 ("Traeger nur
vorlaeufig -> nichts") in `unvollstaendig_final`, und `costTruedAt` ist set-once gesetzt.
Diese Anrufe behielten dauerhaft die zu hohe Schaetzung - gemessen rund 30 EUR-Cent gegen
rund 15 US-Cent Ist (EL plus Telnyx-SIP, AUFTRAG B2 / `befund-telnyx.md` O2). Deshalb zwei
Massnahmen, nicht eine:

1. **Vorbedingung (die Absicht):** KV2-9 muss live sein, BEVOR die erste
   `COST_SETTLE_DEADLINE_HOURS` nach dem KV2-8-Deploy ablaeuft. Laesst sich das nicht
   halten, wird die Frist fuer die Dauer des Fensters ausgesetzt (`COST_SETTLE_DEADLINE_HOURS`
   hochgesetzt) statt sie ablaufen zu lassen - das ist ein Env-Handgriff, kein Deploy.
2. **Nachlauf (der Mechanismus):** eine Vorbedingung ist ein Versprechen, kein Riegel.
   KV2-9 bringt deshalb einen zweiten, gleich gebauten EINMALIGEN Nachlauf mit, exakt nach
   dem Muster aus 4.7/KV2-7(g), rein zustandsbasiert und ohne Deploy-Zeitstempel (den fuehrt
   der Anruf-Datensatz nicht, `state-ops.js:320-334`). Er oeffnet jeden Anruf, auf den ALLE
   FUENF Bedingungen zutreffen: (1) Profil `el_convai_sip`; (2) `costTruedAt` gesetzt;
   (3) Endzustand `unvollstaendig_final`; (4) genau eine `elevenlabs_convai`-Zeile mit
   `reife=vorlaeufig` und KEINE mit `reife=belegt`; (5) die Belegsumme des Anrufs liegt
   UNTER `call.estimatedCostCents` - das Zwangs-Settlement hat also nichts gebucht. Fuer
   jeden Treffer setzt er `costTruedAt` auf `null` zurueck; die Reifung und das zweite
   Settlement laufen danach ueber den normalen Weg dieser Phase, mit `dataComplete` wie
   ueberall sonst.

Bedingung 3 ist der Riegel gegen die Anrufe des ABBRUCHWEGS: die tragen den Endzustand
`beleg_strukturell_unbeschaffbar` (4.4), sind nicht nachreifbar und werden vom Nachlauf
nicht angefasst. Bedingung 4 trennt ihn vom Nachlauf aus KV2-7, der genau umgekehrt das
FEHLEN jeder EL-Zeile verlangt: die beiden Mengen sind disjunkt, kein Anruf faellt in beide.

**Bedingung 5 ist der Riegel gegen die doppelte Buchung, und sie ist nicht dekorativ.** Der
set-once-Riegel schuetzt gegen genau das, und ein Nachlauf, der ihn zuruecksetzt, muss den
Schutz selbst mitbringen - "es war ja nur eine Schaetzung" reicht nicht. Anders als bei
KV2-7 hat KV2-8 bereits gebucht: liegt die Belegsumme UEBER der Schaetzung, wurde der
positive Delta beim Zwangs-Settlement bedingungslos nachgebucht (4.6, obere Haelfte). Ein
zweites Settlement rechnete denselben Delta gegen denselben persistierten
`estimatedCostCents` erneut aus und buchte ihn ein zweites Mal - der Tenant zahlte zweimal.
Bedingung 5 nimmt genau diese Anrufe aus der Menge; uebrig bleibt die Zielmenge dieses
Fensters: die ueberschaetzten Anrufe, bei denen nach 4.6 ("Traeger nur vorlaeufig ->
nichts") nichts gebucht wurde und deshalb nichts doppelt gebucht werden kann.
Die Bedingung ist zum Zeitpunkt des Nachlaufs aus dem Zustand ableitbar, ohne einen
historischen Wert aufzubewahren: zwischen dem Zwangs-Settlement und diesem Nachlauf kann
sich keine EL-Belegzeile geaendert haben, weil die Reifung erst mit DIESER Phase existiert -
die neu gebildete Summe ist bitgleich die, gegen die damals gerechnet wurde.
**Bleibt eine Restmenge, benannt statt versteckt:** ein UNTERSCHAETZTER Anruf des Fensters
(Belegsumme ueber der Schaetzung) wird nicht wieder geoeffnet und behaelt seinen
Zwangs-Endzustand. Das ist die sichere Fehlrichtung - er wurde bereits auf mindestens den
belegten Ist-Betrag hochgebucht, und eine Reifung koennte ihn nur weiter erhoehen. Wer die
Symmetrie dennoch will, braucht ein persistiertes "wurde gebucht"-Datum am Settlement; das
ist eine Erweiterung von KV2-8, keine dieser Phase, und dieser Plan baut sie nicht.

**Abnahmekriterium (ohne echten Anruf).**
(a) Stub-Fetch liefert denselben Wert -> Zeile wird `belegt`, Abweichungszaehler bleibt 0.
(b) Stub-Fetch liefert einen HOEHEREN Wert -> Zeile wird `belegt` mit dem hoeheren Wert,
Abweichungszaehler +1, Anruf wird erneut faellig.
(c) Stub-Fetch liefert einen NIEDRIGEREN Wert -> der hoehere bleibt stehen,
Abweichungszaehler +1 (nach unten nur mit vollstaendiger Menge - und die Menge kann diesen
Wert nicht bestaetigen).
(d) HTTP 404 (Datensatz beim Anbieter geloescht, Abbruchweg) -> Zeile bleibt `vorlaeufig`,
Endzustand `beleg_strukturell_unbeschaffbar`, kein Wurf, kein Alarm.
(e) Drossel: bei 500 faelligen EL-Anrufen setzt ein Sweep hoechstens so viele Anfragen ab
wie die bestehende Kandidatenbegrenzung erlaubt - nicht 500. Bekannt ist nur eine untere
Schranke des Rate-Limits (25 Requests in wenigen Sekunden ohne 429, keine
Rate-Limit-Header in ueber 60 Antworten, BELEGT `befund-elevenlabs.md` 4); die reale Grenze
bleibt ungemessen.
(f) Der Abweichungszaehler ist in der Sweep-Zeile sichtbar - er IST die O3-Messung. Zeigt er
ueber N Anrufen 0 Abweichungen, ist O3 empirisch beantwortet und die Reifefrist kann gesenkt
werden; das ist dann eine Owner-Entscheidung, keine automatische.
(g) **Der zweite Phasenschnitt-Nachlauf (einmalig, s.o.):** Fixture mit Profil
`el_convai_sip`, `estimatedCostCents = 30`, `costTruedAt` gesetzt, Endzustand
`unvollstaendig_final`, genau eine `elevenlabs_convai`-Zeile `reife=vorlaeufig` und eine
Belegsumme unter 30 -> nach dem Nachlauf ist `costTruedAt === null` und der Anruf ist im
naechsten Sweep wieder Kandidat. Ein zweiter Durchlauf auf denselben Datensatz ist ein
No-Op. Vier Gegenproben, ohne die das Kriterium blind waere: ein Anruf im Endzustand
`beleg_strukturell_unbeschaffbar` (Abbruchweg) wird NICHT angefasst; ein Anruf mit bereits
`belegt`-EL-Zeile wird NICHT angefasst; ein Anruf ohne jede `elevenlabs_convai`-Zeile - die
Altzeile von vor der Kette - wird NICHT angefasst (den behandelt, falls ueberhaupt, der
Nachlauf aus KV2-7(g)); und ein sonst identischer Anruf mit einer Belegsumme UEBER
`estimatedCostCents` wird NICHT angefasst (Bedingung 5, Riegel gegen die doppelte Buchung).
(h) **Doppelbuchungs-Probe ueber den ganzen Weg:** ein Anruf des Fensters durchlaeuft
Zwangs-Settlement, Nachlauf (g), Reifung und zweites Settlement in EINEM Test; am Ende ist
`usage.costCents` genau einmal um den Delta der reifen Summe gegen `estimatedCostCents`
bewegt, nie zweimal, und `usage.costCorrectionMicroCentsRem` entspricht exakt dem Wert einer
EINMALIGEN Umrechnung dieser Summe (dieselbe Zusage wie KV2-8(d), jetzt ueber zwei
Settlements hinweg).

**Was diese Phase NICHT tut.** Sie aendert die Settlement-Arithmetik nicht. Sie holt keinen
Wert auf dem Abbruchweg (dort ist der Datensatz weg). Der Nachlauf (g) bucht nichts - er
setzt ausschliesslich `costTruedAt` zurueck und ueberlaesst jede Geldbewegung dem normalen
Settlement aus KV2-8.

**Abhaengigkeit.** KV2-8 - und zwar mit der oben benannten Vorbedingung: KV2-9 soll vor
Ablauf der ersten `COST_SETTLE_DEADLINE_HOURS` nach dem KV2-8-Deploy live sein. Wird das
verfehlt, ist der Nachlauf (g) die Absicherung; das ist Absicht und nicht Ersatz fuer die
Reihenfolge.

---

