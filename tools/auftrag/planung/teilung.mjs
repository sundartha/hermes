import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import { istTestdatei, reihenfolge } from "../format.mjs";
import { ueberschneiden } from "../sperren.mjs";
import { STILLSTAND } from "../verlauf.mjs";
import { ALTFUNKTIONEN, altfunktionenAusPitch } from "./altfunktionen-vorab.mjs";
import { teilungBefunde, zerlegungBefunde } from "./antworten.mjs";
import { gemesseneKosten } from "./deckel.mjs";
import { schreibeJsonAtomar } from "./erkundung.mjs";
import { RUECKSENDUNGEN } from "./fortschritt.mjs";
import { PITCH, nummernImOrdner } from "./nummern.mjs";
import { EXIT_ABBRUCH, EXIT_BEFUNDE, EXIT_DECKEL, EXIT_GETEILT, EXIT_PASST_NICHT, PLANER_KONTEXT, abschnitt, dateiText, json, nachricht, nummernText } from "./nachricht.mjs";
import { DOKUMENTE } from "./schnitt.mjs";
import { Abbruch, Team } from "./team.mjs";
import { GRENZE_CODE_DATEIEN, GRENZE_GRUPPEN, GRENZE_SZENARIEN, dokumenteIm } from "./umfang.mjs";

const TEILE = "teile.json";
const ANTWORT = "teilung.json";
const PLANUNG = "planung";
const SZENARIO = /^[SB]/u;
const BEDROHUNG = /^T/u;
const ORDNER_ENDE = "/";
const OHNE_VORGAENGER = "–";
const UMBAU = "Umbau";
const PITCH_NICHT_HIER = "„Pitch ändern“ gibt es bei der Teilung nicht; antworte mit der Teilung oder mit „Zerlegung passt nicht: …“";
const ZUORDNUNG = [
  { feld: "nummern", muster: SZENARIO, fremd: "kein Szenario S oder B des Pitches" },
  { feld: "tWege", muster: BEDROHUNG, fremd: "keine Bedrohung T mit Ausgang verhindern" },
];

function regel(text) {
  return `Regel Teilung: ${text}`;
}

function ueberDerGrenze({ szenarien, codeDateien }) {
  const ueber = [];
  if (szenarien > GRENZE_SZENARIEN) ueber.push(`${szenarien} Szenarien S/B, Grenze ${GRENZE_SZENARIEN}`);
  if (codeDateien > GRENZE_CODE_DATEIEN) ueber.push(`${codeDateien} Code-Dateien, Grenze ${GRENZE_CODE_DATEIEN}`);
  return ueber;
}

export function gruppenZahlUeber(anzahl) {
  return anzahl > GRENZE_GRUPPEN ? [`${anzahl} Gruppen, Grenze ${GRENZE_GRUPPEN}`] : [];
}

export function gruppenMit(gruppen, nummern) {
  return gruppen.filter((gruppe) => gruppe.nummern.some((nummer) => nummern.includes(nummer)));
}

function gruppenDes({ nummern, tWege }, gliederung) {
  return gliederung === null ? 0 : gruppenMit(gliederung.gruppen, [...nummern, ...tWege]).length;
}

function loeschDateien(umfang) {
  return new Set(umfang.loeschmenge?.dateien ?? []);
}

function codeDateien(dateien, loeschen) {
  return dateien.filter((datei) => !istTestdatei(datei) && !loeschen.has(datei));
}

function zaehler(genannt) {
  return (wert) => genannt.filter((eintrag) => eintrag === wert).length;
}

function zuordnungBefunde(teile, soll) {
  return ZUORDNUNG.flatMap(({ feld, muster, fremd }) => {
    const eigene = [...soll.keys()].filter((nummer) => muster.test(nummer));
    const genannt = teile.flatMap((teil) => teil[feld]);
    const zahl = zaehler(genannt);
    const falsch = eigene.filter((nummer) => zahl(nummer) !== 1).map((nummer) => regel(`${nummer} steht ${zahl(nummer)}-mal unter ${feld} statt genau einmal`));
    const fremde = [...new Set(genannt.filter((nummer) => !eigene.includes(nummer)))].map((nummer) => regel(`${nummer} unter ${feld} ist ${fremd}`));
    return [...falsch, ...fremde];
  });
}

function istOrdner(root, datei) {
  return datei.endsWith(ORDNER_ENDE) || (existsSync(join(root, datei)) && statSync(join(root, datei)).isDirectory());
}

function teilBefunde(teil, { root, loeschen, gliederung }) {
  const { kuerzel, nummern, tWege, dateien, nurUmbau } = teil;
  const befunde = dateien.filter((datei) => istOrdner(root, datei)).map((datei) => regel(`${kuerzel} nennt unter dateien den Ordner ${datei}; nenn die Dateien einzeln`));
  const gemessen = { szenarien: nummern.length, codeDateien: codeDateien(dateien, loeschen).length, gruppen: gruppenDes(teil, gliederung) };
  if (gemessen.szenarien > GRENZE_SZENARIEN) befunde.push(regel(`${kuerzel} hat ${gemessen.szenarien} Szenarien S/B unter nummern, die Grenze ist ${GRENZE_SZENARIEN}`));
  if (gemessen.codeDateien > GRENZE_CODE_DATEIEN) befunde.push(regel(`${kuerzel} hat ${gemessen.codeDateien} Code-Dateien, die Grenze ist ${GRENZE_CODE_DATEIEN}`));
  if (gemessen.gruppen > GRENZE_GRUPPEN) befunde.push(regel(`${kuerzel} hat Nummern aus ${gemessen.gruppen} Gruppen der Gliederung, die Grenze ist ${GRENZE_GRUPPEN}`));
  const mitNummern = nummern.length + tWege.length > 0;
  if (nurUmbau && mitNummern) befunde.push(regel(`${kuerzel} ist nurUmbau und nennt Nummern`));
  if (!nurUmbau && !mitNummern) befunde.push(regel(`${kuerzel} hat keine Nummer und ist nicht nurUmbau`));
  return befunde;
}

function vorgaengerBefunde(teile, nach) {
  return teile.flatMap(({ kuerzel, abhaengigVon }) => abhaengigVon.filter((vorgaenger) => !nach.has(vorgaenger)).map((vorgaenger) => regel(`${kuerzel} hängt von ${vorgaenger} ab, den es nicht gibt`)));
}

function nachReihenfolge(teile) {
  return reihenfolge(teile.map(({ kuerzel, abhaengigVon }) => ({ id: kuerzel, abhaengigVon })));
}

function kreisBefunde(teile) {
  const { zyklus } = nachReihenfolge(teile);
  return zyklus === null ? [] : [regel(`abhaengigVon bildet einen Kreis: ${zyklus.join(" → ")}`)];
}

function erreichbar(nach, start) {
  const gesehen = new Set();
  const offen = [...(nach.get(start) ?? [])];
  while (offen.length > 0) {
    const kuerzel = offen.pop();
    if (!gesehen.has(kuerzel)) offen.push(...(nach.get(kuerzel) ?? []));
    gesehen.add(kuerzel);
  }
  return gesehen;
}

function pfad(datei) {
  return datei.endsWith(ORDNER_ENDE) ? datei.slice(0, -ORDNER_ENDE.length) : datei;
}

function beruehrt(links, rechts) {
  return ueberschneiden(pfad(links), pfad(rechts));
}

function gemeinsameDateien(links, rechts) {
  const gemeinsam = links.flatMap((datei) => rechts.filter((andere) => beruehrt(datei, andere)).map((andere) => (datei.length >= andere.length ? datei : andere)));
  return [...new Set(gemeinsam)];
}

function ueberschneidungsBefunde(teile, nach) {
  return teile.flatMap((links, stelle) => teile.slice(stelle + 1).flatMap((rechts) => {
    if (erreichbar(nach, links.kuerzel).has(rechts.kuerzel) || erreichbar(nach, rechts.kuerzel).has(links.kuerzel)) return [];
    const gemeinsam = gemeinsameDateien(links.dateien, rechts.dateien);
    return gemeinsam.length === 0 ? [] : [regel(`${links.kuerzel} und ${rechts.kuerzel} hängen nicht voneinander ab und teilen ${gemeinsam.join(", ")}; nenn eine Abhängigkeit oder trenn die Dateien`)];
  }));
}

function loeschBefunde(teile, loeschen) {
  const zahl = zaehler(teile.flatMap(({ dateien }) => dateien));
  return [...loeschen].filter((datei) => zahl(datei) !== 1).map((datei) => regel(`${datei} aus der Löschmenge steht ${zahl(datei)}-mal unter dateien statt genau einmal`));
}

function umbauAltfunktionen(pitch) {
  return altfunktionenAusPitch(pitch ?? "").eintraege.filter(({ art }) => art === UMBAU).map(({ datei, funktion }) => ({ datei, name: `${datei}:${funktion}` }));
}

function umbauBefunde(teile, altfunktionen) {
  const genannt = teile.flatMap(({ umbau = [] }) => umbau);
  const zahl = zaehler(genannt);
  const falsch = altfunktionen.filter(({ name }) => zahl(name) !== 1).map(({ name }) => regel(`${name} aus „${ALTFUNKTIONEN}“ steht ${zahl(name)}-mal unter umbau statt genau einmal`));
  const fremde = [...new Set(genannt)].filter((name) => !altfunktionen.some((alt) => alt.name === name)).map((name) => regel(`${name} unter umbau ist keine Umbau-Altfunktion unter „${ALTFUNKTIONEN}“ im Pitch`));
  const ohneDatei = teile.flatMap(({ kuerzel, umbau = [], dateien }) => altfunktionen.filter(({ name, datei }) => umbau.includes(name) && !dateien.includes(datei)).map(({ name, datei }) => regel(`${kuerzel} nennt ${name} unter umbau, hat ${datei} aber nicht unter dateien`)));
  return [...falsch, ...fremde, ...ohneDatei];
}

function abdeckungBefunde(teile, belegt) {
  const genannt = teile.flatMap(({ dateien }) => dateien);
  return belegt.filter((datei) => !genannt.some((eintrag) => beruehrt(eintrag, datei))).map((datei) => regel(`${datei} ist im Pitch belegt und steht in keinem Teil unter dateien`));
}

function schnittBefunde(teile, { soll, umfang, umbau, root, gliederung }) {
  const nach = new Map(teile.map(({ kuerzel, abhaengigVon }) => [kuerzel, abhaengigVon]));
  const vorgaenger = [...vorgaengerBefunde(teile, nach), ...kreisBefunde(teile)];
  const loeschen = loeschDateien(umfang);
  return [
    ...zuordnungBefunde(teile, soll),
    ...teile.flatMap((teil) => teilBefunde(teil, { root, loeschen, gliederung })),
    ...loeschBefunde(teile, loeschen),
    ...umbauBefunde(teile, umbau),
    ...abdeckungBefunde(teile, umfang.codeDateien),
    ...vorgaenger,
    ...(vorgaenger.length === 0 ? ueberschneidungsBefunde(teile, nach) : []),
  ];
}

function mergeReihenfolge(teile) {
  const nachKuerzel = new Map(teile.map((teil) => [teil.kuerzel, teil]));
  return nachReihenfolge(teile).ordnung.map(({ id }) => nachKuerzel.get(id));
}

function teilZeile({ kuerzel, name, nummern, tWege, dateien, abhaengigVon }, stelle, loeschen) {
  const inhalt = [...nummern, ...tWege].join(", ") || "nur Umbau";
  return `${stelle + 1}. ${kuerzel} ${name} (nach: ${abhaengigVon.join(", ") || OHNE_VORGAENGER}): ${inhalt}; ${codeDateien(dateien, loeschen).length} Code-Datei(en)`;
}

class Teilung {
  constructor(root, ordner, { soll, umfang, deckel, ueber, ableitung, team = new Team(root, ordner), planer = team.teilnehmer("planer"), gliederung = null }) {
    this.root = root;
    this.ordner = ordner;
    this.soll = soll;
    this.umfang = umfang;
    this.deckel = deckel;
    this.ueber = ueber;
    this.ableitung = ableitung;
    this.dokumente = dokumenteIm(ordner);
    this.umbau = umbauAltfunktionen(this.dokumente[PITCH]);
    this.team = team;
    this.planer = planer;
    this.gliederung = gliederung;
  }

  nummern(muster) {
    return [...this.soll.keys()].filter((nummer) => muster.test(nummer));
  }

  nachricht() {
    const gruppen = this.gliederung === null ? "" : ` Die Nummern eines Teils unter \`nummern\` und \`tWege\` stammen aus höchstens ${GRENZE_GRUPPEN} Gruppen der Gliederung.`;
    const grenze = `Je Teil höchstens ${GRENZE_SZENARIEN} Szenarien S/B unter \`nummern\` und höchstens ${GRENZE_CODE_DATEIEN} Code-Dateien unter \`dateien\`; Bedrohungen T, Testdateien und Dateien der Löschmenge zählen nicht; jede Datei der Löschmenge steht in genau einem Teil. Das Paket liegt darüber: ${this.ueber.join("; ")}.${gruppen}`;
    return nachricht("Teilung", [
      ...DOKUMENTE.map((name) => abschnitt(name, this.dokumente[name] ?? `${name} gibt es nicht.`)),
      abschnitt("Nummern", nummernText(this.soll, this.nummern(SZENARIO)) || "keine"),
      abschnitt("Bedrohungen mit Ausgang verhindern", nummernText(this.soll, this.nummern(BEDROHUNG)) || "keine"),
      ...(this.gliederung === null ? [] : [abschnitt("Gliederung", json(this.gliederung))]),
      abschnitt("Umfang", json(this.umfang)),
      abschnitt("Grenze", grenze),
      ...PLANER_KONTEXT.map((pfad) => abschnitt(pfad, dateiText(this.root, pfad))),
    ]);
  }

  async frage(text) {
    const [antwort] = await this.team.gruppe([{ rolle: this.planer.rolle, lauf: () => this.team.frage(this.planer, text) }]);
    return antwort;
  }

  lege(name, wert) {
    schreibeJsonAtomar(join(this.ordner, PLANUNG, name), wert);
  }

  deckelHalt() {
    const gemessen = gemesseneKosten(this.root, this.team.beteiligte);
    if (gemessen <= this.deckel) return null;
    return { exit: EXIT_DECKEL, fehler: `Deckel ${this.deckel} Token: gemessen ${gemessen}; plane hält nach der Teilung an und wartet auf eine Entscheidung` };
  }

  pruefe(antwort) {
    if (antwort.art === STILLSTAND) return { ende: { exit: EXIT_ABBRUCH, fehler: `${this.planer.rolle}: ${antwort.text}` } };
    if (antwort.art === "pitch") return { befunde: [PITCH_NICHT_HIER] };
    if (antwort.art !== "json") {
      const befunde = zerlegungBefunde(antwort.text, { root: this.root, dokumente: this.dokumente });
      return befunde.length === 0 ? { ende: { exit: EXIT_PASST_NICHT, fehler: antwort.text } } : { befunde };
    }
    this.lege(ANTWORT, antwort.wert);
    const form = teilungBefunde(antwort.wert);
    if (form.length > 0) return { befunde: form };
    const schnitt = schnittBefunde(antwort.wert.teile, { soll: this.soll, umfang: this.umfang, umbau: this.umbau, root: this.root, gliederung: this.gliederung });
    return { befunde: schnitt.length > 0 ? schnitt : this.ableitung(antwort.wert).map(regel) };
  }

  geteilt(teile, ruecksendungen) {
    const folge = mergeReihenfolge(teile);
    const datei = join(this.ordner, PLANUNG, TEILE);
    const grenze = { szenarien: GRENZE_SZENARIEN, codeDateien: GRENZE_CODE_DATEIEN, gruppen: GRENZE_GRUPPEN };
    this.lege(TEILE, { grenze, ueber: this.ueber, umfang: this.umfang, ruecksendungen, token: gemesseneKosten(this.root, this.team.beteiligte), teile: folge });
    console.log(["Teile in Merge-Reihenfolge:", ...folge.map((teil, stelle) => teilZeile(teil, stelle, loeschDateien(this.umfang)))].join("\n"));
    return { exit: EXIT_GETEILT, fehler: `plane hält vor dem ersten Erkunder: der Umfang liegt über der Grenze (${this.ueber.join("; ")}); ${folge.length} Teile in ${datei}` };
  }

  async laufe() {
    let text = this.nachricht();
    for (let ruecksendungen = 0; ; ruecksendungen += 1) {
      const antwort = await this.frage(text);
      const deckel = this.deckelHalt();
      if (deckel !== null) return deckel;
      const { ende, befunde } = this.pruefe(antwort);
      if (ende !== undefined) return ende;
      if (befunde.length === 0) return this.geteilt(antwort.wert.teile, ruecksendungen);
      if (ruecksendungen >= RUECKSENDUNGEN) return { exit: EXIT_BEFUNDE, fehler: [`die Teilung hat nach ${RUECKSENDUNGEN} Rücksendungen noch Befunde`, ...befunde].join("\n") };
      text = this.team.ruecksenden(this.planer, befunde);
    }
  }
}

export async function laufeTeilung(root, ordner, angaben) {
  try {
    return await new Teilung(root, ordner, angaben).laufe();
  } catch (fehler) {
    if (fehler instanceof Abbruch) return { exit: EXIT_ABBRUCH, fehler: fehler.message };
    throw fehler;
  }
}

export async function teilungHalt(root, ordner, { umfang, deckel, ableitung }) {
  const { soll, unklar } = nummernImOrdner(ordner);
  if (unklar.length > 0) return null;
  const ueber = ueberDerGrenze({ szenarien: [...soll.keys()].filter((nummer) => SZENARIO.test(nummer)).length, codeDateien: codeDateien(umfang.codeDateien, loeschDateien(umfang)).length });
  if (ueber.length === 0) return null;
  return laufeTeilung(root, ordner, { soll, umfang, deckel, ueber, ableitung });
}
