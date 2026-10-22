# P-004 Einzahl und Mehrzahl in der Bestätigung von answer_consult: Sicherheitsprüfung

Status: freigegeben
Grundlage: pitch.md, design.md (hält nur die Ausgangslage fest, „Design Doc: nein“ im Pitch), Code-Stand 5b1961d

## Zur Freigabe
1. Die schwersten Angriffswege: keine, siehe Angriffswege. Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden: nichts, weil die Änderung keine Bedrohung öffnet und damit kein Ausgang zu wählen ist.

## 1. Woran arbeiten wir
### Umfang
Geändert werden nur die drei Textfunktionen `consultAnswerAccepted` in der deutschen, englischen und französischen MCP-Tabelle (`src/i18n/mcp-texts.js:114`, `:221`, `:329`). Einziger Aufrufer ist das Werkzeug `answer_consult` mit `status` `"final"` (`src/mcp-tools.js:1016-1019`; eine Suche nach `consultAnswerAccepted` in `src/` findet keine weitere Stelle). Der erzeugte Satz geht als Textinhalt der Werkzeugantwort an den Agenten des Kunden zurück. Die strukturierte Antwort, die interne Route, der Werkzeugvertrag, Anrufe, SMS, Kosten und Transkripte bleiben unberührt (Pitch, Nicht-Ziele).
### Beteiligte
- Kunde: angemeldet; legt seine Kontosprache fest, nur aus der festen Liste `SUPPORTED_LANGUAGES` (`src/store/state-ops.js:2627-2644`).
- Agent des Kunden: ruft `answer_consult` mit dem Token des Kunden auf und bestimmt die Zahl der Antworten; er ist der einzige Empfänger des geänderten Satzes (`src/mcp-tools.js:1017-1018`).
- Angerufener: spricht mit dem Telefon-Agenten; der geänderte Satz erreicht ihn nicht, weil er nur in der MCP-Antwort steht. Was der Telefon-Agent bekommt, sind die angenommenen Angaben selbst (`src/store/state-ops.js:661-671`), und die ändert die Änderung nicht.
- Anrufer bei eingehenden Anrufen: nicht beteiligt, weil `answer_consult` nur bei Rückfragen in ausgehenden Anrufen des Kunden wirkt (angenommen; die Änderung berührt keinen eingehenden Pfad).
- Anbieter (Telnyx, ElevenLabs, Stripe, WorkOS): nicht beteiligt.
- Betreiber: nicht beteiligt.
### Eingänge und Grenzen
- MCP-Werkzeug `answer_consult` über `POST /mcp`: vom Agenten des Kunden nach Hermes, angemeldet. Beleg: `src/routes/mcp.js:89-95`, `src/mcp-tools.js:982-1029`. Angriffswege: keiner, weil die Änderung an diesem Eingang nur den Wortlaut der Antwort an denselben Aufrufer ändert. Was in den Satz eingeht, ist eine Zahl, die der Server selbst zählt (`merged_facts` aus `mergeContextFacts`, eine nicht negative ganze Zahl bis höchstens `KEY_FACTS_LIMITS.maxItems`, `src/store/state-ops.js:661-671`), und die Sprache der Tabelle, die nur `de`, `en` oder `fr` sein kann (`src/i18n/locales.js:168`, `:253`, `:336`, `:406-407`). Freier Text des Aufrufers fließt nicht in den Satz.
- Interne Route `POST /api/calls/:id/consult/answer`: von MCP-Werkzeug zu REST-API im eigenen Prozess. Beleg: `src/routes/api-calls.js:81-97`. Angriffswege: keiner, weil die Änderung die Route nicht berührt.
Keine neue Grenze; angesehen wurden der Weg vom Agenten des Kunden über `/mcp` zur internen Route und zurück sowie der Weg der Angaben in den laufenden Anruf.
### Werte
- Ein verständlicher Satz für den Agenten des Kunden: Gibt Claude ihn wörtlich weiter, sieht der Kunde ihn. Das ist ein Qualitätswert, kein Sicherheitswert.
- Die strukturierte Antwort (`accepted`, `merged_facts`): Fremde Clients lesen sie; sie bleibt gleich (Pitch, B1).
### Wem wir was glauben
- Keine neue Vertrauensannahme, weil der Satz nur aus einer vom Server gezählten Zahl und einer Sprache aus einer festen Liste entsteht und nichts von außen neu hineinkommt.
### Nicht-Ziele
- Diese Änderung schützt nicht gegen Inhalte in den Antworten selbst, die der Agent des Kunden an den Anruf übergibt, weil sie den Weg der Angaben in den Anruf nicht ändert; dafür gilt SG-11 in `docs/sicherheitsgrenzen.md`.

## 2. Angriffswege
Keine Angriffswege gefunden, weil die Änderung keinen neuen Eingang, keine neue Berechtigung, keine neue Datenquelle und keine neue Handlung schafft. Gesucht wurde je Beteiligtem über den einzigen berührten Eingang:
- Agent des Kunden: Er bestimmt nur die Zahl der Antworten. Der Server begrenzt sie (`src/routes/api-calls.js:82-84`, `src/store/state-ops.js:666-670`) und setzt nur die gezählte Zahl in den Satz; kein eigener Text des Aufrufers erscheint darin, also kann er darüber nichts in seine eigene oder eine fremde Antwort schreiben.
- Kunde: Er wählt die Sprache nur aus der festen Liste (`src/store/state-ops.js:2627-2644`). Sprachen ohne eigene Tabelle fallen auf Englisch zurück (`src/i18n/locales.js:406-407`). Damit kann er keine Sprache wählen, die die Beugung zum Absturz bringt oder fremde Texte lädt.
- Angerufener: Er erreicht den Satz nicht; seine Worte gehen weder in die Zahl noch in die Sprachwahl ein.
- Rückwärts vom Ziel: Anrufe oder SMS auf unsere Kosten, fremde Daten, ein ungewollter Anruf oder Hermes als Werkzeug gegen Dritte setzen voraus, dass sich am Wählen, an Gates, an der Mandantentrennung oder am Inhalt des Anrufs etwas ändert. Die Änderung berührt nichts davon; sie ändert nur die Endung eines Wortes in einer Antwort an den Aufrufer selbst.
- Stille Annahme: Die Beugung soll nach der Sprache der gewählten Tabelle laufen, nicht nach der rohen Kontosprache (Pitch, Fallen; PM1). Eine falsche Wahl führt zu einem grammatisch falschen Satz, nicht zu einer Sicherheitsfolge, weil auch die rohe Kontosprache nur aus der festen Liste stammt.

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1, H2, H3 | trifft nicht zu, weil die Änderung weder Anrufe noch SMS auslöst noch Verbrauch erzeugt; `answer_consult` wählt nicht und bleibt hinter denselben Prüfungen (`src/mcp-tools.js:1006-1009`) |
| H4 | trifft nicht zu, weil der Satz nur die eigene, vom Server gezählte Zahl des Aufrufers enthält; die Mandantentrennung an der internen Route (SG-02) bleibt unberührt |
| H5, H13 | trifft nicht zu, weil die Änderung weder Tokens noch Schlüssel berührt |
| H6, H7 | trifft nicht zu, weil kein Gesagtes des Angerufenen in den Satz eingeht und der Weg der Angaben in den Anruf gleich bleibt |
| H8 | trifft nicht zu, weil die Änderung weder Offenlegung noch KI-Kennzeichnung noch den Anrufinhalt berührt; kein Punkt für die rechtliche Prüfung |
| H9, H10, H11 | trifft nicht zu, weil die Änderung weder eingehende Anrufe, Webhooks noch ausgehende Aufrufe an Kundenadressen berührt |
| H12 | trifft nicht zu, weil keine Stimme, keine Worte und kein Transkript neu verarbeitet, gespeichert oder geloggt werden; der Audit-Eintrag mit der Zahl (`src/routes/api-calls.js:91-95`) bleibt gleich |
| H14 | trifft nicht zu, weil `Intl.PluralRules` zur Laufzeit von Node gehört (design.md, Ausgangslage), kein neues Paket kommt und keine Werkzeugbeschreibung sich ändert (Pitch, Nicht-Ziele) |
| H15 | trifft nicht zu, weil die Änderung keinem Anbieter und dem Agenten des Kunden nichts Neues glaubt; siehe „Wem wir was glauben“ |
| STRIDE an geänderten Grenzen | keine neue oder geänderte Grenze; am berührten Eingang `answer_consult` ergibt keine Kategorie einen Weg, weil sich nur der Wortlaut der Antwort an denselben Aufrufer ändert, aus einer Zahl, die der Server zählt, und einer Sprache aus einer festen Liste |
| LINDDUN für die angerufene Person | trifft nicht zu, weil der Satz keine Angaben über die angerufene Person enthält und sie nicht erreicht |

## 4. Offene Fragen
keine

## 5. Vorschlag für docs/sicherheitsgrenzen.md
Keiner, weil keine neue Grenze, kein neuer Eingang und keine neue Vertrauensannahme entsteht; die Zeile für `answer_consult` in der Angriffsfläche bleibt gültig.

## 6. Gegenprüfung
| Nr. | Art | Bezug | Befund mit Beleg | Übernommen als |
|---|---|---|---|---|

Nichts gefunden, weil der Satz nur die vom Server gezählte Zahl (`src/mcp-tools.js:1016`, `src/routes/api-calls.js:85-97`, `src/store/state-ops.js:661-671`) und eine Texttabelle aus der festen Liste (`src/i18n/locales.js:406-408`) enthält und nur an den angemeldeten Aufrufer zurückgeht (`src/routes/mcp.js:89-95`); `consultAnswerAccepted` hat genau eine Aufrufstelle (`src/mcp-tools.js:1018`).
