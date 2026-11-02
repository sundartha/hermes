import { readFileSync } from "node:fs";
import { env } from "node:process";

import { APPROVERS } from "./akteure.mjs";
import { zweckBlock } from "./auftrag/zweck.mjs";
import { getJson, latestApprovals, repositoryName } from "./testschutz/github.mjs";
import {
  git,
  holeKopf,
  patchIdZwischen,
  prNummerAus,
  zusammenfuehrungsbasis,
} from "./warteschlange/gleicher-stand.mjs";

const ZWECK = "github/approve-inhalt";
const PR_EREIGNIS = "pull_request";
const WARTESCHLANGEN_EREIGNIS = "merge_group";
const REVIEWS_JE_SEITE = 100;
const KURZ = 7;
const COMMIT = "^{commit}";
const EXIT_OK = 0;
const EXIT_ROT = 1;
const NEU_NOETIG = "Neues Approve nötig.";

function ereignis() {
  try {
    return JSON.parse(readFileSync(env.GITHUB_EVENT_PATH ?? "", "utf8"));
  } catch (fehler) {
    throw new Error(`Das Ereignis aus GITHUB_EVENT_PATH ist nicht lesbar: ${fehler.message}`, {
      cause: fehler,
    });
  }
}

function auftragAus(name, daten) {
  if (name === PR_EREIGNIS) {
    const { number, base } = daten.pull_request ?? {};
    return { basis: base?.sha, nummer: number, warteschlange: false };
  }
  if (name === WARTESCHLANGEN_EREIGNIS) {
    const { base_sha: basis, head_ref: ref } = daten.merge_group ?? {};
    return { basis, nummer: prNummerAus(ref), warteschlange: true };
  }
  throw new Error(
    `Das Ereignis ${JSON.stringify(name ?? "")} ist weder ${PR_EREIGNIS} noch ${WARTESCHLANGEN_EREIGNIS}.`,
  );
}

function auftrag() {
  const name = env.GITHUB_EVENT_NAME;
  const gelesen = auftragAus(name, ereignis());
  if (!Number.isInteger(gelesen.nummer) || gelesen.nummer <= 0) {
    throw new Error(`Keine PR-Nummer im Ereignis ${name}.`);
  }
  if (typeof gelesen.basis !== "string" || gelesen.basis === "") {
    throw new Error(`Keine Basis im Ereignis ${name}.`);
  }
  return gelesen;
}

function pruefeCommit(sha) {
  git(["cat-file", "-e", sha + COMMIT]);
}

function vorhanden(sha) {
  try {
    pruefeCommit(sha);
    return true;
  } catch {
    return false;
  }
}

function stellBereit(sha) {
  if (vorhanden(sha)) return;
  git(["fetch", "--quiet", "--no-tags", "origin", sha]);
  pruefeCommit(sha);
}

function inhaltVon(basis, stand) {
  stellBereit(stand);
  return patchIdZwischen(zusammenfuehrungsbasis(basis, stand), stand);
}

function inhaltJetzt({ basis, nummer, warteschlange }, kopf) {
  if (warteschlange) return { patchId: patchIdZwischen(basis, "HEAD"), wo: "in der Warteschlange" };
  holeKopf(nummer, kopf);
  return { patchId: inhaltVon(basis, kopf), wo: `am Kopf ${kopf.slice(0, KURZ)}` };
}

function vergleiche(basis, jetzt, approve) {
  const wer = approve.user.login;
  const stand = String(approve.commit_id ?? "");
  const kurz = stand.slice(0, KURZ);
  let patchId;
  try {
    patchId = inhaltVon(basis, stand);
  } catch (fehler) {
    return {
      gleich: false,
      zeile: `Der Stand ${kurz} aus dem Approve von ${wer} ist nicht lesbar: ${fehler.message.split("\n")[0]}`,
    };
  }
  if (patchId === jetzt.patchId) {
    return {
      gleich: true,
      zeile: `Approve gleicher Inhalt: ja, Approve von ${wer} auf dem Stand ${kurz}, Patch-ID ${patchId} gleich dem Inhalt ${jetzt.wo}.`,
    };
  }
  return {
    gleich: false,
    zeile: `Der Inhalt ${jetzt.wo} weicht vom Stand ${kurz} ab, den ${wer} freigegeben hat (Patch-ID ${patchId || "leer"} gegen ${jetzt.patchId || "leer"}).`,
  };
}

async function approves(nummer) {
  const { full } = repositoryName();
  const pull = await getJson(`/repos/${full}/pulls/${nummer}`);
  const reviews = await getJson(
    `/repos/${full}/pulls/${nummer}/reviews?per_page=${REVIEWS_JE_SEITE}`,
  );
  return { kopf: String(pull?.head?.sha ?? ""), freigaben: latestApprovals(reviews, APPROVERS) };
}

function rot(zeilen) {
  for (const zeile of [...zeilen, NEU_NOETIG, ...zweckBlock(ZWECK)]) console.log(zeile);
  return EXIT_ROT;
}

async function pruefe() {
  const gelesen = auftrag();
  const { kopf, freigaben } = await approves(gelesen.nummer);
  if (freigaben.length === 0) {
    return rot([
      `Es gibt kein gültiges Approve von ${APPROVERS.join(" oder ")} im PR #${gelesen.nummer}.`,
    ]);
  }
  const jetzt = inhaltJetzt(gelesen, kopf);
  if (jetzt.patchId === "")
    return rot([`Der PR #${gelesen.nummer} hat ${jetzt.wo} keinen Inhalt.`]);
  const ergebnisse = freigaben.map((approve) => vergleiche(gelesen.basis, jetzt, approve));
  const treffer = ergebnisse.find(({ gleich }) => gleich);
  if (treffer === undefined) return rot(ergebnisse.map(({ zeile }) => zeile));
  console.log(treffer.zeile);
  return EXIT_OK;
}

try {
  process.exitCode = await pruefe();
} catch (fehler) {
  console.log(`Approve gleicher Inhalt: Abbruch: ${fehler.message}`);
  process.exitCode = rot([]);
}
