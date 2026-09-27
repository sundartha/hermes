# E3: Anruf-Pfad - Idempotenz und Frist, alleine

Dritte Bau-Etappe der OpenAI-Sanierung, und die gefaehrlichste der bisherigen: der Defekt, den sie
behebt, ruft einen unbeteiligten Menschen ein ZWEITES Mal an und bucht ein zweites Mal Geld.
**Kein Mitfahrer** - diese Etappe traegt nur diesen einen Schnitt, damit ein Rollback genau eine
Sache zurueckdreht.

## Woher die Vorgabe stammt (in dieser Reihenfolge lesen)

1. `tasks/openai-fix/S3-anruf-idempotenz.md` - das vollstaendige Spec samt seinem
   Pre-Mortem-Abschnitt. Die dortigen Nachbesserungen sind Teil der Vorgabe.
2. `PLAN-OPENAI.md`, Abschnitt "### Etappe 3" - die verbindliche Abnahme, Punkt fuer Punkt.
3. `PLAN-OPENAI.md`, Abschnitt "## Messung vom 18.09.2026" - die Live-Lage, auf der diese Etappe
   aufsetzt.

## Bereits entschieden - nicht neu aufrollen

**Owner-Entscheidung E-3 (Tabelle in `PLAN-OPENAI.md`): Dedup JA, Fenster 180 Sekunden.**
Der zweite Aufruf liefert die `callId` des ERSTEN zurueck, mit `deduplicated:true` - damit kann der
aufrufende Client erkennen, dass die Aktion bereits lief. Das ist der Kern der Anforderung N-11
(Werkzeuge sind retry-sicher oder weisen es aus). Der akzeptierte Preis steht in der Tabelle: ein
absichtlicher Zweitanruf an dasselbe Ziel ist im Fenster blockiert.

## Was die Messung dazu beigetragen hat

`docs/RUNBOOK-LIVE-WERTE.md`: **0 haengende `active`-Anrufe** in Produktion (F-f, bewiesen; die
Tabelle heisst `public.call`). Damit ist der im Pre-Mortem befuerchtete Fall "ein nie geschlossener
Datensatz sperrt das Ziel 180 Sekunden lang" heute nicht eingetreten - er bleibt ein Risiko fuer
die Zukunft, ist aber kein Bestandsproblem. Ausserdem **0 Anrufe ohne `tenant_id`** (F-g), die
Spalte ist ohnehin `NOT NULL`.

## Zwei Punkte, die der Plan als NICHT umsetzungsreif fuehrt

Beide sind hier Vorbedingung, nicht Kuer. Wer sie nicht belegen kann, MELDET das und baut den
jeweiligen Punkt NICHT auf Verdacht:

1. **S3-A5, die Fehlerklammer um das Fenster vor `createCall`.** Unbelegt ist, ob `test/helpers.js`
   eine Attrappen-Naht hergibt, mit der ein Store-Fehler an genau dieser Stelle deterministisch
   ausgeloest werden kann. Weise die Naht am Code nach - oder finde einen anderen Weg, den Wurf
   deterministisch zu erzeugen. Gibt es keinen, ist die Klammer nicht end-to-end verifizierbar:
   dann im Report als nicht umsetzbar melden, statt einen Test zu schreiben, der auch bei kaputtem
   Code gruen waere.
2. **S3-A1, die Hoehe der Hop-Frist.** Die Rechnung "die Frist kappt nie einen laufenden
   Anrufstart" traegt nur, solange `fetchOpeningLine` unter der Frist bleibt. Ob der Backoff am
   LLM-Seam gedeckelt ist, ist ungeprueft (`src/config.js:550-561`). Lies den Worst-Case am Seam ab
   und leite die Konstante daraus her - keine geratene Zahl, keine Magic Number ohne benannte
   Konstante.

## Harte Grenzen

- **Die Idempotenz darf NICHT vor den Safety-Gates greifen.** Die Gate-Kette liegt in
  `src/telephony/outbound-gates.js`. Wuerde die Dedup-Pruefung davor entscheiden, koennte ein
  Aufruf die Gates ueberspringen - das ist absolute Regel 1 und ein sofortiger Blocker. Die
  Abnahme verlangt ausdruecklich: die Kette hat unveraendert 18 Glieder in unveraenderter
  Reihenfolge (`node --test test/outbound-gates-order.test.js`).
- **Der zweite Schreibpfad auf `s.reservations` ist der zweite Gefahrenpunkt.** Eine doppelte
  Freigabe hoehlt die pro-Tenant-Kostendecke aus (ebenfalls absolute Regel 1). Die Abnahme
  verlangt: nach einem deduplizierten Aufruf entspricht `reservations[<tenant>]` exakt dem Wert
  nach einem einzelnen Anruf, und nach einem Wurf vor `createCall` ist er 0.
- Kein Scope-Zuwachs: keine Aenderung an der Gate-Logik selbst, an der Offenlegung, am
  Store-Schema, an der Telefonie-Anbindung. Keine neue Env-Variable (der Plan nennt ausdruecklich
  0).
- Der Dedup-Schluessel wird SERVERSEITIG abgeleitet, nicht vom Client geliefert - ein Modell
  erfindet einen Idempotenz-Schluessel bei jedem Versuch neu, damit waere die Sicherung wirkungslos.
- Fehlermeldungen an den Client tragen keine internen IDs, keine Stack-Traces, keine Secrets.
  Neue nutzersichtbare Texte gehoeren nach `src/i18n/mcp-texts.js` in alle dort gefuehrten Sprachen.

## Konventionen

ESM, kein Build-Step. Kommentare auf Deutsch ohne Umlaute. Gesprochene bzw. nutzersichtbare
deutsche Strings tragen Umlaute. Neues Verhalten braucht einen Test; hier sind es zwei neue
Testdateien, und der Nebenlaeufigkeits-Fall (zwei gleichzeitige Anrufe) muss echt nebenlaeufig
geprueft werden, nicht sequenziell nachgestellt.
