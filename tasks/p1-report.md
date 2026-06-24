# F1 Phase 1 — Store-Schema: Geo-Felder + Migration (Report)

Status: ABGESCHLOSSEN, committet (3a5749f).

## Umgesetzt
- `country` (ISO-2) + `language`/`defaultLanguage` additiv NULLABLE in Store-Defaults, JSON-Store, PG-Store, PG-Schema (`src/db/schema.sql`) + Migration (`src/db/migrate.js`).
- `setTenantGeo`: fail-closed (wirft bei fehlendem Tenant, kein stilles No-Op), selektiver Patch (country/language unabhaengig setzbar), Re-Export ueber json-Fassade.
- Default-Geo = DE/de fuer alle Bestands-/Default-Aufrufe (R7: Bestand bleibt byte-identisch, kein leeres Feld).

## Tests (gruen)
`test/f1-geo-store.test.js`: seed/requestNumber Default DE/de; setTenantGeo selektiv + fail-closed; Owner byte-identisch; json-Roundtrip; pg-Flush+Re-Hydrierung (Number-Geo, setTenantGeo, Owner ohne Geo).

## Hinweis
Arbeit war zuvor uncommittet im Worktree (Session-Restart vor Commit). Jetzt gesichert.
