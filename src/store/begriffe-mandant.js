export const BOOTSTRAP_TENANT_ID = "owner";

export const TENANT_STATUS = Object.freeze({
  ACTIVE: "active",
  SUSPENDED: "suspended",
  CLOSED: "closed",
});

const TENANT_ID_PREFIX = "t_";
export const tenantIdForSubject = (sub) => `${TENANT_ID_PREFIX}${sub}`;

export const KYC_LEVEL = Object.freeze({
  NONE: "none",
  OTP: "otp",
  CARD: "card",
  ID_VERIFIED: "id_verified",
});
export const KYC_ORDER = Object.freeze([
  KYC_LEVEL.NONE,
  KYC_LEVEL.OTP,
  KYC_LEVEL.CARD,
  KYC_LEVEL.ID_VERIFIED,
]);

export const KYC_OUTBOUND_MIN = KYC_LEVEL.CARD;
