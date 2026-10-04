import { gruen, rot } from "./bericht.mjs";
import { befehl, bereinigt, git } from "./git.mjs";

const ZIEL = "refs/heads/master";
const REMOTE = "upstream";
const REGELVERSTOSS = /GH013|GH006|repository rule violations/i;
const VERALTET = /fetch first|non-fast-forward/i;
const GRUNDZEILE = /denied|error|fatal|rejected|declined/i;
const NACHRICHT = [
  "Prüfe, dass ein direkter Push auf master abgelehnt wird",
  "",
  "Warum: Die wöchentliche Rot-Probe zeigt, dass GitHub einen direkten Push auf master",
  "ablehnt. Dieser leere Commit darf nie auf master landen; er verändert master",
  "inhaltlich nicht.",
  "",
  "Paket: 20",
  "",
].join("\n");

function masterAuf(adresse) {
  const zeile = git(["ls-remote", adresse, ZIEL]).trim();
  return zeile.split(/\s/)[0] ?? "";
}

function leererCommit(adresse) {
  git(["fetch", "-q", "--no-tags", adresse, ZIEL]);
  const basis = git(["rev-parse", "FETCH_HEAD"]).trim();
  const baum = git(["rev-parse", `${basis}:`]).trim();
  return git(["commit-tree", baum, "-p", basis, "-F", "-"], NACHRICHT).trim();
}

function versuch(adresse) {
  const vorher = masterAuf(adresse);
  const commit = leererCommit(adresse);
  const push = befehl("git", ["push", "--no-verify", REMOTE, `${commit}:${ZIEL}`]);
  const ausgabe = `${push.stdout}\n${push.stderr}`;
  return { vorher, commit, status: push.status, ausgabe, nachher: masterAuf(adresse) };
}

function veraltet({ status, ausgabe }) {
  return status !== 0 && !REGELVERSTOSS.test(ausgabe) && VERALTET.test(ausgabe);
}

function grund(ausgabe) {
  const zeilen = ausgabe.split("\n").filter((zeile) => zeile.trim() !== "");
  return bereinigt(zeilen.find((zeile) => GRUNDZEILE.test(zeile)) ?? zeilen.at(-1) ?? "keine Ausgabe");
}

function urteil({ vorher, commit, status, ausgabe, nachher }) {
  if (status === 0 || nachher === commit) {
    const text = `SPERRE FEHLT: direkter Push auf master wurde angenommen (leerer Commit ${commit}, ändert keinen Inhalt)`;
    return { ...rot(text), sperreFehlt: true };
  }
  if (REGELVERSTOSS.test(ausgabe) && nachher === vorher) {
    return gruen("gestoppt (GitHub lehnt den Push wegen der Regeln ab, master unverändert)");
  }
  if (nachher !== vorher) return rot("falscher Grund: master hat sich während der Probe verändert");
  return rot(`falscher Grund: ${grund(ausgabe)}`);
}

export function pushProbe() {
  const adresse = git(["remote", "get-url", "--push", REMOTE]).trim();
  const erster = versuch(adresse);
  return urteil(veraltet(erster) ? versuch(adresse) : erster);
}
