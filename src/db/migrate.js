import { createHash } from "node:crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { countryForE164, defaultSettings, demoCalendar, TENANT_STATUS } from "../store/defaults.js";
import { languageForCountry } from "../i18n/locales.js";
import { periodStartFromEnd } from "../billing/period.js";
import { MS_PER_SECOND } from "../utils/timer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AUSGANG_NAME = "0001_ausgang.sql";
const VERSIONSTABELLE_NAME = "0002_versionstabelle.sql";
const BESTAETIGUNGSCODES_NAME = "0003_bestaetigungscodes.sql";
const LOGIN_BREMSE_NAME = "0004_login_bremse.sql";
const WEBHOOK_ZUSTELLUNG_NAME = "0005_webhook_zustellung.sql";
const NOT_PLACED_MAIL_MARKER_NAME = "0006_not_placed_mail_marker.sql";
const EINSTELLUNGEN_STAND_NAME = "0007_einstellungen_stand.sql";
const PLATTFORM_KOSTENSTELLE_ZEICHEN_NAME = "0008_plattform_kostenstelle_zeichen.sql";
const MANDANT_STAND_NAME = "0009_mandant_stand.sql";
const BESTAETIGUNGSCODES_LOESCHEN_NAME = "0010_bestaetigungscodes_loeschen.sql";
const VORSPANN_BRUECKE_SPALTEN_NAME = "0011_vorspann_bruecke_spalten.sql";
const STRIPE_EREIGNIS_REGISTER_NAME = "0012_stripe_ereignis_register.sql";
const TRANSKRIPT_WIDERSPRUCH_NAME = "0013_transkript_widerspruch.sql";

const MIGRATION_READERS = [
  {
    name: AUSGANG_NAME,
    read: () => fs.readFileSync(path.join(__dirname, "migrations", AUSGANG_NAME), "utf8"),
  },
  {
    name: VERSIONSTABELLE_NAME,
    read: () => fs.readFileSync(path.join(__dirname, "migrations", VERSIONSTABELLE_NAME), "utf8"),
  },
  {
    name: BESTAETIGUNGSCODES_NAME,
    read: () =>
      fs.readFileSync(path.join(__dirname, "migrations", BESTAETIGUNGSCODES_NAME), "utf8"),
  },
  {
    name: LOGIN_BREMSE_NAME,
    read: () => fs.readFileSync(path.join(__dirname, "migrations", LOGIN_BREMSE_NAME), "utf8"),
  },
  {
    name: WEBHOOK_ZUSTELLUNG_NAME,
    read: () =>
      fs.readFileSync(path.join(__dirname, "migrations", WEBHOOK_ZUSTELLUNG_NAME), "utf8"),
  },
  {
    name: NOT_PLACED_MAIL_MARKER_NAME,
    read: () =>
      fs.readFileSync(path.join(__dirname, "migrations", NOT_PLACED_MAIL_MARKER_NAME), "utf8"),
  },
  {
    name: EINSTELLUNGEN_STAND_NAME,
    read: () =>
      fs.readFileSync(path.join(__dirname, "migrations", EINSTELLUNGEN_STAND_NAME), "utf8"),
  },
  {
    name: PLATTFORM_KOSTENSTELLE_ZEICHEN_NAME,
    read: () =>
      fs.readFileSync(
        path.join(__dirname, "migrations", PLATTFORM_KOSTENSTELLE_ZEICHEN_NAME),
        "utf8",
      ),
  },
  {
    name: MANDANT_STAND_NAME,
    read: () =>
      fs.readFileSync(path.join(__dirname, "migrations", MANDANT_STAND_NAME), "utf8"),
  },
  {
    name: BESTAETIGUNGSCODES_LOESCHEN_NAME,
    read: () =>
      fs.readFileSync(
        path.join(__dirname, "migrations", BESTAETIGUNGSCODES_LOESCHEN_NAME),
        "utf8",
      ),
  },
  {
    name: VORSPANN_BRUECKE_SPALTEN_NAME,
    read: () =>
      fs.readFileSync(path.join(__dirname, "migrations", VORSPANN_BRUECKE_SPALTEN_NAME), "utf8"),
  },
  {
    name: STRIPE_EREIGNIS_REGISTER_NAME,
    read: () =>
      fs.readFileSync(path.join(__dirname, "migrations", STRIPE_EREIGNIS_REGISTER_NAME), "utf8"),
  },
  {
    name: TRANSKRIPT_WIDERSPRUCH_NAME,
    read: () =>
      fs.readFileSync(path.join(__dirname, "migrations", TRANSKRIPT_WIDERSPRUCH_NAME), "utf8"),
  },
];

function migrationTexts() {
  return MIGRATION_READERS.map((entry) => entry.read());
}

export function schemaDdl() {
  return migrationTexts().join("\n");
}

export async function applySchema(db) {
  for (const text of migrationTexts()) await db.exec(text);
}

function checksumOf(entry) {
  return createHash("sha256").update(entry.read()).digest("hex");
}

async function recordMigration(db, index, entry) {
  await db.query(
    `INSERT INTO schema_migrations (version, name, checksum)
     VALUES ($1, $2, $3)
     ON CONFLICT (version) DO NOTHING`,
    [index + 1, entry.name.replace(/\.sql$/, ""), checksumOf(entry)],
  );
}

async function versionsTableExists(db) {
  const { rows } = await db.query(
    `SELECT 1 FROM pg_class
      WHERE relname = 'schema_migrations' AND relkind = 'r'
        AND relnamespace = ANY (current_schemas(false)::regnamespace[])`,
  );
  return rows.length > 0;
}

function entryFor(version) {
  return MIGRATION_READERS[version - 1];
}

function assertRecordedMatchFiles(rows) {
  for (const row of rows) {
    const entry = entryFor(Number(row.version));
    if (!entry) {
      console.log(`[migrate] Eintrag ohne Datei in schema_migrations: ${row.name}`);
      continue;
    }
    if (row.name !== entry.name.replace(/\.sql$/, "")) {
      throw new Error(`Migration ${entry.name} steht unter dem Namen ${row.name} in schema_migrations`);
    }
    if (row.checksum !== checksumOf(entry)) {
      throw new Error(`Migration ${entry.name} weicht von der eingetragenen Prüfsumme ab`);
    }
  }
}

async function applyOne(db, index, entry) {
  await db.query("BEGIN");
  try {
    await db.exec(entry.read());
    await recordMigration(db, index, entry);
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw new Error(`Migration fehlgeschlagen (${entry.name}): ${err.message}`, { cause: err });
  }
}

async function applyPendingMigrations(db) {
  const { rows } = await db.query("SELECT version, name, checksum FROM schema_migrations");
  assertRecordedMatchFiles(rows);
  const done = new Set(rows.map((row) => Number(row.version)));
  for (const [index, entry] of MIGRATION_READERS.entries()) {
    if (!done.has(index + 1)) await applyOne(db, index, entry);
  }
}

async function applyMigrations(db) {
  if (await versionsTableExists(db)) return applyPendingMigrations(db);
  await db.query("BEGIN");
  try {
    for (const entry of MIGRATION_READERS) await db.exec(entry.read());
    for (const [index, entry] of MIGRATION_READERS.entries()) {
      await recordMigration(db, index, entry);
    }
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    const names = MIGRATION_READERS.map((entry) => entry.name);
    throw new Error(`Migration fehlgeschlagen (${names}): ${err.message}`, { cause: err });
  }
}

function periodStartSecFromEnd(endSec) {
  return Math.floor(periodStartFromEnd(endSec).getTime() / MS_PER_SECOND);
}

async function backfillPeriodStart(db) {
  const rows = (
    await db.query(
      `SELECT id, stripe_current_period_end AS end_sec FROM tenant
        WHERE stripe_current_period_start IS NULL AND stripe_current_period_end IS NOT NULL`,
    )
  ).rows;
  for (const zeile of rows) {
    await db.query(`UPDATE tenant SET stripe_current_period_start = $1 WHERE id = $2`, [
      periodStartSecFromEnd(Number(zeile.end_sec)),
      zeile.id,
    ]);
  }
}

export async function backfillAccountEmailCase(db) {
  await db.query(`UPDATE account SET email = lower(trim(email)) WHERE email <> lower(trim(email))`);
}

const LEGACY_NUMBER_LANGUAGE = "de";

async function setCurrentTenant(db, tenantId) {
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
}

function healedNumberGeo(row, tenantGeo) {
  const country = row.country || countryForE164(row.e164);
  if (!country) return null;
  const chosen = row.language && row.language !== LEGACY_NUMBER_LANGUAGE;
  if (chosen) return { country, language: row.language };
  const language = tenantGeo.defaultLanguage || languageForCountry(tenantGeo.country || country);
  return { country, language };
}

async function fetchTenantGeo(db, tenantId) {
  const { rows } = await db.query(
    `SELECT country, default_language AS "defaultLanguage" FROM tenant WHERE id = $1`,
    [tenantId],
  );
  return { country: rows[0]?.country ?? null, defaultLanguage: rows[0]?.defaultLanguage ?? null };
}

async function healNumberGeoForTenant(db, tenantId) {
  const { rows } = await db.query(
    `SELECT id, e164, country, language FROM number
      WHERE tenant_id = $1 AND (country IS NULL OR language IS NULL OR language = $2)`,
    [tenantId, LEGACY_NUMBER_LANGUAGE],
  );
  if (rows.length === 0) return 0;
  const tenantGeo = await fetchTenantGeo(db, tenantId);
  let written = 0;
  for (const row of rows) {
    const healed = healedNumberGeo(row, tenantGeo);
    if (!healed) continue;
    if (healed.country === row.country && healed.language === row.language) continue;
    await db.query(
      `UPDATE number SET country = $1, language = $2 WHERE id = $3 AND tenant_id = $4`,
      [healed.country, healed.language, row.id, tenantId],
    );
    written++;
  }
  return written;
}

async function backfillNumberGeo(db) {
  const { rows } = await db.query(`SELECT id FROM tenant`);
  let written = 0;
  for (const { id } of rows) {
    await setCurrentTenant(db, id);
    written += await healNumberGeoForTenant(db, id);
  }
  if (written) console.log(`[migrate] number geo backfill: ${written} Zeile(n) geheilt`);
}

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

export async function seedDefaults(db, tenantId) {
  await db.query(
    `INSERT INTO tenant (id, status) VALUES ($1, '${TENANT_STATUS.ACTIVE}') ON CONFLICT DO NOTHING`,
    [tenantId],
  );

  const s = defaultSettings();
  await db.query(
    `INSERT INTO settings
       (tenant_id, agent_name, greeting, allow_calendar, allow_booking,
        allow_summaries, allow_personal_data, allow_bank_data, sms_summary_opt_in, language,
        allow_research, allow_call_memory)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
      s.allowResearch ?? false,
      s.allowCallMemory ?? false,
    ],
  );

  await db.query(`INSERT INTO usage (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING`, [
    tenantId,
  ]);

  const existing = await db.query(`SELECT 1 FROM calendar_event WHERE tenant_id = $1 LIMIT 1`, [
    tenantId,
  ]);
  if (existing.rows.length === 0) {
    for (const ev of demoCalendar()) {
      await db.query(
        `INSERT INTO calendar_event (id, tenant_id, title, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [ev.id, tenantId, ev.title, ev.start, ev.end],
      );
    }
  }
}

async function seedDefaultsInTenantScope(db, tenantId) {
  await setCurrentTenant(db, tenantId);
  await seedDefaults(db, tenantId);
}

export async function migrate(db, tenantId) {
  await applyMigrations(db);
  await backfillPeriodStart(db);
  await rekeyProfilesToTenant(db);
  await backfillAccountEmailCase(db);
  await backfillNumberGeo(db);
  await seedDefaultsInTenantScope(db, tenantId);
}
