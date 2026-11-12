export const LOOPBACK = "127.0.0.1";
const ZIEL_ARGUMENTE = 2;

function hostVon(angabe) {
  try {
    return new URL(`http://${angabe}`).hostname;
  } catch {
    return null;
  }
}

export function leseAufruf(argv, bekannteProben) {
  const [probe, ...rest] = argv;
  const mitZiel = rest.length === ZIEL_ARGUMENTE;
  if (!bekannteProben.includes(probe)) return { fehler: "unbekannte Probe" };
  if (rest.length === 0) return { probe };
  if (mitZiel && rest[0] === "--ziel" && hostVon(rest[1]) === LOOPBACK) return { probe };
  return { fehler: "Ziel ausser 127.0.0.1 oder unbekannte Angabe" };
}
