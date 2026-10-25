import { existsSync, mkdirSync, readFileSync, rmdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { vorgaengerBefunde } from "../teil-vorgaenger.mjs";
import { TEIL_DECKEL, deckelAus, gibReservierungFrei, reserviere, restTopf, setzeReservierung, topfBuch } from "./deckel.mjs";
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
const TEILNUMMER = /^P-\d+(?:-t\d+(?=-|$))*/u;
const STATUS = "Status:";
const EIGENER_KOPF = [STATUS, "Issue:", "Planung freigegeben:", "Teil von:"];
const SZENARIEN_ANDERSWO = "dieser Teil baut nur um; die Szenarien des Eltern-Pitches stehen in den anderen Teilen";
const SATZ_ANFORDERUNGEN = `keine neuen, weil ${SZENARIEN_ANDERSWO}`;
const SATZ_BLEIBT = `keins, weil ${SZENARIEN_ANDERSWO}`;
const SATZ_ANGRIFFSWEGE = "Für diesen Teil keine Angriffswege gefunden: die Angriffswege des Eltern-Ordners mit Ausgang verhindern stehen in den anderen Teilen.";
const KEIN_PFADZEICHEN = /[^\w./-]+/u;
const PFADRAND = /^\.\/|\.+$/gu;

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
  return `${TEILNUMMER.exec(eltern)?.[0] ?? eltern}-${kuerzel}-${name}`;
}

function herkunftDes(teilung, eintrag, elternOrdner) {
  const ordner = new Map(teilung.teile.map((teil) => [teil.kuerzel, teilOrdnerName(elternOrdner, teil)]));
  return { eltern: basename(elternOrdner), nach: liste(eintrag.abhaengigVon).map((kuerzel) => ordner.get(kuerzel)) };
}

function leererTopf(buch, { rechnung, oberster }) {
  return { exit: EXIT_DECKEL, fehler: `Rest-Topf leer: ${rechnung}; plane startet keinen Agenten, bis im obersten Pitch ${oberster} eine neue Menge freigegeben ist. Ein Lauf ohne gemessenen Verbrauch zählt mit seinem Deckel; frei wird er nur, wenn ein Mensch nach Blick in die Transkripte seine Datei in ${buch} löscht` };
}

function nichtMessbar(fehler) {
  return { exit: EXIT_DECKEL, fehler };
}

function teileDatei(root, ordner) {
  return join(relative(root, ordner), PLANUNG, TEILE);
}

function mitWeitergegebenerMenge(root, { ordner, teilung }) {
  const freigabe = teilung?.topf?.freigabe;
  return Number.isFinite(freigabe) ? { ordner, teilung, freigabe } : nichtMessbar(`${teileDatei(root, ordner)} nennt keine weitergegebene Menge; plane hält an, statt zu schätzen`);
}

function ueberzugDes(root, ordner, umgebung) {
  const gebucht = restTopf(topfBuch(root, basename(ordner)), { freigabe: 0, vorschnitt: 0, ohne: umgebung.ohne });
  if (gebucht.fehler !== undefined) return nichtMessbar(gebucht.fehler);
  if (gebucht.topf.teile === 0) return { ueberzug: 0 };
  if (umgebung.besucht.has(ordner)) return { exit: EXIT_AUFRUF, fehler: `${teileDatei(root, ordner)} führt sich selbst als Teil; plane hält an, statt zu schätzen` };
  const stufe = umgebung.bekannt?.ordner === ordner ? umgebung.bekannt : mitWeitergegebenerMenge(root, { ordner, teilung: liesTeilung(ordner) });
  if (stufe.exit !== undefined) return stufe;
  const eigen = eigenerTopf(root, stufe, umgebung);
  return eigen.exit === undefined ? { ueberzug: Math.max(0, -eigen.topf.rest) } : eigen;
}

function ueberzugDerTeile(root, { ordner, teilung }, umgebung) {
  let summe = 0;
  for (const eintrag of teilung.teile) {
    const ergebnis = ueberzugDes(root, join(dirname(ordner), teilOrdnerName(ordner, eintrag ?? {})), umgebung);
    if (ergebnis.exit !== undefined) return ergebnis;
    summe += ergebnis.ueberzug;
  }
  return { summe };
}

function eigenerTopf(root, stufe, umgebung) {
  const { ordner, teilung, freigabe } = stufe;
  if (!Number.isFinite(teilung.token) || teilung.token < 0) return nichtMessbar(`${teileDatei(root, ordner)} nennt den Verbrauch der Teilung nicht als Zahl; plane hält an, statt zu schätzen`);
  const buch = topfBuch(root, basename(ordner));
  const { topf, rechnung, fehler } = restTopf(buch, { freigabe, vorschnitt: teilung.token, ohne: umgebung.ohne });
  if (fehler !== undefined) return nichtMessbar(fehler);
  const ueberzug = ueberzugDerTeile(root, stufe, { ...umgebung, besucht: new Set([...umgebung.besucht, ordner]) });
  if (ueberzug.exit !== undefined) return ueberzug;
  if (ueberzug.summe === 0) return { buch, topf, rechnung };
  const rest = topf.rest - ueberzug.summe;
  return { buch, topf: { ...topf, teile: topf.teile + ueberzug.summe, rest }, rechnung: `${rechnung} − Überzug weitergeteilter Teile ${ueberzug.summe} = ${rest}` };
}

function kette(root, ordner, { pitch, teilung }) {
  const stufen = [];
  let stufe = { ordner, pitch, teilung };
  while (true) {
    const herkunft = teilVon(stufe.pitch);
    if (herkunft === undefined) return { stufen, oberster: stufe };
    if (herkunft.fehler !== undefined) return { exit: EXIT_AUFRUF, fehler: `${relative(root, stufe.ordner)}: ${herkunft.fehler}` };
    stufen.push(stufe);
    const eltern = join(dirname(stufe.ordner), herkunft.eltern);
    if (stufen.some((frueher) => frueher.ordner === eltern)) return { exit: EXIT_AUFRUF, fehler: `${relative(root, eltern)}: die Zeilen „Teil von“ führen im Kreis; plane hält an, statt zu schätzen` };
    stufe = { ordner: eltern, pitch: texte(eltern)[PITCH], teilung: liesTeilung(eltern) };
    if (stufe.pitch === undefined || stufe.teilung === null) return { exit: EXIT_AUFRUF, fehler: `${relative(root, eltern)} hat kein ${PITCH} oder kein ${join(PLANUNG, TEILE)} mit Teilen; der Rest-Topf rechnet bis zum obersten Pitch` };
  }
}

function neueMenge(freigabe, oberster) {
  const gespeichert = oberster.teilung.topf?.freigabe;
  return Number.isFinite(gespeichert) ? Math.max(0, freigabe - gespeichert) : 0;
}

function abwaerts(root, { wurzel, stufen, neu }, umgebung) {
  let stand = { ...wurzel, gesamt: wurzel.topf.rest };
  let offen = neu;
  for (const stufe of stufen.toReversed()) {
    const eigen = eigenerTopf(root, stufe, umgebung);
    if (eigen.exit !== undefined) return eigen;
    offen = Math.max(0, offen - Math.max(0, -eigen.topf.rest));
    const extra = Math.max(0, Math.min(offen, stand.gesamt));
    const gesamt = Math.max(0, eigen.topf.rest) + extra;
    stand = { ...eigen, gesamt, rechnung: `${eigen.rechnung}; dazu aus der neuen Freigabe im obersten Pitch ${extra} = ${gesamt}` };
  }
  return stand;
}

function topfAus(root, { ordner, pitch, teilung, ohne, obergrenze = Infinity }) {
  const gefunden = kette(root, ordner, { pitch, teilung });
  if (gefunden.exit !== undefined) return gefunden;
  const { stufen, oberster } = gefunden;
  const { deckel: freigabe, fehler } = deckelAus(undefined, oberster.pitch);
  if (fehler !== undefined) return { exit: EXIT_AUFRUF, fehler: `Oberster Pitch ${relative(root, oberster.ordner)}: ${fehler}; der Rest-Topf der Teile rechnet mit dieser Freigabe` };
  const unten = stufen.map((stufe, stelle) => (stelle === 0 && Number.isFinite(obergrenze) ? { ...stufe, freigabe: obergrenze } : mitWeitergegebenerMenge(root, stufe)));
  const ohneMenge = unten.find((stufe) => stufe.exit !== undefined);
  if (ohneMenge !== undefined) return ohneMenge;
  const umgebung = { ohne, besucht: new Set(), bekannt: Number.isFinite(obergrenze) ? { ordner, teilung, freigabe: obergrenze } : null };
  const wurzel = eigenerTopf(root, { ...oberster, freigabe: unten.length === 0 ? Math.min(freigabe, obergrenze) : freigabe }, umgebung);
  if (wurzel.exit !== undefined) return wurzel;
  const stand = abwaerts(root, { wurzel, stufen: unten, neu: neueMenge(freigabe, oberster) }, umgebung);
  if (stand.exit !== undefined) return stand;
  const topf = { ...stand.topf, teilDeckel: Math.max(0, Math.min(TEIL_DECKEL, stand.gesamt)) };
  return topf.teilDeckel <= 0 ? leererTopf(stand.buch, { rechnung: stand.rechnung, oberster: join(relative(root, oberster.ordner), PITCH) }) : { topf, rechnung: stand.rechnung };
}

function reserviereTeil(buch, { teil, deckel, root, quelle }) {
  const name = reserviere(buch, { teil, deckel, worktree: root });
  const nachher = topfAus(root, { ...quelle, ohne: name });
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

function umbauDesEintrags(teilung, eintrag) {
  return teilung.teile.some((kandidat) => Array.isArray(kandidat?.umbau)) ? liste(eintrag.umbau) : undefined;
}

function fremdeDateien(teilung, eintrag, elternOrdner) {
  const andere = teilung.teile.filter((kandidat) => kandidat !== eintrag);
  return andere.flatMap((anderer) => liste(anderer?.dateien).map((datei) => ({ datei, teil: teilOrdnerName(elternOrdner, anderer) })));
}

function genanntePfade(text) {
  return new Set(text.split(KEIN_PFADZEICHEN).map((wort) => wort.replace(PFADRAND, "")));
}

export function fremdeDateienBefunde(fremd, gruppen) {
  return gruppen.flatMap(({ nummern, text }) => {
    const genannt = genanntePfade(text);
    return fremd.filter(({ datei }) => genannt.has(datei)).map(({ datei, teil }) => `Gruppe ${nummern.join(", ")}: die Design-Abschnitte der Gruppe nennen ${datei}, laut ${TEILE} eine Datei des Teils ${teil}`);
  });
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
  const quelle = { ordner: elternOrdner, pitch: eltern[PITCH], teilung };
  const vorher = topfAus(root, quelle);
  if (vorher.exit !== undefined) return vorher;
  const vorgaenger = vorgaengerBefunde(basename(ordner), herkunft.nach, root);
  if (vorgaenger.length > 0) return { exit: EXIT_AUFRUF, fehler: vorgaenger.join("\n") };
  const reserviert = reserviereTeil(buch, { teil: basename(ordner), deckel: Math.min(deckel, vorher.topf.teilDeckel), root, quelle });
  return reserviert.exit === undefined ? { ...reserviert, dateien: liste(eintrag.dateien), umbau: umbauDesEintrags(teilung, eintrag), fremd: fremdeDateien(teilung, eintrag, elternOrdner) } : reserviert;
}

function teilStart(root, ordner, { fortsetzen, deckel }) {
  const teil = texte(ordner);
  const herkunft = teilVon(teil[PITCH]);
  if (herkunft === undefined) return undefined;
  const ergebnis = pruefeTeil(root, ordner, { teil, herkunft, deckel });
  if (ergebnis.exit !== undefined && !fortsetzen) rmdirSync(join(ordner, PLANUNG));
  return ergebnis;
}

function abgeleiteteTeile(eltern, teilung, { ordner, teilDeckel }) {
  return teilung.teile.map((eintrag) => {
    const herkunft = herkunftDes(teilung, eintrag, ordner);
    return { eintrag, herkunft, dokumente: teilTexte(eltern, { eintrag, teilDeckel, herkunft }) };
  });
}

function schreibeOrdner(ziel, dokumente) {
  mkdirSync(ziel);
  for (const [datei, inhalt] of Object.entries(dokumente)) writeFileSync(join(ziel, datei), inhalt);
}

export function schreibeTeile(root, ordner, geteilt) {
  const datei = join(ordner, PLANUNG, TEILE);
  const teilung = JSON.parse(readFileSync(datei, "utf8"));
  const ziele = teilung.teile.map((eintrag) => join(dirname(ordner), teilOrdnerName(ordner, eintrag)));
  const vorhanden = ziele.filter((ziel) => existsSync(ziel)).map((ziel) => `${relative(root, ziel)} gibt es schon; plane überschreibt keinen Teil-Ordner`);
  if (vorhanden.length > 0) return { exit: EXIT_AUFRUF, fehler: vorhanden.join("\n") };
  const eltern = texte(ordner);
  const topf = topfAus(root, { ordner, pitch: eltern[PITCH], teilung, obergrenze: geteilt.freigabe });
  if (topf.exit !== undefined) return topf;
  const neu = abgeleiteteTeile(eltern, teilung, { ordner, teilDeckel: topf.topf.teilDeckel });
  const befunde = neu.flatMap(({ eintrag, herkunft, dokumente }, stelle) => teilBefunde({ eltern, teil: dokumente, eintrag, herkunft, name: relative(root, ordner) }, relative(root, ziele[stelle])));
  if (befunde.length > 0) return { exit: EXIT_BEFUNDE, fehler: ["plane schreibt keinen Teil-Ordner, weil die abgeleiteten Teile Befunde haben:", ...befunde].join("\n") };
  neu.forEach(({ dokumente }, stelle) => schreibeOrdner(ziele[stelle], dokumente));
  schreibeJsonAtomar(datei, { ...teilung, topf: topf.topf });
  const kopf = `Teil-Ordner in Merge-Reihenfolge, je mit „Issue: offen“ und höchstens ${topf.topf.teilDeckel} Token (${topf.rechnung}):`;
  return { exit: EXIT_GETEILT, fehler: [geteilt.fehler, kopf, ...ziele.map((ziel) => relative(root, ziel))].join("\n") };
}

export function ableitungsBefunde(ordner) {
  const eltern = texte(ordner);
  return (teilung) => abgeleiteteTeile(eltern, teilung, { ordner, teilDeckel: TEIL_DECKEL }).flatMap(({ eintrag, dokumente }) => nummernBefunde(dokumente, eintrag).map((befund) => `${eintrag.kuerzel}: ${befund}`));
}

export async function teile(root, ordner, { fortsetzen, messe, deckel }) {
  const teil = teilStart(root, ordner, { fortsetzen, deckel });
  if (teil?.exit !== undefined) return teil;
  if (teil !== undefined) return { deckel: teil.deckel, teil: true, fremd: teil.fremd, umbau: teil.umbau, umfang: await messe(teil.dateien) };
  const umfang = await messe();
  if (fortsetzen) return { umfang };
  const geteilt = await teilungHalt(root, ordner, { umfang, deckel, ableitung: ableitungsBefunde(ordner) });
  if (geteilt === null) return { umfang };
  const ergebnis = geteilt.exit === EXIT_GETEILT ? schreibeTeile(root, ordner, geteilt) : geteilt;
  return { ...ergebnis, umfang, team: geteilt.team };
}

export function teilungsBericht(ordner) {
  const teilung = liesTeilung(ordner);
  return teilung?.topf === undefined ? {} : { teilung: { anzahl: teilung.teile.length, topf: teilung.topf } };
}
