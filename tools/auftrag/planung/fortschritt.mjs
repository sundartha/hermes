import { liste } from "./erkundung.mjs";

export const RUECKSENDUNGEN = 3;

const SKRIPT_REGEL = /^Regel ([^:]+):/u;
const PRUEFER_REGEL = /^([a-z-]+):[^\s:]/u;
const WERT_IM_TEXT = /[\d/]/u;
const PLATZHALTER = "#";
const OHNE_REGEL = "Text";
const SCHLUESSEL_TRENNER = ":";
const NUMMERN_TRENNER = "+";
const WORT = /[\w-]+/gu;

function woerterDes(text) {
  return new Set(text.match(WORT) ?? []);
}

function regelDes(befund) {
  if (typeof befund === "string") return (SKRIPT_REGEL.exec(befund) ?? PRUEFER_REGEL.exec(befund))?.[1] ?? vorlageDes(befund);
  return String(befund?.schluessel ?? OHNE_REGEL).split(SCHLUESSEL_TRENNER)[0];
}

function textDes(befund) {
  if (typeof befund === "string") return befund;
  return `${befund?.schluessel}: ${befund?.befund}`;
}

function vorlageDes(text) {
  return text.split(" ").map((teil) => (WERT_IM_TEXT.test(teil) ? PLATZHALTER : teil)).join(" ");
}

function inhaltDes(auftrag) {
  const nummern = liste(auftrag.prueft).toSorted();
  if (nummern.length > 0) return `Auftrag[${nummern.join(NUMMERN_TRENNER)}]`;
  return `Auftrag[${auftrag.art}:${auftrag.bereich}:${auftrag.id}]`;
}

export function befundSchluessel(befund, schnitt, soll) {
  const text = textDes(befund);
  const regel = regelDes(befund);
  const woerter = woerterDes(text);
  const auftraege = liste(schnitt?.auftraege).filter((auftrag) => auftrag?.id !== undefined && woerter.has(String(auftrag.id)));
  const nummern = [...(soll?.keys() ?? [])].filter((nummer) => woerter.has(String(nummer))).toSorted();
  if (auftraege.length > 0) {
    const kennungen = auftraege.map(({ id }) => id).toSorted();
    const inhalte = auftraege.map(inhaltDes).toSorted();
    return { roh: JSON.stringify([regel, kennungen]), inhalt: JSON.stringify([regel, inhalte]) };
  }
  if (nummern.length === 0) return { roh: text, inhalt: text };
  const ohneAuftrag = JSON.stringify([regel, nummern]);
  return { roh: ohneAuftrag, inhalt: ohneAuftrag };
}

export class Fortschritt {
  constructor(art, grenze = RUECKSENDUNGEN) {
    this.art = art;
    this.grenze = grenze;
    this.runden = [];
    this.gesehen = new Set();
    this.ende = null;
  }

  ursache(schluessel, zahl) {
    const wieder = [...new Set(schluessel.filter(({ roh, inhalt }) => this.gesehen.has(roh) || this.gesehen.has(inhalt)).map(({ roh }) => roh))];
    if (wieder.length > 0) return `wiederkehrend: ${wieder.join("; ")}`;
    const davor = this.runden.at(-1);
    if (davor !== undefined && zahl >= davor.zahl) return `die Zahl der Befunde sank nicht (${davor.zahl} → ${zahl})`;
    return this.runden.length >= this.grenze ? `nach ${this.grenze} Rücksendungen` : null;
  }

  endeNachRunde(befunde, schnitt, soll) {
    const schluessel = befunde.map((befund) => befundSchluessel(befund, schnitt, soll));
    const ursache = this.ursache(schluessel, befunde.length);
    const ruecksendungen = this.runden.length;
    this.runden.push({ zahl: befunde.length, schluessel: schluessel.map(({ roh }) => roh) });
    if (ursache !== null) {
      this.ende = ursache;
      return { grund: `${this.art}: Befunde blieben nach ${ruecksendungen} Rücksendungen offen, ${ursache}` };
    }
    for (const { roh, inhalt } of schluessel) {
      this.gesehen.add(roh);
      this.gesehen.add(inhalt);
    }
    return null;
  }

  bericht() {
    return { art: this.art, runden: this.runden, ende: this.ende };
  }
}
