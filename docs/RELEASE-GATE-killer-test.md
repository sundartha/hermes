# Release-Gate: Killer-Test (Tenant-Isolation unter echtem Connection-Pooling)

pglite ist single-connection und kann pgBouncer Transaction-Pooling NICHT
reproduzieren. Der CI-Test (`test/portal-rls-killer.test.js`) beweist Isolation +
GUC-Reset-bei-ROLLBACK auf einer Verbindung. Vor jedem Production-Deploy zusaetzlich
dieses Gate gegen die REALE Render-Topologie (Postgres + pgBouncer transaction mode):

## Vorbedingungen

- DB-Nutzer aus `DATABASE_URL` ist NON-SUPERUSER und NOBYPASSRLS (sonst greift RLS nicht).
- pgBouncer im `pool_mode = transaction`.

## Prozedur

1. Zwei Tenants mit je eigener call/transcript-Zeile seeden.
2. 50 parallele Requests, abwechselnd Tenant A/B, ueber `portalStore.withTenant`.
3. An zufaelligen Stellen einen Query-Fehler injizieren (Txn-Abbruch ohne sauberen Reset).
4. Assert: in KEINER Antwort taucht ein `tenant_id` der jeweils anderen Seite auf.

## Akzeptanz

100% sauber. Ein einziger Cross-Tenant-Treffer -> Deploy blockiert, Fundament neu bewerten.
