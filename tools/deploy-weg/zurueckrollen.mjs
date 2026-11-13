import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "node:process";
import { promisify } from "node:util";

import { Abbruch, COMMIT_MUSTER, DEPLOY_ID } from "./ausgabe.mjs";
import { produktionAbwarten, statusBeobachter } from "./deploy.mjs";
import { notfallErlaubt } from "./herkunft.mjs";
import { nachkontrolleIssueSchreiben } from "./hoertest.mjs";
import { githubZugang, hermesZugang, renderZugang } from "./netz.mjs";
import { abwarten, DEPLOY_TAKTE, ECHTE_UHR } from "./takt.mjs";
import { skriptStarten } from "./staging.mjs";

const PROBE_PFAD = "scripts/probe-auth.sh";
const ANRUFPAUSE_PFAD = "src/routes/intern-anrufpause.js";
const programmLesen = promisify(execFile);

async function dateiAusCommit(repoDir, commit, pfad) {
  try {
    const { stdout } = await programmLesen("git", ["show", commit + ":" + pfad], {
      cwd: repoDir,
      env: { PATH: env.PATH ?? "" },
    });
    return stdout;
  } catch {
    return null;
  }
}

export async function zielKenntAnrufpause({ commit, repoDir }) {
  return (await dateiAusCommit(repoDir, commit, ANRUFPAUSE_PFAD)) !== null;
}

export async function zielProbeStarten({ url, commit, repoDir }) {
  const inhalt = await dateiAusCommit(repoDir, commit, PROBE_PFAD);
  if (inhalt === null) return null;
  const ordner = mkdtempSync(join(tmpdir(), "probe-auth-ziel-"));
  try {
    const pfad = join(ordner, "probe-auth.sh");
    writeFileSync(pfad, inhalt);
    return await skriptStarten(pfad, [url, commit]);
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

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
  const beobachter = statusBeobachter({ render, ausgabe }, { id });
  const ergebnis = await abwarten({ uhr, ...takte.status }, beobachter);
  if (ergebnis.schutzgrenze) {
    ausgabe.melde("schutzgrenze", { schritt: "deploy_status", minuten: ergebnis.minuten });
    return false;
  }
  const { live, endzustand } = ergebnis.wert;
  if (!live) ausgabe.melde("deploy_gescheitert", { status: endzustand });
  return live;
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

const UPDATE_AUTOR = "dependabot[bot]";
const UPDATE_BRANCH_PRAEFIX = "dependabot/";
const NODE_LABEL = "node-hauptversion";
const BASIS_BRANCH = "master";
const REVERT_PRAEFIX = "revert/";
const KURZ_SHA = 7;
const ELTERN_EINES_COMMITS = 2;
const ELTERN_EINES_MERGES = 3;
const GIT_KENNUNG = [
  "-c",
  "user.name=github-actions[bot]",
  "-c",
  "user.email=github-actions[bot]@users.noreply.github.com",
];

function istUpdatePr(pr) {
  return (
    pr.user?.login === UPDATE_AUTOR ||
    pr.head?.ref?.startsWith(UPDATE_BRANCH_PRAEFIX) === true ||
    (pr.labels ?? []).some((label) => label?.name === NODE_LABEL)
  );
}

async function updateDeploy(github, commit) {
  const { status, daten } = await github.lesen("/commits/" + commit + "/pulls");
  if (status !== HTTP_OK || !Array.isArray(daten)) throw new Abbruch("pr", status);
  return daten.some(
    (pr) =>
      Boolean(pr?.merged_at) &&
      pr.merge_commit_sha === commit &&
      pr.base?.ref === BASIS_BRANCH &&
      istUpdatePr(pr),
  );
}

async function produktionKontrollieren({ hermes, uhr, takte }, commit) {
  const beobachtet = { commit: null };
  const ergebnis = await abwarten({ uhr, ...takte.nachkontrolle }, async () => {
    beobachtet.commit = await hermes.commit();
    return beobachtet.commit === commit ? true : undefined;
  });
  if (!ergebnis.schutzgrenze) return { gut: true };
  const was =
    beobachtet.commit === null
      ? "/healthz antwortet nicht mit ok"
      : "Produktion fährt einen anderen Commit";
  return {
    gut: false,
    minuten: ergebnis.minuten,
    grund: "Nach " + ergebnis.minuten + " Minuten: " + was + ".",
  };
}

export async function revertPushen({ commit, branch, repoDir, remote, kopfzeile = null }) {
  const git = (argumente, zusatz = {}) =>
    programmLesen("git", argumente, { cwd: repoDir, env: { PATH: env.PATH ?? "", ...zusatz } });
  const { stdout } = await git(["rev-list", "--parents", "-n", "1", commit]);
  const kennungen = stdout.trim().split(" ");
  if (kennungen.length < ELTERN_EINES_COMMITS) throw new Error("kein Elternteil im Checkout");
  const hauptlinie = kennungen.length >= ELTERN_EINES_MERGES ? ["-m", "1"] : [];
  await git(["switch", "-c", branch]);
  await git([...GIT_KENNUNG, "revert", "--no-edit", ...hauptlinie, commit]);
  const anmeldung =
    kopfzeile === null
      ? {}
      : {
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: "http.extraHeader",
          GIT_CONFIG_VALUE_0: kopfzeile,
        };
  await git(["push", remote, "HEAD:refs/heads/" + branch], anmeldung);
}

function remoteBauen({ serverUrl, repository }) {
  return serverUrl + "/" + repository + ".git";
}

function kopfzeileBauen(updateToken) {
  const zugang = Buffer.from("x-access-token:" + updateToken).toString("base64");
  return { zugang, kopfzeile: "Authorization: Basic " + zugang };
}

async function offenerRevertPr(github, { branch, repository }) {
  const filter = new URLSearchParams({
    state: "open",
    head: repository.split("/")[0] + ":" + branch,
  });
  const { status, daten } = await github.lesen("/pulls?" + filter.toString());
  if (status !== HTTP_OK || !Array.isArray(daten)) throw new Abbruch("revert_pr", status);
  return daten.find((pr) => pr?.head?.ref === branch && Number.isInteger(pr.number)) ?? null;
}

async function revertPrAnlegen(github, { branch, commit, ausgabe }) {
  const koerper = {
    title: "Rücknahme des Update-Deploys " + commit.slice(0, KURZ_SHA),
    head: branch,
    base: BASIS_BRANCH,
    body:
      "Die Nachkontrolle nach dem Deploy von " +
      commit +
      " war rot. Dieser PR nimmt den Commit zurück. Er geht durch die normalen Pflicht-Checks und die normale Freigabe und wird nie automatisch gemergt.",
  };
  const { status, daten } = await github.senden({ methode: "POST", pfad: "/pulls", koerper });
  if (status !== HTTP_ANGELEGT || !Number.isInteger(daten?.number))
    throw new Abbruch("revert_pr", status);
  ausgabe.melde("revert_pr_angelegt", { nummer: daten.number });
  return daten.html_url;
}

async function revertAnlegen(kontext, commit) {
  const { einstellungen, ausgabe } = kontext;
  const github = githubZugang({ ...einstellungen, githubToken: einstellungen.updateToken });
  const branch = REVERT_PRAEFIX + commit.slice(0, KURZ_SHA);
  const vorhanden = await offenerRevertPr(github, { branch, repository: einstellungen.repository });
  if (vorhanden !== null) {
    ausgabe.melde("revert_pr_vorhanden", { nummer: vorhanden.number });
    return vorhanden.html_url;
  }
  const remote = remoteBauen(einstellungen);
  const { zugang, kopfzeile } = kopfzeileBauen(einstellungen.updateToken);
  ausgabe.maskiere([zugang]);
  const gebaut = await kontext
    .revertBauen({ commit, branch, repoDir: einstellungen.repoDir, remote, kopfzeile })
    .then(
      () => true,
      () => false,
    );
  if (!gebaut) {
    ausgabe.melde("revert_fehlgeschlagen");
    return null;
  }
  return revertPrAnlegen(github, { branch, commit, ausgabe });
}

async function revertVersuchen(kontext, commit) {
  if (kontext.einstellungen.updateToken !== null) return revertAnlegen(kontext, commit);
  kontext.ausgabe.melde("update_token_fehlt");
  return null;
}

export async function updateNachkontrolle({
  einstellungen,
  commit,
  ausgabe,
  uhr = ECHTE_UHR,
  takte = DEPLOY_TAKTE,
  revertBauen = revertPushen,
}) {
  if (!(await updateDeploy(githubZugang(einstellungen), commit))) {
    ausgabe.melde("nachkontrolle_kein_update");
    return true;
  }
  const hermes = hermesZugang(einstellungen.produktionUrl);
  const kontext = { einstellungen, ausgabe, hermes, uhr, takte, revertBauen };
  const kontrolle = await produktionKontrollieren(kontext, commit);
  if (kontrolle.gut) {
    ausgabe.melde("nachkontrolle_gut", { commit });
    return true;
  }
  ausgabe.melde("nachkontrolle_fehlgeschlagen", { commit, minuten: kontrolle.minuten });
  const revertUrl = await revertVersuchen(kontext, commit);
  const grund = kontrolle.grund;
  await nachkontrolleIssueSchreiben({ einstellungen, commit, grund, revertUrl, ausgabe });
  return revertUrl !== null;
}
