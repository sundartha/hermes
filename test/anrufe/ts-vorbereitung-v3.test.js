import assert from "node:assert/strict";
import { test } from "node:test";

import { KOSTENPROFIL } from "../../src/billing/kostenarten.ts";
import { budgetedMemoryLines, memoryLine } from "../../src/call-memory.ts";
import { findeB1Treffer } from "../../src/elevenlabs/b1-doppelankaendigung.ts";
import {
  BRIDGE_STATE,
  bridgeStateOf,
  inboundAbgewiesen,
  istOutboundElProfil,
  uebergabeGescheitert,
} from "../../src/elevenlabs/inbound-bridge-state.ts";
import { medienwegAus, medienwegZeilen } from "../../src/elevenlabs/medienweg.ts";
import { lookupFactsFrom, sanitizeLookupQuery } from "../../src/research/lookup-guard.ts";
import {
  callFailureReason,
  failureReasonBase,
  pollProviderErrorReason,
  providerErrorReason,
  reasonWithoutCarrier,
  startRejectionReason,
} from "../../src/telephony/failure-reason.ts";
import { deniedPrefix, isDenied } from "../../src/telephony/number-denylist.ts";

const INBOUND_EL = KOSTENPROFIL.TELNYX_INBOUND_EL_CONVAI;
const OUTBOUND_EL = KOSTENPROFIL.TELNYX_OUTBOUND_EL_CONVAI;

test("3399-v3: Bruecken-Zustand je Anruf, auch ohne Anruf", () => {
  const tabelle = [
    [null, BRIDGE_STATE.KEIN_EL_INBOUND],
    [undefined, BRIDGE_STATE.KEIN_EL_INBOUND],
    [{}, BRIDGE_STATE.KEIN_EL_INBOUND],
    [{ costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET }, BRIDGE_STATE.KEIN_EL_INBOUND],
    [{ costProfile: INBOUND_EL }, BRIDGE_STATE.WARTET],
    [{ costProfile: INBOUND_EL, elevenlabsConversationId: "c1" }, BRIDGE_STATE.GEBUNDEN],
    [{ costProfile: INBOUND_EL, elevenlabsConversationId: "c1", elFallbackAt: "t" }, BRIDGE_STATE.RUECKFALL],
    [{ costProfile: OUTBOUND_EL }, BRIDGE_STATE.KEIN_EL_INBOUND],
    [{ costProfile: OUTBOUND_EL, answeredAt: "t" }, BRIDGE_STATE.WARTET],
    [{ costProfile: OUTBOUND_EL, answeredAt: "t", elevenlabsConversationId: "c1" }, BRIDGE_STATE.GEBUNDEN],
    [{ costProfile: OUTBOUND_EL, answeredAt: "t", elFallbackAt: "t" }, BRIDGE_STATE.RUECKFALL],
  ];
  for (const [anruf, erwartet] of tabelle) assert.equal(bridgeStateOf(anruf), erwartet, JSON.stringify(anruf));
});

test("3399-v3: Uebergabe gescheitert, Inbound abgewiesen und Outbound-Profil je Anruf", () => {
  assert.equal(uebergabeGescheitert(null), false);
  assert.equal(uebergabeGescheitert({ costProfile: INBOUND_EL }), true);
  assert.equal(uebergabeGescheitert({ costProfile: INBOUND_EL, elevenlabsConversationId: "c1" }), false);
  assert.equal(uebergabeGescheitert({ elFallbackAt: "t" }), true);
  assert.equal(inboundAbgewiesen(null), false);
  assert.equal(inboundAbgewiesen({ costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET }), false);
  assert.equal(inboundAbgewiesen({ costProfile: KOSTENPROFIL.TELNYX_INBOUND_BUDGET, elFallbackAt: "t" }), true);
  assert.equal(istOutboundElProfil(null), false);
  assert.equal(istOutboundElProfil({ costProfile: OUTBOUND_EL }), true);
});

test("3399-v3: Fehlergrund-Basis schneidet am ersten Doppelpunkt, auch ueber Zeilenumbrueche", () => {
  const tabelle = [
    [null, null],
    [undefined, null],
    ["", null],
    ["busy", "busy"],
    ["not-placed:invite-403-D12", "not-placed"],
    ["a:b:c", "a"],
    ["a:b\nc", "a"],
    [":x", ""],
  ];
  for (const [grund, erwartet] of tabelle) assert.equal(failureReasonBase(grund), erwartet, String(grund));
  assert.equal(reasonWithoutCarrier("not-placed:invite-403-D12"), "not-placed:invite-403");
  assert.equal(reasonWithoutCarrier(null), null);
});

test("3399-v3: Fehlergrund aus Anbieter-Statuswerten, Zahl und Text gleich behandelt", () => {
  const tabelle = [
    [{ status: "failed", diagnostics: { sipHangupCause: "403" } }, "not-placed:invite-403"],
    [{ status: "failed", diagnostics: { sipHangupCause: 403 } }, "not-placed:invite-403"],
    [{ status: "failed", diagnostics: { sipHangupCause: "403", hangupCause: "channel_limit" } }, "at-capacity:invite-403"],
    [{ status: "failed", diagnostics: { sipHangupCause: "17" } }, "failed:17"],
    [{ status: "failed", diagnostics: { sipHangupCause: 17 } }, "failed:17"],
    [{ status: "failed", diagnostics: { sipHangupCause: "abc" } }, "failed:abc"],
    [{ status: "failed", diagnostics: { sipHangupCause: 403.5 } }, "failed:403.5"],
    [{ status: "failed", diagnostics: { sipHangupCause: "403.5" } }, "not-placed:invite-403"],
    [{ status: "failed", diagnostics: { sipHangupCause: null } }, "failed"],
    [{ status: "failed" }, "failed"],
  ];
  for (const [eingabe, erwartet] of tabelle) assert.equal(callFailureReason(eingabe), erwartet, JSON.stringify(eingabe));
  assert.equal(startRejectionReason("502"), "result-unknown:start-502");
  assert.equal(startRejectionReason(null), "result-unknown:start-no-status");
  assert.equal(pollProviderErrorReason("503"), "result-unknown:poll-provider-503");
  assert.equal(pollProviderErrorReason(null), "result-unknown:poll-provider");
  assert.equal(providerErrorReason({ reason: "SIP Status: 404", code: 400 }), "unreachable:invite-404");
  assert.equal(providerErrorReason({ reason: "x", code: "429" }), "result-unknown:provider-429");
  assert.equal(providerErrorReason({ reason: "x" }), "result-unknown:provider");
});

test("3399-v3: Doppelankuendigung nur bei Cue-Paar mit gemeinsamen Woertern, auch am Zeilenende", () => {
  const agent = (message) => ({ role: "agent", message });
  const zeilen = [
    null,
    { role: "agent", message: "" },
    { role: "agent" },
    { role: "agent", message: null },
    { role: "user", message: "Gut, ein Gedicht. Klar, ein Gedicht." },
    agent("Gut."),
    agent("Gut, ein kurzes Gedicht.[ruhig]Klar, ein kurzes Gedicht."),
    agent("Hallo Welt. Gut, hier ein kurzes Gedicht. Klar, hier ein kurzes Gedicht."),
  ];
  assert.deepEqual(findeB1Treffer(zeilen), [
    { zeile: 6, cues: ["gut", "klar"] },
    { zeile: 7, cues: ["gut", "klar"] },
  ]);
  assert.deepEqual(findeB1Treffer([agent("Gut, hier ein Gedicht. Hallo.")]), []);
  assert.deepEqual(findeB1Treffer(undefined), []);
});

test("3399-v3: Gedaechtniszeilen lassen leere Eintraege weg und zaehlen erst danach", () => {
  const eintraege = [{}, null, { outcome: "a" }, { facts: [] }, { outcome: "b" }, { outcome: "c" }, { outcome: "d" }];
  assert.deepEqual(budgetedMemoryLines(eintraege), ["a", "b", "c"]);
  assert.deepEqual(budgetedMemoryLines(null), []);
  assert.deepEqual(budgetedMemoryLines("abc"), []);
  assert.equal(memoryLine({ outcome: "x".repeat(100) }), "x".repeat(100));
  assert.equal(memoryLine({ outcome: "x".repeat(101) }), `${"x".repeat(99)}…`);
});

test("3399-v3: Rufnummern-Sperre nennt das greifende Praefix", () => {
  const tabelle = [
    ["112", "112"],
    ["+4990012345", "+49900"],
    ["+1976555", "+1976"],
    ["+53123", "+53"],
    ["+4930123456", null],
  ];
  for (const [nummer, erwartet] of tabelle) assert.equal(deniedPrefix(nummer), erwartet, nummer);
  assert.equal(isDenied("+4930123456"), false);
  assert.equal(isDenied("+53123"), true);
});

test("3399-v3: Recherche-Fakten werden bereinigt, leere verworfen, erst danach auf drei gekuerzt", () => {
  assert.deepEqual(lookupFactsFrom("x"), []);
  assert.deepEqual(lookupFactsFrom(null), []);
  const roh = [5, null, "", " \n ", "a\u0000b", "  c   d  ", "e", "f"];
  assert.deepEqual(lookupFactsFrom(roh), ["a b", "c d", "e"]);
  assert.equal(lookupFactsFrom(["z".repeat(500)])[0]?.length, 200);
  assert.equal(sanitizeLookupQuery("Nummer 1234 pruefen"), "Nummer 1234 pruefen");
  assert.equal(sanitizeLookupQuery("Nummer 12345 pruefen"), null);
});

test("3399-v3: Medienweg aus dem call_sid-Praefix, Logzeilen mit Abweichung", () => {
  const mit = (callSid, phoneNumberId) => ({ metadata: { phone_call: { call_sid: callSid, phone_number_id: phoneNumberId } } });
  const wege = [
    [mit("SCL_abc"), "livekit"],
    [mit("otb_abc"), "sipgo"],
    [mit("xyz_abc"), "unbekannt"],
    [mit(""), null],
    [mit(5), null],
    [{ metadata: {} }, null],
    [{ metadata: { phone_call: null } }, null],
    [{}, null],
    [null, null],
    [undefined, null],
  ];
  for (const [gespraech, erwartet] of wege) assert.equal(medienwegAus(gespraech), erwartet, JSON.stringify(gespraech));

  const zeilen = (gespraech, erwartet) => medienwegZeilen({ conversation: gespraech, callId: "c1", conversationId: "k1", erwartet });
  assert.equal(zeilen(null, "sipgo"), null);
  assert.deepEqual(zeilen(mit("otb_abc", "pn1"), "sipgo"), {
    info: "[el-medienweg] callId=c1 conversationId=k1 weg=sipgo call_sid_praefix=otb phone_number_id=pn1",
    abweichung: null,
  });
  assert.equal(
    zeilen(mit("SCL_abc"), "sipgo").abweichung,
    "[el-medienweg-abweichung] callId=c1 conversationId=k1 weg=livekit erwartet=sipgo",
  );
  assert.equal(zeilen(mit("SCL_abc"), undefined).abweichung, null);
  assert.match(zeilen(mit("SCL_abc")).info, /phone_number_id=unbekannt$/);
  assert.match(zeilen(mit("ab-c_d")).info, /call_sid_praefix=abc /);
  assert.match(zeilen(mit("abcdefghijkl_d")).info, /call_sid_praefix=abcdefgh /);
  assert.match(zeilen(mit("ohneUnterstrich")).info, /call_sid_praefix=ohneUnte /);
  assert.match(zeilen(mit("SCL_abc_def")).info, /call_sid_praefix=SCL /);
  assert.match(zeilen(mit("abc")).info, /call_sid_praefix=abc /);
  assert.match(zeilen(mit("a_xyz")).info, /call_sid_praefix=a /);
});
