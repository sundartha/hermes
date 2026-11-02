import { Router } from "express";
import { AUTH_FAILED_GRUND } from "../util.js";
import { bearerAbgewiesen } from "./bearer-schluessel.js";
import { makeKeyedSingleFlight } from "../single-flight.js";
import { createRateLimiter } from "../middleware.js";
import { HTTP_SERVICE_UNAVAILABLE } from "../utils/http.js";

export const STATUS_PATH = "/intern/status";
export const STATUS_TOKEN_MIN_LENGTH = 32;
const DATENBANK_FRIST_MS = 2000;
const ABRUFE_PRO_MINUTE = 30;

const HTTP_OK = 200;

function statusSchluesselAbgewiesen(config, req, res) {
  const schluessel = {
    erwartet: config.auth.statusToken,
    mindestLaenge: STATUS_TOKEN_MIN_LENGTH,
    grund: AUTH_FAILED_GRUND.STATUS_TOKEN,
  };
  return bearerAbgewiesen(schluessel, req, res);
}

function innerhalbDerFrist(versuch, fristMs) {
  let zeitgeber;
  const ablauf = new Promise((fertig) => {
    zeitgeber = setTimeout(fertig, fristMs, false);
  });
  const ergebnis = versuch.then(
    () => true,
    () => false,
  );
  return Promise.race([ergebnis, ablauf]).finally(() => clearTimeout(zeitgeber));
}

export function makeInternStatusRoutes({ config, store, datenbankFristMs = DATENBANK_FRIST_MS }) {
  const router = Router();
  const begrenzer = createRateLimiter(ABRUFE_PRO_MINUTE);
  const probeDerDatenbank = makeKeyedSingleFlight(async () => store.pruefeVerbindung());

  async function zustand() {
    const datenbank = await innerhalbDerFrist(probeDerDatenbank(), datenbankFristMs);
    return { datenbank, commit: config.server.deployedCommit };
  }

  router.get(STATUS_PATH, begrenzer, (req, res, next) => {
    if (statusSchluesselAbgewiesen(config, req, res)) return undefined;
    return zustand()
      .then((punkte) => {
        res.status(punkte.datenbank ? HTTP_OK : HTTP_SERVICE_UNAVAILABLE).json(punkte);
      })
      .catch(next);
  });

  return router;
}
