import { mandantenAbruf, zeilenBis } from "../anrufe/hermes-mit-postgres.js";
import { starteAnbieterServer } from "./anbieter-attrappe.mjs";
import { mitVerbindung, POSTGRES_VARIABLE } from "./echtes-postgres.js";
import { echteDatenbankMitRolle } from "./test-rolle.js";
import { gemeinsameUmgebung } from "./zwei-prozesse.js";
import { startServer, startTelnyxProvisioningMock } from "../helpers.js";

const HTTP_OK = 200;
const EXPORT_PFAD = "/api/tenant-data/export";

function verwaltungsAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

async function sichtbarerMandant(prozess, sub) {
  const antwort = await mandantenAbruf(prozess, sub).hole(EXPORT_PFAD);
  return antwort.status === HTTP_OK ? (await antwort.json()).tenantId : antwort.status;
}

const ausgabe = (prozess, nummer) => `--- stdout Instanz ${nummer} ---\n${prozess.stdout}`;

async function mitDiagnose({ a, b, stripe }, schritt) {
  try {
    return await schritt();
  } catch (fehler) {
    throw new Error(
      `${fehler.message}\n${ausgabe(a, 1)}\n${ausgabe(b, 2)}\nAnfragen des Stripe-Attrappenservers:\n${JSON.stringify(stripe.anfragen)}`,
      { cause: fehler },
    );
  }
}

export async function kaufAufbau(t, { umgebung, stripeAntwort, mandant, sub, seede }) {
  const db = await echteDatenbankMitRolle(t);
  const [telnyx, stripe] = [await startTelnyxProvisioningMock(), await starteAnbieterServer(stripeAntwort)];
  const gestartet = [];
  t.after(() => Promise.all([...gestartet.map((prozess) => prozess.stop()), telnyx.close(), stripe.close()]));
  const env = gemeinsameUmgebung(db.adresse, { ...umgebung, TELNYX_API_BASE: telnyx.url, STRIPE_API_BASE: stripe.url });
  const starten = async () => {
    const prozess = await startServer({ env });
    gestartet.push(prozess);
    return prozess;
  };
  await (await starten()).stop();
  gestartet.length = 0;
  const sql = (text, parameter) =>
    mitVerbindung(verwaltungsAdresse(db.adresse), async (verbindung) => (await verbindung.query(text, parameter)).rows);
  await seede(sql);
  const instanzen = { a: await starten(), b: await starten(), stripe };
  const diagnose = (schritt) => mitDiagnose(instanzen, schritt);
  await diagnose(() =>
    Promise.all(
      [instanzen.a, instanzen.b].map((prozess) =>
        zeilenBis(
          () => sichtbarerMandant(prozess, sub),
          (sichtbar) => sichtbar === mandant,
        ),
      ),
    ),
  );
  return { telnyx, sql, diagnose, a: instanzen.a, b: instanzen.b };
}
