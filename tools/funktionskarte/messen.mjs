import { abgeleitetesBudget, markierungen, p95 } from "./antwortzeiten.mjs";
import { kartenSpielen } from "./lauf.mjs";

async function reiheMessen(karten, flaechen, wiederholungen) {
  const werte = new Map();
  const verworfen = [];
  for (let lauf = 0; lauf < wiederholungen; lauf += 1) {
    for (const ergebnis of await kartenSpielen(karten, flaechen)) {
      if (ergebnis.blockiert.length > 0 || ergebnis.befunde.length > 0) {
        verworfen.push(...ergebnis.blockiert, ...ergebnis.befunde);
        continue;
      }
      for (const { name, ms } of ergebnis.messwerte) werte.set(name, [...(werte.get(name) ?? []), ms]);
    }
  }
  return { werte, verworfen };
}

export async function messen({ karten, flaechen, wiederholungen, reihen, melden }) {
  const mitMarkierung = karten.filter((karte) => markierungen([karte]).length > 0);
  const namen = [...new Set(markierungen(mitMarkierung).map(({ name }) => name))];
  const hoechstes = new Map();
  const verworfen = [];
  for (let nummer = 1; nummer <= reihen; nummer += 1) {
    const reihe = await reiheMessen(mitMarkierung, flaechen, wiederholungen);
    verworfen.push(...reihe.verworfen);
    for (const [name, liste] of reihe.werte) {
      melden(
        `Reihe ${nummer} ${name}: p95 ${p95(liste)} ms, max ${Math.max(...liste)} ms, ${liste.length} Läufe`,
      );
      hoechstes.set(name, Math.max(hoechstes.get(name) ?? 0, p95(liste)));
    }
  }
  return {
    verworfen,
    budgets: Object.fromEntries(
      namen.filter((name) => hoechstes.has(name)).map((name) => [name, abgeleitetesBudget(hoechstes.get(name))]),
    ),
    fehlend: namen.filter((name) => !hoechstes.has(name)),
  };
}
