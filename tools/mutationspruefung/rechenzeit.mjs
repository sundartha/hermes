import { BUDGET_MS, SCHAETZUNG_MS } from "./budget.mjs";
import { dauer, notiereVorschau } from "./zeitlog.mjs";

const PRUEFUNG = { normal: "der normalen Mutation", testumbau: "der Testumbau-Mutation" };
const uhr = { art: null };

export function starteBudget(art) {
  uhr.art = art;
}

export function budgetLaeuft() {
  return uhr.art !== null;
}

export function schaetzung({ aufrufe, mutanten }) {
  return aufrufe * SCHAETZUNG_MS.aufruf + mutanten * SCHAETZUNG_MS.mutant;
}

function budgetText() {
  return `Budget ${PRUEFUNG[uhr.art]} ${dauer(BUDGET_MS[uhr.art])} Rechenzeit`;
}

export function vorschau(umfang) {
  if (!budgetLaeuft()) return;
  const { seite, quelldateien, testdateien, testgruppen, aufrufe, mutanten, unzaehlbar } = umfang;
  const ms = schaetzung(umfang);
  const frei = BUDGET_MS[uhr.art];
  const rechnung = `${aufrufe} Stryker-Aufrufe × ${dauer(SCHAETZUNG_MS.aufruf)} + ${mutanten} Mutanten × ${dauer(SCHAETZUNG_MS.mutant)} = ${dauer(ms)}`;
  const unbekannt = unzaehlbar > 0 ? `, Mutanten in ${unzaehlbar} Quelldateien nicht zählbar, Schätzung mindestens` : "";
  console.log(`Vorschau ${seite}: ${quelldateien} Quelldateien, ${testdateien} Testdateien, ${testgruppen} Testgruppen, ${mutanten} Mutanten${unbekannt}; Schätzung ${rechnung}; ${budgetText()}.`);
  notiereVorschau({ ...umfang, schaetzung_ms: ms, budget_ms: BUDGET_MS[uhr.art], frei_ms: frei });
  if (ms > frei) throw new Error(`Budget: Schätzung ${dauer(ms)} liegt über dem ${budgetText()}; kein Start, kein Urteil.`);
}
