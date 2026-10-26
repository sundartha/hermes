# P-010 Fragerunden

## Runde 1
1. Ein Wort gilt an der Grenze genau dann als vollständig, wenn das Zeichen direkt hinter der Grenze (Stelle `maxChars`) ein Leerzeichen ist; steht dort ein Satzzeichen („nicht, auch“), bleibt es beim heutigen Schnitt am letzten Leerzeichen? Empfehlung: ja, weil das der gewählte Kandidat mit 2–3 Zeilen ist und eine Regel für Satzzeichen eigene Fälle braucht („15:30“, „3,5“, „Dr.“ würden sonst zu „15“, „3“, „Dr“). Hinweis: Die beiden „heute rot“-Beispiele der Vorarbeit haben an der Grenze ein Komma; sie blieben mit dieser Regel rot und werden durch neue Beispiele mit Leerzeichen ersetzt. Das Komma-Beispiel kommt unter „Nicht-Ziele“.
2. S1 läuft über den ElevenLabs-Webhook `POST /webhooks/elevenlabs/lookup` (`src/routes/webhooks-elevenlabs.js:308`): Die Suche (Exa) liefert einen Treffer, aus dem ein Fakt von 227 Zeichen wird, an Stelle 200 ein Leerzeichen hinter „nicht“; das Dann ist die `answer` der Webhook-Antwort, die mit „… am Brueckentag nicht“ endet (heute „… am Brueckentag“)? Empfehlung: ja, weil das der Hauptpfad der Recherche ist, die Antwort die Grenze nach außen ist und `test/el-lookup-webhook.test.js` dafür schon eine Attrappe hat.
3. S2 läuft über `place_call` auf dem Telnyx-Pfad mit dem Ziel „Bitte den Termin beim Friseur verschieben, denn der Samstag passt mir nicht mehr, Montag geht“ (an Stelle 75 ein Leerzeichen hinter „nicht“); das Dann ist der Eröffnungstext in der Antwort auf `POST /voice/outbound`, der mit „… passt mir nicht.“ endet (heute „… passt mir.“)? Empfehlung: ja, weil das die Stelle nahe der Offenlegung ist (`src/claude.js:224-229`, `:248`) und die Grenze „Offenlegung“ einen Beleg verlangt, dass sich nur das Ziel ändert.
4. B1 (Bleibt): derselbe Anruf an einen Dritten; der Eröffnungstext beginnt byte-gleich mit dem Offenlegungssatz aus `LOCALES.de.disclosure` („Guten Tag, hier spricht ein KI-Assistent im Auftrag von <Name>. Das Gespräch wird für meinen Auftraggeber zusammengefasst.“), danach genau ein Leerzeichen und „Es geht um Folgendes: “? Empfehlung: ja, weil das Wortlaut, Reihenfolge und Vorhandensein der Offenlegung festschreibt und heute schon grün ist.
5. B2 (Bleibt): Steht an Stelle 200 ein Buchstabe („Brueckentag niemals mehr“), wird der Fakt wie heute am letzten Leerzeichen gekürzt; die `answer` endet mit „… am Brueckentag“ und enthält nicht „niema“? Empfehlung: ja, weil es die Behebung gegen eine zu weite Fassung (ein angeschnittenes Wort behalten) sichert und heute schon grün ist.
6. Rückfrage an den Besitzer (`src/consult/question.js:16`), Recherche-Anfrage (`src/research/lookup-guard.js:35`), Denk-Signal (`src/thinking-signal.js:10`) und Gedächtnis (`src/call-memory.js:21` `clampMarked`) bekommen keine eigenen Szenarien; sie ändern sich über die gemeinsame Hilfe genauso (höchstens ein ganzes Wort mehr, nie länger als ihre Grenze)? Empfehlung: ja, weil ein Szenario je Aufrufer nur dieselbe Zeile in `src/utils/text.js` prüfte und die Mutation sie über alle ~99 Testdateien ohnehin erreicht.
7. Design Doc: nein? Empfehlung: ja (nein), weil es mit einer Zeile in der vorhandenen Hilfe nur einen ernsthaften Weg gibt, weder Werkzeugvertrag noch gespeicherte Daten berührt werden und ein Code-Rollback alles zurücknimmt; `design.md` bekommt nur „Ausgangslage und Annahmen“.

### Antworten Runde 1
(Betreuung, 25.10.2026 03:5x MEZ, `/tmp/paket-P010/betreuung-antwort-runde1.md`)
1. ja, eng: nur ein Leerzeichen an Stelle `maxChars` zählt als Wortende, keine Erweiterung auf Satzzeichen, weil Komma und Punkt auch in Zahlen stehen („12,50 €“, „3.000“, „14.30 Uhr“) und ein Schnitt dort „12“ oder „14“ stehen ließe, was für den Angerufenen falsch und schlimmer als ein fehlendes Wort ist. Neue Beispiele mit Leerzeichen an der Grenze. Die Kommafälle nicht ins Szenario, sondern als offene Grenze im Pitch („Satzzeichen an der Grenze: bewusst nicht behandelt, weil …“).
2. ja.
3. ja.
4. ja.
5. ja.
6. ja, aber in Premortem und Sicherheitsprüfung je Aufrufer eine Zeile, ob das zusätzliche ganze Wort dort etwas offenlegen kann, das heute wegfällt.
7. ja (kein Design Doc).

## Vorher-Rot
- S1: heute endet die `answer` mit „… und telefonisch erreichbar ist die Praxis am Brueckentag“ (Fakt 194 Zeichen) statt „… am Brueckentag nicht“ (200 Zeichen), weil `clampAtWordBoundary` das letzte Leerzeichen nur in `text.slice(0, maxChars)` sucht (`src/utils/text.js:3-4`) und `lookupFactsFrom` mit 200 kürzt (`src/research/lookup-guard.js:45`); nachgestellt mit `lookupFactsFrom` am master ae362d2 am 2026-10-25.
- S2: heute endet der Eröffnungstext mit „… denn der Samstag passt mir.“ statt „… passt mir nicht.“, weil `trimGoalForSpeech` mit 75 kürzt (`src/claude.js:248`) und `clampAtWordBoundary` das Wort vor dem Leerzeichen an Stelle 75 wegwirft (`src/utils/text.js:3-4`); nachgestellt mit der Hilfe am master ae362d2.
- B1 und B2 treten heute schon ein (B1: `openingText` setzt den Offenlegungssatz vor das Ziel, `src/claude.js:224-233`; B2: Schnitt am letzten Leerzeichen vor einem Buchstaben, nachgestellt „… am Brueckentag“, 194 Zeichen) und stehen deshalb unter „Bleibt unverändert“.
- B3 (aus der Gegenprüfung): tritt heute schon ein (nachgestellt: „… am Brueckentag“, 194 Zeichen) und mit der geplanten Behebung ebenso; eine Fassung, die ein Zeichen zu weit nach dem Leerzeichen schaut, liefert 201 Zeichen bis „nichts“ (nachgestellt mit node am 2026-10-25). Deshalb unter „Bleibt unverändert“.

## Runde 2 (Premortem)
1. PM1 (R1 greift nur, wenn genau hinter der Grenze ein Leerzeichen steht; liegt die Grenze im Wort „nicht“ oder auf dem Leerzeichen davor, fällt „nicht“ weiter weg, B2 legt das fest) wird Nicht-Ziel, und der zweite Teil des ersten Satzes der Absicht wird enger: „…, damit der Agent dem Angerufenen in dieser Lage nicht das Gegenteil sagt, etwa „erreichbar“ statt „nicht erreichbar“.“? Empfehlung: ja, weil die Absicht sonst mehr verspricht, als die eng gewählte Regel (Runde 1, Frage 1) hält, und die anderen Lagen nur mit einem Kürzungszeichen oder einer anderen Regel zu beheben wären.
2. PM2 (die Hilfe behält das Wort vor der Grenze ohne Blick auf seine Bedeutung; eine Verneinung, die erst mit dem nächsten Wort ihren Sinn hat, bleibt allein stehen: „nicht nur vormittags“ → „… nicht“, „kein Problem“ → „… kein.“; heute steht dort ein neutrales Bruchstück) wird Nicht-Ziel und steht zusätzlich unter „Fallen“? Empfehlung: ja, weil die Hilfe Bedeutung nicht beurteilen kann, beide Richtungen gleich selten sind (Grenze genau auf einem Wortende vor einem Leerzeichen) und ein Szenario nur das schädliche Ergebnis festschreiben würde; im Gedächtnis zeigt „…“ den Schnitt ohnehin an.
3. PM3 (jede gekürzte Ausgabe kann künftig ein ganzes Wort mehr enthalten, auch eine, die an Dritte weitergeht) wird hingenommen? Empfehlung: ja, weil keine neue Art der Offenlegung entsteht und die Sicherheitsprüfung jeden Aufrufer prüft (Runde 1, Frage 6); das Ergebnis liegt bei der Betreuung.

### Antworten Runde 2
1. ja (Betreuung): PM1 Nicht-Ziel, Absicht enger („in dieser Lage“).
2. ja (Betreuung): PM2 Nicht-Ziel und Falle; der Pitch sagt ausdrücklich, dass die Änderung nur ganze Wörter erhält und keinen Sinn prüft.
3. ja (Betreuung): PM3 hingenommen; die Sicherheitsprüfung je Aufrufer bleibt, ihr Ergebnis liegt bei der Betreuung.

## Freigabe der Planung
- 25.10.2026: Planung freigegeben: 1600000 Token (Betreuung, Freigabeliste Punkt 13).
- 26.10.2026: Freigabe Antonio 26.10.2026 09:3x (wörtlich: „Ja mach das so und gib knallgas“ auf den Vorschlag „P-010 sofort neu planen, Obergrenze 2,0 Mio. statt 1,6 Mio.“): **Planung P-010 freigegeben: 2000000 Token** (ersetzt 1 600 000).
- 26.10.2026: Freigabe Antonio 26.10. 11:27: P-010 +1,0 Mio., gesamt 3,0 Mio. (**Planung P-010 freigegeben: 3000000 Token**, ersetzt 2 000 000).
- 26.10.2026: Freigabe Antonio 26.10. 12:2x: Token-Deckel aufgehoben. Wörtlich: „Ich brauche keinen Token-Deckel. Ich möchte erstmal, dass alles funktioniert.“ Bis der Deckel im Code entfällt, steht im Kopf `Planung freigegeben: 100000000 Token`.
