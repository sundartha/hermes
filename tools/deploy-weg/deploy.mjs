import { DEPLOY_ID, statusWort } from "./ausgabe.mjs";
import { hermesZugang, renderZugang } from "./netz.mjs";
import { abwarten, DEPLOY_TAKTE, ECHTE_UHR, minuten } from "./takt.mjs";

const HTTP_OK = 200;
const HTTP_ANGELEGT = 201;
const HTTP_ANGENOMMEN = 202;
const LIVE = "live";
const UMSCHALTEN = "update_in_progress";
export const ROTE_ENDZUSTAENDE = new Set([
  "build_failed",
  "update_failed",
  "canceled",
  "pre_deploy_failed",
  "deactivated",
]);

function schutzgrenzeMelden(ausgabe, { schritt, ergebnis }) {
  ausgabe.melde("schutzgrenze", { schritt, minuten: ergebnis.minuten });
  return false;
}

async function weckenImSchritt(kontext, { schritt, start, grenzeMs }) {
  const { hermes, ausgabe, uhr, takte } = kontext;
  const rest = grenzeMs - (uhr.jetzt() - start);
  const wecken = await hermes.aufwecken({ uhr, takte: takte.aufwachen, grenzeMs: rest });
  if (wecken.schutzgrenze) {
    ausgabe.melde("rot_aufwachen_zeitgrenze", { schritt, minuten: wecken.minuten });
    return null;
  }
  if (wecken.frischGeweckt) ausgabe.melde("frisch_geweckt");
  return wecken;
}

function anrufeBeobachter({ hermes, ausgabe, uhr, takte }, ruhefenster) {
  let bisher = null;
  let fensterStart = uhr.jetzt();
  return async () => {
    const { status, laufend } = await hermes.anrufe();
    if (laufend === null) return { http: status };
    if (laufend !== bisher) ausgabe.melde("anrufe", { anzahl: laufend });
    bisher = laufend;
    if (laufend > 0) {
      fensterStart = uhr.jetzt();
      return undefined;
    }
    const ruhig = !ruhefenster || uhr.jetzt() - fensterStart >= takte.ruhefensterMs;
    return ruhig ? { frei: true } : undefined;
  };
}

async function anrufeAbwarten(kontext) {
  const { ausgabe, uhr, takte } = kontext;
  const start = uhr.jetzt();
  const grenzeMs = takte.anrufe.schutzgrenzeMs;
  const wecken = await weckenImSchritt(kontext, { schritt: "anrufe", start, grenzeMs });
  if (wecken === null) return false;
  const ruhefenster = kontext.frischGeweckt || wecken.frischGeweckt;
  if (ruhefenster) ausgabe.melde("ruhefenster", { minuten: minuten(takte.ruhefensterMs) });
  const beobachter = anrufeBeobachter(kontext, ruhefenster);
  const ergebnis = await abwarten({ uhr, ...takte.anrufe, start }, beobachter);
  if (ergebnis.schutzgrenze) return schutzgrenzeMelden(ausgabe, { schritt: "anrufe", ergebnis });
  if (ergebnis.wert.frei) return true;
  ausgabe.melde("abbruch_http", { schritt: "anrufe", http: ergebnis.wert.http });
  return false;
}

function apiDeploys(daten, commit) {
  const eintraege = Array.isArray(daten) ? daten.map((eintrag) => eintrag?.deploy) : [];
  return eintraege.filter(
    (deploy) =>
      deploy?.commit?.id === commit && deploy.trigger === "api" && DEPLOY_ID.test(deploy.id ?? ""),
  );
}

async function bekannteDeploys({ render, ausgabe }, commit) {
  const { status, daten } = await render.liste();
  if (status !== HTTP_OK) {
    ausgabe.melde("abbruch_http", { schritt: "deploy_liste", http: status });
    return null;
  }
  return new Set(apiDeploys(daten, commit).map((deploy) => deploy.id));
}

function wachhaltend({ hermes }, versuch) {
  return async () => {
    const wert = await versuch();
    if (wert === undefined) await hermes.wachhalten();
    return wert;
  };
}

async function neuenDeploySuchen(kontext, { commit, vorher }) {
  const { render, ausgabe, uhr, takte } = kontext;
  const ergebnis = await abwarten(
    { uhr, ...takte.status },
    wachhaltend(kontext, async () => {
      const { status, daten } = await render.liste();
      if (status !== HTTP_OK) return undefined;
      const neu = apiDeploys(daten, commit).find((deploy) => !vorher.has(deploy.id));
      return neu?.id;
    }),
  );
  if (!ergebnis.schutzgrenze) return ergebnis.wert;
  schutzgrenzeMelden(ausgabe, { schritt: "deploy_suche", ergebnis });
  return null;
}

async function deployAusloesen(kontext, { commit, vorher }) {
  const { render, ausgabe } = kontext;
  const { status, daten } = await render.ausloesen(commit);
  ausgabe.melde("deploy_ausgeloest", { http: status });
  if (status === HTTP_ANGELEGT && DEPLOY_ID.test(daten?.id ?? "")) return daten.id;
  if (status === HTTP_ANGENOMMEN) return neuenDeploySuchen(kontext, { commit, vorher });
  ausgabe.melde("abbruch", { schritt: "ausloesen" });
  return null;
}

async function deployAbbrechen({ render, ausgabe }, id) {
  const { status } = await render.abbrechen(id);
  ausgabe.melde("abgebrochen", { http: status });
}

async function umschaltenErlaubt({ hermes, ausgabe }) {
  const { status, laufend } = await hermes.anrufe();
  if (laufend === null) ausgabe.melde("abbruch_http", { schritt: "anrufe", http: status });
  else ausgabe.melde("anrufe", { anzahl: laufend });
  return laufend === 0;
}

async function umschaltenPruefen(kontext, start) {
  const grenzeMs = kontext.takte.status.schutzgrenzeMs;
  const wecken = await weckenImSchritt(kontext, { schritt: "deploy_status", start, grenzeMs });
  if (wecken === null || wecken.frischGeweckt) return "umschalten_ungemessen";
  return (await umschaltenErlaubt(kontext)) ? null : "anruf_beim_umschalten";
}

function statusBeobachter(kontext, { id, start }) {
  const { render, ausgabe } = kontext;
  let bisher = null;
  return wachhaltend(kontext, async () => {
    const { status, daten } = await render.lesen(id);
    if (status !== HTTP_OK) return undefined;
    const zustand = statusWort(daten?.status);
    const neu = zustand !== bisher;
    if (neu) ausgabe.melde("deploy_status", { status: zustand });
    bisher = zustand;
    if (zustand === LIVE) return { live: true };
    if (ROTE_ENDZUSTAENDE.has(zustand)) return { live: false, endzustand: zustand };
    if (!neu || zustand !== UMSCHALTEN) return undefined;
    const abbruch = await umschaltenPruefen(kontext, start);
    return abbruch === null ? undefined : { live: false, abbruch };
  });
}

async function deployVerfolgen(kontext, id) {
  const { ausgabe, uhr, takte } = kontext;
  const start = uhr.jetzt();
  const beobachter = statusBeobachter(kontext, { id, start });
  const ergebnis = await abwarten({ uhr, ...takte.status, start }, beobachter);
  if (ergebnis.schutzgrenze) {
    schutzgrenzeMelden(ausgabe, { schritt: "deploy_status", ergebnis });
    await deployAbbrechen(kontext, id);
    return false;
  }
  if (ergebnis.wert.live) return true;
  if (ergebnis.wert.abbruch) {
    ausgabe.melde(ergebnis.wert.abbruch);
    await deployAbbrechen(kontext, id);
    return false;
  }
  ausgabe.melde("deploy_gescheitert", { status: ergebnis.wert.endzustand });
  return false;
}

export async function produktionAbwarten(kontext, commit) {
  const { hermes, ausgabe, uhr, takte } = kontext;
  const start = uhr.jetzt();
  const grenzeMs = takte.healthz.schutzgrenzeMs;
  if ((await weckenImSchritt(kontext, { schritt: "healthz", start, grenzeMs })) === null) {
    return false;
  }
  const ergebnis = await abwarten({ uhr, ...takte.healthz, start }, async () =>
    (await hermes.commit()) === commit ? true : undefined,
  );
  if (ergebnis.schutzgrenze) return schutzgrenzeMelden(ausgabe, { schritt: "healthz", ergebnis });
  ausgabe.melde("live", { commit });
  return true;
}

async function vorDemDeploy(kontext, { commit, produktion }) {
  if (!(await anrufeAbwarten(kontext))) return null;
  if ((await kontext.hermes.commit()) !== produktion) {
    kontext.ausgabe.melde("produktion_veraendert");
    return null;
  }
  return bekannteDeploys(kontext, commit);
}

export async function deploy({
  einstellungen,
  commit,
  produktion,
  frischGeweckt = false,
  ausgabe,
  uhr = ECHTE_UHR,
  takte = DEPLOY_TAKTE,
}) {
  const kontext = {
    render: renderZugang(einstellungen),
    hermes: hermesZugang(einstellungen.produktionUrl, einstellungen.deployToken),
    ausgabe,
    uhr,
    takte,
    frischGeweckt,
  };
  const vorher = await vorDemDeploy(kontext, { commit, produktion });
  if (vorher === null) return false;
  const id = await deployAusloesen(kontext, { commit, vorher });
  if (id === null) return false;
  if (!(await deployVerfolgen(kontext, id))) return false;
  return produktionAbwarten(kontext, commit);
}
