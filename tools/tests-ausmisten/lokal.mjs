import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { entferneArbeitsordner, legeArbeitsordnerAn } from "./arbeitsordner.mjs";
import { paketName } from "./artefakte.mjs";
import { BASIS, BRANCH, leseArtefakt, lesePlan } from "./entscheiden.mjs";
import { urteilAusTeilen } from "./melden.mjs";
import { git } from "./pfade.mjs";
import { meldeVorpruefung, vorpruefen } from "./vorpruefen.mjs";
import { inSpeicher } from "./zwischenspeicher.mjs";

const EINSTIEG = fileURLToPath(new URL("../tests-ausmisten.mjs", import.meta.url));
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const REPOSITORY = "lokal/hermes";
const REPO_ID = 1;
const EINGANG = ".github/workflows/ausmisten-eingang.yml";

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
      ...(stand.alle ? ["--alle"] : []),
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

function messePakete(stand, { pakete, pruefsumme }) {
  const summen = [];
  for (const nummer of pakete) {
    const gruen = messeKette(stand, { nummer, pruefsumme });
    const basis = ausgabenAus(join(stand.ordner, `${paketName(BASIS, nummer)}.txt`));
    summen.push(basis.pruefsumme ?? "");
    if (!gruen && stand.alle) console.log(`Lokal: rot in Paket ${nummer}; weiter wegen --alle.`);
    if (!gruen && !stand.alle) {
      console.log(`Lokal: rot in Paket ${nummer}; die übrigen Pakete werden nicht gemessen.`);
      return undefined;
    }
  }
  return summen;
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
  const summen = messePakete(stand, { pakete: JSON.parse(planen.werte.pakete), pruefsumme });
  if (summen === undefined) return EXIT_ROT;
  const ergebnis = urteil(stand, { pruefsumme, erwartet: { kopf, master, bereich }, summen });
  for (const verstoss of ergebnis.verstoesse) console.log(`Verstoß: ${verstoss}`);
  console.log(`Lokal: ${ergebnis.gruen ? "grün" : "rot"}`);
  return ergebnis.gruen ? EXIT_GRUEN : EXIT_ROT;
}

export async function lokal(optionen) {
  const { bereich, kopf: kopfRev = "HEAD", speicher, aus, gitleaks, alle = false } = optionen;
  const [master, kopf] = [sha(optionen.master), sha(kopfRev)];
  const ordner = aus ?? mkdtempSync(join(tmpdir(), "ausmisten-lokal-"));
  mkdirSync(ordner, { recursive: true });
  const vorpruefung = vorpruefen({ master, kopf, ordner, gitleaks });
  if (meldeVorpruefung(vorpruefung) !== EXIT_GRUEN) {
    console.log("Lokal: rot vor der Messung; es wurde nichts gemessen.");
    return EXIT_ROT;
  }
  const arbeit = legeArbeitsordnerAn(join(ordner, "master"), master);
  const umgebung = {
    GITHUB_EVENT_PATH: ereignis(ordner, { kopf, bereich }),
    GITHUB_REPOSITORY: REPOSITORY,
    GITHUB_RUN_ID: "lokal",
    GITHUB_TOKEN: "",
    NODE_ENV: "test",
  };
  try {
    return await messe(
      { ordner, arbeitsordner: arbeit, umgebung, speicher, alle },
      { master, kopf, bereich },
    );
  } finally {
    entferneArbeitsordner(arbeit);
  }
}
