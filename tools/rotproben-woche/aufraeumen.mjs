import { repo, repoPages, repository } from "../wochenbericht/github.mjs";
import { FAELLE, branchFuer } from "./faelle.mjs";

const HTTP_NICHT_GEFUNDEN = 404;
const HTTP_NICHT_VERARBEITBAR = 422;

export async function aufraeumen() {
  const branches = FAELLE.map(({ fall }) => branchFuer(fall));
  const offen = await repoPages("/pulls?state=open");
  const proben = offen.filter(
    ({ head }) => branches.includes(head.ref) && head.repo?.full_name === repository(),
  );
  for (const { number } of proben) {
    await repo(`/pulls/${number}`, { method: "PATCH", body: { state: "closed" } });
  }
  for (const branch of branches) {
    const accepted = [HTTP_NICHT_GEFUNDEN, HTTP_NICHT_VERARBEITBAR];
    await repo(`/git/refs/heads/${branch}`, { method: "DELETE", accepted });
  }
  const nummern = proben.map(({ number }) => `#${number}`).join(", ") || "keine";
  return `Aufgeräumt: offene Proben-PRs geschlossen: ${nummern}; Branches ${branches.join(", ")} gelöscht oder schon weg.`;
}
