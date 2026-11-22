import { urteilen } from "./urteil.mjs";

export const ABSTAND_MS = 120000;

const SCHREIBWEISE = /[\s\-().]/g;

export function normalisiert(nummer) {
  return String(nummer).replace(SCHREIBWEISE, "");
}

async function messenOderNichts(messen) {
  try {
    return urteilen(await messen());
  } catch {
    return urteilen(null);
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
