import { test } from "node:test";
import assert from "node:assert/strict";
import { startServerExpectExit } from "./helpers.js";
import { gather } from "../src/telephony/directives.js";

const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-secret-do-not-leak";
process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;

const { renderDirectives: renderTelnyx } = await import("../src/telephony/adapters/telnyx/render.js");
const { STT_PROFILE } = await import("../src/telephony/stt-profile.js");

function gatherDE(extra = {}) {
  return gather({ promptText: "", action: "/voice/turn?callId=c1", ...extra });
}

test("A: unbekannte STT-Wahl -> der Renderer wirft (fail-closed)", async () => {
  assert.throws(
    () => renderTelnyx([gatherDE()], { sttProfile: "nicht-existent" }),
    /unbekanntes sttProfile/,
  );
});

test("B (Fangnetz, gruen): EIN Profil loest im TeXML-Gather auf", async () => {
  const profile = STT_PROFILE.ACCURATE;

  const telnyxOut = renderTelnyx([gatherDE()], { sttProfile: profile });
  assert.match(
    telnyxOut,
    /<Gather\b[^>]*\btranscriptionEngine="Deepgram"[^>]*\bmodel="deepgram\/nova-3"/,
  );
});

test("C (Fangnetz, gruen): jedes Enum-Mitglied loest im TeXML-Gather auf", async () => {
  for (const profile of Object.values(STT_PROFILE)) {
    const telnyxOut = renderTelnyx([gatherDE()], { sttProfile: profile });
    assert.ok(telnyxOut.length > 0);
  }
});

test("D (Fangnetz, gruen): Gather sendet volles BCP-47 'de-DE'", async () => {
  const telnyxOut = renderTelnyx([gatherDE()], { sttProfile: STT_PROFILE.ACCURATE });
  assert.match(telnyxOut, /<Gather\b[^>]*\blanguage="de-DE"/);
  assert.doesNotMatch(telnyxOut, /language="de"[ />]/);
});

test("E: ungueltiges STT_PROFILE -> Boot verweigert (exit 1), nennt die Variable", async () => {
  const { code, output } = await startServerExpectExit({ env: { STT_PROFILE: "nova3" } });
  assert.equal(code, 1);
  assert.match(output, /\[boot\] Start abgebrochen/);
  assert.match(output, /STT_PROFILE/);
  assert.doesNotMatch(output, /Gateway laeuft/);
});
