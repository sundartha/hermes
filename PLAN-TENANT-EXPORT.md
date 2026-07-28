# PLAN-TENANT-EXPORT.md — Auskunftswerkzeug (DSGVO Art. 15)

> **STATUS: GEPARKT.** Vom Owner am 2026-07-28 bewusst zurueckgestellt. Keine Umsetzung
> geplant, kein Termin, keine Phasen. Dies ist ein Merkposten, damit der Befund nicht
> verlorengeht — kein Arbeitsplan.

## Warum es diese Datei gibt

DSGVO Art. 15 verpflichtet dazu, einer betroffenen Person auf Anfrage binnen eines Monats
Auskunft ueber die zu ihr gespeicherten Daten zu geben.

Der Owner hat entschieden, das **von Hand** zu erledigen — es gibt bewusst **keinen**
Selbstbedienungs-Export im Kundenkonto (Entscheidung 1 in `PLAN-AUTH-GATE.md`, Abschnitt 10).
Die Route `GET /api/tenant-data/export` (`src/routes/api-read.js:128`) bekommt dort
`internalOnly` und ist damit nur noch aus dem eigenen Prozess erreichbar.

Beim Aufschreiben jener Entscheidung fiel auf, dass fuer den manuellen Weg heute kein
Werkzeug existiert. Das ist der Grund fuer diese Notiz.

## Der Befund

- **Es gibt kein Export-Skript.** `scripts/` enthaelt `erase-tenant.js` (Loeschung nach
  Art. 17), aber kein Gegenstueck fuer die Auskunft. Geprueft per `ls scripts/`.
- **Die HTTP-Route hilft in Produktion nicht.** Nach der Umstellung auf `internalOnly`
  verlangt sie einen echten Loopback-Aufruf ohne `X-Forwarded-For`. Der Render-Plan bietet
  keine Shell auf dem laufenden Dienst — von aussen ist die Route damit nicht erreichbar.
- **Direktes `psql` liefert nichts.** Die Tabellen stehen unter FORCE-RLS
  (`src/db/schema.sql:552-578`, Policy `tenant_isolation` ab `:588`). Ein naives
  `SELECT * FROM call` gibt 0 Zeilen zurueck, ohne Fehlermeldung — das ist die Falle, in die
  man ohne Vorwissen zuerst laeuft.
- **Die Datenquelle existiert bereits.** `exportTenantData(s, tenantId)`
  (`src/store/state-ops.js:368`) liefert genau den Umfang, den `eraseTenantData` loeschen
  wuerde: Calls inklusive Transkripte, daraus abgeleitete Action Items, call-verknuepfte
  Notifications und die private Summary-Nummer (das personenbezogene Kontaktdatum). Es fehlt
  also nur der Aufrufer, nicht die Logik.

## Wenn es jemand anfasst — Skizze

Ein `scripts/export-tenant.js` als exakter Spiegel von `scripts/erase-tenant.js`:

- **Aufrufform** analog: `node scripts/export-tenant.js <tenantId>` (lesend, daher ohne das
  `--confirm`, das die Loeschung fail-closed absichert).
- **Am RLS vorbei fuehrt der Store, nicht rohes SQL.** `erase-tenant.js` importiert
  `../src/store.js` und arbeitet ueber die Fassade; der pg-Backend setzt dabei die
  Tenant-GUC (`SELECT set_config('app.current_tenant', ...)`, u.a. `src/store/pg.js:645`,
  `:1102`, `:1711`), gegen die die Policy prueft. Ein Export-Skript erbt das, wenn es
  denselben Weg nimmt — `store.exportTenantData(tenantId)` statt eigener Queries.
- **Ausfuehrung** wie beim Loesch-Skript: lokal, mit der Prod-`DATABASE_URL` in der Umgebung.
- **Ausgabe:** JSON auf stdout oder in eine Datei. Achtung, das Ergebnis ist per Definition
  ein PII-Vollbestand (Transkripte, Rufnummern) — nicht ins Repo, nicht in ein Log, nicht in
  einen Chat.
- **Offene Frage, die vor der Umsetzung zu klaeren waere:** ob der Umfang von
  `exportTenantData` fuer eine Art.-15-Auskunft vollstaendig ist. Er spiegelt heute den
  Loesch-Umfang; Settings, Profile, aktive Nummern, Kalender und Usage bleiben bewusst
  aussen vor (siehe Kopfkommentar von `scripts/erase-tenant.js`). Ob eine Auskunft weiter
  reichen muss als eine Loeschung, ist eine rechtliche Frage, keine technische.

## Was das offene Risiko ist

Bis das existiert, haengt die Einhaltung der Monatsfrist daran, dass der Owner im Ernstfall
improvisiert. Bewusst akzeptiert, solange keine Auskunftsanfrage vorliegt.
