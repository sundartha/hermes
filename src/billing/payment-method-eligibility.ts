export const PAYMENT_METHOD_TYPE_CARD = "card";

const HOLD_CAPABLE_PAYMENT_METHOD_TYPES: readonly unknown[] = Object.freeze([PAYMENT_METHOD_TYPE_CARD]);

export function isHoldCapablePaymentMethodType(paymentMethodType: unknown): boolean {
  return HOLD_CAPABLE_PAYMENT_METHOD_TYPES.includes(paymentMethodType);
}
