import { bereichSchluessel, istAusfuehrbarerTest } from "./format.mjs";

const SATZ_ENDE = /(?<=[.!?])\s+|\n/;
const HILFE_WORT = /Hilfs(?:funktion|zeile|baustein)|Testhilfe/i;
const VERNEIN_WOERTER = "kein\\w*|nie|niemand\\w*|nicht";
const KEIN_BEZEICHNER = String.raw`(?!\s*=)`;
const VERNEINUNG = new RegExp(String.raw`\b(?:${VERNEIN_WOERTER})\b${KEIN_BEZEICHNER}`, "i");
const NICHT_NUR = /\bnicht\s+nur\b/gi;
const BIS_TEILSATZ_ENDE = String.raw`(?:(?!\s(?:und|dass|aber|sondern)\b)[^.,;:])*`;
const OHNE_AUFRUF = new RegExp(String.raw`\bohne(?=${BIS_TEILSATZ_ENDE}\s(?:aufruf\w*|aufzurufen)\b)`, "i");
const ANLEGE_WORT = /\b(?:legt|lege|legen|anlegen|angelegt|definiert|definieren|ergänzt|ergänzen|schreibt|schreiben|baut|bauen)\b/i;
const DASS_SATZ = /\bdass\b/i;
const ERSTER_NAME = /`/;
const TEILSATZ_ENDE = /[,;:]|\b(?:und|dass|aber|sondern)\b/i;
const ZEICHENKETTE = /"[^"]*"|'[^']*'/g;
const NUTZ_WORT = /\b(?:ruft|rufen|aufgerufen|aufruf\w*|nutzt|nutzen|benutzt|verwendet|exportiert)\b/i;
const NAME_IN_CODEZEICHEN = /`([A-Za-z_$][\w$]*)(?:\([^`]*\))?`/g;
const EINFACHER_NAME_IN_CODEZEICHEN = /`[A-Za-z_$][\w$]*(?:\([^`()]*\))?`/g;
const SIGNATUR_IN_CODEZEICHEN = /`([A-Za-z_$][\w$]*)\([^`]*\)`/g;
const IMPORT_LISTE = /(?:^|neuen?\s+Importzeile\s+`)\s*import\s*\{([^}]*)\}\s*from/gim;
const NAME_IM_IMPORT_SATZ = /`([A-Za-z_$][\w$]*)`[^`.]*\bin\s+(?:den|die|dem)\s+(?:[\wäöüß-]+\s+)*?Import/gi;
const KEINE_HILFSZEILE = new Set(["test", "describe", "it", "assert"]);
const FUNKTION_ZEILE = /^\s*(export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm;
const PFEIL_ZEILE = /^\s*(export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/gm;
const FUNKTION_KOPF = /\bfunction\s*\*?\s*[A-Za-z_$][\w$]*/g;
const EXPORT_LISTE = /export\s*\{([^}]*)\}/g;
const WORT_MIT_KLAMMER = /([A-Za-z_$][\w$]*)(\()?/g;
const WORT = /[\w$-]+/g;
const HINWEIS = "Hilfszeilen und der nutzende Test gehören in denselben Auftrag";

function saetze(text) {
  return text.split(SATZ_ENDE);
}

function deklarierteImCode(text) {
  const treffer = [...text.matchAll(FUNKTION_ZEILE), ...text.matchAll(PFEIL_ZEILE)];
  return treffer.filter(([, export_]) => export_ === undefined).map(([, , name]) => name);
}

function letzterTeilsatz(text) {
  return text.split(TEILSATZ_ENDE).at(-1);
}

function istDeklaration(satz) {
  return HILFE_WORT.test(satz) && (ANLEGE_WORT.test(satz) || !NUTZ_WORT.test(satz));
}

function importierteNamen(text) {
  const liste = [...text.matchAll(IMPORT_LISTE)].flatMap(([, namen]) => namen.split(",").map((name) => name.trim().split(/\s+as\s+/).at(-1)));
  return [...liste, ...[...text.matchAll(NAME_IM_IMPORT_SATZ)].map(([, name]) => name)].filter(Boolean);
}

function namenImSatz(satz) {
  const signaturen = [...satz.matchAll(SIGNATUR_IN_CODEZEICHEN)].map(([, name]) => name);
  const namen = signaturen.length > 0 ? signaturen : [...satz.matchAll(NAME_IN_CODEZEICHEN)].map(([, name]) => name);
  return namen.filter((name) => !KEINE_HILFSZEILE.has(name));
}

function deklarierteInSaetzen(text) {
  const hilfssaetze = saetze(text).filter((satz) => istDeklaration(satz) && !VERNEINUNG.test(letzterTeilsatz(satz.split(ERSTER_NAME)[0])));
  return hilfssaetze.flatMap(namenImSatz);
}

function imSatzBenannt(text) {
  const hilfssaetze = saetze(text).filter(istDeklaration);
  return hilfssaetze.flatMap((satz) => {
    const namen = [...satz.matchAll(NAME_IN_CODEZEICHEN)].map(([, name]) => name);
    return namen.filter((name, index) => namen.indexOf(name) !== index);
  });
}

function exportierteNamen(texte) {
  return new Set(texte.flatMap((text) => [...text.matchAll(EXPORT_LISTE)]).flatMap(([, liste]) => liste.match(WORT) ?? []));
}

function istVerneint(text) {
  const rein = text.replace(ZEICHENKETTE, "").replace(NICHT_NUR, "");
  const aufruf = NUTZ_WORT.exec(rein);
  return OHNE_AUFRUF.test(rein) || VERNEINUNG.test(aufruf ? rein.slice(0, aufruf.index) : rein);
}

function aufgerufeneNamen(teil) {
  const nutzt = NUTZ_WORT.test(teil);
  const code = nutzt ? teil : teil.replace(EINFACHER_NAME_IN_CODEZEICHEN, " ");
  const woerter = [...code.replace(FUNKTION_KOPF, "").matchAll(WORT_MIT_KLAMMER)];
  return woerter.filter(([, , klammer]) => klammer !== undefined || nutzt).map(([, name]) => name);
}

function nutzteile(satz) {
  const [hauptsatz, ...nebensaetze] = satz.split(DASS_SATZ);
  return istVerneint(hauptsatz) ? [] : [hauptsatz, ...nebensaetze.filter((text) => !istVerneint(text))];
}

function verwendeteNamen(saetzeAlle, fremdeKennungen) {
  const relevant = saetzeAlle.filter((satz) => !istDeklaration(satz) && !(satz.match(WORT) ?? []).some((wort) => fremdeKennungen.has(wort)));
  return new Set(relevant.flatMap(nutzteile).flatMap(aufgerufeneNamen));
}

function mitKlammerGenannt(texte) {
  const woerter = texte.flatMap((text) => [...text.replace(FUNKTION_KOPF, "").matchAll(WORT_MIT_KLAMMER)]);
  return new Set(woerter.filter(([, , klammer]) => klammer !== undefined).map(([, name]) => name));
}

function hilfszeilenBefund(auftrag, entwurf, fremdeKennungen) {
  const schluessel = bereichSchluessel(auftrag.bereich);
  const eigener = entwurf?.[schluessel];
  if (typeof auftrag.bereich !== "string" || !istAusfuehrbarerTest(auftrag.bereich) || typeof eigener !== "string") return [];
  const weitere = (auftrag.erwarteteDateien ?? []).filter((pfad) => pfad !== schluessel).map((pfad) => entwurf[pfad]);
  const texte = [eigener, ...weitere.filter((text) => typeof text === "string")];
  const importiert = importierteNamen(eigener);
  const deklariert = [...new Set([...deklarierteImCode(eigener), ...deklarierteInSaetzen(eigener).filter((name) => !importiert.includes(name)), ...importiert])];
  const verwendet = verwendeteNamen(texte.flatMap(saetze), fremdeKennungen);
  for (const name of [...imSatzBenannt(eigener), ...importiert.filter((import_) => mitKlammerGenannt(texte).has(import_))]) verwendet.add(name);
  const exportiert = exportierteNamen(texte);
  const ungenutzt = deklariert.filter((name) => !verwendet.has(name) && !exportiert.has(name));
  if (ungenutzt.length === 0) return [];
  return [`${auftrag.id}: der Entwurf für ${schluessel} legt Hilfszeilen an (${ungenutzt.join(", ")}), aber kein Testfall in diesem Auftrag ruft sie auf; lint neuer funktionen meldet sie als unbenutzt. ${HINWEIS}`];
}

export function hilfszeilenBefunde(auftraege, phase) {
  const kennungen = new Set(phase.auftraege.map(({ id }) => id));
  return auftraege.flatMap((auftrag) => hilfszeilenBefund(auftrag, phase.entwurf, new Set([...kennungen].filter((id) => id !== auftrag.id))));
}
