import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";

import { mitHermesAufPostgres, neueAnrufe, postgresVorhanden, rufeAnMit, zeilenBis } from "./hermes-mit-postgres.js";
import { makeTelnyxSigner, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const HTTP_OK = 200;
const EL_PLAETZE = 4;
const GEHEIMNIS = "kappung-werkzeug-geheimnis";
const KENNUNG = "kappung";
const KONVERSATION = "conv_kappung";
const KONVERSATION_PFAD = `/v1/convai/conversations/${KONVERSATION}`;
const MAX_DAUER_S = 2;
const PLATZ_SQL = `INSERT INTO leitungsplatz (call_id, anbieter, tenant_id, ablauf_um)
  VALUES ($1, 'elevenlabs', $2, now() + interval '1 hour')`;
const ANRUF_SQL = "SELECT to_e164, tenant_id FROM call WHERE id = $1";
const MARKER_SQL = "INSERT INTO anrufstart_marker (call_id, tenant_id, versucht_at) VALUES ($1, $2, now())";
const STATUS_SQL = "SELECT status, failure_reason, elevenlabs_conversation_id AS id FROM call WHERE id = $1";

const mandantenToken = (tenantId) => createHmac("sha256", GEHEIMNIS).update(`v1:${tenantId}`).digest("hex");

async function starteKonto(gespraech) {
  const anfragen = [];
  const server = createServer((req, res) => {
    anfragen.push({ methode: req.method, url: req.url });
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    if (req.method === "DELETE") return res.end("{}");
    if (req.url.includes("?")) return res.end(JSON.stringify({ conversations: [{ conversation_id: KONVERSATION }], has_more: false }));
    res.end(JSON.stringify(gespraech()));
  });
  await new Promise((fertig) => server.listen(0, "127.0.0.1", fertig));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    anfragen,
    close: () => new Promise((fertig) => server.close(fertig)),
  };
}

test("Abgleich-Anruf: nach der Uebernahme beendet der echte Fristen-Takt ihn mit max-duration-cap und der Anbieter bekommt das DELETE auf genau seine Konversation", async (t) => {
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
    ELEVENLABS_RESULT_POLL_MS: "100",
    FRISTEN_TAKT_MS: "40",
  };
  await mitHermesAufPostgres(t, { env }, async ({ srv, sql }) => {
    for (let index = 0; index < EL_PLAETZE; index += 1) await sql(PLATZ_SQL, [`voll_${index}`, `t_voll_${index}`]);
    const antwort = await rufeAnMit(srv, { to: neueAnrufe().ziel(), max_duration_s: MAX_DAUER_S });
    assert.equal(antwort.status, HTTP_OK);
    const { callId } = await antwort.json();
    const [{ to_e164: ziel, tenant_id: mandant }] = (await sql(ANRUF_SQL, [callId])).rows;
    gespraech = {
      conversation_initiation_client_data: { dynamic_variables: { callee: ziel, tenant_token: mandantenToken(mandant) } },
    };
    await sql(MARKER_SQL, [callId, mandant]);
    await sql("DELETE FROM leitungsplatz");
    const [ende] = await zeilenBis(
      async () => (await sql(STATUS_SQL, [callId])).rows,
      (zeilen) => zeilen[0]?.status === "completed" || zeilen[0]?.status === "failed",
    );
    assert.equal(ende.status, "completed");
    assert.equal(ende.failure_reason, "max-duration-cap");
    assert.equal(ende.id, KONVERSATION);
    assert.equal(attrappe.pfade.filter((pfad) => pfad === "/v2/calls").length, 0);
    await zeilenBis(
      async () => konto.anfragen.filter((anfrage) => anfrage.methode === "DELETE"),
      (loeschungen) => loeschungen.length >= 1,
    );
    const loeschungen = konto.anfragen.filter((anfrage) => anfrage.methode === "DELETE");
    assert.deepEqual(loeschungen[0], { methode: "DELETE", url: KONVERSATION_PFAD });
  });
});
