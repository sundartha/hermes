# Spec: Inbound-Paritaet abschliessen (IEP-A / IEX-B / IEL-X)

Auftrag und Rahmen: `tasks/kickoff-iep-abschluss.md`. Diese Datei ist die autoritative
Phasen-Definition fuer die Umsetzung; der Kickoff bleibt die Quelle der Owner-Entscheidungen.

## Leitentscheidung

Der Owner-Testanruf vom 2026-09-17 ist bestanden ("funktioniert alles"). Damit ist der
Messweg fuer diese Kette entschieden: **ein echter Owner-Anruf schlaegt jede gebaute
Messmaschine** (Memory `einfachster-messweg-zuerst`). Die Maschine hat genau einen
unbrauchbaren Lauf produziert und wird restlos entfernt, bevor irgendeine weitere
Aenderung sie mitschleppt.

Leitsatz des Owners: **lean, sauber, kein Apparat um des Apparats willen.**

## Datenfluss (Bestand, unveraendert)

`scripts/iel-mess.mjs` ist ein Messwerkzeug fuer den EL-Inbound-Pfad. Es kennt
Zaehler-Gruppen; jede Gruppe hat eigene Sperr-, Zaehler- und Ergebnisdatei und eigene
Riegel. Heute existieren drei:

| Gruppe | Zweck | Wegfall? |
|---|---|---|
| `m1` | IE1-Messreihe, waehlt SIP-Ziele | **bleibt** |
| `nachdeploy` | IEL-B11 Nachdeploy-Probe, waehlt SIP-Ziele | **bleibt** |
| `ohrzeuge` | IEP-P1, waehlt als EINZIGE eine echte Telefonnummer | **entfaellt** |

## Sicherheitsmodell

Die Ohrzeugen-Gruppe war der einzige Weg, auf dem dieses Werkzeug eine echte
Telefonnummer waehlen konnte (`art: "texml-ohrzeuge"`, Feld `ziel_e164`, gepinntes Ziel
`OHRZEUGE_ZIEL_PIN`, vier Riegel, harter Deckel 18 Anrufe). Alle anderen Gruppen bruecken
ausschliesslich an SIP-Ziele.

**Die Entfernung muss die Angriffsflaeche verkleinern, nicht vergroessern.** Nach der
Phase darf es KEINEN Weg mehr geben, ueber den eine Aenderung an
`scripts/iel-mess.cases.json` allein — also ohne Code-Aenderung — einen Anruf an eine
echte Telefonnummer ausloest. Konkret: die Felder/Werte, die das ermoeglichten
(`ziel_e164`, `art: "texml-ohrzeuge"`, Zaehler `ohrzeuge`), duerfen nicht einfach
"nicht mehr behandelt" werden, sondern muessen **fail-closed abgewiesen** werden
(Verweigerung mit Grund), und diese Abweisung braucht einen Test.

Das ist der Kern der Phase. Ein stiller `undefined`-Pfad, der ein unbekanntes `art`
kommentarlos durchreicht oder ignoriert, ist ein Blocker.

---

## Phase IEP-A - Messmaschine ("Ohrzeuge") restlos entfernen

### Ziel

Die IEP-P1/P1b-Messmaschine verschwindet vollstaendig aus dem Bestand: Code, Tests,
Fall-Definitionen, Zaehler, Belege, Konstanten, Kommentare. Kein toter Code, kein
verwaister Import, kein Kommentar, der auf etwas Nicht-Existentes zeigt. Die beiden
Bestandsgruppen `m1` und `nachdeploy` und der abgenommene Begruessungslaut bleiben
unberuehrt und beweisbar funktionsfaehig.

### Scope (zu entfernen)

1. `scripts/iel-mess-ohrzeuge.mjs` — ganze Datei.
2. `test/iep-p1-ohrzeuge-audio.test.js`, `test/iep-p1-ohrzeuge-lauf.test.js`,
   `test/iep-p1-ohrzeuge-riegel.test.js` — ganze Dateien.
3. `tasks/iel-ohrzeuge-zaehler.json`, `tasks/iel-ohrzeuge-vorlauf.json` — ganze Dateien.
   (`tasks/iel-ohrzeuge-sprechspur.mp3` ist untrackt und wird vom Lead ausserhalb des
   Worktrees entfernt — NICHT deine Aufgabe, nicht darauf verlassen, dass sie existiert.)
4. `scripts/iel-mess.mjs`: die Gruppe `ohrzeuge` aus der Gruppen-Registry, die Konstanten
   `MAX_OHRZEUGE_ANRUFE`, `OHRZEUGE_ZIEL_PIN`, `OHRZEUGE_ART`, `OHRZEUGE_ZAEHLER`,
   `SPRECHSPUR`, `VORLAUF`, die Funktionen `ohrzeugeUmgebung`, `pruefeOhrzeugeZiel`,
   `ladeSprechspur`, `pruefeOhrzeugeVorAnruf`, der Weg `"texml-ohrzeuge"` in den beiden
   Dispatch-Tabellen, das `sprechspur`-Unterkommando und die Ohrzeugen-Importe. Sowie
   jeder Kommentar, der nur die Ohrzeugen erklaert.
5. `scripts/iel-mess.cases.json`: Fall `OZ-vorher`, Gruppe `ohrzeuge`, die
   Ohrzeugen-Saetze im `_hinweis`.
6. `scripts/iel-mess-belege.mjs`: `sammleOhrzeugeBelege`, `leseOhrzeugeAudio`,
   `ohrzeugeAufnahmeSicht` und die Importe aus `iel-mess-ohrzeuge.mjs`. **Achtung:** die
   dortige gemeinsame Warteschleife wird laut Kommentar von BEIDEN Auswertungen benutzt
   (Kontrollwort-Fall UND Ohrzeuge) — sie bleibt, wenn der Kontrollwort-Fall sie noch
   braucht. Am echten Code pruefen, nicht raten.
7. `scripts/iel-mess-anbieter.mjs`: `texmlOhrzeugeDokument`, `texmlOhrzeugeAnfrage` und
   die Ohrzeugen-Kommentare.
8. `scripts/iel-mess-audio.mjs`: **NUR** der Teil, den ausschliesslich der Ohrzeuge
   benutzte. Was `scripts/render-begruessungslaut.mjs` oder
   `test/iep-p2-begruessungslaut.test.js` braucht, BLEIBT. Der Datei-Kopfkommentar
   ("WAV-Auswertung des Ohrzeugen (IEP-P1)") wird auf die verbliebene Aufgabe
   umgeschrieben. Ist nach dem Streichen der Ohrzeugen-Nutzung eine Funktion ungenutzt,
   faellt sie mit; ist die ganze Datei danach ausschliesslich fuer den Begruessungslaut
   da, ist das der neue dokumentierte Zweck.
9. `test/_iel-messbaum.mjs`: die Ohrzeugen-spezifischen Parameter (`ohrzeugeZaehler`,
   `vorlauf`, `sprechspur` und die drei Werte, die nur der Ohrzeugen-Riegel las). Der
   Helfer selbst BLEIBT — `test/iel-b11-nachdeploy.test.js` benutzt ihn.
10. `PLAN-SECURITY.md`, Eintrag **U1**: der Satz "Belegt wird es am Ohrzeugen-Nachher-Lauf,
    nicht im Code" zeigt auf eine Messung, die es nicht mehr gibt. U1 ist durch den
    bestandenen Owner-Testanruf vom 2026-09-17 ("kein Klingeln") **belegt und geschlossen**
    — so eintragen. Nur dieser Eintrag, keine weitere Umarbeitung des Dokuments.

### Scope (zu behalten und zu haerten)

11. `scripts/iel-mess.mjs` weist nach der Entfernung **fail-closed** ab:
    - ein Fall mit dem Feld `ziel_e164` → Verweigerung mit Grund,
    - ein Fall mit einer unbekannten `art` (insbesondere `texml-ohrzeuge`) → Verweigerung
      mit Grund, nicht `undefined`/stilles Durchfallen,
    - ein Fall mit einer unbekannten Zaehler-Gruppe (insbesondere `ohrzeuge`) →
      Verweigerung mit Grund.
    Existiert eine dieser Abweisungen im Bestand schon, bleibt sie erhalten und bekommt
    (falls nicht vorhanden) einen Test. Der heutige Kopplungs-Riegel `art`↔`zaehler`
    (`OHRZEUGE_ART`/`OHRZEUGE_ZAEHLER`) verliert seinen Gegenstand — was er schuetzte,
    muss die neue Abweisung leisten.

### NICHT-Scope

- Die Gruppen `m1` und `nachdeploy`, ihre Faelle, Zaehler, Riegel und Ergebnisdateien
  (`tasks/iel-m1-*`, `tasks/iel-nachdeploy-*`). Nicht anfassen.
- `scripts/render-begruessungslaut.mjs`, `public/brand/hermes-begruessungslaut.wav`,
  `scripts/quellen/hermes-begruessungslaut-quelle.mp3` und
  `test/iep-p2-begruessungslaut.test.js`. Der Laut ist vom Owner abgenommen
  (Kickoff §4.5) und wird nicht angefasst.
- `scripts/iel-mess-stolperdraht.mjs`, `test/_iel-b11-fetch-attrappe.mjs`, der gesamte
  EL-Inbound-Produktivpfad (`src/**`). Diese Phase aendert KEINE Zeile in `src/`.
- Der Rollout (IEX-B) und die Loeschung der Budget-Engine (IEL-X). Andere Phasen.
- Historische Mess-Berichte in `tasks/` (`ie1-messbericht.md`, `iel-m1-messung.md`, …).
  Prozesshistorie, bleibt.

### Invarianten (pruefbar)

- I1: `test/iel-b11-nachdeploy.test.js` bleibt **inhaltlich unveraendert** und gruen.
  Wird diese Datei angefasst, ist die Extraktion des Helfers rueckgaengig gemacht worden
  — Blocker. (Einzige zulaessige Ausnahme: das Weglassen eines Arguments, das es nur fuer
  die Ohrzeugen gab; dann im Plan begruenden.)
- I2: `test/iep-p2-begruessungslaut.test.js` bleibt **unveraendert** und gruen.
- I3: `node scripts/iel-mess.mjs status` laeuft fehlerfrei und zeigt genau die Gruppen
  `m1` und `nachdeploy`. Kein Fehler, keine leere Gruppe `ohrzeuge`.
- I4: `node scripts/iel-mess.mjs --help` (bzw. das Bestands-Aequivalent) nennt das
  `sprechspur`-Unterkommando nicht mehr.
- I5: `grep -ril ohrzeuge` ueber `src/ scripts/ test/` liefert **nichts**.
- I6: `node --check` auf jede geaenderte `.js`/`.mjs`-Datei.
- I7: In `src/` aendert sich keine Zeile (`git diff --stat master..HEAD -- src/` ist leer).

### Testpflicht

- Neue Tests fuer die drei fail-closed-Abweisungen aus Punkt 11 (Feld `ziel_e164`,
  unbekannte `art`, unbekannte Zaehler-Gruppe). Sie ersetzen die Schutzwirkung, die
  vorher an den Ohrzeugen-Riegeln hing, und sind der eigentliche bleibende Wert dieser
  Phase. Wo diese Tests hingehoeren (eigene Datei oder ein Bestands-Testfile fuer
  `iel-mess`), entscheidest du am Bestand.
- Die drei Ohrzeugen-Testdateien werden geloescht, nicht umgeschrieben.
- Keine Testbank-Datei darf ein lokales Werkzeug (afconvert, ffmpeg, curl gegen Telnyx)
  oder Netz brauchen.

### Abnahmekriterium (deterministisch)

1. `npm test -- --test-concurrency=4` gruen, Exit 0.
2. `node scripts/iel-mess.mjs status` Exit 0, Ausgabe nennt `m1` und `nachdeploy`,
   nirgends `ohrzeuge`.
3. `grep -ril ohrzeuge src scripts test` → keine Treffer (Exit 1).
4. `git diff --stat <BASE>..HEAD -- src/` → leer.

### Risiko / Pre-Mortem

Angenommen, ein Jahr spaeter hat sich diese Loeschung geraecht:

- **R1 — der Begruessungslaut liess sich nicht mehr aus der Quelle herstellen**, weil
  `iel-mess-audio.mjs` zu weit ausgeraeumt wurde. Gegenmittel: I2 + NICHT-Scope, und die
  Regel "nur streichen, was NACHWEISLICH nur der Ohrzeuge benutzte" (Aufrufer greppen,
  nicht schaetzen).
- **R2 — die Nachdeploy-Probe war kaputt**, weil der geteilte Helfer beim Ausraeumen
  beschaedigt wurde. Gegenmittel: I1.
- **R3 — das Messwerkzeug waehlte wieder eine echte Nummer**, weil mit den Ohrzeugen auch
  der Riegel fiel, der das verhinderte, und eine spaetere Fall-Datei `ziel_e164` einfach
  wieder eintrug. Gegenmittel: Punkt 11 + Testpflicht. **Das ist das groesste Risiko
  dieser Phase** — eine Loeschung, die eine Sicherung mitnimmt, sieht im Diff aus wie
  Aufraeumen.
- **R4 — jemand suchte die Messbelege und fand nur Verweise ins Leere.** Gegenmittel:
  Punkt 10 (U1 sauber schliessen statt verwaisen lassen); die historischen Berichte in
  `tasks/` bleiben, die Historie liegt in `git`.

### Offene Review-Concerns

- Der Kopplungs-Riegel `art`↔`zaehler` in `iel-mess.mjs` war laut seinem Kommentar
  ausdruecklich dagegen gebaut, dass ein Fall unter falschen Riegeln laeuft. Wer ihn
  entfernt, muss im Plan benennen, was an seine Stelle tritt (Punkt 11).
- `scripts/iel-mess-belege.mjs` teilt eine Warteschleife zwischen Kontrollwort-Fall und
  Ohrzeuge. Vor dem Streichen die verbleibenden Aufrufer belegen.
