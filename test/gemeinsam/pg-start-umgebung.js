import { startServer } from "../helpers.js";

const STORE_BACKEND = "pg";
const BOOTSTRAP_E164 = "+15005550006";
const BOOTSTRAP_PROVIDER = "telnyx";

export function pgStartUmgebung(adresse, zusatz = {}) {
  return {
    STORE_BACKEND,
    DATABASE_URL: adresse,
    BOOTSTRAP_E164,
    BOOTSTRAP_PROVIDER,
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
