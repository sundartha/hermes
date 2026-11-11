import { test } from "node:test";
import assert from "node:assert/strict";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { seedCall, seedState, startServer, startTelnyxProvisioningMock, waitForStoreState, waitUntil } from "../helpers.js";
import { isoVor, starteAnbieterAttrappe } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const OUTBOUND_EL = KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI;
const INBOUND_EL = KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI;
const FRIST_MS = 15000;
const WARTE = { timeoutMs: FRIST_MS, pollIntervalMs: 20 };
const LANGER_TAKT_MS = 60000;
const MAX_DAUER_S = 3600;
const FRISCH_S = 5;
const ENDE_VOR_S = 120;
const FENSTER_MS = 3600000;
const EINGEHENDE_RUECKFAELLE = 3;
const SIP_VERBOTEN = "403";
const NIE = 0;
const UEBERGABE_EIMER = "outbound-el:uebergabe";
const NOT_PLACED_EIMER = "not-placed:invite-403";
const NOT_PLACED_GRUND = "not-placed:invite-403-D51";
const ZEILE_UEBERGABE = `[outage] outage_detected klasse=${UEBERGABE_EIMER} fehler=1 versuche=1`;
const ZEILE_NOT_PLACED = `[outage] outage_detected klasse=${NOT_PLACED_EIMER} fehler=1 versuche=1`;
const KLASSE_UEBERGABE = `klasse=${UEBERGABE_EIMER}`;

const MELDEZEILE = "[outage] outage_detected";
const zeilenMit = (text, teil) => text.split("\n").filter((zeile) => zeile.includes(teil));
const meldezeilen = (text) => text.split("\n").filter((zeile) => zeile.startsWith(MELDEZEILE));
const beendetSeit = () => {
  const endedAt = isoVor(ENDE_VOR_S);
  return { endedAt, billedAt: endedAt };
};

const eingehenderRueckfall = (id) =>
  seedCall({
    id,
    direction: "inbound",
    provider: "telnyx",
    twilioSid: `v3:${id}`,
    maxDurationS: MAX_DAUER_S,
    costProfile: INBOUND_EL,
    status: "failed",
    answeredAt: isoVor(ENDE_VOR_S),
    startedAt: isoVor(ENDE_VOR_S),
    elFallbackAt: isoVor(ENDE_VOR_S),
    failureReason: "el_uebergabe_gescheitert",
    ...beendetSeit(),
  });
const ausgehenderElAnruf = (id, extra = {}) =>
  seedCall({ id, provider: "telnyx", twilioSid: `v3:${id}`, maxDurationS: MAX_DAUER_S, costProfile: OUTBOUND_EL, ...extra });
const abgehobenerElAuftrag = (id) => {
  const answeredAt = isoVor(FRISCH_S);
  return ausgehenderElAnruf(id, { answeredAt, startedAt: answeredAt });
};
const nichtAbgehobenerElAnruf = (id, extra = {}) => ausgehenderElAnruf(id, extra);
const frueherNichtZustandeGekommen = (id) =>
  nichtAbgehobenerElAnruf(id, { status: "failed", failureReason: NOT_PLACED_GRUND, ...beendetSeit() });

async function mitServer({ calls }, run) {
  const el = await starteAnbieterAttrappe();
  const telnyx = await startTelnyxProvisioningMock();
  const srv = await startServer({
    env: {
      ELEVENLABS_API_BASE: el.url,
      ELEVENLABS_API_KEY: "test-key",
      ELEVENLABS_RESULT_POLL_MS: String(LANGER_TAKT_MS),
      OUTAGE_ALERT_WINDOW_MS: String(FENSTER_MS),
      TELNYX_API_BASE: telnyx.url,
      TELNYX_API_KEY: "KEYtest-3330",
      TELNYX_ACCOUNT_SID: "acct_3330",
    },
    seed: { ...seedState({ settings: { allowSummaries: false }, calls }), outageAlerts: [] },
  });
  try {
    await run({ srv });
  } finally {
    await srv.stop();
    await telnyx.close();
    await el.close();
  }
}

const post = (srv, pfad, felder = {}) =>
  abrufMitFrist(`${srv.localUrl}${pfad}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(felder).toString() });
const postRueckfall = (srv, id) => post(srv, `/voice/el-rueckfall?${new URLSearchParams({ callId: id, quelle: "frist" })}`);
const markerCodes = (srv) => srv.readStore().outageAlerts.map((marker) => marker.code);
const abwarten = (bedingung) => bedingung().catch(() => undefined);
const meldungErschienen = (srv) => abwarten(() => waitUntil(() => meldezeilen(srv.stdout).length > NIE, WARTE));
const markerAngelegt = (srv) => abwarten(() => waitForStoreState(srv, (stand) => stand.outageAlerts.length > NIE, FRIST_MS));

test("3330-AK1: eingehende EL-Rueckfaelle und ein nicht zustande gekommener ausgehender EL-Anruf im Fenster zaehlen nicht zur Klasse outbound-el:uebergabe", async () => {
  const id = "call_3330_ak1";
  const eingehende = Array.from({ length: EINGEHENDE_RUECKFAELLE }, (_, i) => eingehenderRueckfall(`call_3330_ak1_in${i}`));
  const calls = [...eingehende, frueherNichtZustandeGekommen("call_3330_ak1_np"), abgehobenerElAuftrag(id)];
  await mitServer({ calls }, async ({ srv }) => {
    await postRueckfall(srv, id);
    await post(srv, `/voice/status?callId=${id}`, { CallStatus: "completed" });
    await meldungErschienen(srv);
    await markerAngelegt(srv);
    assert.deepEqual(meldezeilen(srv.stdout), [ZEILE_UEBERGABE], srv.stdout);
    assert.deepEqual(markerCodes(srv), [UEBERGABE_EIMER]);
  });
});

test("3330-AK2: ein nicht abgehobener ausgehender EL-Anruf endet im Eimer der not-placed-Klasse, nicht in outbound-el:uebergabe", async () => {
  const id = "call_3330_ak2";
  await mitServer({ calls: [nichtAbgehobenerElAnruf(id)] }, async ({ srv }) => {
    await post(srv, `/voice/status?callId=${id}`, { CallStatus: "failed", SipHangupCause: SIP_VERBOTEN });
    await meldungErschienen(srv);
    await markerAngelegt(srv);
    assert.deepEqual(meldezeilen(srv.stdout), [ZEILE_NOT_PLACED], srv.stdout);
    assert.equal(zeilenMit(srv.stdout, KLASSE_UEBERGABE).length, NIE, srv.stdout);
    assert.deepEqual(markerCodes(srv), [NOT_PLACED_EIMER]);
  });
});
