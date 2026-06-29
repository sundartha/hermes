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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = path.join(__dirname, "schema.sql");

// Wendet das (idempotente) Schema an. Mehrere Statements -> exec() (nicht query,
// das pro Aufruf nur eine Anweisung erlaubt).
export async function applySchema(db) {
  const ddl = fs.readFileSync(SCHEMA_FILE, "utf8");
  await db.exec(ddl);
}

// s<->ms-Bruecke (Unix-Sekunden <-> Date-Millis). Lokale Konstante; meter.js fuehrt
// dieselbe (G25, bewusst nicht geteilt - eine Zeit-Util-Datei fuer EINE Konstante waere
// Over-Engineering/S4).
const MS_PER_SECOND = 1000;

// Anker-Ableitung fuer den Bestands-Backfill: Start = Periodenende minus ein Monat
// (UTC-Kalender, einzige Katalog-Kadenz "month"). Unix-Sekunden rein/raus. Spiegelt die
// Anzeige-Logik meter.periodStartIso (dort ISO) - bewusste, dokumentierte Mini-Duplizierung
// ueber die Schicht-/Sprach-Grenze (einmalige Migration vs. Live-Anzeige). Die kanonische
// Laufzeit-Ableitung des Ankers folgt mit B2; B3 zieht meter.js auf den persistierten Anker.
function periodStartSecFromEnd(endSec) {
  const start = new Date(endSec * MS_PER_SECOND);
  start.setUTCMonth(start.getUTCMonth() - 1);
  return Math.floor(start.getTime() / MS_PER_SECOND);
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

// Eine oeffentliche Einstiegsfunktion: Schema anwenden, dann Owner-Defaults seeden.
export async function migrate(db, tenantId) {
  await applySchema(db);
  await backfillPeriodStart(db);
  await seedDefaults(db, tenantId);
}
