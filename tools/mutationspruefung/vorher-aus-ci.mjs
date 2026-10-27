import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { env } from "node:process";
import { isDeepStrictEqual } from "node:util";

import { beruehrteTestdateienSamtHilfen } from "../auftrag/testumbau.mjs";
import { POSTGRES_VARIABLE } from "../auftrag/werkzeuge.mjs";
import { gh, ghRepo, LAUF_FERTIG, MAX_GH_AUSGABE } from "./gh.mjs";
import { imVorherStand } from "./testumbau.mjs";
import { HERKUNFT_CI, INSTALLIERTE_MODULE, legeVorherAb, werkzeugStand } from "./vorher-speicher.mjs";
import { PLANDATEI, vereineStuecke } from "./vorher-verteilt.mjs";

const WORKFLOW = "testumbau-vorher";
const ERFOLG = "success";
const LAUF_NUMMER = /^[1-9]\d*$/;
const STUECKDATEI = /^stueck-\d+\.json$/;
const ARTEFAKTE = ["vorher-plan", "vorher-stueck-*"];
const LOCKDATEI = "package-lock.json";
const MODULORDNER = "node_modules/";
const BEISPIELE = 3;
const EXIT_GRUEN = 0;
const COMMIT = /^[0-9a-f]{40}$/;
const WORKFLOW_DATEI = ".github/workflows/testumbau-vorher.yml";

export function postgresDa() {
  return Boolean(env[POSTGRES_VARIABLE]);
}

function holeLauf(lauf, ordner) {
  const repo = ghRepo();
  const daten = JSON.parse(gh(["run", "view", lauf, "-R", repo, "--json", "workflowName,status,conclusion,headSha"]));
  if (daten.workflowName !== WORKFLOW) throw new Error(`Lauf ${lauf} gehört zum Workflow ${daten.workflowName}, nicht zu ${WORKFLOW}`);
  if (daten.status !== LAUF_FERTIG || daten.conclusion !== ERFOLG) {
    throw new Error(`Lauf ${lauf} ist nicht grün abgeschlossen (${daten.status}, ${daten.conclusion}); ein offenes oder rotes Stück wird nicht übernommen`);
  }
  gh(["run", "download", lauf, "-R", repo, "-D", ordner, ...ARTEFAKTE.flatMap((muster) => ["-p", muster])]);
  return daten.headSha;
}

function artefakte(ordner) {
  const pfade = readdirSync(ordner, { recursive: true }).map(String);
  const lies = (pfad) => JSON.parse(readFileSync(join(ordner, pfad), "utf8"));
  const plaene = pfade.filter((pfad) => basename(pfad) === PLANDATEI);
  if (plaene.length !== 1) throw new Error(`der Lauf enthält ${plaene.length} Pläne statt einem`);
  return { plan: lies(plaene[0]), berichte: pfade.filter((pfad) => STUECKDATEI.test(basename(pfad))).map(lies) };
}

function beispiele(pfade) {
  return `${pfade.length} (${pfade.slice(0, BEISPIELE).join(", ")})`;
}

function abweichendeDateien(ci, lokal) {
  const ohneModule = (liste) => new Map(liste.filter(([pfad]) => pfad !== INSTALLIERTE_MODULE));
  const [inCi, hier] = [ohneModule(ci), ohneModule(lokal)];
  return [...new Set([...inCi.keys(), ...hier.keys()])].filter((pfad) => inCi.get(pfad) !== hier.get(pfad)).sort();
}

function moduleNebenLock(root) {
  const pakete = (pfad) => JSON.parse(readFileSync(join(root, pfad), "utf8")).packages ?? {};
  if (!existsSync(join(root, INSTALLIERTE_MODULE))) return [INSTALLIERTE_MODULE];
  const [lock, installiert] = [pakete(LOCKDATEI), pakete(INSTALLIERTE_MODULE)];
  const anders = Object.entries(installiert).filter(([pfad, paket]) => lock[pfad]?.version !== paket.version || lock[pfad]?.integrity !== paket.integrity);
  const fehlend = Object.entries(lock).filter(([pfad, paket]) => pfad.startsWith(MODULORDNER) && !paket.optional && !Object.hasOwn(installiert, pfad));
  return [...anders, ...fehlend].map(([pfad]) => pfad).sort();
}

function gleich(name, ci, lokal) {
  return isDeepStrictEqual(ci, lokal) ? [] : [`${name}: CI ${JSON.stringify(ci)}, lokal ${JSON.stringify(lokal)}`];
}

function werkzeugAbweichungen(umgebung, root) {
  const lokal = werkzeugStand(root);
  if (lokal === null) return ["Werkzeugstand: eine lokale Eingabe des Werkzeugs ist keine gewöhnliche Datei"];
  if (!Array.isArray(umgebung?.werkzeug)) return ["Werkzeugstand: der Lauf nennt keinen (älteres Werkzeug)"];
  const dateien = abweichendeDateien(umgebung.werkzeug, lokal.werkzeug);
  const module = moduleNebenLock(root);
  return [
    ...(dateien.length > 0 ? [`Werkzeugstand: abweichende Dateien ${beispiele(dateien)}`] : []),
    ...(module.length > 0 ? [`Werkzeugstand: lokale Module passen nicht zu ${LOCKDATEI}: ${beispiele(module)}`] : []),
    ...gleich("Node", umgebung.node, lokal.node),
  ];
}

function workflowAmKopf(kopf, root) {
  const dort = spawnSync("git", ["show", `${kopf}:${WORKFLOW_DATEI}`], { cwd: root, encoding: "utf8", maxBuffer: MAX_GH_AUSGABE });
  const hier = join(root, WORKFLOW_DATEI);
  return dort.status === EXIT_GRUEN && existsSync(hier) && dort.stdout === readFileSync(hier, "utf8");
}

function kopfAbweichungen(kopf, root) {
  if (typeof kopf !== "string" || !COMMIT.test(kopf)) return [`Kopf des Laufs: ${JSON.stringify(kopf)} ist keine Commit-SHA`];
  const vorfahr = spawnSync("git", ["merge-base", "--is-ancestor", kopf, "HEAD"], { cwd: root });
  if (vorfahr.status !== EXIT_GRUEN) return [`Kopf des Laufs: ${kopf} ist lokal nicht vorhanden oder kein Vorfahr des lokalen Stands`];
  return workflowAmKopf(kopf, root) ? [] : [`Workflow: ${WORKFLOW_DATEI} am Kopf des Laufs ist anders als lokal`];
}

function abweichungen({ plan, berichte, basis, geaendert, lokal, kopf, root }) {
  const postgres = [...new Set(berichte.map((bericht) => bericht.postgres))];
  return [
    ...gleich("Basis", plan.basis, basis),
    ...gleich("Testliste", plan.tests, [...geaendert].sort()),
    ...gleich("betroffene Tests", plan.betroffen, lokal.tests),
    ...gleich("Quelldateien", plan.quellen.map(({ datei }) => datei), lokal.quellen),
    ...gleich("Postgres", postgres, [postgresDa()]),
    ...werkzeugAbweichungen(plan.umgebung, root),
    ...kopfAbweichungen(kopf, root),
  ];
}

export async function vorherAusCi({ basis, lauf, root }, { werkzeug, hole = holeLauf }) {
  if (!LAUF_NUMMER.test(lauf)) throw new Error(`--vorher-aus-ci verlangt die Nummer eines Laufs, nicht ${lauf}`);
  const ordner = mkdtempSync(join(tmpdir(), "vorher-aus-ci-"));
  try {
    const kopf = hole(lauf, ordner);
    const { plan, berichte } = artefakte(ordner);
    const vereint = vereineStuecke(plan, berichte);
    const geaendert = beruehrteTestdateienSamtHilfen(basis, root);
    const lokal = await imVorherStand({ basis, tests: geaendert }, werkzeug, async (stand) => stand);
    const gruende = abweichungen({ plan, berichte, basis, geaendert, lokal, kopf, root });
    if (gruende.length > 0) throw new Error(`Lauf ${lauf} misst nicht denselben Fall, nichts abgelegt:\n- ${gruende.join("\n- ")}`);
    const herkunft = { art: HERKUNFT_CI, lauf, kopf, plattform: plan.umgebung.plattform, node: plan.umgebung.node };
    const ablage = legeVorherAb({ basis, geaendert, root }, { tests: vereint.tests, quellen: vereint.quellen, getoetet: vereint.getoetet, herkunft });
    return { ...ablage, herkunft, getoetet: vereint.getoetet.length, quellen: vereint.quellen.length };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}
