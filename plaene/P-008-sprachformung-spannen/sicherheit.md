# P-008 Sprachformung erhält Zahlenspannen und Unterstriche: Sicherheitsprüfung

Status: freigegeben
Grundlage: pitch.md, design.md (hält nur die Ausgangslage fest, „Design Doc: nein“ im Pitch), fragerunden.md, Code-Stand 7f5f1cb

## Zur Freigabe
1. Die schwersten Angriffswege: T3 (eine rechenteure Spannenregel legt den ganzen Dienst für alle Kunden lahm, ausgelöst über das, was das Modell sagt) und T1 (eine Kartennummer des Gegenübers geht unmaskiert an den Agenten des Kunden, weil die Spannenregel Vierergruppen in eine gemischte Form bringt). Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden:
   1. T2: hinnehmen vorgeschlagen, weil das Modell Karten- oder Ausweisnummern laut Prompt Ziffer für Ziffer spricht (`src/i18n/prompts/de.js:29`), eine Schreibweise mit Unterstrich darin ungewöhnlich ist und ein Schutz entweder die Maskierung außerhalb dieser Änderung ändern oder R2 so eng fassen müsste, dass auch `grüß_gott_2` (S5) bricht. Empfehlung: hinnehmen. **Abgelehnt** (Freigabe 2026-10-24): die Begründung ist widerlegt (Gegenprüfung Nr. 1); T2 wird für Kartennummern „verhindern“ mit der Ziffer-Ziffer-Ausnahme in R2 (Pitch B10); hingenommen ist nur der Rest als T4.
   2. Ergänzung von R1 für T1: Eine Zahl, die über „ - “ an eine weitere Zahl grenzt (Kette aus drei oder mehr Zahlen), bildet keine Spanne; die Kette bleibt in der heutigen Form „…, …, …“. Braucht ein neues Szenario unter „Bleibt unverändert“ im Pitch. Empfehlung: ja, weil die Absicht „im Zweifel heutiges Verhalten“ verlangt und die Alternative (die ganze Kette mit Bindestrich) eine zusätzliche Regel wäre. **Angenommen** (Freigabe 2026-10-24), mit dem Trennzeichen aus Gegenprüfung Nr. 2 (Leerraum beliebiger Länge, Bindestrich, Leerraum beliebiger Länge); Szenarien im Pitch B8 und B9; das Szenario zu T1 wird als Tabellenzeile der Fachlogik geprüft.
   3. Zwei Einträge für `docs/sicherheitsgrenzen.md` (Abschnitt 5): Formung bleibt für die Maskierung erkennbar; Mustersuche auf modell- oder anrufer-beeinflusstem Text endet in begrenzter Zeit. Empfehlung: ja. **Angenommen** (Freigabe 2026-10-24): beide Einträge werden Teil der Änderung.

## 1. Woran arbeiten wir
### Umfang
Die Änderung liegt ganz in `shapedCore` (`src/speech-shape.js:1-10`): eine neue Regel für „Zahl - Zahl“ (R1) und eine Ausnahme vom Entfernen des Unterstrichs zwischen zwei Buchstaben oder Ziffern (R2), dazu ein verhaltensgleicher Umbau (Pitch, Grobe Lösung und Fallen). Eingabe ist ausschließlich Text des Sprachmodells: die ganze Antwort eines Gesprächszugs (`src/claude.js:673`), das Denk-Signal (`src/thinking-signal.js:10`) und das Streaming-Häppchen (`src/speech-chunker.js:33`); die beiden letzten schaltet heute kein Live-Aufrufer ein (`src/routes/voice.js:396`, Fragerunden Runde 2, Frage 6). Ausgabe geht an zwei Stellen: an die Sprachausgabe auf dem Telnyx-Weg (`src/routes/voice.js:284-288`) und als Agentenzeile ins Transkript (`src/claude.js:678`), das der Agent des Kunden über `get_call_status` liest (`src/mcp-tools.js:103-111`, `:1032-1065`). Die Rede des Gegenübers wird nicht geformt (`src/claude.js:457`), der Offenlegungssatz und die Begrüßung auch nicht (`src/routes/voice.js:69`, `:434-436`; `src/claude.js:224-233`). Der Hauptweg über ElevenLabs Agents ruft die Formung nicht auf (Pitch, Nicht-Ziele).
### Beteiligte
- Kunde: angemeldet; bestimmt über Auftrag und Briefing mit, was das Modell sagt; liest das Transkript seiner Anrufe.
- Agent des Kunden: ruft `get_call_status` mit dem Token des Kunden auf und bekommt die letzten Transkriptzeilen, maskiert durch `maskRestrictedText` (`src/mcp-tools.js:110`); gibt sie an seinen KI-Host weiter (angenommen).
- Angerufener: spricht auf dem Telnyx-Weg mit dem Modell und beeinflusst dessen Antwort; hört die geformte Antwort.
- Anrufer bei eingehenden Anrufen: erreicht denselben Weg ohne jedes Konto, sobald eine Nummer auf den Budget-Weg fällt (`src/elevenlabs/inbound-path-decision.js:78`, `:81`; `src/routes/voice.js:66-71`, `:92`).
- Anbieter: das Sprachmodell (Ausgabe bis 300 Token je Zug, `src/claude.js:395`, `:434`, `:547`); Telnyx mit Azure-Stimmen über `<Say>` (`src/telephony/adapters/telnyx/render.js:13-17`, `:47-49`); ElevenLabs-Sprachsynthese (`src/tts/synth.js:54`). Stripe und WorkOS sind nicht beteiligt.
- Betreiber: kein Schalter, keine Einstellung; Rückweg ist ein Code-Rollback (Pitch, Kopf).
### Eingänge und Grenzen
Keine neue Grenze. Die Änderung verändert die Form des Texts an bestehenden Verbindungen:
- Telnyx-Webhook `POST /voice/turn` und `POST /voice/incoming` (Gesagtes des Gegenübers per STT zum Modell): signiert (`src/routes/voice.js:310-325`, SG-05). Beleg: `src/routes/voice.js:389-396`. Angriffswege: T3 (über die Antwort, die das Gesagte beim Modell auslöst); das Gesagte selbst läuft nicht durch die Formung (`src/claude.js:457`).
- Modellausgabe zu Hermes: der einzige Eingang der Formung. Beleg: `src/claude.js:673`. Angriffswege: T1, T2, T3, T4.
- Hermes zu Telnyx (TeXML `<Say>` und Ansage in `<Gather>`): Beleg: `src/telephony/voice-render.js:10-19`, `src/telephony/adapters/telnyx/render.js:47-49`, `:70-74`. Angriffswege: keiner, weil der Text vollständig XML-maskiert wird (`render.js:19-29`) und weder Bindestrich noch Unterstrich darin eine Bedeutung haben.
- Hermes zu ElevenLabs-Sprachsynthese: Beleg: `src/tts/synth.js:54`. Angriffswege: keiner, weil der Text als Datenfeld in JSON geht.
- Transkript zu `get_call_status` an den Agenten des Kunden (Hermes nach außen, angemeldet, nur eigener Mandant): Beleg: `src/claude.js:678`, `src/mcp-tools.js:103-111`, `:1032-1065`. Angriffswege: T1, T2, T4.
- Transkript zur Zusammenfassung durch das Modell und `get_call_result`: Beleg: `src/claude.js:700-709`, `src/mcp-tools.js:125-134`. Angriffswege: T1 (gleicher Weg, wenn die Zusammenfassung die Nummer übernimmt); sonst keiner, weil die Zusammenfassung das ungeformte Gesagte des Gegenübers schon heute sieht.
- Transkript im Dashboard und im Export (`GET /api/calls/:id`, `GET /api/tenant-data/export`): Angriffswege: keiner, weil dort nur der eigene Mandant liest (SG-02) und die Gegenüber-Zeile dieselben Angaben schon heute ungeformt enthält (`src/claude.js:457`).
- Logs: Angriffswege: keiner, weil der geformte Text nicht geloggt wird (Suche nach Log-Aufrufen mit dem Antworttext in `src/`: keine Treffer; geloggt wird die Länge, `src/routes/voice.js:390`).
### Werte
- Verfügbarkeit: ein Prozess bedient Telefonie-Webhooks, Dashboard und MCP für alle Mandanten (CLAUDE.md, Befehle: `npm start`; `render.yaml:6`); eine einzelne Formung, die nicht endet, hält alle laufenden Anrufe an.
- Zahlungskarten- und Ausweisnummern des Gegenübers: dürfen den Agenten des Kunden nur maskiert erreichen (SG-13; `src/mcp-tools.js:110`, `src/restricted-data.js:400-410`).
- Richtige Angaben am Telefon (Öffnungszeiten, Adressen): ein Qualitätswert; die verbleibenden Fehlformen hat der Pitch entschieden (Premortem 1, 3, 5, 7).
### Wem wir was glauben
- Sprachmodell: wir glauben, dass eine Antwort höchstens 300 Token lang ist (`src/claude.js:395`); wenn nicht, wächst die Rechenzeit jeder Formung mit, was T3 verschärft.
- Maskierung `src/restricted-data.js`: wir glauben, dass sie Kartennummern in den Formen erkennt, die die Formung erzeugt. Sie erkennt Gruppen nur mit einheitlichem Trennzeichen (`:112-114`, `:142-148`) und nur Leerzeichen, Bindestrich, Punkt oder Komma als Trennzeichen (`:35`); wenn die Formung eine neue Form erzeugt, fällt die Maskierung still aus (T1, T2, T4).
### Nicht-Ziele
- Diese Änderung schützt nicht gegen ein Modell, das Angaben des Kunden oder des Gegenübers ausspricht, die es nicht nennen soll, weil das die Promptregel (`src/i18n/prompts/de.js:54`) und SG-11 betrifft; dass die heutige Formung Unterstriche zufällig verstümmelt, war kein Schutz.

## 2. Angriffswege
### T1: Eine Kartennummer, die das Modell in Vierergruppen mit „ - “ wiederholt, erreicht den Agenten des Kunden unmaskiert
Wer: kein Angreifer nötig; das Modell auf dem Telnyx-Weg wiederholt eine Kartennummer, die der Angerufene oder Anrufer genannt hat. Ein Kunde kann es über seinen Auftrag begünstigen (angenommen).
Weg: Das Modell schreibt vier Vierergruppen, getrennt durch „ - “. Heute macht die Formung daraus „…, …, …, …“ (`src/speech-shape.js:6`), also ein einheitliches Trennzeichen, und `maskRestrictedText` maskiert die Zeile in `get_call_status` (`src/restricted-data.js:35`, `:112-114`, `:142-148`; `src/mcp-tools.js:110`). R1 prüft nur, ob eine Zahl durch Leerraum an eine weitere Zahl grenzt (Pitch, R1 und Fallen); in einer Kette grenzt sie über „ - “, also bilden die erste und zweite sowie die dritte und vierte Gruppe je eine Spanne, und der mittlere Strich wird zum Komma. Es entsteht eine Mischung aus Bindestrich und Komma. Die Maskierung verwirft gemischte Trennzeichen (`:113`) und findet in Teilfenstern höchstens acht Ziffern (`:150-159`, Mindestzahl 13, `:18`). Die Zeile geht unmaskiert an den Agenten des Kunden; übernimmt die Zusammenfassung die Nummer, gilt dasselbe für `get_call_result` (`src/mcp-tools.js:130`).
Schaden: Die Kartennummer einer dritten Person steht im Klartext beim Agenten des Kunden und damit beim KI-Host des Kunden, obwohl Hermes genau diese Ausgabe für Zahlungskarten maskiert.
Ausgang: verhindern, weil die Maskierung heute für diese Form greift und erst die neue Regel sie aushebelt; der Schutz ist die Kettenbedingung in R1 (Zur Freigabe 3.2, angenommen) mit dem Trennzeichen aus Gegenprüfung Nr. 2. Geprüft als Tabellenzeile der Fachlogik (Freigabe 2026-10-24), weil für `get_call_status` keine Modell-Attrappe einen gewählten Antworttext liefert; dass die Maskierung die Kommaform „4111, 1111, 1111, 1111“ als „****1111“ ausgibt, ist am master 7f5f1cb gemessen. Gleich Pitch B8, ungleicher Leerraum Pitch B9.
Szenario:
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Ich wiederhole Ihre Kartennummer: 4111 - 1111 - 1111 - 1111“ gibt (Luhn-gültige Beispielnummer)
Dann geht an die Sprachausgabe der Text „Ich wiederhole Ihre Kartennummer: 4111, 1111, 1111, 1111.“

### T2: Ein Unterstrich innerhalb einer Kartennummer bleibt stehen, und die Maskierung erkennt die Nummer nicht mehr
Wer: kein Angreifer nötig; das Modell schreibt eine solche Nummer mit Unterstrichen.
Weg: Heute entfernt die Formung jeden Unterstrich (`src/speech-shape.js:5`), die Ziffern stehen zusammen und werden maskiert. Mit R2 in der ersten Fassung bliebe der Unterstrich zwischen Ziffern stehen. Die Maskierung kennt den Unterstrich nicht als Trennzeichen in Kartennummern (`src/restricted-data.js:35`); am master 7f5f1cb gemessen: „Karte 4111_1111_1111_1111.“ bleibt unmaskiert, die heutige geformte Fassung „Karte 4111111111111111.“ wird „Karte ****1111.“
Schaden: wie T1, für Kartennummern, die das Modell mit Unterstrichen schreibt.
Ausgang: verhindern, weil in einer Kartennummer der Unterstrich immer zwischen zwei Ziffern steht und eine Ziffer-Ziffer-Ausnahme in R2 S4 und S5 nicht berührt (Gegenprüfung Nr. 1, Freigabe 2026-10-24). Gleich Pitch B10.
Szenario:
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Karte 4111_1111_1111_1111“ gibt
Dann geht an die Sprachausgabe der Text „Karte 4111111111111111.“

### T3: Die neue Spannenregel rechnet auf einer langen Ziffernfolge so lange, dass der Prozess für alle Kunden stillsteht
Wer: Anrufer bei eingehenden Anrufen auf dem Budget-Weg (ohne Konto, `src/elevenlabs/inbound-path-decision.js:78`, `:81`), Angerufener auf dem Telnyx-Weg oder Kunde über seinen Auftrag; jeder, der das Modell dazu bringt, eine lange Ziffernfolge auszugeben.
Weg: Die Modellantwort (bis 300 Token, `src/claude.js:395`) geht ungeprüft in die Formung (`src/claude.js:673`). R1 verlangt, Zahlen mit optionalem Punkt oder Doppelpunkt zwischen Ziffern zu erkennen und vor und hinter der Zahl auf Leerraum und weitere Ziffern zu schauen (Pitch, Fallen). Eine naheliegende Umsetzung mit verschachtelten Wiederholungen versucht bei einem Fehlschlag hinter einer langen Ziffernfolge exponentiell viele Zerlegungen. Die Mustersuche läuft im einzigen Prozess und lässt sich nicht unterbrechen (angenommen, Verhalten von Node ohne Sonderschalter). Die Semgrep-Regel gegen solche Muster prüft nur `test`, `match` und `new RegExp`, nicht `replace` (`tools/basis/semgrep-regeln.json:12632-12694`), würde eine solche Umsetzung in `shapedCore` also nicht melden. Die heutige Formung hat keine verschachtelte Wiederholung (`src/speech-shape.js:4-8`).
Schaden: Solange die Formung rechnet, beantwortet Hermes keine Telnyx-Webhooks, keine MCP-Aufrufe und kein Dashboard, für alle Mandanten; laufende Anrufe aller Kunden brechen ab oder hängen, der Zeitgeber für die Höchstdauer läuft im selben Prozess (`src/routes/voice.js:364`, angenommen als Zeitgeber im Prozess). Jeder neue Anruf kann das wiederholen.
Ausgang: verhindern, weil eine lineare Umsetzung der Regel genügt und die bestehende statische Prüfung diese Stelle nicht abdeckt.
Szenario:
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Nummer “, dann 500 Ziffern ohne Trennzeichen, dann „ - Uhr“ gibt
Dann geht die geformte Antwort nach weniger als einer Sekunde an die Sprachausgabe
Gegeben ein Anruf auf dem Telnyx-Rückfallweg
Wenn das Sprachmodell die Antwort „Nummer “, dann 250 Ziffern mit je einem Punkt oder Doppelpunkt dazwischen, dann „ - Uhr“ gibt
Dann geht die geformte Antwort nach weniger als einer Sekunde an die Sprachausgabe

### T4: Ein Unterstrich mit einem Buchstaben daneben bleibt in einer Ausweisnummer stehen, und die Maskierung erkennt die Nummer nicht mehr
Wer: kein Angreifer nötig; das Modell schreibt eine Ausweisnummer mit Unterstrich, an dem ein Buchstabe steht.
Weg: Mit R2 bleibt ein Unterstrich zwischen Buchstabe und Ziffer oder zwischen zwei Buchstaben stehen (Pitch, R2). Die Maskierung kennt den Unterstrich nicht als Trennzeichen in Ausweisnummern (`src/restricted-data.js:256-263`).
Schaden: Eine so geschriebene Ausweisnummer erreicht den Agenten des Kunden unmaskiert.
Ausgang: hinnehmen (Freigabe 2026-10-24), weil der Prompt Codes Ziffer für Ziffer verlangt (`src/i18n/prompts/de.js:29`, `en.js:53`, `fr.js:29`), solche Schreibweisen in Modellausgaben ungewöhnlich sind und sich ein Schutz in der Formung ohne Wortwissen nicht von `grüß_gott_2` (S5) unterscheiden lässt. Offen bleibt: eine vom Modell mit Unterstrich neben einem Buchstaben geschriebene Ausweisnummer wird in `get_call_status` nicht maskiert.

Weitere Suche ohne Angriffsweg:
- Unterstrich und Bindestrich in TeXML oder Sprachsynthese: keiner, weil der Text XML-maskiert (`src/telephony/adapters/telnyx/render.js:27-29`) bzw. als JSON-Feld (`src/tts/synth.js:54`) übergeben wird.
- Ungewollter Anruf, SMS, Werkzeugaufruf: keiner, weil die Formung erst nach der Werkzeugschleife läuft (`src/claude.js:607-643` vor `:673`) und nichts auf den geformten Text hin entscheidet.
- Offenlegung und KI-Kennzeichnung: keiner, weil Eröffnung und Begrüßung nicht durch die Formung laufen (`src/routes/voice.js:69`, `:434-436`).
- Hermes gegen Dritte (etwa eine Adresse mit Unterstrich, die der Kunde sprechen lässt): keiner neu, weil der Kunde den Inhalt schon heute bestimmt; das Verstümmeln war kein Schutz.
- Falsche Rückrufnummer durch „030 - 123456“ → „030-123456“: im Pitch als Premortem 1 entschieden; keine neue Folge für Dritte über das Hören hinaus.
- Log-Maskierung: keine Verschlechterung, weil der geformte Text nicht geloggt wird; für Text in Logs würde die Bindestrich-Form von `maskNumbersInText` eher erkannt (`src/util.js:23`) und die E-Mail-Erkennung schließt den Unterstrich ein (`src/log-maske.js:9`).
- Mandantentrennung: keiner, weil die Transkriptzeilen weiter nur über die Kennung des eigenen Anrufs lesbar sind (SG-02, unverändert).

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1, H2, H11 | trifft nicht zu, weil die Formung weder Anrufe noch SMS auslöst noch Ziele oder Adressen bestimmt; sie läuft nach der Werkzeugschleife (`src/claude.js:607-673`) |
| H3 | trifft zu → T3 (Rechenzeit ohne Grenze je Formung); Minuten und Sprachsynthese wachsen nicht, weil die Antwort auf 300 Token begrenzt bleibt (`src/claude.js:395`) und Spanne bzw. Unterstrich die Länge nur um wenige Zeichen ändern |
| H4 | trifft nicht zu, weil die geformte Zeile im Transkript des eigenen Anrufs liegt und nur darüber gelesen wird (SG-02 unverändert) |
| H5, H13, H14 | trifft nicht zu, weil die Änderung weder Tokens, Schlüssel, Pakete, Anbieter noch Werkzeugbeschreibungen berührt (Pitch, Nicht-Ziele) |
| H6 | trifft nicht zu, weil keine Handlung vom geformten Text abhängt (`src/claude.js:673-686`) |
| H7 | trifft zu → T1, T2, T4: die Agentenzeile bleibt als solche gekennzeichnet (`src/mcp-tools.js:110`), aber die Maskierung des Inhalts kann ausfallen |
| H8 | trifft nicht zu, weil Offenlegungssatz und KI-Kennzeichnung nicht durch die Formung laufen (`src/routes/voice.js:434-436`, `src/claude.js:224-233`); kein Punkt für die rechtliche Prüfung |
| H9, H10 | trifft nicht zu, weil die Änderung weder Anrufernummern noch Webhook-Prüfung oder Ereignisreihenfolge berührt |
| H12 | trifft zu → T1, T2, T4; sonst keine Änderung, weil keine Stimme und keine neuen Worte gespeichert werden und die Gegenüber-Zeile ungeformt bleibt (`src/claude.js:457`); kein Punkt für die rechtliche Prüfung |
| H15 | siehe „Wem wir was glauben“: Längendeckel des Modells (T3) und Erkennungsformen der Maskierung (T1, T2, T4); Telnyx und ElevenLabs bekommen den Text als Daten |
| STRIDE an der Verbindung Modellausgabe → Formung → Sprachausgabe und Transkript | Information Disclosure → T1, T2, T4; Denial of Service → T3; Spoofing, Tampering, Repudiation und Elevation of Privilege ohne Weg, weil die Formung keine Identität trägt, keine Entscheidung trifft und das Gegenüber den Modelltext schon heute beeinflusst |
| LINDDUN für die angerufene Person | Disclosure → T1, T2, T4 (Karten- oder Ausweisnummer der angerufenen Person); Linking, Identifying, Non-repudiation, Detecting, Unawareness und Non-compliance trifft nicht zu, weil keine neuen Angaben erhoben, gespeichert oder weitergegeben werden und die Gegenüber-Zeile unverändert bleibt |

## 4. Offene Fragen
- Angenommen: ein einziger Node-Prozess bedient alle Mandanten, und eine laufende Mustersuche wird nicht abgebrochen. Ändert: T3 (Schaden auf einen Teil der Anrufe begrenzt, wenn mehrere Instanzen laufen). Prüfen durch: Instanzzahl im Render-Dashboard und Startbefehl in `package.json` auf Node-Schalter für die Mustersuche ansehen.
- (Mit der Kettenbedingung in R1 für den Ausgang von T1 nicht mehr entscheidend, Freigabe 2026-10-24.) Angenommen: das Modell wiederholt auf dem Telnyx-Weg Kartennummern auch in Vierergruppen mit „ - “, obwohl der Prompt Ziffer für Ziffer verlangt (`src/i18n/prompts/de.js:29`). Ändert: T1 (bei „nie“ wäre hinnehmen vertretbar). Prüfen durch: Bench-Lauf mit erfundener Beispielnummer, ohne Produktionsdaten.
- (Entschieden, Freigabe 2026-10-24: T1 wird als Tabellenzeile der Fachlogik geprüft.) Angenommen: der Weg über `get_call_status` hat keine Modell-Attrappe, die einen gewählten Antworttext liefert (Fragerunden Runde 1, Frage 8: Lücke Q5 aus P-007). Ändert: Form des Szenarios zu T1 (Eingang oder Tabellenzeile). Prüfen durch: die Attrappe in den Testhilfen unter `test/` ansehen.

## 5. Vorschlag für docs/sicherheitsgrenzen.md
Beide Einträge angenommen (Freigabe 2026-10-24); sie werden Teil der Änderung.
- Neue Vertrauensannahme zu SG-13: Was die Sprachformung (`src/speech-shape.js`) aus Ziffernfolgen macht, erkennt die Maskierung (`src/restricted-data.js`) weiterhin; die Formung erzeugt keine Trennzeichen-Mischung, die die Maskierung verwirft. Negativtest: Szenarien zu T1 und T2 (Pitch B8, B9, B10).
- Neue Katalogzeile SG-27 (SG-26 ist für P-001 vorgesehen; ist SG-27 beim Bau vergeben, nimmt die Zeile die nächste freie Kennung): Angriff: Text, den ein Anrufer über das Modell beeinflusst, legt den Prozess durch eine rechenteure Mustersuche lahm. Verletzte Grenze: Verarbeitung fremd beeinflussten Texts endet in begrenzter Zeit. Mechanismus: Längendeckel der Modellantwort (`src/claude.js:395`) und Muster ohne verschachtelte Wiederholung in `src/speech-shape.js`; die Semgrep-Regel `detect-redos` deckt `replace` nicht ab. Negativtest: Szenarien zu T3; der Testname beginnt mit „SG-27 “ (`tools/katalog-pruefen.mjs:24`, `:110`).

## 6. Gegenprüfung
| Nr. | Art | Bezug | Befund mit Beleg | Übernommen als |
|---|---|---|---|---|
| 1 | widerlegt | T2, Begründung für „hinnehmen“ (Zur Freigabe 3.1) | Ein Schutz für Kartennummern bricht S4 und S5 nicht: dort steht der Unterstrich zwischen zwei Buchstaben bzw. Buchstabe und Ziffer, bei Kartennummern zwischen zwei Ziffern. Heute fällt er weg (`src/speech-shape.js:5`), und die 16 Ziffern werden maskiert (`src/restricted-data.js:33`, `:35`, `:109`, `:122`); bleibt er stehen, passt die Nummer nicht mehr auf `CARD_CANDIDATE` (Trennzeichen nur `[ -]`, `[.,] ?`). Am master 7f5f1cb gemessen: „Karte 4111_1111_1111_1111.“ bleibt ungeformt unmaskiert, geformt heute „Karte ****1111.“ | angenommen: R2 mit Ziffer-Ziffer-Ausnahme, T2 „verhindern“ (Pitch B10), Rest als T4 hingenommen |
| 2 | Schutz umgangen | T1, Ergänzung von R1 (Zur Freigabe 3.2) | Die Kettenregel „grenzt über ‚ - ‘ an eine weitere Zahl“ lässt eine Umsetzung zu, die nur das wörtliche „ - “ prüft; dann wird „4111 - 1111  -  1111 - 1111“ (doppelter Leerraum am mittleren Strich) zu „4111-1111, 1111-1111“, das die Maskierung verwirft (`src/restricted-data.js:113`, `:150-159`, `:18`). Heute: „Kartennummer: 4111, 1111, 1111, 1111.“ (`src/speech-shape.js:6`, `\s+-\s+`), maskiert. | angenommen: Trennzeichen der Kette = Trennzeichen von R1 (Pitch, Fallen), zusätzliches Szenario Pitch B9 |
