// ---- IEX-A4: Freizeichen statt Stille (answerOnBridge) --------------------------------------
// Die Uebergabe an den EL-Agenten traegt <Dial answerOnBridge="true"> als ERSTES Verb: der Anrufer
// hoert bis zur SIP-Annahme sein Netz-Freizeichen. Das Literal steht hier, nicht aus der Konstante
// abgeleitet (sonst bestuende ein Flip seinen eigenen Test). IEX-A4b dreht genau diesen Test.
// Namen beginnen mit "IEX-A4-<n>: " - trifft weder i18nCatalogPattern noch abnahmePattern.
import { test } from "node:test";
import assert from "node:assert/strict";
import { elUebergabeDirektiven } from "../src/elevenlabs/inbound-rueckfall.js";
import { renderDirectives } from "../src/telephony/adapters/telnyx/render.js";

const XML_PRAEFIX = `<?xml version="1.0" encoding="UTF-8"?><Response>`;
const DID = "+4930123456789";
const BINDUNGS_TOKEN = "0123456789abcdef0123456789abcdef";
const TEST_MAX_DAUER_S = 900;
const SPRECH_VERBEN = Object.freeze(["<Say", "<Play", "<Gather"]);
const EINMAL = 1;

function uebergabeXml() {
  return renderDirectives(elUebergabeDirektiven({
    call: { id: "call_a4", to: DID, streamToken: BINDUNGS_TOKEN, maxDurationS: TEST_MAX_DAUER_S },
    zugang: { username: "hermes-sip", password: "pw-geheim" },
    publicUrl: "https://agent.test",
  }));
}

test("IEX-A4-1: Uebergabe - Dial mit answerOnBridge ist das erste Verb, kein Sprech-Verb", () => {
  const xml = uebergabeXml();
  assert.ok(xml.startsWith(`${XML_PRAEFIX}<Dial answerOnBridge="true" callerId=`), xml);
  for (const verb of SPRECH_VERBEN) assert.ok(!xml.includes(verb), verb);
  assert.ok(xml.indexOf("</Dial>") < xml.indexOf("<Redirect"), "Redirect folgt dem Dial");
});

test("IEX-A4-2: answerOnBridge sitzt genau einmal am Dial, nie am Sip", () => {
  const xml = uebergabeXml();
  assert.equal(xml.split("answerOnBridge=").length - 1, EINMAL);
  assert.ok(!/<Sip[^>]*answerOnBridge/.test(xml));
});
