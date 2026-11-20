import { setTimeout as warten } from "node:timers/promises";

const SEKUNDE_MS = 1000;
const SEKUNDEN_JE_MINUTE = 60;
const MINUTE_MS = SEKUNDEN_JE_MINUTE * SEKUNDE_MS;
const STAGING_TAKT_SEKUNDEN = 20;
const STAGING_SCHUTZGRENZE_MINUTEN = 20;
const STATUS_TAKT_SEKUNDEN = 30;
const STATUS_SCHUTZGRENZE_MINUTEN = 30;
const HEALTHZ_TAKT_SEKUNDEN = 20;
const HEALTHZ_SCHUTZGRENZE_MINUTEN = 10;
const NACHKONTROLLE_TAKT_SEKUNDEN = 60;
const NACHKONTROLLE_FRIST_MINUTEN = 30;

const STAGING_PIN_FRIST_MINUTEN = 3;

export const AUFWACHEN_FRIST_MS = 90_000;
export const AUFWACHEN_TAKT_MS = 20_000;
export const AUFWACHEN_SCHUTZGRENZE_MS = 300_000;
export const FRISCH_GEWECKT_AB_MS = 15_000;

export const STAGING_TAKTE = Object.freeze({
  taktMs: STAGING_TAKT_SEKUNDEN * SEKUNDE_MS,
  schutzgrenzeMs: STAGING_SCHUTZGRENZE_MINUTEN * MINUTE_MS,
});

export const STAGING_PIN_TAKTE = Object.freeze({
  taktMs: STAGING_TAKT_SEKUNDEN * SEKUNDE_MS,
  fristMs: STAGING_PIN_FRIST_MINUTEN * MINUTE_MS,
});

export const AUFWACHEN_TAKTE = Object.freeze({
  fristMs: AUFWACHEN_FRIST_MS,
  taktMs: AUFWACHEN_TAKT_MS,
  schutzgrenzeMs: AUFWACHEN_SCHUTZGRENZE_MS,
  frischAbMs: FRISCH_GEWECKT_AB_MS,
});

export const DEPLOY_TAKTE = Object.freeze({
  status: Object.freeze({
    taktMs: STATUS_TAKT_SEKUNDEN * SEKUNDE_MS,
    schutzgrenzeMs: STATUS_SCHUTZGRENZE_MINUTEN * MINUTE_MS,
  }),
  healthz: Object.freeze({
    taktMs: HEALTHZ_TAKT_SEKUNDEN * SEKUNDE_MS,
    schutzgrenzeMs: HEALTHZ_SCHUTZGRENZE_MINUTEN * MINUTE_MS,
  }),
  nachkontrolle: Object.freeze({
    taktMs: NACHKONTROLLE_TAKT_SEKUNDEN * SEKUNDE_MS,
    schutzgrenzeMs: NACHKONTROLLE_FRIST_MINUTEN * MINUTE_MS,
  }),
  aufwachen: AUFWACHEN_TAKTE,
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

export async function wiederholenBisFrist({ uhr, taktMs, fristMs }, versuch) {
  let gewartet = 0;
  for (;;) {
    const ergebnis = await versuch();
    if (ergebnis.fertig || gewartet >= fristMs) return ergebnis;
    const pause = Math.min(taktMs, fristMs - gewartet);
    await uhr.warten(pause);
    gewartet += pause;
  }
}
