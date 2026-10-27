# P-013 Rückschau im Posteingang mit offset: Sicherheitsprüfung

Status: freigegeben
Freigabe: Sitzung P013 als Entscheider im Auftrag der Betreuung, 27.10.2026 (Halt H3 in Issue #2223)
Grundlage: pitch.md, design.md (nur Ausgangslage, Pitch „Design Doc: nein“), Code-Stand fc709c8

## Zur Freigabe
1. Die schwersten Angriffswege: T1 (Einträge aus eingehenden Anrufen gelten als gesehen, ohne dass sie geliefert wurden) und T2 (die Arbeit je Abruf wächst mit `offset`). Beide sind nur von einem Aufrufer im Prozess erreichbar. Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden:
   1. T2 (angenommen: hingenommen, Sitzung P013 als Entscheider, 27.10.2026): hinnehmen vorgeschlagen, weil heute kein Aufrufer `offset` schickt (`check_inbox` reicht nur `include_seen` durch, `src/mcp-tools.js:1166-1167`) und `internalOnly` nur Verbindungen über Loopback ohne `X-Forwarded-For` annimmt (`src/routes/_tenant.js:5-10`). Das deckt sich mit PM5 im Pitch. Empfehlung: hinnehmen, mit der Bedingung aus Offene Fragen, Punkt 2: Bekommt `check_inbox` später ein `offset`, wird T2 neu bewertet.

## 1. Woran arbeiten wir
### Umfang
Die Route `POST /api/inbox/poll` liest ein neues optionales Feld `offset` aus dem JSON-Body, aber nur bei `include_seen:true`. Sie fordert dann von der unveränderten Store-Funktion `offset + 20` Einträge an und gibt die Einträge ab `offset` zurück (Pitch, Grobe Lösung). Die Rückschau markiert nichts als gesehen (`src/store/state-ops.js:417`). Store, MCP-Werkzeug, Seitengröße, Audit-Zeile und Antwortform bleiben, wie sie sind (Pitch, Absicht und Geänderte Dateien). Es werden keine Anrufe oder SMS ausgelöst und keine Kosten bei Anbietern verursacht.
### Beteiligte
- Kunde (Tenant): besitzt die Posteingangs-Einträge. Erreicht die Route nicht direkt, nur über den Agenten.
- Agent des Kunden: ruft über `/mcp` das Werkzeug `check_inbox` mit `include_seen` auf. Er kann kein `offset` an die Route geben, weil der Handler nur `include_seen` weiterreicht (`src/mcp-tools.js:1163-1167`).
- Aufrufer im Prozess: alles, was die Route über Loopback ohne `X-Forwarded-For` erreicht (`src/wiring/internal-only.js:4-8`, `src/routes/_tenant.js:10`). Er wählt den Tenant über `x-internal-tenant` (`src/routes/_tenant.js:20`, `:35-36`). Heute ist das nur der MCP-Pfad im eigenen Prozess (Pitch, Problem; angenommen für den Betrieb, siehe Offene Fragen, Punkt 1).
- Anrufer bei eingehenden Anrufen: Seine Nummer (`caller`) und die Zusammenfassung seines Anrufs stehen im Eintrag (`src/store/state-ops.js:386-397`). Er erreicht die Route nicht.
- Angerufener (ausgehend), Anbieter (Telnyx, ElevenLabs, Stripe, WorkOS): nicht berührt, weil die Route weder wählt noch Anbieter aufruft.
- Betreiber: unverändert, kein eigener Zugriff über diese Änderung.
### Eingänge und Grenzen
- Feld `offset` im Body von `POST /api/inbox/poll` (neu): geht vom Aufrufer im Prozess in den Store-Abruf eines Tenants und überquert die Grenze `internalOnly`. Beleg: `src/routes/api-inbox.js:10`, Pitch, Neue Begriffe. Angriffswege: T1, T2
- Werkzeug `check_inbox` über `/mcp`: vom Agenten des Kunden zur Route, unverändert. Beleg: `src/mcp-tools.js:1158-1178`. Angriffswege: keiner, weil der Handler aus den Werkzeug-Argumenten nur `include_seen` übernimmt und kein `offset` erzeugt (`src/mcp-tools.js:1166-1167`).
- Antwort der Route an den Aufrufer: von Hermes zum Aufrufer im Prozess. Die Form `{ entries, remaining }` ist unverändert (`src/routes/api-inbox.js:19`). Angriffswege: keiner, weil `offset` nur auswählt, welche Einträge desselben Tenants geliefert werden; der Tenant-Filter bleibt vor dem Schneiden (`src/store/state-ops.js:407-413`).
- Audit-Zeile `inbox_poll`: unverändert, nur Zähler (`src/routes/api-inbox.js:18`). Angriffswege: keiner, weil `offset` nicht in die Zeile geht (Pitch, Geänderte Dateien nennen nur die Route; die Audit-Zeile bleibt unberührt).
### Werte
- Ungesehene Einträge aus eingehenden Anrufen: Sie sind der einzige Weg, auf dem die Nachricht eines Anrufers den Kunden erreicht. Ein Eintrag, der als gesehen gilt, ohne geliefert worden zu sein, geht still verloren (Pitch, Fallen 1).
- Nummer und Zusammenfassung des Anrufers: personenbezogen, gehören nur dem Tenant (SG-02).
- Rechenzeit der gemeinsamen Ereignisschleife: Alle Tenants teilen sie. Jeder gelieferte Eintrag durchsucht die Aufgaben aller Tenants (`src/store/state-ops.js:400-404`, `:966-967`).
### Wem wir was glauben
- Aufrufer im Prozess: Wir glauben, dass nur Code aus dem eigenen Prozess Loopback ohne `X-Forwarded-For` erreicht. Wenn das nicht stimmt, kann ein Fremder jeden Posteingang lesen, unabhängig von dieser Änderung (`src/routes/_tenant.js:20`, `:35-36`); diese Änderung vergrößert dann nur T2.
- Agent des Kunden: keine neue Vertrauensannahme, weil er `offset` nicht erreicht.
### Nicht-Ziele
- Diese Änderung schützt nicht gegen verrutschende Seiten zwischen zwei Abrufen (PM6, PM7), weil das ein Cursor im Store bräuchte (Pitch, Nicht-Ziele). Daraus folgt kein Angriffsweg: Ein übersprungener Eintrag ist ungesehen oder schon gesehen und bleibt gespeichert.

## 2. Angriffswege
### T1: Ein Aufrufer im Prozess lässt mit `offset` im verbrauchenden Abruf Einträge als gesehen gelten, die er nicht bekommen hat
Wer: Aufrufer im Prozess. Heute ist das niemand mit Absicht. Es wäre eine Umsetzung oder ein späterer Aufrufer, der `offset` ohne `include_seen:true` schickt.
Weg: Würde die Route `offset` auch ohne `include_seen` lesen, fordert sie `offset + 20` Einträge an. Der Store markiert jeden angeforderten Eintrag als gesehen (`src/store/state-ops.js:413-418`), die Route gibt aber nur die Einträge ab `offset` zurück (Pitch, Fallen 1, PM2).
Schaden: Die Nachrichten von Anrufern, etwa ein Rückrufwunsch oder ein abgesagter Termin, erreichen den Kunden nie. Der nächste verbrauchende Abruf liefert sie nicht mehr, und niemand merkt, dass sie fehlen.
Ausgang: verhindern, weil die Entscheidung „`offset` wirkt nur mit `include_seen:true`“ den Schaden vollständig ausschließt und sich über den echten Eingang prüfen lässt.
Szenario: B1 im Pitch (nach der Gegenprüfung G1 mit `{"include_seen":"true","offset":20}`). Ohne den Schutz liefert der Abruf bei 25 ungesehenen Einträgen nur die 5 jüngsten mit `remaining` 0 und markiert alle 25. Der folgende Abruf mit `{}` liefert dann keinen Eintrag mehr. B1 verlangt die 20 ältesten, `remaining` 5 und danach die 5 jüngsten und wird deshalb rot.

### T2: Ein Aufrufer im Prozess löst mit großem `offset` einen Abruf aus, dessen Arbeit mit dem ganzen Posteingang des Tenants wächst
Wer: Aufrufer im Prozess
Weg: Die Route fordert `offset + 20` Einträge an (Pitch, Grobe Lösung). Der Store baut für jeden davon die Ansicht und durchsucht dabei die Aufgaben aller Tenants (`src/store/state-ops.js:413-416`, `:400-404`, `:966-967`). Heute ist die Zahl der Ansichten je Abruf auf 20 begrenzt (`src/routes/api-inbox.js:4`, `:15`). Mit `offset` wächst sie bis zur Zahl aller Einträge des Tenants.
Schaden: Bei Tenants mit sehr vielen Einträgen blockiert ein einzelner Abruf die Ereignisschleife spürbar. Webhooks laufender Anrufe aller Tenants warten so lange. Es entstehen keine Kosten bei Anbietern und keine fremden Daten.
Ausgang: hinnehmen (Vorschlag), weil heute kein Aufrufer `offset` schickt (`src/mcp-tools.js:1166-1167`) und die Route nur aus dem eigenen Prozess erreichbar ist (`src/wiring/internal-only.js:4-8`). Offen bleibt: Die Arbeit je Abruf ist nur durch die Zahl der Einträge eines Tenants begrenzt, nicht durch die Route.

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1, H2, H8, H9, H11 | trifft nicht zu, weil die Route weder wählt noch SMS sendet, nicht an Adressen von Kunden sendet und der Nummer des Anrufers nichts glaubt. `caller` wird nur angezeigt wie bisher (`src/store/state-ops.js:390`). |
| H3 | trifft zu → T2. Es geht nur um Rechenzeit; Minuten, Sprachsynthese und Rückrufe sind nicht berührt. |
| H4 | trifft nicht zu, weil der Tenant-Filter vor Sortieren und Schneiden steht (`src/store/state-ops.js:407-413`), `offset` den Tenant nicht wählt und die Store-Funktion unverändert bleibt (Pitch, Absicht). |
| H5, H13 | trifft nicht zu, weil die Änderung keine Tokens und keine Schlüssel berührt. |
| H6 | trifft nicht zu, weil die Rückschau nichts auslöst und nichts schreibt (`src/store/state-ops.js:417`). |
| H7 | trifft nicht zu, weil `check_inbox` und die Form der Einträge unverändert bleiben (`src/mcp-tools.js:1166-1176`). Fremde Zusammenfassungen kommen wie bisher an. |
| H10 | trifft nicht zu, weil kein Webhook berührt wird. Gleichzeitige Rückschau-Abrufe schreiben nichts und können sich deshalb nicht stören. |
| H12 | trifft nicht zu, weil keine Stimme verarbeitet wird, die Speicherdauer unverändert bleibt (`src/boot.js:736`) und das Audit nur Zähler schreibt (`src/routes/api-inbox.js:18`). Derselbe Aufrufer bekommt alle Einträge des Tenants heute schon über `GET /api/tenant-data/export` (`src/routes/api-read.js:59-62`). |
| H14 | trifft nicht zu, weil keine Pakete hinzukommen und keine Werkzeugbeschreibung geändert wird (Pitch, Geänderte Dateien; SG-12). |
| H15 | siehe „Wem wir was glauben“; Telnyx, ElevenLabs, Stripe und WorkOS sind nicht berührt. |
| STRIDE am Feld `offset` hinter `internalOnly` | Tampering → T1 (Markieren ohne Liefern); Denial of Service → T2. Kein konkreter Weg für Spoofing und Elevation of Privilege, weil `offset` weder Identität noch Tenant bestimmt (`src/routes/api-inbox.js:11-12`, `src/routes/_tenant.js:44-51`). Information Disclosure entfällt, weil nur Einträge desselben Tenants geliefert werden, die derselbe Aufrufer schon über den Export bekommt. Repudiation entfällt, weil die Rückschau nichts verändert und die Audit-Zeile bleibt. Ein negatives oder gebrochenes `offset` liefert ohne Prüfung eine falsche Seite desselben Tenants; das ist ein Fehler im Ergebnis und kein Angriffsweg, und S2 im Pitch schließt es aus. |
| LINDDUN für die angerufene Person | trifft nicht zu, weil kein ausgehender Anruf berührt wird. Für den Anrufer bei eingehenden Anrufen gilt: Seine Daten bekommt kein neuer Empfänger (nur derselbe Tenant, der sie schon über den Export sieht), sie werden nicht länger gespeichert und nicht mit anderen Daten verknüpft. |

## 4. Offene Fragen
- Angenommen: Im Betrieb auf Render erreicht nur der eigene Prozess die Route über Loopback ohne `X-Forwarded-For`; kein vorgeschalteter Dienst verbindet sich über 127.0.0.1 ohne diesen Kopf. Ändert: T2 (dann von außen erreichbar und nicht mehr hinnehmbar). Prüfen durch: in der Render-Dokumentation nachlesen, von welcher Adresse eingehende Verbindungen kommen und ob sie immer `X-Forwarded-For` tragen. Gegen den laufenden Dienst wird dabei nichts versucht.
- Angenommen: `check_inbox` bekommt kein `offset`, solange T2 hingenommen ist. Ändert: T2 (der Agent des Kunden liest fremde Zusammenfassungen, SG-10, und könnte zum Weiterblättern mit großem `offset` gebracht werden). Prüfen durch: die Frage „Kann warten“ im Pitch beim späteren Paket mit dieser Prüfung verbinden.

## 5. Vorschlag für docs/sicherheitsgrenzen.md
keiner, weil keine neue Grenze entsteht: `POST /api/inbox/poll` steht schon mit SG-02 und SG-10 in der Angriffsfläche, und `offset` bleibt hinter `internalOnly`. Bekommt `check_inbox` später ein `offset`, gehört SG-09 zur Zeile `check_inbox` (T2).

## 6. Gegenprüfung

| Nr. | Art | Bezug | Befund | Ausgang |
|---|---|---|---|---|
| G1 | Szenario prüft nicht | T1 / B1 | B1 mit `{"offset":20}` bliebe grün bei einer Route, die `offset` unter einer lockereren Bedingung liest als `include_seen === true` (`src/routes/api-inbox.js:13`); `{"include_seen":"true","offset":20}` markierte dann 40 Einträge im verbrauchenden Abruf und lieferte nur die ab `offset` (`src/store/state-ops.js:417`). | B1 umgeschrieben auf `{"include_seen":"true","offset":20}`; wird rot sowohl ohne Bedingung als auch mit lockererer Bedingung. |
| G2 | Widerlegungsversuch T2 | T2 | Der Export `GET /api/tenant-data/export` (`src/routes/api-read.js:59-69`) wächst linear, die Rückschau mit `offset` mit Einträgen mal Aufgaben (`src/store/state-ops.js:400-404`). Widerlegung gescheitert, T2 bleibt neu. | keine Änderung; T2 hingenommen wie oben. |
| G3 | Neuer Weg zu fremden Daten oder Kosten | – | Keiner: Tenant-Filter vor Sortieren und Schneiden (`src/store/state-ops.js:407-413`), kein Anruf, keine SMS, keine Kosten. | keine Änderung |

