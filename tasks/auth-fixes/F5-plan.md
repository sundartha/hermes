# F5 — Fail-closed Startup-Assertion: Kunden-Pool darf kein Superuser/BYPASSRLS sein

## Problem (Pre-Mortem)

`src/portal-pool.js` erstellt den Kunden-pg-Pool ohne jede Pruefung der
Datenbankrolle. Laeuft der Pool als Superuser oder mit `rolbypassrls`, umgeht er
`FORCE ROW LEVEL SECURITY` vollstaendig — RLS ist dann wirkungslos, ohne dass
der Fehler sichtbar wird. Klassisches Pre-Mortem: "RLS war an, aber der Nutzer
war Superuser — totaler Tenant-Leak, unbemerkt."

Relevant nur wenn `STORE_BACKEND=pg` (json-Pfad oeffnet gar keinen Pool).

---

## Soll-Verhalten (Akzeptanzkriterien)

1. **AC1 — Superuser-Block:** Meldet die DB `is_superuser = on`, wirft
   `createPortalRunner()` einen `Error` mit der Nachricht
   `"[F5] Portal-Pool laeuft als Superuser"` (oder passendem Substring).
   Der Prozess startet nicht.

2. **AC2 — BYPASSRLS-Block:** Meldet `pg_roles.rolbypassrls = true` fuer die
   aktive Rolle, wirft `createPortalRunner()` einen `Error` mit Substring
   `"[F5]"` und `"bypassrls"` (case-insensitive).
   Der Prozess startet nicht.

3. **AC3 — Normaler Pfad kein Fehler:** Eine Rolle mit
   `is_superuser = off` UND `rolbypassrls = false` loest keinen Fehler aus.
   `createPortalRunner()` gibt einen funktionierenden Runner zurueck.

4. **AC4 — Nur bei STORE_BACKEND=pg aktiv:** Im json-Pfad wird kein Pool
   erstellt und die Assertion wird nie aufgerufen — der bestehende Startablauf
   bleibt unveraendert.

5. **AC5 — Einmalige Pruefung, kein N+1:** Die Assertion laeuft einmal beim
   Aufbau des Pools (Startup), nicht pro Request.

6. **AC6 — Klar lesbare Fehlermeldung:** Die Error-Message nennt die
   gefundene Rolle und erklaert, warum der Pool abgelehnt wird — kein
   generischer `Error`.

7. **AC7 — node:test gruen ohne Netz/ohne .env:** Die neuen Tests laufen
   offline (PGlite-Stub, kein echter Postgres), wiederholt stabil, ohne
   zusaetzliche Env-Vars.

---

## Technische Loesung

### Neue Hilfsfunktion in `src/portal-pool.js`

```js
// Prueft einmalig ob die aktive DB-Rolle Superuser oder BYPASSRLS hat.
// Wirft mit klarer Meldung, wenn RLS wirkungslos waere (fail-closed).
async function assertNoBypassRls(client) {
  const { rows } = await client.query(
    `SELECT current_setting('is_superuser') AS is_su,
            r.rolbypassrls
     FROM   pg_roles r
     WHERE  r.rolname = current_user`,
    []
  );
  const row = rows[0];
  if (row.is_su === 'on') {
    throw new Error(
      `[F5] Portal-Pool laeuft als Superuser (current_user=${row.rolname ?? '?'}). ` +
      `Superuser umgehen FORCE RLS vollstaendig. Richte einen dedizierten ` +
      `NOBYPASSRLS non-superuser an und setze DATABASE_URL auf dessen Credentials.`
    );
  }
  if (row.rolbypassrls === true) {
    throw new Error(
      `[F5] Portal-Pool hat BYPASSRLS (current_user=${row.rolname ?? '?'}). ` +
      `BYPASSRLS umgeht FORCE RLS vollstaendig. Entferne BYPASSRLS von der Rolle ` +
      `oder nutze eine dedizierte NOBYPASSRLS-Rolle fuer DATABASE_URL.`
    );
  }
}
```

`createPortalRunner()` wird zu einer `async`-Funktion und ruft
`assertNoBypassRls` einmalig mit einem temporaer geleasten Client nach
Pool-Erstellung auf. Wirft die Assertion, wird der Pool sofort beendet
(`pool.end()`) und der Fehler propagiert — der Prozess startet nicht.

### Aufrufstelle in `src/server.js` (oder init-Pfad)

Der Aufrufer von `createPortalRunner()` muss das zurueckgegebene Promise
awaiten und Fehler propagieren (fail-closed), statt den Runner synchron zu
nutzen. Das betrifft den pg-Init-Pfad in `src/server.js` oder `src/store/pg.js`.

> Hinweis fuer den Build-Agenten: grep nach allen Aufrufern von
> `createPortalRunner` und sicherstellen, dass der await-Pfad den Error
> nach oben weitergibt.

---

## Test-Cases (node:test, Given/When/Then)

Alle Tests laufen in `test/portal-pool-assertion.test.js` mit PGlite-Stubs
(kein echter Postgres, kein Netz, kein `.env`). Muster: minimaler Stub-Runner,
der die spezifische SQL-Antwort zurueckgibt.

### TC1 — Superuser-Rolle wirft (AC1)

**Given:** Ein Stub-Runner, dessen `query()` auf die Assertions-SQL
`{ rows: [{ is_su: 'on', rolbypassrls: false }] }` zurueckgibt.

**When:** `assertNoBypassRls(stubClient)` wird aufgerufen (oder
`createPortalRunner()` mit injiziertem Stub-Pool).

**Then:** Das Promise rejected mit einem `Error`, dessen `message` den
Substring `"[F5]"` und `"Superuser"` (case-insensitive) enthaelt.

---

### TC2 — BYPASSRLS-Rolle wirft (AC2)

**Given:** Stub-Runner gibt `{ rows: [{ is_su: 'off', rolbypassrls: true }] }`.

**When:** `assertNoBypassRls(stubClient)` aufgerufen.

**Then:** Rejected mit `Error`, `message` enthaelt `"[F5]"` und `"bypassrls"`
(case-insensitive).

---

### TC3 — Normaler non-superuser/NOBYPASSRLS-Pfad kein Fehler (AC3)

**Given:** Stub gibt `{ rows: [{ is_su: 'off', rolbypassrls: false }] }`.

**When:** `assertNoBypassRls(stubClient)` aufgerufen.

**Then:** Promise resolves ohne Fehler (kein throw, kein reject).

---

### TC4 — Superuser UND BYPASSRLS: Superuser-Fehler wird zuerst geworfen (Grenzfall)

**Given:** Stub gibt `{ rows: [{ is_su: 'on', rolbypassrls: true }] }`.

**When:** `assertNoBypassRls(stubClient)` aufgerufen.

**Then:** Rejected mit `Error`, `message` enthaelt `"Superuser"`
(erste Pruefung gewinnt; BYPASSRLS wird nicht separat gemeldet, weil
Superuser schwerer wiegt).

---

### TC5 — Leeres Ergebnis-Set (DB-Fehler-Fallback) wirft ebenfalls (AC1/AC2-Haerte)

**Given:** Stub gibt `{ rows: [] }` (Rolle nicht in `pg_roles` gefunden —
sollte in Produktion nie passieren, aber fail-closed).

**When:** `assertNoBypassRls(stubClient)` aufgerufen.

**Then:** Rejected mit einem `Error` (beliebige Meldung; kein stilles
Durchlassen).

---

### TC6 — PGlite-Rauchtest: normaler app_user laeuft ohne Fehler (AC3 + AC7)

**Given:** PGlite-Instanz, Schema angewendet (`applySchema`); Rolle `app_user`
angelegt (`NOLOGIN NOBYPASSRLS`); Runner der als `app_user` laeuft
(`SET ROLE app_user` vor jedem client-call, wie in `portal-rls-killer.test.js`).

**When:** `assertNoBypassRls(client)` mit diesem Runner aufgerufen (die SQL
fragt `current_setting('is_superuser')` + `pg_roles.rolbypassrls` ab).

**Then:** Kein Fehler (PGlite liefert `is_superuser = 'off'`,
`rolbypassrls = false` fuer eine NOLOGIN-NOBYPASSRLS-Rolle).

> Hinweis: PGlite laeuft intern als Superuser; `SET ROLE app_user` wechselt den
> `current_user` und damit das `is_superuser`-Ergebnis korrekt. Dieser TC
> verankert das erwartete PGlite-Verhalten (Learning-Test gemaess P10).

---

## Dateien (Source + Test)

| Datei | Aktion | Begruendung |
|---|---|---|
| `src/portal-pool.js` | Aendern | `assertNoBypassRls` ergaenzen; `createPortalRunner` -> async + Assertion nach Pool-Erstellung |
| `src/server.js` (oder zustaendiger Init-Pfad) | Pruefen/Anpassen | `await createPortalRunner()` sicherstellen; Fehler propagieren |
| `test/portal-pool-assertion.test.js` | Neu anlegen | TC1–TC6 (stub-basiert + PGlite-Rauchtest) |

**Nicht anfassen:** `src/db/schema.sql`, `src/config.js` (keine neuen Env-Vars
noetig — die Assertion nutzt die bereits vorhandene `config.databaseUrl`),
`src/store/portal.js`, alle anderen Test-Dateien.

---

## Pre-Mortem (Risiken, vor Umsetzung benannt)

1. **`createPortalRunner` war synchron** — Aufrufer erwarten keinen Promise.
   Gegenmassnahme: alle Aufrufer auf `await` umstellen (grep); falls der Init-Pfad
   in `server.js` Top-Level-await braucht, ist das im ESM-Modul erlaubt.

2. **PGlite-is_superuser-Verhalten unbekannt** — PGlite koennte `is_superuser`
   anders repraesentieren als echtes Postgres (`'on'` vs. `true`).
   Gegenmassnahme: TC6 verankert das tatsaechliche PGlite-Verhalten; bei
   Abweichung wird die Assertion entsprechend angepasst (String-Vergleich
   oder Boolean-Check explizit).

3. **Pool-Leak bei Assertion-Fehler** — Pool wird eroeffnet, Assertion wirft,
   Pool bleibt offen.
   Gegenmassnahme: `pool.end()` im catch-Block vor `throw` ausfuehren.

4. **Assertion blockiert Startup bei traeger DB** — erste Client-Lease koennte
   zeitintensiv sein.
   Gegenmassnahme: Timeout ist bereits im pg-Pool konfigurierbar
   (`connectionTimeoutMillis`); kein zusaetzlicher Mechanismus noetig —
   ein blockender Start ist das korrekte Fail-closed-Verhalten.

5. **Kein Einfluss auf json-Backend** — Assertion laeuft nur im pg-Pfad;
   json-Nutzer sehen keine Aenderung.
   Gegenmassnahme: `createPortalRunner()` wird nur aufgerufen wenn
   `STORE_BACKEND=pg`; kein Guard in der Funktion selbst noetig.

---

## Verifikation (Definition of Done)

- [ ] `npm test` gruen (Altbestand + TC1–TC6), keine neuen Skip/Pending-Tests.
- [ ] `node --check src/portal-pool.js` (und alle geaenderten Dateien) Exit 0.
- [ ] TC1 + TC2 beweisen explizit, dass Superuser/BYPASSRLS zu einem `Error`
      mit `[F5]`-Prefix fuehren.
- [ ] TC3 + TC6 beweisen, dass der normale Pfad keinen Fehler auswirft.
- [ ] Kein neues Env-Var, kein neues npm-Paket.
- [ ] `PLAN-SECURITY.md` Sub-Projekt B / F5-Eintrag als umgesetzt markiert.
