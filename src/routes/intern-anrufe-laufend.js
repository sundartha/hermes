import { Router } from "express";
import { AUTH_FAILED_GRUND } from "../util.js";
import { bearerAbgewiesen } from "./bearer-schluessel.js";

export const ANRUFE_LAUFEND_PATH = "/intern/anrufe-laufend";
export const DEPLOY_TOKEN_MIN_LENGTH = 32;

const AKTIVER_STATUS = "active";

function laeuft(call, nowMs, store) {
  if (call.status !== AKTIVER_STATUS) return false;
  return !store.classifyCallTime(call, nowMs, store.MAX_CALL_DURATION_CAP_S).expired;
}

export function laufendeAnrufe(store, nowMs) {
  const { calls } = store.load();
  return calls.filter((call) => laeuft(call, nowMs, store)).length;
}

export function deployTokenAbgewiesen(config, req, res) {
  const schluessel = {
    erwartet: config.auth.deployToken,
    mindestLaenge: DEPLOY_TOKEN_MIN_LENGTH,
    grund: AUTH_FAILED_GRUND.DEPLOY_TOKEN,
  };
  return bearerAbgewiesen(schluessel, req, res);
}

export function makeInternAnrufeLaufendRoutes({ config, store }) {
  const router = Router();

  router.get(ANRUFE_LAUFEND_PATH, (req, res) => {
    if (deployTokenAbgewiesen(config, req, res)) return;
    res.json({ laufend: laufendeAnrufe(store, Date.now()) });
  });

  return router;
}
