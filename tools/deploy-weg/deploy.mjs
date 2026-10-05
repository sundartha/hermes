import { statusWort } from "./ausgabe.mjs";
import { hermesZugang, renderZugang } from "./netz.mjs";
import { abwarten, DEPLOY_TAKTE, ECHTE_UHR } from "./takt.mjs";

const HTTP_OK = 200;
const HTTP_ANGELEGT = 201;
const HTTP_ANGENOMMEN = 202;
const DEPLOY_ID = /^dep-[a-z0-9]{1,60}$/;
const LIVE = "live";
const UMSCHALTEN = "update_in_progress";
const ROTE_ENDZUSTAENDE = new Set([
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

async function anrufeAbwarten({ hermes, ausgabe, uhr, takte }) {
  let bisher = null;
  const ergebnis = await abwarten({ uhr, ...takte.anrufe }, async () => {
    const { status, laufend } = await hermes.anrufe();
    if (laufend === null) return { http: status };
    if (laufend !== bisher) ausgabe.melde("anrufe", { anzahl: laufend });
    bisher = laufend;
    return laufend === 0 ? { frei: true } : undefined;
  });
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

async function neuenDeploySuchen(kontext, { commit, vorher }) {
  const { render, ausgabe, uhr, takte } = kontext;
  const ergebnis = await abwarten({ uhr, ...takte.status }, async () => {
    const { status, daten } = await render.liste();
    if (status !== HTTP_OK) return undefined;
    const neu = apiDeploys(daten, commit).find((deploy) => !vorher.has(deploy.id));
    return neu?.id;
  });
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

function statusBeobachter(kontext, id) {
  const { render, ausgabe } = kontext;
  let bisher = null;
  return async () => {
    const { status, daten } = await render.lesen(id);
    if (status !== HTTP_OK) return undefined;
    const zustand = statusWort(daten?.status);
    const neu = zustand !== bisher;
    if (neu) ausgabe.melde("deploy_status", { status: zustand });
    bisher = zustand;
    if (zustand === LIVE) return { live: true };
    if (ROTE_ENDZUSTAENDE.has(zustand)) return { live: false, endzustand: zustand };
    if (neu && zustand === UMSCHALTEN && !(await umschaltenErlaubt(kontext))) {
      return { live: false, anruf: true };
    }
    return undefined;
  };
}

async function deployVerfolgen(kontext, id) {
  const { ausgabe, uhr, takte } = kontext;
  const ergebnis = await abwarten({ uhr, ...takte.status }, statusBeobachter(kontext, id));
  if (ergebnis.schutzgrenze) {
    schutzgrenzeMelden(ausgabe, { schritt: "deploy_status", ergebnis });
    await deployAbbrechen(kontext, id);
    return false;
  }
  if (ergebnis.wert.live) return true;
  if (ergebnis.wert.anruf) {
    ausgabe.melde("anruf_beim_umschalten");
    await deployAbbrechen(kontext, id);
    return false;
  }
  ausgabe.melde("deploy_gescheitert", { status: ergebnis.wert.endzustand });
  return false;
}

async function produktionAbwarten({ hermes, ausgabe, uhr, takte }, commit) {
  const ergebnis = await abwarten({ uhr, ...takte.healthz }, async () =>
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
  };
  const vorher = await vorDemDeploy(kontext, { commit, produktion });
  if (vorher === null) return false;
  const id = await deployAusloesen(kontext, { commit, vorher });
  if (id === null) return false;
  if (!(await deployVerfolgen(kontext, id))) return false;
  return produktionAbwarten(kontext, commit);
}
