import { STRIPE_EREIGNIS_WARTE_GRENZE_MS, STRIPE_EREIGNIS_WARTE_TAKT_MS } from "./begriffe-speicher.js";

export function istAbgelaufen(ende, jetzt) {
  return jetzt >= ende;
}

export async function wartenBisFrei({ versuch, jetzt, schlafen }) {
  const ende = jetzt() + STRIPE_EREIGNIS_WARTE_GRENZE_MS;
  for (;;) {
    const zeile = await versuch();
    if (zeile) return zeile;
    if (istAbgelaufen(ende, jetzt())) throw new Error("stripe event lock busy");
    await schlafen(STRIPE_EREIGNIS_WARTE_TAKT_MS);
  }
}
