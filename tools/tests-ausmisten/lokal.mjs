import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { entferneArbeitsordner, legeArbeitsordnerAn } from "./arbeitsordner.mjs";
import { ausgabenAus } from "./ausgaben.mjs";
import { paketName } from "./artefakte.mjs";
import { BASIS, BRANCH, artefaktText, lesePlan } from "./entscheiden.mjs";
import { ausgenommeneFaelle, paketTeile, urteilAusTeilen, zeigeAusnahmen } from "./melden.mjs";
import { git } from "./pfade.mjs";
import { meldeVorpruefung, vorpruefen } from "./vorpruefen.mjs";
import { inSpeicher } from "./zwischenspeicher.mjs";

const EINSTIEG = fileURLToPath(new URL("../tests-ausmisten.mjs", import.meta.url));
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const EXIT_FREIGABE = 3;
const REPOSITORY = "lokal/hermes";
const REPO_ID = 1;
const EINGANG = ".github/workflows/ausmisten-eingang.yml";
const NUR_COMMIT = "^{commit}";

function sha(rev) {
  return git(["rev-parse", "--verify", `${rev}${NUR_COMMIT}`]).trim();
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
  const basisSumme = basis.werte.pruefsumme ?? "";
  if (basis.exit !== EXIT_GRUEN) return { gruen: false, basisSumme };
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
    umgebung: { PLAN_PRUEFSUMME: pruefsumme, BASIS_PRUEFSUMME: basisSumme },
  });
  return { gruen: branch.exit === EXIT_GRUEN, basisSumme };
}

function lokaleTexte(ordner, plan) {
  const fehler = [];
  const texte = new Map();
  plan.pakete.forEach((_paket, nummer) => {
    for (const art of [BASIS, BRANCH]) {
      const name = paketName(art, nummer);
      const gelesen = artefaktText(ordner, name);
      if (gelesen.fehler) fehler.push(...gelesen.fehler);
      else texte.set(name, gelesen.text);
    }
  });
  return { fehler, texte };
}

function urteil(stand, { pruefsumme, erwartet, summen, rot }) {
  const plan = lesePlan({ ordner: stand.ordner, summe: pruefsumme, erwartet });
  if (plan.fehler) return { gruen: false, verstoesse: plan.fehler };
  const geladen = lokaleTexte(stand.ordner, plan.daten);
  const { fehler, teile } = paketTeile(geladen.texte, { plan: plan.daten, summen, erwartet });
  zeigeAusnahmen(ausgenommeneFaelle(teile[BASIS]));
  return urteilAusTeilen(teile, {
    fehler: [...rot, ...geladen.fehler, ...fehler],
    plan: plan.daten,
  });
}

function messePakete(stand, { pakete, pruefsumme }) {
  const summen = [];
  const rot = [];
  for (const nummer of pakete) {
    const { gruen, basisSumme } = messeKette(stand, { nummer, pruefsumme });
    summen.push(basisSumme);
    if (!gruen) rot.push(`Paket ${nummer}: ein Messschritt endete rot`);
    if (!gruen && stand.alle) console.log(`Lokal: rot in Paket ${nummer}; weiter wegen --alle.`);
    if (!gruen && !stand.alle) {
      console.log(`Lokal: rot in Paket ${nummer}; die übrigen Pakete werden nicht gemessen.`);
      return undefined;
    }
  }
  return { summen, rot };
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
  const gemessen = messePakete(stand, { pakete: JSON.parse(planen.werte.pakete), pruefsumme });
  if (gemessen === undefined) return EXIT_ROT;
  const ergebnis = urteil(stand, { pruefsumme, erwartet: { kopf, master, bereich }, ...gemessen });
  if (ergebnis.freigabe) {
    for (const punkt of ergebnis.punkte) console.log(`Freigabe nötig: ${punkt}`);
    console.log("Lokal: grün bis auf die Freigabe durch Antonio im PR (Exit 3)");
    return EXIT_FREIGABE;
  }
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
