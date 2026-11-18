import { Router } from "express";
import { AUTH_FAILED_GRUND } from "../util.ts";
import { bearerAbgewiesen } from "./bearer-schluessel.js";
import { MS_PER_MINUTE, MS_PER_SECOND } from "../utils/timer.ts";
import { abgewieseneWebhooks } from "../utils/webhook-abweisungen.js";

export const ANRUFE_LAUFEND_PATH = "/intern/anrufe-laufend";
export const DEPLOY_TOKEN_MIN_LENGTH = 32;

const AKTIVER_STATUS = "active";
const HOECHSTDAUER_MINUTEN = 20;
const HOECHSTDAUER_S = (HOECHSTDAUER_MINUTEN * MS_PER_MINUTE) / MS_PER_SECOND;

function laeuft(call, nowMs, store) {
  if (call.status !== AKTIVER_STATUS) return false;
  return !store.classifyCallTime(call, nowMs, store.MAX_CALL_DURATION_CAP_S).expired;
}

export function laufendeAnrufe(store, nowMs) {
  const { calls } = store.load();
  return calls.filter((call) => laeuft(call, nowMs, store)).length;
}

function ueberHoechstdauer(call, nowMs, store) {
  if (call.status !== AKTIVER_STATUS) return false;
  const start = { answeredAt: call.answeredAt, startedAt: call.startedAt };
  return store.classifyCallTime(start, nowMs, HOECHSTDAUER_S).expired;
}

export function fruehwarnung(store, nowMs) {
  const { calls } = store.load();
  return {
    webhooksAbgewiesen: abgewieseneWebhooks(),
    anrufeUeberHoechstdauer: calls.filter((call) => ueberHoechstdauer(call, nowMs, store)).length,
  };
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
