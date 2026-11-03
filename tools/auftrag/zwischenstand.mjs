import { git, hartZuruecksetzen, kopf } from "./git.mjs";

const BETREFF = "Zwischenstand: Abnahmetest für ";
const SICHERUNG = "refs/auftrag-zwischenstand";
const KURZ = 7;
const KEIN_REFNAME = /[^A-Za-z0-9._-]/g;
const BASISZWEIG = /\/(?:master|HEAD)$/;

function betreffVon(id) {
  return `${BETREFF}${id}`;
}

export function zwischenstandNachricht(id) {
  return `${betreffVon(id)}\n`;
}

function elternDesEigenen(commit, id, root) {
  const nachricht = git(["log", "-1", "--format=%B", commit], { cwd: root });
  if (nachricht.trimEnd() !== betreffVon(id)) return null;
  const [elter] = git(["log", "-1", "--format=%P", commit], { cwd: root }).trim().split(" ");
  return elter === "" ? null : elter;
}

function eigeneZwischenstaende(root, id) {
  const commits = [];
  let stand = kopf(root);
  let eltern = elternDesEigenen(stand, id, root);
  while (eltern !== null) {
    commits.push(stand);
    stand = eltern;
    eltern = elternDesEigenen(stand, id, root);
  }
  return { commits, basis: stand };
}

function gepushtIn(commit, root) {
  const zweige = git(["for-each-ref", "--contains", commit, "--format=%(refname)", "refs/remotes"], { cwd: root }).split("\n");
  return zweige.filter((zweig) => zweig !== "" && !BASISZWEIG.test(zweig));
}

function sicherungsName(phase, id, commit) {
  const teil = (text) => text.replace(KEIN_REFNAME, "-");
  return `${SICHERUNG}/${teil(phase)}/${teil(id)}/${commit}`;
}

export function stelleVorZwischenstaendenHer(root, phase, id) {
  const { commits, basis } = eigeneZwischenstaende(root, id);
  if (commits.length === 0) return null;
  const gepusht = gepushtIn(commits.at(-1), root);
  if (gepusht.length > 0) {
    return `Auftrag ${id}: Die eigenen Zwischenstände oben auf dem Branch sind schon gepusht (${gepusht.join(", ")}); lauf setzt sie nicht zurück, weil der nächste Push ein Force-Push wäre. Entscheide über den Stand von Hand.`;
  }
  const sicherung = sicherungsName(phase, id, commits[0]);
  git(["update-ref", sicherung, commits[0]], { cwd: root });
  hartZuruecksetzen(basis, root);
  console.error(`lauf: Oben auf dem Branch liegen eigene Zwischenstände von Auftrag ${id} (Commits: ${commits.length}). lauf misst gegen den Stand davor (${basis.slice(0, KURZ)}) und hat sie unter ${sicherung} gesichert (zurückholen: git reset --hard ${sicherung}).`);
  return null;
}
