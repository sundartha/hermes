import { test } from "node:test";
import assert from "node:assert/strict";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { seedCall, seedState, startServer, startTelnyxProvisioningMock, waitForStoreState, waitUntil } from "../helpers.js";
import { CONV_ID, isoVor, starteAnbieterAttrappe } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const OUTBOUND_EL = KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI;
const FRIST_MS = 15000;
const WARTE = { timeoutMs: FRIST_MS, pollIntervalMs: 20 };
const LANGER_TAKT_MS = 60000;
const MAX_DAUER_S = 3600;
const FRISCH_S = 5;
const ENDE_VOR_S = 120;
const FENSTER_MS = 3600000;
const UNERREICHBAR = 100;
const EINMAL = 1;
const ZWEIMAL = 2;
const NIE = 0;
const MELDUNG_TITEL = "Anruf nicht zustande gekommen";
const AUSFALL_CODE = "outbound-el:uebergabe";
const ALARM_AUDIT = new RegExp(`\\[audit\\] outage_alert[^\\n]*\\nklasse=${AUSFALL_CODE}`, "g");
const SCHWELLEN_ENV = Object.freeze({
  OUTAGE_ALERT_WINDOW_MS: String(FENSTER_MS),
  OUTAGE_ALERT_MIN_FAILURES: "3",
  OUTAGE_ALERT_MIN_ATTEMPTS: String(UNERREICHBAR),
  OUTAGE_ALERT_FAIL_SHARE_PERCENT: "100",
  OUTAGE_ALERT_DEBOUNCE_MS: "0",
  OUTAGE_ALERT_RETRY_MS: "0",
});

const ausgehend = (id, extra = {}) =>
  seedCall({ id, provider: "telnyx", twilioSid: `v3:${id}`, maxDurationS: MAX_DAUER_S, costProfile: OUTBOUND_EL, diagnostic: true, ...extra });
const abgehoben = (id, extra = {}) => {
  const answeredAt = isoVor(FRISCH_S);
  return ausgehend(id, { answeredAt, startedAt: answeredAt, ...extra });
};
const beendet = (id, extra = {}) => {
  const endedAt = isoVor(ENDE_VOR_S);
  return abgehoben(id, { endedAt, billedAt: endedAt, ...extra });
};
const frueherGescheitert = (id) => beendet(id, { status: "failed", elFallbackAt: isoVor(ENDE_VOR_S), failureReason: "el_uebergabe_gescheitert" });
const frueherGebunden = (id) => beendet(id, { status: "completed", elevenlabsConversationId: CONV_ID });
const offenerMarker = () => ({ id: "otg_3322", code: AUSFALL_CODE, firstSeenAt: isoVor(ENDE_VOR_S), lastSeenAt: isoVor(ENDE_VOR_S), lastAttemptAt: null, reportedAt: null, deliveredChannels: null, closedAt: null });

async function mitServer({ calls, outageAlerts = [], env = {} }, run) {
  const el = await starteAnbieterAttrappe();
  const telnyx = await startTelnyxProvisioningMock();
  const telnyxEnv = { TELNYX_API_BASE: telnyx.url, TELNYX_API_KEY: "KEYtest-3322", TELNYX_ACCOUNT_SID: "acct_3322" };
  const srv = await startServer({
    env: { ELEVENLABS_API_BASE: el.url, ELEVENLABS_API_KEY: "test-key", ELEVENLABS_RESULT_POLL_MS: String(LANGER_TAKT_MS), DIAGNOSTIC_RETENTION_DAYS: "7", ...telnyxEnv, ...env },
    seed: { ...seedState({ settings: { allowSummaries: false }, calls }), outageAlerts },
  });
  try {
    await run({ srv });
  } finally {
    await srv.stop();
    await telnyx.close();
    await el.close();
  }
}

const anrufIn = (stand, id) => stand.calls.find((eintrag) => eintrag.id === id);
const meldungenFuer = (stand, id) => stand.notifications.filter((meldung) => meldung.callId === id);
const abgerechnet = (srv, id) => waitForStoreState(srv, (stand) => Boolean(anrufIn(stand, id)?.billedAt), FRIST_MS);
const post = (srv, pfad, felder = {}) =>
  abrufMitFrist(`${srv.localUrl}${pfad}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(felder).toString() });
const postStatus = (srv, id, status) => post(srv, `/voice/status?callId=${id}`, { CallStatus: status });
const postRueckfall = (srv, id) => post(srv, `/voice/el-rueckfall?${new URLSearchParams({ callId: id, quelle: "frist" })}`);
const alarmeAmAudit = (srv) => srv.stdout.match(ALARM_AUDIT) ?? [];

async function scheiternLassen(srv, id) {
  await postRueckfall(srv, id);
  await postStatus(srv, id, "completed");
  return abgerechnet(srv, id);
}

test("3322-AK1: gescheiterte Uebergabe eines abgehobenen ausgehenden EL-Auftrags -> genau 1 Meldung, auch nach zweitem completed", async () => {
  const id = "call_3322_ak1";
  await mitServer({ calls: [abgehoben(id)] }, async ({ srv }) => {
    const stand = await scheiternLassen(srv, id);
    await waitForStoreState(srv, (s) => meldungenFuer(s, id).length > 0, FRIST_MS);
    assert.equal(anrufIn(stand, id).status, "failed");
    const meldungen = meldungenFuer(srv.readStore(), id);
    assert.equal(meldungen.length, EINMAL);
    assert.equal(meldungen[0].title, MELDUNG_TITEL);

    await postStatus(srv, id, "completed");
    await waitUntil(() => srv.stdout.split("[voice/status]").length > ZWEIMAL, WARTE);
    assert.equal(meldungenFuer(srv.readStore(), id).length, EINMAL);
  });
});

test("3322-AK2: gehaeufte gescheiterte ausgehende EL-Uebergaben im Fenster -> genau 1 Betreiber-Alarm der Klasse outbound-el:uebergabe", async () => {
  const id = "call_3322_ak2";
  const calls = [frueherGescheitert("call_3322_ak2_a"), frueherGescheitert("call_3322_ak2_b"), abgehoben(id)];
  await mitServer({ calls, outageAlerts: [offenerMarker()], env: SCHWELLEN_ENV }, async ({ srv }) => {
    await scheiternLassen(srv, id);
    await waitUntil(() => alarmeAmAudit(srv).length > NIE, WARTE);
    assert.equal(alarmeAmAudit(srv).length, EINMAL, srv.stdout);
  });
});

test("3322-AK3: im selben Fenster enden ueberwiegend gebundene ausgehende EL-Anrufe -> 0 Alarme der Klasse outbound-el:uebergabe", async () => {
  const id = "call_3322_ak3";
  const gebundene = ["a", "b", "c", "d", "e"].map((suffix) => frueherGebunden(`call_3322_ak3_${suffix}`));
  await mitServer({ calls: [...gebundene, abgehoben(id)], outageAlerts: [offenerMarker()], env: { ...SCHWELLEN_ENV, OUTAGE_ALERT_MIN_FAILURES: "1" } }, async ({ srv }) => {
    await scheiternLassen(srv, id);
    await waitForStoreState(srv, (s) => meldungenFuer(s, id).length > 0, FRIST_MS);
    assert.equal(alarmeAmAudit(srv).length, NIE, srv.stdout);
  });
});
