import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";

import { mitHermesAufPostgres, neueAnrufe, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { makeTelnyxSigner, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const HTTP_OK = 200;
const EL_PLAETZE = 4;
const GEHEIMNIS = "abfrage-frist-werkzeug-geheimnis";
const KENNUNG = "abfragefrist";
const KONVERSATION = "conv_abfrage_frist";
const POLL_MS = 50000;
const TOLERANZ_MS = 20000;
const PLATZ_SQL = `INSERT INTO leitungsplatz (call_id, anbieter, tenant_id, ablauf_um)
  VALUES ($1, 'elevenlabs', $2, now() + interval '1 hour')`;
const ANRUF_SQL = "SELECT to_e164, tenant_id FROM call WHERE id = $1";
const MARKER_SQL = "INSERT INTO anrufstart_marker (call_id, tenant_id, versucht_at) VALUES ($1, $2, $3)";
const FRIST_SQL = "SELECT frist_abfrage_at, status FROM call WHERE id = $1";
const PLAETZE_LEEREN_SQL = "DELETE FROM leitungsplatz";

const mandantenToken = (tenantId) => createHmac("sha256", GEHEIMNIS).update(`v1:${tenantId}`).digest("hex");

async function starteKonto(gespraech) {
  const server = createServer((req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    if (req.url.includes("?")) return res.end(JSON.stringify({ conversations: [{ conversation_id: KONVERSATION }], has_more: false }));
    res.end(JSON.stringify(gespraech()));
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((fertig) => server.close(fertig)) };
}

test("Abfrage-Frist: ein nach dem Abgleich abgehobener ausgehender Anruf traegt die Frist schon vor dem ersten Abfrage-Takt", async (t) => {
  if (!postgresVorhanden()) return t.skip("kein Postgres");
  let gespraech = null;
  const konto = await starteKonto(() => gespraech);
  t.after(() => konto.close());
  const attrappe = await starteAttrappe();
  t.after(() => attrappe.close());
  const env = {
    ...vorspannUmgebung({ attrappe, signer: makeTelnyxSigner(), publicUrl: "https://agent.test", kennung: KENNUNG }),
    ELEVENLABS_API_BASE: konto.url,
    ELEVENLABS_TOOL_TOKEN: GEHEIMNIS,
    ELEVENLABS_RESULT_POLL_MS: String(POLL_MS),
  };
  await mitHermesAufPostgres(t, { env }, async ({ srv, sql }) => {
    for (let index = 0; index < EL_PLAETZE; index += 1) await sql(PLATZ_SQL, [`voll_${index}`, `t_voll_${index}`]);
    const antwort = await neueAnrufe().rufeAn(srv);
    assert.equal(antwort.status, HTTP_OK);
    const { callId } = await antwort.json();
    const [{ to_e164: ziel, tenant_id: mandant }] = (await sql(ANRUF_SQL, [callId])).rows;
    gespraech = {
      conversation_initiation_client_data: { dynamic_variables: { callee: ziel, tenant_token: mandantenToken(mandant) } },
    };
    const vorher = Date.now();
    await sql(MARKER_SQL, [callId, mandant, new Date(vorher).toISOString()]);
    await sql(PLAETZE_LEEREN_SQL);
    const [zeile] = await zeilenBis(
      async () => (await sql(FRIST_SQL, [callId])).rows,
      (zeilen) => zeilen[0]?.frist_abfrage_at,
    );
    assert.equal(zeile.status, "active");
    const erwartet = vorher + POLL_MS;
    assert.ok(Math.abs(zeile.frist_abfrage_at.getTime() - erwartet) < TOLERANZ_MS, String(zeile.frist_abfrage_at));
  });
});
