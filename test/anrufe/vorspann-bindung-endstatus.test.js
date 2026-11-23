import assert from "node:assert/strict";
import test from "node:test";

import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { nowSeconds } from "../helpers.js";
import { postgresVorhanden, zeilenBis } from "./hermes-mit-postgres.js";
import { EL_BEIN, HTTP_OK, ZUSTAND_FEHLT, mitAnbieter, platziereUndHebeAb, zaehleMarke } from "./vorspann-zwei-instanzen-hilfen.js";

const ZEITGRENZE_MS = 120_000;
const BINDUNG_SQL = "SELECT failure_reason, el_fallback_at, status FROM call WHERE id = $1";

function aufgelegt(signer, srv, callId) {
  const rumpf = JSON.stringify({
    data: { id: `evt-call.hangup-${callId}-el-endstatus`, event_type: "call.hangup", payload: { call_control_id: EL_BEIN, status: "ok" } },
  });
  const zeitstempel = String(nowSeconds());
  return abrufMitFrist(`${srv.localUrl}/voice/vorspann?callId=${callId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "telnyx-signature-ed25519": signer.sign(zeitstempel, rumpf), "telnyx-timestamp": zeitstempel },
    body: rumpf,
  });
}

test("Legt das EL-Bein vor der Bruecke auf der nicht aufbauenden Instanz auf, stehen Grund und Endstatus zusammen in der Datenbank, ohne zustand_fehlt und ohne Fristumleitung", { timeout: ZEITGRENZE_MS }, async (t) => {
  if (!postgresVorhanden()) return;
  await mitAnbieter(t, async (srv) => {
    const { callId } = await platziereUndHebeAb(srv);
    assert.equal((await aufgelegt(srv.signer, srv.b, callId)).status, HTTP_OK);
    const zeilen = await zeilenBis(
      async () => (await srv.sql(BINDUNG_SQL, [callId])).rows,
      (liste) => liste[0].failure_reason !== null && liste[0].status !== "active",
    );
    assert.equal(zeilen[0].failure_reason, "el_uebergabe_gescheitert");
    assert.equal(zeilen[0].status, "failed");
    assert.notEqual(zeilen[0].el_fallback_at, null);
    assert.equal(zaehleMarke([srv.a, srv.b], "[el-inbound] frist_abgelaufen"), 0);
    assert.equal(zaehleMarke([srv.a, srv.b], ZUSTAND_FEHLT), 0);
  });
});
