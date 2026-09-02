<!-- Auftragsblatt KV2-11. Der Phasenabschnitt aus tasks/PLAN-KOSTEN-V2.md. -->

# Pflichtlektuere

Nur das hier - NICHT den ganzen Plan, NICHT die uebrigen Befund-Dateien. Jede Zeile,
die du liest, traegst du danach durch jeden weiteren Schritt mit.

- `tasks/PLAN-KOSTEN-V2.md`: Abschnitt 4.5 (Settlement), 4.6 (Matrix)
- `tasks/kostenv2/spec-kv2-8.md` (setteleAnruf/istVollBelegt) und `spec-kv2-9.md`
  (EL-Reifung)
- `CLAUDE.md` (Absolute Regeln) und `.claude/refs/clean-code.md`.

Brauchst du darueber hinaus etwas, lies gezielt nach - aber lies nicht vorsorglich.

# Harte Randbedingungen

1. **Safety-Gates, Offenlegungssatz und `callee_is_owner` werden NICHT angefasst.**
   Braucht die Umsetzung eines davon, ist das ein Abbruchgrund mit Meldung - keine
   eigenmaechtige Aenderung.
2. **Kein neues Env, kein Schema, keine Gates, keine npm-Dependencies.** Der Geldpfad
   ist die KV2-8-Kante, die asymmetrisch fail-closed bleibt: Erstattung nur bei
   `dataComplete`, Nachbuchung immer.
3. **Gepinntes Lint-Budget nicht selbst anheben** (melden bzw.
   `npx eslint --prune-suppressions` im selben Commit, wenn die Befundmenge sinkt -
   nur senken, nie anheben).
4. Neues Verhalten braucht einen Test. Geldrechnung braucht einen Test, der die
   Rechnung pinnt, nicht nur ihre Existenz.

---

### KV2-11 - EL-Settlement freigeben

**Ziel.** Die Profilsperre `kostenprofilFuerAnruf(call) !== KOSTENPROFIL.EL_CONVAI_SIP`
faellt aus `sweepDarfKorrigieren` (cost-truing.js). Ein `el_convai_sip`-Anruf mit
buchbarer Schaetzung und gueltiger Belegsumme wird damit settelbar - Erstattung nur bei
vollstaendigem Buch, Nachbuchung bedingungslos wie bei jedem anderen Profil auch.

**Begruendung (Owner-Entscheidung OR-1, 2026-09-02).** Der B6-Schutz ist seit KV2-8/KV2-9
STRUKTURELL verankert und braucht die Profilsperre nicht mehr:

- `istVollBelegt` (kosten-projektion.js) vergleicht Beleg-IST gegen PROFIL-SOLL
  (Allquantor-Riegel: bekanntes Profil UND nicht-leere Pflichtmenge UND keine fehlende
  Zeile). Fuer `el_convai_sip` muessen BEIDE Pflicht-Traeger (`elevenlabs_convai` UND
  `telnyx_sip`) belegt sein.
- `applyCostCorrectionCents` (state-ops.js) verwirft jeden NEGATIVEN Delta ohne
  `dataComplete` VOR jeder Mutation (`setteleAnruf` reicht
  `dataComplete: projektion.vollBelegt` durch). Positive Deltas buchen bedingungslos -
  genau das will OR-1: fehlende EL-Kosten NACHBUCHEN statt sie still wegzu sperren.
- Beide EL-Pflicht-Traeger sind im KATALOG (kostenarten.js) `waehrung: "USD"` - der EINE
  Kurs (`providerToBucketRateMicro`) passt, keine zweite Umrechnung noetig.

Die 12 EL-Altanrufe erhalten weiterhin KEINE Erstattung, solange ihre EL-Zeile fehlt
(B6): ihr Buch ist unvollstaendig, `dataComplete` bleibt falsch. Nur die Nachbuchung
(Ist > Schaetzung) waere moeglich - sie erhoht die Gate-Achse, schwaecht keine Sicherung.

**Betroffene Dateien.** `src/billing/cost-truing.js` (Ausdruck + Kommentarblock an
`sweepDarfKorrigieren`, Import ohne das nun ungenutzte `KOSTENPROFIL`, Kommentar an
`providerLegIdOf`), `src/billing/kostenarten.js` (Kommentar an `legacyKostenprofil`:
B6-Erwaehnung auf den neuen Stand), Tests: `test/kv2-11-el-settlement.test.js` (neu),
`test/kv2-8-settlement.test.js` (Test (e) flippt, MATRIX-Zeile-7-Kommentar),
`test/kv2-7-schliessregel.test.js` (Test (f): Message), `test/kv2-5-telnyx-sip-beleg.test.js`
(Test (a): Message).

**Abnahmekriterien (ohne echten Anruf).**
(a) EL voll belegt, Ist > Schaetzung: Settlement bucht den gerechneten Delta, Herkunft
`kostenbuch_vollbeleg`.
(b) EL voll belegt, Ist < Schaetzung: ERSTATTUNG wird gebucht (der Kern der Freigabe -
zum ersten Mal seit Bestehen erstattet die EL-Route).
(c) B6-Regression: EL-Zeile fehlt, nur sip belegt, Ist < Schaetzung -> KEINE Erstattung
(fail-closed bleibt); die Geld-Kante LAEUFT aber mit `dataComplete === false`.
(d) EL-Zeile fehlt, Ist > Schaetzung -> bedingungslos nachbuchen, Herkunft
`kostenbuch_teilbeleg` (final, aber nicht beweisend).
(e) Herkunft `kostenbuch_vollbeleg` ist beweisend und zaehlt in die Deckungsquote;
Legacy-EL-Altzeile ohne EL-Zeile wird nie erstattet.

**Was diese Phase NICHT tut.** Keine Aenderung an `applyCostCorrectionCents`,
`istVollBelegt`, `ohneBeweiskraft`, `kosten-projektion.js`, `state-ops.js`, den
Nachlauf-Skripten oder dem Tarif. Kein neues Env, kein Schema, kein Gate. Die
bestehenden drei Tests, die das alte Verbot pinnen (kv2-8 (e), kv2-7 (f),
kv2-5 (a)), werden ausschliesslich dort angepasst, wo sie das ALTE Verbot behaupten;
Assert-Werte, die vom Abschluss- und nicht vom Profiltriegel abhaengen, bleiben.

**Abhaengigkeit.** KV2-8 (setteleAnruf/istVollBelegt) und KV2-9 (EL-Reifung) geliefert.
Owner-Vorbedingung: keine offene mehr; OR-1 ist entschieden.
