export const TESTDATEI_ENDUNG = ".test.js";

export function hilfsdateiBefunde(zeilen) {
  return zeilen
    .filter(({ datei }) => !datei.endsWith(TESTDATEI_ENDUNG))
    .map(
      ({ datei }) =>
        `Testfälle in ${datei}: test() gehört in die Testdatei, sonst zählt die Laufzeit falsch`,
    );
}
