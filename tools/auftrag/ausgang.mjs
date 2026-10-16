const ZAUN = "```";
const PLATZHALTER = /<[^<>\n]*>/g;
const INHALT = /[\p{L}\p{N}]/u;
const ALTER_TEST_FORM = /^(test\/\S+?\.test\.[cm]?js):(.+)$/;
const MELDUNG = /^(Gleichwertig|Nötig): (.+?), weil (\S.*)$/;
const AUSSTIEG = "ausstieg";
const AUSWEG_BEI = "Ausweg bei Prüfung: ";
const OHNE_ROTE_PRUEFUNG = "keine";
const ALTER_TEST = "alterTest";
const AUSWEGE = [
  { art: AUSSTIEG, anfang: /^Auftrag passt nicht:\s*(\S.*)$/, rollen: ["bau", "test"] },
  { art: "voraussetzung", anfang: /^Voraussetzung fehlt:\s*(\S.*)$/, rollen: ["bau"] },
  { art: ALTER_TEST, anfang: /^Alter Test hält altes Verhalten fest:\s*(\S.*)$/, rollen: ["bau"] },
];
const ZWECK_UNKLAR = /^Zweck der Prüfung (.+?) unklar\b/;
const TRENNER = / [–-] /g;

function nurPlatzhalter(text) {
  return !INHALT.test(text.replace(PLATZHALTER, ""));
}

export function antwortZeilen(text) {
  const ausserhalb = [];
  let imBlock = false;
  for (const zeile of String(text ?? "").split("\n")) {
    const zaun = zeile.startsWith(ZAUN);
    if (!imBlock && !zaun) ausserhalb.push(zeile.trimEnd());
    if (zaun) imBlock = !imBlock;
  }
  return ausserhalb;
}

function auswegDer(zeile, rolle) {
  for (const { art, anfang, rollen } of AUSWEGE) {
    const grund = anfang.exec(zeile)?.[1];
    if (grund !== undefined && rollen.includes(rolle) && !nurPlatzhalter(grund)) return { art, grund, zeile };
  }
  return null;
}

function alterTest({ grund, zeile }) {
  const [, datei, rest] = ALTER_TEST_FORM.exec(grund) ?? [];
  if (rest === undefined || lesarten(rest).length === 0) return { [AUSSTIEG]: zeile };
  return { [ALTER_TEST]: { datei, rest, zeile } };
}

function meldungen(zeilen) {
  const gefunden = { Gleichwertig: [], Nötig: [] };
  for (const zeile of zeilen) {
    const [, art, mutant, grund] = MELDUNG.exec(zeile) ?? [];
    if (art !== undefined && !nurPlatzhalter(mutant) && !nurPlatzhalter(grund)) gefunden[art].push({ mutant: mutant.trim(), grund: grund.trim() });
  }
  return { gleichwertig: gefunden.Gleichwertig, noetig: gefunden.Nötig };
}

export function zweckUnklar(ausstieg) {
  return ZWECK_UNKLAR.exec(ausstieg ?? "")?.[1] ?? null;
}

export function ausgang(text, rolle) {
  const zeilen = antwortZeilen(text);
  const letzter = zeilen.map((zeile) => auswegDer(zeile, rolle)).findLast((weg) => weg !== null);
  const leer = { [AUSSTIEG]: null, voraussetzung: null, [ALTER_TEST]: null };
  const weg = letzter === undefined ? {} : letzter.art === ALTER_TEST ? alterTest(letzter) : { [letzter.art]: letzter.grund };
  return { ...leer, ...weg, zeile: letzter?.zeile ?? null, ...meldungen(zeilen) };
}

export function auswegBei(ids) {
  return `${AUSWEG_BEI}${ids.length > 0 ? ids.join(", ") : OHNE_ROTE_PRUEFUNG}`;
}

function lesarten(rest) {
  return [...rest.matchAll(TRENNER)].map(({ index, 0: trenner }) => ({ test: rest.slice(0, index).trim(), grund: rest.slice(index + trenner.length) }));
}

export function nenntAltenTest(alterTest, titel) {
  const treffer = lesarten(alterTest.rest).filter(({ test }) => titel.includes(test));
  return treffer.length === 1 ? { ...alterTest, ...treffer[0] } : null;
}
