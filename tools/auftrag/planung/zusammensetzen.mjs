import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { bereichSchluessel, istBereichsliste, phasenBefunde } from "../format.mjs";
import { befundeImOrdner } from "./abdeckung.mjs";
import { absichtAusPitch, pitchAbsichtBefunde } from "./absicht.mjs";
import { istText, liste, nutzenFuer, nutzenOhneAuftrag, schreibeJsonAtomar } from "./erkundung.mjs";
import { PITCH, nummernImOrdner } from "./nummern.mjs";
import { annahmeText } from "./planbericht.mjs";
import { schnittImOrdner } from "./schnitt.mjs";

const PHASE = "phase.json";
const FELDER = ["id", "art", "ziel", "bereich", "erwarteteDateien", "abnahme", "erwarteterFehler"];
const FEHLERFAELLE = /^Fehlerfälle:/;
const BERECHNETE_ZEILE = /^(Aufträge|Reihenfolge):/m;
const OHNE_BERICHTE = "auftragAusSchnitt braucht die Erkundungsberichte; ohne sie fiele nutzen still weg";

export function auftragAusSchnitt(eintrag, soll, berichte) {
  if (!Array.isArray(berichte)) throw new TypeError(OHNE_BERICHTE);
  const auftrag = Object.fromEntries(FELDER.filter((feld) => eintrag[feld] !== undefined).map((feld) => [feld, eintrag[feld]]));
  if (Array.isArray(eintrag.wasDarfNiePassieren)) auftrag.wasDarfNiePassieren = eintrag.wasDarfNiePassieren.map(({ satz }) => satz);
  if (istBereichsliste(eintrag.bereich)) auftrag.bereichsgrund = eintrag.bereichsgrund;
  auftrag.prueft = eintrag.prueft;
  if (Array.isArray(eintrag.prueft)) auftrag.szenarien = Object.fromEntries(eintrag.prueft.map((nummer) => [nummer, soll.get(nummer)?.text ?? ""]));
  const nutzen = nutzenFuer(berichte, liste(eintrag.erwarteteDateien));
  if (nutzen.length > 0) auftrag.nutzen = nutzen;
  auftrag.abhaengigVon = liste(eintrag.abhaengigVon).map(({ id }) => id);
  return auftrag;
}

export function auftraegeAusSchnitt(eintraege, soll, berichte) {
  return { auftraege: eintraege.map((eintrag) => auftragAusSchnitt(eintrag, soll, berichte)), befunde: nutzenOhneAuftrag(berichte, eintraege) };
}

function auftragsEintrag({ id, ziel }) {
  return `${id}: ${ziel}`;
}

function auftraegeZeile(eigene) {
  return `Aufträge: ${eigene.map(auftragsEintrag).join("; ")}`;
}

function reihenfolgeZeile(eigene) {
  const gruende = eigene.flatMap(({ id, abhaengigVon }) => liste(abhaengigVon).map((vorgaenger) => `${id} nach ${vorgaenger.id}: ${vorgaenger.grund}`));
  return `Reihenfolge: ${gruende.length > 0 ? gruende.join("; ") : "keine Vorgänger"}`;
}

export function eigeneAnnahmen(annahmen, eigene) {
  const kennungen = new Set(eigene.map(({ id }) => id));
  return liste(annahmen).filter(({ auftrag, nummer }) => (auftrag === undefined ? nummer === undefined : kennungen.has(auftrag)));
}

export function entwurfFuer(text, eigene, annahmen) {
  const zeilen = text.trimEnd().split("\n");
  const fehlerfaelle = zeilen.findIndex((zeile) => FEHLERFAELLE.test(zeile));
  const stelle = fehlerfaelle === -1 ? zeilen.length : fehlerfaelle;
  const annahmeZeilen = eigeneAnnahmen(annahmen, eigene).map(annahmeText);
  return [...zeilen.slice(0, stelle), ...annahmeZeilen, auftraegeZeile(eigene), ...zeilen.slice(stelle), reihenfolgeZeile(eigene)].join("\n");
}

function entwurfText(entwuerfe, bereich) {
  return istText(entwuerfe[bereich]) ? entwuerfe[bereich] : "";
}

function entwurfBefunde(bereiche, entwuerfe) {
  const fehlend = bereiche.filter((bereich) => entwurfText(entwuerfe, bereich) === "").map((bereich) => `Entwurf für den Bereich ${bereich} fehlt`);
  const doppelt = bereiche.filter((bereich) => BERECHNETE_ZEILE.test(entwurfText(entwuerfe, bereich))).map((bereich) => `Entwurf für ${bereich} enthält schon eine Zeile „Aufträge:“ oder „Reihenfolge:“; die rechnet das Zusammensetzen aus der Schnittliste`);
  const fremd = Object.keys(entwuerfe).filter((bereich) => !bereiche.includes(bereich)).map((bereich) => `Entwurf für ${bereich} gehört zu keinem Auftrag der Schnittliste`);
  return [...fehlend, ...doppelt, ...fremd];
}

function namenBefunde(gemeinsameNamen, entwuerfe) {
  return liste(gemeinsameNamen).flatMap(({ name, anbieter, nutzer }) =>
    [anbieter, nutzer].map(bereichSchluessel).filter((bereich) => !entwurfText(entwuerfe, bereich).includes(name)).map((bereich) => `gemeinsamer Name ${name} steht nicht wörtlich im Entwurf von ${bereich}`),
  );
}

export async function setzePhaseZusammen(ordner, { schnitt, berichte, entwuerfe, root, issue }) {
  const pruefung = await schnittImOrdner(ordner, { schnitt, berichte, root });
  if (pruefung.befunde.length > 0) return { befunde: pruefung.befunde };
  const pitch = readFileSync(join(ordner, PITCH), "utf8");
  const absichtFehlt = pitchAbsichtBefunde(pitch);
  if (absichtFehlt.length > 0) return { befunde: absichtFehlt };
  const { soll } = nummernImOrdner(ordner);
  const { auftraege, befunde: nutzenBefunde } = auftraegeAusSchnitt(schnitt.auftraege, soll, berichte);
  const bereiche = [...new Set(schnitt.auftraege.map(({ bereich }) => bereichSchluessel(bereich)))];
  const vorab = [...nutzenBefunde, ...entwurfBefunde(bereiche, entwuerfe), ...namenBefunde(schnitt.gemeinsameNamen, entwuerfe)];
  if (vorab.length > 0) return { befunde: vorab };
  const entwurf = Object.fromEntries(bereiche.map((bereich) => [bereich, entwurfFuer(entwuerfe[bereich], schnitt.auftraege.filter((eintrag) => bereichSchluessel(eintrag.bereich) === bereich), pruefung.annahmen)]));
  const phase = { phase: basename(resolve(ordner)), ...(issue === undefined ? {} : { issue }), absicht: absichtAusPitch(pitch), entwurf, auftraege };
  const befunde = [...phasenBefunde(phase, root), ...befundeImOrdner(ordner, phase).befunde];
  if (befunde.length === 0) schreibeJsonAtomar(join(ordner, PHASE), phase);
  return { befunde, phase };
}
