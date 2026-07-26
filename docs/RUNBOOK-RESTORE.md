# Runbook: Datenbank-Restore (Postgres) + RTO/RPO

> Stand 2026-06-20. Wiederherstellung der Produktions-Persistenz nach Datenverlust,
> -korruption oder Instanz-/Region-Ausfall. Voraussetzung im Hosting ist Managed Postgres
> (`STORE_BACKEND=pg`, `render.yaml databases:`); der json-Store liegt auf Renders
> fluechtigem FS und hat **kein** Restore-Konzept. Quelle: `docs/strategy/p0-1-datenhaltung.md`
> Abschnitt 4.4-4.5. Konvention: Deutsch ohne Umlaute.

---

## 0. ZUERST LESEN

- **Original NIE ueberschreiben.** Jeder Restore legt eine **neue** Instanz an. Die
  geschaedigte Instanz bleibt fuer Forensik stehen (Ursache, Umfang, Zeitpunkt). Erst nach
  bestaetigter Verifikation (Abschnitt 7) wird produktiv umgeschaltet.
- **Repo-Split beachten.** Render deployt `upstream` (jonas986/vodafone-agent), **nicht**
  `origin`. Ein "Redeploy" nach dem Umhaengen der DB muss auf dem Service laufen, der
  `upstream` deployt. Details: `docs/RUNBOOK-OPERATOR.md` Abschnitt 0.
- **Secret-frei arbeiten.** `DATABASE_URL` ist ein Secret (Internal Connection String).
  Nie in Logs, Tickets, Chat oder Commits kopieren. Nur ueber das Render-Dashboard / die
  Env-Var setzen.
- **Rolle pruefen (fail-closed).** Die App-Rolle hinter `DATABASE_URL` MUSS **non-superuser
  und NOBYPASSRLS** sein, sonst greift FORCE-RLS nicht und der Start bricht ab (`[F5]`,
  `src/portal-pool.js`). Eine frisch wiederhergestellte Instanz kann eine andere
  Eigentuemer-/Rolle-Konstellation haben -> Abschnitt 4 Schritt 4.

---

## 1. RTO/RPO-Zielwerte

**Annahmen:** kleines Datenvolumen (Single-/Few-Tenant) -> Restore ist provider-dominiert,
nicht datenmengen-dominiert. Telefonie ist der kritische Pfad: DB-Verlust beim Boot ->
Prozess-Exit (`src/store.js`, `STORE_BACKEND=pg` + Init-Fehler -> `process.exit(1)`).
Wertvollste Daten: **`audit_log`** (immutable, append-only) und **`usage_event`**
(append-only Billing-Ledger).

| Szenario | RPO (taegl. Backup) | RPO (PITR) | RTO (Ziel) | Bemerkung |
|---|---|---|---|---|
| a) versehentl. DELETE / Daten-Korruption (App-Bug) | bis 24 h | **< 5 min** | 30-60 min | Eigentlicher PITR-Business-Case (Billing/Audit). |
| b) DB-Instanz-Verlust | bis 24 h | < 5 min | 30-90 min | Neue Instanz + neue `DATABASE_URL` + Redeploy. |
| c) Region-/Provider-Ausfall | bis 24 h (off-region-Export) | ~24 h (WAL meist regional) | **4-8 h** | PITR hilft hier NICHT allein -> off-region-Export noetig (Abschnitt 10). |

**Zielvorgabe (verbindlich):**

- **RPO-Ziel = 5 min** (verlangt PITR) — **Pflicht vor `PAYMENT_ENABLED=true` und echtem
  Multi-Tenant** (Billing/Audit duerfen nicht bis zu 24 h verlieren).
- **RPO-Minimum (Uebergang) = 24 h** (taegliches Managed-Backup) — akzeptabel nur im
  Owner-Prototyp ohne echte Zahlungen.
- **RTO-Ziel = 60 min** fuer a/b. **RTO-Maximum = 8 h** fuer c (Region/Provider).
- **Zusatzkontrolle gegen c:** woechentlicher, verschluesselter `pg_dump`-Export in eine
  zweite Region / einen Objektspeicher (Abschnitt 10).

> **PITR-Retention haengt am Workspace-Plan**, nicht am DB-Plan (Hobby ~3 Tage, Pro
> ~7 Tage; Quellenlage leicht widerspruechlich). **Vor jeder RPO-Zusage im Dashboard
> verifizieren.** `basic-1gb` ist der kleinste DB-Plan mit PITR + logischen Backups.

---

## 2. Voraussetzungen (vor dem Restore bereitlegen)

1. Render-Dashboard-Zugang (Owner/Admin) zum Workspace mit der Produktions-DB.
2. Wissen, **welcher** Web-Service `upstream` deployt (Abschnitt 0) — dort wird spaeter
   `DATABASE_URL` umgehaengt.
3. **Referenz-Row-Counts** der letzten gesunden Stunde, falls vorhanden (fuer Abschnitt 7).
   Wenn nicht vorhanden: Plausibilitaet statt exaktem Abgleich.
4. Bei Szenario a (PITR): den **Zielzeitpunkt unmittelbar VOR** dem schaedlichen Statement
   bestimmen (Abschnitt 5).

---

## 3. Entscheidung: welcher Pfad?

| Situation | Pfad |
|---|---|
| Daten noch da, aber durch ein DELETE/Update/Bug korrumpiert; Zeitpunkt bekannt | **5 — PITR** (praezise, minimaler Datenverlust) |
| DB-Instanz weg / unerreichbar / korrupt; Zeitpunkt egal, "letzter Stand reicht" | **4 — Managed-Backup** (juengstes Backup) |
| Ganze Region/Provider weg | **4 oder 10** (Backup falls Region zurueck; sonst off-region-`pg_dump`-Reimport) |
| Gar keine DB, nur ein `store.json` vorhanden | **9 — Notfall-Reimport** (Notnagel, kein Prod-Ersatz) |

---

## 4. Pfad A — Restore aus Managed-Backup (Szenario b/c)

1. **Render-Dashboard -> Postgres-Instanz -> Tab "Backups".**
2. **Juengstes Backup VOR dem Schaden** waehlen -> **Restore**. Render legt damit eine
   **neue** Instanz an (das Original bleibt fuer Forensik bestehen — nicht loeschen).
3. Warten, bis die neue Instanz `available` ist. **Internal Connection String** der neuen
   Instanz kopieren (Secret — Abschnitt 0).
4. **Rolle pruefen/herstellen.** Sicherstellen, dass die App **nicht** als Superuser /
   `rolbypassrls` verbindet:
   ```sql
   -- gegen die wiederhergestellte Instanz, mit dem App-Rollennamen:
   SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = '<app_user>';
   -- erwartet: rolsuper = f, rolbypassrls = f
   ```
   Falls die App-Rolle fehlt oder zu maechtig ist: non-superuser/NOBYPASSRLS-Rolle neu
   anlegen und `DATABASE_URL` auf deren Credentials setzen (sonst `[F5]`-Boot-Refusal).
5. Weiter mit **Abschnitt 6 (Umhaengen)** — aber erst nach **Abschnitt 7 (Verifikation)**.

---

## 5. Pfad B — Restore via PITR (Szenario a)

PITR erlaubt das Zuruecksetzen auf einen **frei waehlbaren Zeitpunkt** (Sekundengenauigkeit
im Retention-Fenster). Der Trick ist, den Zielzeitpunkt **unmittelbar vor** dem schaedlichen
Statement zu treffen — sonst stellt man den Schaden mit wieder her.

1. **Zielzeitpunkt bestimmen.** `audit_log` ist append-only und laeuft ohne RLS — die
   sauberste Quelle fuer die Zeitachse. Gegen eine noch erreichbare Replik/Instanz (oder
   aus Anwendungs-Logs) den letzten "guten" Zeitpunkt suchen:
   ```sql
   -- Kontext rund um den Schaden (z.B. ein versehentliches Massen-DELETE):
   SELECT id, at, actor_sub, action, detail
   FROM audit_log
   ORDER BY at DESC
   LIMIT 50;
   ```
   Zielzeit `T` = **kurz vor** dem ersten schaedlichen `at`-Wert (z.B. eine Sekunde davor).
2. **Render-Dashboard -> Postgres-Instanz -> PITR / "Restore to point in time".**
   Zeitpunkt `T` (UTC) eingeben -> Restore. Auch das erzeugt eine **neue** Instanz.
3. Internal Connection String der neuen Instanz kopieren; **Rolle pruefen** wie in
   Abschnitt 4 Schritt 4.
4. Weiter mit **Abschnitt 6**, danach **Abschnitt 7** (dort wird `MAX(audit_log.at) <= T`
   geprueft — der direkte Beweis, dass `T` korrekt getroffen wurde).

> **Retention-Grenze:** Liegt `T` ausserhalb des PITR-Fensters (Workspace-Plan, Abschnitt 1),
> ist PITR nicht moeglich -> auf das juengste Managed-Backup im Fenster ausweichen (Pfad A)
> und den Restdatenverlust akzeptieren/dokumentieren.

---

## 6. Web-Service auf die neue Instanz umhaengen

1. **Render-Dashboard -> Web-Service (der `upstream` deployt) -> Environment.**
2. `DATABASE_URL` auf den **Internal Connection String der neuen Instanz** setzen.
3. `STORE_BACKEND=pg` sicherstellen — **es gibt heute KEIN Boot-Gate gegen json im Hosting**
   (der Footgun-Guard `productionFootguns()` prueft das noch nicht; das ist Strategie Phase A /
   AC1 und unimplementiert). Ein vergessenes/falsches `STORE_BACKEND` startet **still** auf
   dem fluechtigen json-Store -> erneuter Datenverlust. Darum hier **manuell** verifizieren
   (Render-Env + Boot-Log). Der einzige existierende STORE_BACKEND-Boot-Refusal ist das
   Gegenteil: `STORE_BACKEND=pg` OHNE `DATABASE_URL` (`src/config.js:251`).
4. **Manuellen Redeploy** ausloesen (Render: "Manual Deploy -> Deploy latest commit"). Die
   Migration ist idempotent (`IF NOT EXISTS` / `ON CONFLICT`), ein erneuter Lauf gegen die
   wiederhergestellte Instanz veraendert vorhandene Daten nicht.
   - Sobald `scripts/migrate.js` als `preDeployCommand` existiert (Strategie Phase C/D),
     laeuft die Migration + DB-Erreichbarkeitspruefung **vor** Go-Live; schlaegt sie fehl,
     bricht der Deploy ab und der **alte** Service laeuft weiter (kein Halb-Zustand).
   - Bis dahin migriert der Boot selbst (`src/store.js` Top-Level-Import).
5. **Noch KEINEN Inbound-Traffic / keine Nummer freigeben** — zuerst Abschnitt 7.

> **Frische/leere DB (GAP-38):** eine Instanz ganz ohne Bestandsdaten heilt sich beim
> **ersten Boot selbst**, sofern `BOOTSTRAP_E164` (E.164 einer echten Provider-DID) und
> `BOOTSTRAP_PROVIDER` (`twilio|telnyx`) im Render-Dashboard gesetzt sind — der Boot legt
> Bootstrap-Tenant + aktive Nummer an, statt fail-closed mit `exit 1` abzubrechen. Das
> ersetzt den frueheren `preDeployCommand`, den Render auf `plan: free` nie ausgefuehrt hat.
> Erfolgsbeleg: die Log-Zeile `[bootstrap-heal] Leerer Store … geheilt` plus die
> Plattform-SMS an `PLATFORM_ALERT_SMS_TO`.
>
> **Ein Store mit Daten, aber ohne aktive Nummer wird NICHT geheilt** (Proliferations-Schutz;
> Log: `Proliferations-Schutz`). Das ist der Restore-Normalfall bei Teil-Wiederherstellung —
> dann manuell: `npm run bootstrap-tenant -- <e164> <provider>`.

---

## 7. Verifikation VOR Produktiv-Schaltung

> Reihenfolge: **erst lesen, dann Traffic.** Jeder Punkt muss gruen sein, bevor die
> Telefonnummer/Inbound wieder scharf geschaltet wird.

1. **Gesundheit:** `GET /healthz` -> `200 {"ok":true}`. Der Prozess lebt = pg-Init hat
   nicht mit `exit 1` abgebrochen (DB erreichbar, Rolle ok).
2. **Richtige Version:** Im Render-Log das `[boot] deployed commit=<sha>`-Banner gegen den
   erwarteten Commit pruefen (Render setzt `RENDER_GIT_COMMIT`). So ist eindeutig, welche
   Code-Version gegen die neue DB laeuft.
3. **Probe-Reads (lesend, ungefaehrlich):** `GET /api/state` (enthaelt bereits den neuesten
   Calls-Slice) und optional `GET /api/calls/:id` mit einer bekannten Call-ID liefern `200`
   mit plausiblem Inhalt (keine 500er, keine leeren Pflicht-Slices).
   **Achtung:** `GET /api/calls` ohne `:id` existiert nicht — `/api/calls` ist nur `POST`
   (loest einen Outbound-Call aus, `src/server.js:636`); NICHT zur Verifikation verwenden.
4. **Row-Counts gegen Referenz** (Abschnitt 2) — die geschaeftskritischen Tabellen:
   ```sql
   SELECT
     (SELECT count(*) FROM call)        AS calls,
     (SELECT count(*) FROM usage_event) AS usage_events,
     (SELECT count(*) FROM audit_log)   AS audit_rows,
     (SELECT count(*) FROM number)      AS numbers;
   ```
   Erwartung: nahe der letzten gesunden Referenz; bei PITR bewusst `< Stand vor Schaden`.
5. **PITR-Beweis (nur Pfad B):** Der juengste Audit-Eintrag liegt vor dem Zielzeitpunkt `T`:
   ```sql
   SELECT max(at) AS newest_audit FROM audit_log;  -- muss <= T sein
   ```
6. **Erst wenn 1-5 gruen sind:** Inbound / Telefonnummer wieder freigeben (siehe
   `docs/RUNBOOK-OPERATOR.md` fuer die scharfen Schalter).

---

## 8. Restore-Drill (quartalsweise, mit Stoppuhr)

Ziel: beweisen, dass der Pfad oben unter Zeitdruck funktioniert, und **Ist-RTO/RPO** gegen
die Zielwerte (Abschnitt 1) messen — bevor ein echter Vorfall die Probe ist.

1. **Wegwerf-Instanz** per Restore (Pfad A oder B) anlegen. **Prod-`DATABASE_URL` NICHT
   umstellen** — der Drill darf die Produktion nicht beruehren.
2. **Stoppuhr ab Schritt 1.** Restore + Verifikation (Abschnitt 7, Punkte 1-5 gegen die
   Restore-URL bzw. eine lokal mit der Restore-`DATABASE_URL` gestartete Instanz) durchziehen.
3. **Messen und eintragen:**
   - **Ist-RTO** = Zeit von "Restore gestartet" bis "Verifikation gruen".
   - **Ist-RPO** = Abstand vom Restore-Stand zum letzten gewuenschten Datenstand.
4. **Spiegeln gegen Ziel** (RTO 60 min a/b, RPO 5 min PITR). Abweichung -> Ursache + Massnahme.
5. **Aufraeumen:** Wegwerf-Instanz loeschen (vermeidet Restkosten).
6. **Ergebnis hier protokollieren:**

   | Datum | Pfad (A/B) | Ist-RTO | Ist-RPO | Ziel erreicht? | Notiz |
   |---|---|---|---|---|---|
   | _(leer — erster Drill ausstehend)_ | | | | | |

---

## 9. Notfall-Reimport (nur `store.json` vorhanden)

**Realitaetscheck zuerst:** Renders Free-FS ist fluechtig — ein produktiver `store.json`
existiert dort i.d.R. **gar nicht**. Dieser Pfad ist ein **Notnagel** fuer lokale/Demo-
Bestaende und Drills, **kein** Ersatz fuer Managed-Backups/PITR.

- Benoetigt das Import-Script `scripts/import-json-to-pg.js` (**Strategie Phase G — heute
  noch nicht vorhanden**). Solange es fehlt, ist dieser Pfad nicht ausfuehrbar; bei akutem
  Bedarf zuerst Phase G umsetzen.
- Geplanter Ablauf (Strategie 5.4): `state = JSON.parse(store.json)` -> json-Migrationen ->
  `migrate(client)` -> `flush(client, state)` (Full-Upsert unter RLS-GUC) gegen eine frische
  pg-Instanz. Danach weiter wie Abschnitt 6-7.
- **Cut-over "leer starten" ist akzeptabel** im Owner-Prototyp: `seedDefaults` reproduziert
  den Owner-Grundzustand byte-nah zum frischen json-State.

---

## 10. Off-Region-Export (Zusatzkontrolle gegen Szenario c)

PITR und Managed-Backups liegen i.d.R. **in derselben Region** wie die DB und decken einen
Region-/Account-/Provider-Totalausfall **nicht** ab. Gegenmassnahme:

- **Woechentlicher, verschluesselter `pg_dump`-Export** in eine zweite Region / einen
  Objektspeicher. Deckt auch "Render-Account weg" ab (was PITR strukturell nicht kann).
- Restore-Weg im Ernstfall: frische pg-Instanz (ggf. bei anderem Provider) anlegen ->
  `pg_restore`/`psql` des juengsten Exports -> Rolle pruefen (Abschnitt 4 Schritt 4) ->
  Abschnitt 6-7.
- Automatisierung (Cron/Worker) ist noch offen; bis dahin manuell + im Drill (Abschnitt 8)
  mitpruefen.

---

## 11. Bekannte Grenzen / offene Punkte

- **PITR-Retention** haengt am Workspace-Plan (Abschnitt 1) — vor jeder RPO-Zusage im
  Dashboard verifizieren.
- **Kein Migrations-Versioning** (`schema_migrations` fehlt; Strategie R5) — ein Restore auf
  einen alten Stand kennt die Schema-Historie nicht; weil die Migration idempotent +
  additiv ist, ist das heute unkritisch, aber bei kuenftigen destruktiven Migrationen
  relevant.
- **Datenresidenz/DSGVO:** `region: frankfurt` ist technische Lokalisierung, keine
  Rechtsgarantie. Restore-Kopien/Exports unterliegen derselben Pruefung (ggf. Render-DPA).
- **Forensik vor Loeschung:** geschaedigte Original-Instanz erst nach Ursachen-Klaerung
  loeschen (sonst geht der Beweis fuer Umfang/Zeitpunkt verloren).

---

## 12. Querverweise

- `docs/strategy/p0-1-datenhaltung.md` — Strategie (4.4 RTO/RPO, 4.5 Runbook, 5.4 Reimport).
- `docs/RUNBOOK-OPERATOR.md` — Repo-Split (Abschnitt 0), scharfe Schalter (Anhang A),
  Postgres-Prod + Killer-Test (Gate 6).
- `docs/RELEASE-GATE-killer-test.md` — manuelles RLS-/Pooling-Gate vor Prod-Deploy.
- `STATUS-OFFENE-PHASEN.md` Abschnitt 3 — Betreiber-ToDo "Postgres prod:
  non-superuser/NOBYPASSRLS + pgBouncer (transaction mode), EU/DE".
- `scripts/migrate.js` (Phase C/D, geplant) — preDeploy-DB-Gate + Single-Point-of-Migration.
- `scripts/import-json-to-pg.js` (Phase G, geplant) — Notfall-Reimport (Abschnitt 9).
