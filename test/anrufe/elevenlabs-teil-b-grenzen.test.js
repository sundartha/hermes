import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BRIDGE_STATE,
  bridgeStateOf,
  inboundAbgewiesen,
  istOutboundElProfil,
  uebergabeGescheitert,
} from "../../src/elevenlabs/inbound-bridge-state.js";
import {
  DEFAULT_INBOUND_EL_SCOPE,
  INBOUND_EL_SCOPE,
  isInboundElScope,
} from "../../src/elevenlabs/inbound-scope.js";
import { EL_CALL_BINDING_SIP_HEADER, elSipUri, elSipZiel } from "../../src/elevenlabs/inbound-sip-uri.js";
import {
  DID_ENDUNG_ZIFFERN,
  INIT_WEBHOOK_TOKEN_MIN_LENGTH,
  SIP_PASSWORD_MIN_LENGTH,
  ZUGANG_FP_HEX_ZEICHEN,
  ZUGANG_MANGEL,
  e164Endung,
  inboundElAccessDefects,
  inboundElAllowlistProbeLine,
  inboundElPathFor,
  inboundElPinnedTenantCount,
  inboundPfadEntscheidung,
  istNichtLeererString,
  zugangsFingerabdruck,
} from "../../src/elevenlabs/inbound-path-decision.js";

const IN_EL = "telnyx_inbound_el_convai";
const OUT_EL = "telnyx_outbound_el_convai";
const IN_BUDGET = "telnyx_inbound_budget";

test("Brueckenzustand: Tabelle aus Kostenprofil, Annahme, Rueckfall und Gespraechskennung", () => {
  const tabelle = [
    [undefined, "kein_el_inbound"],
    [null, "kein_el_inbound"],
    [{}, "kein_el_inbound"],
    [{ costProfile: IN_BUDGET }, "kein_el_inbound"],
    [{ costProfile: IN_BUDGET, elFallbackAt: "x", elevenlabsConversationId: "c" }, "kein_el_inbound"],
    [{ costProfile: OUT_EL }, "kein_el_inbound"],
    [{ costProfile: OUT_EL, elFallbackAt: "x", elevenlabsConversationId: "c" }, "kein_el_inbound"],
    [{ costProfile: IN_EL }, "wartet"],
    [{ costProfile: IN_EL, elevenlabsConversationId: "c" }, "gebunden"],
    [{ costProfile: IN_EL, elFallbackAt: "x" }, "rueckfall"],
    [{ costProfile: IN_EL, elFallbackAt: "x", elevenlabsConversationId: "c" }, "rueckfall"],
    [{ costProfile: OUT_EL, answeredAt: "t" }, "wartet"],
    [{ costProfile: OUT_EL, answeredAt: "t", elevenlabsConversationId: "c" }, "gebunden"],
    [{ costProfile: OUT_EL, answeredAt: "t", elFallbackAt: "x" }, "rueckfall"],
    [{ costProfile: IN_BUDGET, answeredAt: "t" }, "kein_el_inbound"],
  ];
  for (const [call, erwartet] of tabelle) assert.equal(bridgeStateOf(call), erwartet, JSON.stringify(call));
  assert.deepEqual({ ...BRIDGE_STATE }, {
    KEIN_EL_INBOUND: "kein_el_inbound",
    WARTET: "wartet",
    GEBUNDEN: "gebunden",
    RUECKFALL: "rueckfall",
  });
  assert.equal(Object.isFrozen(BRIDGE_STATE), true);
});

test("Ausgehendes EL-Profil und gescheiterte Uebergabe und abgewiesener Eingang", () => {
  assert.equal(istOutboundElProfil({ costProfile: OUT_EL }), true);
  assert.equal(istOutboundElProfil({ costProfile: IN_EL }), false);
  assert.equal(istOutboundElProfil(undefined), false);

  assert.equal(uebergabeGescheitert(undefined), false);
  assert.equal(uebergabeGescheitert({ costProfile: IN_BUDGET }), false);
  assert.equal(uebergabeGescheitert({ costProfile: IN_EL }), true);
  assert.equal(uebergabeGescheitert({ costProfile: IN_EL, elevenlabsConversationId: "c" }), false);
  assert.equal(uebergabeGescheitert({ costProfile: IN_EL, elFallbackAt: "x", elevenlabsConversationId: "c" }), true);
  assert.equal(uebergabeGescheitert({ costProfile: IN_BUDGET, elFallbackAt: "x" }), true);
  assert.equal(uebergabeGescheitert({ costProfile: OUT_EL, answeredAt: "t" }), true);
  assert.equal(uebergabeGescheitert({ costProfile: OUT_EL }), false);

  assert.equal(inboundAbgewiesen({ costProfile: IN_BUDGET, elFallbackAt: "x" }), true);
  assert.equal(inboundAbgewiesen({ costProfile: IN_BUDGET }), false);
  assert.equal(inboundAbgewiesen({ costProfile: IN_EL, elFallbackAt: "x" }), false);
  assert.equal(inboundAbgewiesen(undefined), false);
});

test("Eingangsbereich: nur die zwei bekannten Werte, Vorgabe ist die Allowlist", () => {
  assert.deepEqual({ ...INBOUND_EL_SCOPE }, { ALLOWLIST: "allowlist", REGISTRIERTE_DIDS: "registrierte_dids" });
  assert.equal(Object.isFrozen(INBOUND_EL_SCOPE), true);
  assert.equal(DEFAULT_INBOUND_EL_SCOPE, "allowlist");
  assert.equal(isInboundElScope("allowlist"), true);
  assert.equal(isInboundElScope("registrierte_dids"), true);
  for (const x of ["ALLOWLIST", "", "alle", undefined, null, 1, "ALLOWLIST", "keys"]) assert.equal(isInboundElScope(x), false, String(x));
});

test("SIP-Ziel und SIP-URI: genauer Wortlaut, Fehler bei falscher Nummer oder fehlendem Token", () => {
  assert.equal(EL_CALL_BINDING_SIP_HEADER, "X-Hermes-Call-Binding");
  assert.equal(elSipZiel("+4915112345678"), "sip:+4915112345678@sip.rtc.elevenlabs.io");
  assert.equal(
    elSipUri({ did: "+4915112345678", token: "a b/c" }),
    "sip:+4915112345678@sip.rtc.elevenlabs.io:5060;transport=tcp?X-Hermes-Call-Binding=a%20b%2Fc",
  );
  for (const did of ["4915112345678", "+0123456", "+123456", "+1234567890123456", "", null, undefined, 49151, "+49 151"]) {
    assert.throws(() => elSipZiel(did), { message: "elSipZiel: Absender ist keine E.164-Nummer" }, String(did));
    assert.throws(() => elSipUri({ did, token: "t" }), { message: "elSipUri: DID ist keine E.164-Nummer" }, String(did));
  }
  assert.equal(elSipZiel("+1234567"), "sip:+1234567@sip.rtc.elevenlabs.io");
  assert.equal(elSipZiel("+123456789012345"), "sip:+123456789012345@sip.rtc.elevenlabs.io");
  for (const token of ["", null, undefined, 5, {}]) {
    assert.throws(() => elSipUri({ did: "+4915112345678", token }), { message: "elSipUri: Bindungs-Token fehlt" });
  }
});

test("Zugangsmaengel: Schwellen, Reihenfolge und Meldungen je Umgebungsschluessel", () => {
  assert.equal(SIP_PASSWORD_MIN_LENGTH, 32);
  assert.equal(INIT_WEBHOOK_TOKEN_MIN_LENGTH, 32);
  assert.deepEqual({ ...ZUGANG_MANGEL }, { FEHLT: "fehlt", ZU_KURZ: "zu kurz" });
  const ok = { sipUser: "u", sipPassword: "p".repeat(32), initWebhookToken: "t".repeat(32) };
  assert.deepEqual(inboundElAccessDefects(ok), []);
  assert.deepEqual(inboundElAccessDefects({}), [
    { envKey: "ELEVENLABS_INBOUND_SIP_USER", mangel: "fehlt" },
    { envKey: "ELEVENLABS_INBOUND_SIP_PASSWORD", mangel: "fehlt" },
    { envKey: "ELEVENLABS_INIT_WEBHOOK_TOKEN", mangel: "fehlt" },
  ]);
  assert.deepEqual(
    inboundElAccessDefects({ sipUser: "", sipPassword: "p".repeat(31), initWebhookToken: "t".repeat(31) }),
    [
      { envKey: "ELEVENLABS_INBOUND_SIP_USER", mangel: "fehlt" },
      { envKey: "ELEVENLABS_INBOUND_SIP_PASSWORD", mangel: "zu kurz" },
      { envKey: "ELEVENLABS_INIT_WEBHOOK_TOKEN", mangel: "zu kurz" },
    ],
  );
  assert.deepEqual(inboundElAccessDefects({ ...ok, sipPassword: 12345 }), [
    { envKey: "ELEVENLABS_INBOUND_SIP_PASSWORD", mangel: "fehlt" },
  ]);
  assert.deepEqual(inboundElAccessDefects({ ...ok, sipUser: 7 }), [
    { envKey: "ELEVENLABS_INBOUND_SIP_USER", mangel: "fehlt" },
  ]);
  assert.equal(istNichtLeererString("x"), true);
  assert.equal(istNichtLeererString(""), false);
  assert.equal(istNichtLeererString(null), false);
  assert.equal(istNichtLeererString(1), false);
});

test("Zugangs-Fingerabdruck und DID-Endung", () => {
  assert.equal(ZUGANG_FP_HEX_ZEICHEN, 16);
  assert.equal(zugangsFingerabdruck("sip-user-1"), "0ac7924bacfe9bfb");
  assert.equal(zugangsFingerabdruck("a"), "ca978112ca1bbdca");
  for (const x of ["", null, undefined, 5]) assert.equal(zugangsFingerabdruck(x), null);
  assert.equal(DID_ENDUNG_ZIFFERN, 4);
  assert.equal(e164Endung("+4915112345678"), "…5678");
  assert.equal(inboundElPinnedTenantCount(["a", "b", "a"]), 2);
  assert.equal(inboundElPinnedTenantCount([]), 0);
});

const konfig = (inbound) => ({ voice: { elevenLabsInbound: inbound } });
const bereit = { enabled: true, sipUser: "sip-user-1", sipPassword: "p".repeat(32), initWebhookToken: "t".repeat(32) };

test("Pfadentscheidung Allowlist: nur gepinnte Tenants gehen ueber ElevenLabs", () => {
  const allow = { ...bereit, scope: "allowlist", tenantIds: ["t1", "t2"] };
  const wahl = (tenantId, inbound = allow) => inboundPfadEntscheidung({ config: konfig(inbound), tenantId });
  assert.equal(wahl("t1"), "elevenlabs");
  assert.equal(wahl("t2"), "elevenlabs");
  assert.equal(wahl("t3"), "budget");
  assert.equal(wahl(""), "budget");
  assert.equal(wahl(undefined), "budget");
  assert.equal(wahl("t1", { ...allow, tenantIds: undefined }), "budget");
  assert.equal(wahl("t1", { ...allow, tenantIds: "t1" }), "budget");
  assert.equal(wahl("t1", { ...allow, enabled: false }), "budget");
  assert.equal(wahl("t1", { ...allow, enabled: "true" }), "budget");
  assert.equal(wahl("t1", { ...allow, sipUser: "" }), "budget");
  assert.equal(wahl("t1", { ...allow, sipPassword: "p".repeat(31) }), "budget");
  assert.equal(wahl("t1", { ...allow, initWebhookToken: "" }), "budget");
  assert.equal(wahl("t1", { ...allow, scope: "unbekannt" }), "budget");
  assert.equal(inboundElPathFor({ config: konfig(allow), tenantId: "t1" }), true);
  assert.equal(inboundElPathFor({ config: konfig(allow), tenantId: "t3" }), false);
});

test("Pfadentscheidung registrierte DIDs: Beleg muss zum laufenden Zugang passen, sonst abgewiesen", () => {
  const reg = { ...bereit, scope: "registrierte_dids", tenantIds: [] };
  const fp = "0ac7924bacfe9bfb";
  const wahl = (numberRecord, inbound = reg) => inboundPfadEntscheidung({ config: konfig(inbound), tenantId: "t9", numberRecord });
  assert.equal(wahl({ elInboundTrunkBelegtAt: "2026-01-01", elInboundTrunkZugangFp: fp }), "elevenlabs");
  assert.equal(wahl({ elInboundTrunkBelegtAt: "2026-01-01", elInboundTrunkZugangFp: "anderer" }), "abgewiesen");
  assert.equal(wahl({ elInboundTrunkZugangFp: fp }), "abgewiesen");
  assert.equal(wahl({ elInboundTrunkBelegtAt: "", elInboundTrunkZugangFp: fp }), "abgewiesen");
  assert.equal(wahl(undefined), "abgewiesen");
  assert.equal(wahl(null), "abgewiesen");
  assert.equal(wahl({}), "abgewiesen");
  assert.equal(wahl({ elInboundTrunkBelegtAt: "2026-01-01", elInboundTrunkZugangFp: null }), "abgewiesen");
  assert.equal(
    wahl({ elInboundTrunkBelegtAt: "2026-01-01", elInboundTrunkZugangFp: fp }, { ...reg, enabled: false }),
    "budget",
  );
  assert.equal(
    wahl({ elInboundTrunkBelegtAt: "2026-01-01", elInboundTrunkZugangFp: fp }, { ...reg, sipPassword: "kurz" }),
    "budget",
  );
  assert.equal(inboundElPathFor({ config: konfig(reg), tenantId: "t9", numberRecord: undefined }), false);
});

test("Allowlist-Pruefzeile: aktive DIDs gepinnter Tenants, sortiert, sonst keine aktive DID", () => {
  const nummer = (tenantId, e164, status = "active") => ({ tenantId, e164, status });
  const state = {
    numbers: [
      nummer("t1", "+4915100009999"),
      nummer("t2", "+4915100001111"),
      nummer("t1", "+4915100005555", "suspended"),
      nummer("t3", "+4915100007777"),
      nummer("t2", "+4915100003333", "released"),
    ],
  };
  assert.equal(
    inboundElAllowlistProbeLine({ state, tenantIds: ["t1", "t2", "t1"] }),
    "Inbound-EL-Allowlist: 2 Tenants, aktive DIDs …1111, …9999",
  );
  assert.equal(
    inboundElAllowlistProbeLine({ state, tenantIds: ["t4"] }),
    "Inbound-EL-Allowlist: 1 Tenants, keine aktive DID",
  );
  assert.equal(inboundElAllowlistProbeLine({ state, tenantIds: [] }), "Inbound-EL-Allowlist: 0 Tenants, keine aktive DID");
  assert.equal(
    inboundElAllowlistProbeLine({ state: { numbers: [nummer("t1", "+4915100002222")] }, tenantIds: ["t1"] }),
    "Inbound-EL-Allowlist: 1 Tenants, aktive DIDs …2222",
  );
});
