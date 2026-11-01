import { Router } from "express";
import { HTTP_SERVICE_UNAVAILABLE } from "./http.js";
import {
  SCHADEN_EVENT_LOOP,
  SCHADEN_POOL,
  gemeldeterSchaden,
  macheStauPruefung,
  starteLoopWache,
} from "./lokale-gesundheit.js";

const HEALTHZ_PATH = "/healthz";

const HEALTHZ_SCHWELLEN = Object.freeze({
  taktMs: 500,
  taktJeFenster: 20,
  loopGrenzeMs: 2000,
  loopFensterFolge: 6,
  poolStauMs: 300_000,
});

const MONOTONE_UHR = () => performance.now();

export function makeHealthzRoutes({
  config,
  poolZustand,
  schwellen = HEALTHZ_SCHWELLEN,
  uhr = MONOTONE_UHR,
}) {
  const router = Router();
  const loopFestgefahren = starteLoopWache({
    taktMs: schwellen.taktMs,
    taktJeFenster: schwellen.taktJeFenster,
    grenzeMs: schwellen.loopGrenzeMs,
    fensterFolge: schwellen.loopFensterFolge,
    uhr,
  });
  const poolGestaut = macheStauPruefung({ zustand: poolZustand, grenzeMs: schwellen.poolStauMs, uhr });

  function schaden() {
    const gemeldet = gemeldeterSchaden();
    if (gemeldet) return gemeldet;
    if (loopFestgefahren()) return SCHADEN_EVENT_LOOP;
    return poolGestaut() ? SCHADEN_POOL : null;
  }

  router.get(HEALTHZ_PATH, (_req, res) => {
    const commit = config.server.deployedCommit;
    const grund = schaden();
    if (grund) return res.status(HTTP_SERVICE_UNAVAILABLE).json({ ok: false, schaden: grund, commit });
    return res.json({ ok: true, commit });
  });

  return router;
}
