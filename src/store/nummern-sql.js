import { NUMBER_STATUS, PROVISIONING_JOB_STATUS } from "../begriffe/nummern.ts";
import { PROVISION_NUMBER_JOB } from "../begriffe/nummern-vergabe.ts";
import { EINSTELLUNGEN_NACHLADEN_FRIST_MS } from "../begriffe/speicher.ts";
import { innerhalbFrist } from "./einstellungen-sql.js";
import { EIGENE_KENNUNG } from "./instanz-besitz.js";
import { AUFTRAG_SPALTEN, KONTEXT_SQL, alsAuftrag, offeneLesen } from "./offene-auftraege-sql.js";

const FEHLER = "[pg] nummernkauf fehlgeschlagen:";
const SPERRE_SQL = `SELECT id FROM tenant WHERE id = $1 FOR UPDATE`;
const LEBENDE_SQL = `SELECT count(*)::int AS anzahl FROM number WHERE tenant_id = $1 AND status <> ALL($2) AND id <> $3`;
const PLATTFORM_SPERRE_SQL = `SELECT pg_advisory_xact_lock(5787, 1)`;
const PLATTFORM_LEBENDE_SQL = `SELECT (nummern_lebend_gesamt() - (SELECT count(*) FROM number WHERE id = $1 AND status <> ALL($2)))::int AS anzahl`;
const NUMMER_SQL = `INSERT INTO number (id, tenant_id, provider, status, country)
  VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`;
const AUFTRAG_SQL = `INSERT INTO provisioning_job (id, tenant_id, number_id, kind, status, idempotency_key, attempts, last_error, created_at, instanz)
  VALUES ($1, $2, $3, $4, $5, $6, 0, NULL, $7, $8) ON CONFLICT DO NOTHING`;
const AUFTRAG_LESEN_SQL = `SELECT ${AUFTRAG_SPALTEN} FROM provisioning_job WHERE tenant_id = $1 AND idempotency_key = $2`;
const UEBERNEHMEN_SQL = `UPDATE provisioning_job SET instanz = $1
  WHERE tenant_id = $2 AND id = $3 AND status = $4 AND instanz IS NOT DISTINCT FROM $5
  RETURNING ${AUFTRAG_SPALTEN}`;
const NUMMER_ZUM_AUFTRAG_SQL = `SELECT * FROM number WHERE tenant_id = $1 AND id = $2`;
const NUMMER_ENTFERNEN_SQL = `DELETE FROM number WHERE tenant_id = $1 AND id = $2`;
const AUFTRAG_ENTFERNEN_SQL = `DELETE FROM provisioning_job WHERE tenant_id = $1 AND id = $2`;
const NACHLADEN_FEHLER = "[pg] nummer nachladen fehlgeschlagen:";
const SCHLUESSEL_SQL = `SELECT tenant_id FROM nummer_schluessel WHERE e164_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`;
const NUMMER_LESEN_SQL = `SELECT * FROM number WHERE tenant_id = $1 AND e164 = $2`;
const NICHT_ZAEHLEND = [NUMBER_STATUS.RELEASED, NUMBER_STATUS.FAILED];

async function unterMandantenSperre(client, tenantId, arbeit) {
  await client.query("BEGIN");
  try {
    await client.query(KONTEXT_SQL, [tenantId]);
    const { rows } = await client.query(SPERRE_SQL, [tenantId]);
    if (rows.length === 0) throw new Error("Mandant nicht in der Datenbank");
    const ergebnis = await arbeit();
    await client.query("COMMIT");
    return ergebnis;
  } catch (fehler) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(FEHLER, fehler.message);
    throw fehler;
  }
}

const nummerEinfuegen = (client, tenantId, number) =>
  client.query(NUMMER_SQL, [
    number.id,
    tenantId,
    number.provider,
    number.status,
    number.country ?? null,
  ]);

async function nummerAnlegen(client, { tenantId, number, hoechstens, plattformHoechstens }) {
  const { rows } = await client.query(LEBENDE_SQL, [tenantId, NICHT_ZAEHLEND, number.id]);
  if (rows[0].anzahl >= hoechstens) return { ok: false };
  await client.query(PLATTFORM_SPERRE_SQL);
  const { rows: plattform } = await client.query(PLATTFORM_LEBENDE_SQL, [number.id, NICHT_ZAEHLEND]);
  if (plattform[0].anzahl >= plattformHoechstens) return { ok: false };
  await nummerEinfuegen(client, tenantId, number);
  return { ok: true };
}

async function auftragAnlegen(client, kennung, { tenantId, numberId, idempotencyKey, number, jetztIso }) {
  await nummerEinfuegen(client, tenantId, number);
  await client.query(AUFTRAG_SQL, [
    `job_${numberId}`,
    tenantId,
    numberId,
    PROVISION_NUMBER_JOB,
    PROVISIONING_JOB_STATUS.QUEUED,
    idempotencyKey,
    jetztIso,
    kennung,
  ]);
  const { rows } = await client.query(AUFTRAG_LESEN_SQL, [tenantId, idempotencyKey]);
  return alsAuftrag(rows[0]);
}

async function imMandanten(client, tenantId, arbeit) {
  await client.query("BEGIN");
  try {
    await client.query(KONTEXT_SQL, [tenantId]);
    await arbeit();
    await client.query("COMMIT");
  } catch (fehler) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(FEHLER, fehler.message);
    throw fehler;
  }
}

async function auftragUebernehmen(client, zeileZuNummer, { tenantId, jobId, alt, neu }) {
  await client.query("BEGIN");
  try {
    await client.query(KONTEXT_SQL, [tenantId]);
    const { rows } = await client.query(UEBERNEHMEN_SQL, [neu, tenantId, jobId, PROVISIONING_JOB_STATUS.QUEUED, alt ?? null]);
    if (rows.length !== 1) {
      await client.query("COMMIT");
      return null;
    }
    const { rows: nummern } = await client.query(NUMMER_ZUM_AUFTRAG_SQL, [tenantId, rows[0].number_id]);
    await client.query("COMMIT");
    return { job: alsAuftrag(rows[0]), nummer: nummern[0] ? zeileZuNummer(nummern[0]) : null };
  } catch (fehler) {
    await client.query("ROLLBACK").catch(() => {});
    throw fehler;
  }
}

async function nummerLesen(client, e164) {
  const { rows: schluessel } = await client.query(SCHLUESSEL_SQL, [e164]);
  if (schluessel.length === 0) return null;
  const tenantId = schluessel[0].tenant_id;
  await client.query("BEGIN");
  try {
    await client.query(KONTEXT_SQL, [tenantId]);
    const { rows } = await client.query(NUMMER_LESEN_SQL, [tenantId, e164]);
    await client.query("COMMIT");
    return rows[0] ?? null;
  } catch (fehler) {
    await client.query("ROLLBACK").catch(() => {});
    throw fehler;
  }
}

function macheNachladen({ runner, zeileZuNummer, fristMs }) {
  const bei = (meldung) => console.error(NACHLADEN_FEHLER, meldung);
  return async (e164) => {
    const lesen = runner
      .withClient((client) => nummerLesen(client, e164))
      .then(
        (zeile) => (zeile ? zeileZuNummer(zeile) : null),
        (fehler) => {
          bei(fehler.message);
          return null;
        },
      );
    return (await innerhalbFrist(lesen, fristMs, () => bei("Frist abgelaufen"))) || null;
  };
}

export function macheNummernSql({ einreihen, runner, zeileZuNummer, kennung = EIGENE_KENNUNG, fristMs = EINSTELLUNGEN_NACHLADEN_FRIST_MS }) {
  const unterSperre = (tenantId, arbeit) =>
    einreihen((client) => unterMandantenSperre(client, tenantId, () => arbeit(client)));
  return {
    nachladen: macheNachladen({ runner, zeileZuNummer, fristMs }),
    nummerAnlegen: (eingabe) => unterSperre(eingabe.tenantId, (client) => nummerAnlegen(client, eingabe)),
    auftragAnlegen: (eingabe) => unterSperre(eingabe.tenantId, (client) => auftragAnlegen(client, kennung, eingabe)),
    offene: () => runner.withClient((client) => offeneLesen(client, zeileZuNummer)),
    auftragUebernommen: (eingabe) => runner.withClient((client) => auftragUebernehmen(client, zeileZuNummer, eingabe)),
    auftragUebernehmen: async (eingabe) =>
      (await runner.withClient((client) => auftragUebernehmen(client, zeileZuNummer, eingabe))) !== null,
    nummerEntfernen: ({ tenantId, numberId }) =>
      einreihen((client) => imMandanten(client, tenantId, () => client.query(NUMMER_ENTFERNEN_SQL, [tenantId, numberId]))),
    auftragEntfernen: ({ tenantId, jobId }) =>
      einreihen((client) => imMandanten(client, tenantId, () => client.query(AUFTRAG_ENTFERNEN_SQL, [tenantId, jobId]))),
  };
}
