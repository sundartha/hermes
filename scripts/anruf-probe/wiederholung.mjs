import { urteilen } from "./urteil.mjs";

export const ABSTAND_MS = 120000;

const SCHREIBWEISE = /[\s\-().]/g;

export function normalisiert(nummer) {
  return String(nummer).replace(SCHREIBWEISE, "");
}

const GRUND_MAX = 60;
const GRUNDCODE = /^[A-Za-z_]+$/;

function bereinigt(fehler) {
  if (fehler === null || fehler === undefined) return "";
  const kandidaten = [fehler.code, fehler.cause?.code, fehler.name];
  const code = kandidaten.find((wert) => typeof wert === "string" && GRUNDCODE.test(wert));
  return (code ?? "unbekannt").slice(0, GRUND_MAX);
}

async function messenOderNichts(messen) {
  try {
    return urteilen(await messen());
  } catch (fehler) {
    const grund = bereinigt(fehler);
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
