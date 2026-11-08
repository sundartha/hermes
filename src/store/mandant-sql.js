import { findTenant } from "./zustand/mandant.js";

const SPALTE_JE_SCHLUESSEL = Object.freeze({
  kycLevel: "kyc_level",
  suspendedAt: "suspended_at",
  stripeActivationPending: "stripe_activation_pending",
  billingHold: "stripe_billing_hold",
  billingHoldDueAt: "stripe_billing_hold_due_at",
});

const SPERRE_SPALTEN = ["status", ...Object.values(SPALTE_JE_SCHLUESSEL)].join(", ");
const ERSTER_WERT_PLATZHALTER = 2;
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

export function macheMandantSql({ einreihen, requireState, protokoll = console }) {
  const offen = new Map();
  const unbestaetigt = new Set();
  const eintrag = (tenantId, key) => `${tenantId}/${key}`;

  function uebernehmen(tenant, zeile) {
    if (!offen.has(tenant.id)) Object.assign(tenant, zeileZuSperre(zeile));
  }

  function zurueckzaehlen(tenantId) {
    const uebrig = offen.get(tenantId) - 1;
    if (uebrig > 0) offen.set(tenantId, uebrig);
    else offen.delete(tenantId);
  }

  async function ablauf(tenant, werte) {
    const eintraege = Object.keys(werte).map((key) => eintrag(tenant.id, key));
    let zeile;
    try {
      zeile = await einreihen((client) => sperreSchreiben(client, tenant.id, werte));
    } catch (err) {
      protokoll.error(SCHREIBFEHLER, err.message);
      eintraege.forEach((wert) => unbestaetigt.add(wert));
      return false;
    } finally {
      zurueckzaehlen(tenant.id);
    }
    eintraege.forEach((wert) => unbestaetigt.delete(wert));
    uebernehmen(tenant, zeile);
    return true;
  }

  const nichtBestaetigt = (tenantId, key) => unbestaetigt.has(eintrag(tenantId, key));

  function schreiben(tenantId, schluessel) {
    const tenant = findTenant(requireState(), tenantId);
    if (!tenant) return Promise.resolve(true);
    const werte = Object.fromEntries(schluessel.map((key) => [key, tenant[key] ?? null]));
    offen.set(tenantId, (offen.get(tenantId) ?? 0) + 1);
    return ablauf(tenant, werte);
  }

  async function schreibenPflicht(tenantId, schluessel) {
    if (!(await schreiben(tenantId, schluessel))) throw new Error(NICHT_GESCHRIEBEN);
  }

  return { schreiben, schreibenPflicht, nichtBestaetigt };
}
