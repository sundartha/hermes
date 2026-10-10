import { COMMIT_MUSTER, DEPLOY_ID, statusWort } from "./ausgabe.mjs";
import { produktionAbwarten, ROTE_ENDZUSTAENDE } from "./deploy.mjs";
import { notfallErlaubt } from "./herkunft.mjs";
import { hermesZugang, renderZugang } from "./netz.mjs";
import { abwarten, DEPLOY_TAKTE, ECHTE_UHR } from "./takt.mjs";
import { zielKenntAnrufpause, zielProbeStarten } from "./ziel-probe.mjs";

const HTTP_OK = 200;
const HTTP_ANGELEGT = 201;
const HTTP_ABGELEHNT_AB = 400;
const HTTP_NICHT_ANGEMELDET = 401;
const HTTP_SERVERFEHLER_AB = 500;
const EXIT_OK = 0;
const LIVE = "live";
const ABGELOEST = "deactivated";
const ROLLBACK = "rollback";
export const VORHER = "vorher";
const AUSLIEFERN = new Set(["commit", "checksPass", "off"]);
const ALTES_AUSLIEFERN = new Map([
  ["yes", "commit"],
  ["no", "off"],
]);

function ausliefernAus(dienst) {
  if (AUSLIEFERN.has(dienst?.autoDeployTrigger)) return dienst.autoDeployTrigger;
  return ALTES_AUSLIEFERN.get(dienst?.autoDeploy) ?? null;
}

async function ausliefernLesen({ render, ausgabe }, schluessel) {
  const { status, daten } = await render.dienst();
  const wert = status === HTTP_OK ? ausliefernAus(daten) : null;
  if (wert === null) ausgabe.melde("ausliefern_unlesbar", { http: status });
  else ausgabe.melde(schluessel, { ausliefern: wert });
  return wert;
}

function gueltigerDeploy(deploy) {
  return (
    DEPLOY_ID.test(deploy?.id ?? "") &&
    COMMIT_MUSTER.test(deploy.commit?.id ?? "") &&
    typeof deploy.finishedAt === "string"
  );
}

function deploysAus(daten) {
  const eintraege = Array.isArray(daten) ? daten.map((eintrag) => eintrag?.deploy) : [];
  return eintraege.filter(gueltigerDeploy);
}

function frueherAbgeloest(deploy, laufend) {
  return deploy.status === ABGELOEST && deploy.commit.id !== laufend;
}

function zielWaehlen(deploys, { laufend, ziel }) {
  if (ziel !== VORHER) {
    return deploys.find((deploy) => frueherAbgeloest(deploy, laufend) && deploy.commit.id === ziel);
  }
  const anker = deploys.findLastIndex(
    (deploy) => deploy.commit.id === laufend && deploy.trigger !== ROLLBACK,
  );
  if (anker === -1) return undefined;
  return deploys.slice(anker + 1).find((deploy) => frueherAbgeloest(deploy, laufend));
}

async function zielSuchen({ render, ausgabe }, ziel) {
  const { status, daten } = await render.liste();
  if (status !== HTTP_OK) {
    ausgabe.melde("abbruch_http", { schritt: "deploy_liste", http: status });
    return null;
  }
  const deploys = deploysAus(daten);
  const live = deploys.find((deploy) => deploy.status === LIVE);
  if (live === undefined) {
    ausgabe.melde("rot_kein_live");
    return null;
  }
  ausgabe.melde("produktion", { commit: live.commit.id });
  const gewaehlt = zielWaehlen(deploys, { laufend: live.commit.id, ziel });
  if (gewaehlt === undefined) {
    ausgabe.melde("rot_kein_ziel");
    return null;
  }
  ausgabe.melde("rollback_ziel", { commit: gewaehlt.commit.id });
  return { gewaehlt, bekannt: new Set(deploys.map((deploy) => deploy.id)) };
}

function umgebungsDeploy(eintrag) {
  const ausloeser = eintrag?.event?.details?.trigger;
  return ausloeser?.envUpdated === true;
}

function umgebungGeaendert(daten) {
  const eintraege = Array.isArray(daten) ? daten : [];
  return eintraege.filter(umgebungsDeploy);
}

async function umgebungPruefen({ render, ausgabe }, ziel) {
  const { status, daten } = await render.ereignisse(ziel.finishedAt);
  if (status === HTTP_OK) {
    const anzahl = umgebungGeaendert(daten).length;
    if (anzahl > 0) ausgabe.melde("umgebung_geaendert", { anzahl });
  } else {
    ausgabe.melde("umgebung_nicht_pruefbar", { http: status });
  }
  ausgabe.melde("umgebung_save_only");
}

function eindeutigAbgelehnt(status) {
  return status >= HTTP_ABGELEHNT_AB && status < HTTP_SERVERFEHLER_AB;
}

function neuerRollback(daten, bekannt) {
  const eintraege = Array.isArray(daten) ? daten.map((eintrag) => eintrag?.deploy) : [];
  return eintraege.find(
    (deploy) =>
      deploy?.trigger === ROLLBACK && DEPLOY_ID.test(deploy.id ?? "") && !bekannt.has(deploy.id),
  );
}

async function rollbackNachsehen({ render, ausgabe }, bekannt) {
  const { status, daten } = await render.liste();
  const gefunden = status === HTTP_OK ? neuerRollback(daten, bekannt) : undefined;
  if (gefunden === undefined) {
    ausgabe.melde("rollback_nicht_gefunden", { http: status });
    return "";
  }
  ausgabe.melde("rollback_laeuft_trotzdem", { id: gefunden.id });
  return gefunden.id;
}

async function rollbackAusloesen(kontext, { gewaehlt, bekannt }) {
  const { status, daten } = await kontext.render.zurueckrollen(gewaehlt.id);
  kontext.ausgabe.melde("rollback_ausgeloest", { http: status });
  if (status === HTTP_ANGELEGT) {
    if (DEPLOY_ID.test(daten?.id ?? "")) return { id: daten.id, bestaetigt: true };
    kontext.ausgabe.melde("abbruch", { schritt: "rollback" });
    return { id: "", bestaetigt: true };
  }
  kontext.ausgabe.melde("abbruch_http", { schritt: "rollback", http: status });
  if (eindeutigAbgelehnt(status)) {
    kontext.ausgabe.melde("rollback_abgelehnt", { http: status });
    return null;
  }
  return { id: await rollbackNachsehen(kontext, bekannt), bestaetigt: false };
}

async function rollbackVerfolgen({ render, ausgabe, uhr, takte }, id) {
  let bisher = null;
  const ergebnis = await abwarten({ uhr, ...takte.status }, async () => {
    const { daten } = await render.lesen(id);
    const zustand = statusWort(daten?.status);
    if (zustand !== bisher) ausgabe.melde("deploy_status", { status: zustand });
    bisher = zustand;
    if (zustand === LIVE) return { live: true };
    return ROTE_ENDZUSTAENDE.has(zustand) ? { live: false, zustand } : undefined;
  });
  if (ergebnis.schutzgrenze) {
    ausgabe.melde("schutzgrenze", { schritt: "deploy_status", minuten: ergebnis.minuten });
    return false;
  }
  if (!ergebnis.wert.live) ausgabe.melde("deploy_gescheitert", { status: ergebnis.wert.zustand });
  return ergebnis.wert.live;
}

async function rollbackLaufen(kontext, { id, commit }) {
  if (id === "") return false;
  if (!(await rollbackVerfolgen(kontext, id))) return false;
  return produktionAbwarten(kontext, commit);
}

async function ausliefernWiederherstellen(kontext, vorher) {
  let jetzt = await ausliefernLesen(kontext, "ausliefern_nachher");
  if (jetzt !== null && jetzt !== vorher) {
    const { status } = await kontext.render.dienstAendern({ autoDeployTrigger: vorher });
    kontext.ausgabe.melde("ausliefern_zurueckgesetzt", { ausliefern: vorher, http: status });
    jetzt = await ausliefernLesen(kontext, "ausliefern_nachher");
  }
  const gleich = jetzt === vorher;
  kontext.ausgabe.melde("ausliefern_wie_vorher", { ok: gleich });
  return gleich;
}

async function produktionPruefen(kontext, commit) {
  const { hermes, ausgabe, probeAuth, einstellungen } = kontext;
  const { produktionUrl: url, repoDir } = einstellungen;
  const exit = await probeAuth({ url, commit, repoDir });
  if (exit === null) {
    ausgabe.melde("rot_probe_auth_fehlt");
    return false;
  }
  if (!(await kontext.anrufpauseImZiel({ commit, repoDir }))) ausgabe.melde("ziel_ohne_anrufpause");
  ausgabe.melde("probe_auth_produktion", { exit });
  const http = await hermes.mcpOhneAnmeldung();
  ausgabe.melde("mcp_ohne_anmeldung", { http });
  return exit === EXIT_OK && http === HTTP_NICHT_ANGEMELDET;
}

async function rollbackDurchfuehren(kontext, { vorher, gewaehlt, bekannt }) {
  const ausgeloest = await rollbackAusloesen(kontext, { gewaehlt, bekannt });
  if (ausgeloest === null) return false;
  const gelaufen = await rollbackLaufen(kontext, { id: ausgeloest.id, commit: gewaehlt.commit.id });
  const wiederhergestellt = await ausliefernWiederherstellen(kontext, vorher);
  if (!ausgeloest.bestaetigt || !gelaufen || !wiederhergestellt) return false;
  if (!(await produktionPruefen(kontext, gewaehlt.commit.id))) return false;
  kontext.ausgabe.melde("probeanruf");
  return true;
}

async function rollbackAblauf(kontext, ziel) {
  const vorher = await ausliefernLesen(kontext, "ausliefern_vorher");
  if (vorher === null) return false;
  const gefunden = await zielSuchen(kontext, ziel);
  if (gefunden === null) return false;
  await umgebungPruefen(kontext, gefunden.gewaehlt);
  return rollbackDurchfuehren(kontext, { vorher, ...gefunden });
}

export async function zurueckrollen({
  einstellungen,
  ziel,
  ausgabe,
  uhr = ECHTE_UHR,
  takte = DEPLOY_TAKTE,
  probeAuth = zielProbeStarten,
  anrufpauseImZiel = zielKenntAnrufpause,
}) {
  if (!notfallErlaubt(einstellungen, ausgabe)) return false;
  if (!einstellungen.inActions) ausgabe.melde("live_zuerst_abschalten");
  const kontext = {
    render: renderZugang(einstellungen),
    hermes: hermesZugang(einstellungen.produktionUrl),
    einstellungen,
    ausgabe,
    uhr,
    takte,
    probeAuth,
    anrufpauseImZiel,
  };
  const ok = await rollbackAblauf(kontext, ziel);
  ausgabe.melde("live_wieder_einschalten");
  return ok;
}
