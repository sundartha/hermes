import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { countryForE164, defaultSettings, demoCalendar, TENANT_STATUS } from "../store/defaults.js";
import { languageForCountry } from "../i18n/locales.js";
import { MS_PER_SECOND, periodStartFromEnd } from "../billing/period.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_FILE = path.join(__dirname, "schema.sql");

export async function applySchema(db) {
  const ddl = fs.readFileSync(SCHEMA_FILE, "utf8");
  await db.exec(ddl);
}

function periodStartSecFromEnd(endSec) {
  return Math.floor(periodStartFromEnd(endSec).getTime() / MS_PER_SECOND);
}

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

export async function backfillNumberGeo(db, restoreTenantId) {
  const { rows } = await db.query(`SELECT id FROM tenant`);
  let written = 0;
  for (const { id } of rows) {
    await setCurrentTenant(db, id);
    written += await healNumberGeoForTenant(db, id);
  }
  await setCurrentTenant(db, restoreTenantId);
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

export async function migrate(db, tenantId) {
  await applySchema(db);
  await backfillPeriodStart(db);
  await rekeyProfilesToTenant(db);
  await backfillAccountEmailCase(db);
  await backfillNumberGeo(db, tenantId);
  await seedDefaults(db, tenantId);
}
