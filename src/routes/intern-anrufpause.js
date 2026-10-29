import { Router } from "express";
import { z } from "zod";
import { audit } from "../util.js";
import { deployTokenAbgewiesen } from "./intern-anrufe-laufend.js";
import { pruefeKoerper } from "./_validation.js";
import { HTTP_SERVICE_UNAVAILABLE, antworteFehler } from "../utils/http.js";

export const ANRUFPAUSE_PATH = "/intern/anrufpause";

const NICHT_GESPEICHERT = "persist_failed";

const PAUSEN_KOERPER = z.object({ an: z.boolean() }).strict();

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

export function makeInternAnrufpauseRoutes({ config, store }) {
  const router = Router();

  router.get(ANRUFPAUSE_PATH, (req, res) => {
    if (deployTokenAbgewiesen(config, req, res)) return;
    res.json({ an: store.anrufpauseAktiv() });
  });

  router.post(ANRUFPAUSE_PATH, (req, res, next) => {
    if (deployTokenAbgewiesen(config, req, res)) return;
    const koerper = pruefeKoerper(res, PAUSEN_KOERPER, req.body);
    if (koerper === undefined) return;
    umschalten(store, koerper.an, res).catch(next);
  });

  return router;
}
