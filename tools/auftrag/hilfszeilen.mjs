import { bereichSchluessel, istAusfuehrbarerTest } from "./format.mjs";

const SATZ_ENDE = /(?<=[.!?])\s+|\n/;
const HILFE_WORT = /Hilfs(?:funktion|zeile|baustein)|Testhilfe/i;
const VERNEIN_WOERTER = "kein\\w*|nie|niemand\\w*|nicht";
const KEIN_BEZEICHNER = String.raw`(?!\s*=)`;
const VERNEINUNG = new RegExp(String.raw`\b(?:${VERNEIN_WOERTER}|ohne)\b${KEIN_BEZEICHNER}`, "i");
const VERNEINTER_AUFRUF = new RegExp(String.raw`\b(?:${VERNEIN_WOERTER}|ohne(?=\s+aufruf))\b${KEIN_BEZEICHNER}`, "i");
const ANLEGE_WORT = /\b(?:legt|lege|legen|anlegen|angelegt|definiert|definieren|ergänzt|ergänzen|schreibt|schreiben|baut|bauen)\b/i;
const DASS_SATZ = /\bdass\b/i;
const ERSTER_NAME = /`/;
const TEILSATZ_ENDE = /[,;:]|\b(?:und|dass|aber|sondern)\b/i;
const ZEICHENKETTE = /"[^"]*"|'[^']*'/g;
const NUTZ_WORT = /\b(?:ruft|rufen|aufgerufen|aufruf\w*|nutzt|nutzen|benutzt|verwendet|exportiert)\b/i;
const NAME_IN_CODEZEICHEN = /`([A-Za-z_$][\w$]*)(?:\([^`]*\))?`/g;
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

function deklarierteInSaetzen(text) {
  const hilfssaetze = saetze(text).filter((satz) => istDeklaration(satz) && !VERNEINUNG.test(letzterTeilsatz(satz.split(ERSTER_NAME)[0])));
  return hilfssaetze.flatMap((satz) => [...satz.matchAll(NAME_IN_CODEZEICHEN)].map(([, name]) => name));
}

function exportierteNamen(texte) {
  return new Set(texte.flatMap((text) => [...text.matchAll(EXPORT_LISTE)]).flatMap(([, liste]) => liste.match(WORT) ?? []));
}

function istVerneinterAufruf(satz) {
  return VERNEINTER_AUFRUF.test(satz.split(DASS_SATZ)[0].replace(ZEICHENKETTE, ""));
}

function verwendeteNamen(saetzeAlle, fremdeKennungen) {
  const verwendet = new Set();
  for (const satz of saetzeAlle) {
    if (istDeklaration(satz) || istVerneinterAufruf(satz) || (satz.match(WORT) ?? []).some((wort) => fremdeKennungen.has(wort))) continue;
    const nutzt = NUTZ_WORT.test(satz);
    for (const [, name, klammer] of satz.replace(FUNKTION_KOPF, "").matchAll(WORT_MIT_KLAMMER)) {
      if (klammer !== undefined || nutzt) verwendet.add(name);
    }
  }
  return verwendet;
}

function hilfszeilenBefund(auftrag, entwurf, fremdeKennungen) {
  const schluessel = bereichSchluessel(auftrag.bereich);
  const eigener = entwurf?.[schluessel];
  if (typeof auftrag.bereich !== "string" || !istAusfuehrbarerTest(auftrag.bereich) || typeof eigener !== "string") return [];
  const weitere = (auftrag.erwarteteDateien ?? []).filter((pfad) => pfad !== schluessel).map((pfad) => entwurf[pfad]);
  const texte = [eigener, ...weitere.filter((text) => typeof text === "string")];
  const deklariert = [...new Set([...deklarierteImCode(eigener), ...deklarierteInSaetzen(eigener)])];
  const verwendet = verwendeteNamen(texte.flatMap(saetze), fremdeKennungen);
  const exportiert = exportierteNamen(texte);
  const ungenutzt = deklariert.filter((name) => !verwendet.has(name) && !exportiert.has(name));
  if (ungenutzt.length === 0) return [];
  return [`${auftrag.id}: der Entwurf für ${schluessel} legt Hilfszeilen an (${ungenutzt.join(", ")}), aber kein Testfall in diesem Auftrag ruft sie auf; lint neuer funktionen meldet sie als unbenutzt. ${HINWEIS}`];
}

export function hilfszeilenBefunde(auftraege, phase) {
  const kennungen = new Set(phase.auftraege.map(({ id }) => id));
  return auftraege.flatMap((auftrag) => hilfszeilenBefund(auftrag, phase.entwurf, new Set([...kennungen].filter((id) => id !== auftrag.id))));
}
