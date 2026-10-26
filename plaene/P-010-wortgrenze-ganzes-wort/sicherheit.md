# P-010 Kürzen an der Wortgrenze behält das letzte ganze Wort: Sicherheitsprüfung

Status: freigegeben
Grundlage: pitch.md, design.md (nur „Ausgangslage und Annahmen“, Design Doc: nein), fragerunden.md, Code-Stand ae362d2

## Zur Freigabe
1. Die schwersten Angriffswege, höchstens drei: T1 (kleiner Schaden) und T2 (vertraulich, offen). Die Änderung öffnet keinen Eingang und keine Handlung. Sie ändert die eine Hilfe, über die sechs Ausgänge ihre Längengrenze einhalten (`src/utils/text.js:1-6`). T1 ist das Risiko, dass genau diese Grenze an der neuen Stelle bricht. Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden:
   1. T2: vertraulich, offen; Entscheidung bei der Betreuung. Angenommen: übertragen an die Betreuung.

## 1. Woran arbeiten wir
### Umfang
Geändert wird nur `clampAtWordBoundary` in `src/utils/text.js:1-6`: Steht direkt hinter der Grenze ein `" "`, bleibt das Wort davor stehen; sonst bleibt alles wie heute (Pitch, Grobe Lösung; design.md, Zeile zu `lastIndexOf(" ", maxChars)`). Die Hilfe hat sechs Aufrufstellen (`src/claude.js:248`, `src/thinking-signal.js:10`, `src/call-memory.js:21`, `src/research/lookup-guard.js:35` und `:45`, `src/consult/question.js:16`; per Suche nach dem Namen in `src/` am Code-Stand bestätigt). Grenzen, Aufrufer, Werkzeuge, Routen und gespeicherte Formate bleiben gleich (Pitch, Fallen und Nicht-Ziele). Das Ergebnis ist weiter ein Anfang des Eingabetexts. Es ist nie länger als die Grenze und nie kürzer als heute (design.md, nachgestellt).

### Beteiligte
- Kunde: angemeldeter Mandant. Er schreibt das Ziel eines Anrufs und bestätigt es in der Hermes-Karte (`src/mcp-tools.js:872-927`). Er bekommt Rückfragen über `await_call_event` (`src/mcp-tools.js:176-188`) und sieht nur eigene Anrufe (SG-02).
- Agent des Kunden: ruft `prepare_call`, `place_call` und `await_call_event` mit dem Token des Kunden auf. Er bekommt die Rückfrage als Text in `questions`.
- Angerufener: hört die Eröffnung (Offenlegungssatz, dann das gekürzte Ziel), das Denk-Signal und Antworten, die auf Recherche-Fakten beruhen. Was er sagt, kann das Modell in eine Rückfrage oder Suchanfrage übernehmen.
- Anrufer bei eingehenden Anrufen: erreicht keine der sechs Stellen. Recherche und Rückfrage gibt es nur bei Outbound (`src/research/in-call.js:18`, `src/consult/in-call.js:41`), das Gedächtnis ebenfalls nur bei Outbound (P-007, `src/claude.js:55-58`), und die Eröffnung kommt nur über `POST /voice/outbound` (`src/routes/voice.js:434-436`).
- Anbieter: Telnyx (spricht den Eröffnungstext und das Denk-Signal, Webhooks signiert, SG-05). ElevenLabs (sein Agent ruft `POST /webhooks/elevenlabs/lookup` und `consult` auf, SG-06). Exa (bekommt die Suchanfrage und liefert Titel und Auszug, aus denen der Fakt wird, `src/research/adapters/exa-search.js:8-34`). Der Sprachmodell-Anbieter bekommt das Gedächtnis und die Fakten im Prompt.
- Dritte im Netz: Wer eine Webseite veröffentlicht, bestimmt Titel und Auszug eines Exa-Treffers und damit den Text des Fakts.
- Betreiber: setzt Konfiguration. Neue Einstellungen gibt es nicht.

### Eingänge und Grenzen
Es entsteht keine neue Grenze. Angesehen wurden die sechs bestehenden Ausgänge, die durch die Hilfe laufen. Je Aufrufer steht unten, wer den Text bestimmt, wohin er geht und ob das zusätzliche ganze Wort dort etwas offenlegen kann, das heute wegfällt (Fragerunden, Runde 1, Antwort 6).

- Ziel im Eröffnungssatz, Telnyx-Pfad (75 Zeichen). Den Text bestimmt der Kunde. Ausgang: Antwort auf `POST /voice/outbound` an Telnyx und ins Transkript (`src/routes/voice.js:434-436`). Das ganze Ziel wird schon bei `prepare_call` und `place_call` auf Zahlungs-, Ausweis- und Zugangsdaten geprüft und sonst abgewiesen (`src/mcp-tools.js:261-267`, `:882`, `:918-922`). Das zusätzliche Wort stammt aus diesem schon geprüften und bestätigten Ziel und legt nichts offen, was der Kunde nicht selbst geschrieben hat. Der Offenlegungssatz steht davor und geht nicht durch die Hilfe (`src/claude.js:224-233`). Der ElevenLabs-Pfad nutzt die Hilfe nicht: Er baut seine Eröffnung über `bridgedObjective` und `validOpeningLine` (`src/elevenlabs/opening-line.js:30-51`). Angriffswege: T1. Sonst keiner, weil der Kunde jeden Anfang bis 75 Zeichen schon heute mit einem kürzeren Ziel erreicht.
- Denk-Signal (120 Zeichen). Den Text bestimmt das Modell (seine eigene Rede in einer Werkzeugrunde, `src/claude.js:620-624`). Ausgang: gesprochen an den Angerufenen, danach als Rede des Agenten gespeichert. Davor wird nichts geprüft. Das zusätzliche Wort ist ein Wort derselben Modellrede, die heute schon bis 120 Zeichen gesprochen wird. Angriffswege: T1. Sonst keiner, weil das Modell dieselbe Länge heute mit einem anderen Satz erreicht.
- Gesprächsgedächtnis (Grenze minus 1 plus „…“, 100 und 200 Zeichen). Den Text bestimmen die Ergebniskarten früherer Anrufe (P-007). Ausgang: Systemprompt an den Sprachmodell-Anbieter (`src/claude.js:208-213`). An den Kunden geht nichts zurück. Das zusätzliche Wort stammt aus derselben gespeicherten Karte. Die Zeile wird höchstens genau so lang wie ihre Grenze (`src/call-memory.js:19-22`). Angriffswege: T1. Sonst keiner, wie in P-007 (SG-10).
- Recherche-Anfrage (120 Zeichen). Den Text bestimmt das Modell, oft aus dem Gesagten des Angerufenen. Ausgang: an Exa (`src/research/adapters/exa-search.js:17-30`) und ins Abfrageprotokoll des Anrufs (`src/store/state-ops.js:727-736`). Ziffernfolgen, E-Mail, Zielnummer und wörtliche Zitate werden auf dem vollen Text vor dem Kürzen geprüft (`src/research/lookup-guard.js:28-35`). Jede dieser vier Prüfungen findet in einem Anfang des Texts nichts, was sie im ganzen Text nicht findet. Bei der Zitatprüfung gilt das, weil der neue Schnitt vor einem `" "` liegt und die Wortliste des Anfangs damit ein Anfang der Wortliste des ganzen Texts ist (`src/utils/text.js:18-38`). Das zusätzliche Wort ist also schon geprüft. Angriffswege: T1. Sonst keiner, weil der geprüfte Text heute schon bis 120 Zeichen hinausgeht.
- Recherche-Fakt (200 Zeichen). Den Text bestimmen Dritte im Netz über Titel und Auszug eines Exa-Treffers (`src/research/adapters/exa-search.js:8-10`). Ausgang: als `answer` an den ElevenLabs-Agenten (`src/routes/webhooks-elevenlabs.js:140`, `:157-161`). Auf dem Telnyx-Pfad gehen die Fakten in die Fakten des Anrufs und in den Prompt (`src/research/in-call.js:53-62`, `src/store/state-ops.js:709-714`). Steuerzeichen und Leerraum werden vorher gefaltet (`src/research/lookup-guard.js:42`). Das zusätzliche Wort ist fremder Text derselben Quelle, und die 200 Zeichen gelten weiter. Angriffswege: T1. Sonst keiner, weil ein Dritter jeden Anfang bis 200 Zeichen heute schon mit einem kürzeren Auszug erreicht.
- Rückfrage an den Besitzer (200 Zeichen). Den Text bestimmt das Modell, oft aus dem Gesagten des Angerufenen. Ausgang: gespeichert als Frage des Anrufs (`src/store/state-ops.js:627-643`) und über `await_call_event` an den Agenten des Kunden (`src/consult/delivery.js:51-55`). Vor dem Kürzen wird auf wörtliche Zitate geprüft (`src/consult/question.js:14-15`). Angriffswege: T1, T2 (vertraulich, offen).

### Werte
- Die Längengrenzen der sechs Ausgänge: Sie begrenzen fremden Text im Prompt und in der Rede des Agenten (SG-10, SG-11), die Menge, die an Exa geht (SG-11, `LOOKUP_QUERY_MAX_CHARS`), und Sprach- und Tokenkosten.
- Die Offenlegung als erster Satz der Eröffnung (CLAUDE.md, Regel 2; Pitch B1).
- Daten des Angerufenen, die über eine Rückfrage an den Agenten des Kunden und damit an dessen Modell gehen.
- Die Richtigkeit dessen, was der Agent dem Angerufenen sagt (Pitch, Problem).

### Wem wir was glauben
Es gibt keine neue Vertrauensannahme, weil kein Anbieter und kein Agent des Kunden etwas Neues liefert oder bekommt. Bestehend und unverändert: Exa-Treffer sind fremder Text, und nur Faltung und Länge begrenzen sie (SG-10).

### Nicht-Ziele
- Diese Änderung schützt nicht dagegen, dass eine allein stehende Verneinung den Sinn umkehrt („nicht nur …“ → „… nicht“), weil die Hilfe keine Bedeutung prüft (Pitch, PM2, Nicht-Ziel). Wer den Text bestimmt, könnte dieselbe Aussage heute direkt schreiben; einen neuen Weg für Angreifer gibt es deshalb nicht.
- Diese Änderung schützt nicht gegen den Wegfall von „nicht“ bei einer Grenze im Wort oder auf dem Leerzeichen davor und nicht gegen Satzzeichen an der Grenze (Pitch, PM1, Nicht-Ziele).
- Zur Rückfrage an den Besitzer: T2, vertraulich, offen.

## 2. Angriffswege
### T1: Ein Fehler an der neuen Stelle der Hilfe ließe Text über die Längengrenze aller sechs Ausgänge
Wer: jeder, der einen der sechs Texte bestimmt. Das sind Dritte im Netz (Fakt), der Angerufene über das Modell (Anfrage, Rückfrage), das Modell selbst (Denk-Signal) und der Kunde (Ziel).
Weg: Die Hilfe ist die einzige Kürzung an der Wortgrenze (design.md, erste Zeile). Die Grenzen 75, 120 und 200 und die des Gedächtnisses gelten nur, solange sie ein Ergebnis von höchstens `maxChars` Zeichen liefert (`src/utils/text.js:1-6`; `src/call-memory.js:19-22` setzt das voraus). Die Änderung betrifft genau die Lage, in der ein Leerzeichen an Stelle `maxChars` steht. Nimmt die neue Fassung dort das Leerzeichen oder mehr mit, liegt jedes Ergebnis in dieser Lage über der Grenze. Das gilt für die Anfrage an Exa, die Fakten an den ElevenLabs-Agenten, das Gedächtnis im Prompt und die Rückfrage. Die bestehenden Grenztests treffen diese Lage nicht: Ihre Texte haben an der Grenze kein Leerzeichen (`test/al-p10b-lookup-guard.test.js:56-62`, `test/al-p14-in-call-consult.test.js:280-286`, `test/al-p12-call-memory.test.js:163-174`, `test/anrufe/sprechausgabe.test.js:165-175`).
Schaden: Fremder Text bekäme im Prompt und in der Rede des Agenten mehr Raum, als SG-10 und SG-11 zusagen. Die Anfrage an Exa würde länger als 120 Zeichen, und eine Gedächtniszeile wäre länger als ihre Grenze. Pro Ausgang geht es um wenige Zeichen, aber die Zusage „nie länger als die Grenze“ hielte nicht mehr.
Ausgang: verhindern, weil die Grenze ein bestehender Schutz ist, den die Änderung an genau dieser Stelle anfasst.
Szenario: S1, B2 und B3 im Pitch. B3 ist rot, wenn die Hilfe ein Zeichen zu weit nach einem Leerzeichen sucht (Leerzeichen an Stelle 201 → 201 Zeichen bis „nichts“; Gegenprüfung Nr. 1). S1 ist rot, wenn die Hilfe in der Lage „Leerzeichen an Stelle 200“ ein Zeichen mehr behält: Die `answer` endet dann nicht auf „nicht“, und der Fakt ist nicht 200 Zeichen lang. B2 ist rot, wenn sie über die Grenze in das nächste Wort greift („niema“). Beide laufen über den echten Eingang `POST /webhooks/elevenlabs/lookup`, und alle sechs Aufrufer nutzen dieselbe Hilfe. Voraussetzung: Der Abnahmetest zu S1 prüft das Ende der `answer` genau und die Länge des Fakts (Abschnitt 4).

### T2: vertraulich, offen
Ergebnis der Prüfung je Aufrufer zur Rückfrage an den Besitzer: vertraulich, liegt bei der Betreuung. Die Änderung behält höchstens ein ganzes Wort mehr; die Sicherheitsprüfung hat jeden Aufrufer geprüft, das Ergebnis liegt bei der Betreuung.
Ausgang: übertragen, weil die Entscheidung vertraulich bei der Betreuung liegt.

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1, H2, H9, H10, H11 | trifft nicht zu, weil keine der sechs Aufrufstellen auf einem Weg liegt, der wählt, eine SMS sendet, eine Rufnummer eines eingehenden Anrufs auswertet, einen Webhook annimmt oder eine Adresse wählt. Gates und Signaturprüfung haben entschieden, bevor die Hilfe läuft (`src/routes/voice.js:434`, `src/routes/webhooks-elevenlabs.js:164-210`). Die Exa-Adresse kommt aus der Konfiguration (`src/research/adapters/exa-search.js:17`) |
| H3 | trifft nicht zu, weil alle Grenzen gleich bleiben (Pitch, Nicht-Ziele). Je Ausgang kommt höchstens ein Wort bis zur Grenze dazu. Die Anzahl der Suchen und Rückfragen je Anruf bleibt gleich (`src/research/in-call.js:20`, `src/consult/in-call.js:45`). Dass die Grenze selbst hält, steht in T1 |
| H4 | trifft nicht zu, weil die Hilfe nur einen schon ausgewählten Text kürzt und keine Kennung, keinen Mandanten und keine Abfrage berührt |
| H5, H13, H14 | trifft nicht zu, weil weder Token noch Schlüssel, Pakete, Werkzeugbeschreibungen oder Anbieter neu hinzukommen |
| H6 | trifft nicht zu, weil fremder Text (Fakt, Rückfrage, Anfrage) nicht mehr Raum als seine Grenze bekommt und der Telefonagent keine neuen Werkzeuge erhält (SG-11, `src/routes/webhooks-elevenlabs.js`). Der Raum hängt an der Grenze → T1 |
| H7 | trifft nicht zu, weil an den Agenten des Kunden nichts Neues zurückgeht. Die Rückfrage bleibt in `questions` und behält ihre Form und ihre Grenze. Die Zitatprüfung läuft auf dem vollen Text und gilt für jeden Anfang an einem Leerzeichen mit (Abschnitt 1). Sonst → T2 (vertraulich, offen) |
| H8 | trifft nicht zu, weil der Offenlegungssatz und die Begrüßung bei einem Anruf an den Besitzer nicht durch die Hilfe gehen (`src/claude.js:224-241`). Hinter ihnen steht nur ein Anfang des vom Kunden bestätigten Ziels, und B1 im Pitch hält Wortlaut und Reihenfolge fest. Der ElevenLabs-Pfad nutzt die Hilfe nicht (`src/elevenlabs/opening-line.js:43-51`). Kein Punkt für die rechtliche Prüfung |
| H12 | trifft nicht zu, weil keine Stimme und keine neue Art von Inhalt verarbeitet wird. Ins Transkript kommen Eröffnung und Denk-Signal (`src/routes/voice.js:435`), höchstens um ein Wort desselben Texts länger. Keine der Stellen schreibt den gekürzten Text in ein Log (`src/research/in-call.js:28-34`, `src/routes/webhooks-elevenlabs.js:110`, `:147-149`). Kein Punkt für die rechtliche Prüfung |
| H15 | trifft nicht zu, weil keine neue Annahme über Telnyx, ElevenLabs, Exa, Stripe, WorkOS, den Sprachmodell-Anbieter oder den Agenten des Kunden entsteht |
| STRIDE an der geänderten Stelle (gemeinsame Kürzung vor sechs Ausgängen) | Tampering: Ein Grenzbruch an der neuen Stelle gäbe fremdem Text mehr Raum → T1. Information Disclosure: T2 (vertraulich, offen). Nach außen geht sonst nur ein Anfang eines Texts, der schon geprüft ist oder schon hinausgeht. Denial of Service: kein Weg, weil die Längen gleich bleiben (T1 sichert das) und die Hilfe in einem Durchlauf arbeitet. Spoofing, Repudiation, Elevation of Privilege: kein Weg, weil keine Identität, kein Protokoll und kein Recht berührt werden |
| LINDDUN für die angerufene Person | Disclosure: T2 (vertraulich, offen). Bei der Anfrage an Exa trifft es nicht zu, weil die vier Prüfungen auf dem vollen Text auch für den längeren Anfang gelten (Abschnitt 1). Linkability, Identifiability, Non-repudiation, Detectability, Unawareness und Non-compliance treffen nicht zu, weil die Änderung weder neue Angaben erhebt noch Anrufe verknüpft, speichert, aufbewahrt oder weitergibt. Sie verschiebt nur, wo innerhalb derselben Grenze geschnitten wird |

## 4. Offene Fragen
- Angenommen: Der Abnahmetest zu S1 prüft, dass die `answer` genau auf „nicht“ endet (kein Leerzeichen dahinter) und der Fakt genau 200 Zeichen lang ist. Ändert: T1. Prüft der Test nur „enthält“, bleibt eine Fassung grün, die das Leerzeichen an Stelle 200 mitnimmt, und T1 hätte kein rotes Szenario. Prüfen durch: Abnahmetest lesen, bevor gebaut wird, und mit einem Wegwerfversuch bestätigen: Eine Fassung der Hilfe, die das Leerzeichen hinter der Grenze mitnimmt, muss S1 rot machen.
- Angenommen: Rückfragen erreichen den Kunden außer über `await_call_event` nur über die Anrufansicht im Dashboard (`src/routes/api-read.js:56`, `src/store/views.js:30-32`). Ändert: T2. Prüfen durch: alle Leser von `consults[].questions` in `src/` und im Dashboard-Code suchen.

## 5. Vorschlag für docs/sicherheitsgrenzen.md
Keiner, weil keine neue Grenze, kein neuer Eingang und keine neue Vertrauensannahme entsteht. Die Mechanismen in SG-10 („auf feste Form und Länge geklemmt“) und SG-11 („Suchanfragen gekürzt“) bleiben zutreffend, solange T1 hält.

## 6. Gegenprüfung
| Nr. | Art | Bezug | Befund mit Beleg | Übernommen als |
|---|---|---|---|---|
| G1 | Szenario prüft nicht | T1, S1, B2 | S1 und B2 bleiben grün bei einer Fassung, die ein Zeichen zu weit schaut (`lastIndexOf(" ", maxChars + 1)`): Leerzeichen an Stelle `maxChars + 1` gäbe `maxChars + 1` Zeichen; die bestehenden Grenztests haben dort kein Leerzeichen (`test/al-p10b-lookup-guard.test.js:56-62`, `test/al-p14-in-call-consult.test.js:280-286`, `test/anrufe/gedaechtnis-kuerzung.test.js:102-128`). Nachgestellt: 201 Zeichen bis „nichts“. | neues Szenario B3 im Pitch; T1 nennt S1, B2, B3 |
