import pg from "pg";

import { LASTLAUF_WERKZEUG_TOKEN, WEB_SITZUNGS_GEHEIMNIS } from "../../test/gemeinsam/erfundene-geheimnisse.js";
import { POSTGRES_VARIABLE } from "../../test/gemeinsam/echtes-postgres.js";
import { verwaltungsAdresse } from "../../test/gemeinsam/verwaltungsadresse.js";
import { echteDatenbankMitRolle } from "../../test/gemeinsam/test-rolle.js";
import { seedeMandant, starteAnAnbieter } from "../../test/anrufe/hermes-mit-postgres.js";
import { makeTelnyxSigner, nowSeconds, startIdp } from "../../test/helpers.js";
import { starteLastAttrappe } from "./attrappe.mjs";
import { baueWebhooks, WEBHOOKS_JE_LAUF } from "./webhooks.mjs";

export { baueWebhooks };

const TOKEN_GUELTIG = "30m";
const ANZAHL_MANDANTEN = 3;
const ERSTE_RUFNUMMER = 400;
const MANDANTEN = Array.from({ length: ANZAHL_MANDANTEN }, (leer, nummer) => ({
  id: `tenant_last_${nummer}`,
  sub: `sub-last-${nummer}`,
  e164: `+4930555000${ERSTE_RUFNUMMER + nummer}`,
}));
const ELEVENLABS_ABFRAGE_MS = "200";
const RESSOURCEN_PFAD = "/.well-known/oauth-protected-resource";

function prozessUmgebung({ idp, signer }) {
  return {
    ELEVENLABS_RESULT_POLL_MS: ELEVENLABS_ABFRAGE_MS,
    ELEVENLABS_TOOL_TOKEN: LASTLAUF_WERKZEUG_TOKEN,
    ELEVENLABS_INBOUND_TENANT_IDS: MANDANTEN.map((mandant) => mandant.id).join(","),
    MCP_AUTH: "oauth",
    OAUTH_ISSUER_URL: idp.issuer,
    MULTI_TENANT: "true",
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    DEV_LOGIN_ENABLED: "true",
    SESSION_SECRET: WEB_SITZUNGS_GEHEIMNIS,
    SELF_SERVICE_ENABLED: "true",
    LOGIN_RATE_LIMIT_PER_MIN: "10000",
  };
}

async function audienzVon(prozess) {
  const antwort = await fetch(`${prozess.localUrl}${RESSOURCEN_PFAD}`);
  return (await antwort.json()).resource;
}

export async function starteLokaleUmgebung({ rotprobe } = {}) {
  const aufraeumen = [];
  const merke = (schliessen) => aufraeumen.push(schliessen);
  const kontext = { after: merke, diagnostic: () => undefined, skip: () => undefined };
  const schliessen = async () => {
    for (const aufgabe of aufraeumen.reverse()) {
      await aufgabe().catch((fehler) => console.error("[lastlauf] aufraeumen:", fehler.message));
    }
  };
  try {
    const db = await echteDatenbankMitRolle(kontext);
    if (!db) throw new Error(`Lastlauf abgebrochen: ${POSTGRES_VARIABLE} fehlt`);
    const verwaltung = new pg.Client({ connectionString: verwaltungsAdresse(db.adresse) });
    await verwaltung.connect();
    merke(() => verwaltung.end());
    const idp = await startIdp();
    merke(() => idp.close());
    const signer = makeTelnyxSigner();
    const anbieter = await starteLastAttrappe({ signer });
    merke(() => anbieter.close());
    const env = prozessUmgebung({ idp, signer });
    const erster = await starteAnAnbieter(db, anbieter, env);
    await erster.stop();
    for (const mandant of MANDANTEN) await seedeMandant((text, werte) => verwaltung.query(text, werte), mandant);
    const prozesse = [await starteAnAnbieter(db, anbieter, env), await starteAnAnbieter(db, anbieter, env)];
    merke(() => Promise.all(prozesse.map((prozess) => prozess.stop())));
    const audiences = await Promise.all(prozesse.map(audienzVon));
    const tokens = await Promise.all(
      MANDANTEN.map((mandant) => idp.sign({ sub: mandant.sub }, { exp: TOKEN_GUELTIG, aud: audiences })),
    );
    const jetzt = nowSeconds();
    return {
      ziele: prozesse.map((prozess) => prozess.localUrl),
      konfiguration: {
        ziele: prozesse.map((prozess) => prozess.localUrl),
        tokens,
        werkzeugToken: LASTLAUF_WERKZEUG_TOKEN,
        rotprobe,
        appSub: MANDANTEN[0].sub,
        appEmail: `${MANDANTEN[0].sub}@test.invalid`,
        webhooks: {
          gueltig: baueWebhooks(signer, WEBHOOKS_JE_LAUF, jetzt),
          ungueltig: baueWebhooks(makeTelnyxSigner(), WEBHOOKS_JE_LAUF, jetzt),
        },
      },
      schliessen,
    };
  } catch (fehler) {
    await schliessen();
    throw fehler;
  }
}
