import assert from "node:assert/strict";

import pg from "pg";

import { initBindungsKoerper } from "../_iel-inbound-harness.js";
import { startCountingAnthropicMock } from "../_outbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { POSTGRES_VARIABLE } from "../gemeinsam/echtes-postgres.js";
import { echteDatenbankMitRolle } from "../gemeinsam/test-rolle.js";
import { EL_INBOUND_ACCESS_BOOT_ENV } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { mandantenAbruf, seedeMandant, starteAnAnbieter, starteAttrappeMitGespraechsende } from "./hermes-mit-postgres.js";
import { HTTP_OK, ZIEL } from "./vorspann-zwei-instanzen-hilfen.js";

const AGENT_ID = "agent_pg";
const INIT_TOKEN = EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN;
const ANRUF_SQL = "SELECT stream_token, from_e164 FROM call WHERE id = $1";
const ANRUF_AN_ZIEL_SQL = "SELECT id FROM call WHERE to_e164 = $1";

export async function platziereAuf(instanz, sql, language) {
  const antwort = await abrufMitFrist(`${instanz.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: ZIEL, objective: "Termin am Donnerstag vereinbaren", language }),
  });
  assert.equal(antwort.status, HTTP_OK);
  const { rows } = await sql(ANRUF_AN_ZIEL_SQL, [ZIEL]);
  assert.equal(rows.length, 1);
  return rows[0].id;
}

export async function initAuf(instanz, sql, callId) {
  const { rows } = await sql(ANRUF_SQL, [callId]);
  const antwort = await abrufMitFrist(`${instanz.localUrl}/webhooks/elevenlabs/init`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hermes-init-token": INIT_TOKEN },
    body: JSON.stringify({
      ...initBindungsKoerper({ bindung: rows[0].stream_token, agentId: AGENT_ID, conversationId: `conv_${callId}` }),
      called_number: rows[0].from_e164,
    }),
  });
  assert.equal(antwort.status, HTTP_OK);
  return antwort.json();
}

const NIE_SCHEITERN = 0;
const ENDE_EREIGNIS = "call.hangup";
const MANDANT = Object.freeze({ id: "tenant_kernwege", sub: "sub-kernwege", e164: "+4930555000341" });

function adminAdresse(rollenAdresse) {
  const url = new URL(process.env[POSTGRES_VARIABLE]);
  url.pathname = new URL(rollenAdresse).pathname;
  return url.href;
}

export async function mitZweiInstanzenUndGespraechsende(t, lauf) {
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const anbieter = await starteAttrappeMitGespraechsende();
  const modell = await startCountingAnthropicMock({ failFirst: NIE_SCHEITERN });
  const env = {
    ANTHROPIC_BASE_URL: modell.url,
    ELEVENLABS_INBOUND_TENANT_IDS: [BOOTSTRAP_TENANT_ID, MANDANT.id].join(","),
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    RETENTION_DAYS: "30",
    DIAGNOSTIC_RETENTION_DAYS: "7",
  };
  const gestartet = [];
  const starte = async () => {
    gestartet.push(await starteAnAnbieter(db, anbieter, env));
    return gestartet.at(-1);
  };
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  try {
    await (await starte()).stop();
    await seedeMandant(sql, MANDANT);
    const [a, b] = [await starte(), await starte()];
    const rufeAn = async (instanz) => {
      assert.equal((await mandantenAbruf(instanz, MANDANT.sub).rufeAn(ZIEL)).status, HTTP_OK);
      const { rows } = await sql(ANRUF_AN_ZIEL_SQL, [ZIEL]);
      assert.equal(rows.length, 1);
      return rows[0].id;
    };
    const transkriptVon = async (instanz, callId) => {
      const antwort = await mandantenAbruf(instanz, MANDANT.sub).hole(`/api/calls/${callId}`);
      assert.equal(antwort.status, HTTP_OK);
      return (await antwort.json()).transcript.map((zeile) => zeile.text);
    };
    await lauf({ a, b, sql, rufeAn, transkriptVon, beendeGespraech: anbieter.beendeGespraech });
  } finally {
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
    await anbieter.schliessen();
    await modell.close();
    await verwaltung.end();
  }
}

export async function sendeEnde(instanz, callId) {
  const antwort = await abrufMitFrist(`${instanz.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      data: { id: `evt-ende-${callId}`, event_type: ENDE_EREIGNIS, payload: { call_control_id: `cc_callee_${callId}`, status: "ok" } },
    }),
  });
  assert.equal(antwort.status, HTTP_OK);
}

export function brecheAb(instanz, callId) {
  return mandantenAbruf(instanz, MANDANT.sub).sende(`/api/calls/${callId}/cancel`);
}

export async function mitZweiInstanzenMitKostendecke(t, { tarifCent, deckeCent }, lauf) {
  const db = await echteDatenbankMitRolle(t);
  const verwaltung = new pg.Client({ connectionString: adminAdresse(db.adresse) });
  await verwaltung.connect();
  const anbieter = await starteAttrappeMitGespraechsende();
  const env = {
    ELEVENLABS_INBOUND_TENANT_IDS: [BOOTSTRAP_TENANT_ID, MANDANT.id].join(","),
    ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
    ELEVENLABS_OUTBOUND_VORSPANN: "true",
    DEFAULT_TENANT_BUDGET_CENTS: String(deckeCent),
    VOICE_TARIFF_DOMESTIC_CENTS: String(tarifCent),
    VOICE_TARIFF_DEFAULT_CENTS: String(tarifCent),
  };
  const gestartet = [];
  const sql = (text, parameter) => verwaltung.query(text, parameter);
  try {
    gestartet.push(await starteAnAnbieter(db, anbieter, env));
    await gestartet[0].stop();
    await seedeMandant(sql, MANDANT);
    const [a, b] = [await starteAnAnbieter(db, anbieter, env), await starteAnAnbieter(db, anbieter, env)];
    gestartet.push(a, b);
    const rufeAn = (instanz, to) => mandantenAbruf(instanz, MANDANT.sub).rufeAn(to);
    await lauf({ a, b, sql, rufeAn, anbieter });
  } finally {
    await Promise.all(gestartet.map((instanz) => instanz.stop()));
    await anbieter.schliessen();
    await verwaltung.end();
  }
}
