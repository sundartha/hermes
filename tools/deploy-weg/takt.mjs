import { setTimeout as warten } from "node:timers/promises";

const SEKUNDE_MS = 1000;
const SEKUNDEN_JE_MINUTE = 60;
const MINUTE_MS = SEKUNDEN_JE_MINUTE * SEKUNDE_MS;
const STAGING_TAKT_SEKUNDEN = 20;
const STAGING_SCHUTZGRENZE_MINUTEN = 20;
const ANRUFE_TAKT_SEKUNDEN = 60;
const ANRUFE_SCHUTZGRENZE_MINUTEN = 35;
const STATUS_TAKT_SEKUNDEN = 30;
const STATUS_SCHUTZGRENZE_MINUTEN = 30;
const HEALTHZ_TAKT_SEKUNDEN = 20;
const HEALTHZ_SCHUTZGRENZE_MINUTEN = 10;

export const STAGING_TAKTE = Object.freeze({
  taktMs: STAGING_TAKT_SEKUNDEN * SEKUNDE_MS,
  schutzgrenzeMs: STAGING_SCHUTZGRENZE_MINUTEN * MINUTE_MS,
});

export const DEPLOY_TAKTE = Object.freeze({
  anrufe: Object.freeze({
    taktMs: ANRUFE_TAKT_SEKUNDEN * SEKUNDE_MS,
    schutzgrenzeMs: ANRUFE_SCHUTZGRENZE_MINUTEN * MINUTE_MS,
  }),
  status: Object.freeze({
    taktMs: STATUS_TAKT_SEKUNDEN * SEKUNDE_MS,
    schutzgrenzeMs: STATUS_SCHUTZGRENZE_MINUTEN * MINUTE_MS,
  }),
  healthz: Object.freeze({
    taktMs: HEALTHZ_TAKT_SEKUNDEN * SEKUNDE_MS,
    schutzgrenzeMs: HEALTHZ_SCHUTZGRENZE_MINUTEN * MINUTE_MS,
  }),
});

export const ECHTE_UHR = Object.freeze({
  jetzt: () => Date.now(),
  warten: (ms) => warten(ms),
});

export function minuten(ms) {
  return Math.round(ms / MINUTE_MS);
}

export async function abwarten({ uhr, taktMs, schutzgrenzeMs }, versuch) {
  const start = uhr.jetzt();
  for (;;) {
    const wert = await versuch();
    if (wert !== undefined) return { wert };
    const vergangen = uhr.jetzt() - start;
    if (vergangen >= schutzgrenzeMs) return { schutzgrenze: true, minuten: minuten(vergangen) };
    await uhr.warten(taktMs);
  }
}
