# P-2654 Fragerunden

## Runde 1
1. Dürfen die Szenarien als sichtbares Ergebnis Abfragen an der Datenbank des Betreibers nennen (`schema_migrations`, `pg_locks`, ein von Hand entfernter Index)? Die Regel der Vorlage nennt Datenbankinhalt sonst als Ausnahme; hier ist die Versionstabelle selbst das Ergebnis, das der Betreiber sieht. Empfehlung: ja, weil Migrationen kein anderes sichtbares Ergebnis haben als Exit-Code, Meldung, `/healthz` und diese Tabelle.
2. Gelten Szenarien S1 bis S11, B1 und die fünf Nicht-Ziele (Migrationsordner nicht wählbar, Nachzüge und `seedDefaults` unverändert, kein DDL in JavaScript, S1dc und Rückbau-Ordner ausgeschlossen) so, wie sie im Pitch stehen? Empfehlung: ja, sie entsprechen Kurzauftrag S1db und den 11 Fällen des Probe-Patches.
3. Entsteht ein Design Doc? Empfehlung: nein. Die Technik ist über den Probe-Patch gemessen entschieden (Sitzungs-Sperre auf dem einen Client von `init()`, Prüfsumme, eine Transaktion je Datei, Übernahme von `0001` und `0002` in einer Transaktion); es gibt keinen gleich tragfähigen anderen Weg, der das Fertig-Kriterium und die Squawk-Regel erfüllt. `design.md` entsteht trotzdem mit dem Abschnitt „Ausgangslage und Annahmen“.

Antworten:
1. ja (wie empfohlen)
2. ja (wie empfohlen)
3. nein; `design.md` mit „Ausgangslage und Annahmen“ (wie empfohlen)

## Vorher-Rot
S1: heute kein Eintrag, `schema_migrations` fehlt: `src/db/migrate.js:177-184` ruft nur `applySchema` und die Nachzüge, `git grep schema_migrations` findet es nur in `docs/RUNBOOK-RESTORE.md`.
S2: heute läuft `0001_ausgang.sql` bei jedem Start ganz und legt `account_email_idx` neu an (`src/db/migrate.js:178`, `CREATE INDEX IF NOT EXISTS`), der Index ist nach dem zweiten Start wieder da.
S3: heute gibt es nach dem Start keine Tabelle `schema_migrations` (`src/db/migrate.js:177-184`).
S4: heute gibt es kein `0002_versionstabelle.sql` und keine Übernahme in einer Transaktion (`src/db/migrations/` enthält nur `0001_ausgang.sql`).
S5: heute vergleicht nichts Prüfsummen, der Start läuft durch (`src/db/migrate.js:177-184`).
S6: heute hat der Start keinen Weg, eine einzelne Migration zurückzurollen oder mit Dateinamen zu melden (`src/db/migrate.js:21-23` führt jede Datei ohne Transaktion aus).
S7: heute gibt es keine Versionseinträge und keine Logzeile (`src/db/migrate.js:177-184`).
S8: heute wird der Mandantenbereich nur vor `seedDefaults` gesetzt (`src/db/migrate.js:172-175`), nicht vor jeder Migrationsdatei.
S9: heute scheitern zwei gleichzeitige Starts auf frischer Datenbank (gemessen, `fertigstellen/S1d/bericht.md`, Probe: ohne Sperre scheitern die zwei Starts wirklich).
S10: heute nimmt der Start keine Advisory-Sperre (`src/db/migrate.js:177-184`), er wartet nicht.
S11: heute zeigt `pg_locks` während des Starts keine Advisory-Sperre `72001` (`src/db/migrate.js:177-184`).
S8 (berichtigt): heute wird der Bereich nur vor `seedDefaults` gesetzt (`src/db/migrate.js:50-52`, `:172-175`), nicht vor jeder Migrationsdatei; die Einstellung heißt `app.current_tenant`.
S12: heute läuft `0001` Anweisung für Anweisung ohne `lock_timeout` und ohne Transaktion (`src/db/migrate.js:21-23`); der Start wartet auf die Sperre der anderen Sitzung, statt mit Exit 1 zu enden.
S13: heute gibt es kein `schema_migrations` (`src/db/migrate.js:177-184`).
S14: heute gibt es keine Sperre und keine Logzeile dazu (`src/db/migrate.js:177-184`).
S6 (umgeschrieben): heute gibt es keinen Eintrag und keine Zurückrollung je Datei (`src/db/migrate.js:21-23`).
