import { Router } from "express";
import { HTTP_SERVICE_UNAVAILABLE } from "./http.ts";
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

function macheFruehwarnungsFelder() {
  let zuletztGeloggt = null;
  return ({ webhooksAbgewiesen, anrufeUeberHoechstdauer }) => {
    if (webhooksAbgewiesen === 0 && anrufeUeberHoechstdauer === 0) {
      zuletztGeloggt = null;
      return {};
    }
    const zeile = `[fruehwarnung] webhooksAbgewiesen=${String(webhooksAbgewiesen)} anrufeUeberHoechstdauer=${String(anrufeUeberHoechstdauer)}`;
    if (zeile !== zuletztGeloggt) console.error(zeile);
    zuletztGeloggt = zeile;
    const felder = {};
    if (webhooksAbgewiesen > 0) felder.webhooksAbgewiesen = webhooksAbgewiesen;
    if (anrufeUeberHoechstdauer > 0) felder.anrufeUeberHoechstdauer = anrufeUeberHoechstdauer;
    return felder;
  };
}

export function makeHealthzRoutes({
  config,
  poolZustand,
  schwellen = HEALTHZ_SCHWELLEN,
  uhr = MONOTONE_UHR,
  zeitplaene = () => Promise.resolve([]),
  fruehwarnung = () => ({ webhooksAbgewiesen: 0, anrufeUeberHoechstdauer: 0 }),
}) {
  const router = Router();
  const fruehwarnungsFelder = macheFruehwarnungsFelder();
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

  router.get(HEALTHZ_PATH, (_req, res, next) => {
    const commit = config.server.deployedCommit;
    const grund = schaden();
    if (grund) {
      res.status(HTTP_SERVICE_UNAVAILABLE).json({ ok: false, schaden: grund, commit });
      return;
    }
    zeitplaene()
      .then((ueberfaellig) => {
        const warnung = fruehwarnungsFelder(fruehwarnung());
        if (ueberfaellig.length > 0) console.error(`[zeitplan] Herzschlag überfällig: ${ueberfaellig.join(", ")}`);
        const felder = ueberfaellig.length > 0 ? { zeitplaeneUeberfaellig: ueberfaellig.length } : {};
        const instanz = config.telemetry?.telemetryInstanceId;
        res.json({ ok: true, commit, instanz, ...felder, ...warnung });
      })
      .catch(next);
  });

  return router;
}
