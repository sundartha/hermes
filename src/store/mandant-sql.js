import {
  billingHoldActive,
  findTenant,
  kycReached,
  tenantActiveSubscriber,
  tenantInactive,
} from "./zustand/mandant.js";

const SPALTE_JE_SCHLUESSEL = Object.freeze({
  kycLevel: "kyc_level",
  suspendedAt: "suspended_at",
  stripeActivationPending: "stripe_activation_pending",
  billingHold: "stripe_billing_hold",
  billingHoldDueAt: "stripe_billing_hold_due_at",
  stripeCustomerId: "stripe_customer_id",
});

export const stripeSchluessel = (patch) => (patch.customerId === undefined ? [] : ["stripeCustomerId"]);

const SPERRE_SPALTEN = ["status", ...Object.values(SPALTE_JE_SCHLUESSEL), "stand"].join(", ");
const LESEN_SQL = `SELECT ${SPERRE_SPALTEN} FROM tenant WHERE id = $1`;
const ERSTER_WERT_PLATZHALTER = 2;
const KEIN_STAND = -1;
const SCHREIBFEHLER = "[pg] mandant-sperre schreiben fehlgeschlagen:";
const NICHT_GESCHRIEBEN = "Mandanten-Sperre nicht in die Datenbank geschrieben";

function zeileZuSperre(zeile) {
  return {
    status: zeile.status,
    kycLevel: zeile.kyc_level,
    suspendedAt: zeile.suspended_at,
    stripeActivationPending: zeile.stripe_activation_pending,
    billingHold: zeile.stripe_billing_hold,
    billingHoldDueAt: zeile.stripe_billing_hold_due_at,
  };
}

export function sperreAusZustand(zustand, tenantId) {
  return {
    kycReached: (minLevel) => kycReached(zustand, tenantId, minLevel),
    inactive: () => tenantInactive(zustand, tenantId),
    billingHold: () => billingHoldActive(zustand, tenantId, new Date().toISOString()),
    activeSubscriber: (minLevel) => tenantActiveSubscriber(zustand, tenantId, minLevel),
  };
}

export async function sperreSchreiben(client, tenantId, werte) {
  const schluessel = Object.keys(werte);
  const setzen = schluessel.map(
    (key, index) => `${SPALTE_JE_SCHLUESSEL[key]} = $${index + ERSTER_WERT_PLATZHALTER}`,
  );
  const { rows } = await client.query(
    `UPDATE tenant SET ${setzen.join(", ")} WHERE id = $1 RETURNING ${SPERRE_SPALTEN}`,
    [tenantId, ...schluessel.map((key) => werte[key])],
  );
  if (rows.length === 0) throw new Error("Mandant nicht in der Datenbank");
  return rows[0];
}

const PARAMETER_JE_SCHLUESSEL = 2;
const textOderNull = (wert) => (wert == null ? null : String(wert));

export async function sperreNachholen(client, tenantId, { werte, gesehen }) {
  const schluessel = Object.keys(werte);
  const setzen = schluessel.map((key, index) => {
    const spalte = SPALTE_JE_SCHLUESSEL[key];
    const neu = ERSTER_WERT_PLATZHALTER + index * PARAMETER_JE_SCHLUESSEL;
    return `${spalte} = CASE WHEN ${spalte}::text IS NOT DISTINCT FROM $${neu + 1}::text THEN $${neu} ELSE ${spalte} END`;
  });
  const parameter = schluessel.flatMap((key) => [
    werte[key],
    textOderNull(gesehen?.[SPALTE_JE_SCHLUESSEL[key]]),
  ]);
  const { rows } = await client.query(
    `UPDATE tenant SET ${setzen.join(", ")} WHERE id = $1 RETURNING ${SPERRE_SPALTEN}`,
    [tenantId, ...parameter],
  );
  return rows[0] ?? null;
}

const gesehenSpalten = (zeile) => ({
  ...Object.fromEntries(Object.values(SPALTE_JE_SCHLUESSEL).map((spalte) => [spalte, zeile[spalte]])),
  stand: Number(zeile.stand),
});

const sperreZeile = async (client, tenantId) =>
  (await client.query(LESEN_SQL, [tenantId])).rows[0] ?? null;

export function macheMandantSql({ einreihen, runner, requireState, protokoll = console }) {
  const staende = new Map();
  const gesehen = new Map();
  const offen = new Map();
  const letzte = new Map();
  const unbestaetigt = new Map();
  const eintrag = (tenantId, key) => `${tenantId}/${key}`;
  const vormerken = (tenantId, key) => unbestaetigt.set(eintrag(tenantId, key), { tenantId, key });

  function fortschreiben(tenantId, zeile) {
    if (Number(zeile.stand) <= (gesehen.get(tenantId)?.stand ?? KEIN_STAND)) return;
    gesehen.set(tenantId, gesehenSpalten(zeile));
  }

  function uebernehmen(tenantId, zeile) {
    fortschreiben(tenantId, zeile);
    const tenant = findTenant(requireState(), tenantId);
    if (!tenant || offen.has(tenantId)) return;
    if (Number(zeile.stand) <= (staende.get(tenantId) ?? KEIN_STAND)) return;
    staende.set(tenantId, Number(zeile.stand));
    Object.assign(tenant, zeileZuSperre(zeile));
  }

  async function sperreLesen(tenantId) {
    await letzte.get(tenantId);
    const zeile = await runner.withClient((client) => sperreZeile(client, tenantId));
    if (zeile) uebernehmen(tenantId, zeile);
    return sperreAusZustand({ tenants: [{ id: tenantId, ...zeileZuSperre(zeile ?? {}) }] }, tenantId);
  }

  function zurueckzaehlen(tenantId) {
    const uebrig = offen.get(tenantId) - 1;
    if (uebrig > 0) offen.set(tenantId, uebrig);
    else offen.delete(tenantId);
  }

  async function ablauf(tenantId, werte) {
    const schluessel = Object.keys(werte);
    let zeile;
    try {
      zeile = await einreihen((client) => sperreSchreiben(client, tenantId, werte));
    } catch (err) {
      protokoll.error(SCHREIBFEHLER, err.message);
      schluessel.forEach((key) => vormerken(tenantId, key));
      return false;
    } finally {
      zurueckzaehlen(tenantId);
    }
    schluessel.forEach((key) => unbestaetigt.delete(eintrag(tenantId, key)));
    uebernehmen(tenantId, zeile);
    return true;
  }

  const nichtBestaetigt = (tenantId, key) => unbestaetigt.has(eintrag(tenantId, key));

  function schreiben(tenantId, schluessel) {
    const tenant = findTenant(requireState(), tenantId);
    if (!tenant || schluessel.length === 0) return Promise.resolve(true);
    const werte = Object.fromEntries(schluessel.map((key) => [key, tenant[key] ?? null]));
    offen.set(tenantId, (offen.get(tenantId) ?? 0) + 1);
    const vorgang = ablauf(tenantId, werte);
    letzte.set(tenantId, vorgang);
    return vorgang;
  }

  async function schreibenPflicht(tenantId, schluessel) {
    if (!(await schreiben(tenantId, schluessel))) throw new Error(NICHT_GESCHRIEBEN);
  }

  let nachgeholt = [];

  async function nachholen(client) {
    const jeMandant = Map.groupBy([...unbestaetigt.values()], ({ tenantId }) => tenantId);
    nachgeholt = [];
    for (const [tenantId, vorgemerkt] of jeMandant) {
      const tenant = findTenant(requireState(), tenantId);
      const werte = Object.fromEntries(vorgemerkt.map(({ key }) => [key, tenant?.[key] ?? null]));
      const zeile = tenant ? await sperreNachholen(client, tenantId, { werte, gesehen: gesehen.get(tenantId) }) : null;
      nachgeholt.push({ tenantId, vorgemerkt, zeile });
    }
  }

  function nachholenAbschliessen() {
    const erledigt = nachgeholt;
    nachgeholt = [];
    for (const { tenantId, vorgemerkt, zeile } of erledigt) {
      for (const eintragWert of vorgemerkt) {
        const wert = eintrag(tenantId, eintragWert.key);
        if (unbestaetigt.get(wert) === eintragWert) unbestaetigt.delete(wert);
      }
      if (zeile) uebernehmen(tenantId, zeile);
    }
  }

  async function staendeEinlesen(client) {
    const { rows } = await client.query(`SELECT id, ${SPERRE_SPALTEN} FROM tenant`);
    rows.forEach((zeile) => {
      staende.set(zeile.id, Number(zeile.stand));
      fortschreiben(zeile.id, zeile);
    });
  }

  return {
    schreiben,
    schreibenPflicht,
    sperreLesen,
    nichtBestaetigt,
    nachholen,
    nachholenAbschliessen,
    staendeEinlesen,
  };
}
