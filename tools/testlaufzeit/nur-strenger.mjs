import { execFileSync } from "node:child_process";

function stand(basis, datei) {
  try {
    const text = execFileSync("git", ["show", `${basis}:${datei}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function ausklingenStrenger(basis, datei, jetzt) {
  const vorher = basis ? stand(basis, datei) : null;
  if (vorher === null || vorher.ausklingen_grenze_ms === null) return [];
  const neu = jetzt.ausklingen_bestand.filter(
    (eintrag) => !vorher.ausklingen_bestand.includes(eintrag),
  );
  const grenzeVorher = vorher.ausklingen_grenze_ms;
  const grenzeJetzt = jetzt.ausklingen_grenze_ms;
  const hoeher = grenzeVorher !== null && (grenzeJetzt === null || grenzeJetzt > grenzeVorher);
  return [
    ...neu.map(
      (eintrag) => `${datei}: ${eintrag} ist neu im Bestand; die Liste darf nur kürzer werden`,
    ),
    ...(hoeher ? [`${datei}: die Grenze steigt von ${grenzeVorher} ms; sie darf nur sinken`] : []),
  ];
}

export function zeitgliederStrenger(basis, datei, jetzt) {
  const vorher = basis ? stand(basis, datei) : null;
  if (vorher === null) return [];
  return Object.entries(jetzt)
    .filter(([eintrag, zahl]) => !(eintrag in vorher) || zahl > vorher[eintrag])
    .map(([eintrag]) => `${datei}: ${eintrag} ist neu oder steigt; Einträge dürfen nur sinken`);
}
