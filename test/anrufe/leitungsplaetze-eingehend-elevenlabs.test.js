import assert from "node:assert/strict";
import test from "node:test";

import { EL_INBOUND_ACCESS_BOOT_ENV, seedState, startServer, waitForStoreState, EL_OUTBOUND_BOOT_ENV } from "../helpers.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";

const HTTP_OK = 200;
const KUNDE = "t_el_ein";
const ABSENDER = "+12025552100";
const EL_PLAETZE = 6;
const AUFTRAG = "Tisch fuer zwei reservieren (ElevenLabs eingehend)";
const anruferVon = (nummer) => `+1202555${String(7100 + nummer).padStart(4, "0")}`;
const zielVon = (nummer) => `+1202555${String(5100 + nummer).padStart(4, "0")}`;

const seed = () =>
  seedState({
    tenants: [{ id: KUNDE, status: "active", kycLevel: "card", ownerName: "Eve Example", country: "US", defaultLanguage: "en" }],
    numbers: [
      {
        id: "num_el_ein",
        e164: ABSENDER,
        tenantId: KUNDE,
        provider: "telnyx",
        status: "active",
        providerNumberId: null,
        providerAgentPhoneNumberId: "phnum_el_ein",
        language: "en",
      },
    ],
    profiles: { [KUNDE]: { maxCallsPerHour: 100 } },
  });

const rufeAusgehendAn = async (srv, nummer) =>
  abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": KUNDE },
    body: JSON.stringify({ to: zielVon(nummer), objective: AUFTRAG }),
  });

const nimmEingehendAn = (srv, nummer) =>
  abrufMitFrist(`${srv.localUrl}/voice/incoming`, {
    method: "POST",
    body: new URLSearchParams({ CallSid: `CAelein${nummer}`, From: anruferVon(nummer), To: ABSENDER }),
  });

test("Eingehend ElevenLabs: sechs ueber /voice/incoming angenommene ElevenLabs-Anrufe fuellen die ElevenLabs-Plaetze, der naechste ausgehende ElevenLabs-Anruf wartet mit dialing", async () => {
  const srv = await startServer({
    env: {
      ...EL_INBOUND_ACCESS_BOOT_ENV,
      ...EL_OUTBOUND_BOOT_ENV,
      ...vorspannMandantenUmgebung([KUNDE]),
      ELEVENLABS_INBOUND_ENABLED: "true",
      ELEVENLABS_AGENT_ID: "agent_el_ein",
      ELEVENLABS_API_KEY: "el-ein-schluessel",
    },
    seed: seed(),
  });
  try {
    assert.equal((await rufeAusgehendAn(srv, 0)).status, HTTP_OK);
    for (let nummer = 1; nummer <= EL_PLAETZE; nummer += 1) assert.equal((await nimmEingehendAn(srv, nummer)).status, HTTP_OK);
    const stand = await waitForStoreState(srv, (s) => s.calls.filter((call) => call.direction === "inbound").length >= EL_PLAETZE);
    assert.ok(stand.calls.filter((call) => call.direction === "inbound").every((call) => call.costProfile === "telnyx_inbound_el_convai"));
    const wartend = await rufeAusgehendAn(srv, 1);
    assert.equal(wartend.status, HTTP_OK);
    const koerper = await wartend.json();
    assert.equal(koerper.status, "dialing");
    assert.equal(koerper.deduplicated, false);
    const warteAnruf = srv.readStore().calls.find((call) => call.id === koerper.callId);
    assert.equal(warteAnruf.status, "active");
    assert.equal(warteAnruf.callControlId, null);
  } finally {
    await srv.stop();
  }
});
