import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { paketName } from "./artefakte.mjs";
import { BASIS, BRANCH, leseArtefakt, lesePlan } from "./entscheiden.mjs";
import { urteilAusTeilen } from "./melden.mjs";
import { git } from "./pfade.mjs";
import { inSpeicher } from "./zwischenspeicher.mjs";

const EINSTIEG = fileURLToPath(new URL("../tests-ausmisten.mjs", import.meta.url));
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const REPOSITORY = "lokal/hermes";
const REPO_ID = 1;
const EINGANG = ".github/workflows/ausmisten-eingang.yml";
const VORPRUEFUNGEN = [];
const EIGENER_CACHE = ".cache";

function sha(rev) {
  return git(["rev-parse", "--verify", `${rev}^{commit}`]).trim();
}

function ereignis(ordner, { kopf, bereich }) {
  const repository = { id: REPO_ID, full_name: REPOSITORY };
  const lauf = {
    path: EINGANG,
    event: "push",
    conclusion: "success",
    head_sha: kopf,
    head_branch: `ausmisten/${bereich}`,
    head_repository: repository,
    repository,
  };
  const datei = join(ordner, "ereignis.json");
  writeFileSync(datei, JSON.stringify({ workflow_run: lauf }));
  return datei;
}

function ausgabenAus(datei) {
  if (!existsSync(datei)) return {};
  const zeilen = readFileSync(datei, "utf8").split("\n").filter(Boolean);
  return Object.fromEntries(
    zeilen.map((zeile) => [
      zeile.slice(0, zeile.indexOf("=")),
      zeile.slice(zeile.indexOf("=") + 1),
    ]),
  );
}

function schritt(stand, { name, args, umgebung = {} }) {
  const ausgabe = join(stand.ordner, `${name}.txt`);
  rmSync(ausgabe, { force: true });
  console.log(`Lokal: ${name}`);
  const lauf = spawnSync(execPath, [EINSTIEG, ...args], {
    cwd: stand.arbeitsordner,
    stdio: "inherit",
    env: { ...env, ...stand.umgebung, ...umgebung, GITHUB_OUTPUT: ausgabe },
  });
  git(["reset", "-q", "--hard"], stand.arbeitsordner);
  return { exit: lauf.status, werte: ausgabenAus(ausgabe) };
}

function verlinkeModule(quelle, ziel) {
  mkdirSync(ziel);
  for (const eintrag of readdirSync(quelle)) {
    if (eintrag !== EIGENER_CACHE) symlinkSync(join(quelle, eintrag), join(ziel, eintrag));
  }
}

function arbeitsordner(ordner, master) {
  const ziel = join(ordner, "master");
  git(["worktree", "add", "--detach", "-q", ziel, master]);
  const module = join(git(["rev-parse", "--show-toplevel"]).trim(), "node_modules");
  if (existsSync(module)) verlinkeModule(module, join(ziel, "node_modules"));
  return ziel;
}

function messeKette(stand, { nummer, pruefsumme }) {
  const daten = ["--plan-daten", stand.ordner, "--paket", String(nummer)];
  const basis = schritt(stand, {
    name: paketName(BASIS, nummer),
    args: ["basis", ...daten, "--aus", join(stand.ordner, paketName(BASIS, nummer))],
    umgebung: { PLAN_PRUEFSUMME: pruefsumme },
  });
  if (basis.exit !== EXIT_GRUEN) return false;
  const name = paketName(BASIS, nummer);
  if (stand.speicher !== undefined)
    inSpeicher(stand.speicher, readFileSync(join(stand.ordner, name, `${name}.json`), "utf8"));
  const branch = schritt(stand, {
    name: paketName(BRANCH, nummer),
    args: [
      "branch",
      ...daten,
      "--basis-daten",
      stand.ordner,
      "--aus",
      join(stand.ordner, paketName(BRANCH, nummer)),
    ],
    umgebung: { PLAN_PRUEFSUMME: pruefsumme, BASIS_PRUEFSUMME: basis.werte.pruefsumme ?? "" },
  });
  return branch.exit === EXIT_GRUEN;
}

function urteil(stand, { pruefsumme, erwartet, summen }) {
  const plan = lesePlan({ ordner: stand.ordner, summe: pruefsumme, erwartet });
  if (plan.fehler) return { gruen: false, verstoesse: plan.fehler };
  const teile = { [BASIS]: [], [BRANCH]: [] };
  const fehler = [];
  plan.daten.pakete.forEach((_paket, nummer) => {
    for (const art of [BASIS, BRANCH]) {
      const name = paketName(art, nummer);
      const summe = art === BASIS ? summen[nummer] : undefined;
      const gelesen = leseArtefakt({
        ordner: stand.ordner,
        name,
        art,
        summe,
        erwartet,
      });
      if (gelesen.fehler) fehler.push(...gelesen.fehler);
      else teile[art].push({ ...gelesen.daten, nummer });
    }
  });
  return urteilAusTeilen(teile, fehler);
}

async function messe(stand, { master, kopf, bereich }) {
  const planen = schritt(stand, {
    name: "planen",
    args: [
      "planen",
      "--aus",
      join(stand.ordner, "plan"),
      ...(stand.speicher === undefined ? [] : ["--speicher", stand.speicher]),
    ],
  });
  if (planen.exit !== EXIT_GRUEN) return EXIT_ROT;
  const { pruefsumme } = planen.werte;
  const pakete = JSON.parse(planen.werte.pakete);
  const summen = [];
  for (const nummer of pakete) {
    const gruen = messeKette(stand, { nummer, pruefsumme });
    const basis = ausgabenAus(join(stand.ordner, `${paketName(BASIS, nummer)}.txt`));
    summen.push(basis.pruefsumme ?? "");
    if (!gruen) {
      console.log(`Lokal: rot in Paket ${nummer}; die übrigen Pakete werden nicht gemessen.`);
      return EXIT_ROT;
    }
  }
  const ergebnis = urteil(stand, { pruefsumme, erwartet: { kopf, master, bereich }, summen });
  for (const verstoss of ergebnis.verstoesse) console.log(`Verstoß: ${verstoss}`);
  console.log(`Lokal: ${ergebnis.gruen ? "grün" : "rot"}`);
  return ergebnis.gruen ? EXIT_GRUEN : EXIT_ROT;
}

export async function lokal({ bereich, master: masterRev, kopf: kopfRev = "HEAD", speicher, aus }) {
  const [master, kopf] = [sha(masterRev), sha(kopfRev)];
  const ordner = aus ?? mkdtempSync(join(tmpdir(), "ausmisten-lokal-"));
  mkdirSync(ordner, { recursive: true });
  for (const pruefung of VORPRUEFUNGEN) {
    const verstoesse = await pruefung({ master, kopf, ordner });
    for (const verstoss of verstoesse) console.log(`Vorprüfung: ${verstoss}`);
    if (verstoesse.length > 0) return EXIT_ROT;
  }
  const arbeit = arbeitsordner(ordner, master);
  const umgebung = {
    GITHUB_EVENT_PATH: ereignis(ordner, { kopf, bereich }),
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_RUN_ID: "lokal",
    GITHUB_TOKEN: "",
    NODE_ENV: "test",
  };
  try {
    return await messe(
      { ordner, arbeitsordner: arbeit, umgebung, speicher },
      { master, kopf, bereich },
    );
  } finally {
    git(["worktree", "remove", "--force", arbeit]);
  }
}
