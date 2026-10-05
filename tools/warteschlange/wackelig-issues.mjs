import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { githubZugang } from "../auftrag/pruefer-github.mjs";
import { ciLauf } from "./gleicher-stand.mjs";

const BELEG_DATEI = "wackelig.json";
const LABEL = "wackelig";
const TESTDATEI = /^test\/[A-Za-z0-9._/-]+\.test\.js$/;
const ELTERNORDNER = "..";
const MAX_TESTNAME = 200;
const ERSTES_DRUCKBARES = 32;
const LOESCHZEICHEN = 127;
const VERBOTEN_IM_NAMEN = "`";
const EREIGNISSE = ["pull_request", "merge_group", "push"];
const EXIT_OK = 0;
const EXIT_FEHLER = 1;

function hatSteuerzeichen(text) {
  return [...text].some((zeichen) => {
    const code = zeichen.codePointAt(0);
    return code < ERSTES_DRUCKBARES || code === LOESCHZEICHEN;
  });
}

function liegtAufMaster(datei, root) {
  return spawnSync("git", ["cat-file", "-e", `HEAD:${datei}`], { cwd: root }).status === 0;
}

export function gueltigerEintrag(eintrag, root) {
  const { datei, test } = eintrag ?? {};
  if (typeof datei !== "string" || !TESTDATEI.test(datei)) return false;
  if (datei.split("/").includes(ELTERNORDNER)) return false;
  if (typeof test !== "string" || test === "" || test.length > MAX_TESTNAME) return false;
  if (hatSteuerzeichen(test) || test.includes(VERBOTEN_IM_NAMEN)) return false;
  return liegtAufMaster(datei, root);
}

function lies(pfad) {
  try {
    return JSON.parse(readFileSync(pfad, "utf8"));
  } catch {
    console.log(`Nicht lesbar und übersprungen: ${pfad}`);
    return null;
  }
}

export function leseBelege(ordner) {
  if (!existsSync(ordner)) return [];
  const pfade = readdirSync(ordner, { recursive: true })
    .map(String)
    .filter((pfad) => basename(pfad) === BELEG_DATEI)
    .sort();
  return pfade.map((pfad) => lies(join(ordner, pfad))).filter((beleg) => beleg !== null);
}

export function eintraegeAus(belege, feld, root) {
  const eintraege = belege.flatMap((beleg) => (Array.isArray(beleg?.[feld]) ? beleg[feld] : []));
  return eintraege.filter((eintrag) => {
    const gueltig = gueltigerEintrag(eintrag, root);
    if (!gueltig) console.log(`Ungültiger Eintrag unter ${feld} übersprungen.`);
    return gueltig;
  });
}

function belegText(lauf) {
  return `Commit ${lauf.head_sha}, Lauf ${lauf.html_url}, Ereignis ${lauf.event}.`;
}

function neuerText({ datei, test }, lauf) {
  return [
    "Ein Test war im ersten Lauf rot und im zweiten Lauf auf demselben Commit grün.",
    "",
    `- Datei: \`${datei}\``,
    `- Test: \`${test}\``,
    `- Commit: ${lauf.head_sha}`,
    `- Lauf: ${lauf.html_url}`,
    `- Ereignis: ${lauf.event}`,
    "",
    "Ein Fix mit diesem Test als Abnahmetest schließt dieses Issue (Closes #<Nummer dieses Issues> im PR); Testwirkung 5 Läufe ohne Wackeln.",
    "",
  ].join("\n");
}

function titelVon({ datei, test }) {
  return `Wackelig: ${datei} › ${test}`;
}

async function halteFest(github, { eintrag, lauf, issues }) {
  const titel = titelVon(eintrag);
  const vorhanden = issues.find((issue) => issue.title === titel);
  if (vorhanden === undefined) {
    const neu = await github.sende("POST", "/issues", {
      title: titel,
      body: neuerText(eintrag, lauf),
      labels: [LABEL],
    });
    issues.push({ ...neu, title: titel, state: "open" });
    console.log(`Neues Issue: ${titel}`);
    return;
  }
  if (vorhanden.state === "closed") {
    await github.sende("PATCH", `/issues/${vorhanden.number}`, { state: "open" });
    vorhanden.state = "open";
  }
  const body = `Wieder wackelig: ${belegText(lauf)}`;
  await github.sende("POST", `/issues/${vorhanden.number}/comments`, { body });
  console.log(`Beleg ergänzt in #${vorhanden.number}: ${titel}`);
}

export async function wackeligeIssues({ ordner }, root, github = githubZugang()) {
  const lauf = await ciLauf(github, EREIGNISSE);
  if (lauf === null) {
    console.error("Der auslösende Lauf stammt nicht aus ci.yml dieses Repos.");
    return EXIT_FEHLER;
  }
  const gefunden = eintraegeAus(leseBelege(ordner), "wackelig", root);
  const eintraege = [...new Map(gefunden.map((eintrag) => [titelVon(eintrag), eintrag])).values()];
  if (eintraege.length === 0) {
    console.log("Keine wackeligen Tests in diesem Lauf.");
    return EXIT_OK;
  }
  const alle = await github.alle(`/issues?labels=${LABEL}&state=all`, (liste) => liste);
  const issues = alle.filter((issue) => !issue.pull_request);
  for (const eintrag of eintraege) await halteFest(github, { eintrag, lauf, issues });
  return EXIT_OK;
}
