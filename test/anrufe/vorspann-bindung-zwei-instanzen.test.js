import assert from "node:assert/strict";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { nowSeconds } from "../helpers.js";
import { postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { EL_BEIN, HTTP_OK, ZUSTAND_FEHLT, mitAnbieter, platziereUndHebeAb, zaehleMarke } from "./vorspann-zwei-instanzen-hilfen.js";

const ZEITGRENZE_MS = 120_000;
const BINDUNG_SQL = "SELECT failure_reason, el_fallback_at, status FROM call WHERE id = $1";

function elBeinEreignis(signer, srv, { callId, art: eventType }) {
  const rumpf = JSON.stringify({
    data: { id: `evt-${eventType}-${callId}-el-bindung`, event_type: eventType, payload: { call_control_id: EL_BEIN, status: "ok" } },
  });
  const zeitstempel = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf), "telnyx-timestamp": zeitstempel },
    body: rumpf,
  });
}

test("Legt das EL-Bein vor der Bruecke auf einer Instanz auf, die den Anruf nicht aufgebaut hat, ist der Rueckfall in der Datenbank vermerkt und der Anruf beendet, ohne zustand_fehlt und ohne Fristumleitung", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, async (srv) => {
    const { callId } = await platziereUndHebeAb(srv);
    assert.equal((await elBeinEreignis(srv.signer, srv.b, { callId, art: "call.hangup" })).status, HTTP_OK);
    const zeilen = await zeilenBis(async () => (await srv.sql(BINDUNG_SQL, [callId])).rows, (liste) => liste[0].failure_reason !== null);
    assert.equal(zeilen[0].failure_reason, "el_uebergabe_gescheitert");
    assert.equal(zeilen[0].status, "failed");
    assert.equal(zaehleMarke([srv.a, srv.b], "[el-inbound] frist_abgelaufen"), 0);
    assert.notEqual(zeilen[0].el_fallback_at, null);
    assert.equal(zaehleMarke([srv.a, srv.b], ZUSTAND_FEHLT), 0);
  });
});
