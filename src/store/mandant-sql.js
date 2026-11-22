import { NEWSLETTER_LISTEN_LESEN_SQL } from "./newsletter-liste-sql.js";
import {
  billingHoldActive,
  findTenant,
  kycReached,
  tenantActiveSubscriber,
  tenantInactive,
} from "./zustand/mandant.ts";

const SPALTE_JE_SCHLUESSEL = Object.freeze({
  idpSubject: "idp_subject",
  kycLevel: "kyc_level",
  suspendedAt: "suspended_at",
  stripeActivationPending: "stripe_activation_pending",
  billingHold: "stripe_billing_hold",
  billingHoldDueAt: "stripe_billing_hold_due_at",
  stripeCustomerId: "stripe_customer_id",
  stripePaymentMethodId: "stripe_payment_method_id",
  stripePaymentMethodType: "stripe_payment_method_type",
  stripeSubscriptionId: "stripe_subscription_id",
  stripePlanSlug: "stripe_plan_slug",
  stripeCurrentPeriodEnd: "stripe_current_period_end",
  stripeCurrentPeriodStart: "stripe_current_period_start",
  stripeNumberSetupFeeExempt: "stripe_number_setup_fee_exempt",
  stripePeriodCreditRevoked: "stripe_period_credit_revoked",
  stripeCancelAtPeriodEnd: "stripe_cancel_at_period_end",
  numberProvisionSkipReason: "number_provision_skip_reason",
  numberProvisionSkipAt: "number_provision_skip_at",
  numberReleasePending: "number_release_pending",
  workosDeletePending: "workos_delete_pending",
  cancellationMailPending: "cancellation_mail_pending",
  cancellationMailReceivedAt: "cancellation_mail_received_at",
});

const SPERRE_SPALTEN = ["status", ...Object.values(SPALTE_JE_SCHLUESSEL), "stand"].join(", ");
const LESEN_SQL = `SELECT ${SPERRE_SPALTEN} FROM tenant WHERE id = $1`;
const EIGENE_NUMMER_SQL = "SELECT private_number FROM tenant WHERE id = $1";
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

const jsonWert = (wert) => (Array.isArray(wert) ? JSON.stringify(wert) : wert);

const schreiberFuer = (spalten) => async (client, tenantId, werte) => {
  const schluessel = Object.keys(werte);
  const setzen = schluessel.map(
    (key, index) => `${spalten[key]} = $${index + ERSTER_WERT_PLATZHALTER}`,
  );
  const { rows } = await client.query(
    `UPDATE tenant SET ${setzen.join(", ")} WHERE id = $1 RETURNING ${SPERRE_SPALTEN}`,
    [tenantId, ...schluessel.map((key) => jsonWert(werte[key]))],
  );
  if (rows.length === 0) throw new Error("Mandant nicht in der Datenbank");
  return rows[0];
};

export const sperreSchreiben = schreiberFuer(SPALTE_JE_SCHLUESSEL);

const LISTEN_SCHLUESSEL = ["newsletterRecipients", "newsletterConfirmMailLog"];

async function listeSchreiben(client, tenantId, { sql, werte }) {
  const { rows } = await client.query(sql, [tenantId, ...werte]);
  if (rows.length === 0) throw new Error("Mandant nicht in der Datenbank");
  return rows[0];
}

const sperreZeile = async (client, tenantId) =>
  (await client.query(LESEN_SQL, [tenantId])).rows[0] ?? null;

export function macheMandantSql({ einreihen, runner, requireState, stammdatenSpalten,protokoll = console }) {
  const schreibenMitSpalten = schreiberFuer({ ...SPALTE_JE_SCHLUESSEL, ...stammdatenSpalten });
  const staende = new Map();
  const offen = new Map();
  const letzte = new Map();
  const unbestaetigt = new Set();
  const eintrag = (tenantId, key) => `${tenantId}/${key}`;

  function listenUebernehmen(tenantId, zeile) {
    const tenant = findTenant(requireState(), tenantId);
    if (!tenant || offen.has(tenantId)) return;
    tenant.newsletterRecipients = zeile.newsletter_recipients;
    tenant.newsletterConfirmMailLog = zeile.newsletter_confirm_mail_log;
  }

  function uebernehmen(tenantId, zeile) {
    const tenant = findTenant(requireState(), tenantId);
    if (!tenant || offen.has(tenantId)) return;
    const stand = Number(zeile.stand);
    if (stand <= (staende.get(tenantId) ?? KEIN_STAND)) return;
    staende.set(tenantId, stand);
    Object.assign(tenant, zeileZuSperre(zeile));
  }

  async function sperreLesen(tenantId) {
    await letzte.get(tenantId);
    const zeile = await runner.withClient((client) => sperreZeile(client, tenantId));
    if (zeile) uebernehmen(tenantId, zeile);
    return sperreAusZustand({ tenants: [{ id: tenantId, ...zeileZuSperre(zeile ?? {}) }] }, tenantId);
  }

  async function privateNumberLesen(tenantId) {
    await letzte.get(tenantId);
    const { rows } = await runner.withClient((client) => client.query(EIGENE_NUMMER_SQL, [tenantId]));
    return rows[0]?.private_number ?? null;
  }

  function zurueckzaehlen(tenantId) {
    const uebrig = offen.get(tenantId) - 1;
    if (uebrig > 0) offen.set(tenantId, uebrig);
    else offen.delete(tenantId);
  }

  async function ablauf(tenantId, { schluessel, aktion, uebernahme }) {
    const eintraege = schluessel.map((key) => eintrag(tenantId, key));
    let zeile;
    try {
      zeile = await einreihen(aktion);
    } catch (err) {
      protokoll.error(SCHREIBFEHLER, err.message);
      eintraege.forEach((wert) => unbestaetigt.add(wert));
      return false;
    } finally {
      zurueckzaehlen(tenantId);
    }
    eintraege.forEach((wert) => unbestaetigt.delete(wert));
    uebernahme(tenantId, zeile);
    return true;
  }

  const nichtBestaetigt = (tenantId, key) => unbestaetigt.has(eintrag(tenantId, key));

  function schreiben(tenantId, schluessel) {
    const tenant = findTenant(requireState(), tenantId);
    if (!tenant) return Promise.resolve(true);
    const werte = Object.fromEntries(schluessel.map((key) => [key, tenant[key] ?? null]));
    offen.set(tenantId, (offen.get(tenantId) ?? 0) + 1);
    const vorgang = ablauf(tenantId, {
      schluessel: Object.keys(werte),
      aktion: (client) => schreibenMitSpalten(client, tenantId, werte),
      uebernahme: uebernehmen,
    });
    letzte.set(tenantId, vorgang);
    return vorgang;
  }

  function listeAendern(tenantId, aenderung) {
    offen.set(tenantId, (offen.get(tenantId) ?? 0) + 1);
    const vorgang = ablauf(tenantId, {
      schluessel: LISTEN_SCHLUESSEL,
      aktion: (client) => listeSchreiben(client, tenantId, aenderung),
      uebernahme: listenUebernehmen,
    });
    letzte.set(tenantId, vorgang);
    return vorgang;
  }

  async function listenAbgleichen() {
    await Promise.all([...letzte.values()]);
    const { rows } = await runner.withClient((client) => client.query(NEWSLETTER_LISTEN_LESEN_SQL));
    rows.forEach((zeile) => listenUebernehmen(zeile.id, zeile));
  }

  async function schreibenPflicht(tenantId, schluessel) {
    if (!(await schreiben(tenantId, schluessel))) throw new Error(NICHT_GESCHRIEBEN);
  }

  return { schreiben, schreibenPflicht, listeAendern, listenAbgleichen, sperreLesen, privateNumberLesen, nichtBestaetigt };
}
