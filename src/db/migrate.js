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
import { countryForE164, defaultSettings, demoCalendar, TENANT_STATUS } from "../store/defaults.js";
import { languageForCountry } from "../i18n/locales.js";
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

// Der Alt-Default der Spalte number.language: bis zum Weltdefault-Flip trug JEDE
// geschriebene Zeile "de" hartverdrahtet, UNABHAENGIG vom Kauf-Land der Nummer. Dieser Wert
// ist aber KEIN sicherer Alters-Marker: ein deutscher Tenant bekommt language="de" auch
// HEUTE noch ganz regulaer zugewiesen (requestNumberForPaidTenant leitet sie aus dem
// Herkunftsland des Tenants ab, s. provision-trigger.js) - der Sentinel-Wert und ein
// legitim gewaehltes Deutsch sind wertgleich, NICHT unterscheidbar. Deshalb heilt
// healedNumberGeo() bei einem Treffer NICHT blind auf das Kauf-Land der Nummer um (das
// waere bei FORCE_NUMBER_COUNTRY falsch, s. dort), sondern zuerst auf die Herkunfts-Geo
// des TENANTS - trifft sie zufaellig denselben Wert, ist das UPDATE ein No-Op (Idempotenz
// bleibt erhalten, kein stiller Sprachwechsel fuer korrekt angelegte Zeilen). Historische
// Tatsache am Bestand, kein Policy-Schalter -> bewusst kein Env-Knopf.
const LEGACY_NUMBER_LANGUAGE = "de";

// Setzt die RLS-GUC der laufenden Verbindung (session-weit, Muster wie pg.js setTenant).
// number steht unter FORCE ROW LEVEL SECURITY: ohne passende GUC traefe jedes UPDATE unter
// einer nicht-privilegierten DB-Rolle lautlos 0 Zeilen - genau die stille Wirkungslosigkeit,
// vor der schema.sql beim call-Backfill warnt. Eigene Kopie statt Import aus pg.js: pg.js
// importiert dieses Modul, ein Rueckimport waere ein Zyklus.
async function setCurrentTenant(db, tenantId) {
  await db.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
}

// SOLL-Geo EINER Bestandszeile - rein, ohne DB. Das Land kommt aus der Zeile, sonst aus der
// DID-Vorwahl; ohne ableitbares Land -> null, die Zeile bleibt komplett unberuehrt (E2,
// "kein Raten"). Die Sprache folgt NICHT dem Kauf-Land der Nummer (Review-Blocker Runde 1,
// A1-Zwei-Achsen-Vertrag): number.country ist per Design vom Herkunftsland entkoppelt
// (FORCE_NUMBER_COUNTRY faerbt NUR das Kauf-Land, s. provision-trigger.js). Die Sprache
// heilt deshalb aus dem Herkunftsland DES TENANTS (tenantGeo) - genau die Achse, aus der
// requestNumberForPaidTenant sie beim Kauf bereits ableitet. Fehlt auch die Tenant-Geo
// (uralter Bestand ohne F1-Geo), bleibt als letzter Anker das Kauf-Land selbst (alte
// Regel) - besser eine plausible Sprache als keine. Ein expliziter Wert wird durchgereicht
// und damit vom Aufrufer als "keine Aenderung" erkannt.
function healedNumberGeo(row, tenantGeo) {
  const country = row.country || countryForE164(row.e164);
  if (!country) return null;
  const chosen = row.language && row.language !== LEGACY_NUMBER_LANGUAGE;
  if (chosen) return { country, language: row.language };
  const language = tenantGeo.defaultLanguage || languageForCountry(tenantGeo.country || country);
  return { country, language };
}

// Liest die Herkunfts-Geo EINES Tenants (fuer die Sprachwahl beim Heilen, s.o.). Fehlende
// Spalten/Tenant -> beide null (der Aufrufer faellt dann auf das Kauf-Land zurueck).
async function fetchTenantGeo(db, tenantId) {
  const { rows } = await db.query(
    `SELECT country, default_language AS "defaultLanguage" FROM tenant WHERE id = $1`,
    [tenantId],
  );
  return { country: rows[0]?.country ?? null, defaultLanguage: rows[0]?.defaultLanguage ?? null };
}

// Heilt die Bestandszeilen EINES Tenants (die RLS-GUC steht bereits auf ihm). Der SELECT
// liest nur Kandidaten - eine geheilte DB liefert 0 Zeilen und schreibt nichts. Geschrieben
// wird ausschliesslich bei echter Abweichung: der zweite Lauf setzt kein einziges UPDATE ab
// (Idempotenz per Konstruktion, nicht per Zufall). tenant_id steht zusaetzlich zum
// RLS-Filter im Statement - dieselbe doppelte Linie wie im Flush-Pfad. Liefert die Zahl der
// geschriebenen Zeilen.
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

// Einmaliger, idempotenter Geo-Backfill (GAP-34): Bestands-Nummern aus der Zeit vor F1
// tragen kein Land bzw. den Alt-Default "de". Der number-Record ist der dauerhafte
// Geo-Anker (Inbound-Sprache nach angerufener Nummer) - ohne Backfill spricht eine
// franzoesische DID auf ewig Deutsch. tenant hat keine RLS -> die Tenant-Liste ist ohne GUC
// lesbar; number hat FORCE-RLS -> die GUC wird pro Tenant gesetzt. Am Ende steht sie wieder
// auf restoreTenantId: das nachfolgende seedDefaults schreibt in RLS-Tabellen (settings/
// usage/calendar_event) und wuerde sonst unter der GUC des zuletzt behandelten Tenants
// laufen. Die Wiederherstellung gehoert deshalb IN diese Funktion, nicht in die Disziplin
// des Aufrufers. Keine eigene Transaktion (Muster der Schwester-Backfills): ein
// abgebrochener Lauf hinterlaesst nur teilweise geheilte Zeilen, die der naechste Lauf
// fertig heilt. Geloggt wird nur eine Zahl (kein e164, keine tenantId - PII-frei).
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
  await db.query(
    `INSERT INTO tenant (id, status) VALUES ($1, '${TENANT_STATUS.ACTIVE}') ON CONFLICT DO NOTHING`,
    [tenantId],
  );

  const s = defaultSettings();
  await db.query(
    `INSERT INTO settings
       (tenant_id, agent_name, greeting, allow_calendar, allow_booking,
        allow_summaries, allow_personal_data, allow_bank_data, sms_summary_opt_in, language,
        allow_research)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
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
        // S1-12: id ist globaler PK (schema.sql: `id TEXT PRIMARY KEY`) mit festen Demo-IDs ->
        // zwei parallel bootende Prozesse (bzw. ein zweiter Tenant, dessen RLS die Owner-Zeilen
        // vor dem tenant-scoped SELECT-Guard versteckt) kollidieren am id-PK. ON CONFLICT (id)
        // DO NOTHING wie die drei anderen Inserts dieser Funktion; der SELECT-Existenz-Guard bleibt.
        `INSERT INTO calendar_event (id, tenant_id, title, starts_at, ends_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [ev.id, tenantId, ev.title, ev.start, ev.end],
      );
    }
  }
}

// Eine oeffentliche Einstiegsfunktion: Schema anwenden, Bestands-Backfills laufen lassen,
// dann Owner-Defaults seeden. rekeyProfilesToTenant laeuft NACH applySchema (Spalte ist dann
// schon tenant_id) und VOR seedDefaults (haengt nicht an den Owner-Seeds). backfillNumberGeo
// heilt die Geo-Felder der Bestands-Nummern.
export async function migrate(db, tenantId) {
  await applySchema(db);
  await backfillPeriodStart(db);
  // MUSS NACH applySchema laufen (Spalte tenant_id existiert erst dann, siehe oben).
  await rekeyProfilesToTenant(db);
  await backfillAccountEmailCase(db);
  // MUSS NACH applySchema (number.country/language werden dort idempotent angelegt) und VOR
  // seedDefaults laufen: der Backfill schaltet die RLS-GUC tenantweise um und stellt sie am
  // Ende auf tenantId zurueck - genau den Scope, den seedDefaults zum Schreiben braucht.
  await backfillNumberGeo(db, tenantId);
  await seedDefaults(db, tenantId);
}
