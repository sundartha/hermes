# GQ-P4 — Stummes Scheitern beenden, Nachrichten entdoppeln

Zwei unabhaengige Befunde in disjunkten Dateien, beide **deterministisch** — hier wird kein
Modellverhalten erhofft.

---

## Teil A — B-10: der Agent scheitert stumm und niemand merkt es

**Live erlebt am 2026-08-04.** Das Anthropic-Guthaben war leer, jeder Modell-Turn kam mit
`400 "Your credit balance is too low"` zurueck. Der Owner hoerte nur die Offenlegung
(deterministischer Speak-Node, kein Modell) und danach **nichts** — inbound wie outbound.
Vier Anrufe, **null** Zusammenfassungen; ein Outbound-Anruf lief **52 Sekunden mit sieben**
aufeinanderfolgenden `agentTurn fehlgeschlagen`, waehrend der Owner weitersprach und
Carrier-Minuten liefen. Entdeckt wurde es nur, weil der Owner selbst anrief.

Am 04.08. erneut im Log gesehen, diesmal nach einem Anruf:
`[metrics] llm {"outcome":"retries-exhausted","attempts":3,"latencyMs":11215}` ->
`[summary] LLM nicht verfuegbar`.

### A1 — Der Bezahl-Fall ist in der eigenen Telemetrie unsichtbar

Der Shim prueft `vendorStatusOf(err) === HTTP_PAYMENT_REQUIRED` (402) und loggt dann
`vendor_402`. **Anthropic liefert fuer leeres Guthaben aber `400` mit
`invalid_request_error`.** Der Sonderfall "uns ist das Geld ausgegangen" faellt damit in den
generischen Fehlerpfad und ist von einem beliebigen technischen Fehler nicht zu unterscheiden.

Zu bauen: der Bezahl-/Guthaben-Fall wird als **eigener** Zustand erkannt und geloggt —
unabhaengig davon, ob der Anbieter ihn als 400 oder 402 verpackt. **Nicht** am
Fehlertext-Wortlaut festmachen, wenn es ein strukturiertes Feld gibt; wenn nur der Text
bleibt, das ausdruecklich als fragil kommentieren und eng fassen.

### A2 — Bei anhaltendem Ausfall wuerdevoll beenden

Heute bleibt `endCall` bei jedem Fehler `false`: der Anruf laeuft weiter, jeder Turn
scheitert, Minuten brennen. **Nach N aufeinanderfolgenden gescheiterten Turns desselben
Calls** soll der Agent hoerbar und hoeflich beenden statt stumm weiterzulaufen. Das zahlt
zugleich auf O-3 (Kuerze/Minutenkosten) ein.

- N und der Satz sind konfigurierbar (`src/config.js` **und** `.env.example`).
- Der Abschiedssatz ist **gesprochener** Text: korrekte Umlaute, kein Fachjargon, keine
  Schuldzuweisung, keine technischen Codes gegenueber der Gegenstelle.
- **Der Zaehler zaehlt nur echte Fehlschlaege in Folge** und wird von jedem erfolgreichen
  Turn zurueckgesetzt. Ein einzelner Ausrutscher darf kein Gespraech beenden.

### A3 — Der Degradations-Satz erreicht den Anrufer nicht (ZUERST MESSEN)

`degradedSpeechFor(err, locale)` ist im Shim-Catch verdrahtet und trennt transient
(`llmDegradedSpeech`) von 4xx (`turnErrorSpeech`). Trotzdem hoerte der Owner ueber sieben
gescheiterte Turns hinweg **nichts**. **Ob der Satz gar nicht auf den Draht ging oder nur
nicht gesprochen wurde, ist ungemessen** — dieselbe "gesetzt ist nicht wirkt"-Klasse, die
diese Kette schon zweimal Phasen gekostet hat.

**Baue zuerst die Sichtbarkeit**, dann den Fix: eine Logzeile, an der ablesbar ist, ob im
Fehlerfall eine gueltige Completion mit Text hinausging (Zeichenzahl genuegt, **kein**
Wortlaut). Ergibt die Messung, dass der Satz hinausgeht, sag das — und aendere den
Sendepfad **nicht** auf Verdacht.

### A4 — Alarmierung

**Owner-Entscheidung 2026-08-04: eine hochsichtbare Logzeile, KEINE Alarm-SMS.** Begruendung
des Owners: SMS kostet Geld und kann in eine Schleife geraten; die Alarmregel haengt er
ausserhalb des Repos in Render an. Die Zeile muss eindeutig greppbar sein und den
**Handlungsbedarf** benennen (was ist kaputt, was soll der Betreiber tun), nicht nur
"Fehler" (P8).

---

## Teil B — B-6: `take_message` feuert achtmal mit derselben Nachricht

Am Beleg-Anruf `call_msczdf1aadbw` feuerte `take_message` **8 mal**, immer mit derselben
Nachricht; die Segmente 18, 23, 24, 26, 30, 32, 34 und 38 tragen im Kern denselben Satz.

Am Code belegt: `execTool` ruft `store.addActionItem()` **bedingungslos** bei jedem
`take_message`-Aufruf, und `addActionItem` prueft nie, ob fuer denselben Call bereits ein
inhaltsgleiches Item existiert. Der Tool-Result-Text ist eine statische Locale-Konstante,
die dem Modell **nie** signalisiert "das ist schon notiert" — waehrend des Anrufs gibt es
keine Systeminformation ueber bereits genommene Nachrichten.

Zu bauen:

1. **Deduplizierung im Store** (deterministisch, der eigentliche Fix): eine inhaltsgleiche
   Nachricht fuer denselben Call wird **nicht** ein zweites Mal angelegt. "Inhaltsgleich"
   muss robust gegen belanglose Abweichungen sein (Whitespace, Gross-/Kleinschreibung,
   Satzzeichen am Ende) — aber **nicht** so grob, dass zwei echte, verschiedene Nachrichten
   verschmelzen. Begruende die Wahl.
2. **Das Tool-Ergebnis sagt die Wahrheit:** wurde dedupliziert, erfaehrt das Modell genau
   das ("diese Nachricht ist bereits notiert"). Das ist die einzige Prompt-nahe Aenderung
   dieser Phase.

**Anteil-Frage, ehrlich beantworten:** Ein Teil der acht Aufrufe geht auf B-1 zurueck (jede
Aeusserung loeste zwei Turns aus). Sag im Report, welcher Anteil nach der Deduplizierung
noch uebrig bliebe — und ob Teil B damit ueberhaupt noch eine eigene Wirkung hat.

**Randbedingung (O-9, Owner-Handgriff, KEIN Code-Thema):** Solange keine private Nummer
hinterlegt ist, erreicht **keine** aufgenommene Nachricht den Owner
(`sms_summary_skipped reason=no_private_number`). Erwaehnen, aber **keine** Loesung dafuer
bauen.

---

## Harte Randbedingungen (beide Teile)

- **Safety-Gates unberuehrt:** Kostendecke, `OUTBOUND_FROZEN`, Denylist, Land-Gate,
  Stundenlimit, Max-Dauer, Signaturpruefung, Offenlegungssatz, Auth. Das Beenden aus A2 ist
  ein **zusaetzliches** Ende, es ersetzt oder schwaecht die Max-Dauer-Notbremse nicht.
- **Kein Fail-open:** ist unklar, ob ein Turn wirklich gescheitert ist, wird **nicht**
  beendet. Ein faelschlich beendetes Gespraech ist schlimmer als ein Turn zu viel.
- **Keine Inhalte, keine Rufnummern, keine Secrets ins Log.** Zeichenzahlen, Zustaende,
  Zaehler.
- **Kein Prompt-Umbau** ausser dem Tool-Ergebnistext aus B2 und dem Abschiedssatz aus A2.
- Gesprochene Strings tragen **korrekte Umlaute**; Kommentare und Bezeichner ohne.
  ESM, kein Build-Step. Konfigurierbares nach `src/config.js` **und** `.env.example`.

## Abnahme

1. `npm test` gruen (Vorbedingung, nicht das Ergebnis).
2. Neue Tests, jeder mit Gegenbeispiel:
   - Guthaben-/Bezahlfehler (als 400 **und** als 402 verpackt) -> eigener Zustand erkannt
   - ein einzelner Fehlschlag zwischen zwei erfolgreichen Turns -> **kein** Beenden
   - N Fehlschlaege in Folge -> Abschiedssatz **und** Ende
   - zweimal dieselbe Nachricht -> ein Item, Tool-Ergebnis meldet die Dublette
   - zwei **verschiedene** Nachrichten -> zwei Items (Gegenbeweis gegen zu grobe Dedup)
3. Der A3-Befund steht als **Messergebnis** im Report — nicht als Vermutung.

## Rueckweg

Alle Schwellen und Schalter in `src/config.js`; die alten Werte stellen das heutige
Verhalten wieder her. Die Deduplizierung ist additiv und ohne Datenmigration.
