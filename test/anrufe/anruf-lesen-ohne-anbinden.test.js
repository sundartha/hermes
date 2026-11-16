import assert from "node:assert/strict";
import { test } from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { nowSeconds } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";
import { mitInstanzenAufPostgres, zeilenBis } from "./zwei-instanzen-postgres.js";

const HTTP_OK = 200;
const HTTP_NOT_FOUND = 404;
const HTTP_SERVER_ERROR = 500;
const FREMDER_MANDANT = "t_lesen_fremd";
const FERNER_ANRUF = "call_lesen_a";
const FREMDER_ANRUF = "call_lesen_fremd";
const UEBERFAELLIGER_ANRUF = "call_lesen_alt";
const LANG_VERGANGEN = "2020-01-01T00:00:00.000Z";
const KURZE_HOECHSTDAUER_S = 60;
const ZIEL = "+4915112345678";
const ABSENDER = "+4930555000300";
const MANDANT_SQL = "INSERT INTO tenant (id, status, idp_subject) VALUES ($1, 'active', $1)";
const ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, answered_at, max_duration_s, provider)
  VALUES ($1, $2, $3, 'outbound', $4, $5, $6, $7, $8, $8, $9, 'telnyx')`;
const SEGMENT_SQL =
  "INSERT INTO transcript_segment (call_id, tenant_id, role, text, at) VALUES ($1, $2, $3, $4, now()::text)";
const STATUS_SQL = "SELECT status FROM call WHERE id = $1";
const SCHLUESSEL_UMBENENNEN_SQL = "ALTER TABLE anruf_schluessel RENAME TO anruf_schluessel_weg";
const SCHLUESSEL_ZURUECK_SQL = "ALTER TABLE anruf_schluessel_weg RENAME TO anruf_schluessel";

async function legeAnruf(sql, { id, tenantId, status, goal, startedAt }) {
  await sql(ANRUF_SQL, [id, tenantId, `tok_${id}`, status, ABSENDER, ZIEL, goal, startedAt, KURZE_HOECHSTDAUER_S]);
}

const lies = (instanz, id) => abrufMitFrist(`${instanz.localUrl}/api/calls/${id}`);

function signierterStatus(signer, callId) {
  const rumpf = new URLSearchParams({ CallStatus: "ringing", CallSid: `CA_${callId}` }).toString();
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

test("GET /api/calls/:id auf Instanz B zeigt einen von Instanz A angelegten Anruf samt Transkript", async (t) => {
  await mitInstanzenAufPostgres(t, {}, async ({ instanzen: [, b], sql }) => {
    await legeAnruf(sql, {
      id: FERNER_ANRUF,
      tenantId: BOOTSTRAP_TENANT_ID,
      status: "completed",
      goal: "Termin beim Zahnarzt",
      startedAt: new Date().toISOString(),
    });
    await sql(SEGMENT_SQL, [FERNER_ANRUF, BOOTSTRAP_TENANT_ID, "agent", "Guten Tag, hier ist der Assistent"]);
    const antwort = await lies(b, FERNER_ANRUF);
    assert.equal(antwort.status, HTTP_OK);
    const anruf = await antwort.json();
    assert.equal(anruf.id, FERNER_ANRUF);
    assert.equal(anruf.status, "completed");
    assert.equal(anruf.transcript[0].text, "Guten Tag, hier ist der Assistent");
  });
});

test("GET /api/calls/:id auf Instanz B antwortet 404 ohne Inhalt, wenn der Anruf einem anderen Mandanten gehoert", async (t) => {
  await mitInstanzenAufPostgres(t, {}, async ({ instanzen: [, b], sql }) => {
    await sql(MANDANT_SQL, [FREMDER_MANDANT]);
    await legeAnruf(sql, {
      id: FREMDER_ANRUF,
      tenantId: FREMDER_MANDANT,
      status: "completed",
      goal: "Geheimes Ziel des Fremden",
      startedAt: new Date().toISOString(),
    });
    const antwort = await lies(b, FREMDER_ANRUF);
    assert.equal(antwort.status, HTTP_NOT_FOUND);
    assert.deepEqual(await antwort.json(), { error: "not found" });
  });
});

test("GET /api/calls/:id meldet einen Lesefehler der Datenbank als Fehler und nicht als nicht gefunden", async (t) => {
  await mitInstanzenAufPostgres(t, {}, async ({ instanzen: [, b], sql }) => {
    await legeAnruf(sql, {
      id: FERNER_ANRUF,
      tenantId: BOOTSTRAP_TENANT_ID,
      status: "completed",
      goal: "Termin beim Zahnarzt",
      startedAt: new Date().toISOString(),
    });
    await sql(SCHLUESSEL_UMBENENNEN_SQL);
    try {
      const antwort = await lies(b, FERNER_ANRUF);
      assert.equal(antwort.status, HTTP_SERVER_ERROR);
      assert.ok(b.stdout.includes("[pg] leseCall fehlgeschlagen:"), b.stdout);
    } finally {
      await sql(SCHLUESSEL_ZURUECK_SQL);
    }
    assert.equal((await lies(b, FERNER_ANRUF)).status, HTTP_OK);
  });
});

test("Ein Lesen auf Instanz B bindet den Anruf dort nicht: der folgende Statusruf stellt die Hoechstdauer-Frist und beendet ihn", async (t) => {
  await mitInstanzenAufPostgres(t, {}, async ({ instanzen: [, b], sql, signer }) => {
    await legeAnruf(sql, {
      id: UEBERFAELLIGER_ANRUF,
      tenantId: BOOTSTRAP_TENANT_ID,
      status: "active",
      goal: "Termin beim Zahnarzt",
      startedAt: LANG_VERGANGEN,
    });
    const gelesen = await lies(b, UEBERFAELLIGER_ANRUF);
    assert.equal(gelesen.status, HTTP_OK);
    assert.equal((await gelesen.json()).status, "active");
    const zustellung = signierterStatus(signer, UEBERFAELLIGER_ANRUF);
    const antwort = await abrufMitFrist(`${b.localUrl}${zustellung.pfad}`, zustellung.optionen);
    assert.equal(antwort.status, HTTP_OK);
    const status = await zeilenBis(
      async () => (await sql(STATUS_SQL, [UEBERFAELLIGER_ANRUF])).rows[0].status,
      (wert) => wert !== "active",
    );
    assert.equal(status, "failed");
  });
});
