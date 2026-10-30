import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { env } from "node:process";
import { setTimeout as warte } from "node:timers/promises";

import { gemeinsamerOrdner } from "../auftrag/git.mjs";
import { gleichwertigZeile } from "../auftrag/gleichwertig.mjs";
import { REMOTE } from "../auftrag/sperren.mjs";
import { neuerTempOrdner } from "../temp-ordner.mjs";
import { gh, ghRepo, LAUF_FERTIG } from "./gh.mjs";
import { nurInfrastrukturGescheitert } from "./lauf-einordnung.mjs";
import { ghMitWiederholung, stoerungsfilter } from "./stoerung.mjs";

const WEGWERF_ZWEIG = "lauf-mutation/";
const KURZ = 12;
const WORKFLOW = "ci.yml";
const ABRUF = "workflow_dispatch";
const ARTEFAKT = "mutationsurteil";
const AUSGABE = "ausgabe.txt";
const EXIT_DATEI = "exit-code";
const URTEILE = new Set(["0", "1", "2"]);
const EXIT_GRUEN = 0;
const EXIT_ABBRUCH = 2;
const MS_JE_SEKUNDE = 1000;
const MS_JE_MINUTE = 60_000;
const TAKT_MS = MS_JE_MINUTE;
const HOECHSTZEIT_MINUTEN = 480;
const HOECHSTZEIT_MS = HOECHSTZEIT_MINUTEN * MS_JE_MINUTE;
const SUCHABSTAND_MS = 10_000;
const ANFANG_MINUTEN = 5;
const ANFANG_MS = ANFANG_MINUTEN * MS_JE_MINUTE;
const LAUF_ROT = "failure";
const SUCHVERSUCHE = 3;
const SUCHLISTE = "5";
const LAUF_URL = /\/actions\/runs\/(\d+)/;
const LAUFNUMMER = /^[1-9]\d*$/;
const VORLAUF_ABLAGE = join("hermes", "mutation-vorlauf");
const ABBRUCHZEILE = /(Abbruch: .*)$/;
const NACHRICHT = ["Mutationsprüfung auf Abruf", "", "Auftrag: lauf/in-ci"];
const GEMELDET = "in lauf gemeldet";
const NUR_COMMIT = "^{commit}";
const KEIN_SCHREIBRECHT = /Permission to \S+ denied|returned error: 403|Authentication failed|could not read Username|terminal prompts disabled|Repository not found|does not appear to be a git repository|\[remote rejected\] \S+ -> \S+ \((?:permission denied|[\w -]*hook declined)\)/;
const ZEILENUMBRUCH = /\n/g;
const PLAETZE_VARIABLE = "HERMES_MUTATION_PLAETZE";
const PLAETZE_MUSTER = /^[1-9]\d{0,2}$/;
const NUR_LAUF_MUTATION = { GIT_TERMINAL_PROMPT: "0", HERMES_PUSH_LAUF_MUTATION: "1" };

function git(argumente, root, umgebung = env) {
  const lauf = spawnSync("git", argumente, { cwd: root, encoding: "utf8", env: umgebung });
  if (lauf.status === EXIT_GRUEN) return lauf.stdout.trim();
  throw new Error(`git ${argumente.join(" ")} endete mit Exit ${lauf.status}: ${String(lauf.stderr ?? "").trim()}`);
}

function nachricht(gleichwertige, vorlauf) {
  const vorlaufZeile = vorlauf === null ? [] : [`Vorlauf: ${vorlauf}`];
  return [...NACHRICHT, ...vorlaufZeile, ...gleichwertige.map((mutant) => gleichwertigZeile(mutant, GEMELDET)), ""].join("\n");
}

function vorlaufDatei(root, art) {
  const kennung = createHash("sha256").update(root).digest("hex").slice(0, KURZ);
  return gemeinsamerOrdner(root, VORLAUF_ABLAGE, `${art}-${kennung}.json`);
}

function vorlaufArt({ alterStand, testumbau }) {
  if (alterStand) return "alt";
  return testumbau ? "testumbau" : "neu";
}

function gemerkterVorlauf(root, art) {
  try {
    const lauf = JSON.parse(readFileSync(vorlaufDatei(root, art), "utf8")).lauf;
    return LAUFNUMMER.test(String(lauf)) ? String(lauf) : null;
  } catch {
    return null;
  }
}

function merkeVorlauf({ root, ...art }, lauf) {
  try {
    const datei = vorlaufDatei(root, vorlaufArt(art));
    mkdirSync(dirname(datei), { recursive: true });
    writeFileSync(datei, JSON.stringify({ lauf }) + "\n");
  } catch (fehler) {
    console.error(`Hinweis: Vorlauf ${lauf} nicht gemerkt: ${fehler.message}`);
  }
}

function friereEin(root, gleichwertige, vorlauf) {
  const ordner = neuerTempOrdner();
  const eigenerIndex = { ...env, GIT_INDEX_FILE: join(ordner, "index") };
  git(["read-tree", "HEAD"], root, eigenerIndex);
  git(["add", "-A"], root, eigenerIndex);
  const baum = git(["write-tree"], root, eigenerIndex);
  const datei = join(ordner, "nachricht");
  writeFileSync(datei, nachricht(gleichwertige, vorlauf));
  return git(["commit-tree", baum, "-p", "HEAD", "-F", datei], root);
}

export function ohneSchreibrecht(meldung) {
  return KEIN_SCHREIBRECHT.test(meldung);
}

function abgelehnterPush(root, stand, zweig) {
  const lauf = spawnSync("git", ["push", REMOTE, `${stand}:refs/heads/${zweig}`], { cwd: root, encoding: "utf8", env: { ...env, ...NUR_LAUF_MUTATION } });
  if (lauf.status === EXIT_GRUEN) return null;
  const meldung = String(lauf.stderr ?? "").trim().replace(ZEILENUMBRUCH, " / ");
  if (ohneSchreibrecht(meldung)) return meldung;
  throw new Error(`git push nach ${REMOTE} endete mit Exit ${lauf.status} ohne Hinweis auf fehlendes Schreibrecht: ${meldung}`);
}

async function sucheLauf(suche, suchabstandMs, versuch = 1) {
  await warte(suchabstandMs);
  const { repo, zweig, seit } = suche;
  const laeufe = JSON.parse(gh(["run", "list", "-R", repo, "-w", WORKFLOW, "-b", zweig, "-e", ABRUF, "--json", "databaseId,createdAt", "-L", SUCHLISTE]));
  const neu = laeufe.filter(({ createdAt }) => Date.parse(createdAt) >= seit).sort((frueher, spaeter) => Date.parse(spaeter.createdAt) - Date.parse(frueher.createdAt));
  if (neu.length > 0) return String(neu[0].databaseId);
  if (versuch >= SUCHVERSUCHE) throw new Error(`kein Lauf von ${WORKFLOW} auf ${zweig} nach ${SUCHVERSUCHE} Suchen gefunden`);
  return sucheLauf(suche, suchabstandMs, versuch + 1);
}

function plaetzeSchalter() {
  const plaetze = env[PLAETZE_VARIABLE];
  if (plaetze === undefined || plaetze === "") return [];
  if (!PLAETZE_MUSTER.test(plaetze)) throw new Error(`${PLAETZE_VARIABLE} muss eine positive ganze Zahl bis 999 sein, ist aber ${plaetze}`);
  return ["-f", `plaetze=${plaetze}`];
}

function loeseAus({ repo, zweig, basis, alterStand, testumbau, plaetze }, suchabstandMs) {
  const seit = Math.floor(Date.now() / MS_JE_SEKUNDE) * MS_JE_SEKUNDE;
  const schalter = [...(alterStand ? ["-f", "alter_stand=true"] : []), ...(testumbau ? ["-f", "testumbau=true"] : [])];
  const ausgabe = gh(["workflow", "run", WORKFLOW, "-R", repo, "--ref", zweig, "-f", `basis=${basis}`, ...schalter, ...plaetze]);
  const treffer = LAUF_URL.exec(ausgabe);
  return treffer ? treffer[1] : sucheLauf({ repo, zweig, seit }, suchabstandMs);
}

async function warteAufLauf(repo, lauf, frist) {
  const stand = JSON.parse(await ghMitWiederholung(["run", "view", lauf, "-R", repo, "--json", "status,conclusion,attempt"], frist));
  if ((stand.status === LAUF_FERTIG && (stand.attempt ?? frist.ab) >= frist.ab) || Date.now() >= frist.ende) return stand;
  await warte(frist.taktMs);
  return warteAufLauf(repo, lauf, frist);
}

async function abgelegtesUrteil(repo, lauf, frist) {
  const ordner = neuerTempOrdner();
  try {
    await ghMitWiederholung(["run", "download", lauf, "-R", repo, "-n", ARTEFAKT, "-D", ordner], frist);
  } catch {
    return null;
  }
  const [ausgabe, exitDatei] = [join(ordner, AUSGABE), join(ordner, EXIT_DATEI)];
  if (!existsSync(ausgabe) || !existsSync(exitDatei)) return null;
  const exitCode = readFileSync(exitDatei, "utf8").trim();
  return URTEILE.has(exitCode) ? { exitCode: Number(exitCode), ausgabe: readFileSync(ausgabe, "utf8").trimEnd() } : null;
}

async function startetNeu(repo, lauf, { stand, frist }) {
  if (stand.status !== LAUF_FERTIG || stand.conclusion !== LAUF_ROT) return false;
  try {
    const { jobs } = JSON.parse(await ghMitWiederholung(["run", "view", lauf, "-R", repo, "--json", "jobs"], frist));
    if (!nurInfrastrukturGescheitert(jobs)) return false;
    gh(["run", "rerun", lauf, "-R", repo, "--failed"]);
    return true;
  } catch (fehler) {
    console.error(`Hinweis: Lauf ${lauf} nicht neu gestartet: ${fehler.message}`);
    return false;
  }
}

async function standMitUrteil(repo, lauf, { zeiten, darfNeustart, ab }) {
  const beginn = Date.now();
  const frist = { taktMs: zeiten.taktMs, laessig: stoerungsfilter({ beginn, anfangMs: zeiten.anfangMs }), ende: zeiten.ende, ab };
  const stand = await warteAufLauf(repo, lauf, frist);
  const urteil = stand.status === LAUF_FERTIG ? await abgelegtesUrteil(repo, lauf, frist) : null;
  if (urteil === null && darfNeustart && (await startetNeu(repo, lauf, { stand, frist }))) {
    return standMitUrteil(repo, lauf, { zeiten, darfNeustart: false, ab: (stand.attempt ?? ab) + 1 });
  }
  return { stand, urteil };
}

function abbruchZeilen(repo, lauf) {
  try {
    return gh(["run", "view", lauf, "-R", repo, "--log-failed"])
      .split("\n")
      .flatMap((zeile) => ABBRUCHZEILE.exec(zeile)?.slice(1) ?? []);
  } catch {
    return [];
  }
}

function loescheZweig(repo, zweig) {
  try {
    gh(["api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${zweig}`]);
  } catch (fehler) {
    console.error(`Hinweis: Wegwerf-Branch ${zweig} nicht gelöscht: ${fehler.message}`);
  }
}

async function urteilAusLauf(abruf, kopf, zeiten) {
  const { repo } = abruf;
  const lauf = await loeseAus(abruf, zeiten.suchabstandMs);
  const url = `https://github.com/${repo}/actions/runs/${lauf}`;
  const { stand, urteil } = await standMitUrteil(repo, lauf, { zeiten: { ...zeiten, ende: Date.now() + zeiten.hoechstMs }, darfNeustart: true, ab: 1 });
  const kopfzeile = `Mutationsprüfung in der CI: Lauf ${url}, ${kopf}`;
  if (urteil) {
    merkeVorlauf(abruf, lauf);
    return { exitCode: urteil.exitCode, zeilen: [kopfzeile, urteil.ausgabe] };
  }
  const ohneUrteil = `Abbruch: Mutationsprüfung in der CI ohne Urteil: Lauf ${url} (${stand.status}, ${stand.conclusion})`;
  return { exitCode: EXIT_ABBRUCH, zeilen: [kopfzeile, ohneUrteil, ...abbruchZeilen(repo, lauf)] };
}

export async function mutationInCi({ root, basis, alterStand, testumbau, gleichwertige }, { taktMs = TAKT_MS, hoechstMs = HOECHSTZEIT_MS, suchabstandMs = SUCHABSTAND_MS, anfangMs = ANFANG_MS } = {}) {
  const volleBasis = git(["rev-parse", "--verify", basis + NUR_COMMIT], root);
  const plaetze = plaetzeSchalter();
  const stand = friereEin(root, gleichwertige, gemerkterVorlauf(root, vorlaufArt({ alterStand, testumbau })));
  const zweig = `${WEGWERF_ZWEIG}${stand.slice(0, KURZ)}`;
  const abgelehnt = abgelehnterPush(root, stand, zweig);
  if (abgelehnt !== null) return { lokal: `Hinweis: Mutationsprüfung läuft lokal, weil der Push nach ${REMOTE} abgelehnt wurde: ${abgelehnt}` };
  const repo = ghRepo();
  try {
    const kopf = `Stand ${stand.slice(0, KURZ)}, Basis ${volleBasis.slice(0, KURZ)}`;
    return await urteilAusLauf({ repo, zweig, basis: volleBasis, alterStand, testumbau, root, plaetze }, kopf, { taktMs, hoechstMs, suchabstandMs, anfangMs });
  } finally {
    loescheZweig(repo, zweig);
  }
}
