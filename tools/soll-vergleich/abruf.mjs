import { PER_PAGE, api } from "../wochenbericht/github.mjs";

const HTTP_NOT_FOUND = 404;
const BASE64 = "base64";

function mitSeite(pfad, nummer) {
  const trenner = pfad.includes("?") ? "&" : "?";
  return `${pfad}${trenner}per_page=${PER_PAGE}&page=${nummer}`;
}

async function alleSeiten(pfad, auswahl) {
  const gesammelt = [];
  for (let nummer = 1; ; nummer += 1) {
    const teil = auswahl(await api(mitSeite(pfad, nummer)));
    if (!Array.isArray(teil)) throw new Error(`die GitHub-API auf GET ${pfad} keine Liste liefert`);
    gesammelt.push(...teil);
    if (teil.length < PER_PAGE) return gesammelt;
  }
}

async function codeownersInhalt(basis, zweig) {
  const pfad = `${basis}/contents/.github/CODEOWNERS?ref=${encodeURIComponent(zweig)}`;
  const antwort = await api(pfad);
  if (antwort?.encoding !== BASE64) {
    throw new Error(`die GitHub-API auf GET ${pfad} keinen base64-Inhalt liefert`);
  }
  return Buffer.from(antwort.content, BASE64).toString("utf8");
}

async function codeownersFehler(basis) {
  const pfad = `${basis}/codeowners/errors`;
  const antwort = await api(pfad);
  if (!Array.isArray(antwort?.errors)) {
    throw new Error(`die GitHub-API auf GET ${pfad} keine Fehlerliste liefert`);
  }
  return antwort.errors;
}

async function environment(basis, name) {
  const pfad = `${basis}/environments/${encodeURIComponent(name)}`;
  const antwort = await api(pfad, { accepted: [HTTP_NOT_FOUND] });
  if (antwort === null) return null;
  const regel = antwort.deployment_branch_policy;
  const eigeneRegeln = regel?.custom_branch_policies === true;
  const regeln = eigeneRegeln
    ? await alleSeiten(`${pfad}/deployment-branch-policies`, (seite) => seite?.branch_policies)
    : [];
  return {
    deployment_branch_policy: regel,
    branch_policies: regeln.map(({ name: muster, type }) => ({ name: muster, type })),
  };
}

async function repoStand(basis) {
  const [repo, meldungen] = await Promise.all([
    api(basis),
    api(`${basis}/private-vulnerability-reporting`),
  ]);
  return { ...repo, private_vulnerability_reporting: meldungen.enabled };
}

function weitereRulesets(basis, soll) {
  return Promise.all(
    soll.weitere_rulesets.map(({ id }) =>
      api(`${basis}/rulesets/${id}`, { accepted: [HTTP_NOT_FOUND] }),
    ),
  );
}

export async function istStand(soll) {
  const basis = `/repos/${soll.repo}`;
  const namen = Object.keys(soll.environments);
  const [ruleset, rulesets, weitere, repo, mitarbeiter, fehler, vorhanden, ...umgebungen] =
    await Promise.all([
      api(`${basis}/rulesets/${soll.ruleset.id}`),
      alleSeiten(`${basis}/rulesets`, (seite) => seite),
      weitereRulesets(basis, soll),
      repoStand(basis),
      alleSeiten(`${basis}/collaborators?affiliation=all`, (seite) => seite),
      codeownersFehler(basis),
      alleSeiten(`${basis}/environments`, (seite) => seite?.environments),
      ...namen.map((name) => environment(basis, name)),
    ]);
  const zweig = repo.default_branch ?? soll.repo_einstellungen.default_branch;
  return {
    ruleset,
    rulesets: { vorhanden: rulesets.map(({ id, name }) => ({ id, name })), einzeln: weitere },
    repo,
    mitarbeiter,
    codeowners: { inhalt: await codeownersInhalt(basis, zweig), fehler },
    environments: {
      vorhanden: vorhanden.map(({ name }) => name),
      einzeln: new Map(namen.map((name, index) => [name, umgebungen[index]])),
    },
  };
}
