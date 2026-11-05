import { bereichSchluessel, istAusfuehrbarerTest } from "./format.mjs";

const SATZ_ENDE = /(?<=[.!?])\s+|\n/;
const HILFE_WORT = /Hilfs(?:funktion|zeile|baustein)|Testhilfe/i;
const VERNEINUNG = /\b(?:kein|keine|keinen|keiner|keines|ohne|nicht)\b/i;
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

function istDeklaration(satz) {
  return HILFE_WORT.test(satz) && !NUTZ_WORT.test(satz);
}

function deklarierteInSaetzen(text) {
  const hilfssaetze = saetze(text).filter((satz) => istDeklaration(satz) && !VERNEINUNG.test(satz));
  return hilfssaetze.flatMap((satz) => [...satz.matchAll(NAME_IN_CODEZEICHEN)].map(([, name]) => name));
}

function exportierteNamen(texte) {
  return new Set(texte.flatMap((text) => [...text.matchAll(EXPORT_LISTE)]).flatMap(([, liste]) => liste.match(WORT) ?? []));
}

function verwendeteNamen(saetzeAlle, fremdeKennungen) {
  const verwendet = new Set();
  for (const satz of saetzeAlle) {
    if (istDeklaration(satz) || VERNEINUNG.test(satz) || (satz.match(WORT) ?? []).some((wort) => fremdeKennungen.has(wort))) continue;
    const woerter = [...satz.replace(FUNKTION_KOPF, "").matchAll(WORT_MIT_KLAMMER)];
    const nutzt = NUTZ_WORT.test(satz);
    for (const [, name, klammer] of woerter) {
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
