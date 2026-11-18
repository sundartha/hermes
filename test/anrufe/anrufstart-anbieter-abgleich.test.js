import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { test } from "node:test";

import { mitHermesAufPostgres, neueAnrufe, postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { makeTelnyxSigner, starteAttrappe, vorspannUmgebung } from "./el-bein-attrappe.js";

const HTTP_OK = 200;
const EL_PLAETZE = 4;
const GEHEIMNIS = "abgleich-werkzeug-geheimnis";
const KENNUNG = "abgleich";
const KONTO_SCHLUESSEL = `test-key-${KENNUNG}`;
const KONVERSATION = "conv_abgleich";
const MS_JE_SEKUNDE = 1000;
const VORLAUF_S = 60;
const ABFRAGE_SEITE = "50";
const PLATZ_SQL = `INSERT INTO leitungsplatz (call_id, anbieter, tenant_id, ablauf_um)
  VALUES ($1, 'elevenlabs', $2, now() + interval '1 hour')`;
const ANRUF_SQL = "SELECT to_e164, tenant_id FROM call WHERE id = $1";
const MARKER_SQL = "INSERT INTO anrufstart_marker (call_id, tenant_id, versucht_at) VALUES ($1, $2, $3)";
const MARKER_ZEIT_SQL = "SELECT versucht_at FROM anrufstart_marker WHERE call_id = $1";
const ANTWORT_SQL = "SELECT answered_at FROM call WHERE id = $1";
const POLL_MS = "100";
const KONVERSATION_SQL = "SELECT elevenlabs_conversation_id AS id FROM call WHERE id = $1";
const PLAETZE_LEEREN_SQL = "DELETE FROM leitungsplatz";

const mandantenToken = (tenantId) => createHmac("sha256", GEHEIMNIS).update(`v1:${tenantId}`).digest("hex");

async function starteKonto(gespraech) {
  const anfragen = [];
  const server = createServer((req, res) => {
    anfragen.push({ url: req.url, schluessel: req.headers["xi-api-key"] });
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
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

test("Anrufstart-Abgleich: ein wartender Anruf mit gesetztem Marker fragt den Anbieter mit Konto und Abfrage und haelt das Gespraech seines Mandanten fest, ohne zu waehlen", async (t) => {
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
    ELEVENLABS_RESULT_POLL_MS: POLL_MS,
    FRISTEN_TAKT_MS: "40",
  };
  await mitHermesAufPostgres(t, { env }, async ({ srv, sql }) => {
    for (let index = 0; index < EL_PLAETZE; index += 1) await sql(PLATZ_SQL, [`voll_${index}`, `t_voll_${index}`]);
    const antwort = await neueAnrufe().rufeAn(srv);
    assert.equal(antwort.status, HTTP_OK);
    const { callId } = await antwort.json();
    const { rows } = await sql(ANRUF_SQL, [callId]);
    const [{ to_e164: ziel, tenant_id: mandant }] = rows;
    gespraech = {
      conversation_initiation_client_data: { dynamic_variables: { callee: ziel, tenant_token: mandantenToken(mandant) } },
    };
    const versucht = new Date();
    await sql(MARKER_SQL, [callId, mandant, versucht.toISOString()]);
    await sql(PLAETZE_LEEREN_SQL);
    const [festgehalten] = await zeilenBis(
      async () => (await sql(KONVERSATION_SQL, [callId])).rows,
      (zeilen) => zeilen[0]?.id,
    );
    assert.equal(festgehalten.id, KONVERSATION);
    const [{ versucht_at: gespeichert }] = (await sql(MARKER_ZEIT_SQL, [callId])).rows;
    const seitS = Math.floor(gespeichert.getTime() / MS_JE_SEKUNDE) - VORLAUF_S;
    const abgleich = konto.anfragen.filter((anfrage) => anfrage.url.startsWith("/v1/convai/conversations"));
    assert.deepEqual(abgleich[0], {
      url: `/v1/convai/conversations?call_start_after_unix=${seitS}&page_size=${ABFRAGE_SEITE}`,
      schluessel: KONTO_SCHLUESSEL,
    });
    assert.deepEqual(abgleich[1], { url: `/v1/convai/conversations/${KONVERSATION}`, schluessel: KONTO_SCHLUESSEL });
    assert.equal(attrappe.pfade.filter((pfad) => pfad === "/v2/calls").length, 0);
    assert.ok((await sql(ANTWORT_SQL, [callId])).rows[0].answered_at);
    await zeilenBis(
      async () => konto.anfragen.filter((anfrage) => anfrage.url === `/v1/convai/conversations/${KONVERSATION}`),
      (abrufe) => abrufe.length >= 2,
    );
  });
});

const UNKLAR_GRUND = "result-unknown:start-unclear";
const STATUS_SQL = "SELECT status, failure_reason, ended_at FROM call WHERE id = $1";
const MARKER_ALT_MS = 30 * 60 * MS_JE_SEKUNDE;

test("Anrufstart-Abgleich: findet der Anbieter nach der Abgleichfrist kein Gespraech dieses Anrufs, endet der Anruf als unklar gestartet und die Plaetze sind frei", async (t) => {
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
  };
  await mitHermesAufPostgres(t, { env }, async ({ srv, sql }) => {
    for (let index = 0; index < EL_PLAETZE; index += 1) await sql(PLATZ_SQL, [`voll_${index}`, `t_voll_${index}`]);
    const antwort = await neueAnrufe().rufeAn(srv);
    assert.equal(antwort.status, HTTP_OK);
    const { callId } = await antwort.json();
    const [{ tenant_id: mandant }] = (await sql(ANRUF_SQL, [callId])).rows;
    gespraech = {
      conversation_initiation_client_data: { dynamic_variables: { callee: "+49000000000", tenant_token: mandantenToken(mandant) } },
    };
    await sql(MARKER_SQL, [callId, mandant, new Date(Date.now() - MARKER_ALT_MS).toISOString()]);
    await sql(PLAETZE_LEEREN_SQL);
    const [beendet] = await zeilenBis(
      async () => (await sql(STATUS_SQL, [callId])).rows,
      (zeilen) => zeilen[0]?.status === "failed",
    );
    assert.equal(beendet.failure_reason, UNKLAR_GRUND);
    assert.ok(beendet.ended_at);
    assert.equal((await sql(KONVERSATION_SQL, [callId])).rows[0].id, null);
    assert.equal(attrappe.pfade.filter((pfad) => pfad === "/v2/calls").length, 0);
    const plaetze = (await sql("SELECT call_id FROM leitungsplatz WHERE call_id = $1", [callId])).rows;
    assert.deepEqual(plaetze, []);
  });
});
