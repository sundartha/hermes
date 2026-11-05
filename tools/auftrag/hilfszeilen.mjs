import { bereichSchluessel, istAusfuehrbarerTest } from "./format.mjs";

const SATZ_ENDE = /(?<=[.!?])\s+|\n/;
const HILFE_WORT = /Hilfs(?:funktion|zeile|baustein)|Testhilfe/i;
const VERNEIN_WOERTER = "kein\\w*|nie|niemals|niemand\\w*|nicht";
const KEIN_BEZEICHNER = String.raw`(?!\s*=)`;
const VERNEINUNG = new RegExp(String.raw`\b(?:${VERNEIN_WOERTER})\b${KEIN_BEZEICHNER}`, "i");
const NACH_NUTZWORT_VERNEINT = new RegExp(String.raw`^\s*(?:${VERNEIN_WOERTER})\b|\b(?:${VERNEIN_WOERTER})\b(?:\s+mehr)?\s+(?:auf|aufgerufen)\b`, "i");
const NICHT_NUR = /\bnicht\s+nur\b/gi;
const BIS_TEILSATZ_ENDE = String.raw`(?:(?!\s(?:und|dass|aber|sondern)\b)[^.,;:])*`;
const OHNE_AUFRUF = new RegExp(String.raw`\bohne(?=${BIS_TEILSATZ_ENDE}\s(?:aufruf\w*|aufzurufen)\b)`, "i");
const NUTZ_AKTIV = "ruft|rufen|nutzt|nutzen|benutzt|benutzen|verwendet|verwenden";
const NUTZ_PASSIV = "aufgerufen|aufruf\\w*|genutzt|exportiert";
const NUTZ_WORT = new RegExp(String.raw`\b(?:${NUTZ_AKTIV}|${NUTZ_PASSIV})\b`, "i");
const AKTIVES_NUTZWORT = new RegExp(String.raw`\b(?:${NUTZ_AKTIV})\b`, "i");
const UND_MIT_NUTZWORT = new RegExp(String.raw`\s+und\s+(?=[^.]*${NUTZ_WORT.source})`, "i");
const ANLEGE_WORT = /\b(?:legt|lege|legen|anlegen|anlegt|angelegt|erstellt|erzeugt|ergänzt|ergänzen|definiert|schreibt|baut|entsteht|entstehen|führt|stehen|hinzu|bereit)\b/i;
const NEUE_HILFE = /\bneue[nsr]?\s+(?:Hilfs|Testhilfe)/i;
const BEREITS_DA = /\b(?:vorhanden\w*|bestehend\w*|unverändert\w*)\b/i;
const NICHT_ZIELE = /^\s*Nicht-Ziele\b/i;
const KLAUSELGRENZE = /[,;:]|\s(?:und|aber|sondern)\s/;
const KLAUSELANFANG = /(?=[,;:]|\s(?:und|aber|sondern)\s)/;
const RELATIVSATZ = /^[,;:]?\s*(?:die|der|das|den|dem|deren|dessen|welche\w*)\b/i;
const FALL_SATZ = /^\s*(?:der|die|das|ein|eine|jeder|dieser)\b[^,.;:]*?\b\w*fall\b/i;
const FALL_MIT_NUTZUNG = new RegExp(String.raw`\bFall\b[^.]*${NUTZ_WORT.source}`, "i");
const OHNE_DASS = /\bohne\s+dass\b/i;
const PRONOMEN = /\b(?:sie|diese|diesen|ihn)\b/i;
const DASS_SATZ = /\bdass\b/i;
const ERSTER_NAME = /`/;
const TEILSATZ_ENDE = /[,;:]|\b(?:und|dass|aber|sondern)\b/i;
const ZEICHENKETTE = /"[^"]*"|'[^']*'|„[^“”]*[“”]/g;
const ZEILENKOMMENTAR = /(?:^|\s)\/\/.*$|\/\*.*?\*\//gm;
const NAME_IM_TEIL = /[A-Za-z_$][\w$]*/g;
const PASSIV_VON = /\bvon\s+`?([A-Za-z_$][\w$]*)`?(?:\([^)]*\))?\s+(?:\S+\s+){0,2}?(?:aufgerufen|genutzt|verwendet|benutzt)\b/i;
const TESTNAME_IN_CODEZEICHEN = /^`[^`()]*\s[^`()]*`$/;
const CODESPANNE = /`[^`]*`/g;
const CODEZEILE = /[;{}]\s*$|=>|\s=\s/m;
const CODEHAFT = /[a-z][A-Z]|_|\d/;
const ANDERER_AUFTRAG = /\b(?:spätere|nächste|folgende)[rnms]?\s+(?:Aufträge|Auftrag|Auftrags|Phase)\b/i;
const NAME_IN_CODEZEICHEN = /`([A-Za-z_$][\w$]*)(?:\([^`]*\))?`/g;
const EINFACHER_NAME_IN_CODEZEICHEN = /`[A-Za-z_$][\w$]*(?:\([^`()]*\))?`/g;
const SIGNATUR_IN_CODEZEICHEN = /`([A-Za-z_$][\w$]*)\([^`]*\)`/g;
const IMPORT_ZEILE = /^\s*import\s*\{([^}]*)\}\s*from.*$/gm;
const IMPORT_IN_PROSA = /neuen?\s+Importzeile\s+`import\s*\{([^}]*)\}\s*from/gi;
const NAME_IM_IMPORT_SATZ = /`([A-Za-z_$][\w$]*)`[^`.]*\bin\s+(?:den|die|dem)\s+(?:[\wäöüß-]+\s+)*?Import/gi;
const KEINE_HILFSZEILE = new Set(["test", "describe", "it", "assert"]);
const FUNKTION_ZEILE = /^\s*(export\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm;
const PFEIL_ZEILE = /^\s*(export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/gm;
const PFEIL_KOPF = /^\s*(?:export\s+)?(?:const|let)\s+[A-Za-z_$][\w$]*\s*=/gm;
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

function bezugsText(satz, hilfe) {
  const vor = satz.slice(0, hilfe.index).split(KLAUSELGRENZE).at(-1);
  const [eigen, ...folge] = satz.slice(hilfe.index).split(KLAUSELANFANG);
  return [vor, eigen, ...folge.filter((teil) => RELATIVSATZ.test(teil))].join(" ");
}

function istDeklaration(satz) {
  const hilfe = HILFE_WORT.exec(satz);
  if (hilfe === null || BEREITS_DA.test(satz) || NICHT_ZIELE.test(satz)) return false;
  return ANLEGE_WORT.test(bezugsText(satz, hilfe)) || NEUE_HILFE.test(satz);
}

function namenAusListe(liste) {
  const namen = liste.split(",").map((eintrag) => eintrag.trim().split(/\s+as\s+/).at(-1));
  return namen.filter(Boolean);
}

function importeInCode(text) {
  return [...text.matchAll(IMPORT_ZEILE)].flatMap(([, liste]) => namenAusListe(liste));
}

function importeInProsa(text) {
  const neu = [...text.matchAll(IMPORT_IN_PROSA)].flatMap(([, liste]) => namenAusListe(liste));
  return [...neu, ...[...text.matchAll(NAME_IM_IMPORT_SATZ)].map(([, name]) => name)];
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

function nachNegation(satz, stelle) {
  return VERNEINUNG.test(letzterTeilsatz(satz.slice(0, stelle)));
}

function exportierteNamen(texte) {
  return new Set(texte.flatMap((text) => [...text.matchAll(EXPORT_LISTE)]).flatMap(([, liste]) => liste.match(WORT) ?? []));
}

function istVerneint(text) {
  const rein = text.replace(ZEICHENKETTE, "").replace(ZEILENKOMMENTAR, "").replace(NICHT_NUR, "");
  const aufruf = NUTZ_WORT.exec(rein);
  if (!aufruf) return OHNE_AUFRUF.test(rein) || VERNEINUNG.test(rein);
  const danach = rein.slice(aufruf.index + aufruf[0].length);
  return OHNE_AUFRUF.test(rein) || VERNEINUNG.test(rein.slice(0, aufruf.index)) || NACH_NUTZWORT_VERNEINT.test(danach.split(TEILSATZ_ENDE)[0]);
}

function aufrufer(roh) {
  const code = roh.replace(CODESPANNE, (spanne) => (TESTNAME_IN_CODEZEICHEN.test(spanne) ? " " : spanne));
  const aktiv = AKTIVES_NUTZWORT.exec(code);
  if (aktiv) return code.slice(0, aktiv.index).match(NAME_IM_TEIL) ?? [];
  const passiv = PASSIV_VON.exec(code);
  return passiv ? [passiv[1]] : [];
}

function klammerNamen(text) {
  return [...text.replace(FUNKTION_KOPF, "").matchAll(WORT_MIT_KLAMMER)];
}

function aufrufMitAufrufer(teil) {
  const rein = teil.replace(ZEICHENKETTE, "").replace(ZEILENKOMMENTAR, "");
  const fall = FALL_SATZ.test(rein);
  const nutzt = NUTZ_WORT.test(rein) || fall;
  const spannen = (rein.match(CODESPANNE) ?? []).join(" ");
  const von = fall ? [] : aufrufer(rein.replace(FUNKTION_KOPF, ""));
  const inSpannen = klammerNamen(nutzt ? spannen : spannen.replace(EINFACHER_NAME_IN_CODEZEICHEN, " "));
  const inProsa = klammerNamen(rein.replace(CODESPANNE, " "));
  const zaehltInProsa = ([, name, klammer]) => (klammer !== undefined && (nutzt || CODEZEILE.test(rein))) || (nutzt && CODEHAFT.test(name));
  const treffer = [...inSpannen.filter(([, , klammer]) => klammer !== undefined || nutzt), ...inProsa.filter(zaehltInProsa)];
  const aufgerufen = treffer.filter(([, name, klammer]) => klammer !== undefined || !von.includes(name));
  return { von, namen: aufgerufen.map(({ 1: name }) => name), alle: nutzt && PRONOMEN.test(rein) };
}

function nutzteile(satz) {
  if (FALL_SATZ.test(satz)) return istVerneint(satz) ? [] : [satz];
  const [hauptsatz, ...nebensaetze] = satz.split(DASS_SATZ);
  const [erster, ...weitere] = hauptsatz.split(UND_MIT_NUTZWORT);
  if (istVerneint(erster)) return [];
  return [erster, ...weitere, ...nebensaetze].filter((text) => !istVerneint(text));
}

function nenntAnderenAuftrag(satz, fremdeKennungen) {
  return ANDERER_AUFTRAG.test(satz) || (satz.match(WORT) ?? []).some((wort) => fremdeKennungen.has(wort));
}

function nutzbareTeile(texte, fremdeKennungen) {
  const relevant = texte.flatMap(saetze).filter((satz) => !istDeklaration(satz) && !nenntAnderenAuftrag(satz, fremdeKennungen));
  return relevant.flatMap(nutzteile);
}

function verwendeteNamen(aufrufe, deklariert) {
  const verwendet = new Set();
  const abhaengig = aufrufe.filter(({ von }) => von.some((name) => deklariert.has(name)));
  const frei = aufrufe.filter((eintrag) => !abhaengig.includes(eintrag));
  frei.forEach(({ namen }) => namen.forEach((name) => verwendet.add(name)));
  if (frei.some(({ alle }) => alle)) deklariert.forEach((name) => verwendet.add(name));
  let neu = true;
  while (neu) {
    const freigegeben = abhaengig.filter(({ von, namen }) => von.some((name) => verwendet.has(name)) && namen.some((name) => !verwendet.has(name)));
    freigegeben.forEach(({ namen }) => namen.forEach((name) => verwendet.add(name)));
    neu = freigegeben.length > 0;
  }
  return verwendet;
}

function mitFallImAnlegesatz(texte, fremdeKennungen) {
  const eigene = texte.flatMap(saetze).filter((satz) => istDeklaration(satz) && !nenntAnderenAuftrag(satz, fremdeKennungen));
  const mitFall = eigene.filter((satz) => FALL_MIT_NUTZUNG.test(satz) && !OHNE_DASS.test(satz) && !istVerneint(satz.slice(satz.search(/\bFall\b/))));
  return new Set(mitFall.flatMap(namenImSatz));
}

function mitKlammerInAnlegesaetzen(texte, fremdeKennungen) {
  const eigene = texte.flatMap(saetze).filter((satz) => istDeklaration(satz) && !nenntAnderenAuftrag(satz, fremdeKennungen));
  const hilfssaetze = eigene.map((satz) => satz.replace(FUNKTION_KOPF, ""));
  const treffer = hilfssaetze.flatMap((satz) => [...satz.matchAll(WORT_MIT_KLAMMER)].filter(({ 2: klammer, index }) => klammer !== undefined && !nachNegation(satz, index)));
  return new Set(treffer.map(({ 1: name }) => name));
}

function ohneDeklarationen(text) {
  return [ZEICHENKETTE, ZEILENKOMMENTAR, IMPORT_ZEILE, FUNKTION_KOPF, PFEIL_KOPF].reduce((rest, muster) => rest.replace(muster, ""), text);
}

function ausserImportGenannt(texte, fremdeKennungen) {
  const teile = nutzbareTeile(texte.map(ohneDeklarationen), fremdeKennungen);
  return new Set(teile.flatMap((teil) => teil.match(WORT) ?? []));
}

function genutzteImporte(texte, fremdeKennungen, { inCode, inProsa }) {
  const klammer = mitKlammerInAnlegesaetzen(texte, fremdeKennungen);
  const genannt = ausserImportGenannt(texte, fremdeKennungen);
  return [...inProsa.filter((name) => klammer.has(name)), ...inCode.filter((name) => genannt.has(name))];
}

function hilfszeilenBefund(auftrag, entwurf, fremdeKennungen) {
  const schluessel = bereichSchluessel(auftrag.bereich);
  const eigener = entwurf?.[schluessel];
  if (typeof auftrag.bereich !== "string" || !istAusfuehrbarerTest(auftrag.bereich) || typeof eigener !== "string") return [];
  const weitere = (auftrag.erwarteteDateien ?? []).filter((pfad) => pfad !== schluessel).map((pfad) => entwurf[pfad]);
  const texte = [eigener, ...weitere.filter((text) => typeof text === "string")];
  const inCode = [...importeInCode(eigener), ...deklarierteImCode(eigener)];
  const inProsa = importeInProsa(eigener);
  const importiert = [...inCode, ...inProsa];
  const deklariert = [...new Set([...deklarierteImCode(eigener), ...deklarierteInSaetzen(eigener).filter((name) => !importiert.includes(name)), ...importiert])];
  const verwendet = verwendeteNamen(nutzbareTeile(texte, fremdeKennungen).map(aufrufMitAufrufer), new Set(deklariert));
  [...genutzteImporte(texte, fremdeKennungen, { inCode, inProsa }), ...mitFallImAnlegesatz(texte, fremdeKennungen)].forEach((name) => verwendet.add(name));
  const exportiert = exportierteNamen(texte);
  const ungenutzt = deklariert.filter((name) => !verwendet.has(name) && !exportiert.has(name));
  if (ungenutzt.length === 0) return [];
  return [`${auftrag.id}: der Entwurf für ${schluessel} legt Hilfszeilen an (${ungenutzt.join(", ")}), aber kein Testfall in diesem Auftrag ruft sie auf; lint neuer funktionen meldet sie als unbenutzt. ${HINWEIS}`];
}

export function hilfszeilenBefunde(auftraege, phase) {
  const kennungen = new Set(phase.auftraege.map(({ id }) => id));
  return auftraege.flatMap((auftrag) => hilfszeilenBefund(auftrag, phase.entwurf, new Set([...kennungen].filter((id) => id !== auftrag.id))));
}
