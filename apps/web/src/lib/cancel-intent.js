import { AUTH_STATE } from "./api.js";

export const CANCEL_INTENT_HASH = "#kuendigen";
const STORAGE_KEY = "hermes.cancelIntent";

const MS_PER_MINUTE = 60_000;
const INTENT_TTL_MINUTES = 15;
const INTENT_TTL_MS = INTENT_TTL_MINUTES * MS_PER_MINUTE;

export const CANCEL_INTENT_STEP = Object.freeze({
  NONE: "none",
  LOGIN: "login",
  OPEN: "open",
  DROP: "drop",
});

function readSaved(storage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function rememberCancelIntent(storage, now) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify({ at: now }));
  } catch {
  }
}

export function clearCancelIntent(storage) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {
  }
}

export function pendingCancelIntent({ hash, storage, now }) {
  if (hash === CANCEL_INTENT_HASH) return { pending: true, viaLogin: false };
  const saved = readSaved(storage);
  const fresh = Number.isFinite(saved?.at) && now - saved.at <= INTENT_TTL_MS;
  return { pending: fresh, viaLogin: fresh };
}

export function cancelIntentStep(authState, intent) {
  if (!intent.pending || authState === AUTH_STATE.ERROR) return CANCEL_INTENT_STEP.NONE;
  if (authState === AUTH_STATE.AUTHENTICATED) return CANCEL_INTENT_STEP.OPEN;
  if (authState === AUTH_STATE.ANONYMOUS && !intent.viaLogin) return CANCEL_INTENT_STEP.LOGIN;
  return CANCEL_INTENT_STEP.DROP;
}
