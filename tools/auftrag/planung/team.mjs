import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

import { starteAgentParallel } from "../agenten.mjs";
import { limitSperre, restDerSperre, setzeLimitSperre } from "../einsatz.mjs";
import { BELEGE } from "../bericht.mjs";
import { meldeNetzabbruch, netzabbruch } from "../netz.mjs";
import { DECKEL, STILLSTAND } from "../verlauf.mjs";
import { istObjekt } from "./erkundung.mjs";
import { gitLauf, gitPfadeAbfragen } from "./git.mjs";
import { DOKUMENTE } from "./schnitt.mjs";

const KOPF = /^---\n([\s\S]*?)\n---\n/;
const KOPF_FELD = /^(\w+):\s*(.*)$/gm;
const LEERE_LISTE = /^(""|''|\[\])$/;
const LISTEN_TRENNER = /\s*,\s*/;
const PLANUNG = "planung";
const PLANUNGSBERICHT = "planung.json";
const GIT_STEUERUNG = ["config", "config.worktree", "hooks", "info", "HEAD"];
const LEERER_KOPF = "ref: refs/heads/abdruck\n";
const ROHINHALT = "* -text -eol -ident -filter -working-tree-encoding\n";
const GIT_GRUEN = 0;
const GIT_OHNE_TREFFER = 1;
const ZWEIG_REF = "refs/heads/";
const ZWEIG_EINTRAG = /^branch\.(.+)\.[^.]+$/;
export const ANTWORT_OHNE_JSON = "Antwort ohne JSON-Block";
const OHNE = "ohne";
const FEHLERZEILEN = 5;
const ZERLEGUNG = /^Zerlegung passt nicht:.*$/m;
const PITCH_AENDERN = /^Pitch ändern:.*$/m;
const JSON_BLOCK = /```json[^\S\n]*\n([\s\S]*?)\n[^\S\n]*```/g;
const ERSTE_NETZ_WARTEZEIT_MS = 30_000;
const ZWEITE_NETZ_WARTEZEIT_MS = 120_000;
const NETZ_WARTEZEITEN_MS = [ERSTE_NETZ_WARTEZEIT_MS, ZWEITE_NETZ_WARTEZEIT_MS];

export class Abbruch extends Error {}

export class Deckelabbruch extends Error {}

function letzterJsonBlock(text) {
  const bloecke = [...text.matchAll(JSON_BLOCK)];
  if (bloecke.length === 0) return null;
  try {
    const wert = JSON.parse(bloecke.at(-1)[1]);
    return istObjekt(wert) ? wert : null;
  } catch {
    return null;
  }
}

export function liesAntwort(text) {
  const zerlegung = ZERLEGUNG.exec(text);
  if (zerlegung) return { art: "zerlegung", text: zerlegung[0].trim() };
  const pitch = PITCH_AENDERN.exec(text);
  if (pitch) return { art: "pitch", text: pitch[0].trim() };
  const wert = letzterJsonBlock(text);
  return wert === null ? { art: OHNE } : { art: "json", wert };
}

function kopfFelder(text, datei) {
  const kopf = KOPF.exec(text);
  if (kopf === null) throw new Error(`${datei} hat keinen Kopf zwischen ---`);
  const felder = Object.fromEntries([...kopf[1].matchAll(KOPF_FELD)].map(([, name, wert]) => [name, wert.trim()]));
  return { felder, rumpf: text.slice(kopf[0].length).trim() };
}

function werkzeuge(wert = "") {
  return LEERE_LISTE.test(wert) || wert === "" ? [] : wert.split(LISTEN_TRENNER);
}

function rollenKopf(root, rolle) {
  const datei = join(".claude/agents", `${rolle}.md`);
  return kopfFelder(readFileSync(join(root, datei), "utf8"), datei);
}

export function werkzeugeDerRolle(root, rolle) {
  return werkzeuge(rollenKopf(root, rolle).felder.tools);
}

export function rollenStart(root, rolle) {
  const { felder, rumpf } = rollenKopf(root, rolle);
  const tools = werkzeuge(felder.tools);
  const definition = { [rolle]: { description: felder.description, prompt: rumpf, tools, model: felder.model } };
  const argumente = [
    "--restricted",
    "--agents",
    JSON.stringify(definition),
    "--tools",
    tools.join(","),
    "--strict-mcp-config",
    "--effort",
    felder.effort,
    "--settings",
    `.claude/rollen/${rolle}.json`,
  ];
  return { agent: rolle, argumente };
}

function git(root, args, optionen) {
  return gitLauf(root, args, optionen).stdout;
}

function abgeschirmt(root, arbeit) {
  const verzeichnis = mkdtempSync(join(tmpdir(), "abdruck-"));
  try {
    const gitDir = join(verzeichnis, "git");
    mkdirSync(join(gitDir, "refs"), { recursive: true });
    mkdirSync(join(gitDir, "info"));
    writeFileSync(join(gitDir, "info/attributes"), ROHINHALT);
    writeFileSync(join(gitDir, "HEAD"), LEERER_KOPF);
    const pfade = gitPfadeAbfragen(root, ["objects", "index", ...GIT_STEUERUNG]);
    if (existsSync(join(pfade.info, "exclude"))) copyFileSync(join(pfade.info, "exclude"), join(gitDir, "info/exclude"));
    const umgebung = { GIT_DIR: gitDir, GIT_WORK_TREE: root, GIT_OBJECT_DIRECTORY: pfade.objects, GIT_INDEX_FILE: join(verzeichnis, "index") };
    return arbeit(umgebung, pfade);
  } finally {
    rmSync(verzeichnis, { recursive: true, force: true });
  }
}

function versionierteOhneStand(root, { umgebung, pfade }, ohnePlanung) {
  const eintraege = git(root, ["ls-files", "-z", "-s", ...ohnePlanung], { zusatz: { ...umgebung, GIT_INDEX_FILE: pfade.index } });
  git(root, ["update-index", "-z", "--index-info"], { zusatz: umgebung, eingabe: eintraege });
}

function arbeitsbaum(root, ordner, { umgebung, pfade }) {
  const ohnePlanung = ["--", ".", `:!${relative(root, resolve(root, ordner))}/${PLANUNG}`];
  versionierteOhneStand(root, { umgebung, pfade }, ohnePlanung);
  git(root, ["add", "-A", ...ohnePlanung], { zusatz: umgebung });
  const baum = git(root, ["write-tree"], { zusatz: umgebung }).trim();
  const ignoriert = git(root, ["ls-files", "-z", "-o", "-i", "--exclude-standard", ...ohnePlanung], { zusatz: umgebung }).split("\0").filter(Boolean);
  return { baum, ignoriert };
}

function ignorierteAbdruck(root, phase, ignoriert) {
  const bericht = join(BELEGE, phase, PLANUNGSBERICHT);
  return Object.fromEntries(ignoriert.filter((pfad) => pfad !== bericht).flatMap((pfad) => {
    const stand = lstatSync(join(root, pfad), { throwIfNoEntry: false });
    if (stand === undefined || stand.isDirectory()) return [];
    return [[pfad, `${stand.size}:${stand.mtimeMs}:${stand.ctimeMs}:${stand.ino}`]];
  }));
}

function dateienIn(pfad) {
  const stand = lstatSync(pfad, { throwIfNoEntry: false });
  if (stand === undefined) return [];
  if (!stand.isDirectory()) return [pfad];
  return readdirSync(pfad, { recursive: true, withFileTypes: true })
    .filter((eintrag) => !eintrag.isDirectory())
    .map((eintrag) => join(eintrag.parentPath, eintrag.name));
}

function inhaltsAbdruck(pfad) {
  const stand = lstatSync(pfad);
  if (stand.isSymbolicLink()) return `link:${readlinkSync(pfad)}`;
  return `${stand.mode}:${createHash("sha256").update(readFileSync(pfad)).digest("hex")}`;
}

function eigenerZweig(root) {
  const kopf = git(root, ["symbolic-ref", "-q", "HEAD"], { erlaubt: [GIT_GRUEN, GIT_OHNE_TREFFER] }).trim();
  return kopf.startsWith(ZWEIG_REF) ? kopf.slice(ZWEIG_REF.length) : null;
}

function fremderZweig(eintrag, zweig) {
  const name = ZWEIG_EINTRAG.exec(eintrag.split("\n", 1)[0])?.[1];
  return zweig !== null && name !== undefined && name !== zweig;
}

function konfigurationsAbdruck(root, pfad) {
  const zweig = eigenerZweig(root);
  const eintraege = git(root, ["config", "--file", pfad, "--list", "--null"]).split("\0").filter((eintrag) => !fremderZweig(eintrag, zweig));
  return `${lstatSync(pfad).mode}:${createHash("sha256").update(eintraege.join("\0")).digest("hex")}`;
}

function gitAbdruck(root, umgebung, pfade) {
  const dateien = GIT_STEUERUNG.flatMap((name) => dateienIn(pfade[name]));
  const steuerung = Object.fromEntries(dateien.map((pfad) => [relative(root, pfad), pfad === pfade.config ? konfigurationsAbdruck(root, pfad) : inhaltsAbdruck(pfad)]));
  const index = git(root, ["ls-files", "-z", "-s", "-v"], { zusatz: { ...umgebung, GIT_INDEX_FILE: pfade.index } });
  const kopf = git(root, ["rev-parse", "-q", "--verify", "HEAD"], { erlaubt: [GIT_GRUEN, GIT_OHNE_TREFFER] }).trim();
  return { ...steuerung, [relative(root, pfade.index)]: index, HEAD: kopf };
}

export function dokumentAbdruck(root, ordner) {
  const vorhanden = DOKUMENTE.filter((name) => existsSync(join(ordner, name)));
  return Object.fromEntries(vorhanden.map((name) => [relative(root, resolve(ordner, name)), createHash("sha256").update(readFileSync(join(ordner, name))).digest("hex")]));
}

export function abdruck(root, ordner) {
  return abgeschirmt(root, (umgebung, pfade) => {
    const { baum, ignoriert } = arbeitsbaum(root, ordner, { umgebung, pfade });
    const dateien = ignorierteAbdruck(root, basename(resolve(ordner)), ignoriert);
    return { baum, dateien, git: gitAbdruck(root, umgebung, pfade), dokumente: dokumentAbdruck(root, ordner) };
  });
}

function verschiedeneSchluessel(vorher, nachher) {
  const alle = new Set([...Object.keys(vorher), ...Object.keys(nachher)]);
  return [...alle].filter((schluessel) => vorher[schluessel] !== nachher[schluessel]);
}

function baumUnterschiede(root, vorher, nachher) {
  if (vorher === nachher) return [];
  return abgeschirmt(root, (umgebung) => git(root, ["diff-tree", "-r", "--name-only", vorher, nachher], { zusatz: umgebung }).split("\n").filter(Boolean));
}

export function abdruckUnterschiede(root, vorher, nachher) {
  const baum = baumUnterschiede(root, vorher.baum, nachher.baum);
  const dateien = verschiedeneSchluessel(vorher.dateien, nachher.dateien);
  const gitStand = verschiedeneSchluessel(vorher.git, nachher.git);
  const dokumente = verschiedeneSchluessel(vorher.dokumente, nachher.dokumente);
  return [...new Set([...baum, ...dateien, ...gitStand, ...dokumente])].toSorted();
}

function warte(ms) {
  return new Promise((fertig) => {
    setTimeout(fertig, ms);
  });
}

async function warteAufSperre(sperre) {
  let rest = restDerSperre(sperre);
  while (rest > 0) {
    await warte(rest);
    rest = restDerSperre(sperre);
  }
}

export function befundNachricht(befunde, anhang = []) {
  return ["## Befunde", "", ...befunde.map((befund) => `- ${befund}`), "", ...anhang].join("\n");
}

function meldeAbsturz(wer, lauf) {
  if (lauf.aktion?.art === DECKEL) throw new Deckelabbruch(lauf.aktion.grund);
  if (lauf.exitCode === 0) return;
  const zeilen = (lauf.fehlerausgabe ?? "").trim().split("\n");
  const auszug = zeilen.slice(-FEHLERZEILEN).join("\n");
  const meldung = `${wer.rolle} ist abgestürzt (Exit ${lauf.exitCode})`;
  throw new Abbruch(auszug === "" ? meldung : `${meldung}:\n${auszug}`);
}

class Teilnehmer {
  constructor(rolle) {
    this.rolle = rolle;
    this.sitzung = undefined;
    this.laufzeitMs = 0;
    this.aufrufe = 0;
  }

  merke(sitzung, dauerMs) {
    this.sitzung = sitzung;
    this.laufzeitMs += dauerMs;
    this.aufrufe += 1;
  }
}

export class Team {
  constructor(root, ordner, { netzWartezeitenMs = NETZ_WARTEZEITEN_MS } = {}) {
    this.root = root;
    this.ordner = ordner;
    this.phase = basename(resolve(ordner));
    this.anfang = abdruck(root, ordner);
    this.beteiligte = [];
    this.ruecksendungen = {};
    this.netzWartezeitenMs = netzWartezeitenMs;
    this.netzabbrueche = [];
    this.wache = null;
  }

  teilnehmer(rolle) {
    const wer = new Teilnehmer(rolle);
    this.beteiligte.push(wer);
    return wer;
  }

  async sende(wer, nachricht) {
    const sperre = limitSperre({ root: this.root, phase: { phase: this.phase } });
    const start = rollenStart(this.root, wer.rolle);
    let versuch = 0;
    for (;;) {
      await warteAufSperre(sperre);
      const gesperrt = this.wache?.gesperrt() ?? null;
      if (gesperrt !== null) throw new Deckelabbruch(gesperrt);
      const beginn = Date.now();
      const lauf = await this.starte(wer, nachricht, start);
      wer.merke(lauf.sitzung, Date.now() - beginn);
      if (lauf.aktion?.art === DECKEL) return lauf;
      if (lauf.limit) console.log(`${wer.rolle}: ${setzeLimitSperre(sperre, lauf.limit)}`);
      else if (await this.nachNetzabbruch(wer, lauf, versuch)) versuch += 1;
      else return lauf;
    }
  }

  async starte(wer, nachricht, start) {
    let angemeldet = null;
    const beiNachricht = (groesse, zuvor) => this.wache?.melde(angemeldet, groesse, zuvor);
    const laufend = starteAgentParallel({ rolle: wer.rolle, root: this.root, fortsetzung: wer.sitzung }, nachricht, { ...start, kontextGrenze: null, vollstaendig: true, beiNachricht });
    angemeldet = this.wache?.an(laufend.beende, wer) ?? null;
    let lauf = null;
    try {
      lauf = await laufend;
      return lauf;
    } finally {
      this.wache?.ab(angemeldet, lauf?.aktion?.art === DECKEL);
    }
  }

  async nachNetzabbruch(wer, lauf, versuch) {
    const wartezeit = this.netzWartezeitenMs[versuch];
    if (wartezeit === undefined || !netzabbruch(lauf)) return false;
    this.netzabbrueche.push(meldeNetzabbruch({ rolle: wer.rolle, sitzung: wer.sitzung, versuch: versuch + 1, versuche: this.netzWartezeitenMs.length, wartezeitMs: wartezeit, fehler: lauf.volleAntwort }));
    await warte(wartezeit);
    return true;
  }

  ruecksenden(wer, befunde, anhang = []) {
    this.ruecksendungen[wer.rolle] = (this.ruecksendungen[wer.rolle] ?? 0) + 1;
    return befundNachricht(befunde, anhang);
  }

  async frage(wer, nachricht) {
    const lauf = await this.sende(wer, nachricht);
    if (lauf.aktion?.art === STILLSTAND) return { art: STILLSTAND, text: lauf.aktion.grund };
    meldeAbsturz(wer, lauf);
    const antwort = liesAntwort(lauf.volleAntwort ?? "");
    if (antwort.art !== OHNE) return antwort;
    const zweite = await this.sende(wer, this.ruecksenden(wer, [ANTWORT_OHNE_JSON]));
    meldeAbsturz(wer, zweite);
    const gelesen = liesAntwort(zweite.volleAntwort ?? "");
    if (gelesen.art === OHNE) throw new Abbruch(`${wer.rolle} hat zweimal ohne JSON-Block geantwortet`);
    return gelesen;
  }

  async gruppe(laeufe) {
    const vorher = abdruck(this.root, this.ordner);
    const ergebnisse = await Promise.allSettled(laeufe.map(({ lauf }) => lauf()));
    const nachher = abdruck(this.root, this.ordner);
    const seitAnfang = verschiedeneSchluessel(this.anfang.dokumente, nachher.dokumente);
    const geaendert = [...new Set([...abdruckUnterschiede(this.root, vorher, nachher), ...seitAnfang])];
    if (geaendert.length > 0) {
      const rollen = [...new Set(laeufe.map(({ rolle }) => rolle))].join(", ");
      throw new Abbruch(`${rollen} haben ${geaendert.join(", ")} geändert`);
    }
    const fehler = ergebnisse.find(({ status }) => status === "rejected");
    if (fehler) throw fehler.reason;
    return ergebnisse.map(({ value }) => value);
  }
}
