import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { env, execPath } from "node:process";
import { setTimeout as schlafen } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { EXIT_GRUEN, EXIT_ROT, gueltigePhase } from "./befehle.mjs";
import { sperrSchluessel } from "./bereiche.mjs";
import { ROT, belegPfad, belegVerzeichnis, schreibeBeleg } from "./bericht.mjs";
import { reihenfolge } from "./format.mjs";
import { git, kopf } from "./git.mjs";
import { beleg, fuehreAus } from "./pruefungen.mjs";
import { REMOTE, belegteSperren, eigeneSperren, erwerben, freigeben } from "./sperren.mjs";
import {
  MASTER,
  entferneAuftrag,
  entferneIntegration,
  legeAuftragAn,
  legeIntegrationAn,
  phasenBranch,
  sichereDiff,
} from "./worktrees.mjs";

const EINSTIEG = fileURLToPath(new URL("../auftrag.mjs", import.meta.url));
const MAX_NEUSTARTS = 2;
const WARTEN_MS = 60_000;
const WARTEND = "wartend";
const LAEUFT = "läuft";
const FERTIG = "fertig";
const UEBERNOMMEN = "übernommen";
const ABBRUCH_SIGNALE = ["SIGINT", "SIGTERM"];
const KURZ_SHA = 7;

function warten() {
  return schlafen(Number(env.HERMES_SPERRE_WARTEN_MS ?? WARTEN_MS));
}

class Phasenlauf {
  constructor(ort) {
    const { ordnung } = reihenfolge(ort.phase.auftraege);
    this.ort = ort;
    this.verzeichnis = belegVerzeichnis(ort.root, ort.phase.phase);
    this.ordnung = ordnung.map(({ id }) => id);
    const eintraege = ort.phase.auftraege.map((auftrag) => [auftrag.id, { auftrag, zustand: WARTEND, neustarts: 0 }]);
    this.stand = new Map(eintraege);
    this.laufend = new Map();
    this.naechster = 0;
  }

  zustand(kennung) {
    return this.stand.get(kennung).zustand;
  }

  dateien(kennung) {
    const { auftrag } = this.stand.get(kennung);
    return auftrag.erwarteteDateien;
  }

  startbereit(kennung) {
    const { auftrag, zustand } = this.stand.get(kennung);
    if (zustand !== WARTEND || this.ordnung.some((andere) => this.zustand(andere) === ROT)) return false;
    const erledigt = (auftrag.abhaengigVon ?? []).every((vorher) => this.zustand(vorher) === UEBERNOMMEN);
    const belegt = [...this.laufend.keys()].flatMap((andere) => this.dateien(andere));
    return erledigt && !auftrag.erwarteteDateien.some((pfad) => belegt.includes(pfad));
  }

  starte(kennung) {
    const eintrag = this.stand.get(kennung);
    eintrag.pfad = legeAuftragAn(this.ort, kennung);
    eintrag.basis = kopf(eintrag.pfad);
    eintrag.zustand = LAEUFT;
    const datei = join(this.verzeichnis, `${kennung}.phase.json`);
    const einzeln = { ...eintrag.auftrag, abhaengigVon: [] };
    writeFileSync(datei, JSON.stringify({ ...this.ort.phase, auftraege: [einzeln] }));
    const protokoll = openSync(join(this.verzeichnis, `${kennung}.log`), "a");
    const stdio = ["ignore", protokoll, protokoll];
    const kind = spawn(execPath, [EINSTIEG, "lauf", datei], { cwd: eintrag.pfad, stdio, detached: true });
    closeSync(protokoll);
    const ende = new Promise((fertig) => kind.on("close", (code) => fertig({ kennung, exitCode: code ?? EXIT_ROT })));
    this.laufend.set(kennung, { kind, ende });
  }

  nachLauf({ kennung, exitCode }) {
    this.laufend.delete(kennung);
    const eintrag = this.stand.get(kennung);
    const datei = belegPfad(eintrag.pfad, this.ort.phase.phase, kennung);
    const ersatz = { phase: this.ort.phase.phase, auftrag: kennung, pruefungen: [] };
    eintrag.beleg = existsSync(datei) ? JSON.parse(readFileSync(datei, "utf8")) : ersatz;
    if (exitCode !== EXIT_GRUEN) return this.verwirf(kennung, `lauf endete mit Exit ${exitCode}.`);
    eintrag.zustand = FERTIG;
    eintrag.commit = kopf(eintrag.pfad);
    return undefined;
  }

  schreibe(kennung, zusatz) {
    const { beleg: bisher, neustarts } = this.stand.get(kennung);
    schreibeBeleg(this.ort.root, { ...bisher, neustarts, ...zusatz });
  }

  verwirf(kennung, grund) {
    const eintrag = this.stand.get(kennung);
    eintrag.zustand = ROT;
    const diff = sichereDiff(eintrag.pfad, eintrag.basis);
    this.schreibe(kennung, { ergebnis: ROT, grund: eintrag.beleg.grund ?? grund, diff });
    entferneAuftrag(this.ort, kennung);
    console.log(`Auftrag ${kennung}: verworfen, ${grund} Der Diff steht im Beleg.`);
  }

  protokolliere(kennung, schritte) {
    const eintrag = this.stand.get(kennung);
    eintrag.beleg = { ...eintrag.beleg, pruefungen: [...eintrag.beleg.pruefungen, ...schritte] };
  }

  neustart(kennung) {
    const eintrag = this.stand.get(kennung);
    if (eintrag.neustarts >= MAX_NEUSTARTS) {
      return this.verwirf(kennung, `Konflikt mit dem Phasen-Branch auch nach ${MAX_NEUSTARTS} Neustarts.`);
    }
    entferneAuftrag(this.ort, kennung);
    eintrag.neustarts += 1;
    eintrag.zustand = WARTEND;
    console.log(`Auftrag ${kennung}: Konflikt mit dem Phasen-Branch, Neustart ${eintrag.neustarts}.`);
    return undefined;
  }

  pruefe(name, befehl) {
    return beleg(fuehreAus(name, befehl, { cwd: this.ort.integration, env }));
  }

  uebernimmEinen(kennung) {
    const { basis, commit } = this.stand.get(kennung);
    const probe = this.pruefe("merge-tree", ["git", "merge-tree", "--write-tree", `--merge-base=${basis}`, "HEAD", commit]);
    this.protokolliere(kennung, [probe]);
    if (probe.exitCode !== 0) return this.neustart(kennung);
    const vorher = kopf(this.ort.integration);
    const uebernahme = this.pruefe("cherry-pick", ["git", "cherry-pick", commit]);
    const pruefleiter = this.pruefe("prüfleiter", ["npm", "--silent", "run", "pruefleiter", "--", "--basis", this.basis]);
    this.protokolliere(kennung, [uebernahme, pruefleiter]);
    if (uebernahme.exitCode !== 0 || pruefleiter.exitCode !== 0) {
      git(["reset", "-q", "--hard", vorher], { cwd: this.ort.integration });
      return this.verwirf(kennung, "Übernahme oder Prüfleiter auf dem Phasen-Branch rot.");
    }
    this.stand.get(kennung).zustand = UEBERNOMMEN;
    const sha = kopf(this.ort.integration);
    this.schreibe(kennung, { uebernommen: sha });
    entferneAuftrag(this.ort, kennung);
    console.log(`Auftrag ${kennung}: übernommen als ${sha.slice(0, KURZ_SHA)}.`);
    return undefined;
  }

  uebernimm() {
    while (this.ordnung[this.naechster] !== undefined) {
      const kennung = this.ordnung[this.naechster];
      if (this.zustand(kennung) === FERTIG) this.uebernimmEinen(kennung);
      if (this.zustand(kennung) !== UEBERNOMMEN) return;
      this.naechster += 1;
    }
  }

  async fuehreAus() {
    this.basis = kopf(this.ort.integration);
    for (;;) {
      for (const kennung of this.ordnung) if (this.startbereit(kennung)) this.starte(kennung);
      if (this.laufend.size === 0) return this.ordnung.every((kennung) => this.zustand(kennung) === UEBERNOMMEN);
      this.nachLauf(await Promise.race([...this.laufend.values()].map(({ ende }) => ende)));
      this.uebernimm();
    }
  }

  abbrechen() {
    for (const { kind } of this.laufend.values()) {
      if (kind.exitCode === null) process.kill(-kind.pid, "SIGTERM");
    }
    for (const kennung of this.ordnung) {
      if (this.zustand(kennung) === FERTIG) this.verwirf(kennung, "Grün, aber nicht übernommen, weil die Phase rot ist.");
      entferneAuftrag(this.ort, kennung);
    }
  }
}

function aufgeben(ort, lauf) {
  lauf.abbrechen();
  if (!existsSync(ort.integration)) return;
  git(["reset", "-q", "--hard", MASTER], { cwd: ort.integration });
  freigeben(ort.integration, eigeneSperren(ort.integration, ort.phase));
  entferneIntegration(ort, { branch: true });
}

function hochladen(ort) {
  git(["push", "-q", "-u", REMOTE, phasenBranch(ort.phase)], { cwd: ort.integration });
  entferneIntegration(ort, { branch: false });
  console.log(`Phase ${ort.phase.phase}: grün, ${phasenBranch(ort.phase)} ist hochgeladen.`);
  console.log("Die Sperren bleiben bis zum Merge; danach löst sie node tools/auftrag.mjs aufraeumen.");
  return EXIT_GRUEN;
}

function issueBefunde(phase) {
  return Number.isInteger(phase.issue) && phase.issue > 0 ? [] : ["issue muss die Nummer des Phasen-Issues sein."];
}

async function bauePhase(ort, lauf) {
  await erwerben({ cwd: ort.integration, phase: ort.phase, schluessel: await sperrSchluessel(ort.root, ort.phase) }, warten);
  git(["fetch", "-q", REMOTE, "master"], { cwd: ort.integration });
  git(["reset", "-q", "--hard", MASTER], { cwd: ort.integration });
  return lauf.fuehreAus();
}

export async function phase(phasendatei, root) {
  const { phase: beschreibung, befunde } = gueltigePhase(phasendatei, root);
  const alle = befunde.length > 0 ? befunde : issueBefunde(beschreibung);
  for (const befund of alle) console.error(befund);
  if (alle.length > 0) return EXIT_ROT;
  mkdirSync(belegVerzeichnis(root, beschreibung.phase), { recursive: true });
  const ort = { root, phase: beschreibung, integration: legeIntegrationAn(root, beschreibung) };
  const lauf = new Phasenlauf(ort);
  const abbruch = () => {
    aufgeben(ort, lauf);
    process.exit(EXIT_ROT);
  };
  for (const signal of ABBRUCH_SIGNALE) process.once(signal, abbruch);
  try {
    if (await bauePhase(ort, lauf)) return hochladen(ort);
  } catch (fehler) {
    aufgeben(ort, lauf);
    throw fehler;
  }
  aufgeben(ort, lauf);
  return EXIT_ROT;
}

function istGemergt(root, branch) {
  const lauf = spawnSync("git", ["cherry", MASTER, branch], { cwd: root, encoding: "utf8" });
  return lauf.status === 0 && !lauf.stdout.split("\n").some((zeile) => zeile.startsWith("+"));
}

export function aufraeumen(root) {
  git(["worktree", "prune"], { cwd: root });
  git(["fetch", "-q", REMOTE, "master"], { cwd: root });
  const gemergt = belegteSperren(root).filter((sperre) => sperre.issue && istGemergt(root, phasenBranch(sperre)));
  freigeben(root, gemergt);
  for (const branch of new Set(gemergt.map(phasenBranch))) git(["branch", "-q", "-D", branch], { cwd: root });
  console.log(`aufgeräumt: ${gemergt.length} Sperren gemergter Phasen gelöst.`);
  return EXIT_GRUEN;
}
