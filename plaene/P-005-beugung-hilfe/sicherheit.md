# P-005 Gemeinsame Beugungs-Hilfe für die Bestätigung von answer_consult: Sicherheitsprüfung

Status: freigegeben
Grundlage: pitch.md, design.md (hält nur die Ausgangslage fest, „Design Doc: nein“ im Pitch), Code-Stand 2728a10

## Zur Freigabe
1. Die schwersten Angriffswege: keine, siehe Angriffswege. Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden: nichts, weil die Änderung keine Bedrohung öffnet und damit kein Ausgang zu wählen ist.

## 1. Woran arbeiten wir
### Umfang
Die drei Textfunktionen `consultAnswerAccepted` der deutschen, englischen und französischen MCP-Tabelle (`src/i18n/mcp-texts.js:114-117`, `:224-227`, `:335-338`) rufen künftig eine neue, nicht exportierte Hilfe in derselben Datei auf, statt die Wahl zwischen Einzahl und Mehrzahl selbst auszuschreiben (Pitch, Grobe Lösung und Fallen). Der ausgegebene Wortlaut soll byte-gleich bleiben (Pitch, Absicht). Einziger Aufrufer ist das Werkzeug `answer_consult` mit `status` `"final"` (`src/mcp-tools.js:1016-1019`; eine Suche nach `consultAnswerAccepted` in `src/` findet keine weitere Stelle). Werkzeugvertrag, strukturierte Antwort, interne Route, Anrufe, SMS, Kosten und Transkripte bleiben unberührt (Pitch, Nicht-Ziele).

Diese Prüfung baut auf `plaene/P-004-angaben-zahl/sicherheit.md` auf, die dieselben drei Funktionen für die Einführung der Beugung geprüft hat und keinen Angriffsweg fand. Neu an P-005 ist nur die Struktur: eine gemeinsame Hilfe mit dem Sprachkürzel als Eingabe.
### Beteiligte
- Kunde: angemeldet; wählt seine Kontosprache. Sie bestimmt nur, welche der drei Tabellen gilt (`src/routes/mcp.js:95`, `src/i18n/locales.js:406-408`), nicht das Sprachkürzel der Beugung; das steht als Literal in der Tabelle (design.md, Ausgangslage; Pitch, Fallen).
- Agent des Kunden: ruft `answer_consult` über `POST /mcp` mit dem Token des Kunden auf (`src/routes/mcp.js:89`) und bestimmt die Zahl der Antworten; er ist der einzige Empfänger des Satzes (`src/mcp-tools.js:1018`).
- Angerufener: erreicht den Satz nicht; bei ihm kommen nur die angenommenen Angaben selbst an (`src/store/state-ops.js:661-671`), und deren Weg ändert sich nicht.
- Anrufer bei eingehenden Anrufen: nicht beteiligt, weil `answer_consult` nur bei Rückfragen in laufenden Anrufen des Kunden wirkt und die Änderung keinen eingehenden Pfad berührt (angenommen, wie in P-004).
- Anbieter (Telnyx, ElevenLabs, Stripe, WorkOS): nicht beteiligt.
- Betreiber: nicht beteiligt; die Änderung bringt keine Einstellung und keinen Schalter.
### Eingänge und Grenzen
- MCP-Werkzeug `answer_consult` über `POST /mcp`: vom Agenten des Kunden nach Hermes, angemeldet. Beleg: `src/routes/mcp.js:89-95`, `src/mcp-tools.js:982-1029`. Angriffswege: keiner, weil in die neue Hilfe nur drei Dinge eingehen, von denen keines vom Aufrufer als freier Wert kommt: das feste Sprachkürzel der Tabelle (Pitch, Fallen), die beiden Sätze der Tabelle als Funktionen der Zahl (Pitch, Grobe Lösung) und die Zahl `merged_facts`, die der Server selbst zählt (`src/routes/api-calls.js:85-97`, `src/store/state-ops.js:661-671`: nicht negative ganze Zahl bis höchstens `KEY_FACTS_LIMITS.maxItems`). Die Hilfe ersetzt keine Platzhalter und setzt keinen Text des Aufrufers ein (Pitch, Fallen).
- Interne Route `POST /api/calls/:id/consult/answer`: vom MCP-Werkzeug zur REST-API im eigenen Prozess. Beleg: `src/routes/api-calls.js:81-97`. Angriffswege: keiner, weil die Änderung die Route nicht berührt.
- Laden der Datei beim Start: `src/i18n/mcp-texts.js` wird von `src/i18n/locales.js:6`, `src/mcp-tools.js:21` und `src/mcp-no-tenant.js:3` importiert. Angriffswege: keiner, weil die Hilfe das Objekt `Intl.PluralRules` erst beim Aufruf anlegt (Pitch, Fallen und PM1) und das Kürzel ein Literal im Code ist, das kein Beteiligter von außen setzt.

Keine neue Grenze; angesehen wurden der Weg vom Agenten des Kunden über `/mcp` zur internen Route und zurück, der Weg der Angaben in den laufenden Anruf und das Laden der Textdatei beim Start.
### Werte
- Ein verständlicher Satz für den Agenten des Kunden: ein Qualitätswert, kein Sicherheitswert (wie in P-004).
- Die strukturierte Antwort (`accepted`, `merged_facts`): fremde Clients lesen sie; sie entsteht unabhängig vom Text (`src/mcp-tools.js:1019`) und bleibt gleich.
- Die Verfügbarkeit des Dienstes: Die Textdatei wird beim Start geladen; ein Fehler beim Laden träfe den ganzen Dienst (PM1). Die Änderung schützt diesen Wert, indem sie das Anlegen beim Aufruf belässt.
### Wem wir was glauben
- Keine neue Vertrauensannahme, weil die Hilfe nur Werte aus dem eigenen Code und eine vom Server gezählte Zahl verarbeitet. Dass `Intl.PluralRules` für `de`, `en` und `fr` beim Anlegen nicht wirft, gehört zur Laufzeit von Node und ist nachgemessen (design.md, Ausgangslage).
### Nicht-Ziele
- Diese Änderung schützt nicht gegen Inhalte in den Antworten selbst, die der Agent des Kunden an den Anruf übergibt, weil sie den Weg der Angaben in den Anruf nicht ändert; dafür gilt SG-11 in `docs/sicherheitsgrenzen.md`.

## 2. Angriffswege
Keine Angriffswege gefunden, weil die Änderung keinen neuen Eingang, keine neue Berechtigung, keine neue Datenquelle und keine neue Handlung schafft. Gesucht wurde je Beteiligtem über den einzigen berührten Eingang und rückwärts vom Ziel:
- Agent des Kunden: Er bestimmt nur die Zahl der Antworten. Der Server prüft und begrenzt sie (`src/routes/api-calls.js:82-84`, `src/store/state-ops.js:666-670`) und gibt nur die gezählte Zahl zurück. Kein eigener Text des Aufrufers erreicht die Hilfe, also kann er über sie nichts in seine eigene oder eine fremde Antwort schreiben.
- Kunde: Die Kontosprache wählt nur die Tabelle, mit Rückfall auf Englisch für Sprachen ohne Tabelle (`src/i18n/locales.js:406-408`). Das Kürzel, mit dem die Hilfe `Intl.PluralRules` anlegt, ist das Literal der gewählten Tabelle (Pitch, Fallen). Der Kunde kann der Hilfe also kein Kürzel unterschieben, das beim Anlegen wirft.
- Angerufener: Seine Worte gehen weder in die Zahl noch in die Wahl der Tabelle noch in die Sätze ein.
- Rückwärts vom Ziel: Anrufe oder SMS auf unsere Kosten, fremde Daten, ein ungewollter Anruf oder Hermes als Werkzeug gegen Dritte setzen voraus, dass sich am Wählen, an den Gates, an der Mandantentrennung oder am Inhalt des Anrufs etwas ändert. Die Änderung berührt nichts davon.
- Stille Annahme 1, Sprache der Beugung: Würde die Hilfe beim Umbau die Kontosprache statt des Tabellenkürzels bekommen, entstünde ein grammatisch falscher Satz, aber keine Sicherheitsfolge, weil die Kontosprache nur aus der festen Liste kommt und beim Aufruf, nicht beim Laden, ausgewertet würde (Pitch, Fallen; P-004, Angriffswege).
- Stille Annahme 2, Zeitpunkt des Anlegens: Legte die Hilfe das Objekt beim Laden an, verlagerte ein fehlerhaftes Kürzel einer künftigen Tabelle den Fehler in den Start des Dienstes (PM1). Das ist ein Betriebsrisiko durch eigenen Code, kein Weg, den ein Beteiligter von außen auslösen kann; der Pitch schließt es als Nicht-Ziel aus.
- Stille Annahme 3, Zahl der Formen: Eine künftige Sprache mit mehr als zwei Pluralformen bekäme einen falsch gebeugten Satz (PM2). Das betrifft nur die Grammatik einer Antwort an den Aufrufer selbst und ist im Pitch als Nicht-Ziel festgehalten.

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1, H2, H3 | trifft nicht zu, weil die Änderung weder Anrufe noch SMS auslöst noch Verbrauch erzeugt; `answer_consult` wählt nicht und bleibt hinter denselben Prüfungen (`src/routes/mcp.js:89`, `src/mcp-tools.js:1006-1009`) |
| H4 | trifft nicht zu, weil der Satz nur die eigene, vom Server gezählte Zahl des Aufrufers enthält; die Mandantentrennung an der internen Route (SG-02) bleibt unberührt |
| H5, H13 | trifft nicht zu, weil die Änderung weder Tokens noch Schlüssel berührt |
| H6, H7 | trifft nicht zu, weil kein Gesagtes des Angerufenen in die Hilfe eingeht und der Weg der Angaben in den Anruf gleich bleibt |
| H8 | trifft nicht zu, weil die Änderung weder Offenlegung noch KI-Kennzeichnung noch den Anrufinhalt berührt; kein Punkt für die rechtliche Prüfung |
| H9, H10, H11 | trifft nicht zu, weil die Änderung weder eingehende Anrufe, Webhooks noch ausgehende Aufrufe an Kundenadressen berührt |
| H12 | trifft nicht zu, weil keine Stimme, keine Worte und kein Transkript neu verarbeitet, gespeichert oder geloggt werden; der Audit-Eintrag mit der Zahl (`src/routes/api-calls.js:91-95`) bleibt gleich |
| H14 | trifft nicht zu, weil `Intl.PluralRules` schon heute genutzt wird und zur Laufzeit von Node gehört, kein neues Paket kommt, die Hilfe nicht exportiert wird (Pitch, Fallen) und sich keine Werkzeugbeschreibung ändert (Pitch, Nicht-Ziele) |
| H15 | trifft nicht zu, weil die Änderung keinem Anbieter und dem Agenten des Kunden nichts Neues glaubt; siehe „Wem wir was glauben“ |
| STRIDE an geänderten Grenzen | keine neue oder geänderte Grenze; am berührten Eingang `answer_consult` ergibt keine Kategorie einen Weg, weil sich nur die innere Struktur der Antwort an denselben Aufrufer ändert. Denial of Service eigens angesehen: Ein Fehler beim Anlegen der Pluralregeln bliebe auf diese eine Meldung beschränkt, weil das Anlegen beim Aufruf bleibt (Pitch, PM1), und das Kürzel kommt nicht von außen |
| LINDDUN für die angerufene Person | trifft nicht zu, weil der Satz keine Angaben über die angerufene Person enthält und sie nicht erreicht |

## 4. Offene Fragen
keine

## 5. Vorschlag für docs/sicherheitsgrenzen.md
Keiner, weil keine neue Grenze, kein neuer Eingang und keine neue Vertrauensannahme entsteht; die Zeile für `answer_consult` in der Angriffsfläche (`docs/sicherheitsgrenzen.md:50`) bleibt gültig.

## 6. Gegenprüfung
| Nr. | Art | Bezug | Befund mit Beleg | Übernommen als |
|---|---|---|---|---|

Nichts gefunden, weil die Sicherheitsprüfung keine Bedrohung mit Ausgang „verhindern“ und der Pitch kein Szenario nennt, also kein Schutz anzugreifen und kein Test zu prüfen war; die Annahmen hinter „keine Angriffswege“ halten am Code (Stand 2728a10): `consultAnswerAccepted` hat genau eine Aufrufstelle (`src/mcp-tools.js:1018`), die Zahl ist das vom Server gezählte `merged_facts` (`src/mcp-tools.js:1016`, `src/store/state-ops.js:661-671`, `:701-706`, `src/routes/api-calls.js:85-97`), die Antworten des Agenten gehen nicht in den Satz ein, und das Sprachkürzel steht fest in jeder Tabelle (`src/i18n/mcp-texts.js:115`, `:225`, `:336`), während die Kontosprache nur die Tabelle wählt (`src/i18n/locales.js:406-408`).
