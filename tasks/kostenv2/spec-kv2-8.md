<!-- Auftragsblatt KV2-8. Geschnitten aus tasks/PLAN-KOSTEN-V2.md (Zeilen 1574-1684). -->

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

### KV2-8 - Das Settlement (der Geld-Umschalter)

**Ziel.** Genau EIN Settlement je Anruf: Summe der Belegzeilen, ein Aufruf von
`applyCostCorrectionCents`, `dataComplete` aus Profil-Soll gegen Beleg-Ist. Im SELBEN
Commit: die neuen Herkunftswerte und die traeger-getrennte Monats-Gegenprobe.

**Betroffene Dateien.** `src/billing/cost-truing.js` (Settlement; `refundProven` wird
ersetzt - zulaessig NUR, weil KV2-5(g) auch fuer die Bestandsprofile eine Belegzeile liefert,
s.u.),
`src/billing/kosten-projektion.js` (neu: zwei reine Funktionen - Summe der Belege,
Vollstaendigkeit gegen das Profil), `src/store/defaults.js` (`COST_TRUING_SOURCE` waechst um
zwei Werte), `src/billing/cost-calibration.js` (`isDriftSample`, `:57`),
`src/billing/cost-cross-check.js` (Traeger-Trennung), Tests.

Warum die Gegenprobe im selben Commit: `actualCostMicroCentsForMonth`
(`state-ops.js:4544`) summiert nur Calls mit `provider === PROVIDER.TELNYX`, und EL-Anrufe
tragen `provider: telnyx` (`api-calls.js:335`, BELEGT `angriff-kritiker.md` K5). Sobald
`actualCostMicroCents` die Summe ueber mehrere Traeger ist, vergleicht
`cost-cross-check.js` EL-Kosten mit einer Telnyx-Rechnung. Beide Entwuerfe reparieren das
erst vier bzw. zwei Phasen spaeter - dazwischen laeuft eine Beobachtung, die falsch statt
nur unvollstaendig ist, und das ist der Zustand, in dem eine Kette gerne liegen bleibt.

**Abnahmekriterium (ohne echten Anruf).**
(a) Tabellentest ueber die vollstaendige Matrix aus 4.6 - **zehn** Zeilen mal zwei
Richtungen, rein aus Fixtures, ohne Netz. Die Zeilenzahl **10** wird an genau EINER Stelle
im Test gepinnt; wer eine Matrixzeile ergaenzt, zieht sie hier mit (dieselbe Regel und
derselbe Grund wie bei der Katalog-Zeilenmenge in KV2-2(d)). Die zehnte Zeile ist nicht
dekorativ: die Aufspaltung der Altzeilen-Lage in `sipCallId` LEER und `sipCallId` GESETZT
(4.6, Absatz "Die beiden Altzeilen-Zeilen sind KEINE Doppelung") IST der Riegel gegen die
ungewollte Erstattung an den 12 EL-Altanrufen. Ein Test, der auf 9 stehen bleibt, laesst
mit hoher Wahrscheinlichkeit genau die zuletzt hinzugekommene, also diese geldrelevante
Lage ungeprueft - derselbe Fehlertyp, der die Katalog-Zahl einmal auf 15 stehen liess,
waehrend die Zusammenfassungs-Mail fehlte (KV2-2(d)).
(b) Vakuositaets-Test: ein Anruf mit unbekanntem oder fehlendem Profil, mit LEERER
Pflichtmenge, mit `estimatedCostCents = 30` und null Belegen bewegt **null Cent** und
erzeugt einen Befund. Ein Praedikat, das ueber Geldrueckgabe entscheidet, darf nie
allquantifiziert wahr werden.
(c) Zweites Settlement desselben Anrufs bewegt null Cent (`costTruedAt` set-once,
`state-ops.js:804-812`).
(d) Rundungstest: die Endsumme laeuft genau einmal durch
`convertProviderMicroToBucketCents`; `usage.costCorrectionMicroCentsRem` nach dem Settlement
entspricht exakt dem Wert einer einmaligen Umrechnung derselben Summe.
(e) Enum-Test: jeder Wert von `COST_TRUING_SOURCE` wird einmal durch `refundProven`,
`truedSourceOf` und `isDriftSample` geschickt; kein Wert faellt unentschieden durch, und
ein EL-Settlement behauptet nicht `telnyx_detail_records`.
(f) Gegenprobe: ein Fixture-Monat mit beiden Traegern ergibt ZWEI getrennte Differenzen,
keine Mischdifferenz.
(g) Vorzeichen und Typ: ein negativer oder nicht-numerischer Betrag erreicht
`applyCostCorrectionCents` nie (die Bestandszusage "der Aufrufer garantiert
`actualCostMicroCents >= 0`", `state-ops.js:3703`, ist genau das, was hier neu zu erfuellen
ist).
(h) Schreibstellen-Test statt einmaligem grep: eine Pruefung erfasst JEDE Schreibform an
`usage.costCents` - Zuweisung (`usage.costCents =`) UND Inkrement (`usage.costCents +=`) -
und schlaegt fehl, sobald eine dritte Fundstelle ausserhalb von `bookCents` und
`applyCreditCents` auftaucht. Dieser Test bleibt Teil der Suite, nicht ein einmaliger Beleg.
(i) **Erstattungs-Regression fuer die Bestandsprofile, byte-identisch zu heute - der Test,
der das Ersetzen von `refundProven` ueberhaupt erlaubt.** Ein Anruf mit Profil
`telnyx_budget`, `estimatedCostCents = 30` und einem VOLLSTAENDIGEN Record-Pool
(Pflicht-Typmenge `sip-trunking,call-control` erfuellt, `billedSecTotal > 0`) wird erstattet,
und zwar mit demselben Delta, demselben `usage.costCorrectionMicroCentsRem` und demselben
Herkunftswert wie der heutige `refundProven`-Pfad auf demselben Pool. Der Test faehrt beide
Pfade gegen dieselbe Fixture und VERGLEICHT die Ergebnisse, statt eine Zahl abzuschreiben -
eine abgeschriebene Zahl wuerde eine spaetere Verschiebung mitwandern lassen. Drei
Gegenproben gehoeren dazu: derselbe Anruf mit einem Pool nur aus `call-control`-Records wird
NICHT erstattet (Menge unvollstaendig, `dataComplete` falsch); derselbe Anruf mit
`billedSecTotal === 0` wird NICHT erstattet; derselbe Anruf ohne buchbaren
`estimatedCostCents` bewegt null Cent (der `isBookableCents`-Riegel, `cost-truing.js:477`,
lebt weiter und ist NICHT in die Belegreife gewandert, KV2-5(g)).
Faellt Owner-Entscheidung 11 auf (b), pinnt derselbe Test denselben Sollwert - nur laeuft er
dann gegen den unveraenderten `refundProven`-Pfad, und die Formulierung "`refundProven`
ersetzt" oben wird zu "ergaenzt".

**Wie die Safety-Gates eingehalten werden.** Diese Phase beruehrt die pro-Tenant-Kostendecke
direkt. Sie macht die Decke ausschliesslich GENAUER: der einzige Weg, auf dem Geld
zurueckfliessen kann, ist der bestehende, beweispflichtige Zweig in
`applyCostCorrectionCents` (`:3815`, verwirft negatives Delta ohne `dataComplete` VOR jeder
Mutation; Funktion `:3798-3820`). Es entsteht KEIN dritter Cent-Schreibweg: `bookCents` (`state-ops.js:3609`) und
`applyCreditCents` (`:3756`) bleiben die einzigen zwei Kanten (BELEGT, `befund-code.md` 1,
verifiziert per `grep -n "costCents +=" src/store/state-ops.js`). Die Vorab-Reserve, der
Live-Term `liveVoiceSpendCents`, der aus dem Restguthaben abgeleitete `maxDurationS`-Cap und
`armMaxDurationTimer` (`api-calls.js:372`) bleiben unangetastet.

**Praezisierung der Beleglage:** `grep -n "costCents +=" src/store/state-ops.js` findet
NUR `bookCents` (Zeile 3610) - `applyCreditCents` schreibt per Zuweisung
(`usage.costCents = Math.max(0, vorher + deltaCents)`, Zeile 3758) und wird von diesem
Muster NICHT gefunden. Die Behauptung "zwei Kanten" stimmt, das genannte Pruefmuster deckt
aber nur eine der beiden ab - und ein kuenftiger DRITTER Schreibweg per Zuweisung wuerde
von genau diesem grep ebenfalls uebersehen. Deshalb Abnahmekriterium (h): statt eines
einmaligen grep gehoert ein dauerhafter Test in diese Phase.

**Was diese Phase NICHT tut.** Sie aendert nichts an der Vorab-Gate-Kette, an der Reserve
und an der Live-Bremse. Sie schreibt keine `usage_event`-Zeile fuer Lieferantenkosten. Sie
holt keinen zweiten Wert bei ElevenLabs (das ist KV2-9) - bis dahin bleibt jede EL-Zeile
`vorlaeufig`, und damit ist in dieser Phase noch KEINE Erstattung fuer EL-Anrufe moeglich.
Das ist Absicht: der Umschalter geht in der sicheren Richtung live.

**Abhaengigkeit.** KV2-7. Und die Messung aus KV2-5(d) muss vorliegen, sonst ist die
Pflichtmenge geraten. Das ist eine harte Sperre, keine Empfehlung: liegt die Messung nicht
vor - etwa weil der Telnyx-Zugang ausgefallen ist, wie im Vorlauf dieses Plans mit HTTP 401
(BELEGT, `tasks/kostenv2/AUFTRAG.md:138`) -, wird diese Phase NICHT begonnen. Sie ist der
Geld-Umschalter; eine geratene oder leere Pflichtmenge entscheidet hier ueber Erstattungen
(Blocker-Befund 3/6, Abschnitt 10). Der Ausweg ist die Owner-Meldung aus KV2-5(d) und die
Wiederholung der Messung, nicht ein Ersatzwert. Ebenso muss KV2-5(g) geliefert haben: ohne die
`telnyx_call_records`-Belegzeile waere fuer JEDEN Telnyx-Engine-Anruf `dataComplete` falsch
und die Belegsumme 0 - gegen `estimatedCostCents = 30` ergaebe das einen negativen Delta,
den `applyCostCorrectionCents` (`:3815`) verwirft, und die heute funktionierende Erstattung
(56 von 56 Anrufen, AUFTRAG B1) waere still tot. Ist Entscheidung 11 auf (b) gefallen, faellt
diese Abhaengigkeit weg, und `refundProven` bleibt fuer diese Profile unveraendert stehen.

---

