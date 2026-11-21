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
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { TELNYX_EIGENE_NUMMER_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { BOOTSTRAP_TENANT_ID } from "../pg-helpers.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const MEMORY_HEADING = "WAS BISHER GESCHAH";
const ZIEL = "+491511234003";
const ERGEBNIS = `Ergebnis-des-frueheren-Anrufs-an-${ZIEL}`;
const FRUEHER_MS = 2 * 24 * 60 * 60 * 1000;
const FRUEHERER_ANRUF_SQL = `INSERT INTO call (id, tenant_id, stream_token, direction, status, from_e164,
  to_e164, goal, started_at, answered_at, max_duration_s, provider, result)
  VALUES ($1, $2, $3, 'outbound', 'completed', (SELECT e164 FROM number WHERE tenant_id = $2),
  $4, 'frueherer Auftrag', $5, $5, 60, 'telnyx', $6)`;

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

const setzeGedaechtnis = (sql, an) =>
  sql(`UPDATE settings SET allow_call_memory = $2 WHERE tenant_id = $1`, [BOOTSTRAP_TENANT_ID, an]);

const rufeAn = (instanz) =>
  abrufMitFrist(`${instanz.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ to: ZIEL, objective: `Auftrag an ${ZIEL}` }),
  });

const traegtGedaechtnis = (system) => system.includes(MEMORY_HEADING) || system.includes(ERGEBNIS);

test("Kriterium 1 (Eingang): haengt die Datenbank nach allowCallMemory=false, lehnt B den Anruf mit frozen ab und das Gedaechtnis des Ziels erreicht das Modell nicht", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  const modell = await startRecordingAnthropicMock();
  const telnyx = await telnyxAttrappe();
  try {
    const env = {
      ELEVENLABS_OUTBOUND_ENABLED: "false",
      ANTHROPIC_BASE_URL: modell.url,
      TELNYX_API_BASE: telnyx.url,
      TELNYX_API_KEY: TELNYX_EIGENE_NUMMER_SCHLUESSEL,
      TELNYX_CONNECTION_ID: "conn_gedaechtnis",
    };
    await mitZweiHermesAufPostgres(t, { env }, async ({ db, sql, starte }) => {
      const frueherer = new Date(Date.now() - FRUEHER_MS).toISOString();
      await sql(FRUEHERER_ANRUF_SQL, [
        "call_frueher_sperre",
        BOOTSTRAP_TENANT_ID,
        "tok_frueher_sperre",
        ZIEL,
        frueherer,
        JSON.stringify({ outcome: ERGEBNIS, facts: [] }),
      ]);
      assert.equal((await setzeGedaechtnis(sql, true)).rowCount, 1);
      const veraltet = await starte();
      assert.equal((await setzeGedaechtnis(sql, false)).rowCount, 1);
      const modellVorher = modell.bodies.length;
      const telnyxVorher = telnyx.starts.length;

      await sperreDatenbank(sql, db);
      let res;
      try {
        res = await rufeAn(veraltet);
      } finally {
        await gibDatenbankFrei(db);
      }

      assert.equal(res.status, HTTP_FORBIDDEN);
      assert.equal((await res.json()).reason, "frozen");
      assert.equal(telnyx.starts.length, telnyxVorher, "kein neuer Anrufstart beim Anbieter");
      for (const body of modell.bodies.slice(modellVorher)) {
        assert.ok(!traegtGedaechtnis(JSON.stringify(body.system)));
      }
    });
  } finally {
    await telnyx.close();
    await modell.close();
  }
});
