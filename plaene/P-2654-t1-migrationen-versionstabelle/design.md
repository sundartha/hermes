# P-2654 Migrationen je Datenbank genau einmal, versioniert, unter Sperre: Design Doc

Status: freigegeben
Pitch: plaene/P-2654-migrationen-versioniert/pitch.md
Entscheidung: kein Design Doc; es gilt der Pitch, die Technik ist durch den Probe-Patch gemessen (Sitzungs-Advisory-Sperre auf dem Client von `init()`, Prüfsumme je Datei, eine Transaktion je Datei, Übernahme von `0001` und `0002` in einer Transaktion).

## Ausgangslage und Annahmen
| Aussage | Beleg | Wenn sie nicht stimmt |
|---|---|---|
| Vorhandene Hilfe: eine Advisory-Sperre gibt es im Repo nur als Transaktionssperre in `src/web-auth.js:289`; keine Versionstabelle, kein Ausführer | `node tools/auftrag.mjs suche "pg_advisory"` und `suche "schema_migrations"`: nur `src/web-auth.js:289` und `docs/RUNBOOK-RESTORE.md:257` | – |
| `init()` holt einen Client, setzt den Plattform-Mandanten und ruft `prepareSchema` (= `migrate`) auf diesem Client; eine Sitzungs-Sperre darauf hält über den ganzen Lauf; sie muss im `finally` ausdrücklich freigegeben werden, weil der Client nach dem Start in den Pool zurückgeht (`src/store/pg-runner.js:6-15`) und sie sonst weiter hält; nur bei einem Absturz fällt sie mit der Verbindung | `src/store/pg.js:32-35` | Sperre fiele zwischen Schritten; Sperre müsste an eine Transaktion gebunden werden |
| Nach S1da liest `migrate.js` eine feste Liste `MIGRATION_READERS` mit genau `0001_ausgang.sql`; `schemaDdl()`/`applySchema` behalten Namen und Signatur | `src/db/migrate.js:9-23` (Stand `upstream/paket/S1da-ausgangsmigration`) | S1da ändert sich im Review: Schnitt und Zeilen im Plan neu prüfen (nach dem Merge `pruefe` gegen echten `master`) |
| Die Migrationsprüfung verlangt `SET LOCAL lock_timeout`/`statement_timeout` in neuen Migrationen und sperrt DDL in JavaScript | `tools/migrationen-pruefen.mjs:99-117`, `tools/basis/squawk.toml` | `0002` wird rot |
| Echtes Postgres 16 gibt es in der CI in den Jobs „Tests“ und „Prüfungen“, nicht im Mutationsjob | `.github/workflows/ci.yml:283`, `:338`, `:464`; Hilfe `test/gemeinsam/echtes-postgres.js:36` | Sperrfälle nur gegen PGlite beweisbar |
| Probe-Patch auf `b25d3b9`: 11 Fälle rot am alten Stand, 96 Testdateien grün, ohne Sperre scheitern zwei gleichzeitige Starts wirklich | `fertigstellen/S1d/bericht.md`, `probe.patch` | – |
| Erster Deploy: `0001` läuft auf der Produktionsdatenbank noch einmal ganz, zusammen mit `0002` in einer Transaktion, vermutet ohne Wirkung auf Daten | ungeprüft; prüfen durch: Start gegen eine Kopie der Struktur der Produktion (ohne Kundendaten) | Der erste Deploy bricht ab oder wartet; Rollback über den Deploy-Weg, `schema_migrations` bleibt ohne Schaden |
| Setzt S1c `statement_timeout` je Verbindung, endet die zweite Instanz bei langem Warten mit Exit 1 | `fertigstellen/S1d/bericht.md`, Risiko S1c | Start der zweiten Instanz scheitert beim Deploy; Schnitt von S1c beachten |
| Die Übernahme-Transaktion setzt vor `0001` ein `lock_timeout` von 2 Sekunden (aus JavaScript gesetzt, keine DDL), damit sie bei einer Sperre einer anderen Sitzung abbricht, statt zu blockieren; Wert wie in `0002` | Pitch S12; `fertigstellen/S1d/probe.patch` (`0002` trägt `SET LOCAL lock_timeout = '2s'`) | Übernahme wartet unbegrenzt auf alte Instanz oder bricht beim ersten Deploy zu oft ab; Wert im Plan neu festlegen |
