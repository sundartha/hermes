# Paket S2a: Bestätigungscodes und Fehlversuchs-Bremse in die DB (Pilot Spur S)

Issue: 3047

Stand der Fundstellen: `upstream/master` 245b34cc (nach `git fetch upstream`, gelesen mit `git show upstream/master:<pfad>`). `sicherheit: true` (Bauplan Zeile 11), Pilot der Spur S (Bauplan Zeile 14).

## Absicht
Ein Bestätigungscode wird zustandslos per HMAC abgeleitet, aber sein Einmal-Verbrauch, der Slot-Vorschub (nach Verbrauch gilt für dieselbe Anfrage ein neuer Code) und die Fehlversuchs-Bremse (10 je Mandant und 5-Minuten-Fenster) liegen nur im Prozessspeicher der Route. Bei zwei Prozessen lässt sich ein Code in jedem Prozess einmal einlösen, jeder Prozess zählt eigene Fehlversuche, und nach einem Neustart ist ein verbrauchter Code wieder einlösbar. Das Paket legt diese drei Register mandantengebunden und atomar in Postgres: Ein Code ist über alle Prozesse genau einmal einlösbar, die Bremse zählt gemeinsam, beides übersteht einen Neustart. Ableitung, Fenster, Codelänge, Ablauf und Bremse-Grenze bleiben Wert für Wert gleich, nichts wird gelockert; ein Datenbankfehler gilt nie als bestätigt.

## Ausgangslage (Fundstellen, Werte bleiben)
- Werte (`src/call-confirmation.js`): Fenster 5 min (`:9-10`), 2 akzeptierte Fenster (`:11`), also Ablauf `(Fenster+2)*5 min` (`:47-49`); Code 6 Zeichen aus 32er-Alphabet (`:7-8`); Bremse 10 Fehlversuche je Mandant und Fenster (`:12`); Meldegrund `already_used` (`:13`); Secret mindestens 32 Zeichen (`:14`, `:19-22`); Ableitung `["v2", tenantId, windowIdx, slot, canonical]` (`:15`, `:55-64`).
- Verbraucht-Register: `Map` Digest -> Ablaufzeit; Digest ist sha256 über `tenantId|windowIdx|Code` (`api-call-confirmations.js:60-62`, `:64-81`). Einmal-Verbrauch ist `markIfUnused` (`:74-79`), Abfrage `wasCodeUsed` über beide Fenster (`:140-148`).
- Slot-Register: `Map` Digest -> Slot (`:83-103`). Nach Verbrauch `advance` (`:136`), die Ausstellung liest `currentSlot` (`:216-221`). Ohne gemeinsames Register stellt jeder Prozess für dieselbe Anfrage denselben Slot-0-Code aus.
- Bremse: `Map` Mandant -> {Fenster, Zähler} (`:105-120`). Gesperrt ab 10 (`:114`). Gezählt wird nur ein nicht leerer, nicht passender Code (`:162-163`).
- Reihenfolge (`confirmCode`, `:156-164`): erst `already_used`, dann Bremse (sperrt auch den richtigen Code), dann Verbrauch; leere Codes zählen nicht. Dieses Verhalten bleibt.
- Die drei Register leben in der Closure von `makeCallConfirmationRoutes` (`:172-178`); die Route ist `POST /api/call-confirmations`, `internalOnly` (`:180`). Ohne Code wird ausgestellt (`:216-225`), mit Code eingelöst (`:204-214`). Fehlendes oder zu kurzes Secret: 503 (`:198-199`).
- Eingänge: Route in `src/app.js:209` ohne DB-Zugang eingehängt; MCP-Weg `place_call` ruft die Route über `confirmCallHop` (`src/mcp-tools.js:265-281`, `:944-972`); der Verbrauch geschieht also nur in der Route.
- Mandant der Anfrage: `requestTenant` (`src/routes/_tenant.js:32-41`; Kopfzeile `x-internal-tenant` nur für vertrauenswürdige lokale Aufrufer, `:11-19`; sonst Betreiber-Mandant `:26-27`).
- Postgres heute: feste Migrationsliste `MIGRATION_READERS` (`src/db/migrate.js:10-86`), nächste Datei `0003_…sql` mit `SET LOCAL lock_timeout`/`statement_timeout` wie `0002_versionstabelle.sql:1-8`. FORCE-RLS-Muster `tenant_isolation` mit `current_setting('app.current_tenant', true)` (`0001_ausgang.sql:1052-1183`, z. B. `account` `:982-991`, `audit_log` `:1015-1026`); mandantengebundener Zugriff über `withTenant` (`src/store/portal.js:2-16`).

## Szenarien (echter Eingang: `POST /api/call-confirmations`, zwei Server-Prozesse auf einer Datenbank)
1. Gegeben zwei Prozesse A und B auf derselben Postgres-Datenbank und ein von A ausgestellter Code, wenn der Code an A eingelöst wird und danach derselbe Code an B, dann antwortet A mit `confirmed:true` und B mit `confirmed:false` und `reason` `already_used`. Dasselbe in der Gegenrichtung (erst B, dann A).
2. Gegeben derselbe Code, wenn er gleichzeitig an A und B geschickt wird, dann bekommt genau eine Antwort `confirmed:true`, die andere `confirmed:false` mit `reason` `already_used`, und der Zähler der Bremse bleibt unverändert (danach gehen noch 10 Fehlversuche durch, bevor gesperrt wird).
3. Gegeben ein an A eingelöster Code, wenn B für dieselbe Anfrage einen Code ausstellt, dann ist der neue Code ein anderer als der verbrauchte (Slot-Vorschub gilt gemeinsam), der verbrauchte bleibt abgelehnt, der frische gilt.
4. Gegeben 10 falsche, nicht leere Codes eines Mandanten, verteilt auf A und B (zum Beispiel 5 und 5), wenn danach der richtige Code an A oder an B geschickt wird, dann `confirmed:false` bis zum Fensterende; ein anderer Mandant bleibt ungesperrt.
4b. Gegeben 0 Fehlversuche, wenn 20 falsche, nicht leere Codes gleichzeitig an A und B gehen (je 10 parallel), dann wird der danach geschickte richtige Code an A und an B abgelehnt; Rot-Probe gegen eine Fassung mit getrenntem Lesen und Schreiben des Zählers.
5. Gegeben ein an A eingelöster Code und ein gesperrter Mandant, wenn alle Prozesse beendet und mit derselben Datenbank neu gestartet werden, dann ist der Code weiter `already_used` und der Mandant weiter gesperrt (Neustart-Test).
6. Gegeben Fenster- und Ablaufgrenzen (injizierte Uhr, Postgres statt Speicher, zwei Routen-Instanzen auf einer Datenbank), dann gilt wie heute: ein unverbrauchter Code gilt im Folgefenster, zwei Fenster später nicht mehr; ein verbrauchter Code bleibt bis Annahmeende verbraucht; die Bremse beginnt im neuen Fenster bei null. Ablauf und Fensterwechsel folgen allein der injizierten Uhr der Route (`nowMs`), auch wenn die Datenbankzeit abweicht; kein `now()` der Datenbank in der Logik.
7. Gegeben die Datenbank antwortet beim Einlösen mit einem Fehler, wenn ein Code eingelöst wird, dann antwortet die Route mit 503 `confirmation_unavailable` (bestehender Weg und Text, `src/i18n/mcp-texts.js:64-65`), nie mit `confirmed:true`; ebenso, wenn das Zählen eines Fehlversuchs scheitert (nie 200 „abgelehnt“ ohne Zählung) und wenn die Datenbank beim Ausstellen scheitert (503, kein Code; kein Rückfall auf Slot 0). Eine Server-Logzeile ohne Code und Secret nennt den Datenbankfehler.
7b. Gegeben ein Datenbankfehler beim Slot-Vorschub nach dem Verbrauch, wenn danach für dieselbe Anfrage ausgestellt und eingelöst wird, dann ist der alte Code nicht `confirmed:true` und der neu ausgestellte gilt; Verbrauch und Vorschub laufen in einer Transaktion.
8. Gegeben der Stand vor dem Paket (Vorgängerversion), wenn der Zwei-Prozess-Test gegen das neue Schema läuft, dann besteht er (Migration nur erweiternd).
9. Gegeben ein Mandant, der nicht der Bootstrap-Mandant ist (`x-internal-tenant`, Testhelfer `anfrage` um Kopfzeilen erweitert, Rolle NOBYPASSRLS), dann gelten Szenarien 1, 4 und 5 auch für ihn; jede Transaktion setzt den Mandanten lokal (`set_config(..., true)`).
10. Strukturtest wie `test/openai-t2-08-hop-frist.test.js:107`: längster Serverweg der Bestätigung (Wartezeit auf eine Pool-Verbindung plus eine Transaktion) bleibt unter `MCP_HOP_TIMEOUT_MS`.

## Abnahmesätze
- A1: Szenario 1, 2 und 9 über zwei Prozesse (Einmal einlösbar, auch gleichzeitig, auch für einen Nicht-Bootstrap-Mandanten).
- A2: Szenario 3 (Slot-Vorschub gemeinsam).
- A3: Szenario 4 und 4b (Bremse gilt gemeinsam, je Mandant, auch bei Gleichzeitigkeit).
- A4: Szenario 5 (Neustart-Test).
- A5: Szenario 6, 7, 7b und 10 gegen Postgres; die bestehenden Sätze aus „Schon grün“ bleiben unverändert grün.
- A6 (Rot-Probe): Der Zwei-Prozess-Test A1 bis A4 ist rot gegen den alten Stand (Speicher) und grün gegen den neuen; die Rot-Probe ist belegt, nicht behauptet.
- A7 (Folgephase, nicht Teil dieser Phase): Szenario 8 (Vorgängerversion gegen neues Schema; braucht das Gerüst aus Paket S2g, siehe Entscheidungen), Kartenlauf aus S0 grün, `@typescript-eslint/no-floating-promises` ohne neue Ausnahme (`eslint.config.js:500`).
- A8: Echtzeit-Regel: ereignisgesteuert, keine echte Wartezeit über 100 ms, kein Eintrag in `tools/basis/echte-wartezeiten.json` (Bauplan Zeile 15).

## Was nie passieren darf
- NIE1: Ein Code wird zweimal bestätigt, in keinem Prozess, bei keiner Gleichzeitigkeit, auch nicht nach einem Neustart.
- NIE2: Die Bremse wird durch Prozesswechsel, Gleichzeitigkeit oder Neustart umgangen; mehr als 10 Fehlversuche je Mandant und Fenster, die nicht gesperrt werden.
- NIE3: Ein Wert wird gelockert oder eine Prüfung weicht auf: 5 min, 2 Fenster, 6 Zeichen, 10 Fehlversuche, Mindestlänge 32, zeitkonstanter Vergleich (`safeEqual`), Reihenfolge `already_used` vor Bremse vor Verbrauch, leere Codes zählen nicht.
- NIE4: Ein Datenbankfehler führt zu `confirmed:true` (fail-closed).
- NIE5: Klartext-Code, Secret oder abgeleiteter Schlüssel in der Datenbank, im Log oder in einer Fehlermeldung; die Datenbank hält höchstens Digests wie heute.
- NIE6: Ein Mandant sieht oder verändert Register eines anderen (Test nur unter NOBYPASSRLS beweiskräftig).
- NIE7: Die Vorgängerversion fällt gegen das neue Schema um (Migration zerstört, benennt um oder entfernt nichts).
- NIE8: Eine echte Wartezeit über 100 ms im Test oder ein neuer Eintrag in `tools/basis/echte-wartezeiten.json`; eine neue Ausnahme für `no-floating-promises`.

## Nicht-Ziele
- Die Ableitung des Codes ändern (`DERIVATION_VERSION` bleibt `v2`), Fenster, Länge, Alphabet oder Bremse-Grenze anfassen.
- Den Weg `place_call` / `confirmCallHop` umbauen; er ruft die Route weiter wie heute.
- Secret-Verwaltung und Boot-Befund (`src/config.js:817`, `src/boot-guard.js:404-427`).
- Die übrigen Speicher-Pakete S2b bis S2f (nicht parallel, eigene Migrationsnummer; `srv-naechste.md` Zeile 5).
- Aufräum-Job für abgelaufene Zeilen als eigener Dienst (gehört zu S11).
- Verbrannter Code bei Zeitüberschreitung des Hop (fail-closed, kein Anruf): hingenommen.
- Restabweichung an der Fenstergrenze bei Uhrversatz zwischen Prozessen (höchstens 2×10 Versuche um den Wechsel): hingenommen.

## Erwartete Dateien (Hinweis, keine Sperre)
`src/routes/api-call-confirmations.js`, `src/call-confirmation.js` (nur falls Hilfsfunktionen nötig, Werte unberührt), neue Migration `src/db/migrations/0003_…sql` samt Eintrag in `src/db/migrate.js`, ggf. `src/app.js` (Zugang zur DB), `src/store.js` und `src/store/pg.js` bzw. neues Register-Modul im Speicher-Bereich (Entscheidung 1). Tests: neu unter `test/gemeinsam/` (Zwei-Prozess-Test mit Rot-Probe, Gerüst `test/gemeinsam/zwei-prozesse.js` und `test/gemeinsam/echtes-postgres.js` existieren), `test/call-confirmation.test.js` bleibt als Regressionsschutz.

## Entscheidungen (aus der Gegenprüfung, 04.11. abends, Engineering-System)
1. SQL-Zugang: kein eigener Pool (Datenbank-Budget `POOL_GRENZEN.datenbankBudget: 80`, `src/utils/pg-pool.js:2-12`). `createPgBackend` baut auf dem vorhandenen Runner ein schmales Register-Objekt (Muster `pruefeVerbindung`, `src/store.js:13`) und gibt es über `store` an die Route; der Runner selbst wird nicht herausgegeben; SQL liegt im Speicher-Bereich. Speicher-Register nur noch beim JSON-Backend (ein Prozess; im Hosting verweigert `src/config.js:1002-1004` den Start ohne pg).
2. Tabellen mandantengebunden, FORCE RLS, `tenant_isolation`, je Transaktion `set_config('app.current_tenant', …, true)` wie `src/store/portal.js` `withTenant()` (Bauplan Zeile 168). Keine globale permissive Policy.
3. Atomarität: eine Transaktion je Einlösen, zuerst `pg_advisory_xact_lock` je Mandant, dann in unveränderter Reihenfolge `already_used`, Bremse, Slot lesen und vergleichen, Verbrauch per `INSERT … ON CONFLICT DO NOTHING RETURNING`, Slot-Upsert, Fehlversuch-Upsert `count = count + 1` mit Schlüssel (Mandant, Fenster).
4. Datenbankfehler: 503 `confirmation_unavailable` auf dem bestehenden Weg (siehe Szenario 7).
5. Uhr: Zeitlogik nur aus `nowMs` und gespeicherten Ablaufwerten; Ablauf/Fenster im Test mit zwei Routen-Instanzen auf echtem Postgres, Prozessgrenze im echten Zwei-Prozess-Test.
6. Aufräumen: Richtigkeit hängt nie am Aufräumen (`WHERE expires_at > $nowMs`); abgelaufene Zeilen des Mandanten in derselben Transaktion löschen; ein Job gehört zu S11.
7. Digests: beide als HMAC mit eigenem HKDF-Unterschlüssel (eigenes `info`), nicht mehr unsalziertes sha256; wirkt nicht auf den Rollout.
8. Rollout: hingenommen, dass beim ersten Deploy für Sekunden ein alter und ein neuer Prozess parallel laufen (heute eine Instanz, `render.yaml`; ohne Kunden, Bauplan Zeile 210). Empfehlung an Antonio: hinnehmen.
9. Gerüst „Vorgängerversion starten“ (Worktree des Merge-Base, Start über `startServer`) gilt für alle S-Pakete (Bauplan Zeile 170) und wird eigenes Paket **S2g**, parallel zu S2a gebaut. Der Auftrag für A7 in S2a läuft erst nach dem Merge von S2g. Keine Lockerung: A7 bleibt Pflicht für S2a.
10. Testhelfer `anfrage` testseitig um Kopfzeilen erweitern (kein Produktcode).
11. Keine neue Route, kein neuer Eintrag in `route-auth-inventory`; es gelten das Fertig-Kriterium S2a, das S-Kriterium mit Rot-Probe und `sicherheit: true` (Bauplan Zeilen 10, 170, 184).

## Schon grün (belegt durch bestehende Tests, nicht neu bauen)
Alle Route-Tests laufen im Speicher in einem Prozess (Closure-Register); sie belegen das Verhalten, nicht die Prozessübergreifung. Sie müssen nach dem Paket unverändert grün bleiben (Regressionsschutz).
- Ableitung und Prüfung: gleiche Eingabe, gleicher Code (`test/call-confirmation.test.js:42`); feste Länge und nur Alphabet-Zeichen (`:49`); Änderung an Feld oder Mandant ändert den Code (`:58, :96`); Briefing/Kontext gebunden, `confirmation_code` selbst nicht (`:75, :91`); Schlüsselreihenfolge egal (`:103`); vorheriges Fenster gilt, zwei Fenster später nicht (`:119`); leeres oder zu kurzes Secret ergibt keinen Schlüssel (`:134`); Klein-/Leerzeichen/Bindestrich-Normalisierung (`:145, :174`); `matchedWindowIndex` (`:155`); falscher Code abgelehnt (`:179`).
- Einlösen und Ablauf über die Route: gültiger Code `confirmed:true`, abgelaufen (injizierte Uhr) `confirmed:false` (`:238`); zweiter Treffer `confirmed:false` (`:266`); `already_used` nur für den eigenen verbrauchten Code, fremder Mandant und falscher Code bleiben generisch (`:290`); Code eines anderen Mandanten abgelehnt (`:312`); kein oder zu kurzes Secret: 503, kein Code ausgestellt (`:332`); Folgefenster gilt, zwei Fenster später nicht (`:380`); verbrauchter Code im Folgefenster nicht erneut gültig (`:393`); alter Slot abgelehnt, frischer Slot gilt (`:404`); noch nicht ausgestellter Slot abgelehnt (`:417`); geänderte `language`/`briefing`/`context` abgelehnt (`:465`).
- Bremse über die Route: sperrt nach 10 Fehlversuchen auch den richtigen Code bis Fensterende (`:430`); leere Codes zählen nicht (`:444`); je Mandant, Fehlversuche von A sperren B nicht (`:454`).
- Boot-Befund: Secret fehlt, zu kurz, ok; Meldung enthält nie den Wert (`:484`).
- Weitere: `canonicalCallRequest` bindet nur Argumente ohne Code samt gewähltem Ziel und lässt Eingaben unverändert (`test/anrufe/bestaetigung-anfrage-ohne-code.test.js:17, :24`); Anfrage ohne Rufnummer oder mit Zahl statt Rufnummer wird mit der Pflichtmeldung abgewiesen (`test/anrufe/bestaetigung-ohne-rufnummer.test.js:16, :28`); Bestätigung gefolgt von `place_call` über einen echten Server (`test/anrufe/anrufe-pausieren.test.js:86-101`).
- Gerüst (kein Beleg für Codes): Zwei-Prozess-Rauchtest `test/gemeinsam/zwei-prozesse.test.js:10`; Helfer `zweiProzesse`, `anfrage`, `beenden` (`test/gemeinsam/zwei-prozesse.js:5-47`), echtes Postgres über `HERMES_TEST_POSTGRES_URL` (`test/gemeinsam/echtes-postgres.js:5-62`), PGlite und Nicht-Superuser-Rolle (`test/pg-helpers.js`). Es gibt noch keinen Test, der einen Code über zwei Prozesse einlöst, also auch keine Rot-Probe.
- Nicht belegt (fehlt, ist der Kern des Pakets): Einmal-Verbrauch über Prozesse, gemeinsame Bremse, Neustart, Datenbankfehler, Vorgängerversion gegen neues Schema.
