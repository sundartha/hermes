export const GRUPPE = 25;

export function gruppen(testdateien) {
  const anzahl = Math.ceil(testdateien.length / GRUPPE);
  return Array.from({ length: anzahl }, (_leer, gruppe) =>
    testdateien.filter((_datei, index) => index % anzahl === gruppe),
  );
}

const HAELFTEN = 2;
export const ERSTLAUF_GESCHEITERT = "Something went wrong in the initial test run";
export const ERSTLAUF_ZEITGRENZE = "Initial test run timed out!";
export const ERSTLAUF_FEHLER = "One or more tests resulted in an error:";

export function zeitgrenzeGemeldet(fehler, mitschrift) {
  const gemeldet = (meldung) => mitschrift.some((zeile) => zeile.includes(meldung));
  return fehler.message === ERSTLAUF_GESCHEITERT && gemeldet(ERSTLAUF_ZEITGRENZE) && !gemeldet(ERSTLAUF_FEHLER);
}

export async function geteiltBeiZeitgrenze(tests, laufen, ueberZeitgrenze) {
  try {
    return [await laufen(tests)];
  } catch (fehler) {
    if (!ueberZeitgrenze(fehler) || tests.length === 1) throw fehler;
    const mitte = Math.ceil(tests.length / HAELFTEN);
    const vorne = await geteiltBeiZeitgrenze(tests.slice(0, mitte), laufen, ueberZeitgrenze);
    return [...vorne, ...(await geteiltBeiZeitgrenze(tests.slice(mitte), laufen, ueberZeitgrenze))];
  }
}
