import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import { setTimeout as warte } from "node:timers/promises";

import { gleichwertigZeile } from "../auftrag/gleichwertig.mjs";
import { REMOTE } from "../auftrag/sperren.mjs";
import { neuerTempOrdner } from "../temp-ordner.mjs";
import { gh, ghRepo, LAUF_FERTIG } from "./gh.mjs";

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
const HOECHSTZEIT_MS = 7_200_000;
const SUCHABSTAND_MS = 10_000;
const SUCHVERSUCHE = 3;
const SUCHLISTE = "5";
const LAUF_URL = /\/actions\/runs\/(\d+)/;
const ABBRUCHZEILE = /(Abbruch: .*)$/;
const TEIL_JOB = /^Mutationsprüfung \d+$/;
const TEIL_GESCHEITERT = new Set(["failure", "cancelled", "timed_out"]);
const NACHRICHT = ["Mutationsprüfung auf Abruf", "", "Auftrag: lauf/in-ci"];
const GEMELDET = "in lauf gemeldet";
const NUR_COMMIT = "^{commit}";
const KEIN_SCHREIBRECHT = /Permission to \S+ denied|returned error: 403|Authentication failed|could not read Username|terminal prompts disabled|Repository not found|does not appear to be a git repository|\[remote rejected\] \S+ -> \S+ \((?:permission denied|[\w -]*hook declined)\)/;
const ZEILENUMBRUCH = /\n/g;
const NUR_LAUF_MUTATION = { GIT_TERMINAL_PROMPT: "0", HERMES_PUSH_LAUF_MUTATION: "1" };

function git(argumente, root, umgebung = env) {
  const lauf = spawnSync("git", argumente, { cwd: root, encoding: "utf8", env: umgebung });
  if (lauf.status === EXIT_GRUEN) return lauf.stdout.trim();
  throw new Error(`git ${argumente.join(" ")} endete mit Exit ${lauf.status}: ${String(lauf.stderr ?? "").trim()}`);
}

function nachricht(gleichwertige) {
  return [...NACHRICHT, ...gleichwertige.map((mutant) => gleichwertigZeile(mutant, GEMELDET)), ""].join("\n");
}

function friereEin(root, gleichwertige) {
  const ordner = neuerTempOrdner();
  const eigenerIndex = { ...env, GIT_INDEX_FILE: join(ordner, "index") };
  git(["read-tree", "HEAD"], root, eigenerIndex);
  git(["add", "-A"], root, eigenerIndex);
  const baum = git(["write-tree"], root, eigenerIndex);
  const datei = join(ordner, "nachricht");
  writeFileSync(datei, nachricht(gleichwertige));
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

function loeseAus({ repo, zweig, basis, alterStand }, suchabstandMs) {
  const seit = Math.floor(Date.now() / MS_JE_SEKUNDE) * MS_JE_SEKUNDE;
  const schalter = alterStand ? ["-f", "alter_stand=true"] : [];
  const ausgabe = gh(["workflow", "run", WORKFLOW, "-R", repo, "--ref", zweig, "-f", `basis=${basis}`, ...schalter]);
  const treffer = LAUF_URL.exec(ausgabe);
  return treffer ? treffer[1] : sucheLauf({ repo, zweig, seit }, suchabstandMs);
}

function gescheiterterTeil(stand) {
  return (stand.jobs ?? []).find(({ name, status, conclusion }) => TEIL_JOB.test(name) && status === LAUF_FERTIG && TEIL_GESCHEITERT.has(conclusion));
}

async function warteAufLauf(repo, lauf, frist) {
  const stand = JSON.parse(gh(["run", "view", lauf, "-R", repo, "--json", "status,conclusion,jobs"]));
  if (stand.status === LAUF_FERTIG) return stand;
  const gescheitert = gescheiterterTeil(stand);
  if (gescheitert !== undefined) return { ...stand, gescheitert };
  if (Date.now() >= frist.ende) return stand;
  await warte(frist.taktMs);
  return warteAufLauf(repo, lauf, frist);
}

function abgelegtesUrteil(repo, lauf) {
  const ordner = neuerTempOrdner();
  try {
    gh(["run", "download", lauf, "-R", repo, "-n", ARTEFAKT, "-D", ordner]);
  } catch {
    return null;
  }
  const [ausgabe, exitDatei] = [join(ordner, AUSGABE), join(ordner, EXIT_DATEI)];
  if (!existsSync(ausgabe) || !existsSync(exitDatei)) return null;
  const exitCode = readFileSync(exitDatei, "utf8").trim();
  return URTEILE.has(exitCode) ? { exitCode: Number(exitCode), ausgabe: readFileSync(ausgabe, "utf8").trimEnd() } : null;
}

function abbruchAus(ausgabe) {
  return ausgabe.split("\n").flatMap((zeile) => ABBRUCHZEILE.exec(zeile)?.slice(1) ?? []);
}

function abbruchZeilen(repo, lauf) {
  try {
    return abbruchAus(gh(["run", "view", lauf, "-R", repo, "--log-failed"]));
  } catch {
    return [];
  }
}

function abbruchZeilenDesTeils(repo, teil) {
  try {
    return abbruchAus(gh(["api", `repos/${repo}/actions/jobs/${teil.databaseId}/logs`]));
  } catch {
    return [];
  }
}

function brecheLaufAb(repo, lauf) {
  try {
    gh(["run", "cancel", lauf, "-R", repo]);
    return [];
  } catch (fehler) {
    return [`Hinweis: Lauf ${lauf} nicht abgebrochen: ${fehler.message}`];
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
  const stand = await warteAufLauf(repo, lauf, { taktMs: zeiten.taktMs, ende: Date.now() + zeiten.hoechstMs });
  const kopfzeile = `Mutationsprüfung in der CI: Lauf ${url}, ${kopf}`;
  if (stand.gescheitert !== undefined) {
    const { name, conclusion } = stand.gescheitert;
    const hinweis = brecheLaufAb(repo, lauf);
    const abgebrochen = hinweis.length === 0 ? ", Rest des Laufs abgebrochen" : "";
    const vorzeitig = `Abbruch: Mutationsprüfung in der CI ohne Urteil: Lauf ${url} (${name}: ${conclusion}${abgebrochen})`;
    return { exitCode: EXIT_ABBRUCH, zeilen: [kopfzeile, vorzeitig, ...abbruchZeilenDesTeils(repo, stand.gescheitert), ...hinweis] };
  }
  const urteil = stand.status === LAUF_FERTIG ? abgelegtesUrteil(repo, lauf) : null;
  if (urteil) return { exitCode: urteil.exitCode, zeilen: [kopfzeile, urteil.ausgabe] };
  const ohneUrteil = `Abbruch: Mutationsprüfung in der CI ohne Urteil: Lauf ${url} (${stand.status}, ${stand.conclusion})`;
  return { exitCode: EXIT_ABBRUCH, zeilen: [kopfzeile, ohneUrteil, ...abbruchZeilen(repo, lauf)] };
}

export async function mutationInCi({ root, basis, alterStand, gleichwertige }, { taktMs = TAKT_MS, hoechstMs = HOECHSTZEIT_MS, suchabstandMs = SUCHABSTAND_MS } = {}) {
  const volleBasis = git(["rev-parse", "--verify", basis + NUR_COMMIT], root);
  const stand = friereEin(root, gleichwertige);
  const zweig = `${WEGWERF_ZWEIG}${stand.slice(0, KURZ)}`;
  const abgelehnt = abgelehnterPush(root, stand, zweig);
  if (abgelehnt !== null) return { lokal: `Hinweis: Mutationsprüfung läuft lokal, weil der Push nach ${REMOTE} abgelehnt wurde: ${abgelehnt}` };
  const repo = ghRepo();
  try {
    const kopf = `Stand ${stand.slice(0, KURZ)}, Basis ${volleBasis.slice(0, KURZ)}`;
    return await urteilAusLauf({ repo, zweig, basis: volleBasis, alterStand }, kopf, { taktMs, hoechstMs, suchabstandMs });
  } finally {
    loescheZweig(repo, zweig);
  }
}
