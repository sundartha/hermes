import { test } from "node:test";
import assert from "node:assert/strict";
import { captureConsole } from "./helpers.js";

const API_BASE = "https://telnyx.test";
const CALLEE_BEIN = "cc_callee_1";
const EL_BEIN = "cc_el_1";
const HTTP_OK = 200;
const HTTP_UNPROCESSABLE = 422;
process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = "KEYtest-3365";

const { voiceControl } = await import("../src/telephony/registry.js");

const telnyxVoice = voiceControl("telnyx");

function stubFetch(status) {
  const aufrufe = [];
  global.fetch = async (url, optionen) => {
    aufrufe.push({ url, optionen, koerper: JSON.parse(optionen.body) });
    return { ok: status < 300, status, json: async () => ({}), text: async () => "{}" };
  };
  return aufrufe;
}

test("3365-H3a: bridge verbindet das Bein des Angerufenen mit dem ElevenLabs-Bein und loggt unter seinem Vorgang", async () => {
  const aufrufe = stubFetch(HTTP_OK);
  const zeilen = await captureConsole(() => telnyxVoice.bridge(CALLEE_BEIN, { zielId: EL_BEIN }));
  assert.equal(aufrufe.length, 1);
  assert.equal(aufrufe[0].url, `${API_BASE}/v2/calls/${CALLEE_BEIN}/actions/bridge`);
  assert.equal(aufrufe[0].optionen.method, "POST");
  assert.deepEqual(aufrufe[0].koerper, { call_control_id: EL_BEIN });
  assert.deepEqual(zeilen, ["[telnyx/voice] bridge ok status=200 ccid=true"]);
});

test("3365-H3a: bridge scheitert mit Vorgangsnamen und Status", async () => {
  stubFetch(HTTP_UNPROCESSABLE);
  await assert.rejects(telnyxVoice.bridge(CALLEE_BEIN, { zielId: EL_BEIN }), /^Error: Telnyx bridge fehlgeschlagen: HTTP 422$/);
});
