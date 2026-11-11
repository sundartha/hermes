import { randomUUID } from "node:crypto";

import { config } from "../config.js";
import {
  LEBENSZEICHEN_FRIST_S,
  LEBENSZEICHEN_LOESCHALTER_MIN,
  LEBENSZEICHEN_TAKT_MS,
} from "../begriffe/speicher.js";

export const EIGENE_KENNUNG = `${config.telemetry.telemetryInstanceId}:${randomUUID()}`;

const MELDEN_SQL = `
  INSERT INTO instanz_lebenszeichen (kennung, gemeldet_um) VALUES ($1, now())
  ON CONFLICT (kennung) DO UPDATE SET gemeldet_um = now()`;
const ABMELDEN_SQL = `DELETE FROM instanz_lebenszeichen WHERE kennung = $1`;
const LEBENDE_SQL = `
  SELECT kennung FROM instanz_lebenszeichen WHERE gemeldet_um > now() - make_interval(secs => $1)`;
const AUFRAEUMEN_SQL = `
  DELETE FROM instanz_lebenszeichen WHERE gemeldet_um < now() - make_interval(mins => $1)`;

export async function besitzLage(runner) {
  try {
    const { rows } = await runner.withClient((client) => client.query(LEBENDE_SQL, [LEBENSZEICHEN_FRIST_S]));
    return { eigene: EIGENE_KENNUNG, lebende: rows.map((zeile) => zeile.kennung) };
  } catch (fehler) {
    console.error(`[instanz] Lebenszeichen nicht lesbar: ${fehler.message}`);
    return { eigene: EIGENE_KENNUNG, lebende: null };
  }
}

export function makeInstanzTakt(runner) {
  let timer = null;
  let laufend = Promise.resolve();

  const einmal = async () => {
    try {
      await runner.withClient(async (client) => {
        await client.query(MELDEN_SQL, [EIGENE_KENNUNG]);
        await client.query(AUFRAEUMEN_SQL, [LEBENSZEICHEN_LOESCHALTER_MIN]);
      });
    } catch (fehler) {
      console.error(`[instanz] Lebenszeichen nicht geschrieben: ${fehler.message}`);
    }
  };
  const takt = () => {
    laufend = laufend.then(einmal);
    return laufend;
  };

  return {
    async starten() {
      await takt();
      timer = setInterval(takt, LEBENSZEICHEN_TAKT_MS);
      timer.unref();
    },
    async stoppen() {
      clearInterval(timer);
      await laufend;
    },
    async abmelden() {
      try {
        await runner.withClient((client) => client.query(ABMELDEN_SQL, [EIGENE_KENNUNG]));
      } catch (fehler) {
        console.error(`[instanz] Abmelden fehlgeschlagen: ${fehler.message}`);
      }
    },
  };
}
