export const GRUPPE = 25;

export function gruppen(testdateien) {
  const anzahl = Math.ceil(testdateien.length / GRUPPE);
  return Array.from({ length: anzahl }, (_leer, gruppe) =>
    testdateien.filter((_datei, index) => index % anzahl === gruppe),
  );
}

const HAELFTEN = 2;

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
