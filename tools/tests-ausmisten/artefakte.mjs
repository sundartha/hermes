import { entpacke } from "../auftrag/pruefer-gedaechtnis.mjs";

export const PLAN = "plan";
const AUSMISTEN_NAMEN = /^(?:plan|basis|branch)(?:-|$)/;

export function paketName(art, paket) {
  return `${art}-${paket}`;
}

function gefundeneArtefakte(liste) {
  const nachName = new Map();
  for (const artefakt of liste) {
    if (!AUSMISTEN_NAMEN.test(artefakt.name ?? "")) continue;
    nachName.set(artefakt.name, [...(nachName.get(artefakt.name) ?? []), artefakt]);
  }
  return nachName;
}

function namensFehler(nachName, erwartet) {
  const fehler = [];
  for (const name of erwartet) {
    const anzahl = nachName.get(name)?.length ?? 0;
    if (anzahl === 0) fehler.push(`Artefakt ${name} fehlt`);
    if (anzahl > 1) fehler.push(`Artefakt ${name} gibt es ${anzahl}-mal`);
  }
  const fremd = [...nachName.keys()].filter((name) => !erwartet.includes(name));
  return [...fehler, ...fremd.map((name) => `Artefakt ${name} ist nicht geplant`)];
}

function einzigeDatei(puffer, name) {
  const dateien = entpacke(puffer);
  const erwartet = `${name}.json`;
  if (dateien.size !== 1 || !dateien.has(erwartet)) {
    throw new Error(`Artefakt ${name} enthält nicht genau die Datei ${erwartet}`);
  }
  return dateien.get(erwartet).toString("utf8");
}

export async function artefaktListe(github, laufId) {
  return github.alle(`/actions/runs/${laufId}/artifacts`, (antwort) => antwort.artifacts);
}

export async function ladeArtefakte(github, { laufId, erwartet }) {
  const nachName = gefundeneArtefakte(await artefaktListe(github, laufId));
  const fehler = namensFehler(nachName, erwartet);
  if (fehler.length > 0) return { fehler, texte: new Map() };
  const texte = new Map();
  for (const name of erwartet) {
    const [{ id }] = nachName.get(name);
    try {
      texte.set(name, einzigeDatei(await github.roh(`/actions/artifacts/${id}/zip`), name));
    } catch (grund) {
      fehler.push(grund.message);
    }
  }
  return { fehler, texte };
}
