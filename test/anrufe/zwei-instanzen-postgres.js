import pg from "pg";

import { startCountingAnthropicMock } from "../_outbound-harness.js";
import { echtWarten } from "../echt-warten.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { pgStartUmgebung } from "../gemeinsam/pg-start-umgebung.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { makeTelnyxSigner, nowSeconds, startServer } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { starteCommitRelais } from "./commit-relais.js";
import { starteDatenbankRelais } from "./datenbank-relais.js";
import { postgresVorhanden } from "./hermes-mit-postgres.js";

export const WEBHOOK_ZUSTELLUNG_SECRET = "webhook-zustellung-testschluessel-mindestens-32-zeichen";
const SQL_FRIST_MS = 5_000;
const SQL_TAKT_MS = 50;
const ANRUF_SEKUNDEN = 600;
const ANRUF_ZIEL = "+4915112345678";
const NIE_SCHEITERN = 0;
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, answered_at, max_duration_s, provider)
  VALUES ($1, $2, $3, 'outbound', 'active', (SELECT e164 FROM number WHERE tenant_id = $2),
  $4, 'Testziel', $5, $5, $6, 'telnyx')`;

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

export function signierteZustellung(signer, { callId, token, felder }) {
  const rumpf = new URLSearchParams(felder).toString();
  const zeitstempel = String(nowSeconds());
  const marke = token === undefined ? "" : `&turnToken=${token}`;
  return {
    pfad: `/voice/turn?callId=${callId}${marke}`,
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

export function signierteRueckfallZustellung(signer, { callId, quelle, felder }) {
  const zustellung = signierteZustellung(signer, { callId, felder });
  return { ...zustellung, pfad: `/voice/el-rueckfall?${new URLSearchParams({ callId, quelle })}` };
}

export async function antwortVon(instanz, zustellung) {
  const res = await abrufMitFrist(`${instanz.localUrl}${zustellung.pfad}`, zustellung.optionen);
  return { status: res.status, contentType: res.headers.get("content-type"), xml: await res.text() };
}

export async function antwortNachWartezeit(instanz, zustellung, wartezeitMs) {
  const res = await abrufMitFrist(`${instanz.localUrl}${zustellung.pfad}`, zustellung.optionen, { wartezeitMs });
  return { status: res.status, contentType: res.headers.get("content-type"), xml: await res.text() };
}

async function seedeAnrufe(sql, ids) {
  const beginn = new Date().toISOString();
  for (const id of ids) {
    await sql(ANRUF_SQL, [id, BOOTSTRAP_TENANT_ID, `tok_${id}`, ANRUF_ZIEL, beginn, ANRUF_SEKUNDEN]);
  }
}

export async function zeilenBis(lies, genug) {
  const ende = Date.now() + SQL_FRIST_MS;
  let zeilen = await lies();
  while (!genug(zeilen) && Date.now() < ende) {
    await echtWarten(SQL_TAKT_MS);
    zeilen = await lies();
  }
  return zeilen;
}

async function starteInstanzen(anzahl, env) {
  const instanzen = [];
  for (let nr = 0; nr < anzahl; nr += 1) instanzen.push(await startServer({ env }));
  return instanzen;
}

async function initialisiereSchema(env) {
  const erste = await startServer({ env });
  await erste.stop();
}

export async function mitInstanzenAufPostgres(t, { anzahl = 2, anrufe = [], env = {} }, lauf) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  const signer = makeTelnyxSigner();
  const modell = await startCountingAnthropicMock({ failFirst: NIE_SCHEITERN });
  const umgebung = pgStartUmgebung(db.adresse, {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    ANTHROPIC_BASE_URL: modell.url,
    WEBHOOK_ZUSTELLUNG_SECRET,
    ...env,
  });
  let instanzen = [];
  try {
    await initialisiereSchema(umgebung);
    await seedeAnrufe(sql, anrufe);
    instanzen = await starteInstanzen(anzahl, umgebung);
    return await lauf({ instanzen, sql, signer, modell });
  } finally {
    await Promise.all(instanzen.map((instanz) => instanz.stop()));
    await modell.close();
    await verwaltung.end();
  }
}

export async function mitDatenbankVorDemStart(t, { anrufe = [], env = {} }, lauf) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  const signer = makeTelnyxSigner();
  const modell = await startCountingAnthropicMock({ failFirst: NIE_SCHEITERN });
  const umgebung = pgStartUmgebung(db.adresse, {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    ANTHROPIC_BASE_URL: modell.url,
    ...env,
  });
  const gestartet = [];
  const starte = async () => {
    const instanz = await startServer({ env: umgebung });
    gestartet.push(instanz);
    return instanz;
  };
  try {
    await initialisiereSchema(umgebung);
    await seedeAnrufe(sql, anrufe);
    return await lauf({ sql, signer, modell, starte });
  } finally {
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
    await modell.close();
    await verwaltung.end();
  }
}

export async function mitInstanzHinterRelais(t, { anrufe = [] }, lauf) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const db = await echteDatenbankMitRolle(t);
  const relais = await starteDatenbankRelais(db.adresse);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const signer = makeTelnyxSigner();
  const modell = await startCountingAnthropicMock({ failFirst: NIE_SCHEITERN });
  const umgebung = pgStartUmgebung(relais.adresse, {
    SKIP_TWILIO_SIGNATURE_CHECK: "false",
    TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
    ANTHROPIC_BASE_URL: modell.url,
    WEBHOOK_ZUSTELLUNG_SECRET,
  });
  const gestartet = [];
  try {
    await initialisiereSchema(umgebung);
    await seedeAnrufe(verwaltung.query.bind(verwaltung), anrufe);
    gestartet.push(await startServer({ env: umgebung }));
    const sql = (text, parameter) => verwaltung.query(text, parameter);
    return await lauf({ a: gestartet[0], sql, signer, relais, rolle: db.rolle });
  } finally {
    relais.fortsetzen();
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
    await relais.schliessen();
    await modell.close();
    await verwaltung.end();
  }
}

export async function mitZweiInstanzenUndCommitRelais(t, { anrufe = [], relaisBei, env = {} }, lauf) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const db = await echteDatenbankMitRolle(t);
  const relais = await starteCommitRelais(db.adresse);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const signer = makeTelnyxSigner();
  const modell = await startCountingAnthropicMock({ failFirst: NIE_SCHEITERN });
  const umgebungFuer = (adresse) =>
    pgStartUmgebung(adresse, {
      SKIP_TWILIO_SIGNATURE_CHECK: "false",
      TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
      ANTHROPIC_BASE_URL: modell.url,
      WEBHOOK_ZUSTELLUNG_SECRET,
      ...env,
    });
  const gestartet = [];
  try {
    await initialisiereSchema(umgebungFuer(db.adresse));
    await seedeAnrufe(verwaltung.query.bind(verwaltung), anrufe);
    for (const name of ["a", "b"]) {
      const adresse = name === relaisBei ? relais.adresse : db.adresse;
      gestartet.push(await startServer({ env: umgebungFuer(adresse) }));
    }
    const sql = (text, parameter) => verwaltung.query(text, parameter);
    return await lauf({ a: gestartet[0], b: gestartet[1], sql, signer, relais, modell });
  } finally {
    relais.fortsetzen();
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
    await relais.schliessen();
    await modell.close();
    await verwaltung.end();
  }
}
