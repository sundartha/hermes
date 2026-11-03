import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { env } from "node:process";
import { setTimeout as warte } from "node:timers/promises";

import { gemeinsamerOrdner } from "../auftrag/git.mjs";
import { FORTSCHRITT_DATEI, schreibeFortschritt } from "../auftrag/fortschritt.mjs";
import { gleichwertigZeile } from "../auftrag/gleichwertig.mjs";
import { REMOTE } from "../auftrag/sperren.mjs";
import { neuerTempOrdner } from "../temp-ordner.mjs";
import { gh, ghRepo, LAUF_FERTIG, loescheWegwerfZweig, loeseWorkflowAus } from "./gh.mjs";
import { LOKAL_STATT_CI_ANFANG, NUR_INFRASTRUKTUR_ZEILE, nurInfrastrukturGescheitert } from "./lauf-einordnung.mjs";
import { festlegenderTeil, teilStand } from "./lauf-teile.mjs";
import { ghMitWiederholung, stoerungsfilter } from "./stoerung.mjs";

const WEGWERF_ZWEIG = "lauf-mutation/";
const KURZ = 12;
const WORKFLOW = "ci.yml";
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
const FORTSCHRITT_MINUTEN = 2;
const FORTSCHRITT_MS = FORTSCHRITT_MINUTEN * MS_JE_MINUTE;
const TEILE_ABSTAND_MS = MS_JE_MINUTE;
const LAUF_ROT = "failure";
const SUCHVERSUCHE = 3;
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
const OHNE_ANMELDEABFRAGE = { GIT_TERMINAL_PROMPT: "0" };

function git(argumente, root, umgebung = env) {
  const lauf = spawnSync("git", argumente, { cwd: root, encoding: "utf8", env: umgebung });
  if (lauf.status === EXIT_GRUEN) return lauf.stdout.trim();
  throw new Error(`git ${argumente.join(" ")} endete mit Exit ${lauf.status}: ${String(lauf.stderr ?? "").trim()}`);
}

function nachricht({ gleichwertige, alterSchutz }, vorlauf) {
  const vorlaufZeile = vorlauf === null ? [] : [`Vorlauf: ${vorlauf}`];
  const schutzZeilen = alterSchutz.map((angabe) => `Alter Schutz: ${angabe}, weil ${GEMELDET}`);
  return [...NACHRICHT, ...vorlaufZeile, ...gleichwertige.map((mutant) => gleichwertigZeile(mutant, GEMELDET)), ...schutzZeilen, ""].join("\n");
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

function friereEin(root, meldungen, vorlauf) {
  const ordner = neuerTempOrdner();
  const eigenerIndex = { ...env, GIT_INDEX_FILE: join(ordner, "index") };
  git(["read-tree", "HEAD"], root, eigenerIndex);
  git(["add", "-A"], root, eigenerIndex);
  const baum = git(["write-tree"], root, eigenerIndex);
  const datei = join(ordner, "nachricht");
  writeFileSync(datei, nachricht(meldungen, vorlauf));
  return git(["commit-tree", baum, "-p", "HEAD", "-F", datei], root);
}

export function ohneSchreibrecht(meldung) {
  return KEIN_SCHREIBRECHT.test(meldung);
}

function abgelehnterPush(root, stand, zweig) {
  const lauf = spawnSync("git", ["push", REMOTE, `${stand}:refs/heads/${zweig}`], { cwd: root, encoding: "utf8", env: { ...env, ...OHNE_ANMELDEABFRAGE } });
  if (lauf.status === EXIT_GRUEN) return null;
  const meldung = String(lauf.stderr ?? "").trim().replace(ZEILENUMBRUCH, " / ");
  if (ohneSchreibrecht(meldung)) return meldung;
  throw new Error(`git push nach ${REMOTE} endete mit Exit ${lauf.status} ohne Hinweis auf fehlendes Schreibrecht: ${meldung}`);
}

function plaetzeSchalter() {
  const plaetze = env[PLAETZE_VARIABLE];
  if (plaetze === undefined || plaetze === "") return {};
  if (!PLAETZE_MUSTER.test(plaetze)) throw new Error(`${PLAETZE_VARIABLE} muss eine positive ganze Zahl bis 999 sein, ist aber ${plaetze}`);
  return { plaetze };
}

function loeseAus({ repo, zweig, basis, alterStand, testumbau, plaetze }, suchabstandMs) {
  const eingaben = { basis, ...(alterStand ? { alter_stand: true } : {}), ...(testumbau ? { testumbau: true } : {}), ...plaetze };
  return loeseWorkflowAus({ repo, workflow: WORKFLOW, ref: zweig, eingaben }, { suchabstandMs, suchversuche: SUCHVERSUCHE });
}

function logZeile(zeile) {
  schreibeFortschritt(zeile, env[FORTSCHRITT_DATEI]);
}

function standMelder(url, beginn) {
  let zuletzt = null;
  return ({ status, conclusion, attempt }, jetzt) => {
    const kennung = JSON.stringify([status, conclusion, attempt]);
    if (kennung === zuletzt) return;
    zuletzt = kennung;
    const ergebnis = conclusion ? `, ${conclusion}` : "";
    logZeile(`CI-Lauf ${url}: ${status}${ergebnis}, Versuch ${attempt ?? 1}, nach ${Math.round((jetzt - beginn) / MS_JE_MINUTE)} min`);
  };
}

function fortschrittsMelder({ lauf, url, beginn, abstandMs }) {
  let naechste = beginn;
  return ({ gesamt, gruen, uebersprungen, laufend, wartend, rot }, jetzt) => {
    if (jetzt < naechste) return;
    naechste = jetzt + abstandMs;
    logZeile(`Fortschritt: Lauf ${lauf} (${url}), ${Math.round((jetzt - beginn) / MS_JE_MINUTE)} min seit Start: ${gruen} von ${gesamt} Teilen grün, ${uebersprungen} übersprungen, ${laufend} laufend, ${wartend} wartend, ${rot} rot`);
  };
}

async function teileLesen(repo, lauf, frist) {
  try {
    const { jobs } = JSON.parse(await ghMitWiederholung(["run", "view", lauf, "-R", repo, "--json", "jobs"], frist));
    return Array.isArray(jobs) ? jobs : null;
  } catch (fehler) {
    logZeile(`Hinweis: Jobs von Lauf ${lauf} nicht gelesen: ${fehler.message}`);
    return null;
  }
}

function brichAb(repo, lauf, teil) {
  try {
    gh(["run", "cancel", lauf, "-R", repo]);
    return teil.name;
  } catch (fehler) {
    logZeile(`Hinweis: Lauf ${lauf} nicht abgebrochen, es wird auf den ganzen Lauf gewartet: ${fehler.message}`);
    return null;
  }
}

function teileBeobachter({ repo, lauf, beginn, zeiten }, wiederholung) {
  const zustand = { naechste: beginn + zeiten.teileAbstandMs, versucht: false, festgelegt: null };
  async function beobachte(jetzt) {
    if (jetzt < zustand.naechste) return;
    zustand.naechste = jetzt + zeiten.teileAbstandMs;
    const jobs = await teileLesen(repo, lauf, wiederholung);
    if (jobs === null) return;
    zeiten.fortschritt(teilStand(jobs), jetzt);
    const teil = zustand.versucht ? null : festlegenderTeil(jobs);
    if (teil === null) return;
    logZeile(`Das Urteil steht fest: ${teil.name} ist außerhalb der Infrastruktur gescheitert, der Job Mutationsurteil läuft nie; der Lauf wird abgebrochen.`);
    zustand.versucht = true;
    zustand.festgelegt = brichAb(repo, lauf, teil);
  }
  return { beobachte, festgelegt: () => zustand.festgelegt };
}

async function warteAufLauf(repo, lauf, frist) {
  const stand = JSON.parse(await ghMitWiederholung(["run", "view", lauf, "-R", repo, "--json", "status,conclusion,attempt"], frist));
  const jetzt = Date.now();
  frist.melde(stand, jetzt);
  if ((stand.status === LAUF_FERTIG && (stand.attempt ?? frist.ab) >= frist.ab) || jetzt >= frist.ende) return stand;
  if (stand.status !== LAUF_FERTIG) await frist.beobachte(jetzt);
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

async function nurInfrastruktur(repo, lauf, { stand, frist }) {
  if (stand.status !== LAUF_FERTIG || stand.conclusion !== LAUF_ROT) return false;
  const jobs = await teileLesen(repo, lauf, frist);
  return jobs !== null && nurInfrastrukturGescheitert(jobs);
}

function startetNeu(repo, lauf) {
  try {
    gh(["run", "rerun", lauf, "-R", repo, "--failed"]);
    return true;
  } catch (fehler) {
    console.error(`Hinweis: Lauf ${lauf} nicht neu gestartet: ${fehler.message}`);
    return false;
  }
}

async function standMitUrteil(repo, lauf, { zeiten, darfNeustart, ab }) {
  const beginn = Date.now();
  const wiederholung = { taktMs: zeiten.taktMs, laessig: stoerungsfilter({ beginn, anfangMs: zeiten.anfangMs }) };
  const beobachter = teileBeobachter({ repo, lauf, beginn, zeiten }, wiederholung);
  const frist = { ...wiederholung, ende: zeiten.ende, ab, melde: zeiten.melde, beobachte: beobachter.beobachte };
  const stand = await warteAufLauf(repo, lauf, frist);
  const festgelegt = beobachter.festgelegt();
  const urteil = stand.status === LAUF_FERTIG && festgelegt === null ? await abgelegtesUrteil(repo, lauf, frist) : null;
  const infrastruktur = urteil === null && festgelegt === null && (await nurInfrastruktur(repo, lauf, { stand, frist }));
  if (infrastruktur && darfNeustart && startetNeu(repo, lauf)) {
    return standMitUrteil(repo, lauf, { zeiten, darfNeustart: false, ab: (stand.attempt ?? ab) + 1 });
  }
  return { stand, urteil, infrastruktur, festgelegt };
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

function ohneUrteilZeilen({ url, stand, festgelegt, infrastruktur }, beginn) {
  const ohneUrteil = `Abbruch: Mutationsprüfung in der CI ohne Urteil: Lauf ${url} (${stand.status}, ${stand.conclusion})`;
  if (festgelegt !== null) return [`${ohneUrteil}; ${festgelegt} ist außerhalb der Infrastruktur gescheitert, das Urteil stand nach ${Math.round((Date.now() - beginn) / MS_JE_MINUTE)} min fest, der Lauf wurde abgebrochen, ohne auf die übrigen Teile zu warten`];
  return infrastruktur ? [ohneUrteil, NUR_INFRASTRUKTUR_ZEILE] : [ohneUrteil];
}

async function urteilAusLauf(abruf, kopf, zeiten) {
  const { repo } = abruf;
  const lauf = await loeseAus(abruf, zeiten.suchabstandMs);
  const url = `https://github.com/${repo}/actions/runs/${lauf}`;
  const beginn = Date.now();
  logZeile(`CI-Lauf gestartet: ${url}; Stand alle ${Math.round(zeiten.taktMs / MS_JE_SEKUNDE)} s, höchstens ${Math.round(zeiten.hoechstMs / MS_JE_MINUTE)} min, eine Zeile bei jedem Wechsel des Stands, alle ${Math.round(zeiten.fortschrittMs / MS_JE_MINUTE)} min ein Fortschritt der Teile.`);
  const melder = { melde: standMelder(url, beginn), fortschritt: fortschrittsMelder({ lauf, url, beginn, abstandMs: zeiten.fortschrittMs }) };
  const ergebnis = await standMitUrteil(repo, lauf, { zeiten: { ...zeiten, ende: beginn + zeiten.hoechstMs, ...melder }, darfNeustart: true, ab: 1 });
  const kopfzeile = `Mutationsprüfung in der CI: Lauf ${url}, ${kopf}`;
  if (ergebnis.urteil) {
    merkeVorlauf(abruf, lauf);
    return { exitCode: ergebnis.urteil.exitCode, zeilen: [kopfzeile, ergebnis.urteil.ausgabe] };
  }
  return { exitCode: EXIT_ABBRUCH, zeilen: [kopfzeile, ...ohneUrteilZeilen({ url, ...ergebnis }, beginn), ...abbruchZeilen(repo, lauf)] };
}

export async function mutationInCi({ root, basis, alterStand, testumbau, gleichwertige, alterSchutz = [] }, { taktMs = TAKT_MS, hoechstMs = HOECHSTZEIT_MS, suchabstandMs = SUCHABSTAND_MS, anfangMs = ANFANG_MS, fortschrittMs = FORTSCHRITT_MS, teileAbstandMs = TEILE_ABSTAND_MS } = {}) {
  const volleBasis = git(["rev-parse", "--verify", basis + NUR_COMMIT], root);
  const plaetze = plaetzeSchalter();
  const stand = friereEin(root, { gleichwertige, alterSchutz }, gemerkterVorlauf(root, vorlaufArt({ alterStand, testumbau })));
  const zweig = `${WEGWERF_ZWEIG}${stand.slice(0, KURZ)}`;
  const abgelehnt = abgelehnterPush(root, stand, zweig);
  if (abgelehnt !== null) return { lokal: `${LOKAL_STATT_CI_ANFANG} nach ${REMOTE} abgelehnt wurde: ${abgelehnt}` };
  const repo = ghRepo();
  try {
    const kopf = `Stand ${stand.slice(0, KURZ)}, Basis ${volleBasis.slice(0, KURZ)}`;
    return await urteilAusLauf({ repo, zweig, basis: volleBasis, alterStand, testumbau, root, plaetze }, kopf, { taktMs, hoechstMs, suchabstandMs, anfangMs, fortschrittMs, teileAbstandMs });
  } finally {
    loescheWegwerfZweig(repo, zweig);
  }
}
