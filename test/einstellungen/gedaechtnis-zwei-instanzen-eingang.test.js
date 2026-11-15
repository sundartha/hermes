import assert from "node:assert/strict";
import test from "node:test";

import { startRecordingAnthropicMock } from "../_outbound-harness.js";
import { starteAttrappe } from "../anrufe/attrappen-server.js";
import {
  gibDatenbankFrei,
  mitZweiHermesAufPostgres,
  postgresVorhanden,
  sperreDatenbank,
} from "../anrufe/hermes-mit-postgres.js";
import { signierteZustellung } from "../anrufe/zwei-instanzen-postgres.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { TELNYX_EIGENE_NUMMER_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { makeTelnyxSigner } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const NACHLADE_VERSUCHE = 3;
const MEMORY_HEADING = "WAS BISHER GESCHAH";
const ZIEL_X = "+491511234001";
const ZIEL_Y = "+491511234002";
const ZIEL_Z = "+491511234003";
const ERGEBNIS = (ziel) => `Ergebnis-des-frueheren-Anrufs-an-${ziel}`;
const FRUEHER_MS = 2 * 24 * 60 * 60 * 1000;
const FRUEHERER_ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, max_duration_s, provider, result)
  VALUES ($1, $2, $3, 'outbound', 'ended', (SELECT e164 FROM number WHERE tenant_id = $2),
  $4, 'frueherer Auftrag', $5, 60, 'telnyx', $6)`;

function telnyxAttrappe() {
  const starts = [];
  return starteAttrappe((req, res) => {
    req.resume();
    req.on("end", () => {
      starts.push(req.url);
      res.writeHead(HTTP_OK, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: { sid: `CAgedaechtnis${starts.length}` } }));
    });
  }).then((server) => ({ ...server, starts }));
}

async function mitInstanzen(t, lauf) {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const signer = makeTelnyxSigner();
  const modell = await startRecordingAnthropicMock();
  const telnyx = await telnyxAttrappe();
  try {
    await mitZweiHermesAufPostgres(
      t,
      {
        env: {
          ELEVENLABS_OUTBOUND_ENABLED: "false",
          ANTHROPIC_BASE_URL: modell.url,
          TELNYX_API_BASE: telnyx.url,
          TELNYX_API_KEY: TELNYX_EIGENE_NUMMER_SCHLUESSEL,
          TELNYX_CONNECTION_ID: "conn_gedaechtnis",
          SKIP_TWILIO_SIGNATURE_CHECK: "false",
          TELNYX_PUBLIC_KEY: signer.publicKeyBase64,
        },
      },
      async (rahmen) => {
        const frueherer = new Date(Date.now() - FRUEHER_MS).toISOString();
        for (const ziel of [ZIEL_X, ZIEL_Y, ZIEL_Z]) {
          await rahmen.sql(FRUEHERER_ANRUF_SQL, [
            `call_frueher_${ziel}`,
            BOOTSTRAP_TENANT_ID,
            `tok_${ziel}`,
            ziel,
            frueherer,
            JSON.stringify({ outcome: ERGEBNIS(ziel), facts: [] }),
          ]);
        }
        assert.equal((await setzeGedaechtnis(rahmen.sql, true)).rowCount, 1);
        const b = await rahmen.starte();
        return await lauf({ ...rahmen, b, signer, modell, telnyx });
      },
    );
  } finally {
    await telnyx.close();
    await modell.close();
  }
}

const setzeGedaechtnis = (sql, an) =>
  sql(`UPDATE settings SET allow_call_memory = $2 WHERE tenant_id = $1`, [BOOTSTRAP_TENANT_ID, an]);

const rufeAn = (instanz, ziel) =>
  abrufMitFrist(`${instanz.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: ziel, objective: `Auftrag an ${ziel}` }),
  });

async function ersteRunde(instanz, signer, callId) {
  const uebergabe = signierteZustellung(signer, { callId, felder: { CallSid: "CAgedaechtnis" } });
  const out = await abrufMitFrist(`${instanz.localUrl}/voice/outbound?callId=${callId}`, uebergabe.optionen);
  assert.equal(out.status, HTTP_OK);
  const runde = signierteZustellung(signer, { callId, felder: { SpeechResult: `Hallo, hier ist ${callId}` } });
  const turn = await abrufMitFrist(`${instanz.localUrl}${runde.pfad}`, runde.optionen);
  return turn.status;
}

async function erstesGespraechsRunde(b, signer, ziel) {
  const res = await rufeAn(b, ziel);
  assert.equal(res.status, HTTP_OK);
  const { callId } = await res.json();
  assert.equal(await ersteRunde(b, signer, callId), HTTP_OK);
}

const systemText = (modell, nr) => JSON.stringify(modell.bodies.at(nr).system);

async function rundeMitGedaechtnis({ b, signer, modell }, ziel) {
  for (let versuch = 1; versuch < NACHLADE_VERSUCHE; versuch++) {
    await erstesGespraechsRunde(b, signer, ziel);
    if (systemText(modell, -1).includes(MEMORY_HEADING)) return;
  }
  await erstesGespraechsRunde(b, signer, ziel);
}

async function gedaechtnisWarAnUndWirdAus(rahmen) {
  await rundeMitGedaechtnis(rahmen, ZIEL_X);
  assert.ok(systemText(rahmen.modell, -1).includes(MEMORY_HEADING), "Ausgangslage: Gedaechtnis ist an");
  await setzeGedaechtnis(rahmen.sql, false);
  return rahmen.modell.bodies.length;
}

test("Kriterium 1 (Eingang): ein Anruf ueber POST /api/calls traegt in der ersten Runde das Anrufgedaechtnis, wenn die Einstellung an ist", async (t) => {
  await mitInstanzen(t, async (rahmen) => {
    await rundeMitGedaechtnis(rahmen, ZIEL_X);

    assert.ok(systemText(rahmen.modell, -1).includes(MEMORY_HEADING));
    assert.ok(systemText(rahmen.modell, -1).includes(ERGEBNIS(ZIEL_X)));
  });
});

test("Kriterium 2 (Eingang): nach allowCallMemory=false auf A bekommt ein Anruf ueber die veraltete Instanz B kein Anrufgedaechtnis", async (t) => {
  await mitInstanzen(t, async (rahmen) => {
    const { b, signer, modell } = rahmen;
    const vorher = await gedaechtnisWarAnUndWirdAus(rahmen);

    await erstesGespraechsRunde(b, signer, ZIEL_Y);

    assert.equal(modell.bodies.length, vorher + 1);
    assert.ok(!systemText(modell, vorher).includes(MEMORY_HEADING));
    assert.ok(!systemText(modell, vorher).includes(ERGEBNIS(ZIEL_Y)));
  });
});

test("Kriterium 3 (Eingang): haengt die Datenbank nach allowCallMemory=false, lehnt B den Anruf ab und das Gedaechtnis des Ziels erreicht das Modell nicht", async (t) => {
  await mitInstanzen(t, async (rahmen) => {
    const { db, sql, telnyx, modell, b } = rahmen;
    const vorher = await gedaechtnisWarAnUndWirdAus(rahmen);

    await sperreDatenbank(sql, db);
    let res;
    try {
      res = await rufeAn(b, ZIEL_Z);
    } finally {
      await gibDatenbankFrei(db);
    }

    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.equal((await res.json()).reason, "frozen");
    assert.equal(telnyx.starts.length, vorher, "kein neuer Anrufstart beim Anbieter");
    assert.equal(modell.bodies.length, vorher, "keine neue Modellanfrage");
  });
});
