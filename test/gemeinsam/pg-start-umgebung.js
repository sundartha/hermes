import { startServer } from "../helpers.js";

const BOOTSTRAP_NUMMER = "+15005550006";
const BOOTSTRAP_ANBIETER = "telnyx";

export function pgStartUmgebung(adresse, zusatz = {}) {
  return {
    STORE_BACKEND: "pg",
    DATABASE_URL: adresse,
    BOOTSTRAP_E164: BOOTSTRAP_NUMMER,
    BOOTSTRAP_PROVIDER: BOOTSTRAP_ANBIETER,
    ...zusatz,
  };
}

export async function mitGestartetemHermes(adresse, zusatz, aktion) {
  const prozess = await startServer({ env: pgStartUmgebung(adresse, zusatz) });
  try {
    return await aktion(prozess);
  } finally {
    await prozess.stop();
  }
}
