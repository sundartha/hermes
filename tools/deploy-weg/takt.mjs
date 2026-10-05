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

export const AUFWACHEN_FRIST_MS = 90_000;
export const AUFWACHEN_TAKT_MS = 20_000;
export const AUFWACHEN_SCHUTZGRENZE_MS = 300_000;
export const FRISCH_GEWECKT_AB_MS = 15_000;
export const RUHEFENSTER_MS = 1_200_000;

export const STAGING_TAKTE = Object.freeze({
  taktMs: STAGING_TAKT_SEKUNDEN * SEKUNDE_MS,
  schutzgrenzeMs: STAGING_SCHUTZGRENZE_MINUTEN * MINUTE_MS,
});

export const AUFWACHEN_TAKTE = Object.freeze({
  fristMs: AUFWACHEN_FRIST_MS,
  taktMs: AUFWACHEN_TAKT_MS,
  schutzgrenzeMs: AUFWACHEN_SCHUTZGRENZE_MS,
  frischAbMs: FRISCH_GEWECKT_AB_MS,
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
  aufwachen: AUFWACHEN_TAKTE,
  ruhefensterMs: RUHEFENSTER_MS,
});

export const ECHTE_UHR = Object.freeze({
  jetzt: () => Date.now(),
  warten: (ms) => warten(ms),
});

export function minuten(ms) {
  return Math.round(ms / MINUTE_MS);
}

export async function abwarten({ uhr, taktMs, schutzgrenzeMs, start = uhr.jetzt() }, versuch) {
  for (;;) {
    const wert = await versuch();
    if (wert !== undefined) return { wert };
    const vergangen = uhr.jetzt() - start;
    if (vergangen >= schutzgrenzeMs) return { schutzgrenze: true, minuten: minuten(vergangen) };
    await uhr.warten(Math.min(taktMs, schutzgrenzeMs - vergangen));
  }
}
