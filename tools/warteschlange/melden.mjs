import { githubZugang } from "../auftrag/pruefer-github.mjs";
import { ciLauf, prNummerAus } from "./gleicher-stand.mjs";

const MASTER_ROT = "master-rot";
const BESITZER = ["Antonio20045", "jonas986"];
const RUECKNAHME_PRAEFIX = "revert/";
const ERFOLG = "success";
const KURZ = 7;
const EXIT_OK = 0;
const EXIT_FEHLER = 1;

async function offeneIssues(github, abfrage) {
  const alle = await github.alle(`/issues?state=open${abfrage}`, (liste) => liste);
  return alle.filter((issue) => !issue.pull_request);
}

async function issueOderKommentar(github, { vorhanden, neu, kommentar }) {
  if (vorhanden === undefined) {
    const angelegt = await github.sende("POST", "/issues", neu);
    console.log(`Neues Issue #${angelegt.number}: ${neu.title}`);
    return;
  }
  await github.sende("POST", `/issues/${vorhanden.number}/comments`, { body: kommentar });
  console.log(`Kommentar in #${vorhanden.number}: ${vorhanden.title}`);
}

export async function meldeMasterRot(github, { lauf, grund }) {
  const offen = await offeneIssues(github, `&labels=${MASTER_ROT}`);
  const beleg = `Lauf ${lauf.html_url}, Commit ${lauf.head_sha}. Grund: ${grund}.`;
  await issueOderKommentar(github, {
    vorhanden: offen[0],
    neu: {
      title: `master rot: ${lauf.head_sha.slice(0, KURZ)}`,
      body: `master ist rot, und es gibt keine automatische Rücknahme. ${beleg}\n`,
      labels: [MASTER_ROT],
      assignees: BESITZER,
    },
    kommentar: `Wieder rot: ${beleg}`,
  });
}

async function meldeHerausgefallen(github, lauf) {
  const nummer = prNummerAus(lauf.head_branch);
  const titel = `Aus der Warteschlange gefallen: #${nummer ?? "?"}`;
  const offen = await offeneIssues(github, "");
  const beleg = `Lauf ${lauf.html_url} endete ${lauf.conclusion ?? "ohne Ergebnis"} auf ${lauf.head_sha}.`;
  await issueOderKommentar(github, {
    vorhanden: offen.find((issue) => issue.title === titel),
    neu: {
      title: titel,
      body: `Der PR ist aus der Merge-Warteschlange gefallen und wird nicht von selbst neu eingereiht. ${beleg}\n`,
      assignees: BESITZER,
    },
    kommentar: `Wieder herausgefallen: ${beleg}`,
  });
}

export async function melden(_werte, _root, github = githubZugang()) {
  const lauf = await ciLauf(github, ["pull_request", "merge_group"]);
  if (lauf === null) {
    console.error("Der auslösende Lauf stammt nicht aus ci.yml dieses Repos.");
    return EXIT_FEHLER;
  }
  const ruecknahme = String(lauf.head_branch ?? "").startsWith(RUECKNAHME_PRAEFIX);
  if (lauf.event === "pull_request" && ruecknahme && lauf.conclusion === "failure") {
    await meldeMasterRot(github, { lauf, grund: `der Rücknahme-PR aus ${lauf.head_branch} ist rot` });
  } else if (lauf.event === "merge_group" && lauf.conclusion !== ERFOLG) {
    await meldeHerausgefallen(github, lauf);
  } else {
    console.log("Nichts zu melden.");
  }
  return EXIT_OK;
}
