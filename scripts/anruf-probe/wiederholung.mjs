import { urteilen } from "./urteil.mjs";

export const ABSTAND_MS = 120000;

const SCHREIBWEISE = /[\s\-().]/g;

export function normalisiert(nummer) {
  return String(nummer).replace(SCHREIBWEISE, "");
}

const GRUND_MAX = 120;
const ADRESSE = /\S*:\/\/\S*/g;
const ZIFFERN = /\d{4,}/g;

function bereinigt(meldung) {
  return String(meldung ?? "")
    .replace(ADRESSE, "***")
    .replace(ZIFFERN, "***")
    .slice(0, GRUND_MAX);
}

async function messenOderNichts(messen) {
  try {
    return urteilen(await messen());
  } catch (fehler) {
    const grund = bereinigt(fehler?.message);
    return grund === "" ? urteilen(null) : { ...urteilen(null), grund };
  }
}

export async function probeLaufen({ messen, uhr }) {
  const erst = await messenOderNichts(messen);
  if (erst.gruen) return { ausgang: "gruen", erst };
  const seit = new Date(uhr.jetzt()).toISOString();
  await uhr.warte(ABSTAND_MS);
  const zweit = await messenOderNichts(messen);
  if (zweit.gruen) return { ausgang: "wiederholung_gruen", erst, zweit };
  return { ausgang: "rot", seit, erst, zweit };
}
