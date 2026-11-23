import assert from "node:assert/strict";
import { test } from "node:test";
import pg from "pg";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { logBis } from "../gemeinsam/log-bis.mjs";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { makeTelnyxSigner, nowSeconds, startServer } from "../helpers.js";
import { starteAnrufstartAttrappe } from "./elevenlabs-anrufstart-attrappe.js";
import {
  anweisungenBisZurueck,
  warteAufAnspruchsabschnitt,
} from "./anspruchsverbindung-abschnitt.js";
import { starteAnweisungsMitschnitt } from "./anweisungs-mitschnitt.js";
import { starteDatenbankRelais } from "./datenbank-relais.js";
import { postgresVorhanden } from "./hermes-mit-postgres.js";
import { WEBHOOK_ZUSTELLUNG_SECRET, zeilenBis } from "./zwei-instanzen-postgres.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const HTTP_OK = 200;
const KEIN_STAND = 0;
const FRIST = { timeout: 60_000 };
const OHNE_EIGENE_FRIST = new AbortController().signal;
const ANRUF = "call_halten1";
const ANRUF_ZAUN = "call_halten_zaun_";
const ANRUF_SEKUNDEN = 600;
const KONVERSATION = "conv_halten1";
const NACHLAUF_LOG = "[el-inbound] nachlauf gestartet";
const ANGENOMMEN_LOG = '"status":"in-progress"';
const GRUND_FRIST = "[webhook-zustellung] nachlauf_anspruch grund=frist";
const ANSPRUCH_ANWEISUNG = "UPDATE call SET el_nachlauf_started_at";
const BEGINN = "BEGIN";
const ZURUECK = "ROLLBACK";
const ANGENOMMEN_SQL = "SELECT answered_at FROM call WHERE id = $1";
const SEED_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164, to_e164, goal,
  started_at, answered_at, max_duration_s, provider, cost_profile, elevenlabs_conversation_id, el_bound_at)
  VALUES ($1, $2, $3, 'inbound', 'active', '+491701111111', (SELECT e164 FROM number WHERE tenant_id = $2),
  'Testziel', now(), CASE WHEN $6::boolean THEN now() END, $4, 'telnyx', 'telnyx_inbound_el_convai', $5, now())`;
const EL_UMGEBUNG = {
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: "agent_pg",
  ELEVENLABS_AGENT_PHONE_NUMBER_ID: "phnum_pg",
  ELEVENLABS_API_KEY: "el-pg-schluessel",
  ELEVENLABS_RESULT_POLL_MS: "60000",
};

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

function signierterEndstatus(signer, marke, { callId = ANRUF, status = "completed" } = {}) {
  const rumpf = new URLSearchParams({
    CallStatus: status,
    CallSid: `CA_${callId}`,
    Marke: marke,
  }).toString();
  const zeitstempel = String(nowSeconds());
  return {
    pfad: `/voice/status?callId=${callId}`,
    optionen: {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf),
        "telnyx-timestamp": zeitstempel,
      },
      body: rumpf,
    },
  };
}

const senden = async (instanz, zustellung) =>
  (await abrufMitFrist(`${instanz.localUrl}${zustellung.pfad}`, zustellung.optionen)).status;

async function waermeAnruf(signer, instanz) {
  const ab = instanz.stdout.length;
  assert.equal(
    await senden(instanz, signierterEndstatus(signer, "warm", { status: "in-progress" })),
    HTTP_OK,
  );
  await logBis(instanz, ANGENOMMEN_LOG, { ab });
}

async function zaun(sql, signer, instanz) {
  for (const nr of [0, 1]) {
    const id = `${ANRUF_ZAUN}${nr}`;
    await senden(instanz, signierterEndstatus(signer, id, { callId: id, status: "in-progress" }));
    await zeilenBis(
      async () => (await sql(ANGENOMMEN_SQL, [id])).rows[0].answered_at,
      (wert) => wert !== null,
    );
  }
}

async function mitMitschnitt(t, lauf) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const db = await echteDatenbankMitRolle(t);
  const relais = await starteDatenbankRelais(db.adresse);
  const mitschnitt = await starteAnweisungsMitschnitt(relais.adresse);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  const signer = makeTelnyxSigner();
  const anbieter = await starteAnrufstartAttrappe();
  const umgebung = pgStartUmgebung(mitschnitt.adresse, {
    ...EL_UMGEBUNG,
    ELEVENLABS_API_BASE: anbieter.url,
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    WEBHOOK_ZUSTELLUNG_SECRET,
  });
  let instanz = null;
  try {
    await (await startServer({ env: umgebung })).stop();
    for (const [id, angenommen] of [
      [ANRUF, true],
      [`${ANRUF_ZAUN}0`, false],
      [`${ANRUF_ZAUN}1`, false],
    ]) {
      await sql(SEED_SQL, [
        id,
        BOOTSTRAP_TENANT_ID,
        `tok_${id}`,
        ANRUF_SEKUNDEN,
        `${KONVERSATION}_${id}`,
        angenommen,
      ]);
    }
    instanz = await startServer({ env: umgebung });
    return await lauf({ sql, signer, relais, mitschnitt, instanz });
  } finally {
    relais.fortsetzen();
    await instanz?.stop();
    await mitschnitt.schliessen();
    await relais.schliessen();
    await anbieter.schliessen();
    await verwaltung.end();
  }
}

const gehalteneBeginne = (mitschnitt) =>
  mitschnitt
    .verbindungen()
    .flatMap((anweisungen, nr) => (anweisungen.at(-1) === BEGINN ? [nr] : []));

const seit = (mitschnitt, vorher) =>
  mitschnitt.verbindungen().map((anweisungen, nr) => anweisungen.slice(vorher[nr] ?? KEIN_STAND));

async function fristAblaufenLassen({ sql, signer, relais, mitschnitt, instanz }) {
  await Promise.all([zaun(sql, signer, instanz), zaun(sql, signer, instanz)]);
  await waermeAnruf(signer, instanz);
  relais.anhalten();
  assert.equal(await senden(instanz, signierterEndstatus(signer, "a")), HTTP_OK);
  await logBis(instanz, NACHLAUF_LOG, { signal: OHNE_EIGENE_FRIST });
  assert.ok(instanz.stdout.includes(GRUND_FRIST), instanz.stdout);
  const vorher = mitschnitt.verbindungen().map((anweisungen) => anweisungen.length);
  const gehalten = gehalteneBeginne(mitschnitt);
  relais.fortsetzen();
  await relais.abwarten();
  return { vorher, gehalten };
}

test(
  "Nach Ablauf der Frist endet jeder gehaltene Anspruch mit ROLLBACK; wird keiner gehalten, schreibt das Beanspruchen später nicht mehr",
  FRIST,
  async (t) => {
    await mitMitschnitt(t, async (aufbau) => {
      const { mitschnitt } = aufbau;
      const { vorher, gehalten } = await fristAblaufenLassen(aufbau);
      await mitschnitt.bisBedingung(() =>
        seit(mitschnitt, vorher).some((anweisungen) => anweisungen.includes(ZURUECK)),
      );
      const beanspruchend = await warteAufAnspruchsabschnitt(mitschnitt, vorher, gehalten);
      if (beanspruchend.length === KEIN_STAND) {
        const schreibend = seit(mitschnitt, vorher)
          .flat()
          .filter((text) => text.includes(ANSPRUCH_ANWEISUNG));
        assert.deepEqual(
          schreibend,
          [],
          "kein gehaltener Anspruch: nach Fristablauf darf nichts mehr schreiben",
        );
        return;
      }
      for (const nr of beanspruchend) {
        const spaeter = anweisungenBisZurueck(mitschnitt, nr, vorher);
        assert.ok(spaeter.includes(ZURUECK), JSON.stringify(spaeter));
        assert.deepEqual(
          spaeter.filter((text) => text !== ZURUECK),
          [],
        );
      }
    });
  },
);
