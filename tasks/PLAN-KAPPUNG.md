# Strategie: die gekappten Agenten-Turns (Befund 1)

Stand 2026-08-11. Grundlage: Workflow `wf_cba149ee-1a0`, 26 Agenten, fuenf unabhaengige
Messdimensionen, jede gemessene Aussage anschliessend adversarisch geprueft.
**Von 20 vorgelegten Befunden haben 7 standgehalten, 13 wurden gekippt.**

## Der Defekt

`call_msoem5d1qpsf` (2026-08-11): von 7 gesprochenen Agenten-Turns kamen **2 vollstaendig**
beim Menschen an. Fuenf brachen mitten im Wort ab. Owner-Urteil: *"der Assistent hat nicht
richtig geantwortet"* — er hat geantwortet, es kam nur nicht an.

## Die Wurzel: UNBELEGT

Das ist das Ergebnis, nicht das Fehlen eines Ergebnisses. Aus den standgehaltenen Befunden
folgt nur, was es **nicht** ist. Welche Stelle zwischen unserem Draht und dem Ohr des
Anrufers kappt, hat keine Messung dieses Laufs entschieden.

## Was ausgeschlossen ist (belegt)

| Kandidat | Warum er ausscheidet |
|---|---|
| **Provider-Config ist zurueckgefallen** | Seit dem 09.08. gab es **null** Revisionen. `interrupt_prediction_threshold` steht weiter auf 0.4, `noise_suppression` auf `deepfilternet`. |
| **Config-Unterschied gut/schlecht** | Der Defekt-Anruf lief auf **exakt derselben** Assistant-Version wie der als "gut" gemessene Anruf vom 09.08. (`20260809T095319385426`). |
| **Startlatenz ("spaeter erster Ton -> Kappung")** | Im Defekt-Anruf liegen **alle sieben** `audio_first_token`-Werte zwischen 115 und 147 ms — gekappte wie vollstaendige. Ueber 89 klassifizierte Turns trennt die Groesse nicht (AUC 0,46). |
| **Wir liefern unvollstaendig aus** | Die `hold=flushed`-Zeitstempel liegen konstant 211-279 ms **vor** Telnyx' `sent_at`. Der Provider hatte den vollstaendigen Text, bevor er zu sprechen begann. |

## Der Befund, der die Lage veraendert

**Die Kappung liegt bei rund 40 % — und zwar seit mindestens dem 31.07.**, also **zwei Wochen
vor** GQ-P18. Sie ist kein neuer Defekt und keine Regression der Sprechsperre. Was sich
geaendert hat, ist nicht die Rate, sondern dass sie jemandem aufgefallen ist.

**Daraus folgt unmittelbar:** der Barge-in-Patch vom 09.08. gilt im Bestand als *Loesung*.
**Er ist es nicht.** Seine Abnahme beruhte auf **2 Assistant-Turns eines einzigen Anrufs**,
gefahren auf einem Code-Stand ohne GQ-P17/P18. Bei einer Grundrate von 40 % faellt "0 von 2
gekappt" rein zufaellig in **36 %** der Faelle an. Der Patch schadet nicht und bleibt — aber
er darf nicht laenger als erledigter Punkt gefuehrt werden.

## Optionen

### O1 — Kapp-Rate zu einer wiederholbaren Zahl machen **(zuerst)**

Read-only Messskript (`scripts/kappungsrate.mjs`, Muster: `telnyx-call-latency.mjs`). Joint je
Turn den **gespielten** Text (`GET /v2/ai/conversations/<id>/messages`, Feld `text`) gegen den
**erzeugten** Text (`transcript_segment`) und protokolliert, ob im Sprechfenster ein
Caller-Turn liegt.

Kein Laufzeit-Code, kein Deploy, kein Anruf, keine Freigabe. Aufwand: halber Tag.

**Drei Pflicht-Assertions, jede aus einem Fehler dieses Laufs geboren:**
- `meta.total_pages` auslesen und **alle** Seiten holen — die Paginierung (page_size 20) hat
  hier 19 Nachrichten verschluckt, bei HTTP 200 und vollstaendig aussehender Antwort.
- RLS-SET in derselben `psql`-Sitzung **plus Positiv-Kontrolle** (`count > 0`).
- Join ueber `call_id` + Reihenfolge, **nicht** ueber Text-Praefix — ein Praefix-Join verlor
  ausgerechnet die haertesten Kappungen.

**Selbsttest:** das Skript **muss** fuer `call_msoem5d1qpsf` 5 von 7 liefern. Tut es das
nicht, ist es kaputt und nicht die Datenlage.

### O2 — Der Diagnoseknopf: Barge-in ganz aus, fuer genau 3 begleitete Anrufe

`PATCH /v2/ai/assistants/<id>` mit `interruption_settings.enable: false`. Danach **zwingend**
`GET` und den zurueckgegebenen Wert lesen — Telnyx quittiert ungueltige Felder mit 200 und
ignoriert sie still (hier schon zweimal passiert).

Der einzige Eingriff, der die Frage **binaer** beantwortet: verschwindet die Kappung, ist die
Wiedergabe-Achse belegt; bleibt sie, scheidet Barge-in aus und der Suchraum halbiert sich.
Sekunden Aufwand, Sekunden Rueckweg.

**Risiko:** der Schalter wird vergessen und geht so in den Launch — Kunden koennten einen
abschweifenden Agenten nicht mehr unterbrechen. Das ist produktseitig schlimmer als eine
gekappte Antwort. Deshalb: Rueckweg (`enable=true`, threshold 0.4) und die alte
`version_id 20260809T095319385426` **vor** dem Eingriff notieren, Rueckstellung am selben Tag.

### O3 — Env-Flip `TELNYX_SHIM_EXTEND_HOLD_MS` 3000 -> 0

Erst **nach** O2, und nur wenn O2 Barge-in ausgeschlossen hat. Holt die Doppelantwort-Regression
zurueck (der Grund fuer GQ-P18) und loest einen Deploy aus, der die Messung verunreinigt.
Vor dem Flip den Live-Commit festhalten, danach gegenpruefen.

### O4 — Den Draht instrumentieren (Log-only)

`logShimHold` um reine **Zahlen** erweitern: `bufferedCount`, gehaltene Millisekunden,
Zeitstempel des ersten und letzten `writeChunk`. Die heutige `hold`-Zeile fuehrt nur
`callId/turnSeq/holdMs/outcome` und kann "Sperre war gratis" nicht von "Sperre hielt 100 % des
Textes bis zum Turn-Ende" unterscheiden. Laeuft mit, sobald ohnehin deployt wird.

**Niemals den gepufferten Text mitloggen** — das ist PII aus einem echten Telefonat.

### O5 — `user_idle_reply_secs` 4 -> 8 (Nebenachse, erst nach O2)

Im Defekt-Anruf waren **6 von 13** Shim-Turns `provider_nudge`: der Provider stiess Turns an,
die niemand angefordert hatte. Der Wert 4 s steht zudem belegt in Interferenz mit unserer
3000-ms-Sperre (`config.js` deckelt sie bei 3500 ms, *"weil die Frist sonst in Telnyx' eigenes
Anstoss-Fenster laeuft"*).

**Risiko:** bei echten Nutzerpausen antwortet der Agent gar nicht mehr — dasselbe Symptom,
nur schlimmer. Deshalb ein Schritt (4 -> 8), nicht auf null.

## Messplan

**VORHER (belegt):** 5 von 7 Turns gekappt = **71 %** in `call_msoem5d1qpsf`.
Grundrate ueber 30 Anrufe: **63 von 158 = 40 %**.

**NACHHER:** derselbe Quotient ueber **mindestens 18 Agenten-Turns**, am selben Tag, in einer
einzigen Konfiguration, abgelesen mit demselben Skript.

**Erfolgsschwelle: hoechstens 2 von 18 gekappt (11 %).** Gegen die Grundrate p=0,40 gerechnet:
P(X<=2 | n=18) = 0,008. Zum Vergleich, warum die letzte Abnahme wertlos war: "0 von 2 gekappt"
tritt bei derselben Grundrate mit **36 %** Wahrscheinlichkeit rein zufaellig ein.

**Randbedingung 91 s:** Anrufe auf die Owner-Nummer kappt der Ziel-Carrier nach ~91 s (belegt,
bei uns nicht behebbar). Ein Anruf liefert ~7 Turns — **3 Anrufe a <=90 s ergeben ~21 Turns**
und erfuellen die Schwelle. Der Plan braucht also keinen langen Anruf.

**Zwei Zaehlregeln, ohne die die Zahl falsch wird:**
- Ein Turn, dessen Text weniger als 2 s vor dem Hangup auf den Draht ging, wird **verworfen** —
  das ist die 91-s-Carrier-Kappung, nicht dieser Defekt.
- Telnyx' `user`-Zeitstempel ist unzuverlaessig (gemessen 1,62 s zu spaet, Aeusserungen fehlen
  ganz). Als Onset zaehlt der **fruehere** der beiden Werte aus Telnyx-Protokoll und unserer
  `turn_probe`-Zeile.

## Verworfen — nicht erneut aufmachen

Diese Hypothesen sahen ueberzeugend aus und sind an der Pruefung gescheitert. Sie stehen hier,
damit sie niemand ein zweites Mal untersucht.

1. **Trendkurve der Tagesquoten.** 9 von 10 Tagen sind bei n=5..44 nicht vom Schnitt
   unterscheidbar, auch die 75 % vom 11.08. nicht (p=0,07). Nur die Grundrate ~40 % traegt.
2. **"Die Sprechsperre hat es verschlimmert"** (Fenster A 40 % / B 0 % / C 52 %). Fenster C ist
   falsch etikettiert (die erste `hold`-Zeile gehoert GQ-P17), die 0 % in B sind ein
   Schnitt-Artefakt bei n=2. A gegen C: Fisher p=0,34 — die Daten koennen "unveraendert" und
   "Anstieg" nicht trennen. **Ueber die Wirkung der Sperre erlauben diese Daten keine Aussage,
   in keine Richtung.**
3. **Startlatenz als Erklaerung.** Der n=1-Ursprungsdatenpunkt (2558 ms) ist lokalisiert und war
   ein Sonderfall; der Satz "kein gekappter Turn erreicht 500 ms" ist an vier Gegenbeispielen
   widerlegt.
4. **"Alle Turns gingen vollstaendig raus, weil die Chunk-Zahl stimmt."** Das Merkmal
   unterscheidet nichts — die fuenf Turns mit exakter Uebereinstimmung *sind* die fuenf
   gekappten. Jede Kappstelle liegt zudem **mitten in einem Chunk**; ein Delta-Zaehler kann das
   strukturell nicht sehen.
5. **"Die Sperre war gratis" (7x `flushed`).** `flushed` heisst per Definition, dass 100 % der
   Fragmente bis zum Turn-Ende zurueckgehalten und dann in einem ~2-ms-Schub geschrieben
   wurden. Die `supersede`-Zeile war strukturell unerreichbar; ihr Fehlen ist keine Messung.
   Das entlastet GQ-P18 **nicht** — belegt aber auch nichts dagegen.
6. **"Der Verlust entsteht beim Provider-Ingest."** Widerlegt: der Provider hatte den Text
   211-279 ms vor `sent_at`, und ein Ingest-Verlust kann nur ganze SSE-Events verlieren, nie
   mitten im Chunk schneiden.

## Reihenfolge

**O1 -> O2 -> (O4) -> O3 -> O5.**

O1 zuerst, weil dieser Lauf gezeigt hat, dass nicht der fehlende Fix die Schwachstelle ist,
sondern die fehlende belastbare Zahl: **von sieben vorgelegten Messungen sind sieben** an
Paginierung, Fenster-Etikettierung, Stichprobenschnitt oder falscher Konfigurationszuordnung
gekippt. Ohne eine Zahl, die man zweimal gleich erhebt, wird hier ohnehin nichts gebaut.
