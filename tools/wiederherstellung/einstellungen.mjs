import { Abbruch, melde } from "./ausgabe.mjs";

const STANDARD_API = "https://api.render.com/v1";
const STANDARD_IP = "https://api.ipify.org";
const STANDARD_TAKT_MS = 20000;
const LOOPBACK_URL = /^http:\/\/127\.0\.0\.1:\d{1,5}(?:\/[\w./-]*)?$/;
const PFLICHT = new Map([
  ["RENDER_API_KEY", /^\S{1,512}$/],
  ["RENDER_POSTGRES_ID", /^dpg-[a-z0-9-]{1,60}$/],
  ["RENDER_WIEDERHERSTELLUNG_UMGEBUNG", /^evm-[a-z0-9-]{1,60}$/],
  ["GITHUB_RUN_ID", /^\d{1,20}$/],
  ["GITHUB_RUN_ATTEMPT", /^\d{1,5}$/],
]);
const FREIWILLIG = new Map([
  ["RENDER_API_URL", LOOPBACK_URL],
  ["WIEDERHERSTELLUNG_IP_URL", LOOPBACK_URL],
  ["WIEDERHERSTELLUNG_TAKT_MS", /^[1-9]\d{0,5}$/],
  ["GITHUB_SHA", /^[0-9a-f]{7,40}$/],
]);
const MS_JE_MINUTE = 60000;
const RUECKBLICK_MINUTEN = 1440;
const PUFFER_MINUTEN = 15;

function ungueltigeEinstellungen(umgebung) {
  const pflicht = [...PFLICHT].filter(([name, muster]) => !muster.test(umgebung[name] ?? ""));
  const freiwillig = [...FREIWILLIG].filter(
    ([name, muster]) => Boolean(umgebung[name]) && !muster.test(umgebung[name]),
  );
  return [...pflicht, ...freiwillig].map(([name]) => name);
}

export function einstellungenLesen(umgebung) {
  const falsch = ungueltigeEinstellungen(umgebung);
  for (const name of falsch) melde("einstellung_ungueltig", { name });
  if (falsch.length > 0) throw new Abbruch("einstellungen");
  const lauf = [umgebung.GITHUB_RUN_ID, umgebung.GITHUB_RUN_ATTEMPT];
  return Object.freeze({
    schluessel: umgebung.RENDER_API_KEY,
    produktionId: umgebung.RENDER_POSTGRES_ID,
    umgebung: umgebung.RENDER_WIEDERHERSTELLUNG_UMGEBUNG,
    kopieName: ["hermes-wiederherstellung", ...lauf].join("-"),
    apiUrl: umgebung.RENDER_API_URL || STANDARD_API,
    ipUrl: umgebung.WIEDERHERSTELLUNG_IP_URL || STANDARD_IP,
    takt: Number(umgebung.WIEDERHERSTELLUNG_TAKT_MS || STANDARD_TAKT_MS),
    commit: umgebung.GITHUB_SHA || null,
  });
}

export function zeitpunktBerechnen(jetzt, beginn) {
  const ziel = jetzt - RUECKBLICK_MINUTEN * MS_JE_MINUTE;
  if (!Number.isFinite(beginn)) return { zeitpunkt: null, fehlend: null };
  if (beginn <= ziel) return { zeitpunkt: ziel };
  const kandidat = beginn + PUFFER_MINUTEN * MS_JE_MINUTE;
  const spaetestens = jetzt - PUFFER_MINUTEN * MS_JE_MINUTE;
  if (kandidat <= spaetestens) return { zeitpunkt: kandidat };
  return { zeitpunkt: null, fehlend: Math.ceil((kandidat - spaetestens) / MS_JE_MINUTE) };
}

export function minutenZwischen(frueher, spaeter) {
  return Math.round((spaeter - frueher) / MS_JE_MINUTE);
}
