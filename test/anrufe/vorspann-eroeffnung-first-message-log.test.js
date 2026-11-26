import { test } from "node:test";
import assert from "node:assert/strict";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { EL_CALL_BINDING_SIP_HEADER } from "../../src/elevenlabs/inbound-sip-uri.ts";
import { ELEVENLABS_INIT_PATH, INIT_TOKEN_HEADER } from "../../src/routes/webhooks-elevenlabs-init.ts";
import { EL_INBOUND_ACCESS_BOOT_ENV, seedCall, startServer } from "../helpers.js";
import { elInboundInitSpawnEnv, spawnSeedWartenderElCall } from "../_iel-inbound-harness.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";

const HTTP_OK = 200;
const AGENT_ID = "agent_6125";
const INSTANZ = "inst-6125-fm";
const ABSENDER = "+15005550006";
const ANGERUFENER = "+491737250000";
const FR_ZIEL = "+33612345678";
const ANFANG_LAENGE = 40;
const BINDUNG = "6125".padStart(32, "0");
const CALL_ID = "call_6125_fm";
const ANGENOMMEN_UM = new Date("2026-01-01T10:00:00Z").toISOString();

test("6125-A5: ohne gesagten Vorspann loggt der Init Laenge und maskierten Anfang des first_message-Texts mit Instanz", async () => {
  const inbound = spawnSeedWartenderElCall({ callId: "call_6125_inbound", bindungsToken: "0".repeat(32), answeredVorS: 2 });
  const anruf = seedCall({
    id: CALL_ID,
    direction: "outbound",
    from: ABSENDER,
    to: FR_ZIEL,
    goal: "Tisch 4711 reservieren",
    answeredAt: ANGENOMMEN_UM,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    streamToken: BINDUNG,
  });
  const srv = await startServer({
    env: { ...elInboundInitSpawnEnv(AGENT_ID), RENDER_INSTANCE_ID: INSTANZ },
    seed: { ...inbound, calls: [...inbound.calls, anruf] },
  });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN },
      body: JSON.stringify({ agent_id: AGENT_ID, conversation_id: "conv_6125", called_number: ABSENDER, sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: BINDUNG } }),
    });
    const text = await antwort.text();
    assert.equal(antwort.status, HTTP_OK, text);
    const { agent } = JSON.parse(text).conversation_config_override;
    const eroeffnung = agent.first_message;
    assert.ok(eroeffnung.length > ANFANG_LAENGE);
    const zeile = srv.stdout.split("\n").find((eintrag) => eintrag.includes("[el-vorspann] eroeffnung ") && eintrag.includes(`call=${CALL_ID}`));
    const anfang = JSON.stringify(eroeffnung.replace(/\d/g, "#").slice(0, ANFANG_LAENGE));
    assert.equal(zeile, `[el-vorspann] eroeffnung laenge=${eroeffnung.length} anfang=${anfang} call=${CALL_ID} instanz=${INSTANZ}`);
  } finally {
    await srv.stop();
  }
});

test("6125-A6: ohne gesagten Vorspann und ohne first_message loggt der Init Laenge und maskierten Anfang der Eroeffnungsvariable", async () => {
  const inbound = spawnSeedWartenderElCall({ callId: "call_6125_inbound_dv", bindungsToken: "0".repeat(32), answeredVorS: 2 });
  const anruf = seedCall({
    id: "call_6125_dv",
    direction: "outbound",
    from: ABSENDER,
    to: ANGERUFENER,
    goal: "Tisch 4711 reservieren",
    answeredAt: ANGENOMMEN_UM,
    costProfile: KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI,
    streamToken: BINDUNG,
  });
  const srv = await startServer({
    env: { ...elInboundInitSpawnEnv(AGENT_ID), RENDER_INSTANCE_ID: INSTANZ },
    seed: { ...inbound, calls: [...inbound.calls, anruf] },
  });
  try {
    const antwort = await abrufMitFrist(`${srv.localUrl}${ELEVENLABS_INIT_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", [INIT_TOKEN_HEADER]: EL_INBOUND_ACCESS_BOOT_ENV.ELEVENLABS_INIT_WEBHOOK_TOKEN },
      body: JSON.stringify({ agent_id: AGENT_ID, conversation_id: "conv_6125_dv", called_number: ABSENDER, sip_headers: { [EL_CALL_BINDING_SIP_HEADER]: BINDUNG } }),
    });
    const text = await antwort.text();
    assert.equal(antwort.status, HTTP_OK, text);
    const koerper = JSON.parse(text);
    assert.equal(koerper.conversation_config_override.agent.first_message, undefined);
    const eroeffnung = koerper.dynamic_variables.eroeffnung;
    assert.ok(eroeffnung.length > ANFANG_LAENGE);
    const zeile = srv.stdout.split("\n").find((eintrag) => eintrag.includes("[el-vorspann] eroeffnung ") && eintrag.includes("call=call_6125_dv"));
    const anfang = JSON.stringify(eroeffnung.replace(/\d/g, "#").slice(0, ANFANG_LAENGE));
    assert.equal(zeile, `[el-vorspann] eroeffnung laenge=${eroeffnung.length} anfang=${anfang} call=call_6125_dv instanz=${INSTANZ}`);
  } finally {
    await srv.stop();
  }
});
