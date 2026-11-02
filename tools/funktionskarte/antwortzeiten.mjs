import { existsSync, readFileSync } from "node:fs";

export const BUDGET_PFAD = ".github/antwortzeiten.json";
export const BUDGET_ABSCHNITT = "attrappen";
const WEITERE_ABSCHNITTE = ["staging"];
const NAME_MUSTER = /^[a-z][a-z0-9-]*$/;
const P95 = 0.95;
const SICHERHEITSFAKTOR = 1.5;
const AUFRUNDEN_AUF_MS = 10;

export const istBudgetWert = (ms) => Number.isInteger(ms) && ms > 0;

const istObjekt = (wert) => wert !== null && typeof wert === "object" && !Array.isArray(wert);

export function budgetNameFehler(name) {
  return typeof name === "string" && NAME_MUSTER.test(name)
    ? undefined
    : "„antwortzeit“ braucht einen Namen aus Kleinbuchstaben, Ziffern und Bindestrichen";
}

function budgetFormFehler(budgets, pfad) {
  if (!istObjekt(budgets) || !istObjekt(budgets[BUDGET_ABSCHNITT])) {
    return [`${pfad}: braucht ein Objekt „${BUDGET_ABSCHNITT}“`];
  }
  const fehlend = WEITERE_ABSCHNITTE.filter((abschnitt) => !istObjekt(budgets[abschnitt]));
  const unbekannt = Object.keys(budgets).filter(
    (schluessel) => schluessel !== BUDGET_ABSCHNITT && !WEITERE_ABSCHNITTE.includes(schluessel),
  );
  const ungueltig = Object.entries(budgets[BUDGET_ABSCHNITT])
    .filter(([, ms]) => !istBudgetWert(ms))
    .map(([name]) => `${pfad}: Budget ${name} muss eine ganze Zahl über 0 sein (Millisekunden)`);
  return [
    ...fehlend.map((abschnitt) => `${pfad}: braucht ein Objekt „${abschnitt}“`),
    ...unbekannt.map((schluessel) => `${pfad}: kennt den Abschnitt „${schluessel}“ nicht`),
    ...ungueltig,
  ];
}

export function budgetsLesen(pfad) {
  const ausdruecklich = pfad !== undefined;
  const datei = pfad ?? BUDGET_PFAD;
  if (!existsSync(datei)) {
    if (ausdruecklich) throw new Error(`Die Budget-Datei ${datei} gibt es nicht.`);
    return { budgets: {}, fehler: [] };
  }
  let inhalt;
  try {
    inhalt = JSON.parse(readFileSync(datei, "utf8"));
  } catch (fehler) {
    return { budgets: {}, fehler: [`${datei}: kein gültiges JSON: ${fehler.message}`] };
  }
  const fehler = budgetFormFehler(inhalt, datei);
  return fehler.length > 0
    ? { budgets: {}, fehler }
    : { budgets: inhalt[BUDGET_ABSCHNITT], fehler: [] };
}

export function markierungen(karten) {
  return karten
    .filter(({ rezept }) => Array.isArray(rezept?.schritte))
    .flatMap(({ pfad, rezept }) =>
      rezept.schritte.flatMap((schritt, index) =>
        typeof schritt?.antwortzeit === "string"
          ? [{ name: schritt.antwortzeit, karte: pfad, schritt: index + 1 }]
          : [],
      ),
    );
}

export function budgetZuordnung({ alle, gespielt, budgets }) {
  const namen = new Set(alle.map(({ name }) => name));
  const gesehen = new Set();
  const doppelt = alle.filter(({ name }) => {
    const schonDa = gesehen.has(name);
    gesehen.add(name);
    return schonDa;
  });
  const ohneBudget = gespielt.filter(({ name }) => !Object.hasOwn(budgets, name));
  const tot = Object.keys(budgets).filter((name) => !namen.has(name));
  return [
    ...doppelt.map(
      ({ name, karte, schritt }) =>
        `${karte} Schritt ${schritt}: Antwortzeit ${name} ist schon an einem anderen Schritt markiert.`,
    ),
    ...ohneBudget.map(
      ({ name, karte, schritt }) =>
        `${karte} Schritt ${schritt}: Antwortzeit ${name} hat kein Budget in ${BUDGET_PFAD}.`,
    ),
    ...tot.map(
      (name) => `${BUDGET_PFAD}: Budget ${name} hat keinen Schritt, der ihn als „antwortzeit“ nennt.`,
    ),
  ];
}

export function antwortzeitUrteil({ name, ausgabe, budgets }) {
  if (name === undefined) return { messwerte: [], befunde: [] };
  const ms = ausgabe.anfrage_ms;
  if (!Number.isFinite(ms)) {
    return {
      messwerte: [],
      befunde: [`Antwortzeit ${name}: die Ausgabe des Schritts nennt kein anfrage_ms.`],
    };
  }
  const messwerte = [{ name, ms }];
  if (budgets !== undefined && Object.hasOwn(budgets, name) && ms > budgets[name]) {
    return {
      messwerte,
      befunde: [`Antwortzeit ${name} ${ms} ms über dem Budget ${budgets[name]} ms.`],
    };
  }
  return { messwerte, befunde: [] };
}

export function p95(werte) {
  const sortiert = werte.toSorted((links, rechts) => links - rechts);
  return sortiert[Math.ceil(P95 * sortiert.length) - 1];
}

export function abgeleitetesBudget(hoechstesP95) {
  return Math.ceil((hoechstesP95 * SICHERHEITSFAKTOR) / AUFRUNDEN_AUF_MS) * AUFRUNDEN_AUF_MS;
}
