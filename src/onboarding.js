import {
  beginProvisioning,
  beginCapturing,
  activateNumber,
  attachNumberPaymentIntent,
  attachNumberRegistration,
  markNumberElInboundTrunkBelegt,
  failNumber,
  markNumberGekauft,
  releaseNumber,
  findNumber,
  numberBusyReason,
  tenantStripe,
  tenantSubscription,
} from "./store/state-ops.js";
import {
  holdAmountForProviderPrice,
  monthlyCostCentsForProviderPrice,
} from "./telephony/provisioning-geo.ts";
import { NummerGekauftIdOffen } from "./begriffe/nummern-vergabe.js";
import { isHoldCapablePaymentMethodType } from "./billing/payment-method-eligibility.ts";
import { TRUNK_BELEG } from "./elevenlabs/inbound-trunk-beleg.ts";
import { assertKaufbareRufnummer, assertKaufbaresLand } from "./store.js";
import { fehlerText } from "./utils/fehler-text.ts";

const PROVISION_SEARCH_LIMIT = 10;

export async function provisionNumber(
  state,
  deps,
  { numberId, countryCode, connectionId, type, holdAmountCents, currency },
) {
  const { provisioner, billing, sipRegistrar, inboundTrunkSchreiber, logger = console } = deps;
  const number = findNumber(state, numberId);
  if (!number) throw new Error(`provisionNumber: Nummer ${numberId} nicht gefunden`);

  if (billing) requireTenantCard(state, numberId, number.tenantId);

  beginProvisioning(state, numberId);

  const candidate = await findPurchasableNumber(state, numberId, {
    provisioner,
    countryCode,
    type,
  });

  const effectiveHoldCents = holdAmountForProviderPrice(candidate.price, holdAmountCents);

  let paymentIntentId = null;
  let setupFeeExempt = false;
  if (billing) {
    ({ paymentIntentId, exempt: setupFeeExempt } = await placeSetupFeeHold(state, numberId, {
      tenantId: number.tenantId,
      billing,
      holdAmountCents: effectiveHoldCents,
      currency,
    }));
  }

  const idempotencyKey = `order_${numberId}`;

  let ordered;
  try {
    ordered = await provisioner.orderNumber({ e164: candidate.e164, connectionId, idempotencyKey });
  } catch (err) {
    if (err instanceof NummerGekauftIdOffen) {
      const gekauftE164 = String(Reflect.get(err, "e164"));
      markNumberGekauft(state, numberId, gekauftE164);
      logger.warn(`[nummer-gekauft-id-offen] number=${numberId} e164=${gekauftE164}: ${err.message} - Hold bleibt, manuelle Klaerung`);
      throw err;
    }
    failNumber(state, numberId);
    await cancelHoldIfHeld(billing, paymentIntentId);
    throw err;
  }

  if (billing) {
    try {
      await settleSetupFeeHold(state, numberId, {
        billing,
        paymentIntentId,
        holdAmountCents: effectiveHoldCents,
        exempt: setupFeeExempt,
      });
    } catch (capErr) {
      await rollbackAfterOrder(state, numberId, {
        provisioner,
        providerNumberId: ordered.providerNumberId,
        e164: ordered.e164,
        number,
        tenantId: number.tenantId,
        billing,
        paymentIntentId,
        logger,
      });
      throw capErr;
    }
  }

  const activatedNumber = activateNumber(state, numberId, {
    e164: ordered.e164,
    providerNumberId: ordered.providerNumberId,
    monthlyCostCents: monthlyCostCentsForProviderPrice(candidate.price),
  });
  await registriereNummerFailSoft(state, activatedNumber, { sipRegistrar, logger });
  await schreibeInboundTrunkFailSoft(state, activatedNumber, { inboundTrunkSchreiber, logger });
  return activatedNumber;
}

async function registriereNummerFailSoft(state, number, { sipRegistrar, logger = console }) {
  if (!sipRegistrar || number.providerAgentPhoneNumberId) return;
  try {
    const { phoneNumberId, angelegt } = await sipRegistrar.ensureRegistration({
      e164: number.e164,
      numberId: number.id,
    });
    attachNumberRegistration(state, number.id, phoneNumberId);
    logger.log(`[el-registrierung] number=${number.id} angelegt=${String(angelegt)}`);
  } catch (err) {
    logger.warn(
      `[el-registrierung] FEHLGESCHLAGEN number=${number.id}: ${fehlerText(err)} - DID bleibt nutzbar, Registrierung nachholbar`,
    );
  }
}

async function schreibeInboundTrunkFailSoft(state, number, { inboundTrunkSchreiber, logger = console }) {
  if (!inboundTrunkSchreiber || !number.providerAgentPhoneNumberId) return;
  try {
    const beleg = await inboundTrunkSchreiber.ensureInboundTrunk(number);
    if (beleg === TRUNK_BELEG.BELEGT)
      markNumberElInboundTrunkBelegt(state, number.id, {
        nowIso: new Date().toISOString(),
        zugangFp: inboundTrunkSchreiber.zugangFp,
      });
    logger.log(`[el-trunk] onboarding nummer_id=${number.id} beleg=${beleg}`);
  } catch {
    logger.warn(
      `[el-trunk] onboarding FEHLGESCHLAGEN nummer_id=${number.id} - DID bleibt nutzbar, Boot-Sweep prueft erneut`,
    );
  }
}

async function findPurchasableNumber(state, numberId, { provisioner, countryCode, type }) {
  try {
    assertKaufbaresLand(countryCode, "provisionNumber");
    const candidates = await provisioner.searchNumbers({
      countryCode,
      type,
      limit: PROVISION_SEARCH_LIMIT,
    });
    const candidate = candidates[0];
    if (!candidate)
      throw new Error(`provisionNumber: keine kaufbare Nummer fuer ${countryCode} verfuegbar`);
    assertKaufbareRufnummer(candidate.e164, "provisionNumber");
    return candidate;
  } catch (err) {
    failNumber(state, numberId);
    throw err;
  }
}

function requireTenantCard(state, numberId, tenantId) {
  const card = tenantStripe(state, tenantId);
  if (!card.customerId || !card.paymentMethodId) {
    failNumber(state, numberId);
    throw new Error(`provisionNumber: Tenant ${tenantId} hat kein hinterlegtes Zahlungsmittel`);
  }
  if (!isHoldCapablePaymentMethodType(card.paymentMethodType)) {
    failNumber(state, numberId);
    throw new Error(
      `provisionNumber: Tenant ${tenantId} hat ein Zahlungsmittel ohne getrennte Autorisierung ` +
        `(payment_method_type=${card.paymentMethodType ?? "unbekannt"})`,
    );
  }
  return card;
}

async function cancelHoldIfHeld(billing, paymentIntentId) {
  if (!billing || !paymentIntentId) return;
  try {
    await billing.cancelHold(paymentIntentId);
  } catch {
  }
}

async function placeSetupFeeHold(
  state,
  numberId,
  { tenantId, billing, holdAmountCents, currency },
) {
  const { numberSetupFeeExempt: exempt } = tenantSubscription(state, tenantId);
  const { customerId, paymentMethodId } = tenantStripe(state, tenantId);
  let paymentIntentId;
  try {
    const hold = await billing.placeHold({
      tenantRef: tenantId,
      amountCents: holdAmountCents,
      currency,
      customerId,
      paymentMethodId,
      idempotencyKey: `hold_${numberId}`,
    });
    paymentIntentId = hold.paymentIntentId;
  } catch (holdErr) {
    failNumber(state, numberId);
    throw holdErr;
  }
  attachNumberPaymentIntent(state, numberId, paymentIntentId);
  return { paymentIntentId, exempt };
}

async function settleSetupFeeHold(
  state,
  numberId,
  { billing, paymentIntentId, holdAmountCents, exempt },
) {
  beginCapturing(state, numberId);
  if (exempt) return billing.cancelHold(paymentIntentId);
  return billing.captureHold(paymentIntentId, holdAmountCents);
}

async function rollbackAfterOrder(
  state,
  numberId,
  { provisioner, providerNumberId, e164, number, tenantId, billing, paymentIntentId, logger },
) {
  failNumber(state, numberId);
  if (e164 && numberBusyReason(state, { ...number, e164 }, { forTenantId: tenantId })) {
    logger.warn(
      `provisionNumber: releaseNumber uebersprungen (Plattform-Bindung) -> Orphan, Reconcile noetig ` +
        `(number=${numberId} provider=${providerNumberId})`,
    );
    await cancelHoldIfHeld(billing, paymentIntentId);
    return;
  }
  try {
    await provisioner.releaseNumber(providerNumberId);
    releaseNumber(state, numberId);
  } catch (relErr) {
    logger.warn(
      `provisionNumber: releaseNumber fehlgeschlagen -> Orphan, Reconcile noetig ` +
        `(number=${numberId} provider=${providerNumberId}): ${fehlerText(relErr)}`,
    );
  }
  await cancelHoldIfHeld(billing, paymentIntentId);
}
