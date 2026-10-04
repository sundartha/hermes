export const GRUPPE = 25;

export function gruppen(testdateien) {
  const anzahl = Math.ceil(testdateien.length / GRUPPE);
  return Array.from({ length: anzahl }, (_leer, gruppe) =>
    testdateien.filter((_datei, index) => index % anzahl === gruppe),
  );
}
