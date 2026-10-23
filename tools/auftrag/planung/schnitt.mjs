import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { bereiche, liegtGeordnet } from "../../abhaengigkeiten/testordnung.mjs";
import { ARTEN, TESTUMBAU, UMBAU_AUSWEG, alsEintrag, bereichSchluessel, brauchtRotenTest, engsterOrdner, geschuetzteMuster, gleicherBereich, istBereichsliste, istGeschuetzt, istTestdatei, istUmbau, istWurzel, jsZwillingDes, kennungBefunde, kopplungBefunde, listenBefunde, reihenfolge, umbenennungBefunde } from "../format.mjs";
import { nurUmbauBefunde } from "./abdeckung.mjs";
import { abschnitte } from "./abschnitte.mjs";
import { GRUND, aenderungsStellen, erkundungBefunde, istObjekt, istText, liste } from "./erkundung.mjs";
import { dateiKarte, funktionsListe, umbauKarten } from "./funktionsliste.mjs";
import { gleicherText, nummernImOrdner } from "./nummern.mjs";
import { MELDUNG, zweckBlock } from "../zweck.mjs";

export const DOKUMENTE = ["pitch.md", "design.md", "sicherheit.md"];
const LISTEN_OBEN = ["annahmen", "fehlendeSzenarien", "ownerAufgaben", "gemeinsameNamen"];
const SCHEMA = ["vertraeglich", "aenderung", "nutzung"];
const DURCHSTICH = "a1";
const SCHEMA_DATEI = "src/db/schema.sql";
const ERREICHT = "erreicht";
const NICHT_ERREICHT = /^nicht erreicht, weil(.*)$/su;
const NUR_VERWEIS = /^(S[1-9]\d*) im Pitch\.?$/;
const TEST_ORDNER = "test/";
const PLAN_KENNUNG = /(?:^|-)[pabst]-?\d+(?:-|$)/;
const NAMENSTEIL = /[/._]/;
const PFAD_TRENNER = "/";
const WORT_RAND = /^[„“"'`([]+|[„“"'`)\],;:.!?]+$/g;
const LEERRAUM = /\s+/;
const LISTENZEICHEN = /^\s*(?:[-*+]|\d+\.)\s+/;
const UEBERSCHRIFT = /^#+ (.+)/;
const ETIKETT = /^\p{L}+ \p{L}*\p{N}+: (.+)/u;
const SATZENDE = /(?<=[.!?])\s+/;
const GRENZE_NEUE_ZEILEN = 400;
const PLANUNG = "planung";
const SCHNITT = "schnitt.json";
const ERKUNDUNG = /^erkundung-.+\.json$/;
const EXIT_GRUEN = 0;
const EXIT_BEFUNDE = 4;
const UMBAU_NUMMER = "umbau";

export const REGEL = {
  erkundung: "Erkundung",
  form: "Form",
  nummern: "Nummern",
  verweis: "T-Verweis",
  durchstich: "Durchstich",
  altfunktionen: "Altfunktionen",
  umbauTest: "Umbau-Test",
  schema: "Schema",
  bereich: "Bereich",
  aenderungen: "Änderungsdateien",
  codeowners: "CODEOWNERS",
  abnahme: "Abnahmetest",
  eingang: "Eingang",
  nie: "Nie-Sätze",
  namen: "Gemeinsame Namen",
  umbenennung: "Umbenennung",
};

function mitRegel(regel, befunde) {
  return befunde.map((befund) => `Regel ${regel}: ${befund}`);
}

function nummernVon(auftrag) {
  return istUmbau(auftrag) ? [] : liste(auftrag.prueft);
}

function vorgaengerIds(auftrag) {
  return liste(auftrag.abhaengigVon).map((eintrag) => eintrag?.id);
}

function kette(auftrag, nachId) {
  const gesehen = new Set();
  const offen = [...vorgaengerIds(auftrag)];
  while (offen.length > 0) {
    const kennung = offen.pop();
    const vorgaenger = nachId.get(kennung);
    if (!gesehen.has(kennung) && vorgaenger !== undefined) offen.push(...vorgaengerIds(vorgaenger));
    gesehen.add(kennung);
  }
  return [...gesehen].map((kennung) => nachId.get(kennung)).filter(Boolean);
}

function besitzerJeNummer(auftraege) {
  const besitzer = new Map();
  for (const auftrag of auftraege) {
    for (const nummer of nummernVon(auftrag)) besitzer.set(nummer, [...(besitzer.get(nummer) ?? []), auftrag]);
  }
  return besitzer;
}

function schluessel(nummer, datei) {
  return `${nummer}\0${datei}`;
}

export function erkundungsVorpruefung(berichte, { soll, root }) {
  const befunde = [];
  const annahmen = [];
  const anzahl = new Map();
  for (const bericht of berichte) {
    const gruppe = liste(bericht?.gruppe);
    if (gruppe.length === 0) befunde.push("ein Erkundungsbericht nennt keine gruppe");
    for (const nummer of gruppe) anzahl.set(nummer, (anzahl.get(nummer) ?? 0) + 1);
    const ergebnis = gruppe.length > 0 ? erkundungBefunde(bericht, { gruppe, soll, root }) : { befunde: [], annahmen: [] };
    befunde.push(...ergebnis.befunde.map((befund) => `Bericht ${gruppe.join(", ")}: ${befund}`));
    annahmen.push(...ergebnis.annahmen);
  }
  for (const nummer of soll.keys()) {
    const zahl = anzahl.get(nummer) ?? 0;
    if (zahl !== 1) befunde.push(`${nummer} hat ${zahl} Erkundungsberichte statt genau einem`);
  }
  return { befunde: mitRegel(REGEL.erkundung, befunde), annahmen };
}

function abhaengigkeitBefunde(auftrag, kennungen) {
  if (!Array.isArray(auftrag.abhaengigVon)) return [`${auftrag.id}: abhaengigVon muss eine Liste von Einträgen mit id und grund sein`];
  return auftrag.abhaengigVon.flatMap((eintrag) => {
    if (!istObjekt(eintrag) || eintrag.id === auftrag.id || !kennungen.has(eintrag.id)) return [`${auftrag.id}: abhaengigVon nennt ${JSON.stringify(eintrag?.id)}, das ist kein anderer Auftrag`];
    return GRUND.test(eintrag.grund ?? "") ? [] : [`${auftrag.id}: abhaengigVon ${eintrag.id} braucht einen Grund`];
  });
}

function annahmeBefunde(annahmen, kennungen) {
  return annahmen
    .filter((annahme) => !istObjekt(annahme) || !GRUND.test(annahme.text ?? "") || (annahme.auftrag !== undefined && !kennungen.has(annahme.auftrag)))
    .map((annahme) => `annahmen: ${JSON.stringify(annahme)} braucht einen text mit Grund und, falls genannt, einen Auftrag der Schnittliste`);
}

function auftragFormBefunde(auftraege, kennungen) {
  return auftraege.flatMap((auftrag) => {
    const art = ARTEN.includes(auftrag.art) ? [] : [`${auftrag.id}: art muss eine von ${ARTEN.join(", ")} sein`];
    return [...art, ...abhaengigkeitBefunde(auftrag, kennungen)];
  });
}

function vorhandeneKennungBefunde(auftraege, vorhandene) {
  const belegt = new Set(vorhandene.map(({ id }) => id));
  return auftraege.filter(({ id }) => belegt.has(id)).map(({ id }) => `${id}: die Kennung hat schon ein vorhandener Auftrag der Phase`);
}

export function formBefunde(schnitt, vorhandene = []) {
  if (!istObjekt(schnitt)) return mitRegel(REGEL.form, ["die Schnittliste ist kein Objekt"]);
  const befunde = LISTEN_OBEN.filter((feld) => !Array.isArray(schnitt[feld])).map((feld) => `${feld} muss eine Liste sein`);
  const auftraege = liste(schnitt.auftraege);
  if (auftraege.length === 0) return mitRegel(REGEL.form, [...befunde, "auftraege muss mindestens einen Auftrag enthalten"]);
  if (!auftraege.every(istObjekt)) return mitRegel(REGEL.form, [...befunde, "jeder Auftrag ist ein Objekt"]);
  const kennungen = new Set([...auftraege, ...vorhandene].map(({ id }) => id));
  befunde.push(...kennungBefunde(auftraege), ...vorhandeneKennungBefunde(auftraege, vorhandene), ...auftragFormBefunde(auftraege, kennungen), ...annahmeBefunde(liste(schnitt.annahmen), kennungen));
  if (befunde.length > 0) return mitRegel(REGEL.form, befunde);
  const { zyklus } = reihenfolge([...vorhandene.map(imSchnittFormat), ...auftraege].map((auftrag) => ({ id: auftrag.id, abhaengigVon: vorgaengerIds(auftrag) })));
  return zyklus ? mitRegel(REGEL.form, [`abhaengigVon bildet einen Kreis: ${zyklus.join(" -> ")}`]) : [];
}

function umbauNummerBefunde(auftrag, soll) {
  if (istUmbau(auftrag)) return auftrag.prueft === UMBAU_AUSWEG ? [] : [`${auftrag.id}: ein Umbau prüft keine Nummer; prueft ist genau „${UMBAU_AUSWEG}“`];
  const nummern = liste(auftrag.prueft);
  const fremd = nummern.filter((nummer) => !soll.has(nummer)).map((nummer) => `${auftrag.id}: ${nummer} ist keine Soll-Nummer`);
  return nummern.length === 0 ? [`${auftrag.id}: ${auftrag.art} ohne Nummer in prueft`] : fremd;
}

function nummernBefunde(auftraege, { soll, besitzer }) {
  const befunde = auftraege.flatMap((auftrag) => umbauNummerBefunde(auftrag, soll));
  for (const nummer of soll.keys()) {
    const kennungen = (besitzer.get(nummer) ?? []).map(({ id }) => id);
    if (kennungen.length === 0) befunde.push(`${nummer} steht bei keiner Funktion und keiner Fehlerbehebung`);
    if (kennungen.length > 1) befunde.push(`${nummer} steht mehrfach: ${kennungen.join(", ")}`);
  }
  return mitRegel(REGEL.nummern, befunde);
}

function verweisBefunde(soll, besitzer) {
  const befunde = [...soll].flatMap(([nummer, { text }]) => {
    const ziel = NUR_VERWEIS.exec(gleicherText(text))?.[1];
    const [eigener] = besitzer.get(nummer) ?? [];
    const [anderer] = besitzer.get(ziel) ?? [];
    if (!nummer.startsWith("T") || ziel === undefined || eigener === undefined || eigener === anderer) return [];
    return [`${nummer} lautet nur „${ziel} im Pitch“ und steht deshalb beim Auftrag von ${ziel}, nicht bei ${eigener.id}`];
  });
  return mitRegel(REGEL.verweis, befunde);
}

function falscheAngabeBefund(auftrag, eintrag, kontext) {
  const gemeldet = kontext.stellen.some(({ nummer, datei }) => nummer === eintrag?.nummer && datei === eintrag?.datei);
  if (!istObjekt(eintrag) || !nummernVon(auftrag).includes(eintrag.nummer) || !gemeldet) {
    return `${auftrag.id}: falscheAngaben ${JSON.stringify(eintrag)} nennt keine gemeldete Änderungsdatei einer eigenen Nummer`;
  }
  if (!GRUND.test(eintrag.grund ?? "")) return `${auftrag.id}: falscheAngaben ${eintrag.nummer} ${eintrag.datei} braucht einen Grund`;
  return istText(eintrag.fundstelle) ? null : `${auftrag.id}: falscheAngaben ${eintrag.nummer} ${eintrag.datei} braucht eine Fundstelle, die die Erkundung widerlegt`;
}

function falscheAngaben(auftrag, kontext) {
  const eintraege = liste(auftrag.falscheAngaben);
  const befunde = eintraege.map((eintrag) => falscheAngabeBefund(auftrag, eintrag, kontext)).filter(Boolean);
  const gueltig = befunde.length === 0 ? eintraege : [];
  return { befunde, ausgenommen: new Set(gueltig.map(({ nummer, datei }) => schluessel(nummer, datei))) };
}

function nenntDatei(text, datei) {
  return text.split(LEERRAUM).some((wort) => wort.replace(WORT_RAND, "") === datei);
}

function beimOwner(datei, kontext) {
  return istGeschuetzt(kontext.muster, datei) && kontext.ownerTexte.some((text) => nenntDatei(text, datei));
}

function eigeneStellen(auftrag, kontext) {
  const { ausgenommen } = falscheAngaben(auftrag, kontext);
  const nummern = nummernVon(auftrag);
  return kontext.stellen.filter(({ nummer, datei }) => nummern.includes(nummer) && !ausgenommen.has(schluessel(nummer, datei)) && !beimOwner(datei, kontext));
}

function ohneEigeneDatei(auftrag, stellen) {
  const eigene = new Set(liste(auftrag.erwarteteDateien));
  if (!brauchtRotenTest(auftrag) || stellen.length === 0 || stellen.some(({ datei }) => eigene.has(datei))) return [];
  return [`${auftrag.id}: keine gemeldete Änderungsdatei seiner Nummern steht in seinen eigenen erwarteteDateien; neues Verhalten gehört nicht in einen Umbau davor`];
}

function dateienAusserhalb(auftrag, kontext) {
  const { befunde } = falscheAngaben(auftrag, kontext);
  const erlaubt = new Set([auftrag, ...kette(auftrag, kontext.nachId)].flatMap((eintrag) => liste(eintrag.erwarteteDateien)));
  const stellen = eigeneStellen(auftrag, kontext);
  const fehlend = stellen.filter(({ datei }) => !erlaubt.has(datei));
  const texte = fehlend.map(({ nummer, datei }) => `${auftrag.id}: Änderungsdatei ${datei} von ${nummer} steht weder bei ${auftrag.id} noch in seiner abhaengigVon-Kette noch unter falscheAngaben oder ownerAufgaben`);
  return [...befunde, ...new Set(texte), ...ohneEigeneDatei(auftrag, stellen)];
}

function durchstichVon({ durchstich, vorhandene, nurUmbau }) {
  if (nurUmbau) return null;
  return durchstich ?? (vorhandene === undefined ? DURCHSTICH : null);
}

function durchstichBefunde(kontext) {
  const kennung = kontext.durchstich;
  if (kennung === null) return [];
  const durchstich = kontext.nachId.get(kennung);
  if (durchstich === undefined) return mitRegel(REGEL.durchstich, [`es gibt keinen Auftrag ${kennung} (Durchstich)`]);
  const befunde = durchstich.art === "funktion" ? [] : [`${kennung} ist ${durchstich.art}, der Durchstich ist eine funktion`];
  if (durchstich.eingang !== ERREICHT) befunde.push(`${kennung} führt durch den echten Eingang; eingang muss „${ERREICHT}“ sein`);
  const fremd = kette(durchstich, kontext.nachId).filter((auftrag) => !istUmbau(auftrag));
  befunde.push(...fremd.map(({ id }) => `${kennung} hängt von ${id} ab, das ist kein Umbau`), ...dateienAusserhalb(durchstich, kontext));
  return mitRegel(REGEL.durchstich, befunde);
}

function aenderungsBefunde(auftraege, kontext) {
  const uebrige = auftraege.filter(({ id }) => id !== kontext.durchstich);
  return mitRegel(REGEL.aenderungen, uebrige.flatMap((auftrag) => dateienAusserhalb(auftrag, kontext)));
}

export function istAltfunktion(funktion) {
  return Object.keys(funktion.befunde ?? {}).length > 0;
}

function aufgeraeumt(funktion, umbauten) {
  return umbauten.some((umbau) => liste(umbau.erwarteteDateien).includes(funktion.datei) && liste(umbau.altfunktionen).some((alt) => alt?.datei === funktion.datei && alt.von === funktion.von && alt.bis === funktion.bis));
}

function altfunktionBefunde(auftraege, kontext) {
  const alt = kontext.funktionsliste.filter(istAltfunktion);
  const befunde = auftraege.flatMap((auftrag) => {
    const { ausgenommen } = falscheAngaben(auftrag, kontext);
    const umbauten = kette(auftrag, kontext.nachId).filter(({ art }) => art === "umbau");
    const betroffen = alt.filter((funktion) => funktion.nummern.some((nummer) => nummernVon(auftrag).includes(nummer) && !ausgenommen.has(schluessel(nummer, funktion.datei))));
    return betroffen
      .filter((funktion) => !aufgeraeumt(funktion, umbauten))
      .map((funktion) => `${auftrag.id}: Altfunktion ${funktion.datei}:${funktion.name} (${funktion.von}-${funktion.bis}, ${Object.keys(funktion.befunde).join(", ")}) steht bei keinem Umbau in seiner abhaengigVon-Kette unter altfunktionen`);
  });
  return mitRegel(REGEL.altfunktionen, befunde);
}

function mitJsZwillingen(dateien) {
  return [...new Set(dateien.flatMap((datei) => [datei, jsZwillingDes(datei)]).filter(Boolean))];
}

function umbauTestBefunde(auftraege, { dateikarte }) {
  const befunde = auftraege.filter(({ art }) => art === "umbau").flatMap((umbau) => {
    const dateien = liste(umbau.erwarteteDateien).filter((datei) => !istTestdatei(datei));
    const mitZwillingen = mitJsZwillingen(dateien);
    const tests = dateikarte.filter(({ datei }) => mitZwillingen.includes(datei)).flatMap(({ tests: erreichend }) => erreichend);
    return tests.includes(umbau.abnahme) ? [] : [`${umbau.id}: abnahme ${umbau.abnahme} gehört laut Dateikarte zu keiner Datei des Umbaus (${dateien.join(", ")})`];
  });
  return mitRegel(REGEL.umbauTest, befunde);
}

function umbenennungImSchnitt(auftraege, { vorhandene }) {
  const schonDa = new Set(umbenennungBefunde(vorhandene));
  return mitRegel(REGEL.umbenennung, umbenennungBefunde([...vorhandene, ...auftraege]).filter((befund) => !schonDa.has(befund)));
}

function schemaNummern(berichte) {
  return berichte.flatMap((bericht) => Object.entries(bericht?.nummern ?? {}).filter(([, angaben]) => angaben?.schema?.aenderung === true).map(([nummer]) => nummer));
}

function schemaKettenBefunde(auftraege, nachId) {
  const hat = (auftrag, wert) => kette(auftrag, nachId).some(({ schema }) => schema === wert);
  return auftraege.flatMap((auftrag) => {
    if (auftrag.schema === "aenderung" && auftrag.art !== "umbau") return [`${auftrag.id}: die Schemaänderung ist ein umbau`];
    if (auftrag.schema === "aenderung" && !hat(auftrag, "vertraeglich")) return [`${auftrag.id}: vor der Schemaänderung fehlt in abhaengigVon ein Auftrag mit schema vertraeglich`];
    if (auftrag.schema === "nutzung" && !hat(auftrag, "aenderung")) return [`${auftrag.id}: vor der Nutzung fehlt in abhaengigVon die Schemaänderung (schema aenderung)`];
    return [];
  });
}

function haengtVon(auftrag, kennung, nachId) {
  return [auftrag, ...kette(auftrag, nachId)].some((eintrag) => vorgaengerIds(eintrag).includes(kennung));
}

function spaetereSchemaaenderung({ ersetzt, vorhandene, nachId }) {
  if (!istText(ersetzt)) return undefined;
  return vorhandene.find(({ id, art, erwarteteDateien }) => art === "umbau" && liste(erwarteteDateien).includes(SCHEMA_DATEI) && haengtVon(nachId.get(id), ersetzt, nachId));
}

function schemaNummerBefunde(nummer, kontext, spaeter) {
  const [besitzer] = kontext.besitzer.get(nummer) ?? [];
  if (besitzer === undefined || besitzer.schema === "nutzung") return [];
  if (spaeter === undefined) return [`${nummer}: Schemaänderung laut Bericht, ${besitzer.id} braucht schema nutzung`];
  return besitzer.schema === "vertraeglich" ? [] : [`${nummer}: Schemaänderung laut Bericht; die Schemaänderung ${spaeter.id} folgt erst nach ${kontext.ersetzt}, ${besitzer.id} braucht schema vertraeglich`];
}

function schemaBefunde(auftraege, kontext) {
  const ungueltig = auftraege.filter(({ schema }) => schema !== undefined && !SCHEMA.includes(schema)).map(({ id }) => `${id}: schema muss eine von ${SCHEMA.join(", ")} sein`);
  const spaeter = spaetereSchemaaenderung(kontext);
  const ohneNutzung = [...new Set(schemaNummern(kontext.berichte))].flatMap((nummer) => schemaNummerBefunde(nummer, kontext, spaeter));
  return mitRegel(REGEL.schema, [...ungueltig, ...ohneNutzung, ...schemaKettenBefunde(auftraege, kontext.nachId)]);
}

const PRODUKTDATEIEN = { gehoert: (datei) => !istTestdatei(datei), einzahl: "Produktdatei", mehrzahl: "Produktdateien" };
const TESTDATEIEN = { gehoert: istTestdatei, einzahl: "Testdatei", mehrzahl: "Testdateien" };

function erwarteterBereich(dateien) {
  return dateien.length === 1 ? dateien[0] : engsterOrdner(dateien);
}

function loestKonflikt(auftrag, { nummer, dateien }, root) {
  if (!liste(auftrag.prueft).includes(nummer) || !istBereichsliste(auftrag.bereich)) return false;
  return dateien.every((datei) => auftrag.bereich.includes(datei)) && listenBefunde(auftrag, root).length === 0;
}

export function bereichskonflikte(berichte, { schnitt, root }) {
  const jeNummer = new Map();
  for (const { nummer, datei } of aenderungsStellen(berichte)) if (PRODUKTDATEIEN.gehoert(datei)) jeNummer.set(nummer, new Set([...(jeNummer.get(nummer) ?? []), datei]));
  const auftraege = liste(schnitt?.auftraege).filter(istObjekt);
  const konflikte = [...jeNummer].map(([nummer, dateien]) => ({ nummer, dateien: [...dateien] })).filter(({ dateien }) => istWurzel(erwarteterBereich(dateien)));
  return konflikte.filter((konflikt) => !auftraege.some((auftrag) => loestKonflikt(auftrag, konflikt, root)));
}

function fremdeDateien(auftrag, art) {
  if (art !== TESTDATEIEN) return [];
  const fremde = liste(auftrag.erwarteteDateien).filter((datei) => istText(datei) && !art.gehoert(datei));
  return fremde.map((datei) => `${auftrag.id}: ein ${TESTUMBAU} nennt in erwarteteDateien nur Testdateien, nicht ${datei}`);
}

function listeDerDateien(auftrag, art, { dateien, root }) {
  if (art === TESTDATEIEN) return [`${auftrag.id}: der einzige gemeinsame Ordner ist die Repo-Wurzel; teil den Auftrag`];
  const verlangt = dateien.toSorted();
  const gleich = istBereichsliste(auftrag.bereich) && auftrag.bereich.length === verlangt.length && auftrag.bereich.toSorted().every((eintrag, stelle) => eintrag === verlangt[stelle]);
  const eigene = gleich ? [] : [`${auftrag.id}: bereich ist ${bereichSchluessel(auftrag.bereich)}, der einzige gemeinsame Ordner der ${art.mehrzahl} ist die Repo-Wurzel; sie verlangen die Liste ${JSON.stringify(verlangt)}`];
  return [...eigene, ...kopplungBefunde(verlangt, auftrag.bereichsgrund, root).map((befund) => `${auftrag.id}: ${befund}`)];
}

function bereichDerDateien(auftrag, art, root) {
  const dateien = [...new Set(liste(auftrag.erwarteteDateien).filter((datei) => istText(datei) && art.gehoert(datei)).map(alsEintrag(auftrag.bereich)))];
  if (dateien.length === 0) return [`${auftrag.id}: erwarteteDateien nennt keine ${art.einzahl}`];
  const erwartet = erwarteterBereich(dateien);
  if (istWurzel(erwartet)) return listeDerDateien(auftrag, art, { dateien, root });
  const mehrere = new Set(dateien.map((datei) => dirname(datei))).size > 1;
  const eigene = auftrag.bereich === erwartet ? [] : [`${auftrag.id}: bereich ist ${bereichSchluessel(auftrag.bereich)}, die ${art.mehrzahl} verlangen ${erwartet}`];
  const grund = mehrere && !GRUND.test(auftrag.bereichsgrund ?? "") ? [`${auftrag.id}: ${art.mehrzahl} in mehreren Ordnern brauchen bereichsgrund`] : [];
  return [...eigene, ...grund];
}

function bereichBefunde(auftraege, { root }) {
  const befunde = auftraege.flatMap((auftrag) => {
    const art = auftrag.art === TESTUMBAU ? TESTDATEIEN : PRODUKTDATEIEN;
    return [...fremdeDateien(auftrag, art), ...bereichDerDateien(auftrag, art, root)];
  });
  return mitRegel(REGEL.bereich, befunde);
}

function ownerAufgabeBefunde(aufgaben, nachId) {
  return aufgaben
    .filter((aufgabe) => !istObjekt(aufgabe) || !istText(aufgabe.aufgabe) || !istText(aufgabe.fundstelle) || !nachId.has(aufgabe.auftrag))
    .map((aufgabe) => `ownerAufgaben: ${JSON.stringify(aufgabe)} braucht aufgabe, fundstelle und den Auftrag, der ohne sie rot wird`);
}

function gemeldeteOwnerSachen(berichte) {
  const angaben = berichte.flatMap((bericht) => Object.values(bericht?.nummern ?? {}));
  const dateien = angaben.flatMap((angabe) => liste(angabe?.codeowners));
  const entscheidungen = angaben.map((angabe) => angabe?.ownerEntscheidung).filter((entscheidung) => istText(entscheidung?.fundstelle));
  return { dateien: [...new Set(dateien)], fundstellen: [...new Set(entscheidungen.map(({ fundstelle }) => gleicherText(fundstelle)))] };
}

function codeownersBefunde(auftraege, kontext) {
  const aufgaben = liste(kontext.schnitt.ownerAufgaben);
  const { dateien, fundstellen } = gemeldeteOwnerSachen(kontext.berichte);
  const owner = aufgaben.filter(istObjekt);
  const geschuetzt = auftraege.flatMap((auftrag) => liste(auftrag.erwarteteDateien).filter((datei) => istGeschuetzt(kontext.muster, datei)).map((datei) => `${auftrag.id}: erwartete Datei ${datei} steht in CODEOWNERS; sie gehört in ownerAufgaben`));
  const dateiOhne = dateien.filter((datei) => !kontext.ownerTexte.some((text) => nenntDatei(text, datei)));
  const stelleOhne = fundstellen.filter((stelle) => !owner.some(({ fundstelle }) => gleicherText(fundstelle) === stelle));
  const ohneAufgabe = [...dateiOhne, ...stelleOhne].map((sache) => `${sache} ist laut Erkundung Sache eines Owners und fehlt in ownerAufgaben`);
  return mitRegel(REGEL.codeowners, [...geschuetzt, ...ownerAufgabeBefunde(aufgaben, kontext.nachId), ...ohneAufgabe]);
}

function mitPlanKennung(abnahme) {
  const name = abnahme.slice(TEST_ORDNER.length).toLowerCase();
  return name.split(NAMENSTEIL).some((teil) => PLAN_KENNUNG.test(teil));
}

function imBereichsordner(abnahme, erlaubt) {
  const teile = abnahme.slice(TEST_ORDNER.length).split(PFAD_TRENNER);
  return teile.length > 1 && erlaubt.includes(teile[0]);
}

function ortBefunde(abnahme, erlaubt) {
  if (!istText(abnahme) || !abnahme.startsWith(TEST_ORDNER) || !imBereichsordner(abnahme, erlaubt)) return [`abnahme ${abnahme} liegt nicht im Testordner eines Bereichs aus tools/bereiche.json`];
  return liegtGeordnet(abnahme, erlaubt) && !mitPlanKennung(abnahme) ? [] : [`abnahme ${abnahme} enthält eine Kennung wie p001, a1, s3 im Namen`];
}

function schonVorhanden({ id, abnahme }, vorhandene) {
  return vorhandene.filter((vorhanden) => vorhanden.abnahme === abnahme).map((vorhanden) => `${id}: abnahme ${abnahme} hat schon der vorhandene Auftrag ${vorhanden.id}`);
}

function abnahmeBefunde(auftraege, { root, vorhandene }) {
  const erlaubt = bereiche(root);
  const befunde = auftraege.flatMap((auftrag) => {
    const { id, abnahme } = auftrag;
    const mehrfach = auftraege.filter((anderer) => anderer.abnahme === abnahme).length > 1 ? [`${id}: abnahme ${abnahme} hat auch ein anderer Auftrag`] : [];
    const doppelt = [...mehrfach, ...schonVorhanden(auftrag, vorhandene)];
    if (!brauchtRotenTest(auftrag)) return doppelt;
    const ort = ortBefunde(abnahme, erlaubt).map((befund) => `${id}: ${befund}`);
    if (ort.length > 0) return [...doppelt, ...ort];
    return existsSync(join(root, abnahme)) ? [...doppelt, `${id}: abnahme ${abnahme} gibt es schon; ${auftrag.art} braucht einen neuen Test`] : doppelt;
  });
  return mitRegel(REGEL.abnahme, befunde);
}

function eingangBefunde(auftraege, { schnitt }) {
  const mitAnnahme = new Set(liste(schnitt.annahmen).map(({ auftrag }) => auftrag));
  const befunde = auftraege.filter(brauchtRotenTest).flatMap(({ id, eingang }) => {
    if (eingang === ERREICHT) return [];
    const grund = NICHT_ERREICHT.exec(typeof eingang === "string" ? eingang : "")?.[1];
    if (!GRUND.test(grund ?? "")) return [`${id}: eingang ist weder „${ERREICHT}“ noch „nicht erreicht, weil …“ mit Grund`];
    return mitAnnahme.has(id) ? [] : [`${id}: eingang „nicht erreicht“ ohne Eintrag in annahmen`];
  });
  return mitRegel(REGEL.eingang, befunde);
}

function varianten(zeile) {
  const titel = UEBERSCHRIFT.exec(gleicherText(zeile))?.[1];
  return titel === undefined ? [zeile.replace(LISTENZEICHEN, "")] : [zeile, ETIKETT.exec(titel)?.[1] ?? titel];
}

function saetzeIn(abschnitt) {
  const zeilen = abschnitt.split("\n").flatMap(varianten);
  return new Set(zeilen.flatMap((zeile) => [zeile, ...zeile.split(SATZENDE)]).map(gleicherText).filter(Boolean));
}

function satzBefund(ort, eintrag, kontext) {
  if (!istObjekt(eintrag) || !istText(eintrag.satz) || !istText(eintrag.abschnitt)) return `${ort}: jeder Eintrag braucht satz, quelle und abschnitt`;
  const text = DOKUMENTE.includes(eintrag.quelle) ? kontext.dokumente[eintrag.quelle] : undefined;
  if (!istText(text)) return `${ort}: quelle ${eintrag.quelle} ist keins der Dokumente ${DOKUMENTE.join(", ")}`;
  const { abschnitte: gefunden, befunde } = abschnitte(text, [eintrag.abschnitt]);
  if (befunde.length > 0) return `${ort}: ${befunde[0]} (${eintrag.quelle})`;
  const satz = gleicherText(eintrag.satz);
  const uebernommen = liste(kontext.alteNie).some((alt) => gleicherText(alt) === satz);
  if (!uebernommen && !saetzeIn(gefunden.get(eintrag.abschnitt)).has(satz)) return `${ort}: „${eintrag.satz}“ steht nicht wörtlich als ganzer Satz oder ganze Zeile in ${eintrag.quelle}, ${eintrag.abschnitt}`;
  const szenario = [...kontext.soll].find(([, { text: szenarioText }]) => gleicherText(szenarioText).includes(satz));
  return szenario ? `${ort}: „${eintrag.satz}“ steht im Szenario ${szenario[0]}` : null;
}

function nieBefunde(auftraege, kontext) {
  const befunde = auftraege.flatMap((auftrag) => {
    const saetze = auftrag.wasDarfNiePassieren;
    if (saetze === undefined && !brauchtRotenTest(auftrag)) return [];
    if (!Array.isArray(saetze)) return [`${auftrag.id}: wasDarfNiePassieren muss eine Liste von Einträgen mit satz, quelle und abschnitt sein`];
    return saetze.map((eintrag) => satzBefund(`${auftrag.id} wasDarfNiePassieren`, eintrag, kontext)).filter(Boolean);
  });
  return mitRegel(REGEL.nie, befunde);
}

function namenBefunde(auftraege, kontext) {
  const imSchnitt = (gesucht) => auftraege.some(({ bereich }) => gleicherBereich(bereich, gesucht));
  const befunde = liste(kontext.schnitt.gemeinsameNamen).flatMap((eintrag) => {
    const { name, anbieter, nutzer } = istObjekt(eintrag) ? eintrag : {};
    if (!istText(name) || gleicherBereich(anbieter, nutzer) || !imSchnitt(anbieter) || !imSchnitt(nutzer)) return [`gemeinsamer Name ${JSON.stringify(eintrag)} braucht name und zwei verschiedene Bereiche der Schnittliste (anbieter, nutzer)`];
    const verbunden = auftraege.some((auftrag) => gleicherBereich(auftrag.bereich, nutzer) && kette(auftrag, kontext.nachId).some(({ bereich }) => gleicherBereich(bereich, anbieter)));
    return verbunden ? [] : [`${name}: kein Auftrag in ${bereichSchluessel(nutzer)} hängt von einem Auftrag in ${bereichSchluessel(anbieter)} ab`];
  });
  return mitRegel(REGEL.namen, befunde);
}

function widerspruchHinweis(auftraege) {
  const anzahl = auftraege.flatMap(({ falscheAngaben: eintraege }) => liste(eintraege)).length;
  return anzahl > 0 ? [`Hinweis: ${anzahl} Angaben der Erkundung als falsch erklärt; der Prüfer sieht jede nach`] : [];
}

function hinweise(auftraege, stellen) {
  return auftraege.flatMap((auftrag) => {
    const dateien = new Set(liste(auftrag.erwarteteDateien));
    const zeilen = stellen.filter(({ nummer, datei }) => nummernVon(auftrag).includes(nummer) && dateien.has(datei)).reduce((summe, { neueZeilen }) => summe + (neueZeilen ?? 0), 0);
    return zeilen > GRENZE_NEUE_ZEILEN ? [`Hinweis: ${auftrag.id} hat geschätzt ${zeilen} neue Zeilen (mehr als ${GRENZE_NEUE_ZEILEN}); prüf, ob er sich teilen lässt`] : [];
  });
}

function annahmenDesSchnitts(auftraege, schnitt) {
  const bereichsgruende = auftraege.filter(({ bereichsgrund }) => istText(bereichsgrund)).map(({ id, bereich, bereichsgrund }) => ({ auftrag: id, text: `bereich ${bereichSchluessel(bereich)}: ${bereichsgrund}` }));
  const falsche = auftraege.flatMap(({ id, falscheAngaben: eintraege }) => liste(eintraege).filter(istObjekt).map(({ nummer, datei, grund, fundstelle }) => ({ auftrag: id, text: `Widerspruch zur Erkundung ${nummer} ${datei}: ${grund} (${fundstelle})` })));
  const eingaenge = auftraege.filter(({ eingang }) => istText(eingang) && eingang !== ERREICHT).map(({ id, eingang }) => ({ auftrag: id, text: `eingang ${eingang}` }));
  return [...liste(schnitt.annahmen), ...bereichsgruende, ...eingaenge, ...falsche];
}

function imSchnittFormat(vorhanden) {
  return { ...vorhanden, abhaengigVon: liste(vorhanden.abhaengigVon).map((id) => ({ id })) };
}

export function schnittBefunde(schnitt, eingaben) {
  const vorhandene = liste(eingaben.vorhandene);
  const form = formBefunde(schnitt, vorhandene);
  if (form.length > 0) return { befunde: form, hinweise: [], annahmen: [] };
  const { auftraege } = schnitt;
  const kontext = {
    ...eingaben,
    schnitt,
    vorhandene,
    durchstich: durchstichVon(eingaben),
    nachId: new Map([...vorhandene.map(imSchnittFormat), ...auftraege].map((auftrag) => [auftrag.id, auftrag])),
    besitzer: besitzerJeNummer(auftraege),
    stellen: aenderungsStellen(eingaben.berichte),
    muster: geschuetzteMuster(eingaben.root),
    ownerTexte: liste(schnitt.ownerAufgaben).filter(istObjekt).map(({ aufgabe, fundstelle }) => `${aufgabe} ${fundstelle}`),
  };
  const befunde = [
    ...nummernBefunde(auftraege, kontext),
    ...verweisBefunde(kontext.soll, kontext.besitzer),
    ...durchstichBefunde(kontext),
    ...altfunktionBefunde(auftraege, kontext),
    ...umbauTestBefunde(auftraege, kontext),
    ...umbenennungImSchnitt(auftraege, kontext),
    ...schemaBefunde(auftraege, kontext),
    ...bereichBefunde(auftraege, kontext),
    ...aenderungsBefunde(auftraege, kontext),
    ...codeownersBefunde(auftraege, kontext),
    ...abnahmeBefunde(auftraege, kontext),
    ...eingangBefunde(auftraege, kontext),
    ...nieBefunde(auftraege, kontext),
    ...namenBefunde(auftraege, kontext),
  ];
  return { befunde, hinweise: [...hinweise(auftraege, kontext.stellen), ...widerspruchHinweis(auftraege)], annahmen: annahmenDesSchnitts(auftraege, schnitt) };
}

export function umbauMitJsZwillingen(umbau) {
  return { ...umbau, erwarteteDateien: mitJsZwillingen(liste(umbau.erwarteteDateien)) };
}

export function umbauPitchKarten(schnitt, root) {
  const umbauten = liste(schnitt?.auftraege).filter(istObjekt).filter(istUmbau);
  return umbauKarten(root, umbauten.map(umbauMitJsZwillingen), UMBAU_NUMMER);
}

async function karten(schnitt, { berichte, root, nurUmbau }) {
  if (nurUmbau) return umbauPitchKarten(schnitt, root);
  return { funktionsliste: funktionsListe(root, berichte), dateikarte: await dateiKarte(root, berichte) };
}

export async function schnittPruefung(schnitt, eingaben) {
  const { berichte, soll, root } = eingaben;
  const vorab = erkundungsVorpruefung(berichte, { soll, root });
  if (vorab.befunde.length > 0) return { befunde: vorab.befunde, hinweise: [], annahmen: vorab.annahmen };
  const ergebnis = schnittBefunde(schnitt, { ...eingaben, ...(await karten(schnitt, eingaben)) });
  return { ...ergebnis, annahmen: [...vorab.annahmen, ...ergebnis.annahmen] };
}

function leseJson(pfad) {
  return JSON.parse(readFileSync(pfad, "utf8"));
}

function annahmeText({ auftrag, nummer, text }) {
  return `Annahme ${auftrag ?? nummer ?? "der Planung"}: ${text}`;
}

export async function schnittImOrdner(ordner, { schnitt, berichte, root }) {
  const vorhanden = DOKUMENTE.filter((name) => existsSync(join(ordner, name)));
  const dokumente = Object.fromEntries(vorhanden.map((name) => [name, readFileSync(join(ordner, name), "utf8")]));
  const { soll, unklar, nurUmbau } = nummernImOrdner(ordner);
  const ergebnis = await schnittPruefung(schnitt, { berichte, soll, dokumente, root, nurUmbau });
  return { ...ergebnis, befunde: [...mitRegel(REGEL.nummern, [...unklar, ...nurUmbauBefunde(liste(schnitt?.auftraege), nurUmbau)]), ...ergebnis.befunde] };
}

export async function schnittBefehl(ordner, root) {
  const planung = join(ordner, PLANUNG);
  const berichte = readdirSync(planung).filter((name) => ERKUNDUNG.test(name)).toSorted().map((name) => leseJson(join(planung, name)));
  const ergebnis = await schnittImOrdner(ordner, { schnitt: leseJson(join(planung, SCHNITT)), berichte, root });
  const { befunde } = ergebnis;
  for (const befund of befunde) console.error(befund);
  for (const zeile of [...ergebnis.hinweise, ...ergebnis.annahmen.map(annahmeText)]) console.log(zeile);
  if (befunde.length > 0) {
    console.log(`rot: ${befunde.length} Befunde in ${join(planung, SCHNITT)}.`);
    console.log(zweckBlock(MELDUNG.SCHNITT).join("\n"));
    return EXIT_BEFUNDE;
  }
  console.log(`grün: die Schnittliste ${join(planung, SCHNITT)} erfüllt alle Regeln.`);
  return EXIT_GRUEN;
}
