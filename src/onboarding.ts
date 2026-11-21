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

type OnboardingState = Parameters<typeof beginProvisioning>[0] &
  Parameters<typeof activateNumber>[0] &
  Parameters<typeof attachNumberPaymentIntent>[0] &
  Parameters<typeof tenantStripe>[0];
type OnboardingNumber = ReturnType<typeof activateNumber>;
type ProviderPreis = Parameters<typeof holdAmountForProviderPrice>[0];

interface Kandidat {
  e164: string;
  price?: ProviderPreis;
}

interface OnboardingProvisioner {
  searchNumbers: (suche: { countryCode: string; type: string | undefined; limit: number }) => Promise<Kandidat[]>;
  orderNumber: (bestellung: {
    e164: string;
    connectionId: string | undefined;
    idempotencyKey: string;
  }) => Promise<{ e164: string; providerNumberId: string }>;
  releaseNumber: (providerNumberId: string) => Promise<unknown>;
}

interface OnboardingBilling {
  placeHold: (hold: {
    tenantRef: string;
    amountCents: number;
    currency: string | undefined;
    customerId: string | null;
    paymentMethodId: string | null;
    idempotencyKey: string;
  }) => Promise<{ paymentIntentId: string }>;
  captureHold: (paymentIntentId: string | null, amountCents: number) => Promise<unknown>;
  cancelHold: (paymentIntentId: string | null) => Promise<unknown>;
}

interface OnboardingSipRegistrar {
  ensureRegistration: (nummer: { e164: string | null; numberId: string }) => Promise<{ phoneNumberId: string; angelegt: boolean }>;
}

interface OnboardingInboundTrunkSchreiber {
  ensureInboundTrunk: (number: OnboardingNumber) => Promise<string>;
  zugangFp: string;
}

interface OnboardingLogger {
  log: (zeile: string) => void;
  warn: (zeile: string) => void;
}

interface OnboardingDeps {
  provisioner: OnboardingProvisioner;
  billing?: OnboardingBilling | null | undefined;
  sipRegistrar?: OnboardingSipRegistrar | null | undefined;
  inboundTrunkSchreiber?: OnboardingInboundTrunkSchreiber | null | undefined;
  logger?: OnboardingLogger;
}

interface ProvisionAuftrag {
  numberId: string;
  countryCode: string;
  connectionId?: string | undefined;
  type?: string | undefined;
  holdAmountCents: number;
  currency?: string | undefined;
}

const PROVISION_SEARCH_LIMIT = 10;

export async function provisionNumber(
  state: OnboardingState,
  deps: OnboardingDeps,
  { numberId, countryCode, connectionId, type, holdAmountCents, currency }: ProvisionAuftrag,
): Promise<OnboardingNumber> {
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

  let paymentIntentId: string | null = null;
  let setupFeeExempt: unknown = false;
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

async function registriereNummerFailSoft(
  state: OnboardingState,
  number: OnboardingNumber,
  { sipRegistrar, logger = console }: { sipRegistrar: OnboardingSipRegistrar | null | undefined; logger?: OnboardingLogger },
) {
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

async function schreibeInboundTrunkFailSoft(
  state: OnboardingState,
  number: OnboardingNumber,
  {
    inboundTrunkSchreiber,
    logger = console,
  }: { inboundTrunkSchreiber: OnboardingInboundTrunkSchreiber | null | undefined; logger?: OnboardingLogger },
) {
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

async function findPurchasableNumber(
  state: OnboardingState,
  numberId: string,
  {
    provisioner,
    countryCode,
    type,
  }: { provisioner: OnboardingProvisioner; countryCode: string; type: string | undefined },
) {
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

function requireTenantCard(state: OnboardingState, numberId: string, tenantId: string) {
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

async function cancelHoldIfHeld(billing: OnboardingBilling | null | undefined, paymentIntentId: string | null) {
  if (!billing || !paymentIntentId) return;
  try {
    await billing.cancelHold(paymentIntentId);
  } catch {
  }
}

async function placeSetupFeeHold(
  state: OnboardingState,
  numberId: string,
  {
    tenantId,
    billing,
    holdAmountCents,
    currency,
  }: { tenantId: string; billing: OnboardingBilling; holdAmountCents: number; currency: string | undefined },
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
  state: OnboardingState,
  numberId: string,
  {
    billing,
    paymentIntentId,
    holdAmountCents,
    exempt,
  }: { billing: OnboardingBilling; paymentIntentId: string | null; holdAmountCents: number; exempt: unknown },
) {
  beginCapturing(state, numberId);
  if (exempt) return billing.cancelHold(paymentIntentId);
  return billing.captureHold(paymentIntentId, holdAmountCents);
}

async function rollbackAfterOrder(
  state: OnboardingState,
  numberId: string,
  {
    provisioner,
    providerNumberId,
    e164,
    number,
    tenantId,
    billing,
    paymentIntentId,
    logger,
  }: {
    provisioner: OnboardingProvisioner;
    providerNumberId: string;
    e164: string;
    number: OnboardingNumber;
    tenantId: string;
    billing: OnboardingBilling;
    paymentIntentId: string | null;
    logger: OnboardingLogger;
  },
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
