import { test } from "node:test";
import assert from "node:assert/strict";
import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { seedCall, seedState, startServer, waitForStoreState } from "../helpers.js";
import { CONV_ID, isoVor } from "../_iel-inbound-harness.js";
import { PLATFORM_ALERT_SMS_TO_BEISPIEL } from "./erfundene-geheimnisse.js";

const AUSFALL_CODE = "outbound-el:uebergabe";
const SWEEP_TAKT_MS = 61_000;
const KURZER_TAKT_MS = 50;
const NACHLAUF_TAKTE = 50;
const TAKT_ZEILE = "test-takt-beendet";
const TAG_MS = 86_400_000;
const FRIST_MS = 15_000;
const WARTEFRIST = { timeout: 30_000 };
const MARKER_SEIT_S = 600;
const ANRUF_ENDE_VOR_S = 120;
const ANRUF_ANZAHL = 3;
const EINMAL = 1;
const NIE = 0;
const ENTWARNUNG = `[outage] outage_recovered klasse=${AUSFALL_CODE} fehler=0`;
const ALARM_KONSOLE = `outage_alert klasse=${AUSFALL_CODE}`;
const ALARM_AUDIT = new RegExp(`\\[audit\\] outage_alert[^\\n]*\\nklasse=${AUSFALL_CODE}`);

const taktVerkuerzen = [
  "const takt = Number(process.env.COST_TRUING_SWEEP_INTERVAL_MS);",
  "const echt = globalThis.setInterval;",
  `const melden = (fn) => () => new Promise((fertig) => fertig(fn())).catch(() => {}).finally(() => console.log("${TAKT_ZEILE}"));`,
  `globalThis.setInterval = (fn, ms, ...rest) => (ms === takt ? echt(melden(fn), ${KURZER_TAKT_MS}, ...rest) : echt(fn, ms, ...rest));`,
].join("\n");
const SERVER_ENV = Object.freeze({
  COST_TRUING_SWEEP_INTERVAL_MS: String(SWEEP_TAKT_MS),
  OUTAGE_ALERT_SELF_TEST_INTERVAL_MS: String(TAG_MS),
  OUTAGE_ALERT_WINDOW_MS: String(TAG_MS),
  PLATFORM_ALERT_SMS_TO: PLATFORM_ALERT_SMS_TO_BEISPIEL,
  PAID_WITHOUT_NUMBER_GRACE_MS: String(TAG_MS),
  PROVISIONING_RETRY_MIN_INTERVAL_MS: String(TAG_MS),
  NODE_OPTIONS: `--import=data:text/javascript,${encodeURIComponent(taktVerkuerzen)}`,
});

function gebundenerAusgehenderElAnruf(id) {
  const endedAt = isoVor(ANRUF_ENDE_VOR_S);
  return seedCall({
    id,
    provider: "telnyx",
    twilioSid: `v3:${id}`,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    status: "completed",
    answeredAt: isoVor(ANRUF_ENDE_VOR_S + 1),
    endedAt,
    billedAt: endedAt,
    elevenlabsConversationId: CONV_ID,
    elFallbackAt: null,
    failureReason: null,
  });
}

function offenerMarker() {
  const seit = isoVor(MARKER_SEIT_S);
  return {
    id: "otg_3329",
    code: AUSFALL_CODE,
    firstSeenAt: seit,
    lastSeenAt: seit,
    lastAttemptAt: null,
    reportedAt: null,
    deliveredChannels: null,
    closedAt: null,
  };
}

const markerIn = (stand) => stand.outageAlerts.find((eintrag) => eintrag.code === AUSFALL_CODE);
function warteAufTakte(srv, anzahl) {
  const gezaehlt = () => zeilenMit(srv.stdout, TAKT_ZEILE).length;
  const ziel = gezaehlt() + anzahl;
  const frist = AbortSignal.timeout(FRIST_MS);
  return new Promise((erfuellt, gescheitert) => {
    const pruefe = () => {
      if (gezaehlt() < ziel) return;
      srv.child.stdout.off("data", pruefe);
      erfuellt();
    };
    frist.addEventListener(
      "abort",
      () => {
        srv.child.stdout.off("data", pruefe);
        gescheitert(new Error(`Sweep-Takte blieben aus:\n${srv.stdout}`));
      },
      { once: true },
    );
    srv.child.stdout.on("data", pruefe);
    pruefe();
  });
}
const zeilenMit = (text, teil) => text.split("\n").filter((zeile) => zeile.includes(teil));

test(
  "3329-AK1: offener outbound-el-Marker + nur gebundene EL-Anrufe im Fenster -> der Sweep-Takt schliesst ihn mit genau einer Entwarnung und ohne Alarm",
  WARTEFRIST,
  async () => {
    const calls = Array.from({ length: ANRUF_ANZAHL }, (_, i) => gebundenerAusgehenderElAnruf(`call_3329_${i}`));
    const srv = await startServer({
      env: SERVER_ENV,
      seed: { ...seedState({ calls }), outageAlerts: [offenerMarker()] },
    });
    try {
      await waitForStoreState(srv, (stand) => markerIn(stand)?.closedAt != null, FRIST_MS);
      await warteAufTakte(srv, NACHLAUF_TAKTE);
      assert.equal(zeilenMit(srv.stdout, ENTWARNUNG).length, EINMAL, srv.stdout);
      assert.notEqual(markerIn(srv.readStore()).closedAt, null);
      assert.equal(zeilenMit(srv.stdout, ALARM_KONSOLE).length, NIE, srv.stdout);
      assert.doesNotMatch(srv.stdout, ALARM_AUDIT);
    } finally {
      await srv.stop();
    }
  },
);
