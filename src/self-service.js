import { ALL_GREETING_TEMPLATES } from "./i18n/greeting-catalog.js";

export const SELF_SERVICE_FREE_FIELDS = ["agentName", "language", "agentStyle"];

export const SELF_SERVICE_RESTRICT_ONLY_FIELDS = ["allowPersonalData", "allowBankData"];

export const SELF_SERVICE_LOCKED_FIELDS = ["country"];

export function lockedSelfServiceKeys(patch) {
  return Object.keys(patch || {}).filter((k) => SELF_SERVICE_LOCKED_FIELDS.includes(k));
}

export function selfServicePatch(patch, current) {
  const clean = {};
  const rejected = [];
  for (const [key, value] of Object.entries(patch || {})) {
    if (SELF_SERVICE_FREE_FIELDS.includes(key)) {
      clean[key] = value;
    } else if (key === "greeting") {
      if (ALL_GREETING_TEMPLATES.includes(value)) clean[key] = value;
      else rejected.push(key);
    } else if (SELF_SERVICE_RESTRICT_ONLY_FIELDS.includes(key)) {
      if (value === false || current[key] === true) clean[key] = value;
      else rejected.push(key);
    } else {
      rejected.push(key);
    }
  }
  return { clean, rejected };
}

export function hasCardOnFile(stripe) {
  return Boolean(stripe && stripe.paymentMethodId);
}
