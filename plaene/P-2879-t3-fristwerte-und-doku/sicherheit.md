# P-2879 Sauberes Stoppen: Sicherheitsprüfung

Status: freigegeben
Grundlage: pitch.md, design.md (nur Ausgangslage und Annahmen), Code-Stand 97e4c53

## Zur Freigabe
1. Die schwersten Angriffswege (bestätigt, Betreuung 03.11.2026; T1 hingenommen, Antonio 03.11.2026): T1 (die Anrufpause erreicht den alten Prozess nach dem Signal nicht, er wählt bis zu 20 s weiter), T2 (ein Notaus über `OUTBOUND_FROZEN` mit Neustart wirkt im alten Prozess gar nicht), T5 (ein Anruf, den der alte Prozess nach dem Signal startet, verliert die prozessinternen Wachen). Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden:
   1. (angenommen, Antonio 03.11.2026) T2: hinnehmen vorgeschlagen, weil der alte Prozess eine neue Umgebungsvariable nicht sehen kann und der sofort wirkende Weg die Anrufpause ist (T1, hingenommen unter der Bedingung, dass ihr Fehler vorher behoben ist). Berührt Absolute Regel 1, deshalb Entscheidung des Owners. Empfehlung: hinnehmen, wenn der Fehler zur Anrufpause vorher behoben ist und `docs/RUNBOOK-LAB-LIVE.md` die Anrufpause als ersten Schritt eines Notaus nennt.
   2. (angenommen, Betreuung 03.11.2026) T3: hinnehmen vorgeschlagen, weil eine von außen offen gehaltene Anfrage den Stopp höchstens bis zur Teilfrist verlängert und der Flush danach trotzdem läuft. Empfehlung: hinnehmen.
   3. (angenommen, Antonio 03.11.2026) T4: hinnehmen vorgeschlagen (deckt sich mit PM3 im Pitch), weil eine `place_call`-Anfrage, die länger als die Teilfrist läuft, selten ist und das Fenster heute mit 8 s größer ist. Empfehlung: hinnehmen.
   4. (angenommen, Betreuung 03.11.2026) T5: hinnehmen vorgeschlagen (deckt sich mit PM4 im Pitch), weil im Betrieb nur der Telnyx-Weg wählt, der die Höchstdauer beim Anbieter setzt und von der neuen Instanz wieder aufgenommen wird. Berührt Absolute Regel 1, deshalb Entscheidung des Owners. Empfehlung: hinnehmen, solange `ELEVENLABS_OUTBOUND_ENABLED` auf `false` steht; vor dem Einschalten neu prüfen.
   5. (angenommen, Betreuung 03.11.2026) Neue Grenze „Abschaltweiche“ in `docs/sicherheitsgrenzen.md` (Abschnitt 5). Empfehlung: ja.

## 1. Woran arbeiten wir
### Umfang
Nach SIGTERM nimmt der Prozess weiter Verbindungen an, beantwortet jede neue Anfrage, die `isTrustedLocalCaller` nicht erfüllt, mit `503`, lässt gezählte offene Anfragen samt interner MCP-Sprünge bis zur Teilfrist laufen, bricht danach ab und führt den letzten Flush in einer eigenen Restfrist aus (Pitch, Grobe Lösung, Teile 1 bis 4). Heute schließt `httpServer.close()` die Annahme sofort und ein Watchdog beendet nach `shutdownDrainTimeoutMs` mit Exit 0 ohne Flush (`src/abschalten.js:15-19`). Die Gesamtfrist steigt in `render.yaml` von 8000 auf 25000 ms (`render.yaml:311-312`; Pitch, Absicht). Neu ist damit vor allem: Der alte Prozess startet nach dem Signal noch Anrufe, nämlich den zweiten Sprung `/api/calls` eines `place_call`, der vor dem Signal begonnen hat (`src/mcp-tools.js:961-972`).
### Beteiligte
- Kunde: angemeldet, bestätigt Anrufe in der Hermes-Karte; kein neues Recht.
- Agent des Kunden: ruft `POST /mcp` mit dem Token des Kunden; die Anmeldung läuft auf den Kopfzeilen vor dem Rumpf (`src/routes/mcp.js:89`). Er kann eine Anfrage vor dem Signal beginnen und den Rumpf danach senden (das ist S1).
- Angerufener: wird von einem Anruf erreicht, den der alte Prozess nach dem Signal startet.
- Anrufer bei eingehenden Anrufen: seine Webhooks laufen über Telnyx; kein neues Recht.
- Beliebiger Internet-Client: kann jede öffentliche Route mit einem langsam gesendeten Rumpf offen halten, weil die Rumpf-Parser vor den Routen auf den ganzen Rumpf warten (`src/app.js:118-125`).
- Anbieter: Render schickt SIGTERM und später SIGKILL; Telnyx wählt und schickt Webhooks; ElevenLabs nur, wenn der EL-Ausgang eingeschaltet ist (`render.yaml:53-54` steht auf `false`).
- Betreiber: setzt die Anrufpause (`POST /intern/anrufpause`, `src/routes/intern-anrufpause.js:33-38`) oder `OUTBOUND_FROZEN` mit Neustart (`src/config.js:630`).
### Eingänge und Grenzen
- Neue Anfragen von außen nach dem Signal (Render-Proxy nach Hermes): neue Abschaltweiche vor allen Routen, Entscheidung über `isTrustedLocalCaller` (`src/routes/_tenant.js:4-9`; Pitch, Grobe Lösung, Teil 1). Angriffswege: keiner, weil ein Client von außen weder einen Loopback-Socket bekommt noch den vom Proxy gesetzten `X-Forwarded-For` entfernen kann (angenommen, dieselbe Annahme trägt heute `internalOnly`, `src/wiring/internal-only.js:4-5`) und die Weiche nur abweist, nichts freigibt.
- Vor dem Signal begonnene Anfragen von außen (gezählt bis zum Ende der Antwort): bleiben bis zur Teilfrist offen (Pitch, Grobe Lösung, Teil 2). Angriffswege: T3; bei `POST /mcp` mit `place_call` zusätzlich T1, T2.
- Interne Sprünge über Loopback nach dem Signal (`/api/call-confirmations`, `/api/calls`, beide `internalOnly`, `src/routes/api-call-confirmations.js:180`, `src/routes/api-calls.js:233`): heute nach dem Signal nicht erreichbar (fragerunden.md, Vorher-Rot S1), neu erreichbar. Angriffswege: T1, T2, T4.
- Hermes nach Telnyx (Wählauftrag nach dem Signal, `src/routes/api-calls.js:344-351`): neu möglich. Angriffswege: T5.
- Hermes nach ElevenLabs (Wählauftrag nach dem Signal, `src/routes/api-calls.js:338-341`): nur bei eingeschaltetem EL-Ausgang. Angriffswege: T5.
- Hermes nach Postgres (letzter Flush, später als heute): Angriffswege: keiner, den die Änderung öffnet, weil der Flush denselben Inhalt schreibt wie heute (`src/abschalten.js:22-23`) und nur sein Zeitpunkt sich verschiebt.
- Render nach Hermes (SIGTERM, SIGKILL nach `maxShutdownDelaySeconds`): Angriffswege: keiner, weil nur Render das Signal schickt; ob der Wert auf dem Plan `free` gilt (`render.yaml:6`), ist eine Frage des Pitches (PM5).
- Neue Logzeilen (`[shutdown] …`): Angriffswege: keiner, weil sie nur Zahlen und feste Texte enthalten (Pitch, Neue Begriffe) und durch die zentrale Log-Maske laufen (SG-13).
### Werte
- Notaus und Anrufpause: Sie sind der Weg, ausgehende Anrufe sofort zu stoppen (Absolute Regel 1).
- Kostendecke und Max-Gesprächsdauer: Sie begrenzen unsere Kosten und die des Kunden (Absolute Regel 1).
- Der letzte Flush: Er sichert Transkripte, Verbrauch und Anrufstatus.
- Ruhe der Angerufenen: kein doppelter Anruf, kein Anruf, der klingelt und sofort auflegt.
### Wem wir was glauben
- Render: wir glauben, dass der Proxy nie über Loopback verbindet und immer `X-Forwarded-For` setzt (angenommen); wenn nicht, käme eine Anfrage von außen durch die Abschaltweiche, aber auch heute schon durch `internalOnly`.
- Render: wir glauben, dass nach dem Umschalten keine neue Anfrage von außen mehr den alten Prozess erreicht; die Doku nennt nur die Reihenfolge Umschalten, 60 s später SIGTERM (render.com/docs/deploys, Abschnitt zu Zero-downtime deploys). Wenn nicht, bekommen Anbieter und Browser öfter `503` (PM6 im Pitch).
- Telnyx: wir glauben, dass `timeLimit` die Gesprächsdauer beim Anbieter beendet (`src/routes/api-calls.js:351`); wenn nicht, hängt die Höchstdauer eines Anrufs aus dem alten Prozess allein am Wiederaufnehmen durch die neue Instanz (T5).
- ElevenLabs: wir glauben, dass ein Gespräch beim Anbieter nach höchstens 600 s endet (`ELEVENLABS_PROVIDER_MAX_DURATION_S`, `src/elevenlabs/outbound.js:50`; angenommen, dass der Anbieter ihn durchsetzt); wenn nicht, hat ein EL-Anruf aus dem alten Prozess nach dessen Ende keine Höchstdauer (T5).
- Agent des Kunden: keine neue Annahme.
### Nicht-Ziele
- Diese Änderung schützt nicht gegen Abweichungen zwischen zwei gleichzeitig laufenden Instanzen außerhalb der Teilfrist, weil zwei Instanzen das Paket S13 sind (Pitch, Nicht-Ziele).
- Diese Änderung schützt nicht den stdio-MCP-Server, weil er ein eigener lokaler Prozess ist (Pitch, Nicht-Ziele).

## 2. Angriffswege
### T1: Ein `place_call`, der vor dem Signal begonnen hat, wählt nach dem Signal trotz gesetzter Anrufpause
Wer: Agent des Kunden mit gültigem Bestätigungscode, auch ohne böse Absicht; der Betreiber hat die Pause gerade gesetzt.
Weg: Der Agent sendet die Kopfzeilen von `POST /mcp` vor dem Signal (S1 im Pitch). Der Betreiber setzt die Anrufpause; die Anfrage landet bei der Instanz, die Render gerade bedient, also der neuen (`src/routes/intern-anrufpause.js:33-38`). Der Postgres-Speicher hält den Zustand im Prozess und liest ihn nur beim Start (`src/store/pg.js:22-36`, Anrufpause beim Start gelesen in `src/store/pg.js:696`). Das Gate des alten Prozesses fragt nur den eigenen Zustand (`src/telephony/outbound-gates.js:45-50`). Nach dem Signal gelingt der zweite Sprung `/api/calls` neu (Pitch, R1), das Gate sieht keine Pause, Telnyx wählt (`src/routes/api-calls.js:246`, `:344`).
Schaden: Bis zu 20 s nach dem Signal (Teilfrist bei 25000 ms) gehen Anrufe hinaus, obwohl der Betreiber ausgehende Anrufe gestoppt hat; der Notaus ist für diese Zeit wirkungslos, gerade wenn er wegen Missbrauch oder einer Fehlfunktion gezogen wurde.
Ausgang: hinnehmen (entschieden von Antonio, 03.11.2026), unter drei Bedingungen: (1) der Fehler zur Anrufpause wird vorher behoben, (2) `docs/RUNBOOK-LAB-LIVE.md` nennt die Anrufpause als ersten Schritt eines Notaus, (3) das Fenster bleibt durch die Gesamtfrist von 25 s (Teilfrist 20 s) auf höchstens rund 24 s begrenzt. Kein Umbau von `makeCallRoutes`. Es gibt deshalb kein Szenario zu T1 in diesem Paket.

### T2: Ein Notaus über `OUTBOUND_FROZEN` mit Neustart wirkt im alten Prozess nach dem Signal nicht
Wer: Agent des Kunden mit gültigem Bestätigungscode; der Betreiber friert ausgehende Anrufe über die Umgebungsvariable ein.
Weg: Die Variable wird beim Start gelesen (`src/config.js:630`); die Änderung an ihr startet eine neue Instanz, der alte Prozess behält den alten Wert. Ein vor dem Signal begonnener `place_call` wählt nach dem Signal wie in T1 (`src/telephony/outbound-gates.js:46`).
Schaden: Bis zur Teilfrist gehen Anrufe aus dem alten Prozess hinaus, obwohl der Notaus gesetzt ist; der Umfang ist auf die `place_call`-Aufrufe begrenzt, deren Kopfzeilen vor dem Signal eingetroffen sind.
Ausgang: hinnehmen (Vorschlag), weil kein laufender Prozess eine neue Umgebungsvariable lesen kann und der Betreiber mit der Anrufpause (T1, hingenommen unter der Bedingung der vorherigen Behebung ihres Fehlers) einen Weg hat, der sofort und instanzübergreifend wirkt. Offen bleibt der Zeitraum bis zur Teilfrist, wenn der Notaus nur über die Variable gezogen wird. Owner-Entscheidung nötig (Absolute Regel 1).

### T3: Ein Client von außen hält beim Stopp eine Anfrage bis zur Teilfrist offen
Wer: beliebiger Internet-Client, ohne Anmeldung.
Weg: Er beginnt vor dem Signal eine Anfrage an eine öffentliche Route und sendet den Rumpf nicht zu Ende; die Rumpf-Parser warten (`src/app.js:118-125`), und die Anfrage zählt ab den Kopfzeilen (Pitch, Grobe Lösung, Teil 2). Heute endet der Prozess in diesem Fall nach 8 s ohne Flush (`src/abschalten.js:15`, `render.yaml:311-312`); neu wartet er bis zur Teilfrist und flusht dann.
Schaden: Jeder Stopp dauert bis zu 20 s statt Sekunden, die Logzeile „Teilfrist abgelaufen“ erscheint ohne echten Grund, und das Zeitfenster von T1 und T2 wird voll ausgeschöpft. Der Flush läuft trotzdem; gegenüber heute ist das eine Verbesserung.
Ausgang: hinnehmen (Vorschlag), weil die Teilfrist die Wartezeit begrenzt, der Flush danach läuft und eine Unterscheidung zwischen langsamen und böswilligen Gegenstellen auch echte Anbieter-Webhooks träfe. Offen bleibt die verlängerte Stoppzeit.

### T4: Nach Ablauf der Teilfrist wählt der abgebrochene Sprung weiter, und ein erneuter `place_call` ruft dieselbe Person ein zweites Mal an
Wer: Agent des Kunden; kein Angreifer nötig.
Weg: siehe PM3 im Pitch; der Handler von `/api/calls` läuft nach dem Abbruch der Verbindung weiter bis zum Wählauftrag (`src/routes/api-calls.js:314-354`), der Agent sieht einen Abbruch statt `dialing`.
Schaden: Die angerufene Person bekommt zwei Anrufe für einen Auftrag, und der Kunde zahlt zwei.
Ausgang: hinnehmen (Vorschlag), weil eine `place_call`-Anfrage, die länger als die Teilfrist von 20 s dauert, selten ist und das Fenster heute bei 8 s liegt. Offen bleibt der Fall, dass Briefing- oder Eröffnungsabruf so lange hängen.

### T5: Ein Anruf, den der alte Prozess nach dem Signal startet, verliert Max-Dauer-Timer und Geld-Wache, wenn der Prozess endet
Wer: kein Angreifer nötig; jeder `place_call` nach S1.
Weg: Max-Dauer-Timer, Geld-Wache und Freigabe der Reservierung hängen am Prozess (`src/telephony/call-lifecycle.js:119-131`); die neue Instanz hat den Zustand vor dem Anruf geladen (`src/store/pg.js:32-36`) und übernimmt den Anruf erst, wenn ein Telnyx-Webhook für ihn bei ihr ankommt und der Datensatz schon gespeichert ist (`src/routes/voice.js:376-388`, `:413-423`). Ist er noch nicht gespeichert, legt sie beim Annehmen sofort auf (`src/routes/voice.js:420-422`). Beim EL-Weg gibt es nur den Timer im Prozess (`src/routes/api-calls.js:341`).
Schaden: Telnyx-Weg: die Höchstdauer setzt der Anbieter durch (`src/routes/api-calls.js:351`), im ungünstigen Fall hört die angerufene Person nach dem Abheben nur ein Auflegen. EL-Weg: die vom Kunden gewählte Höchstdauer und die Geld-Wache entfallen, es bleibt die Anbietergrenze von 600 s (angenommen), und das Ergebnis wird von niemandem abgeholt.
Ausgang: hinnehmen (Vorschlag), weil im Betrieb nur der Telnyx-Weg wählt (`render.yaml:53-54`) und die Übergabe an die neue Instanz das Paket S13 ist (Pitch, Nicht-Ziele). Offen bleibt der EL-Weg, sobald er eingeschaltet wird. Owner-Entscheidung nötig (Absolute Regel 1).

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1 | trifft zu → T4 (zweiter Anruf ohne zweiten Auftrag), T5 (Anruf, der nach dem Abheben auflegt); die Bestätigung selbst bleibt unverändert, jeder Wählsprung braucht weiter den Bestätigungscode (`src/mcp-tools.js:963-971`) |
| H2 | trifft zu → T1, T2 (Notaus im alten Prozess); Kostendecke, Stundenlimit, Denylist und Land-Gate laufen für jeden Wählsprung im alten Prozess wie heute (`src/routes/api-calls.js:246`), die Änderung fügt keine Zulassung ohne diese Prüfung hinzu; Telnyx-Profile werden nicht berührt |
| H3 | trifft zu → T5 (Höchstdauer eines Anrufs aus dem alten Prozess); keine neue Schleife und keine Wiederholung, weil abgewiesene Anfragen nur `503` bekommen und nichts auslösen |
| H4 | trifft nicht zu, weil die internen Kopfzeilen `X-Internal-Tenant` und `X-Internal-Identity` weiter nur von `isTrustedLocalCaller` angenommen werden (`src/routes/_tenant.js:11-19`) und die Abschaltweiche keine Mandantenzuordnung trifft |
| H5, H13, H14 | trifft nicht zu, weil die Änderung weder Tokens, Schlüssel noch Pakete oder Werkzeugbeschreibungen berührt (Pitch, Geänderte Dateien) |
| H6, H7, H12 | trifft nicht zu, weil die Änderung keine Gesprächsinhalte, Transkriptwege oder Werkzeuge des Telefon-Agenten ändert; ein abgebrochener Turn geht verloren, wird aber nicht anders sichtbar (Pitch, PM8) |
| H8 | trifft nicht zu, weil der Offenlegungssatz im Wählsprung unverändert gesetzt wird; T5 legt vor dem ersten Satz auf, es spricht also keine KI ohne Kennzeichnung |
| H9 | trifft nicht zu, weil die Änderung keine eingehende Nummer bewertet und nichts zurückruft |
| H10 | trifft nicht zu für Signatur und Zeitfenster, weil die Abschaltweiche nur abweist und die Prüfung in `/voice` unverändert danach läuft (SG-05); ein abgewiesener Webhook geht heute ebenso verloren (Verbindung verweigert); ob Telnyx auf `503` neu zustellt, steht unter Offene Fragen |
| H11 | trifft nicht zu, weil der interne Sprung an `resolveGatewayUrl()` geht (`src/config.js:966-970`), das ohne `GATEWAY_URL` den eigenen Port nimmt (`src/boot.js:743`), und `render.yaml` kein `GATEWAY_URL` setzt |
| H15 | siehe „Wem wir was glauben“; neu ist das Vertrauen in Renders Verkehrsumschaltung und in die Höchstdauer beim Anbieter |
| STRIDE an der Abschaltweiche | Denial of Service → T3; Elevation of Privilege ohne Weg, solange die Weiche nur zwischen `503` und der unveränderten bestehenden Kette entscheidet und „lokal“ nicht als Anmeldung zählt (Pitch, Grobe Lösung, Teil 1); Spoofing ohne Weg, weil Loopback und fehlendes `X-Forwarded-For` von außen nicht herstellbar sind (angenommen, wie bei `internalOnly`); Information Disclosure ohne Weg, solange die `503`-Antwort keinen Grund aus dem Prozess nennt; Tampering und Repudiation ohne Weg, weil die Weiche nichts schreibt und abgebrochene Anfragen gezählt geloggt werden |
| STRIDE am Wählsprung nach dem Signal | Elevation of Privilege → T1, T2 (Gate-Zustand veraltet); übrige Kategorien ohne neuen Weg, weil Auth, Bestätigung und Mandantenzuordnung des Sprungs unverändert sind |
| LINDDUN für die angerufene Person | trifft zu → T4 (zweiter Anruf), T5 (Anruf mit sofortigem Auflegen); Linking, Identifying, Disclosure und Non-compliance ohne neuen Weg, weil keine neuen Daten über die Person entstehen und die neuen Logzeilen nur Zahlen enthalten |

## 4. Offene Fragen
- Angenommen: Render schickt nach dem Umschalten keine neuen Anfragen von außen mehr an den alten Prozess. Ändert: T3 und die Häufigkeit von `503` an Anbieter (PM6). Prüfen durch: Render-Doku oder Support; nach einem Deploy in den Logs des alten Prozesses die Zahl der `503` zählen.
- Angenommen: ElevenLabs beendet ein Gespräch beim Anbieter nach höchstens 600 s. Ändert: T5 für den EL-Weg. Prüfen durch: in der gepinnten Agent-Vorlage nach der Höchstdauer sehen, bevor `ELEVENLABS_OUTBOUND_ENABLED` eingeschaltet wird.
- Angenommen: Telnyx stellt einen Webhook nach `503` erneut zu. Ändert: H10 und PM6. Prüfen durch: Telnyx-Doku zu Wiederholungen und Ausweich-Adresse für Webhooks.

## 5. Vorschlag für docs/sicherheitsgrenzen.md
Neue Zeile im Bedrohungskatalog: Nach dem Abschaltsignal erreicht eine Anfrage von außen den Prozess nicht mehr, und ein Wählsprung nach dem Signal folgt dem gespeicherten Stand der Anrufpause. Verletzte Grenze: Beim Stoppen nimmt Hermes nur Arbeit aus dem eigenen Prozess an, und der Notaus gilt auch für diese Arbeit. Mechanismus: Abschaltweiche über `isTrustedLocalCaller` (`src/routes/_tenant.js`) vor allen Routen; Anrufpause aus dem Speicher im Wählsprung nach dem Signal. Negativtest: S2 im Pitch.

## 6. Gegenprüfung

| Nr. | Art | Bezug | Befund | Vorschlag |
|---|---|---|---|---|
| G1 | Schutz umgangen | T1 | Der Schutz „Wählsprung prüft die Anrufpause gegen den gespeicherten Stand“ ist nur so verlässlich wie dieser Stand. Wie verlässlich er ist, hängt an einem Befund im bestehenden Code, den die Sitzung als vertraulichen Fehler führt und der in keinem Dokument steht. | Erledigt: T1 ist hingenommen, Bedingung ist die Behebung dieses Fehlers vor diesem Paket. |
| G2 | Schutz umgangen | T1 | Ein `/api/calls`, dessen Gate-Prüfung vor dem Setzen der Pause oder vor dem Signal durchlief, wartet danach noch auf Briefing (`src/routes/api-calls.js:264-275`, Standard 6000 ms) und auf dem EL-Weg auf die Eröffnung (`:286-290`) und wählt erst dann (`:340`, `:344`). Die Formulierung „ein Wählsprung nach dem Signal prüft“ lässt offen, ob der Sprung nach dem Signal beginnen oder nach dem Signal wählen muss. | Die Prüfung liegt unmittelbar vor dem Wählauftrag (`originateCall`, `originateElevenLabsCall`) und gilt für jeden Wählauftrag nach dem Signal, egal wann der Sprung begann. Entfällt, weil T1 hingenommen ist (Antonio 03.11.2026). |
| G3 | Bestehender Code | T2, T4 | Zwei Befunde im bestehenden Code machen die Begründungen „instanzübergreifend“ (T2) und „ein Bestätigungscode gilt einmal“ (T4) brüchig. Der zweite ist der Gegenstand von S2a (#2869, Bestätigungscodes in der Datenbank); den ersten führt die Sitzung als vertraulichen Fehler, hier steht nur der Verweis. | T2 und T4 erst nach Behebung dieser Fehler als „hingenommen“ führen oder mit dieser Lücke ausdrücklich hinnehmen (Entscheidung des Owners). |
