import pg from "pg";

import { LASTLAUF_WERKZEUG_TOKEN, WEB_SITZUNGS_GEHEIMNIS } from "../../test/gemeinsam/erfundene-geheimnisse.js";
import { POSTGRES_VARIABLE } from "../../test/gemeinsam/echtes-postgres.js";
import { verwaltungsAdresse } from "../../test/gemeinsam/verwaltungsadresse.js";
import { pgStartUmgebung } from "../../test/gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../../test/gemeinsam/test-rolle.js";
import { seedeMandant } from "../../test/anrufe/hermes-mit-postgres.js";
import { makeTelnyxSigner, nowSeconds, startIdp, startServer } from "../../test/helpers.js";
import { starteLastAttrappe } from "./attrappe.mjs";

const TOKEN_GUELTIG = "30m";
const WEBHOOKS_JE_LAUF = 200;
const ANZAHL_MANDANTEN = 3;
const ERSTE_RUFNUMMER = 400;
const MANDANTEN = Array.from({ length: ANZAHL_MANDANTEN }, (leer, nummer) => ({
  id: `tenant_last_${nummer}`,
  sub: `sub-last-${nummer}`,
  e164: `+4930555000${ERSTE_RUFNUMMER + nummer}`,
}));
const ELEVENLABS = Object.freeze({
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_last",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_last",
  ELEVENLABS_API_KEY: "el-last-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "200",
});

export function baueWebhooks(signer, anzahl, zeitpunktS) {
  return Array.from({ length: anzahl }, (leer, nummer) => {
    const koerper = new URLSearchParams({ CallSid: `CAlast${nummer}`, CallStatus: "ringing" }).toString();
    const zeit = String(zeitpunktS);
    return {
      koerper,
      kopf: { "telnyx-signature-ed25519": signer.sign(zeit, koerper), "telnyx-timestamp": zeit },
    };
  });
}

function prozessUmgebung({ db, anbieter, idp, signer }) {
  return pgStartUmgebung(db.adresse, {
    ...ELEVENLABS,
    ELEVENLABS_API_BASE: anbieter.url,
    ELEVENLABS_TOOL_TOKEN: LASTLAUF_WERKZEUG_TOKEN,
    MCP_AUTH: "oauth",
    OAUTH_ISSUER_URL: idp.issuer,
    MULTI_TENANT: "true",
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    DEV_LOGIN_ENABLED: "true",
    SESSION_SECRET: WEB_SITZUNGS_GEHEIMNIS,
    SELF_SERVICE_ENABLED: "true",
    LOGIN_RATE_LIMIT_PER_MIN: "10000",
  });
}

export async function starteLokaleUmgebung() {
  const aufraeumen = [];
  const merke = (schliessen) => aufraeumen.push(schliessen);
  const kontext = { after: merke, diagnostic: () => undefined, skip: () => undefined };
  const schliessen = async () => {
    for (const aufgabe of aufraeumen.reverse()) await aufgabe();
  };
  try {
    const db = await echteDatenbankMitRolle(kontext);
    if (!db) throw new Error(`Lastlauf abgebrochen: ${POSTGRES_VARIABLE} fehlt`);
    const verwaltung = new pg.Client({ connectionString: verwaltungsAdresse(db.adresse) });
    await verwaltung.connect();
    merke(() => verwaltung.end());
    const anbieter = await starteLastAttrappe();
    merke(() => anbieter.close());
    const idp = await startIdp();
    merke(() => idp.close());
    const signer = makeTelnyxSigner();
    const env = prozessUmgebung({ db, anbieter, idp, signer });
    const erster = await startServer({ env });
    await erster.stop();
    for (const mandant of MANDANTEN) await seedeMandant((text, werte) => verwaltung.query(text, werte), mandant);
    const prozesse = [await startServer({ env }), await startServer({ env })];
    merke(() => Promise.all(prozesse.map((prozess) => prozess.stop())));
    const tokens = await Promise.all(MANDANTEN.map((mandant) => idp.sign({ sub: mandant.sub }, { exp: TOKEN_GUELTIG })));
    const jetzt = nowSeconds();
    return {
      ziele: prozesse.map((prozess) => prozess.localUrl),
      konfiguration: {
        ziele: prozesse.map((prozess) => prozess.localUrl),
        tokens,
        werkzeugToken: LASTLAUF_WERKZEUG_TOKEN,
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
