# Phase KV-M4 — Monatliche Gegenprobe (Beobachtung)

- **Gate:** PASS
- **finalBranch:** `phase/kv-m4-monatliche-gegenprobe`
- **headCommit (Worktree):** e2c2d24

## Zweck

KV-M4 ist die einzige Phase in der Kosten-Vollstaendigkeit-Kette, die gegen **unbekannte** Luecken absichert — nicht gegen bereits benannte. Alle anderen Phasen pruefen bekannte Kanten (Formel, Ledger-Map, Denominator). KV-M4 vergleicht monatlich drei unabhaengig entstandene Zahlen (Provider-Rechnung, rekonstruierte Ist-Kosten, Gate-Buchung) und protokolliert Abweichungen — ohne selbst irgendetwas zu entscheiden oder zu sperren. **Reine Beobachtung, keine Sperrwirkung.**

## Die drei Quellen (mit Einheit)

| # | Zahl | Quelle | Einheit |
|---|---|---|---|
| 1 | Telnyx-Monatsrechnung | `telnyxVoice.fetchMonthlyInvoiceTotal({month})` (Port-Erweiterung, Telnyx-Adapter, `GET /v2/invoices`) | USD-Mikro-Cent |
| 2 | Ist-Kosten unserer Calls | `actualCostMicroCentsForMonth(state, monthKey)` (`state-ops.js`), Summe ueber `calls` mit `costTruedAt !== null`, Provider `telnyx`, Monat via `estimatedCostSpendMonthKey` | USD-Mikro-Cent |
| 3 | Gate-gebuchte Carrier-Betraege | `carrierGateCostCentsForMonth(state, monthKey)` (`state-ops.js`), Summe ueber `usageEvents` mit `kind=VOICE_MINUTE`, Monat via `spendMonthKeyOf` | EUR-Cent (Ledger-Proxy fuer die Gate-Achse) |

**Carrier-Anteil der Gate-Achse ist NICHT getrennt lesbar — das steht hier bewusst prominent:** `usage.costCents` ist ein einziger, ungetrennter Skalar ueber alle Kosten-Arten (KI-Token, Carrier-Minuten, Recherche gemeinsam über `bookCents`). Es gibt keine persistierte Aufschluesselung nach Kosten-Art auf der Gate-Achse selbst. Zahl 3 ist deshalb eine **Ersatzgroesse**, keine direkte Ablesung: die Ledger-Summe `kind=VOICE_MINUTE`. Diese Ersatzgroesse **unterschaetzt systematisch**, sobald `PAYMENT_ENABLED=false` war (Default), weil `recordVoiceMinuteMeter` (schreibt den Ledger-Beleg) nur unter `PAYMENT_ENABLED` laeuft, waehrend `reconcileVoiceBudget` (bucht auf die Gate-Achse) **immer** laeuft. Beide sitzen im selben Funktionsrumpf (`call-finish.js`), sind aber zwei getrennte Schreiber.

**Was die Gegenprobe dadurch tatsaechlich vergleicht:** Diff 2 (Ist-Kosten vs. Gate-Buchung) zeigt nicht zwingend einen echten Buchungsfehler — er kann genauso gut nur die Config-Luecke `PAYMENT_ENABLED=false` widerspiegeln. Solange diese Luecke besteht, ist Diff 2 kein verlaessliches Fehlersignal, sondern bestenfalls eine grobe Kontrollgroesse. Das ist im Log und im Code-Kommentar so benannt, nicht stillschweigend als "die Zahl" ausgegeben.

Zusaetzlich hat sich waehrend der Umsetzung eine zweite, unabhaengige Unschaerfe bestaetigt: Die Telnyx-Invoice-API (`/v2/invoices`) traegt — live geprueft UND gegen das offizielle `team-telnyx/openapi`-Schema abgeglichen — **kein Geldbetragsfeld** (nur `invoice_id`, `file_id`, `period_start`, `period_end`, `paid`, `url`). Das Telnyx-Konto ist zudem prepaid (`GET /v2/balance`: `credit_limit=0`). Zahl 1 (Telnyx-Rechnung) ist damit strukturell **immer** `ok:false` mit einem begruendeten `reason` (u.a. `amount_not_exposed_by_provider`) — kein erfundener `ok:true`-Zweig fuer ein nicht existierendes Feld. Diff 1 (Rechnung vs. Ist-Kosten) bleibt deshalb dauerhaft unbeantwortet; nur Diff 2 (Ist-Kosten vs. Gate-Buchung) ist heute tatsaechlich funktionsfaehig.

## Waehrungsbehandlung

Zahl 1 und Zahl 2 sind beide USD-Mikro-Cent (Provider-Waehrung) — ihre Differenz laeuft **nativ ohne FX-Umrechnung**. Zahl 3 ist EUR-Cent (Bucket-Waehrung). Die Umrechnung von Zahl 2 nach EUR laeuft an genau einer bestehenden Kante: `providerMicroCentsToBucketCents` (`cost-calibration.js`) mit `config.billing.providerToBucketRateMicro` — derselben Funktion, die bereits den Tarif-Drift-Waechter speist. Keine zweite Umrechnungsfunktion wurde hinzugefuegt. Die verwendete Rate ist im Log sichtbar.

## Log-Zeile (Wortlaut)

```
[cost-cross-check] monat=2026-07 telnyx_rechnung_usd_micro_cent=1245000000 ist_calls_usd_micro_cent=1198000000 diff_rechnung_minus_ist_usd_micro_cent=47000000 gate_carrier_eur_cent=920 ist_konvertiert_eur_cent(rate=920000)=1103 diff_ist_minus_gate_eur_cent=183
```

(Werte aus dem Testlauf/Fixture-Kontext, keine Live-Produktionszahlen. Die `telnyx_rechnung_*`-Felder erscheinen im Log auch bei strukturell dauerhaftem `ok:false`, damit die Zeile ihr Format nicht heimlich aendert — der `reason` bei Fehlschlag steht separat mit im Log, s. Code.)

## Monats-Riegel und Neustart-Beleg

`state.costCrossCheck.lastCheckedMonthKey` (Muster wie `platform_tts_usage`) verhindert Mehrfachlauf im selben Monat. Persistenz: `json.js` schreibt es im Save-Snapshot mit, `pg.js` in einer eigenen Singleton-Tabelle `cost_cross_check` (id=1, additiv per `CREATE TABLE IF NOT EXISTS`, RLS-Policy nach Bestandsmuster, kein Backfill, kein manueller Migrationsschritt). Der Neustart-Beleg (KV-M4-3) ist kein reiner In-Memory-Test zweier Aufrufe, sondern ein echter `JSON.stringify`/`parse`-Roundtrip, der einen simulierten Prozess-Neustart nachbildet.

## Provider-Fehlerfall — warum er den Sweep nicht umbringt

`fetchMonthlyInvoiceTotal` wirft nie; sie liefert bei Fehlern ein Ergebnisobjekt `{ok:false, reason}`. Sollte trotzdem irgendwo im Cross-Check-Pfad ein `throw` auftreten, belegt KV-M4-8 direkt an der exportierten `runSweepTick()` (`boot.js`) mit einem werfenden `costCrossCheck`-Fake per Spy: `costTruing.runCostTruingSweep` und `provisioning.settleDueNumberMonthMeters` laufen trotzdem weiter. Grund: JavaScript wandelt einen `throw` in einer `async`-Funktion in eine rejected Promise um, nie in einen synchronen Abbruch des aufrufenden Sweeps — der monatliche Cross-Check reitet auf dem bestehenden stuendlichen Sweep mit, es gibt keinen zweiten Timer.

Bewusste Nebenwirkung (kein Fehler, aber im Safety-Review als Concern vermerkt): Bei Provider-Fehlschlag wird der Monat trotzdem als "geprueft" gestempelt und **nicht** automatisch nachgeholt. Ein dauerhaft ausfallender Provider erzeugt damit dauerhaft eine Luecke in der Beobachtung ohne eingebauten Wiederholungsmechanismus.

## Mutationsprobe

`carrierGateCostCentsForMonth` wurde testweise von `kind=VOICE_MINUTE` auf `kind=AI_TOKEN` umgestellt. Ergebnis: KV-M4-1 wurde rot (`gate_carrier_eur_cent` 920→999, exakte Log-Zeile weicht ab), alle uebrigen 7 Tests blieben gruen — die Mutationsprobe traf gezielt genau den einen Test, der die Kosten-Art-Filterung prueft. Mutation zurueckgenommen, `node --check` + KV-M4-Suite erneut gruen (8/8), `git diff` leer.

## Angepasste Bestandstests

Keine Bestandstests wurden geaendert. `test/cost-truing-harness.js` wurde um `markCostCrossCheckAttempted` im Stub-Store erweitert (kein zweiter Stub, additive Ergaenzung des bestehenden Harness).

Neu: `test/kv-m4-monthly-cross-check.test.js` (KV-M4-1 bis KV-M4-8), netzfrei, alle gruen.

## Safety-Urteil

**Approved.** Reine, additive Beobachtungsphase. Gate-Achse und Ledger werden nur gelesen, kein zweiter Timer, Monats-Riegel persistiert in JSON und Postgres mit Neustart-Beleg, Provider-Fehlschlag wirft nie und stempelt trotzdem (Last-/Budget-schonend), Waehrung ist an genau einer bestehenden Kante explizit umgerechnet und im Log sichtbar, keine Schwelle/kein Alarm/keine SMS im Diff, kein API-Key im Log, alle Tests inkl. Mutationsprobe gruen.

Vom Safety-Reviewer vermerkte Concerns (kein Blocker):
- `fetchMonthlyInvoiceTotal` ist heute strukturell immer `ok:false` (Telnyx-Invoice-API traegt keinen Betrag) — Diff 1 bleibt dauerhaft unbeantwortet.
- Bei Provider-Fehlschlag wird der Monat als geprueft gestempelt und nie automatisch nachgeholt — dauerhafter Providerausfall erzeugt eine dauerhafte Beobachtungsluecke ohne Wiederholungsmechanismus.

Unabhaengige Testbestaetigung: `npm test` (bzw. der direkte Aufruf hinter dem Wrapper) 3843/3843 gruen, 0 Fehler; `kv-m4-monthly-cross-check.test.js` 8/8 gruen; Mutationsprobe wie oben beschrieben verifiziert und zurueckgenommen.

## Clean-Code-Audit

**PASS.** Keine Blocker (S1/S2 leer), keine Findings in S3/S4. DIP eingehalten (`fetch` nur im Telnyx-Adapter hinter `ports.js`), Geld durchgaengig als Ganzzahl mit Einheit im Namen, drei Summen mit je genau einer Quelle (Provider / `calls` / `usageEvents`), benannte Konstanten vorhanden, Fehlerpfad loggt Status/Code/Reason ohne Secrets. 8 neue Tests, je ein Konzept pro Test, Grenzfaelle als eigene Faelle, netzfrei, alle gruen. 95 verwandte Bestandstests weiterhin gruen, kein Regressionsfund.

## Fix-Runden inkl. Fehlalarme

Keine Fix-Runde noetig — Review lief direkt auf PASS (Safety und Clean-Code je beim ersten Durchlauf gruen, FIXES-Feld leer). Als Abweichung von der urspruenglichen Planannahme (kein Fehlalarm, sondern eine waehrend der Umsetzung falsifizierte Annahme): Der Plan ging von einem Betragsfeld in `/v2/invoices` aus; live-Abfrage und OpenAPI-Schema widerlegten das. `fetchMonthlyInvoiceTotal` wurde daraufhin gegen die reale Form implementiert (Monats-Zeile ueber `period_start` gefunden, sortiert, ein GET) und liefert begruendetes `ok:false` statt eines erfundenen Betragszweigs.

Weitere dokumentierte Abweichungen (kein Scope-Verstoss):
- KV-M4-8 ist ein direkter In-Process-Unit-Test von `runSweepTick` statt eines gespawnten Kindprozesses mit kurzer Sweep-Kadenz (kein Praezedenzfall im Repo fuer letzteres, waere langsamer/flakiger fuer dieselbe rein JS-semantische Eigenschaft).
- Die Store-Mutation laeuft ueber eine neue Fassaden-Methode `store.markCostCrossCheckAttempted(monthKey)` (json.js + pg.js) statt einer direkten pure-state-ops-Funktion auf `store.load()` — folgt der bestehenden Persistenz-Konvention (Mutation + `save()` im selben Wrapper).
- `npm run test:gates` hing reproduzierbar bei einem bekannten, bereits dokumentierten Flake (`test/auth-p9a-cache-headers.test.js` unter `--test-name-pattern`) und wurde nach ~90s manuell abgebrochen; bis dahin 575 ok / 4 not ok, keiner davon KV-M4-bezogen (3x bereits bekannte offene Gates, 1x der abgebrochene Wrapper selbst).
- `npm test` selbst brach in dieser Sandbox reproduzierbar mit Exit 194 ohne Ausgabe ab (Sandbox-/Tooling-Artefakt); die dahinterliegende Invocation direkt ausgefuehrt lief vollstaendig durch (3843/3843 gruen).

## Was diese Phase bewusst NICHT tut

- **Keine Schwelle.** Owner-Entscheidung 6 (ab welcher Diff-Groesse ein Alarm ausgeloest wird) ist offen und laut Plan erst nach dem dritten Monatswert entscheidbar — es gibt noch keine Datenbasis, um eine Schwelle sinnvoll zu setzen.
- **Keine Plattform-Fixkosten.** Owner-Entscheidung 7 (ob/wie plattformweite Fixkosten in die Gegenprobe einfliessen) ist offen und wird hier nicht vorweggenommen.
- **Kein zweiter Timer.** Der Cross-Check reitet ausschliesslich auf dem bestehenden stuendlichen Sweep mit; es gibt keine eigene Kadenz, keinen eigenen Scheduler.

## Was der Lead tun muss

1. Nach dem naechsten Deploy die **erste Gegenprobe-Zeile** im Render-Log ablesen (Muster `[cost-cross-check] monat=...`) und in `tasks/PLAN-KOSTEN-VOLLSTAENDIGKEIT.md` eintragen.
2. Nach **drei** Monatswerten die Schwellen-Frage (Owner-Entscheidung 6) dem Owner erneut vorlegen — vorher gibt es keine ausreichende Datenbasis fuer eine sinnvolle Schwelle.
