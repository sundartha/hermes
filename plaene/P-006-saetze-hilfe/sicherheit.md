# P-006 Vollständige Sätze in der Beugungs-Hilfe von answer_consult: Sicherheitsprüfung

Status: freigegeben
Grundlage: pitch.md, design.md (hält nur die Ausgangslage fest, „Design Doc: nein“ im Pitch), Code-Stand 294e9cc

## Zur Freigabe
1. Die schwersten Angriffswege: keine, siehe Angriffswege. Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden: nichts, weil die Änderung keine Bedrohung öffnet und damit kein Ausgang zu wählen ist.

Freigegeben 2026-10-24: Angriffswege entsprechen der Einschätzung der Betreuung, keiner fehlt.

## 1. Woran arbeiten wir
### Umfang
Die Hilfe `countedText(lang, singular, plural)` (`src/i18n/mcp-texts.js:4-6`) bekommt künftig zwei vollständige Sätze als Funktionen der Zahl, statt selbst Zahl und Wort zusammenzusetzen; die drei Tabelleneinträge `consultAnswerAccepted` (`src/i18n/mcp-texts.js:118`, `:225`, `:333`) übergeben diese Sätze (Pitch, Grobe Lösung und Fallen). Der Wortlaut bleibt byte-gleich (Pitch, Absicht). Einziger Aufrufer ist `answer_consult` mit `status` `"final"` (`src/mcp-tools.js:1016-1019`; eine Suche nach `consultAnswerAccepted` in `src/` findet keine weitere Stelle). Werkzeugvertrag, strukturierte Antwort, interne Route, Anrufe, SMS, Kosten und Transkripte bleiben unberührt (Pitch, Nicht-Ziele).

Diese Prüfung baut auf `plaene/P-004-angaben-zahl/sicherheit.md` und `plaene/P-005-beugung-hilfe/sicherheit.md` auf, die dieselbe Stelle für die Beugung und die gemeinsame Hilfe geprüft und keinen Angriffsweg gefunden haben. Neu an P-006 ist nur, wer die Zahl in den Satz setzt: der Satz der Tabelle statt der Hilfe.
### Beteiligte
- Kunde: angemeldet; seine Kontosprache wählt nur die Tabelle (`src/routes/mcp.js:95`, `src/i18n/locales.js:406-408`), nicht das Sprachkürzel der Beugung, das als Literal in der Tabelle steht (`src/i18n/mcp-texts.js:118`, `:225`, `:333`; Pitch, Fallen).
- Agent des Kunden: ruft `answer_consult` über `POST /mcp` mit dem Token des Kunden auf (`src/routes/mcp.js:89`) und bestimmt, wie viele Antworten er schickt; er ist der einzige Empfänger des Satzes (`src/mcp-tools.js:1018`).
- Angerufener: erreicht den Satz nicht; bei ihm kommen nur die angenommenen Angaben an (`src/store/state-ops.js:661-671`), und deren Weg ändert sich nicht.
- Anrufer bei eingehenden Anrufen: nicht beteiligt, weil `answer_consult` nur Rückfragen offener Anrufe des Kunden beantwortet (`src/store/state-ops.js:681-691`) und die Änderung keinen eingehenden Pfad berührt (angenommen, wie in P-004 und P-005).
- Anbieter (Telnyx, ElevenLabs, Stripe, WorkOS): nicht beteiligt.
- Betreiber: nicht beteiligt; keine Einstellung, kein Schalter.
### Eingänge und Grenzen
- MCP-Werkzeug `answer_consult` über `POST /mcp`: vom Agenten des Kunden nach Hermes, angemeldet. Beleg: `src/routes/mcp.js:89-95`, `src/mcp-tools.js:982-1029`. Angriffswege: keiner, weil in die Sätze nur die Zahl eingeht, und die ist das vom Server gezählte `merged_facts` (`src/routes/api-calls.js:85-97`; `src/store/state-ops.js:661-671`: Länge eines Ausschnitts, also eine ganze Zahl von 0 bis `KEY_FACTS_LIMITS.maxItems` = 10, `src/store/defaults.js:179`), im Werkzeug zusätzlich auf den Typ Zahl geprüft (`src/mcp-tools.js:1016`). Die Antworttexte des Agenten erreichen weder die Hilfe noch die Sätze. Die Sätze stehen ausgeschrieben im Code und ersetzen keine Platzhalter (Pitch, Fallen).
- Interne Route `POST /api/calls/:id/consult/answer`: vom MCP-Werkzeug zur REST-API im eigenen Prozess. Beleg: `src/routes/api-calls.js:81-97`. Angriffswege: keiner, weil die Änderung die Route nicht berührt.
- Laden der Datei beim Start: `src/i18n/mcp-texts.js` wird von `src/i18n/locales.js:6`, `src/mcp-tools.js:21` und `src/mcp-no-tenant.js:3` importiert. Angriffswege: keiner, weil die Hilfe `Intl.PluralRules` weiter erst beim Aufruf anlegt (Pitch, Fallen) und die Sätze beim Laden nur als Funktionen entstehen, ohne ausgeführt zu werden.

Keine neue Grenze; angesehen wurden der Weg vom Agenten des Kunden über `/mcp` zur internen Route und zurück, der Weg der Angaben in den laufenden Anruf und das Laden der Textdatei beim Start.
### Werte
- Ein verständlicher Satz für den Agenten des Kunden: ein Qualitätswert, kein Sicherheitswert (wie in P-004 und P-005).
- Die strukturierte Antwort (`accepted`, `merged_facts`): entsteht unabhängig vom Text (`src/mcp-tools.js:1019`) und bleibt gleich.
- Die Verfügbarkeit des Dienstes: Ein Fehler beim Laden der Textdatei träfe den ganzen Dienst; die Änderung belässt das Anlegen der Pluralregeln beim Aufruf (Pitch, Fallen).
### Wem wir was glauben
- Keine neue Vertrauensannahme, weil die Hilfe weiter nur Werte aus dem eigenen Code und eine vom Server gezählte Zahl verarbeitet.
### Nicht-Ziele
- Diese Änderung schützt nicht gegen Inhalte in den Antworten selbst, die der Agent des Kunden an den Anruf übergibt, weil sie den Weg der Angaben in den Anruf nicht ändert; dafür gilt SG-11 in `docs/sicherheitsgrenzen.md`.

## 2. Angriffswege
Keine Angriffswege gefunden, weil die Änderung keinen neuen Eingang, keine neue Berechtigung, keine neue Datenquelle und keine neue Handlung schafft; sie verschiebt nur innerhalb eigenen Codes, welche Funktion eine vom Server gezählte Zahl in einen festen Satz setzt. Gesucht wurde je Beteiligtem über den einzigen berührten Eingang und rückwärts vom Ziel:
- Agent des Kunden: Er bestimmt nur, wie viele Antworten er schickt. Der Server prüft und begrenzt sie (`src/routes/api-calls.js:82-84`, `src/store/state-ops.js:666-670`) und gibt nur die gezählte Zahl zurück. Kein Text des Aufrufers erreicht die Sätze; dass die Sätze künftig die Zahl selbst einsetzen, öffnet keinen Platz für fremden Text, weil sie keine Platzhalter ersetzen und nur die Zahl als Parameter haben (Pitch, Fallen).
- Kunde: Die Kontosprache wählt nur die Tabelle, mit Rückfall auf die Standardsprache (`src/i18n/locales.js:406-408`); das Kürzel der Beugung bleibt das Literal der Tabelle (Pitch, Fallen).
- Angerufener: Seine Worte gehen weder in die Zahl noch in die Wahl der Tabelle noch in die Sätze ein.
- Rückwärts vom Ziel: Anrufe oder SMS auf unsere Kosten, fremde Daten, ein ungewollter Anruf oder Hermes als Werkzeug gegen Dritte setzen voraus, dass sich am Wählen, an den Gates, an der Mandantentrennung oder am Inhalt des Anrufs etwas ändert. Die Änderung berührt nichts davon.
- Stille Annahme 1, nur die Zahl geht in den Satz: Bekäme ein Satz beim Umbau einen weiteren Parameter, etwa eine Antwort des Agenten, stünde fremder Text in der Bestätigung an denselben Aufrufer. Das wäre eine Abweichung vom Pitch (Grobe Lösung: „beide als Funktion der Zahl“) und erreichte nur den Agenten, der den Text selbst geschickt hat; der einzige Aufruf übergibt nur `mergedFacts` (`src/mcp-tools.js:1018`).
- Stille Annahme 2, Zusammensetzen wandert in eine Fabrik (Pitch, PM1): eine Frage der Wortstellung späterer Sprachen, keine Sicherheitsfolge, weil die Ausgabe gleich bliebe.
- Stille Annahme 3, Sprache der Beugung und Zeitpunkt des Anlegens: unverändert gegenüber P-005 und dort ohne Sicherheitsfolge bewertet; der Pitch hält beides als Falle fest.

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1, H2, H3 | trifft nicht zu, weil die Änderung weder Anrufe noch SMS auslöst noch Verbrauch erzeugt; `answer_consult` wählt nicht und bleibt hinter denselben Prüfungen (`src/routes/mcp.js:89`, `src/mcp-tools.js:1006-1009`) |
| H4 | trifft nicht zu, weil der Satz nur die eigene, vom Server gezählte Zahl des Aufrufers enthält; die Mandantentrennung an der internen Route (SG-02) bleibt unberührt |
| H5, H13 | trifft nicht zu, weil die Änderung weder Tokens noch Schlüssel berührt |
| H6, H7 | trifft nicht zu, weil kein Gesagtes des Angerufenen in die Sätze eingeht und der Weg der Angaben in den Anruf gleich bleibt |
| H8 | trifft nicht zu, weil die Änderung weder Offenlegung noch KI-Kennzeichnung noch den Anrufinhalt berührt; kein Punkt für die rechtliche Prüfung |
| H9, H10, H11 | trifft nicht zu, weil die Änderung weder eingehende Anrufe, Webhooks noch ausgehende Aufrufe an Kundenadressen berührt |
| H12 | trifft nicht zu, weil keine Stimme, keine Worte und kein Transkript neu verarbeitet, gespeichert oder geloggt werden; der Audit-Eintrag mit der Zahl (`src/routes/api-calls.js:91-95`) bleibt gleich |
| H14 | trifft nicht zu, weil kein Paket, kein Anbieter und keine Werkzeugbeschreibung hinzukommt (Pitch, Nicht-Ziele); `Intl.PluralRules` wird schon heute genutzt (`src/i18n/mcp-texts.js:5`) |
| H15 | trifft nicht zu, weil die Änderung keinem Anbieter und dem Agenten des Kunden nichts Neues glaubt; siehe „Wem wir was glauben“ |
| STRIDE an geänderten Grenzen | keine neue oder geänderte Grenze; am berührten Eingang `answer_consult` ergibt keine Kategorie einen Weg, weil sich nur die innere Form der Antwort an denselben Aufrufer ändert und kein Wert des Aufrufers außer der vom Server gezählten Zahl den Satz erreicht |
| LINDDUN für die angerufene Person | trifft nicht zu, weil der Satz keine Angaben über die angerufene Person enthält und sie nicht erreicht |

## 4. Offene Fragen
keine

## 5. Vorschlag für docs/sicherheitsgrenzen.md
Keiner, weil keine neue Grenze, kein neuer Eingang und keine neue Vertrauensannahme entsteht; die Zeile für `answer_consult` in der Angriffsfläche (`docs/sicherheitsgrenzen.md:50`) bleibt gültig.

## 6. Gegenprüfung
| Nr. | Art | Bezug | Befund mit Beleg | Übernommen als |
|---|---|---|---|---|

Nichts gefunden, weil die Änderung keinen Eingang bietet, über den ein Angreifer etwas in den Satz bekäme, und die Sicherheitsprüfung keine Bedrohung mit Ausgang „verhindern“ führt, also kein Schutz zu umgehen und kein Szenario zu prüfen war; die Aussagen hinter „keine Angriffswege“ halten am Code (Stand 294e9cc): in den Satz geht nur die ganze Zahl aus `mergeContextFacts` (`src/store/state-ops.js:661-671`), die Route gibt sie unverändert zurück (`src/routes/api-calls.js:85-97`), das Werkzeug lässt nur den Typ Zahl durch (`src/mcp-tools.js:1016`), die Antworten des Agenten erreichen `consultAnswerAccepted` nicht (`src/mcp-tools.js:1009`, `:1018`), und `countedText` hat außer den drei Tabelleneinträgen keinen Aufrufer (`src/i18n/mcp-texts.js:4`, `:118`, `:225`, `:333`).
