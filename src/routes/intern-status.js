import { Router } from "express";
import { AUTH_FAILED_GRUND } from "../util.ts";
import { bearerAbgewiesen } from "./bearer-schluessel.js";
import { fruehwarnung } from "./intern-anrufe-laufend.js";
import { makeKeyedSingleFlight } from "../single-flight.ts";
import { createRateLimiter } from "../middleware.ts";
import { HTTP_OK, HTTP_SERVICE_UNAVAILABLE } from "../utils/http.ts";

export const STATUS_PATH = "/intern/status";
export const ANRUFE_KOPF = "x-hermes-anrufe";
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

function eigeneAdresse(adresse, standard) {
  return adresse !== undefined && adresse !== standard;
}

async function anrufLage(config) {
  const { ELEVENLABS_API_BASE_STANDARD, TELNYX_API_BASE_STANDARD } = await import("../config.ts");
  if (config.safety?.outboundFrozen === true) return "gesperrt";
  const elevenLabs = config.voice?.elevenLabsOutbound?.apiBase;
  const telnyx = config.telephony?.telnyxApiBase;
  const attrappe = eigeneAdresse(elevenLabs, ELEVENLABS_API_BASE_STANDARD) && eigeneAdresse(telnyx, TELNYX_API_BASE_STANDARD);
  return attrappe ? "attrappe" : "echt";
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
    const { inboundSignatureVerifier } = await import("../telephony/registry.js");
    const telnyxSignaturSchluessel = inboundSignatureVerifier().schluesselGueltig(config.telephony?.telnyxPublicKey) ? "ok" : "fehlt";
    return { datenbank, flush, commit: config.server.deployedCommit, telnyxSignaturSchluessel, ...fruehwarnung(store, Date.now()) };
  }

  router.get(STATUS_PATH, begrenzer, (req, res, next) => {
    if (statusSchluesselAbgewiesen(config, req, res)) return undefined;
    return zustand()
      .then(async (punkte) => {
        res.set(ANRUFE_KOPF, await anrufLage(config));
        res.status(punkte.datenbank && punkte.flush ? HTTP_OK : HTTP_SERVICE_UNAVAILABLE).json(punkte);
      })
      .catch(next);
  });

  return router;
}
