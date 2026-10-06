import { createHmac } from "node:crypto";

import { safeEqual } from "../util.js";

const HMAC_ALGORITHM = "sha256";
const DERIVATION_VERSION = "v1";

export function tenantToolToken({ secret, tenantId }) {
  if (typeof secret !== "string" || !secret) return "";
  if (typeof tenantId !== "string" || !tenantId) return "";
  return createHmac(HMAC_ALGORITHM, secret)
    .update(`${DERIVATION_VERSION}:${tenantId}`)
    .digest("hex");
}

export const TENANT_TOKEN_VERDICT = Object.freeze({
  PASSEND: "passend",
  FEHLT: "fehlt",
  FREMD: "fremd",
});

export function tenantTokenVerdict({ secret, tenantId, presented }) {
  if (typeof presented !== "string" || !presented) return TENANT_TOKEN_VERDICT.FEHLT;
  const erwartet = tenantToolToken({ secret, tenantId });
  if (!erwartet) return TENANT_TOKEN_VERDICT.FREMD;
  return safeEqual(presented, erwartet)
    ? TENANT_TOKEN_VERDICT.PASSEND
    : TENANT_TOKEN_VERDICT.FREMD;
}
