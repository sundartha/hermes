import { Router } from "express";
import { AUTH_FAILED_GRUND } from "../util.js";
import { bearerAbgewiesen } from "./bearer-schluessel.js";
import { makeKeyedSingleFlight } from "../single-flight.js";
import { createRateLimiter } from "../middleware.js";
import { HTTP_OK, HTTP_SERVICE_UNAVAILABLE } from "../utils/http.js";

export const STATUS_PATH = "/intern/status";
const STATUS_TOKEN_MIN_LENGTH = 32;
const DATENBANK_FRIST_MS = 2000;
const ABRUFE_PRO_MINUTE = 30;


function statusSchluesselAbgewiesen(config, req, res) {
  const schluessel = {
    erwartet: config.auth.statusToken,
    mindestLaenge: STATUS_TOKEN_MIN_LENGTH,
    grund: AUTH_FAILED_GRUND.STATUS_TOKEN,
  };
  return bearerAbgewiesen(schluessel, req, res);
}

function innerhalbDerFrist(versuche, fristMs) {
  let zeitgeber;
  const ablauf = new Promise((fertig) => {
    zeitgeber = setTimeout(fertig, fristMs, false);
  });
  const ergebnisse = versuche.map((versuch) =>
    Promise.race([
      versuch.then(
        () => true,
        () => false,
      ),
      ablauf,
    ]),
  );
  return Promise.all(ergebnisse).finally(() => clearTimeout(zeitgeber));
}

export function makeInternStatusRoutes({ config, store, datenbankFristMs = DATENBANK_FRIST_MS }) {
  const router = Router();
  const begrenzer = createRateLimiter(ABRUFE_PRO_MINUTE);
  const probeDerDatenbank = makeKeyedSingleFlight(async () => store.pruefeVerbindung());

  async function zustand() {
    const flushAbfrage = (async () => {
      if ((await store.letzterFlushGelungen()) !== true) throw new Error("flush");
    })();
    const [datenbank, flush] = await innerhalbDerFrist([probeDerDatenbank(), flushAbfrage], datenbankFristMs);
    return { datenbank, flush, commit: config.server.deployedCommit };
  }

  router.get(STATUS_PATH, begrenzer, (req, res, next) => {
    if (statusSchluesselAbgewiesen(config, req, res)) return undefined;
    return zustand()
      .then((punkte) => {
        res.status(punkte.datenbank && punkte.flush ? HTTP_OK : HTTP_SERVICE_UNAVAILABLE).json(punkte);
      })
      .catch(next);
  });

  return router;
}
