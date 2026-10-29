import { audit } from "../util.js";
import { deployTokenAbgewiesen } from "./intern-anrufe-laufend.js";
import { HTTP_BAD_REQUEST, HTTP_SERVICE_UNAVAILABLE, antworteFehler } from "../utils/http.js";

export const ANRUFPAUSE_PATH = "/intern/anrufpause";

const UNGUELTIG = "invalid_body";
const NICHT_GESPEICHERT = "persist_failed";

const istPausenKoerper = (koerper) =>
  typeof koerper?.an === "boolean" && Object.keys(koerper).length === 1;

async function umschalten(store, an, res) {
  try {
    await store.setzeAnrufpause(an);
  } catch {
    audit("anrufpause_fehlgeschlagen", null, `an=${an}`);
    return antworteFehler(res, HTTP_SERVICE_UNAVAILABLE, NICHT_GESPEICHERT);
  }
  audit("anrufpause_gesetzt", null, `an=${an}`);
  return res.json({ an });
}

export function anrufpauseLesenHandler({ config, store }) {
  return function anrufpauseLesen(req, res) {
    if (deployTokenAbgewiesen(config, req, res)) return undefined;
    return res.json({ an: store.anrufpauseAktiv() });
  };
}

export function anrufpauseSetzenHandler({ config, store }) {
  return function anrufpauseSetzen(req, res, next) {
    if (deployTokenAbgewiesen(config, req, res)) return undefined;
    if (!istPausenKoerper(req.body)) return antworteFehler(res, HTTP_BAD_REQUEST, UNGUELTIG);
    return umschalten(store, req.body.an, res).catch(next);
  };
}
