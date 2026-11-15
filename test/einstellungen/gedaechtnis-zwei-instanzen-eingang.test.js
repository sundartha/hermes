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
import { logBis } from "../gemeinsam/log-bis.mjs";
import { makeTelnyxSigner } from "../helpers.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const NACHLADE_FEHLER = "[pg] einstellungen nachladen fehlgeschlagen";
const MEMORY_HEADING = "WAS BISHER GESCHAH";
const ZIELE_AUSGANGSLAGE = ["+491511234101", "+491511234102", "+491511234103", "+491511234104"];
const ZIEL_Y = "+491511234002";
const ZIEL_Z = "+491511234003";
const ALLE_ZIELE = [...ZIELE_AUSGANGSLAGE, ZIEL_Y, ZIEL_Z];
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
        for (const ziel of ALLE_ZIELE) {
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
  const out = await abrufMitFrist(
    `${instanz.localUrl}/voice/outbound?callId=${callId}`,
    uebergabe.optionen,
  );
  assert.equal(out.status, HTTP_OK);
  const runde = signierteZustellung(signer, {
    callId,
    felder: { SpeechResult: `Hallo, hier ist ${callId}` },
  });
  const turn = await abrufMitFrist(`${instanz.localUrl}${runde.pfad}`, runde.optionen);
  return turn.status;
}

async function erstesGespraechsRunde(b, signer, ziel) {
  const res = await rufeAn(b, ziel);
  assert.equal(res.status, HTTP_OK);
  const { callId } = await res.json();
  assert.equal(await ersteRunde(b, signer, callId), HTTP_OK);
  return callId;
}

function rundenAnfrage(modell, callId) {
  const anfrage = modell.bodies.find((body) =>
    JSON.stringify(body.messages).includes(`Hallo, hier ist ${callId}`),
  );
  assert.ok(anfrage, `keine Modellanfrage zur Runde von ${callId}`);
  return JSON.stringify(anfrage.system);
}

const logVon = (instanz) => instanz.stdout + (instanz.stderr ?? "");

const traegtGedaechtnis = (anfrage, ziel) =>
  anfrage.includes(MEMORY_HEADING) || anfrage.includes(ERGEBNIS(ziel));

async function ausgangslage({ b, signer, modell, sql }) {
  for (const ziel of ZIELE_AUSGANGSLAGE) {
    const callId = await erstesGespraechsRunde(b, signer, ziel);
    const system = rundenAnfrage(modell, callId);
    if (system.includes(MEMORY_HEADING) && system.includes(ERGEBNIS(ziel))) return { ziel, system };
    await sql(`DELETE FROM leitungsplatz WHERE call_id = $1`, [callId]);
  }
  return assert.fail(
    `Gedaechtnis in allen Versuchen nicht in der ersten Runde: ${ZIELE_AUSGANGSLAGE.length}`,
  );
}

async function gedaechtnisWarAnUndWirdAus(rahmen) {
  const { system, ziel } = await ausgangslage(rahmen);
  assert.ok(system.includes(ERGEBNIS(ziel)), "Ausgangslage: Gedaechtnis ist an");
  await setzeGedaechtnis(rahmen.sql, false);
  return { modellVorher: rahmen.modell.bodies.length, telnyxVorher: rahmen.telnyx.starts.length };
}

test("Kriterium 1 (Eingang): ein Anruf ueber POST /api/calls traegt in der ersten Runde das Anrufgedaechtnis, wenn die Einstellung an ist", async (t) => {
  await mitInstanzen(t, async (rahmen) => {
    const { system, ziel } = await ausgangslage(rahmen);

    assert.ok(system.includes(MEMORY_HEADING));
    assert.ok(system.includes(ERGEBNIS(ziel)));
  });
});

test("Kriterium 2 (Eingang): nach allowCallMemory=false auf A bekommt ein Anruf ueber die veraltete Instanz B kein Anrufgedaechtnis", async (t) => {
  await mitInstanzen(t, async (rahmen) => {
    const { b, signer, modell } = rahmen;
    const { modellVorher } = await gedaechtnisWarAnUndWirdAus(rahmen);

    const callId = await erstesGespraechsRunde(b, signer, ZIEL_Y);

    const runde = rundenAnfrage(modell, callId);
    assert.ok(!traegtGedaechtnis(runde, ZIEL_Y));
    for (const body of modell.bodies.slice(modellVorher)) {
      assert.ok(!traegtGedaechtnis(JSON.stringify(body.system), ZIEL_Y));
    }
  });
});

test("Kriterium 3 (Eingang): haengt die Datenbank nach allowCallMemory=false, lehnt B den Anruf ab und das Gedaechtnis des Ziels erreicht das Modell nicht", async (t) => {
  await mitInstanzen(t, async (rahmen) => {
    const { db, sql, telnyx, modell, b } = rahmen;
    const { modellVorher, telnyxVorher } = await gedaechtnisWarAnUndWirdAus(rahmen);

    await sperreDatenbank(sql, db);
    let res;
    try {
      res = await rufeAn(b, ZIEL_Z);
    } finally {
      await gibDatenbankFrei(db);
    }

    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.equal((await res.json()).reason, "frozen");
    assert.equal(telnyx.starts.length, telnyxVorher, "kein neuer Anrufstart beim Anbieter");
    for (const body of modell.bodies.slice(modellVorher)) {
      assert.ok(!traegtGedaechtnis(JSON.stringify(body.system), ZIEL_Z));
    }
  });
});

test("Kriterium 4 (Eingang): haengt nur das Lesen der Einstellungen auf B, startet der Anruf nicht oder die Runde traegt kein Anrufgedaechtnis", async (t) => {
  await mitInstanzen(t, async (rahmen) => {
    const { sql, telnyx, modell, b } = rahmen;
    const { modellVorher, telnyxVorher } = await gedaechtnisWarAnUndWirdAus(rahmen);
    const logVorher = logVon(b).length;

    await sql("BEGIN");
    let res;
    try {
      await sql("LOCK TABLE settings IN ACCESS EXCLUSIVE MODE");
      res = await rufeAn(b, ZIEL_Z);
    } finally {
      await sql("ROLLBACK");
    }

    await logBis(b, NACHLADE_FEHLER, { ab: logVorher });
    if (res.status === HTTP_OK) {
      const { callId } = await res.json();
      assert.equal(await ersteRunde(b, rahmen.signer, callId), HTTP_OK);
      assert.ok(!traegtGedaechtnis(rundenAnfrage(modell, callId), ZIEL_Z));
    } else {
      assert.notEqual(res.status, HTTP_FORBIDDEN);
      assert.equal(telnyx.starts.length, telnyxVorher, "kein neuer Anrufstart beim Anbieter");
    }
    for (const body of modell.bodies.slice(modellVorher)) {
      assert.ok(!traegtGedaechtnis(JSON.stringify(body.system), ZIEL_Z));
    }
  });
});

test("Kriterium 5 (Eingang): Versuche ohne Anrufgedaechtnis halten keinen Leitungsplatz, die Ausgangslage scheitert mit klarer Meldung statt 429", async (t) => {
  await mitInstanzen(t, async (rahmen) => {
    await rahmen.sql(`DELETE FROM call WHERE to_e164 = ANY($1)`, [ZIELE_AUSGANGSLAGE]);

    const frisch = await rahmen.starte();

    await assert.rejects(
      ausgangslage({ ...rahmen, b: frisch }),
      /Gedaechtnis in allen Versuchen nicht in der ersten Runde: 4/,
    );
  });
});
