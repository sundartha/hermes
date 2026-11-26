import { randomUUID } from "node:crypto";

import { config } from "../config.ts";
import {
  LEBENSZEICHEN_FRIST_S,
  LEBENSZEICHEN_LOESCHALTER_MIN,
  LEBENSZEICHEN_TAKT_MS,
} from "../begriffe/speicher.ts";

export const EIGENE_KENNUNG = `${config.telemetry.telemetryInstanceId}:${randomUUID()}`;

const MELDEN_SQL = `
  INSERT INTO instanz_lebenszeichen (kennung, gemeldet_um) VALUES ($1, now())
  ON CONFLICT (kennung) DO UPDATE SET gemeldet_um = now()`;
const ABMELDEN_SQL = `DELETE FROM instanz_lebenszeichen WHERE kennung = $1`;
const LEBENDE_SQL = `
  SELECT kennung FROM instanz_lebenszeichen WHERE gemeldet_um > now() - make_interval(secs => $1)`;
const AUFRAEUMEN_SQL = `
  DELETE FROM instanz_lebenszeichen WHERE gemeldet_um < now() - make_interval(mins => $1)`;

const MANDANT_SQL = `SELECT set_config('app.current_tenant', $1, true)`;
const UEBERNEHMEN_SQL = `
  UPDATE call SET instanz = $1
  WHERE tenant_id = $2 AND id = $3 AND status = 'active' AND instanz IS NOT DISTINCT FROM $4`;

export function uebernimmAnruf(runner, { callId, tenantId, alt }) {
  return runner.withClient(async (client) => {
    await client.query("BEGIN");
    try {
      await client.query(MANDANT_SQL, [tenantId]);
      const { rowCount } = await client.query(UEBERNEHMEN_SQL, [EIGENE_KENNUNG, tenantId, callId, alt ?? null]);
      await client.query("COMMIT");
      return rowCount === 1;
    } catch (fehler) {
      await client.query("ROLLBACK");
      throw fehler;
    }
  });
}

export async function besitzLage(runner) {
  try {
    const { rows } = await runner.withClient((client) => client.query(LEBENDE_SQL, [LEBENSZEICHEN_FRIST_S]));
    return { eigene: EIGENE_KENNUNG, lebende: rows.map((zeile) => zeile.kennung) };
  } catch (fehler) {
    console.error("[instanz] Lebenszeichen nicht lesbar:", fehler.message);
    return { eigene: EIGENE_KENNUNG, lebende: null };
  }
}

export function makeInstanzTakt(runner, { nachMeldung = async () => {} } = {}) {
  let timer = null;
  let meldeLauf = Promise.resolve();
  let uebernahmeLauf = Promise.resolve();
  let uebernahmeLaeuft = false;

  const melden = async () => {
    try {
      await runner.withClient(async (client) => {
        await client.query(MELDEN_SQL, [EIGENE_KENNUNG]);
        await client.query(AUFRAEUMEN_SQL, [LEBENSZEICHEN_LOESCHALTER_MIN]);
      });
    } catch (fehler) {
      console.error("[instanz] Lebenszeichen nicht geschrieben:", fehler.message);
    }
  };
  const uebernehmen = async () => {
    try {
      await nachMeldung();
    } catch (fehler) {
      console.error("[instanz] Uebernahme verwaister Arbeit fehlgeschlagen:", fehler.message);
    }
  };
  const takt = () => {
    const gemeldet = meldeLauf.then(melden);
    meldeLauf = gemeldet;
    if (uebernahmeLaeuft) return;
    uebernahmeLaeuft = true;
    uebernahmeLauf = gemeldet.then(uebernehmen).finally(() => {
      uebernahmeLaeuft = false;
    });
  };

  return {
    async starten() {
      meldeLauf = melden();
      await meldeLauf;
      timer = setInterval(takt, LEBENSZEICHEN_TAKT_MS);
      timer.unref();
    },
    async stoppen() {
      clearInterval(timer);
      await Promise.all([meldeLauf, uebernahmeLauf]);
    },
    async abmelden() {
      try {
        await runner.withClient((client) => client.query(ABMELDEN_SQL, [EIGENE_KENNUNG]));
      } catch (fehler) {
        console.error("[instanz] Abmelden fehlgeschlagen:", fehler.message);
      }
    },
  };
}
