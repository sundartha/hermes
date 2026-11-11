# P-2656 Kennzahlen-Sichten: Sicherheitsprüfung

Status: freigegeben
Grundlage: pitch.md, design.md (Migrationsweg; Neulauf zur Fassade, design.md Zur Freigabe 8), Code-Stand e62cd1a

## Zur Freigabe
1. Die schwersten Angriffswege:
   - T1: Die neue Leserolle liest Einzelzeilen aller Mandanten mit Nummern und E-Mail-Adressen.
   - T3: Ein abgeflossener Login der Leserolle erschöpft die Verbindungen der Produktionsdatenbank oder legt Objekte an, die Abfragen der App-Rolle erreichen.
   - T8: Das neue Überspringen bei `42501` verschluckt den Rechtefehler einer anderen Migration, sodass ein Zeilenschutz still fehlt.

   Der Neulauf zur Fassade (02.11.) ändert daran nichts und findet keinen neuen Angriffsweg (Abschnitt 1, Eingang „Fassade“). Entspricht das deiner Einschätzung?
2. Fehlt dir ein Angriffsweg, der dich beunruhigt?
3. Zu entscheiden:
   1. T4: hinnehmen vorgeschlagen, weil kein Messwert eine Kennung trägt und gröbere Werte das Ziel „spätestens 3 Minuten“ aufgäben. Am 02.11. schon so entschieden, unter der Bedingung „Grafana nur Betreiber, EU, Auftragsverarbeitungsvertrag“. Der Migrationsweg ändert daran nichts. Empfehlung: bestätigen.
   2. T5: übertragen an B12 vorgeschlagen, weil fehlende Daten nur ein Alarm in Grafana sichtbar macht. Neu kommen zwei Ursachen dazu: die übersprungene Migration (nur eine Logzeile) und eine Leserolle, deren Zugangsdaten für den Lauf unbrauchbar gemacht wurden. Empfehlung: übertragen.
   3. T7: hinnehmen vorgeschlagen, weil eine Login-Rolle innerhalb ihrer Verbindungen immer Last und Sperren erzeugen kann. Am 02.11. als Rest von G1 schon hingenommen. Empfehlung: bestätigen.
   4. T9: hinnehmen vorgeschlagen, weil ein gescheiterter Deploy die alte Instanz weiterlaufen lässt und nichts an den Gates ändert. Bedingung ist die offene Frage zur Dauer der Schreibtransaktion. Empfehlung: hinnehmen, wenn die längste Schreibtransaktion deutlich unter 5 s liegt, sonst neu bewerten.
   5. Neue Szenarien zu T1 (Spaltenrecht, Recht über `PUBLIC`): Die Rollenprüfung des Laufs zählt auch Spaltenrechte und Rechte, die die Rolle über `PUBLIC` hat. Empfehlung: ja.
   6. Neues Szenario zu T3 (`CREATE` auf der Datenbank): Die Rollenprüfung lehnt auch eine Rolle ab, die Schemas anlegen darf. Empfehlung: ja.
   7. Neues Szenario zu T8: `applySchema` überspringt bei `42501` nur die Kennzahlen-Migration, jeder Rechtefehler einer anderen Migration bricht den Start ab. Empfehlung: ja.
   8. SG-26 mit den Belegen des Migrationswegs statt `src/db/schema.sql` (Abschnitt 5). Empfehlung: ja.
   9. Neu im Neulauf: SG-26 bekommt zwei weitere Mechanismus-Belege, „Lauf nur über die Fassade `src/store.js`, höchstens ein Takt zugleich“ und „Rollenname als eine Konstante in `src/db/migrate.js`“ (Abschnitt 5). Empfehlung: ja.

## 1. Woran arbeiten wir
### Umfang
Neu ist die Migration `src/db/migrations/0002_kennzahlen.sql`. Sie legt das Schema `kennzahlen` an, die Sicht `kennzahlen.messwerte`, die nur lesende Zeilenschutz-Regel `kennzahlen_lesen` auf `call` sowie `REVOKE`/`GRANT` für die Rolle `kennzahlen_leser` (design.md, Lösung, Migration).

`src/db/migrate.js` ändert sich an drei Stellen:
- Die Migration wird eingetragen.
- Sie läuft nur, wenn die Rolle existiert, und wird bei `42501` übersprungen.
- Vor jeder Migration steht `SET LOCAL lock_timeout` (design.md, Lösung, Start).

Dazu kommen ein neues Geheimnis `KENNZAHLEN_DATABASE_URL` und ein Minutenlauf, der Summen über eine eigene Verbindung an B3 gibt (design.md, Lösung, Lauf).

Neulauf (Betreuung 02.11., design.md, Zur Freigabe 8):
- Der Lauf in `src/store/kennzahlen.js` ist nur über die Fassade `src/store.js` erreichbar. Sie reicht `starteKennzahlenLauf`, `kennzahlenTakt` und `kennzahlenMomentaufnahme` weiter, auf demselben Weg wie heute `classifyCallTime` und `MAX_CALL_DURATION_CAP_S` (`src/store.js:196-198`).
- `src/boot.js` ruft `store.starteKennzahlenLauf()` und übergibt `store.kennzahlenMomentaufnahme` an B3; Tests erreichen die drei über die Fassade nach dem Hermes-Start (design.md, Lösung, Lauf).
- Der Rollenname `kennzahlen_leser` steht als exportierte Konstante in `src/db/migrate.js`, und `kennzahlen.js` importiert ihn von dort (design.md, Lösung, Beteiligte).
- Heute gibt es weder `src/store/kennzahlen.js` noch einen dieser Exporte (`src/store.js:36-200`, `src/db/migrate.js:1-184`).

Kein Werkzeug, keine Route und kein Webhook ändert sich (design.md, Werkzeugvertrag). Der Lauf löst keinen Anruf und keine SMS aus und schreibt nicht (pitch.md B1).

Heute führt `applySchema` jede eingetragene Migration bei jedem Start aus, je mit einem `exec` auf einem einzigen Client (`src/db/migrate.js:21-23`, `src/store/pg.js:32-35`, `src/store/pg-runner.js:6-15`). Jeder Fehler beendet den Prozess (`src/store.js:21-31`).
### Beteiligte
- Betreiber: legt `kennzahlen_leser` als App-Rolle über `psql` an und setzt `KENNZAHLEN_DATABASE_URL` im Render-Dashboard (design.md, Übergang, Einschalten 2 und 3). Sieht Grafana (angenommen: nur er).
- Inhaber der Zugangsdaten von `kennzahlen_leser`: im Normalfall nur der Lauf, nach einem Abfluss jeder, der sie hat. Darf sich an der Produktionsdatenbank anmelden. Rechte nach Entwurf nur `USAGE` auf `kennzahlen` und `SELECT` auf die Sicht (design.md, Lösung, Migration 5). Wie jede gewöhnliche Rolle darf sie ihr eigenes Passwort und ihre eigenen Sitzungsvorgaben ändern (Postgres-Doku ALTER ROLE).
- App-Rolle (`DATABASE_URL`, `src/config.js:616`):
  - Besitzt Tabellen, Sicht und Regel und führt die Migration aus.
  - Ist weder Superuser noch `BYPASSRLS` (`src/portal-pool.js:22-35`).
  - Hat nach Annahme `CREATEROLE` und `CREATE` auf der Datenbank (design.md, Zur Freigabe 5).
- Module im Prozess (neu betrachtet im Neulauf): jede Datei unter `src/`, die die Fassade importiert (etwa `src/server.js:3`, `src/claude.js:3`, `src/consult/in-call.js:2`). Nach der Änderung kann jede von ihnen die drei Funktionen aufrufen. Sie läuft mit den Rechten von Hermes, liest `config.store` mit der Adresse des Pools schon heute (`src/config.js:907,914-926`) und über die Fassade jede Zeile des Speichers.
- Kunde und Agent des Kunden: erzeugen Anrufe, Konten und Abos, deren Summen gezählt werden. Sie sehen keine Messwerte. Ihre normale Nutzung verlängert die Schreibtransaktion der laufenden Instanz (`src/store/pg.js:1206-1226`).
- Angerufener und Anrufer bei eingehenden Anrufen: Ihre Anrufe gehen als Zählwert, Dauer und Ergebnis in die Summen ein. Ihre Nummern stehen in `call` (`src/db/migrations/0001_ausgang.sql:218-219`).
- Anbieter: Render (Postgres, Umgebungsvariablen, Logs, Deploy-Ablauf) und Grafana Labs als Empfänger des Exports (über B3, angenommen).
### Eingänge und Grenzen
- Postgres-Anmeldung `kennzahlen_leser`: neuer Login auf die Produktionsdatenbank neben der App-Rolle. Beleg: design.md, Übergang, Einschalten 2. Angriffswege: T1, T3, T5, T6, T7
- Regel `kennzahlen_lesen` auf `call`: verschiebt die Mandantengrenze. Für die Sitzung `kennzahlen_leser` sind Zeilen aller Mandanten sichtbar, für jede andere Sitzung bleibt es bei `tenant_isolation` (`src/db/migrations/0001_ausgang.sql:1054-1055,1101-1104`; design.md, Lösung, Migration 4). Angriffswege: T1
- Rechtevergabe in der Migration (`REVOKE ALL ON ALL TABLES IN SCHEMA public`, `GRANT` auf Schema und Sicht). Diese Grenze entscheidet, was die Rolle direkt lesen darf; sie läuft nur bei einem erfolgreichen Lauf der Migration. Beleg: design.md, Lösung, Migration 5 und Start 2 bis 4. Angriffswege: T1
- Sicht `kennzahlen.messwerte`: Grenze von Einzelzeilen zu Summen mit festem Raster. Auf der einen Seite stehen `call` mit Nummern (`src/db/migrations/0001_ausgang.sql:211-219`) und `account` mit `email` ohne Zeilenschutz (`:985-991`). Beleg: design.md, Lösung, Migration 3. Angriffswege: T1, T4.
  - Eine Bedingung des Aufrufers, die bis an die Zeilen der Sicht reicht: keiner, weil jede Ausgabespalte der Sicht eine feste Labelausprägung oder eine Summe ist. Eine solche Bedingung sieht deshalb keine Nummer und keine Kennung. Temporäre Objekte der Rolle wirken nur in ihrer eigenen Sitzung.
- Startpfad `applySchema` (geändert: Bedingung „Rolle existiert“, Überspringen bei `42501`, `lock_timeout`): Grenze zwischen Datenbankrechten, Sperren und Verfügbarkeit. Beleg: `src/db/migrate.js:21-23,177-184`, `src/store.js:21-31`. Angriffswege: T6, T8, T9.
  - Die Bedingung „Rolle existiert“ selbst: keiner, weil nur Inhaber von `CREATEROLE` eine Rolle anlegen können (angenommen: nur App-Rolle und Betreiber).
  - Ein `lock_timeout`, der in den Pool zurückgeht: keiner, weil `SET LOCAL` mit der Transaktion endet und außerhalb einer Transaktion gar nicht wirkt (design.md, Ausgangslage, Zeile `SET LOCAL`).
  - Rollenname an zwei Stellen, als Konstante in `src/db/migrate.js` für die Bedingung und als Wortlaut in `0002` für Regel, `REVOKE`, `GRANT` und Verbindungsgrenze (neu im Neulauf; design.md, Lösung, Beteiligte, und Nachteile): keiner. Alle Rechte und die Regel stehen in derselben Migration und laufen ganz oder gar nicht. Weicht die Konstante vom Wortlaut ab, läuft die Migration nicht, oder sie scheitert an einer unbekannten Rolle, und das bricht den Start ab (design.md, Start 2 und 3; `src/store.js:21-31`). Das fiele in den Tests von S13 und S22 auf. Keiner der beiden Fälle gibt einer Rolle ein Recht. Die Rollenprüfung des Laufs prüft Rechte und Attribute der angemeldeten Rolle, nicht ihren Namen (design.md, Lösung, Lauf 2).
- Fassade `src/store.js` zum Lauf in `src/store/kennzahlen.js` (neu im Neulauf): Grenze zwischen dem übrigen Prozess und Verbindung, Geheimnis und Momentaufnahme des Laufs. Beleg: design.md, Lösung, Lauf, und Datenfluss; Import aus `src/store/` außerhalb der Fassade ist verboten (`.dependency-cruiser.cjs:33-40`). Es ist eine Ordnungsgrenze im Prozess, keine Rechtegrenze. Angriffswege: keiner, im Einzelnen:
  - Kunde, Agent des Kunden, Angerufener oder Anrufer lösen einen Takt aus oder lesen die Momentaufnahme: keiner, weil kein Werkzeug, keine Route und kein Webhook die drei Funktionen ruft (design.md, Werkzeugvertrag). Aufrufer ist nur `src/boot.js` (design.md, Lösung, Lauf). In `src/` ruft keine Stelle eine Funktion der Fassade über einen Namen aus einer Eingabe auf (Suche nach `store[` in `src/`: 0 Treffer). Dass es so bleibt: Offene Fragen.
  - Ein Modul im Prozess löst einen Takt aus, auch während der Minutentakt läuft: keiner. Gleichzeitige Aufrufe bekommen den laufenden Takt (`makeKeyedSingleFlight`, `src/single-flight.js:12-18`). Ein Takt liest nur, hält höchstens eine eigene Verbindung und endet nach 5 s (design.md, Lauf 1 und 5), und die Rolle bekommt höchstens zwei Verbindungen (T3). Ein Takt kostet nichts bei Telnyx oder ElevenLabs. Ein Takt außerhalb der Bedingungen von B4 meldet nur, wenn die Rollenprüfung besteht (design.md, Lauf 2).
  - Ein Modul liest die Momentaufnahme: keiner, weil sie nur Summen mit festen Labelausprägungen ohne Mandant enthält (S9 im Pitch). Jedes solche Modul liest Einzelzeilen schon heute über die Fassade.
  - Das Geheimnis `KENNZAHLEN_DATABASE_URL` über die Fassade: keiner, weil die Fassade nur die drei Funktionen weiterreicht. Verbindung und Adresse bleiben in `src/store/kennzahlen.js` (design.md, Datenfluss). Die Adresse steht im Namensraum `config.store`, den jedes Modul schon heute lesen kann (`src/config.js:907,914-926`). Das stand schon vor dem Neulauf so im Entwurf. Fehlertexte im Log: T2.
  - Das Laden der Fassade startet den Lauf: keiner, weil der Minutentakt erst mit `starteKennzahlenLauf()` beginnt (design.md, Lauf). `src/boot.js` ruft ihn nach den Boot-Gates (`src/boot.js:726-731`) und nur unter den drei Bedingungen von B4 (design.md, Lauf). Dass das Laden von `kennzahlen.js` keine Verbindung öffnet, ist angenommen (Offene Fragen).
- Umgebungsvariable `KENNZAHLEN_DATABASE_URL` zu Logs: Grenze zwischen Geheimnis und Logausgabe. Beleg: `src/log-maske.js:5-6,14-21`, aufgerufen in `src/config.js:24`. Angriffswege: T2
- Momentaufnahme an B3, OTLP und Grafana: Summen verlassen Hermes. Beleg: design.md, Lösung, Lauf 6. Angriffswege: T4. Labelwerte aus Tabelleninhalt: keiner, weil jede Ausprägung aus einer festen Liste der Sicht stammt (design.md, Lösung, Migration 3; S9, S10 im Pitch).
- Kunden, Angerufene und Anrufer über ihre Daten:
  - In die Sicht: keiner, weil sie Zeilen nur über die bestehenden Eingänge mit Kosten- und Stundengrenzen erzeugen (SG-09). Außerdem lässt die Sicht unlesbare Zeiten und Nicht-Listen in `consults` aus, statt abzubrechen (design.md, Regeln in der Sicht).
  - Über die Länge der Schreibtransaktion: T9.
### Werte
- Einzelzeilen aus `call`, `account` und `transcript_segment` aller Mandanten: Nummern, Auftragstexte, Zusammenfassungen, E-Mail-Adressen, Gesprächsinhalte.
- Zeilenschutz je Mandant für jede Tabelle, die eine Migration anlegt oder ändert. Er ist die zweite Linie gegen vergessene Filter (`src/db/migrations/0001_ausgang.sql:1048-1051`).
- Verfügbarkeit der Produktionsdatenbank und des Starts. Ohne sie nimmt Hermes keine Anrufe an und prüft keine Gates.
- Möglichkeit zu deployen, auch für eilige Fehlerbehebungen.
- Zugangsdaten von `kennzahlen_leser`.
- Verlauf einzelner Anrufe: Dauer, Ergebnis und Zielerreichung eines Gesprächs mit einer Person.
### Wem wir was glauben
- Postgres:
  - `REVOKE` nimmt nur Rechte, die die App-Rolle als Eigentümer oder ein Superuser vergeben hat. Rechte über `PUBLIC` oder eine Mitgliedschaft bleiben. Ein `REVOKE` auf eine Tabelle, auf die die App-Rolle gar kein Recht hat, scheitert ganz (Postgres-Doku REVOKE, Notes).
  - `current_user` in einer Sicht ist der Aufrufer (design.md, Ausgangslage).
  - Mehrere Anweisungen in einem `exec` laufen als eine Transaktion, ganz oder gar nicht (design.md, Ausgangslage).

  Stimmt das nicht, ist T1 offen oder die Migration bleibt halb angelegt.
- Render: Der Internal Connection String ist nur aus dem Render-Netz erreichbar, und kein PgBouncer liegt dazwischen (design.md, Ausgangslage, letzte Zeilen). Wenn nicht, ist ein abgeflossener Login von außen nutzbar (T3, T7), und die Sitzungssperre gilt nicht.
- Betreiber: Er legt `kennzahlen_leser` ohne weitere Rechte und mit Verbindungsgrenze an. Wenn nicht, greifen T1 und T3. Die Rollenprüfung des Laufs macht das sichtbar (S23 bis S26 im Pitch).
- B3: lässt nur feste Labelnamen zu und setzt kein Label je Mandant (pitch.md, Grobe Lösung). Wenn nicht, hängt T4 von B3 ab.
- Code im Prozess (neu im Neulauf): Jedes Modul unter `src/` ist so vertrauenswürdig wie Hermes selbst. Die Fassade schützt nicht gegen eigenen Code, sondern ordnet Abhängigkeiten. Wenn ein Modul die Momentaufnahme an einen Kunden-Eingang weitergibt, gehen Summen aller Mandanten an Kunden (siehe Offene Fragen).
### Nicht-Ziele
- Diese Änderung schützt nicht gegen jemanden mit `DATABASE_URL`. Die App-Rolle liest schon heute jede Zeile, indem sie `app.current_tenant` je Mandant setzt (`src/store/pg.js:649-651`, `src/db/migrate.js:93-101`).
- Diese Änderung schützt nicht gegen einen übernommenen Grafana-Zugang, weil Export und Ziel zu B3 gehören (pitch.md, Nicht-Ziele).
- Diese Änderung schützt nicht gegen Code im eigenen Prozess, weil er Konfiguration und Speicher schon heute ganz liest (`src/config.js:907`, `src/store.js:36-190`).

## 2. Angriffswege
Entscheidungen der Betreuung am 02.11. (Antonio, Freigaben gibt die Betreuung), alle wie empfohlen:
- Schwerste Wege T1, T3, T8 bestätigt, kein weiterer Weg.
- Zu entscheiden 1 (T4): hingenommen, Bedingung Grafana nur Betreiber, EU, Auftragsverarbeitungsvertrag, Prüfung vor dem Einschalten durch Antonio.
- Zu entscheiden 2 (T5): übertragen an B12.
- Zu entscheiden 3 (T7): hingenommen; Rückweg vollständig (Design Doc, Rückweg).
- Zu entscheiden 4 (T9): hingenommen mit der Bedingung, die Flush-Dauer vor dem Einschalten zu messen und `lock_timeout` neu zu bewerten, wenn sie nicht deutlich unter 5 s liegt.
- Zu entscheiden 5, 6, 7 (neue Szenarien zu T1, T3, T8): angenommen; im Pitch als S30, S31, S32 und B6.
- Zu entscheiden 8 (SG-26 mit Belegen des Migrationswegs): angenommen.
- Zweite Gegenprüfung (03.11., Betreuung): G9 angenommen (neues Szenario S33 „Die Migration setzt die Verbindungsgrenze“; „nach dem Start“ im Gegeben von S23 und S25); G10 angenommen (Gegenprobe in S23 bis S26 und S30 bis S32; Erweiterung der Testhilfe, `CREATE` auf der Datenbank, `ADMIN OPTION` und eine Brücke für den eigenen `pg.Client` des Laufs, gehört in den Auftrag des Durchstich-Tests). Fassade und Rollenkonstante in `src/db/migrate.js` (Zu entscheiden 9) angenommen.
- Gegenprüfung G5: T1 geteilt (T1 „verhindern“, neu T10 „übertragen“ an B12 als Erkennen); `REVOKE … FROM PUBLIC` abgelehnt, vor dem Einschalten `\dp` prüfen. G6: `ALTER ROLE … CONNECTION LIMIT 2` angenommen; nimmt die Migrationsprüfung es nicht an, gilt T3 als „erkennen“, ohne Umgehung. G7: S22 geschärft. G8: Rückweg vollständig.

Neulauf zur Fassade (02.11.): kein neuer Angriffsweg. T1 bis T10 bleiben unverändert, weil die Fassade weder Rechte der Leserolle noch den Startpfad, die Log-Maske oder den Export berührt. Die Begründung je Verbindung steht in Abschnitt 1 unter „Fassade“ und „Startpfad“.

### T4: Bei wenigen Anrufen verrät der Minutenwert einen einzelnen Anruf
Wer: wer Grafana sieht, auch Grafana Labs als Empfänger des Exports
Weg: Der Lauf meldet jede Minute Tagessummen ohne Kennung (pitch.md, Ergebnis). Endet in einer Minute genau ein Anruf, ist der Zuwachs von `gespraechsdauer_sekunden_heute`, `zielerreichung_heute` und `anrufe_heute` genau dieser Anruf.
Schaden: Dauer und Ausgang eines bestimmten Gesprächs mit einer bestimmten Person werden für Grafana-Betrachter und den Grafana-Anbieter erkennbar, solange es wenige Anrufe gibt.
Ausgang: hinnehmen (angenommen am 02.11.), weil:
- kein Messwert eine Nummer, einen Namen oder einen Mandanten trägt (S9 im Pitch);
- der Rückschluss Vorwissen über den Anruf verlangt;
- Grafana nach Annahme nur der Betreiber sieht.

Am 02.11. unter dieser Bedingung so entschieden. Offen bleibt: Bei geringem Volumen sind Minutenzuwächse Einzelanrufe.

### T5: Der Lauf meldet nichts, und das fällt niemandem auf
Wer:
- kein Angreifer nötig: eine fehlende Rolle, ein fehlendes Recht oder eine falsch eingerichtete Rolle;
- jeder mit einer Datenbankanmeldung, auch einer abgeflossenen von `kennzahlen_leser`.

Weg:
- Bei `42501` wird die Migration mit nur einer Logzeile übersprungen (design.md, Lösung, Start 3).
- Bei zu vielen Rechten schweigt der Lauf (T1, T3).
- Ohne Sitzungssperre meldet der Lauf nicht (design.md, Lauf 3).
- Die Zugangsdaten der Rolle können für den Lauf unbrauchbar werden (design.md, Fehlerfälle, Zeile Verbindungsaufbau).

Schaden:
- Die acht Messwerte fehlen.
- Baut B12 Alarme auf `kosten_heute_cent`, sieht der Betreiber einen Kostenanstieg nicht.
- Bei einer überberechtigten Rolle (T1) bleibt das Lesen bis zur Entdeckung möglich.
- Die Gates bleiben unberührt, weil der Lauf nur liest (pitch.md B1).

Ausgang: übertragen an B12 (angenommen am 02.11.), weil eine Alarmregel auf fehlende Daten dort liegt (pitch.md, Nicht-Ziele) und diese Messwerte kein Sicherheits-Gate sind. Offen bleibt: Ein dauerhaft schweigender Lauf fällt nur über eine solche Regel oder das Log auf.

### T7: Ein abgeflossener Login belastet die Datenbank oder hält neue Starts an
Wer: Inhaber abgeflossener Zugangsdaten von `kennzahlen_leser`
Weg:
- Innerhalb der höchstens zwei Verbindungen (T3) kann jede Login-Rolle Rechenzeit, Speicher und Sperren beanspruchen.
- Mit `lock_timeout` (T6) scheitert jeder neue Start, solange sie eine Lesesperre hält.
- Auf dem Free-Plan startet Render den Dienst nach jedem Einschlafen neu (design.md, Ausgangslage, Render-Doku Free).

Schaden: Solange der Login so genutzt wird, kommt nach einem Einschlafen oder Deploy keine neue Instanz hoch, und eingehende Anrufe werden nicht angenommen. Die Datenbank kann langsamer werden.
Ausgang: hinnehmen (angenommen am 02.11.), weil:
- eine Login-Rolle das immer kann;
- die Rolle ihre Fristen selbst setzt;
- der Rückweg ohne Deploy besteht: `ALTER ROLE kennzahlen_leser NOLOGIN` und Beenden ihrer Sitzungen. Die App-Rolle darf das ab PG16 erst nach `GRANT kennzahlen_leser TO <App-Rolle> WITH INHERIT TRUE` oder mit `pg_signal_backend`; beides steht im Rückweg des Design Docs (Gegenprüfung G8), die Prüfung `pg_has_role` vor dem Einschalten.

Am 02.11. als Rest von G1 hingenommen. Offen bleibt: Bis der Betreiber eingreift, startet keine neue Instanz.

### T9: Normale Last der laufenden Instanz lässt Deploys scheitern
Wer: kein Angreifer. Kunden durch normale, bezahlte Nutzung.
Weg:
- Die laufende Instanz schreibt alle Mandanten mit allen Anrufen der Aufbewahrungsfrist in einer Transaktion (`src/store/pg.js:1206-1226`). Diese Transaktion hält Schreibsperren auf `tenant` und `call`.
- Mit `lock_timeout` 5 s vor `0001` (T6) scheitert der Start der neuen Instanz, wenn diese Transaktion beim Sperrversuch länger als 5 s läuft. Heute wartet er (design.md, Nachteile).
- Mit mehr Mandanten und Anrufen wird die Transaktion länger.

Schaden: Deploys scheitern, auch eilige Fehlerbehebungen, bis die Last sinkt oder der Betreiber die alte Instanz anhält. Die Gates bleiben unberührt, weil ein gescheiterter Start nichts ausführt und die alte Instanz weiterläuft (Render-Doku Deploys, design.md, Ausgangslage).
Ausgang: hinnehmen (angenommen am 02.11.), weil der Schaden heute nur bei langer Schreibtransaktion eintritt und S27 eine feste Grenze braucht. Bedingung: die offene Frage zur längsten Schreibtransaktion. Offen bleibt: Ab einer bestimmten Last braucht ein Deploy einen ruhigen Moment.

### T10: Rechte der Leserolle, die das `REVOKE` nicht erreicht
Wer: Inhaber der Zugangsdaten von `kennzahlen_leser`
Weg:
- Das `REVOKE` der Migration nimmt keine Rechte, die die Rolle über `PUBLIC` oder eine Mitgliedschaft hat, und keine Rechte, die nach dem letzten erfolgreichen Lauf der Migration vergeben werden (Postgres-Doku REVOKE). Das gilt auch für ein Spaltenrecht, etwa auf `account.email`; `transcript_segment` liest man über `set_config('app.current_tenant', …)`, das jede Rolle setzen darf (`src/db/migrations/0001_ausgang.sql:1106-1108`).
- Wird die Migration bei `42501` übersprungen, bleiben Regel und Rechte eines früheren Laufs stehen.

Schaden: wie T1, Einzelzeilen aller Mandanten bei einem Fremden, bis jemand es bemerkt.
Ausgang: übertragen an B12 (Gegenprüfung G5, angenommen am 02.11.): Erkennen statt Verhindern. Die Rollenprüfung des Laufs schaltet nur den Lauf stumm und nimmt kein Recht weg (S23, S24, S30, S31); der Alarm auf fehlende Daten in B12 ist die Bedingung dafür, dass jemand es bemerkt (T5). Ein `REVOKE … FROM PUBLIC` in der Migration ist abgelehnt, weil es jede andere Rolle träfe, die über `PUBLIC` liest; vor dem Einschalten prüft der Betreiber `\dp`.

## 3. Lückenprüfung
| Punkt | Ergebnis |
|---|---|
| H1, H2, H3, H6, H8, H9 | trifft nicht zu, weil der Lauf und die Migration keinen Anruf, keine SMS und keinen Werkzeugaufruf auslösen, nur lesen bzw. Schema anlegen und keinen Eingang für Kunden, Angerufene oder Anrufer haben (pitch.md B1; design.md, Werkzeugvertrag). Die Fassade ändert daran nichts: Ein Takt über `kennzahlenTakt` liest nur (Abschnitt 1, Fassade) |
| H4 | trifft nicht zu für Kunden, weil Messwerte nicht an Kunden gehen und keinen Mandanten tragen (S9 im Pitch). Über die Momentaufnahme als Zwischenspeicher im Prozess, jetzt über die Fassade lesbar: trifft nicht zu, weil kein Kunden-Eingang sie liest (design.md, Werkzeugvertrag; Offene Fragen). Über die neue Rolle trifft es zu → T1. Über das Überspringen von Rechtefehlern → T8 |
| H5 | trifft nicht zu, weil die Änderung keine Tokens annimmt oder weiterreicht |
| H7 | trifft nicht zu, weil keine Worte des Angerufenen an den Agenten des Kunden gehen; die Sicht zählt nur die Länge von `consults` (design.md, Regeln in der Sicht) |
| H10 | trifft nicht zu, weil die Änderung keinen Webhook empfängt. Doppelte Melder bei zwei Instanzen verhindert die Sitzungssperre (S16 im Pitch). Abrechnung und Anrufstatus werden nicht berührt |
| H11 | trifft nicht zu, weil der Lauf selbst nichts sendet; die OTLP-Adresse setzt der Betreiber, der Export gehört zu B3 (design.md, Lösung, Lauf) |
| H12 | trifft zu → T4 für Dauer und Ausgang. Stimme und Worte trifft es nicht, weil die Sicht weder Transkript noch Inhalt von `consults` ausgibt. Logzeilen bei Fehlern laufen über die bestehende Maske (SG-13). Punkt für die rechtliche Prüfung: Ist der Minutenzuwachs bei wenigen Anrufen ein personenbezogenes Datum, das an Grafana Labs geht? |
| H13 | trifft zu → T2, T3, T7. Neuer Schlüssel `KENNZAHLEN_DATABASE_URL` im Render-Dashboard neben `DATABASE_URL` (`render.yaml:327`); wer das Dashboard liest, hat schon `DATABASE_URL` und gewinnt nichts dazu. Die Fassade reicht weder Adresse noch Verbindung weiter (Abschnitt 1, Fassade) |
| H14 | trifft nicht zu, weil `pg` schon Abhängigkeit ist (design.md, Ausgangslage) und der Export zu B3 gehört |
| H15 | siehe „Wem wir was glauben“. Telnyx, ElevenLabs, Stripe und WorkOS berührt die Änderung nicht, Stripe nur über bereits gespeicherte Abo-Felder |
| STRIDE an der Anmeldung `kennzahlen_leser` | Spoofing → T2 (wer die Zugangsdaten hat, ist die Rolle); Information Disclosure, Elevation of Privilege → T1, T3; Denial of Service → T3, T6, T7; Repudiation → T5. Tampering ohne Weg, weil die Rolle kein Schreibrecht hat und ihre eigenen Sitzungsvorgaben nur ihre eigenen Sitzungen betreffen |
| STRIDE an der Regel `kennzahlen_lesen` | Information Disclosure → T1. Tampering ohne Weg, weil die Regel nur für `SELECT` gilt und bei Schreibzugriffen weiter `tenant_isolation` entscheidet. Spoofing ohne Weg, weil eine Sitzung nur mit den Zugangsdaten oder über eine Mitgliedschaft zu `kennzahlen_leser` wird, und die App-Rolle, die sich eine Mitgliedschaft geben könnte, ohnehin alles liest (Nicht-Ziele) |
| STRIDE an Rechtevergabe und Startpfad `applySchema` | Elevation of Privilege und Information Disclosure → T1 (`REVOKE` erreicht nicht jedes Recht); Tampering → T8 (Überspringen über die Kennzahlen-Migration hinaus); Denial of Service → T6, T9; Repudiation → T5 (nur eine Logzeile). Spoofing ohne Weg, weil die Bedingung „Rolle existiert“ nur Inhaber von `CREATEROLE` erfüllen können. Information Disclosure über die Logzeile beim Überspringen ohne Weg, weil die Fehlermeldung von Postgres nur Objektnamen nennt. Die Rollenkonstante in `src/db/migrate.js` öffnet keinen Weg, weil eine Abweichung vom Wortlaut der Migration nur zu einem übersprungenen oder abgebrochenen Start führt, nie zu einem Recht (Abschnitt 1, Startpfad) |
| STRIDE an der Fassade `src/store.js` zum Lauf (neu im Neulauf) | ohne Weg. Spoofing und Elevation of Privilege nicht, weil nur Code im Prozess aufruft, der Konfiguration und Speicher schon ganz liest. Tampering nicht, weil der Lauf nur liest. Information Disclosure nicht, weil nur Summen ohne Kennung herausgehen und kein Geheimnis. Denial of Service nicht, weil gleichzeitige Takte geteilt werden (`src/single-flight.js:12-18`) und die Rolle höchstens zwei Verbindungen hat (T3). Repudiation nicht, weil ein Takt nichts verändert |
| STRIDE an Sicht und Export | Information Disclosure → T4. Tampering ohne Weg, weil die Labelwerte aus festen Listen stammen und nur die App-Rolle die Sicht ersetzen kann (`CREATE OR REPLACE VIEW` verlangt Eigentum, design.md, Ausgangslage). Denial of Service durch Daten ohne Weg, weil die Sicht unlesbare Werte auslässt und ein Fehler im Lauf bleibt (S11, S12 im Pitch) |
| LINDDUN für die angerufene Person | Identifiability, Linkability und Detectability treffen zu → T4. Disclosure trifft zu → T1 (Nummern der Angerufenen in `call`). Unawareness und Non-repudiation treffen nicht zu, weil weder Inhalt noch Kennung die Datenbank über die Kennzahlen verlässt. Non-compliance → rechtliche Frage bei H12. Die Fassade ändert daran nichts, weil die Momentaufnahme dieselben Summen trägt wie der Export |

## 4. Offene Fragen
- Angenommen: Das Schema `public` der Produktionsdatenbank ist nicht für alle beschreibbar, und der Suchpfad der App-Rolle ist der Standard. Ändert: T3. Prüfen durch: als App-Rolle `has_schema_privilege('public', 'public', 'CREATE')`, `SHOW server_version` und `SHOW search_path` abfragen.
- Angenommen: Die Datenbank ist von außerhalb von Render nicht oder nur von festen Adressen erreichbar. Ändert: T3, T7. Prüfen durch: Zugriffsregeln der Datenbank im Render-Dashboard ansehen.
- Angenommen: Das Serverlog von Postgres schreibt Rollenanweisungen nicht mit. Ändert: T2 (Passwort beim Anlegen im Serverlog). Prüfen durch: als App-Rolle `SHOW log_statement`.
- Angenommen: Grafana sieht nur der Betreiber, und die Daten liegen in einer EU-Region unter einem Vertrag zur Auftragsverarbeitung. Ändert: T4. Prüfen durch: Nutzerliste und Region des Grafana-Kontos ansehen; bei B3 nachfragen.
- Angenommen: B12 plant Alarme auf fehlende Daten oder auf `kosten_heute_cent`. Ändert: T5. Prüfen durch: Plan von B12 lesen.
- Angenommen: Die längste Schreibtransaktion der laufenden Instanz liegt deutlich unter 5 s. Ändert: T9. Prüfen durch: Dauer des Flushs (`src/store/pg.js:1206-1226`) in einem Lasttest mit der erwarteten Zahl von Mandanten und Anrufen messen oder vom Betreiber in Produktion messen lassen.
- Angenommen: Auf dem Postgres-Server der Produktion liegt keine weitere Datenbank, für die jemand eine Rolle `kennzahlen_leser` anlegt; Rollen gelten für den ganzen Server. Ändert: T1, T3 (eine anderswo angelegte Rolle schaltet die Migration hier ein und hätte dieselben Zugangsdaten). Prüfen durch: als App-Rolle `SELECT datname FROM pg_database`.
- Angenommen (neu im Neulauf): Außer `src/boot.js` ruft kein Modul in `src/` `starteKennzahlenLauf`, `kennzahlenTakt` oder `kennzahlenMomentaufnahme`, und kein Werkzeug und keine Route gibt die Momentaufnahme aus. Außerdem öffnet das Laden von `src/store/kennzahlen.js` keine Verbindung und startet keinen Zeitgeber. Ändert: H4 und T4, weil Summen aller Mandanten dann bei Kunden lägen; T3, weil jeder Prozess, der die Fassade lädt, eine Verbindung der Rolle belegen würde. Prüfen durch: im Bau und beim Prüfer die drei Namen in `src/` suchen (Treffer nur in `src/store.js`, `src/store/kennzahlen.js` und `src/boot.js`) und die oberste Ebene von `kennzahlen.js` lesen.

## 5. Vorschlag für docs/sicherheitsgrenzen.md
Neue Katalogzeile SG-26 (ersetzt den Vorschlag vom 02.11., der `src/db/schema.sql` nannte; im Neulauf um Fassade und Rollenkonstante ergänzt):
- Angriff: „Die Kennzahlen-Leserolle oder die Regel `kennzahlen_lesen` liefert Einzelzeilen aus `call`, `account` oder `tenant` statt Summen, oder ihr Login belegt die Datenbank.“
- Verletzte Grenze: „Aus der Datenbank gehen über die Kennzahlen nur Summen ohne Kennung; die Leserolle liest nur `kennzahlen.messwerte`.“
- Mechanismus:
  - `REVOKE` auf `public` und Rechte nur `USAGE` auf `kennzahlen` und `SELECT` auf die Sicht, Verbindungsgrenze 2 (`src/db/migrations/0002_kennzahlen.sql`);
  - Überspringen bei `42501` nur für diese Migration, `lock_timeout` vor jeder Migration (`src/db/migrate.js` `applySchema`, heute `:21-23`);
  - Rollenname `kennzahlen_leser` als eine exportierte Konstante in `src/db/migrate.js`, genutzt von `applySchema` und `src/store/kennzahlen.js`; in SQL nur in `0002_kennzahlen.sql`;
  - Rollenprüfung im Lauf vor jeder Abfrage, mit Spalten- und `PUBLIC`-Rechten, `CREATE` auf Datenbank und `public` und Verbindungsgrenze (`src/store/kennzahlen.js`);
  - Lauf nur über die Fassade `src/store.js` (`starteKennzahlenLauf`, `kennzahlenTakt`, `kennzahlenMomentaufnahme`), Aufrufer nur `src/boot.js`; Verbindung und Adresse bleiben in `src/store/kennzahlen.js`; höchstens ein Takt zugleich (`makeKeyedSingleFlight`, `src/single-flight.js:10-20`);
  - Passwort in der Log-Maske (`src/log-maske.js`).
- Negativtest: „SG-26 kennzahlen_leser kann call, account und tenant nicht direkt lesen“.

Neuer Eingang außerhalb von HTTP: Postgres-Anmeldung `kennzahlen_leser`, Zugangsdaten in `KENNZAHLEN_DATABASE_URL`. Er bekommt keinen Eintrag in „Angriffsfläche“, weil der Abschnitt nur Werkzeuge, Routen und Webhooks führt. Die Fassade ist keine neue Grenze für den Katalog, weil sie im Prozess liegt und keinen Eingang von außen hat.

Neue Vertrauensannahmen:
- `KENNZAHLEN_DATABASE_URL` zeigt direkt auf Postgres im Render-Netz, nicht auf einen PgBouncer.
- Nur App-Rolle und Betreiber können Rollen anlegen.

## 6. Gegenprüfung

Gegenprüfung durch den Agenten `angreifer` am Stand dieses Dokuments (02.11.). Geprüft und ohne Befund: der Schutz zu T8 und sein Szenario (ohne die Beschränkung würde `0001` bei `42501` übersprungen, und „Prozess beendet sich“ würde rot), S27 (`0001` enthält kein eigenes `BEGIN`/`COMMIT`/`SET`, also wirkt `SET LOCAL` im selben `exec`), S28 und S29, die Annahme, dass über `LOCK` auf die Sicht nur `ACCESS SHARE` möglich ist, sowie `SECURITY DEFINER`-Funktionen und Vergaben an `PUBLIC` in `0001`, über die die Leserolle an der Sicht vorbeikäme (keine).

| Nr. | Art | Bezug | Befund | Vorschlag (steht in der Freigabeliste) |
|---|---|---|---|---|
| G5 | Schutz umgangen | T1 (Ausgang „verhindern“), S23, S24 und die zwei neuen T1-Szenarien | Wer abgeflossene Zugangsdaten hat, meldet sich direkt an Postgres an und kommt nie durch den Lauf. Die Rollenprüfung des Laufs schaltet nur den Lauf stumm und nimmt kein Recht weg. Spaltenrechte, Rechte über `PUBLIC`, Mitgliedschaften und Rechte, die nach dem letzten erfolgreichen Lauf vergeben wurden, bleiben lesbar (`account.email`; `transcript_segment` über `set_config('app.current_tenant', …)`, `src/db/migrations/0001_ausgang.sql:1106-1108`). Das Dann dieser Szenarien („meldet keinen Messwert“) zeigt nicht, dass der Schaden ausbleibt; T1 steht trotzdem auf „verhindern“. | T1 aufteilen (angenommen): T1 direkte Rechte in `public`: „verhindern“ über das `REVOKE` der Migration (S22); neu T10 `PUBLIC`, Mitgliedschaft, Rechte nach dem Lauf, Überspringen bei `42501`: „übertragen“ an B12 mit einem Alarm in B12 als Bedingung, oder „hinnehmen“. Für `PUBLIC` gibt es einen echten Schutz: `0002` führt zusätzlich `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC` aus (die App-Rolle besitzt die Tabellen); das berührt jede andere Rolle, die über `PUBLIC` liest, und braucht eine Entscheidung. |
| G6 | Schutz umgangen | T3 (Ausgang „verhindern“), S25, S26, neues Szenario `CREATE` auf der Datenbank | Ein Login ohne Verbindungsgrenze erschöpft die Verbindungen, auch wenn der Lauf schweigt; die Grenze setzt nur der Betreiber von Hand. Dasselbe gilt für `CREATE` auf der Datenbank: ein Schema mit dem Namen der App-Rolle liegt im Standard-Suchpfad vor `public` und kann unqualifizierte Tabellen der App überdecken. | `0002` setzt unter der Bedingung „Rolle existiert“ `ALTER ROLE kennzahlen_leser CONNECTION LIMIT 2`. Ob die App-Rolle das darf (unter PG16 hat sie als Anlegerin `ADMIN OPTION`) und ob Migrationsprüfung und Squawk es annehmen, prüft der Bau; sonst T3 als „erkennen“ einstufen. |
| G7 | Szenario prüft nicht | T1, S22 | Im Gegeben von S22 bekommt die Rolle nur ein Recht auf `call`. Die Ablehnung bei `account` und `tenant` ist auch ohne `REVOKE` grün, weil dort nie ein Recht vergeben wurde. Ein schmaleres `REVOKE` (nur `ON call`) besteht S22, und ein vorher vergebenes Recht auf `account` (E-Mail, kein Zeilenschutz, `src/db/migrations/0001_ausgang.sql:982-991`) bliebe bestehen. | Im Gegeben vor dem Start auch `SELECT` auf `account` und `tenant` vergeben. Das ändert den Wortlaut von S22. |
| G8 | Schutz umgangen | T7 (Grund „Rückweg ohne Deploy“), Freigabe 3.3 | `ALTER ROLE … NOLOGIN` beendet keine offene Sitzung. `pg_terminate_backend` verlangt `has_privs_of_role` auf die Zielrolle oder `pg_signal_backend`. Ab PG16 bekommt eine Rolle mit `CREATEROLE` die angelegte Rolle nur mit `ADMIN OPTION` (`INHERIT FALSE`, `SET FALSE`), die App-Rolle kann die Sitzungen also nicht ohne Zwischenschritt beenden. Nicht am Render-Konto geprüft. | Rückweg vollständig beschreiben (zuerst `GRANT kennzahlen_leser TO <App-Rolle> WITH INHERIT TRUE`, dann `pg_terminate_backend`) oder vor dem Einschalten `SELECT pg_has_role('pg_signal_backend','USAGE')` prüfen; den Grund für T7 erst danach bestätigen. Die Anleitung steht in `.env.example`. |

Zweite Gegenprüfung durch den Agenten `angreifer` (02.11./03.11.) nach der Änderung „Lauf über die Fassade `src/store.js`“. Ohne Befund: die Fassade als neuer Zugang (in `src/` ruft keine Stelle eine Speicherfunktion über einen zur Laufzeit gebildeten Namen auf; die Fassade importieren nur `src/server.js:3`, `src/claude.js:3`, `src/llm-usage.js:2`, `src/precall-briefing.js:14`, `src/consult/in-call.js:2`, `src/research/in-call.js:2`, alle mit festen Namen), ein zweiter Takt-Aufruf (`makeKeyedSingleFlight`, `src/single-flight.js:10-20`: dasselbe Versprechen, kein zweite Verbindung) und der Rollenname an zwei Stellen (führt höchstens zum Überspringen der Migration oder zum Abbruch des Starts, nie zu einem zusätzlichen Recht).

| Nr. | Art | Bezug | Befund | Vorschlag (Freigabeliste der Betreuung) |
|---|---|---|---|---|
| G9 | Szenario prüft nicht | T3 („verhindern“ über `ALTER ROLE kennzahlen_leser CONNECTION LIMIT 2`), S25, S23 | Kein Szenario zu T3 wird rot, wenn das `ALTER ROLE … CONNECTION LIMIT 2` aus der Migration fehlt: Tests laufen jetzt über den Hermes-Start, der die Migration ausführt und die Grenze 2 setzt. Wird das Gegeben von S25 („keine Verbindungsgrenze“) vor dem Start hergestellt, überschreibt die Migration es; S25 prüft dann nur die Rollenprüfung. Gleiches gilt für S23 (das `REVOKE` beim Start entfernt ein vorher vergebenes Recht auf `transcript_segment`). | Neues Szenario für den Schutz in der Migration: „Gegeben `kennzahlen_leser` hat vor dem Start keine Verbindungsgrenze, und heute (UTC) beginnt und endet ein beantworteter ausgehender Anruf; Wenn Hermes startet und der Kennzahlen-Lauf einmal läuft; Dann steht `anrufe_heute` (outbound, angenommen) auf 1.“ Außerdem bei S25 und S23 „nach dem Start“ ins Gegeben schreiben, wie bei S30 und S31. |
| G10 | Szenario prüft nicht | T3 „erkennen“ (S26, S32) und S25, S23, S24, S30, S31 („meldet keinen Messwert“) | Das Vorbild für den Hermes-Start in Tests (`test/abrechnung/server-mit-testdatenbank.js:56-63,80-106,147,180`) richtet `kv2_app` nur mit `CREATE, USAGE ON SCHEMA public` ein, ohne `CREATE` auf der Datenbank und ohne `ADMIN OPTION`; dann scheitert die Migration mit `42501`, wird übersprungen (B5), es gibt keine Sicht, und „meldet keinen Messwert“ ist auch ohne Rollenprüfung grün. Außerdem ersetzt das Vorbild nur `pg.Pool`, nicht den eigenen `pg.Client` des Laufs. | Jedes Szenario mit „meldet keinen Messwert“ bekommt eine Gegenprobe im selben Aufbau („Und nachdem das zusätzliche Recht entzogen ist, meldet der nächste Lauf `anrufe_heute` (outbound, angenommen) mit 1“); im Design festhalten, dass der Testaufbau der App-Rolle `CREATE` auf der Datenbank und `ADMIN OPTION` auf `kennzahlen_leser` gibt (Erweiterung der Testhilfe, Auftrag des Durchstich-Tests). |
