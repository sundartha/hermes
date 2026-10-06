import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

import { githubZugang } from "../auftrag/pruefer-github.mjs";
import { nimmGithubToken } from "./github.mjs";
import { fuehreAus } from "./werkzeuge.mjs";
import { gitAusgabe } from "../auftrag/pruefer-auswahl.mjs";
import { GEAENDERT, WEITER, ergebnisVon, laufAdresse, laufNummer, leseJson, schreibeJson, setzeAusgaben } from "./ausgabe.mjs";
import { commitNachricht } from "./nachricht.mjs";
import { AGENT_DATEI, AGENT_ORDNER } from "./agentenlauf.mjs";
import { merkeVor, patchPruefsumme, vorgemerkteAenderungen } from "./patch.mjs";
import { committeAlsBot, dateiVerstoss, gewaehlterPatch } from "./pruefen.mjs";
import { BRANCH_PRAEFIX, prTitel } from "./prs.mjs";
import { gitSchutzLage } from "./schutz.mjs";
import { ORDNER } from "./vorpruefen.mjs";
import { DATEI as ZIEL } from "./waehlen.mjs";

export const PR_ORDNER = "pr";
export const PR_DATEI = "pr.json";
const ANMELDUNG = '!f() { echo username=x-access-token; echo "password=$GH_TOKEN"; }; f';
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;

function geprueftesZiel(ordner) {
  const ziel = leseJson(join(ordner, ORDNER), ZIEL);
  if (ziel?.ausgang !== WEITER) throw new Error("es gibt kein Ziel für einen PR");
  return ziel;
}

function erwartetePruefsumme(ordner) {
  const vomAgenten = leseJson(join(ordner, AGENT_ORDNER), AGENT_DATEI) !== null;
  return (vomAgenten ? env.AGENT_PRUEFSUMME : env.ZIEL_PRUEFSUMME) ?? "";
}

export function branchFuer(ziel) {
  return `${BRANCH_PRAEFIX}${ziel.sorte}-${laufNummer()}`;
}

export function prText(ziel) {
  return [
    `Nächtliches Aufräumen, Sorte ${ziel.sorte}, genau eine Datei: \`${ziel.datei}\`.`,
    "",
    ...ziel.zielbefunde.map((text) => `- ${text}`),
    "",
    `Ziel gewählt, geändert und geprüft im Lauf ${laufAdresse()}. Der Commit trägt die Zeilen Auftrag, Art und Sorte; der Prüfer prüft ihn wie jeden Auftrags-Commit.`,
    "",
  ].join("\n");
}

export async function committe({ ordner }, root) {
  const ziel = geprueftesZiel(ordner);
  const patch = gewaehlterPatch(ordner);
  const erwartet = erwartetePruefsumme(ordner);
  if (erwartet === "" || patchPruefsumme(readFileSync(patch, "utf8")) !== erwartet) {
    console.error("Commit: Die Prüfsumme des Patches passt nicht zur Ausgabe des Jobs, der ihn erzeugt hat.");
    return EXIT_ROT;
  }
  merkeVor(root, patch);
  const verstoss = dateiVerstoss(vorgemerkteAenderungen(root), ziel, gitSchutzLage(root));
  if (verstoss) {
    console.error(`Commit: Verstoß ${verstoss.id}: ${verstoss.text}`);
    return EXIT_ROT;
  }
  committeAlsBot(root, commitNachricht(ziel, new Date()));
  console.log(`Commit: ${gitAusgabe(["log", "-1", "--format=%h %s"], root).trim()}`);
  return EXIT_GRUEN;
}

function mitToken(befehl, root, { token, name }) {
  const lauf = fuehreAus(befehl, root, { umgebung: { ...env, GH_TOKEN: token } });
  if (lauf.status !== EXIT_GRUEN) throw new Error(`${name} ist mit Exit ${lauf.status} gescheitert: ${lauf.stderr.trim()}`);
}

export async function oeffnePr({ ordner }, root, { token = nimmGithubToken(), github = githubZugang({ token }) } = {}) {
  const ziel = geprueftesZiel(ordner);
  const branch = branchFuer(ziel);
  mitToken(["git", "-c", "credential.helper=", "-c", `credential.helper=${ANMELDUNG}`, "push", "origin", `HEAD:refs/heads/${branch}`], root, { token, name: "git push" });
  const pr = await github.sende("POST", "/pulls", { title: prTitel(ziel.sorte, ziel.datei), head: branch, base: "master", body: prText(ziel) });
  mitToken(["gh", "pr", "merge", String(pr.number), "--repo", github.repo, "--auto"], root, { token, name: "gh pr merge --auto" });
  const ergebnis = { ...ergebnisVon(GEAENDERT, ""), pr: pr.number, adresse: pr.html_url ?? "", branch };
  schreibeJson(join(ordner, PR_ORDNER), PR_DATEI, ergebnis);
  setzeAusgaben({ ausgang: GEAENDERT, pr: pr.number });
  console.log(`PR #${pr.number} aus ${branch} angelegt, Auto-Merge eingeschaltet.`);
  return EXIT_GRUEN;
}
