import { spawnSync } from "node:child_process";

import { git } from "./git.mjs";

export const REMOTE = "upstream";
const NAMENSRAUM = "sperren/";
const SPERREN = `refs/${NAMENSRAUM}`;
const SPIEGEL = "refs/auftrag/sperren/";
const FELDER = ["%(refname)", "%(objectname)", "%(contents:subject)"];
const FELDTRENNER = "\0";
const BETREFF = /^Sperre für Phase (\S+) \(Issue #(\d+)\)$/;

function betreff(phase) {
  return `Sperre für Phase ${phase.phase} (Issue #${phase.issue})`;
}

function sperre(zeile) {
  const [ref, sha, text] = zeile.split(FELDTRENNER);
  const [, phase = text, issue] = BETREFF.exec(text) ?? [];
  return { schluessel: ref.slice(SPIEGEL.length), sha, betreff: text, phase, issue };
}

export function belegteSperren(cwd) {
  git(["fetch", "-q", "--prune", "--no-tags", REMOTE, `+${SPERREN}*:${SPIEGEL}*`], { cwd });
  const zeilen = git(["for-each-ref", `--format=${FELDER.join("%00")}`, SPIEGEL], { cwd });
  return zeilen.split("\n").filter(Boolean).map(sperre);
}

export function eigeneSperren(cwd, phase) {
  return belegteSperren(cwd).filter((belegt) => belegt.betreff === betreff(phase));
}

function schiebe(cwd, aenderungen) {
  const leases = aenderungen.map(({ schluessel, alt }) => `--force-with-lease=${SPERREN}${schluessel}:${alt}`);
  const ziele = aenderungen.map(({ schluessel, neu }) => `${neu}:${SPERREN}${schluessel}`);
  return spawnSync("git", ["push", "-q", "--atomic", ...leases, REMOTE, ...ziele], { cwd, encoding: "utf8" });
}

function ueberschneiden(links, rechts) {
  return links === rechts || links.startsWith(`${rechts}/`) || rechts.startsWith(`${links}/`);
}

function sperrCommit(cwd, phase) {
  const leererBaum = git(["mktree"], { cwd, eingabe: "" }).trim();
  return git(["commit-tree", leererBaum, "-m", betreff(phase)], { cwd }).trim();
}

function lage({ cwd, phase, schluessel }) {
  const belegt = belegteSperren(cwd);
  const eigene = new Set(belegt.filter((fremd) => fremd.betreff === betreff(phase)).map((fremd) => fremd.schluessel));
  const blockiert = belegt.filter(
    (fremd) => fremd.betreff !== betreff(phase) && schluessel.some((k) => ueberschneiden(k, fremd.schluessel)),
  );
  return { blockiert, fehlend: schluessel.filter((k) => !eigene.has(k)) };
}

export async function erwerben(auftrag, warten) {
  const commit = sperrCommit(auftrag.cwd, auftrag.phase);
  let gescheitert = null;
  for (;;) {
    const { blockiert, fehlend } = lage(auftrag);
    for (const fremd of blockiert) {
      console.log(`Phase ${auftrag.phase.phase} wartet auf Phase ${fremd.phase} (Sperre ${fremd.schluessel}).`);
    }
    const neu = fehlend.map((k) => ({ schluessel: k, alt: "", neu: commit }));
    const versuch = blockiert.length > 0 || neu.length === 0 ? null : schiebe(auftrag.cwd, neu);
    if (blockiert.length === 0 && (versuch === null || versuch.status === 0)) return;
    if (versuch !== null && gescheitert !== null) {
      throw new Error(`Die Sperren ließen sich nicht anlegen: ${versuch.stderr}`);
    }
    gescheitert = versuch;
    await warten();
  }
}

export function freigeben(cwd, sperren) {
  if (sperren.length === 0) return;
  const lauf = schiebe(cwd, sperren.map(({ schluessel, sha }) => ({ schluessel, alt: sha, neu: "" })));
  if (lauf.status !== 0) {
    const namen = sperren.map(({ schluessel }) => schluessel).join(", ");
    throw new Error(`Die Sperren ${namen} ließen sich nicht lösen: ${lauf.stderr}`);
  }
}

export async function verwaisteSperren(remote) {
  const refs = (await remote.optional(`/git/matching-refs/${NAMENSRAUM}`)) ?? [];
  const befunde = await Promise.all(
    refs.map(async ({ ref, object }) => {
      const { message } = await remote.get(`/git/commits/${object.sha}`);
      const [kopfzeile] = message.split("\n");
      const issue = BETREFF.exec(kopfzeile)?.[2];
      const offen = issue !== undefined && (await remote.optional(`/issues/${issue}`))?.state === "open";
      return offen ? [] : [`Sperre ${ref.slice(SPERREN.length)} ohne laufende Phase: ${kopfzeile}`];
    }),
  );
  return befunde.flat();
}
