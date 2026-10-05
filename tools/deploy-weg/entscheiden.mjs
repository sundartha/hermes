import { ausgabenSchreiben, statusWort, TEIL_MUSTER } from "./ausgabe.mjs";
import {
  ausHandStart,
  ausStagingLauf,
  checksPruefen,
  githubFehler,
  grund,
  gueltigerCommit,
  prKopf,
} from "./herkunft.mjs";
import { githubZugang, hermesZugang } from "./netz.mjs";
import { AUFWACHEN_TAKTE, ECHTE_UHR } from "./takt.mjs";

const HTTP_OK = 200;
const LAUF = "workflow_run";
const HAND = "workflow_dispatch";
const ABGLEICH_GESCHEITERT = "abgleich-gescheitert";
const HOECHSTENS_TEILE = 50;
const AUF_MASTER = new Set(["behind", "identical"]);

async function abdruckVergleichen(argumente) {
  const { gespraechVergleichen } = await import("./abdruck.mjs");
  return gespraechVergleichen(argumente);
}

function herkunftBestimmen({ ereignis, einstellungen, github }) {
  const nutzlast = ereignis.nutzlast;
  if (nutzlast === null || typeof nutzlast !== "object") {
    return { commit: null, gruende: [grund("rot_ereignis")], hand: false };
  }
  if (ereignis.name === LAUF) {
    return ausStagingLauf(nutzlast.workflow_run ?? null, github.repository);
  }
  if (ereignis.name === HAND) return ausHandStart({ nutzlast, einstellungen, github });
  return { commit: null, gruende: [grund("rot_ereignis")], hand: false };
}

async function vergleich(github, { basis, kopf }) {
  const { status, daten } = await github.lesen("/compare/" + basis + "..." + kopf);
  return status === HTTP_OK ? { wort: statusWort(daten?.status) } : { http: status };
}

async function aufMasterPruefen(github, commit) {
  const ergebnis = await vergleich(github, { basis: "master", kopf: commit });
  if (ergebnis.http !== undefined) return [githubFehler("master", ergebnis.http)];
  if (AUF_MASTER.has(ergebnis.wort)) return [];
  return [grund("rot_nicht_auf_master", { status: ergebnis.wort })];
}

async function commitPruefen(github, commit) {
  const { gruende, kopf } = await prKopf({ github, commit });
  const checks = kopf === null ? [] : await checksPruefen({ github, kopf });
  return [...gruende, ...checks, ...(await aufMasterPruefen(github, commit))];
}

async function gegenProduktion(github, { commit, produktion }) {
  const ergebnis = await vergleich(github, { basis: produktion, kopf: commit });
  if (ergebnis.http !== undefined) return { gruende: [githubFehler("vergleich", ergebnis.http)] };
  if (ergebnis.wort === "identical") return { gruende: [], identisch: true };
  if (ergebnis.wort === "ahead") return { gruende: [] };
  return { gruende: [grund("rot_nicht_neuer", { status: ergebnis.wort })] };
}

async function produktionMessen({ hermes, ausgabe, uhr, takte }) {
  const wecken = await hermes.aufwecken({ uhr, takte, grenzeMs: takte.schutzgrenzeMs });
  if (wecken.schutzgrenze) {
    const werte = { schritt: "produktion", minuten: wecken.minuten };
    const gruende = [grund("rot_aufwachen_zeitgrenze", werte)];
    return { produktion: null, frischGeweckt: false, gruende };
  }
  if (wecken.frischGeweckt) ausgabe.melde("frisch_geweckt");
  const produktion = gueltigerCommit(await hermes.commit());
  return { produktion, frischGeweckt: wecken.frischGeweckt, gruende: [] };
}

async function lageErmitteln(kontext) {
  const { github, ausgabe } = kontext;
  const herkunft = await herkunftBestimmen(kontext);
  const gruende = [...herkunft.gruende];
  const { commit } = herkunft;
  if (commit !== null) {
    ausgabe.melde("kandidat", { commit });
    gruende.push(...(await commitPruefen(github, commit)));
  }
  const { produktion, frischGeweckt, gruende: weckGruende } = await produktionMessen(kontext);
  gruende.push(...weckGruende);
  if (produktion === null) gruende.push(grund("rot_produktion_unbekannt"));
  else ausgabe.melde("produktion", { commit: produktion });
  const basis = { gruende, commit, produktion, frischGeweckt };
  if (commit === null || produktion === null) return { ...basis, hand: false };
  const lage = await gegenProduktion(github, { commit, produktion });
  gruende.push(...lage.gruende);
  return { ...basis, hand: herkunft.hand, identisch: lage.identisch === true };
}

function abgleichGueltig(ergebnis) {
  return (
    typeof ergebnis?.geaendert === "boolean" &&
    Array.isArray(ergebnis.teile) &&
    ergebnis.teile.length <= HOECHSTENS_TEILE &&
    ergebnis.teile.every((teil) => typeof teil === "string" && TEIL_MUSTER.test(teil))
  );
}

async function gespraechPruefen({ vergleichen, einstellungen, ausgabe }, lage) {
  let ergebnis = null;
  try {
    const rahmen = { repoDir: einstellungen.repoDir, alt: lage.produktion, neu: lage.commit };
    ergebnis = await vergleichen(rahmen);
  } catch {
    ergebnis = null;
  }
  if (!abgleichGueltig(ergebnis)) {
    ausgabe.melde("gespraech_fehler");
    return { geaendert: true, teile: [ABGLEICH_GESCHEITERT] };
  }
  ausgabe.melde("gespraech", { ok: ergebnis.geaendert });
  if (!ergebnis.geaendert) return { geaendert: false, teile: [] };
  for (const teil of ergebnis.teile) ausgabe.melde("gespraech_teil", { teil });
  return { geaendert: true, teile: [...ergebnis.teile] };
}

async function beschliessen(kontext, lage) {
  const { ausgabe } = kontext;
  const nichts = { deploy: false, hoertest: false, teile: [] };
  if (lage.gruende.length > 0) {
    for (const { schluessel, werte } of lage.gruende) ausgabe.melde(schluessel, werte);
    return { ok: false, ...nichts };
  }
  if (lage.identisch) {
    ausgabe.melde("identisch");
    return { ok: true, ...nichts };
  }
  const gespraech = await gespraechPruefen(kontext, lage);
  if (!gespraech.geaendert) return { ok: true, deploy: true, hoertest: false, teile: [] };
  if (lage.hand) {
    ausgabe.melde("hoertest_bestaetigt");
    return { ok: true, deploy: true, hoertest: false, teile: gespraech.teile };
  }
  return { ok: true, deploy: false, hoertest: true, teile: gespraech.teile };
}

export async function entscheiden({
  einstellungen,
  ereignis,
  ausgabe,
  vergleichen = abdruckVergleichen,
  uhr = ECHTE_UHR,
  takte = AUFWACHEN_TAKTE,
}) {
  const github = githubZugang(einstellungen);
  const hermes = hermesZugang(einstellungen.produktionUrl);
  if ([LAUF, HAND].includes(ereignis.name)) ausgabe.melde("ereignis", { ereignis: ereignis.name });
  const kontext = { einstellungen, ereignis, ausgabe, vergleichen, github, hermes, uhr, takte };
  const lage = await lageErmitteln(kontext);
  const beschluss = await beschliessen(kontext, lage);
  ausgabe.melde("entscheidung", { deploy: beschluss.deploy, hoertest: beschluss.hoertest });
  const ergebnis = {
    ...beschluss,
    commit: lage.commit,
    produktion: lage.produktion,
    frischGeweckt: lage.frischGeweckt,
  };
  if (einstellungen.ausgabeDatei !== null) {
    ausgabenSchreiben(einstellungen.ausgabeDatei, {
      deploy: ergebnis.deploy,
      hoertest: ergebnis.hoertest,
      commit: ergebnis.commit ?? "",
      produktion: ergebnis.produktion ?? "",
      teile: ergebnis.teile.join(","),
      frisch_geweckt: ergebnis.frischGeweckt,
    });
  }
  return ergebnis;
}
