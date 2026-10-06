export const PAYMENT_METHOD_TYPE_CARD = "card";

const HOLD_CAPABLE_PAYMENT_METHOD_TYPES = Object.freeze([PAYMENT_METHOD_TYPE_CARD]);

export function isHoldCapablePaymentMethodType(paymentMethodType) {
  return HOLD_CAPABLE_PAYMENT_METHOD_TYPES.includes(paymentMethodType);
}
