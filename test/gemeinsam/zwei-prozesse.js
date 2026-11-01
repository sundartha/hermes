import { startServer } from "../helpers.js";
import { abrufMitFrist } from "./antwortfrist.mjs";
import { echteDatenbank } from "./echtes-postgres.js";

const DEPLOY_TOKEN = "s1-zwei-prozesse-deploy-token-mindestens-32";
const BOOT_NUMMER = "+15005550006";
const BOOT_ANBIETER = "telnyx";

function gemeinsameUmgebung(adresse, env) {
  return {
    STORE_BACKEND: "pg",
    DATABASE_URL: adresse,
    BOOTSTRAP_E164: BOOT_NUMMER,
    BOOTSTRAP_PROVIDER: BOOT_ANBIETER,
    HERMES_DEPLOY_TOKEN: DEPLOY_TOKEN,
    ...env,
  };
}

export function anfrage(prozess, pfad, { methode = "GET", koerper } = {}) {
  return abrufMitFrist(`${prozess.localUrl}${pfad}`, {
    method: methode,
    headers: {
      Authorization: `Bearer ${DEPLOY_TOKEN}`,
      ...(koerper === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(koerper === undefined ? {} : { body: JSON.stringify(koerper) }),
  });
}

export async function beenden(prozess) {
  await prozess.stop();
  return prozess.child.exitCode;
}

export async function zweiProzesse(t, env = {}) {
  const gestartet = [];
  t.after(() => Promise.all(gestartet.map((prozess) => prozess.stop())));
  const db = await echteDatenbank(t);
  if (!db) return null;
  const umgebung = gemeinsameUmgebung(db.adresse, env);
  const a = await startServer({ env: umgebung });
  gestartet.push(a);
  const b = await startServer({ env: umgebung });
  gestartet.push(b);
  return { db, a, b };
}
