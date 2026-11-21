export const KONTROLL_VERSUCHE = 5;
const HTTP_NICHT_VERFUEGBAR = 503;

export async function statusNachWiederholung(abfrage, vorWiederholung) {
  if (typeof vorWiederholung !== "function") {
    throw new TypeError("vorWiederholung fehlt");
  }
  let status = await abfrage();
  for (let versuch = 1; status === HTTP_NICHT_VERFUEGBAR && versuch < KONTROLL_VERSUCHE; versuch++) {
    await vorWiederholung();
    status = await abfrage();
  }
  return status;
}
