// Schema-Anwendung + Seeding der Owner-Defaults fuer das pg-Backend. Idempotent:
// wiederholtes Aufrufen aendert nichts (ON CONFLICT DO NOTHING / leere-Tabelle-
// Guard). Bekommt eine DB-Verbindung injiziert (DIP) - keine eigene Verbindung
// hier. Verbindungs-Vertrag:
//   query(text, params) -> {rows}  : EINE parametrisierte Anweisung
//   exec(sqlScript)                : mehrere Anweisungen (DDL-Skript) ohne Params
// (pglite kann keine Mehrfach-Anweisung in query(); dafuer ist exec() da.)
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { defaultSettings, demoCalendar } from "../store/defaults.js";
import { MS_PER_SECOND, periodStartFromEnd } from "../billing/period.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = path.join(__dirname, "schema.sql");

// Wendet das (idempotente) Schema an. Mehrere Statements -> exec() (nicht query,
// das pro Aufruf nur eine Anweisung erlaubt).
export async function applySchema(db) {
  const ddl = fs.readFileSync(SCHEMA_FILE, "utf8");
  await db.exec(ddl);
}

// Anker-Ableitung fuer den Bestands-Backfill als Unix-Sekunden (Persistenz-Format).
// Duenner Wrapper um die geteilte Perioden-Ableitung (billing/period.js); dieselbe
// Domaenen-Regel wie die Live-Anzeige meter.periodStartIso (dort ISO).
function periodStartSecFromEnd(endSec) {
  return Math.floor(periodStartFromEnd(endSec).getTime() / MS_PER_SECOND);
}

// Einmaliger, idempotenter Backfill (B1a): Bestands-Tenants haben die neue Spalte
// stripe_current_period_start NULL. Fuer jede Zeile mit gespeichertem Ende aber leerem
// Start wird der Anker aus dem Ende abgeleitet und persistiert - sonst saehe das spaetere
// Minuten-Gate (B2) fuer Bestandskunden keinen Anker. Nach dem ersten Lauf 0 Treffer
// (Idempotenz). tenant-Tabelle hat keine RLS -> keine GUC noetig. PAYMENT_ENABLED=false ->
// keine Zeile traegt ein Ende -> 0 Updates (byte-identische Wirkung).
export async function backfillPeriodStart(db) {
  const rows = (
    await db.query(
      `SELECT id, stripe_current_period_end AS end_sec FROM tenant
        WHERE stripe_current_period_start IS NULL AND stripe_current_period_end IS NOT NULL`,
    )
  ).rows;
  for (const r of rows) {
    await db.query(`UPDATE tenant SET stripe_current_period_start = $1 WHERE id = $2`, [
      periodStartSecFromEnd(Number(r.end_sec)),
      r.id,
    ]);
  }
}

// Einmaliger, idempotenter Backfill (Review-Blocker Runde 2, Phase tenant-prolif-a, G26):
// Bestandszeilen aus der Zeit VOR der Email-Normalisierung (trim+lowercase, web-auth.js
// normalizeEmail) koennen abweichende Gross-/Kleinschreibung tragen. Ohne Backfill vergliche
// der Dedup-SELECT einen normalisierten Neu-Login gegen eine unnormalisiert gespeicherte
// Bestandszeile derselben Adresse und faende sie nicht -> genau die Tenant-Vermehrung, die
// diese Phase schliessen soll. Nach dem ersten Lauf 0 Treffer (Idempotenz). account hat
// keine RLS -> keine GUC noetig (Muster wie backfillPeriodStart). Laeuft NACH
// rekeyProfilesToTenant: die dortige Join-Bedingung (a.email = p.tenant_id) bleibt so exakt
// wie vor diesem Fix, unabhaengig davon, welche Schreibweise historische profile.tenant_id-
// Schluessel tragen.
export async function backfillAccountEmailCase(db) {
  await db.query(`UPDATE account SET email = lower(trim(email)) WHERE email <> lower(trim(email))`);
}

// Phase S: re-keyt die globale profile-Tabelle von email- auf tenantId-Schluessel (die
// reale Live-Heilung, LIVE=pg). applySchema hat die Spalte da schon von email auf tenant_id
// umbenannt; die DATEN-Schluessel (email-Werte) hebt diese Migration ueber den account-Join
// (gleiche DB, account ist RLS-exempt, profile_global erlaubt den Write) auf die zugehoerige
// tenantId. Idempotent: 2. Lauf - die Schluessel sind tenantIds != account.email -> INSERT/
// DELETE treffen 0. Non-destruktiv: Orphan-Schluessel ohne passenden Account bleiben (kein
// Datenverlust). Fail-safe: leere account-Tabelle -> No-Op (dann heilt der Backfill). Loggt
// nur Counts (kein PII). Die tenant-keyed Zeile gewinnt (ON CONFLICT DO NOTHING).
export async function rekeyProfilesToTenant(db) {
  const inserted = (
    await db.query(
      `INSERT INTO profile (tenant_id, data)
         SELECT a.tenant_id, p.data FROM profile p JOIN account a ON a.email = p.tenant_id
         ON CONFLICT (tenant_id) DO NOTHING
       RETURNING tenant_id`,
    )
  ).rows.length;
  const deleted = (
    await db.query(
      `DELETE FROM profile
        WHERE tenant_id IN (SELECT email FROM account WHERE email IS NOT NULL)
       RETURNING tenant_id`,
    )
  ).rows.length;
  if (inserted || deleted)
    console.log(`[migrate] profile rekey email->tenant_id: +${inserted} -${deleted}`);
}

// Seedet die Owner-Zeilen (tenant, settings, usage, Demo-Kalender) aus den
// CODE-Defaults (defaults.js) - identisch zum frischen json-Zustand. Leere
// calls/actionItems/notifications/profiles brauchen keinen Insert.
export async function seedDefaults(db, tenantId) {
  // Owner-Lockout-Schutz (Invariante O, p6-funnel): der Status-Default ist seit p6
  // 'suspended' (fail-safe). Der Owner/Bootstrap-Tenant MUSS explizit 'active' sein,
  // sonst sperrt der neue Default den Owner aus. ON CONFLICT DO NOTHING haelt es
  // idempotent (bestehende Owner-Zeile bleibt unveraendert).
  await db.query(`INSERT INTO tenant (id, status) VALUES ($1, 'active') ON CONFLICT DO NOTHING`, [
    tenantId,
  ]);

  const s = defaultSettings();
  await db.query(
    `INSERT INTO settings
       (tenant_id, agent_name, greeting, allow_calendar, allow_booking,
        allow_summaries, allow_personal_data, allow_bank_data, sms_summary_opt_in, language)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [
      tenantId,
      s.agentName,
      s.greeting,
      s.allowCalendar,
      s.allowBooking,
      s.allowSummaries,
      s.allowPersonalData,
      s.allowBankData,
      s.smsSummaryOptIn,
      s.language,
    ],
  );

  await db.query(`INSERT INTO usage (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [
    tenantId,
  ]);

  // Owner-Nummern werden NICHT mehr beim Migrate geseedet: der Owner haelt seine
  // Nummer(n) wie jeder Tenant in der number-Tabelle, einmalig eingetragen via
  // scripts/seed-owner-number.js (gegen STORE_BACKEND=pg). Boot-Guard verlangt sie.

  // Demo-Kalender nur seeden, wenn fuer den Owner noch keiner existiert
  // (idempotent, ohne dass spaeter geloeschte Eintraege wieder auftauchen).
  const existing = await db.query(`SELECT 1 FROM calendar_event WHERE tenant_id = $1 LIMIT 1`, [
    tenantId,
  ]);
  if (existing.rows.length === 0) {
    for (const ev of demoCalendar()) {
      await db.query(
        `INSERT INTO calendar_event (id, tenant_id, title, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [ev.id, tenantId, ev.title, ev.start, ev.end],
      );
    }
  }
}

// Eine oeffentliche Einstiegsfunktion: Schema anwenden, Bestands-Backfills laufen lassen,
// dann Owner-Defaults seeden. rekeyProfilesToTenant laeuft NACH applySchema (Spalte ist dann
// schon tenant_id) und VOR seedDefaults (haengt nicht an den Owner-Seeds).
export async function migrate(db, tenantId) {
  await applySchema(db);
  await backfillPeriodStart(db);
  await rekeyProfilesToTenant(db);
  await backfillAccountEmailCase(db);
  await seedDefaults(db, tenantId);
}
