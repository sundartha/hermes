export const STAGING_ADRESSE = "https://hermes-staging-erpv.onrender.com";

const UMGEBUNG_CI = "ci";
const UMGEBUNG_STAGING = "staging";
const LOKALE_NAMEN = Object.freeze(["127.0.0.1", "localhost"]);
const KEIN_PORT = "";

function zerlege(adresse) {
  if (typeof adresse !== "string" || adresse.length === 0) return undefined;
  try {
    return new URL(adresse);
  } catch {
    return undefined;
  }
}

function hatZugangsdaten(ziel) {
  return ziel.username !== "" || ziel.password !== "";
}

function istLokal(ziel) {
  return ziel.protocol === "http:" && LOKALE_NAMEN.includes(ziel.hostname) && ziel.port !== KEIN_PORT;
}

function istStaging(ziel) {
  return ziel.origin === STAGING_ADRESSE;
}

const PRUEFUNGEN = Object.freeze({
  [UMGEBUNG_CI]: istLokal,
  [UMGEBUNG_STAGING]: istStaging,
});

export function zielErlaubt(adresse, umgebung) {
  const ziel = zerlege(adresse);
  if (ziel === undefined) return { erlaubt: false, grund: "adresse_unlesbar" };
  if (hatZugangsdaten(ziel)) return { erlaubt: false, grund: "zugangsdaten_in_adresse" };
  if (!Object.hasOwn(PRUEFUNGEN, umgebung)) return { erlaubt: false, grund: "umgebung_unbekannt" };
  if (!PRUEFUNGEN[umgebung](ziel)) return { erlaubt: false, grund: "ziel_nicht_erlaubt" };
  return { erlaubt: true, grund: "" };
}

export async function fuehreAusWennErlaubt(adresse, umgebung, aufruf) {
  const urteil = zielErlaubt(adresse, umgebung);
  if (!urteil.erlaubt) throw new Error(`Lastlauf abgebrochen: ${urteil.grund}`);
  return aufruf(new URL(adresse).origin);
}
