import { createHash } from "node:crypto";

import { imBereich } from "./format.mjs";

export const STILLSTAND = "stillstand";
export const UEBERGABE = "übergabe";
export const KONTEXT_GRENZE = 100_000;
const WIEDERHOLUNGEN_BIS_STILLSTAND = 3;
const MAX_ANTWORT_ZEICHEN = 1000;
const MAX_EINGABE_ZEICHEN = 200;
const MS_JE_SEKUNDE = 1000;
const ERSTE_MILLISEKUNDEN_ZEIT = 1e12;
const AENDERNDE_WERKZEUGE = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const STOP_EREIGNISSE = new Set(["Stop", "SubagentStop"]);
const PRUEFLEITER_AUFRUF = /pruefleiter/;
const ROTER_TEST = /^✗ .*\(([^()\s]+):\d+:\d+\)$/;
const LINT_BEFUND = /^([^\s:]+):\d+:\d+\s/;
const POSITION = /:\d+:\d+/g;
const LIMIT_MELDUNG = /limit reached|hit your limit/i;
const LIMIT_ZEIT = /\|(\d+)/;
const ABGELEHNT = "rejected";

export function auftragsdateien({ bereich, abnahme, erwarteteDateien = [] }) {
  return (pfad) => imBereich(bereich, pfad) || pfad === abnahme || erwarteteDateien.includes(pfad);
}

export function befundeDerPruefleiter(text, gehoertDazu) {
  const eigene = [];
  const fremde = [];
  for (const zeile of text.split("\n").map((roh) => roh.trim())) {
    const treffer = ROTER_TEST.exec(zeile) ?? LINT_BEFUND.exec(zeile);
    if (treffer === null) continue;
    if (gehoertDazu(treffer[1])) eigene.push(zeile.replace(POSITION, ""));
    else fremde.push(zeile);
  }
  return { eigene, fremde };
}

function alsObjekt(zeile) {
  try {
    const wert = JSON.parse(zeile);
    return wert !== null && typeof wert === "object" ? wert : null;
  } catch {
    return null;
  }
}

function teile(nachricht) {
  return Array.isArray(nachricht?.content) ? nachricht.content : [];
}

function alsText(inhalt) {
  if (typeof inhalt === "string") return inhalt;
  if (!Array.isArray(inhalt)) return JSON.stringify(inhalt ?? null);
  return inhalt.map((teil) => (typeof teil?.text === "string" ? teil.text : JSON.stringify(teil))).join("\n");
}

function kontextGroesse(verbrauch = {}) {
  const felder = ["input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];
  return felder.reduce((summe, feld) => summe + (Number(verbrauch[feld]) || 0), 0);
}

function zeitpunkt(wert) {
  if (!Number.isFinite(wert) || wert <= 0) return null;
  return wert < ERSTE_MILLISEKUNDEN_ZEIT ? wert * MS_JE_SEKUNDE : wert;
}

function stillstand(grund) {
  return { art: STILLSTAND, grund: `Stillstand: ${grund}` };
}

function istPruefleiterAufruf({ name, input }) {
  return name === "Bash" && PRUEFLEITER_AUFRUF.test(String(input?.command ?? ""));
}

const BEHANDLER = {
  assistant: (verlauf, ereignis) => verlauf.antwort(ereignis),
  user: (verlauf, ereignis) => verlauf.rueckmeldung(ereignis),
  system: (verlauf, ereignis) => verlauf.hook(ereignis),
  rate_limit_event: (verlauf, ereignis) => verlauf.limitInfo(ereignis),
  result: (verlauf, ereignis) => verlauf.schluss(ereignis),
};

export class Verlauf {
  constructor(gehoertDazu, pruefleiter = { meldung: "", wiederholt: 0 }) {
    this.gehoertDazu = gehoertDazu;
    this.pruefleiterStand = { ...pruefleiter };
    this.werkzeuge = new Map();
    this.aufrufe = new Map();
    this.geaendert = false;
    this.fremde = new Set();
    this.letzterText = "";
    this.ergebnis = null;
    this.limitBis = null;
    this.limit = null;
  }

  lies(zeile) {
    const ereignis = alsObjekt(zeile);
    if (ereignis === null || !Object.hasOwn(BEHANDLER, ereignis.type)) return null;
    return BEHANDLER[ereignis.type](this, ereignis) ?? null;
  }

  antwort({ message: nachricht, parent_tool_use_id: eltern }) {
    for (const teil of teile(nachricht)) {
      if (teil.type === "tool_use") this.merke(teil);
      if (teil.type === "text") this.letzterText = teil.text;
    }
    const kontext = kontextGroesse(nachricht?.usage);
    if (eltern || kontext < KONTEXT_GRENZE) return null;
    return { art: UEBERGABE, grund: `Übergabe: Der Kontext erreichte ${kontext} Token, die Grenze liegt bei ${KONTEXT_GRENZE}.` };
  }

  merke({ id, name, input }) {
    this.werkzeuge.set(id, { name, input });
    if (AENDERNDE_WERKZEUGE.has(name)) this.geaendert = true;
  }

  rueckmeldung({ message: nachricht }) {
    for (const teil of teile(nachricht)) {
      const aufruf = teil.type === "tool_result" ? this.werkzeuge.get(teil.tool_use_id) : undefined;
      const aktion = aufruf ? this.werkzeugErgebnis(aufruf, alsText(teil.content)) : null;
      if (aktion) return aktion;
    }
    return null;
  }

  werkzeugErgebnis(aufruf, text) {
    const pruefleiter = istPruefleiterAufruf(aufruf) ? this.pruefleiter(text) : null;
    return pruefleiter ?? this.wiederholung(aufruf, text);
  }

  wiederholung({ name, input }, text) {
    const schluessel = createHash("sha256").update(JSON.stringify([name, input, text])).digest("hex");
    const anzahl = (this.aufrufe.get(schluessel) ?? 0) + 1;
    this.aufrufe.set(schluessel, anzahl);
    if (anzahl < WIEDERHOLUNGEN_BIS_STILLSTAND) return null;
    const eingabe = JSON.stringify(input ?? null).slice(0, MAX_EINGABE_ZEICHEN);
    return stillstand(`${name} lief dreimal mit derselben Eingabe und lieferte dasselbe Ergebnis: ${eingabe}`);
  }

  hook({ subtype, hook_event: anlass, stdout = "", stderr = "" }) {
    if (subtype !== "hook_response" || !STOP_EREIGNISSE.has(anlass)) return null;
    return this.pruefleiter(`${stdout}\n${stderr}`);
  }

  pruefleiter(text) {
    const { eigene, fremde } = befundeDerPruefleiter(text, this.gehoertDazu);
    for (const zeile of fremde) this.fremde.add(zeile);
    const meldung = eigene.join("\n");
    const { meldung: vorher, wiederholt } = this.pruefleiterStand;
    const gleich = meldung !== "" && meldung === vorher;
    const neu = gleich ? wiederholt + Number(this.geaendert) : Number(meldung !== "");
    this.pruefleiterStand = { meldung, wiederholt: neu };
    this.geaendert = false;
    if (neu < WIEDERHOLUNGEN_BIS_STILLSTAND) return null;
    return stillstand(
      `Die Prüfleiter meldete dreimal hintereinander dieselbe Fehlermeldung, obwohl der Agent dazwischen Code geändert hat: ${eigene[0]}`,
    );
  }

  limitInfo({ rate_limit_info: info }) {
    if (info?.status === ABGELEHNT) this.limitBis = zeitpunkt(Number(info.resetsAt));
    return null;
  }

  schluss({ result: text, is_error: fehler }) {
    if (typeof text === "string") this.ergebnis = text;
    if (fehler) this.pruefeLimit(text);
    return null;
  }

  pruefeLimit(text) {
    if (this.limit !== null || !LIMIT_MELDUNG.test(String(text ?? ""))) return;
    this.limit = { bis: this.limitBis ?? zeitpunkt(Number(LIMIT_ZEIT.exec(text)?.[1])) };
  }

  zusammenfassung() {
    return {
      antwort: (this.ergebnis ?? this.letzterText).slice(-MAX_ANTWORT_ZEICHEN),
      limit: this.limit,
      pruefleiter: this.pruefleiterStand,
      fremdeBefunde: [...this.fremde],
    };
  }
}
