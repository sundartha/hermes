import { resolve } from "node:path";

import { FREIGABE_GRUENDE, grund } from "./freigabe-gruende.mjs";
import { GESTOPPT, ROTPROBEN_DIR, cases, fakeGitHub, manifests, matches, runCase } from "./pruefungen-messen.mjs";

function betroffen(id, manifest, geaendert) {
  const eigene = [`${ROTPROBEN_DIR}/${id}/`, ...manifest.pfade];
  return geaendert.some((pfad) => eigene.some((muster) => matches(muster, pfad)));
}

async function nichtGestoppt(kontext, id, manifest) {
  const befunde = [];
  for (const [pfad, fall] of cases(kontext.root, `${ROTPROBEN_DIR}/${id}`)) {
    const urteil = await runCase(kontext, manifest.probe, fall);
    if (urteil !== GESTOPPT) befunde.push({ titel: manifest.titel, pfad, urteil });
  }
  return befunde;
}

function alsGrund({ titel, pfad, urteil }) {
  return grund(FREIGABE_GRUENDE.ROTPROBE, `Die Rot-Probe ${pfad} der Prüfung „${titel}“ ist nicht mehr rot (${urteil}).`);
}

export async function rotprobenDerGeaendertenPruefungen(basis, geaendert) {
  const pruefungen = [...manifests(".")].filter(([id, manifest]) => betroffen(id, manifest, geaendert));
  if (pruefungen.length === 0) return [];
  const server = await fakeGitHub();
  try {
    const kontext = { root: resolve("."), fake: `http://127.0.0.1:${server.address().port}`, basis };
    const befunde = [];
    for (const [id, manifest] of pruefungen) befunde.push(...(await nichtGestoppt(kontext, id, manifest)));
    return befunde.map(alsGrund);
  } finally {
    server.close();
  }
}
