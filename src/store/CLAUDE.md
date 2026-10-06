`src/store.js` + `src/store/` — Persistenz-Fassade ueber zwei Backends: `json.js`
(`data/store.json`, gitignored; loeschen = lokaler Reset) und `pg.js` (Postgres, RLS).
`defaults.js`/`state-ops.js`/`views.js`/`portal.js`; Backend via `STORE_BACKEND`.
Multi-Tenant: pro-Tenant settings/calendar/usage/budget.
**Kommentardichte ist hier selbst der Tech-Debt, kein Vorbild.**
Sich beim Schreiben am Bestand zu orientieren (G24, Konventionen) reproduziert hier einen Missstand.
Neue Kommentare nur, wo eine Invariante sonst unsichtbar waere.
**Ursache:** `save()` ist im pg-Store fire-and-forget und wird **zusammengefasst**.
**Regel:** Bei asynchroner/gebuendelter Persistenz muss der Test den
**Zeitpunkt** nachstellen, nicht nur die Reihenfolge der Aufrufe.
Ein `await store.save()` an der Stelle, an der live ein Flush laege, ist Teil des Aufbaus — nicht Kosmetik.
**Call-IDs sind Zeitstempel:** `call_` + `Date.now().toString(36)` in den ersten 8 Zeichen.
Damit laesst sich ein bestimmter Anruf ohne DB-Zugriff in Sweep-Logs wiederfinden.
Der Weglauf-Fall bleibt gedeckt, aber an der richtigen Stelle: Outbound setzt Abo+KYC voraus (am Code
belegt, `state-ops.js:1149`, `activation.js:87`, `outbound-gates.js:317`) — ein unverkaufter Tenant erzeugt
keine Carrier-Kosten; DID-Vermehrung deckeln `MAX_NUMBERS` (plattformweit) und `MAX_NUMBERS_PER_TENANT`.
