# DID-Monatsmiete wird nicht gebucht (`ohne_preis`)

**Status: GEPARKT.** Befund erhoben 2026-07-28, Owner-Entscheidung: erst nach
`PLAN-ASSISTANT-LEAP.md` anfassen, weil der Fix den Geld-Pfad beruehrt und
parallel eine andere Session am Repo arbeitet. Kein Zeitdruck: alle betroffenen
Nummern gehoeren dem Owner selbst, es gibt keine externen Kunden.

## Symptom

In den Live-Logs (Render-Service `vodafone-agent`), stuendlich wiederholt:

```
2026-07-28T17:50:17  [number-month] faellig=3 gebucht=0 ohne_preis=3 fehler=0
2026-07-28T18:50:17  [number-month] faellig=3 gebucht=0 ohne_preis=3 fehler=0
```

Drei faellige DID-Monatsmieten werden nicht gebucht. `fehler=0` — es sieht nach
Normalbetrieb aus.

## Ursache (bestaetigt)

Zwei fuer sich richtige Phasen der Gates-Kette ergeben zusammen eine Luecke:

- **P4** (`3c7bb29`, gemergt `e7df41d` am 28.07. 10:39) fuehrt `monthlyCostCents`
  additiv-nullable ein (`schema.sql:436`). Gesetzt wird das Feld NUR bei
  Neuaktivierung aus der Provider-Antwort (`state-ops.js:1448-1452`).
  **Ein Backfill fuer Bestandsnummern existiert nicht.**
- **P5** (`17c5e34`/`948ee62`, gemergt am 28.07. 14:17) fuehrt den wiederkehrenden
  Buchungsmechanismus ein, der bei `NULL` bewusst verweigert — Owner-Entscheidung
  vom 27.07., festgehalten in `metering.js:90-91`: kein Fallback, keine Schaetzung,
  kein `NUMBER_MONTHLY_COST_CENTS`.

Ergebnis: Jede vor P4 gekaufte Nummer ist dauerhaft von der Mietbuchung
ausgeschlossen.

Mechanik: `monthlyRentCents()` liefert `null`, wenn
`!Number.isInteger(number.monthlyCostCents)` (`src/billing/metering.js:92-94`);
`recordNumberMonthMeter` bucht dann nicht (`metering.js:104-107`), der Zaehler
steht in `recordDueNumberMonthMeters` (`metering.js:137-140`). "Faellig" ist
preis-unabhaengig: aktive Nummer ohne `NUMBER_MONTH`-Event im laufenden
Kalendermonat (`state-ops.js:2342-2358`). Log-Zeile:
`provisioning-orchestrator.js:281-285`.

## Datenlage (Prod, 2026-07-28)

3 aktive Rufnummern, **0 mit Preis, 3 ohne Preis**. Alle vor P4 gekauft:
Endziffern `8341` (24.06.), `1188` (10.07.), `0177` (24.07.). Die Owner-Nummer
hat nie einen `number_month`-Beleg. Die beiden Alt-Belege ueber 500 Cent bei
Aktivierung waren die Setup-Pauschale, keine Miete (kein `numberId`-Anker, keine
Wiederholung) — fuer die neue Logik irrelevant.

RLS-Hinweis fuer die Nacherhebung: naives SELECT liefert 0 Zeilen. Pro Tenant
`set_config('app.current_tenant', ...)` setzen, Muster wie `scripts/erase-tenant.js`.

## Bewertung

- **Kein Geldverlust.** Alle drei Nummern gehoeren dem Owner; es gibt keine
  externen Kunden. Buchfuehrung, nicht Umsatz. Groessenordnung rechnerisch
  ~2,76 EUR/Monat, aber nicht belastbar, weil kein echter Provider-Preis vorliegt.
- **Fuer Neukunden ist die Luecke zu** — neue Nummern bekommen den Preis beim Kauf.
- **Es wiederholt sich unbegrenzt**, stuendlich und jeden Folgemonat, solange
  `monthlyCostCents` NULL bleibt.

## Der eigentliche Mangel: das fehlende Signal

`ohnePreis` wird im ganzen Repo an **keiner anderen Stelle** gelesen (grep
bestaetigt). Die Meldung ist ein `console.log` auf Info-Niveau: kein Alarm, kein
Audit-Eintrag, keine `numberId`, kein Eskalationszaehler. Ein harmloser Einzelfall
und ein vollstaendiger Ausfall sehen identisch aus. Zusaetzlich steht die Zeile nur
unter `if (bilanz.faellig)` — ein Monat ganz ohne Faelligkeit bleibt komplett still.

## Vorschlag, wenn es angefasst wird

1. Einmaliger Backfill fuer aktive Nummern mit `monthly_cost_cents IS NULL`, der
   den Preis nachtraeglich beim Provider abfragt (Muster: der bestehende
   Geo-Backfill fuer Bestandsnummern).
2. Fuer Nummern, bei denen auch der Backfill keinen Preis liefert, braucht es eine
   bewusste Owner-Entscheidung statt stillem Dauerausschluss.
3. `ohnePreis > 0` lauter machen: `console.warn` plus Audit-Eintrag mit den
   betroffenen `numberId`s, damit ein Totalausfall nicht in einer stuendlich
   identischen Info-Zeile untergeht.
