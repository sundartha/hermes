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

// Seedet die Owner-Zeilen (tenant, settings, usage, Demo-Kalender) aus den
// CODE-Defaults (defaults.js) - identisch zum frischen json-Zustand. Leere
// calls/actionItems/notifications/profiles brauchen keinen Insert.
export async function seedDefaults(db, tenantId) {
  await db.query(`INSERT INTO tenant (id) VALUES ($1) ON CONFLICT DO NOTHING`, [tenantId]);

  const s = defaultSettings();
  await db.query(
    `INSERT INTO settings
       (tenant_id, agent_name, greeting, allow_calendar, allow_booking,
        allow_summaries, allow_personal_data, allow_bank_data, sms_summary_opt_in, language)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId, s.agentName, s.greeting, s.allowCalendar, s.allowBooking,
      s.allowSummaries, s.allowPersonalData, s.allowBankData, s.smsSummaryOptIn, s.language]
  );

  await db.query(
    `INSERT INTO usage (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`,
    [tenantId]
  );

  // Owner-Nummern werden NICHT mehr beim Migrate geseedet: der Owner haelt seine
  // Nummer(n) wie jeder Tenant in der number-Tabelle, einmalig eingetragen via
  // scripts/seed-owner-number.js (gegen STORE_BACKEND=pg). Boot-Guard verlangt sie.

  // Demo-Kalender nur seeden, wenn fuer den Owner noch keiner existiert
  // (idempotent, ohne dass spaeter geloeschte Eintraege wieder auftauchen).
  const existing = await db.query(
    `SELECT 1 FROM calendar_event WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  if (existing.rows.length === 0) {
    for (const ev of demoCalendar()) {
      await db.query(
        `INSERT INTO calendar_event (id, tenant_id, title, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [ev.id, tenantId, ev.title, ev.start, ev.end]
      );
    }
  }
}

// Eine oeffentliche Einstiegsfunktion: Schema anwenden, dann Owner-Defaults seeden.
export async function migrate(db, tenantId) {
  await applySchema(db);
  await seedDefaults(db, tenantId);
}
