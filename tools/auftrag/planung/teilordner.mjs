import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { deckelAus, gibReservierungFrei, reserviere, restTopf, setzeReservierung, topfBuch } from "./deckel.mjs";
import { liste, schreibeJsonAtomar } from "./erkundung.mjs";
import { teilVon, teilVonZeile } from "./kopfzeile.mjs";
import { EXIT_AUFRUF, EXIT_BEFUNDE, EXIT_DECKEL, EXIT_GETEILT } from "./nachricht.mjs";
import { ANFORDERUNGEN, ANGRIFFSWEG, ANGRIFFSWEGE, BLEIBT_UNVERAENDERT, PITCH, PITCH_SZENARIO, SICHERHEIT, sollNummern } from "./nummern.mjs";
import { teilungHalt } from "./teilung.mjs";

const DESIGN = "design.md";
const DOKUMENTE = [PITCH, SICHERHEIT, DESIGN];
const PLANUNG = "planung";
const TEILE = "teile.json";
const NACH_ZEILEN = /(?<=\n)/u;
const UEBERSCHRIFT = /^(#{1,6})\s/u;
const ABSCHNITT = 2;
const PHASENNUMMER = /^P-\d+/u;
const STATUS = "Status:";
const EIGENER_KOPF = [STATUS, "Issue:", "Planung freigegeben:", "Teil von:"];
const SZENARIEN_ANDERSWO = "dieser Teil baut nur um; die Szenarien des Eltern-Pitches stehen in den anderen Teilen";
const SATZ_ANFORDERUNGEN = `keine neuen, weil ${SZENARIEN_ANDERSWO}`;
const SATZ_BLEIBT = `keins, weil ${SZENARIEN_ANDERSWO}`;
const SATZ_ANGRIFFSWEGE = "Für diesen Teil keine Angriffswege gefunden: die Angriffswege des Eltern-Ordners mit Ausgang verhindern stehen in den anderen Teilen.";

function abschnitte(text) {
  const ergebnis = [];
  for (const zeile of text.split(NACH_ZEILEN)) {
    const ebene = UEBERSCHRIFT.exec(zeile)?.[1].length;
    if (ebene !== undefined || ergebnis.length === 0) ergebnis.push({ ebene: ebene ?? 0, kopf: zeile.trimEnd(), text: "" });
    ergebnis.at(-1).text += zeile;
  }
  return ergebnis;
}

function imPitch(kopf) {
  return PITCH_SZENARIO.exec(kopf)?.[1];
}

function inSicherheit(kopf, oberabschnitt) {
  return ANGRIFFSWEGE.test(oberabschnitt) ? ANGRIFFSWEG.exec(kopf)?.[1] : undefined;
}

function mitNummern(liste, nummerIn) {
  const ergebnis = [];
  let block = null;
  let oberabschnitt = "";
  for (const abschnitt of liste) {
    if (abschnitt.ebene === ABSCHNITT) oberabschnitt = abschnitt.kopf;
    if (block !== null && abschnitt.ebene <= block.ebene) block = null;
    const nummer = nummerIn(abschnitt.kopf, oberabschnitt);
    if (nummer !== undefined) block = { nummer, ebene: abschnitt.ebene };
    ergebnis.push({ ...abschnitt, nummer: block?.nummer ?? null });
  }
  return ergebnis;
}

function mitSatz(liste, muster, satz) {
  return liste.map((abschnitt) => {
    if (abschnitt.ebene !== ABSCHNITT || !muster.test(abschnitt.kopf)) return abschnitt;
    const [kopfzeile, ...rest] = abschnitt.text.split(NACH_ZEILEN);
    return { ...abschnitt, text: [kopfzeile, "\n", `${satz}\n`, ...rest].join("") };
  });
}

function kopfUndRumpf(liste) {
  const erster = liste.findIndex(({ ebene }) => ebene === ABSCHNITT);
  return erster === -1 ? { kopf: liste, rumpf: [] } : { kopf: liste.slice(0, erster), rumpf: liste.slice(erster) };
}

function verbunden(liste) {
  return liste.map(({ text }) => text).join("");
}

function ableitung(eltern, eintrag) {
  const elternSoll = sollNummern(eltern[PITCH], eltern[SICHERHEIT]);
  const eigene = new Set([...liste(eintrag.nummern), ...liste(eintrag.tWege)]);
  const fremd = new Set([...elternSoll.soll.keys()].filter((nummer) => !eigene.has(nummer)));
  const ohneFremde = (alle) => alle.filter(({ nummer }) => !fremd.has(nummer));
  const { kopf, rumpf } = kopfUndRumpf(mitNummern(abschnitte(eltern[PITCH]), imPitch));
  const nurUmbau = eintrag.nurUmbau === true && !elternSoll.nurUmbau;
  const pitch = nurUmbau ? mitSatz(mitSatz(ohneFremde(rumpf), ANFORDERUNGEN, SATZ_ANFORDERUNGEN), BLEIBT_UNVERAENDERT, SATZ_BLEIBT) : ohneFremde(rumpf);
  const sicherheit = mitNummern(abschnitte(eltern[SICHERHEIT]), inSicherheit);
  const bleibt = ohneFremde(sicherheit);
  const ohneWeg = sicherheit.some(({ nummer }) => nummer !== null) && bleibt.every(({ nummer }) => nummer === null);
  return { kopf: verbunden(kopf), pitch, sicherheit: ohneWeg ? mitSatz(bleibt, ANGRIFFSWEGE, SATZ_ANGRIFFSWEGE) : bleibt };
}

function teilKopf(kopf, { eintrag, teilDeckel, herkunft }) {
  const [titel, ...rest] = kopf.split("\n");
  const uebrige = rest.filter((zeile) => zeile.trim() !== "" && !EIGENER_KOPF.some((anfang) => zeile.startsWith(anfang)));
  const status = rest.filter((zeile) => zeile.startsWith(STATUS)).slice(0, 1);
  return [`${titel}: Teil ${eintrag.kuerzel} ${eintrag.name}`, "", ...status, "Issue: offen", `Planung freigegeben: ${teilDeckel} Token`, teilVonZeile(herkunft), ...uebrige, "", ""].join("\n");
}

function teilTexte(eltern, { eintrag, teilDeckel, herkunft }) {
  const { kopf, pitch, sicherheit } = ableitung(eltern, eintrag);
  const design = eltern[DESIGN] === undefined ? {} : { [DESIGN]: eltern[DESIGN] };
  return { [PITCH]: teilKopf(kopf, { eintrag, teilDeckel, herkunft }) + verbunden(pitch), [SICHERHEIT]: verbunden(sicherheit), ...design };
}

function abweichung(name, { ist, soll, eltern }) {
  const stelle = soll.findIndex((abschnitt, index) => ist[index]?.text !== abschnitt.text);
  const erster = stelle === -1 ? ist[soll.length] : soll[stelle];
  return erster === undefined ? [] : [`${name} weicht im Abschnitt „${erster.kopf}“ von ${eltern} ab; ein Teil übernimmt jeden Abschnitt wörtlich und lässt nur die Nummern anderer Teile weg`];
}

function herkunftBefunde(teil, herkunft) {
  const gelesen = teilVon(teil[PITCH] ?? "");
  const erwartet = teilVonZeile(herkunft);
  return gelesen !== undefined && gelesen.fehler === undefined && teilVonZeile(gelesen) === erwartet ? [] : [`${PITCH} braucht im Kopf die Zeile „${erwartet}“`];
}

function nummernBefunde(teil, eintrag) {
  const { soll, unklar } = sollNummern(teil[PITCH] ?? "", teil[SICHERHEIT] ?? "");
  const ist = [...soll.keys()].toSorted().join(", ");
  const erwartet = [...liste(eintrag.nummern), ...liste(eintrag.tWege)].toSorted().join(", ");
  const zuordnung = ist === erwartet ? [] : [`die Dokumente nennen ${ist || "keine Nummer"}, ${TEILE} nennt ${erwartet || "keine Nummer"}`];
  return [...unklar, ...zuordnung];
}

function teilBefunde({ eltern, teil, eintrag, herkunft, name }, teilOrdner) {
  const soll = ableitung(eltern, eintrag);
  const befunde = [
    ...herkunftBefunde(teil, herkunft),
    ...abweichung(PITCH, { ist: kopfUndRumpf(abschnitte(teil[PITCH] ?? "")).rumpf, soll: soll.pitch, eltern: name }),
    ...abweichung(SICHERHEIT, { ist: abschnitte(teil[SICHERHEIT] ?? ""), soll: soll.sicherheit, eltern: name }),
    ...(teil[DESIGN] === eltern[DESIGN] ? [] : [`${DESIGN} ist keine Kopie von ${name}/${DESIGN}`]),
    ...nummernBefunde(teil, eintrag),
  ];
  return befunde.map((befund) => `${teilOrdner}: ${befund}`);
}

function texte(ordner) {
  return Object.fromEntries(DOKUMENTE.filter((datei) => existsSync(join(ordner, datei))).map((datei) => [datei, readFileSync(join(ordner, datei), "utf8")]));
}

function teilOrdnerName(elternOrdner, { kuerzel, name }) {
  const eltern = basename(elternOrdner);
  return `${PHASENNUMMER.exec(eltern)?.[0] ?? eltern}-${kuerzel}-${name}`;
}

function herkunftDes(teilung, eintrag, elternOrdner) {
  const ordner = new Map(teilung.teile.map((teil) => [teil.kuerzel, teilOrdnerName(elternOrdner, teil)]));
  return { eltern: basename(elternOrdner), nach: liste(eintrag.abhaengigVon).map((kuerzel) => ordner.get(kuerzel)) };
}

function leererTopf(buch, rechnung) {
  return { exit: EXIT_DECKEL, fehler: `Rest-Topf leer: ${rechnung}; plane startet keinen Agenten, bis im Eltern-Pitch eine neue Menge freigegeben ist. Ein Lauf ohne gemessenen Verbrauch zählt mit seinem Deckel; frei wird er nur, wenn ein Mensch nach Blick in die Transkripte seine Datei in ${buch} löscht` };
}

function topfAus(buch, { elternPitch, teilung, ohne }) {
  const { deckel: freigabe, fehler } = deckelAus(undefined, elternPitch);
  if (fehler !== undefined) return { exit: EXIT_AUFRUF, fehler: `Eltern-Ordner: ${fehler}; der Rest-Topf der Teile rechnet mit dieser Freigabe` };
  if (!Number.isFinite(teilung.token) || teilung.token < 0) return { exit: EXIT_DECKEL, fehler: `${TEILE} nennt den Verbrauch der Teilung nicht als Zahl; plane hält an, statt zu schätzen` };
  const { topf, rechnung, fehler: messfehler } = restTopf(buch, { freigabe, vorschnitt: teilung.token, ohne });
  if (messfehler !== undefined) return { exit: EXIT_DECKEL, fehler: messfehler };
  return topf.teilDeckel <= 0 ? leererTopf(buch, rechnung) : { topf, rechnung };
}

function reserviereTeil(buch, { teil, deckel, root, quelle }) {
  const name = reserviere(buch, { teil, deckel, worktree: root });
  const nachher = topfAus(buch, { ...quelle, ohne: name });
  if (nachher.exit !== undefined) {
    gibReservierungFrei();
    return nachher;
  }
  if (nachher.topf.teilDeckel < deckel) setzeReservierung(nachher.topf.teilDeckel);
  return { deckel: Math.min(deckel, nachher.topf.teilDeckel) };
}

function liesTeilung(elternOrdner) {
  try {
    const teilung = JSON.parse(readFileSync(join(elternOrdner, PLANUNG, TEILE), "utf8"));
    return Array.isArray(teilung?.teile) ? teilung : null;
  } catch {
    return null;
  }
}

function pruefeTeil(root, ordner, { teil, herkunft, deckel }) {
  if (herkunft.fehler !== undefined) return { exit: EXIT_AUFRUF, fehler: herkunft.fehler };
  const elternOrdner = join(dirname(ordner), herkunft.eltern);
  const name = relative(root, elternOrdner);
  const teilung = liesTeilung(elternOrdner);
  const eintrag = teilung?.teile.find((kandidat) => teilOrdnerName(elternOrdner, kandidat ?? {}) === basename(ordner));
  if (eintrag === undefined) return { exit: EXIT_AUFRUF, fehler: `${PITCH} nennt „Teil von: ${herkunft.eltern}“, aber ${join(name, PLANUNG, TEILE)} führt ${basename(ordner)} nicht als Teil; plane plant keinen Teil ohne Teilung` };
  const eltern = texte(elternOrdner);
  const befunde = teilBefunde({ eltern, teil, eintrag, herkunft: herkunftDes(teilung, eintrag, elternOrdner), name }, relative(root, ordner));
  if (befunde.length > 0) return { exit: EXIT_BEFUNDE, fehler: [`plane plant den Teil nicht, weil er vom Eltern-Ordner ${name} abweicht:`, ...befunde].join("\n") };
  const buch = topfBuch(root, herkunft.eltern);
  const quelle = { elternPitch: eltern[PITCH], teilung };
  const vorher = topfAus(buch, quelle);
  if (vorher.exit !== undefined) return vorher;
  return reserviereTeil(buch, { teil: basename(ordner), deckel: Math.min(deckel, vorher.topf.teilDeckel), root, quelle });
}

function teilStart(root, ordner, { fortsetzen, deckel }) {
  const teil = texte(ordner);
  const herkunft = teilVon(teil[PITCH]);
  if (herkunft === undefined) return undefined;
  const ergebnis = pruefeTeil(root, ordner, { teil, herkunft, deckel });
  if (ergebnis.exit !== undefined && !fortsetzen) rmdirSync(join(ordner, PLANUNG));
  return ergebnis;
}

function schreibeOrdner(ziel, dokumente) {
  mkdirSync(ziel);
  for (const [datei, inhalt] of Object.entries(dokumente)) writeFileSync(join(ziel, datei), inhalt);
}

function schreibeTeile(root, ordner, geteilt) {
  const datei = join(ordner, PLANUNG, TEILE);
  const teilung = JSON.parse(readFileSync(datei, "utf8"));
  const ziele = teilung.teile.map((eintrag) => join(dirname(ordner), teilOrdnerName(ordner, eintrag)));
  const vorhanden = ziele.filter((ziel) => existsSync(ziel)).map((ziel) => `${relative(root, ziel)} gibt es schon; plane überschreibt keinen Teil-Ordner`);
  if (vorhanden.length > 0) return { exit: EXIT_AUFRUF, fehler: vorhanden.join("\n") };
  const eltern = texte(ordner);
  const topf = topfAus(topfBuch(root, basename(ordner)), { elternPitch: eltern[PITCH], teilung });
  if (topf.exit !== undefined) return topf;
  const neu = teilung.teile.map((eintrag) => {
    const herkunft = herkunftDes(teilung, eintrag, ordner);
    return { eintrag, herkunft, dokumente: teilTexte(eltern, { eintrag, teilDeckel: topf.topf.teilDeckel, herkunft }) };
  });
  const befunde = neu.flatMap(({ eintrag, herkunft, dokumente }, stelle) => teilBefunde({ eltern, teil: dokumente, eintrag, herkunft, name: relative(root, ordner) }, relative(root, ziele[stelle])));
  if (befunde.length > 0) return { exit: EXIT_BEFUNDE, fehler: ["plane schreibt keinen Teil-Ordner, weil die abgeleiteten Teile Befunde haben:", ...befunde].join("\n") };
  neu.forEach(({ dokumente }, stelle) => schreibeOrdner(ziele[stelle], dokumente));
  schreibeJsonAtomar(datei, { ...teilung, topf: topf.topf });
  const kopf = `Teil-Ordner in Merge-Reihenfolge, je mit „Issue: offen“ und höchstens ${topf.topf.teilDeckel} Token (${topf.rechnung}):`;
  return { exit: EXIT_GETEILT, fehler: [geteilt.fehler, kopf, ...ziele.map((ziel) => relative(root, ziel))].join("\n") };
}

export async function teile(root, ordner, { fortsetzen, umfang, deckel }) {
  const teil = teilStart(root, ordner, { fortsetzen, deckel });
  if (teil !== undefined) return teil;
  if (fortsetzen) return null;
  const geteilt = await teilungHalt(root, ordner, { umfang, deckel });
  return geteilt?.exit === EXIT_GETEILT ? schreibeTeile(root, ordner, geteilt) : geteilt;
}
