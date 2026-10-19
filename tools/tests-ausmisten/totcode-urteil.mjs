import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";

import { pruefsumme } from "./entscheiden.mjs";
import { bildeAlle, entscheideTotcode, zerlegeSchluessel } from "./zeilenabbildung.mjs";

export const GRUEN = "grün";
export const ROT = "rot";
export const ART = {
  plan: "totcode-plan",
  basis: "totcode-basis",
  kopf: "totcode-kopf",
  rotprobe: "totcode-rotprobe",
  ergebnis: "totcode-ergebnis",
};
const SHA = /^[0-9a-f]{40}$/;
const PRUEFSUMME = /^[0-9a-f]{64}$/;

export function stufenName(art, paket) {
  return paket === undefined ? art : `${art}-${paket}`;
}

export function stufenInhalt({ art, plan, auswahl }, werte) {
  const { nummer, dateien, teil } = auswahl;
  const paket = nummer === undefined ? {} : { paket: nummer, dateien, teil: teil ?? null };
  return { art: ART[art], basis: plan.basis, kopf: plan.kopf, ...paket, ...werte };
}

function passtZu(inhalt, art, erwartet) {
  if (inhalt?.art !== ART[art] || !SHA.test(inhalt.basis) || !SHA.test(inhalt.kopf)) return false;
  return (
    erwartet === undefined || (inhalt.basis === erwartet.basis && inhalt.kopf === erwartet.kopf)
  );
}

function gelesenesJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function pruefeStufe({ text, summe, art, erwartet, paket }) {
  const name = stufenName(art, paket);
  if (text === undefined) return { fehler: `${name}.json fehlt` };
  if (!PRUEFSUMME.test(summe ?? "") || pruefsumme(text) !== summe)
    return { fehler: `${name}.json passt nicht zur Prüfsumme` };
  const inhalt = gelesenesJson(text);
  if (!passtZu(inhalt, art, erwartet) || inhalt.paket !== paket)
    return { fehler: `${name}.json gehört nicht zu dieser Messung` };
  return { inhalt };
}

export function leseStufe(daten, { art, erwartet, paket }) {
  const name = stufenName(art, paket);
  const datei = join(daten, name, `${name}.json`);
  const text = existsSync(datei) ? readFileSync(datei, "utf8") : undefined;
  const summe = env[`${art.toUpperCase()}_PRUEFSUMME`] ?? "";
  return pruefeStufe({ text, summe, art, erwartet, paket });
}

export function vereinigeTeile(teile) {
  const gates = {};
  for (const teil of teile)
    for (const [name, stati] of Object.entries(teil.gates))
      gates[name] = { ...gates[name], ...stati };
  return {
    mutanten: Object.assign({}, ...teile.map(({ mutanten }) => mutanten)),
    gates,
    ausgenommen: teile.flatMap(({ ausgenommen }) => ausgenommen),
  };
}

function istVerschoben(schluessel, verschoben) {
  const { datei, von, bis } = zerlegeSchluessel(schluessel);
  const zeilen = new Set(verschoben[datei] ?? []);
  const spanne = Array.from({ length: bis.zeile - von.zeile + 1 }, (_leer, i) => von.zeile + i);
  return spanne.every((zeile) => zeilen.has(zeile));
}

function urteilsGruende(stati, kopfStati, plan) {
  const { abbildung, verschoben } = plan;
  const urteil = entscheideTotcode({ basis: stati, kopf: kopfStati, abbildung });
  const verschobene = bildeAlle({ basis: stati, abbildung })
    .entfallen.filter((schluessel) => istVerschoben(schluessel, verschoben))
    .map(
      (schluessel) =>
        `Mutant gilt als entfallen, sein Code steht im PR aber an anderer Stelle neu (verschobener Code): ${schluessel}`,
    );
  return [...urteil.gruende, ...verschobene];
}

function gateGruende({ plan, basis: basisDaten, kopf: kopfDaten }) {
  return Object.entries(basisDaten.gates).flatMap(([name, stati]) =>
    urteilsGruende(stati, kopfDaten.gates[name] ?? {}, plan).map(
      (grund) => `Gate ${name}: ${grund}`,
    ),
  );
}

function probeGrund({ datei, fall, grund }) {
  return fall === undefined
    ? `Rotprobe: ${datei}: ${grund}`
    : `Rotprobe: ${datei}: „${fall}“: ${grund}`;
}

export function gruendeDer(stand) {
  const { plan, basis: basisDaten, kopf: kopfDaten } = stand;
  const ausgenommen = [...basisDaten.ausgenommen, ...kopfDaten.ausgenommen];
  return [
    ...plan.verstoesse.map(({ datei, grund }) => `${datei}: ${grund}`),
    ...urteilsGruende(basisDaten.mutanten, kopfDaten.mutanten, plan),
    ...gateGruende(stand),
    ...ausgenommen.map(
      ({ test, name }) => `Testfall bei der Messung ausgenommen: ${test}: ${name}`,
    ),
    ...kopfDaten.rotprobe.verstoesse.map(probeGrund),
  ];
}

export function ergebnisInhalt(plan, gruende) {
  return {
    art: ART.ergebnis,
    basis: plan?.basis ?? null,
    kopf: plan?.kopf ?? null,
    liste: plan?.liste ?? [],
    urteil: gruende.length === 0 ? GRUEN : ROT,
    gruende,
  };
}
