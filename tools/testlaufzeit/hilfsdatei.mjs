export const TESTDATEI = /\.test\.[jt]s$/;

export function hilfsdateiBefunde(zeilen) {
  return zeilen
    .filter(({ datei }) => !TESTDATEI.test(datei))
    .map(
      ({ datei }) =>
        `Testfälle in ${datei}: test() gehört in die Testdatei, sonst zählt die Laufzeit falsch`,
    );
}
