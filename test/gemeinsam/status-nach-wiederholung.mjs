export const KONTROLL_VERSUCHE = 5;
const HTTP_UNAVAILABLE = 503;

export async function statusNachWiederholung(abfrage) {
  let status = await abfrage();
  for (let versuch = 1; versuch < KONTROLL_VERSUCHE && status === HTTP_UNAVAILABLE; versuch += 1) {
    status = await abfrage();
  }
  return status;
}
